// Segment-level operations for the export pipeline.
//
// Paths are decomposed to individual segments so coincident geometry can be
// recognised regardless of which direction it was drawn in, then re-chained into
// long continuous subpaths (fewer elements, and continuous cut paths mean less
// head travel on the machine).

import type { Cmd, Path, Pt } from './core'
import { dist, sampleArc, span } from './core'

export type Seg = { sub: number } & (
  | { k: 'L'; a: Pt; b: Pt }
  | { k: 'A'; a: Pt; b: Pt; r: number; large: boolean; sweep: boolean; c: Pt }
)

/** Segments plus enough provenance to know which authored shapes were closed. */
export type SegSet = {
  segs: Seg[]
  /** Subpath indices that were authored as closed loops. */
  closed: Set<number>
  /** Original segment count per subpath, so "did it survive intact?" is answerable. */
  size: Map<number, number>
}

const TOL = 1e-3 // 1 micron: far below kerf, far above float noise
const q = (v: number) => Math.round(v / TOL)
const key = (p: Pt) => `${q(p.x)},${q(p.y)}`

export function toSegs(paths: Path[]): SegSet {
  const segs: Seg[] = []
  const closed = new Set<number>()
  const size = new Map<number, number>()
  let sub = -1
  const bump = () => size.set(sub, (size.get(sub) ?? 0) + 1)

  for (const path of paths) {
    let at: Pt | null = null
    let start: Pt | null = null
    for (const c of path) {
      if (c.t === 'M') {
        sub++
        at = c.p
        start = c.p
      } else if (c.t === 'L') {
        if (at && dist(at, c.p) > TOL) {
          segs.push({ k: 'L', a: at, b: c.p, sub })
          bump()
        }
        at = c.p
      } else if (c.t === 'A') {
        if (at) {
          segs.push({ k: 'A', a: at, b: c.p, r: c.r, large: c.large, sweep: c.sweep, c: c.c, sub })
          bump()
        }
        at = c.p
      } else if (c.t === 'Z') {
        if (at && start && dist(at, start) > TOL) {
          segs.push({ k: 'L', a: at, b: start, sub })
          bump()
        }
        if (sub >= 0) closed.add(sub)
        at = start
      }
    }
  }
  return { segs, closed, size }
}

/**
 * Canonical identity of a segment, direction-independent.
 *
 * Under D_n symmetry any element touching a mirror axis produces an exactly
 * overlapping twin. The laser would then cut that line twice — scorch marks, and
 * on thin stock a fall-through. Reversing an arc swaps its endpoints and flips its
 * sweep flag, so the canonical form has to account for both together.
 */
function canon(s: Seg): string {
  const ka = key(s.a)
  const kb = key(s.b)
  const swapped = ka > kb
  const [p, r] = swapped ? [kb, ka] : [ka, kb]
  if (s.k === 'L') return `L|${p}|${r}`
  const sweep = swapped ? !s.sweep : s.sweep
  return `A|${p}|${r}|${q(s.r)}|${s.large ? 1 : 0}|${sweep ? 1 : 0}`
}

export function dedup(set: SegSet): { set: SegSet; removed: number } {
  const seen = new Set<string>()
  const out: Seg[] = []
  for (const s of set.segs) {
    const k = canon(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return {
    set: { segs: out, closed: set.closed, size: set.size },
    removed: set.segs.length - out.length,
  }
}

const segStart = (s: Seg, flip: boolean) => (flip ? s.b : s.a)
const segEnd = (s: Seg, flip: boolean) => (flip ? s.a : s.b)

function segCmd(s: Seg, flip: boolean): Cmd {
  const to = segEnd(s, flip)
  if (s.k === 'L') return { t: 'L', p: to }
  return { t: 'A', p: to, r: s.r, large: s.large, sweep: flip ? !s.sweep : s.sweep, c: s.c }
}

const norm = (p: Pt): Pt => {
  const l = Math.hypot(p.x, p.y)
  return l < 1e-12 ? { x: 0, y: 0 } : { x: p.x / l, y: p.y / l }
}

/** Unit direction of travel leaving the oriented segment's start point. */
function dirOut(s: Seg, flip: boolean): Pt {
  const a = segStart(s, flip)
  if (s.k === 'L') return norm({ x: segEnd(s, flip).x - a.x, y: segEnd(s, flip).y - a.y })
  const sweep = flip ? !s.sweep : s.sweep
  const rx = a.x - s.c.x
  const ry = a.y - s.c.y
  return norm(sweep ? { x: -ry, y: rx } : { x: ry, y: -rx })
}

/** Unit direction of travel arriving at the oriented segment's end point. */
function dirIn(s: Seg, flip: boolean): Pt {
  const b = segEnd(s, flip)
  if (s.k === 'L') return norm({ x: b.x - segStart(s, flip).x, y: b.y - segStart(s, flip).y })
  const sweep = flip ? !s.sweep : s.sweep
  const rx = b.x - s.c.x
  const ry = b.y - s.c.y
  return norm(sweep ? { x: -ry, y: rx } : { x: ry, y: -rx })
}

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y

/**
 * Re-chain loose segments into continuous subpaths, preferring tangent continuity
 * at junctions.
 *
 * Greedy "take any attached segment" chaining produces geometrically correct but
 * semantically scrambled output — the outer border dives down a spoke and ends up
 * halfway round an inner ring, leaving nothing closed. Choosing the continuation
 * that best carries on straight keeps the border a closed loop, keeps rings whole,
 * and drops each spoke out as its own path, which is also what makes cut ordering
 * work in the machine's software.
 */
export function chain(set: SegSet): Path[] {
  const segs = set.segs
  const used = new Array<boolean>(segs.length).fill(false)
  const paths: Path[] = []

  // A shape the document authored as a closed loop stays a closed loop, provided
  // every one of its segments survived dedup. Petals, holes and rings therefore
  // never get absorbed into a passing spoke chain, which is what lets the machine's
  // software recognise them as shapes and order the cuts inside-out.
  const bySub = new Map<number, number[]>()
  segs.forEach((s, i) => {
    const list = bySub.get(s.sub)
    if (list) list.push(i)
    else bySub.set(s.sub, [i])
  })
  for (const [sub, idx] of bySub) {
    if (!set.closed.has(sub) || idx.length !== set.size.get(sub)) continue
    const path: Path = [{ t: 'M', p: segs[idx[0]].a }]
    for (const i of idx) {
      path.push(segCmd(segs[i], false))
      used[i] = true
    }
    path.push({ t: 'Z' })
    paths.push(path)
  }

  const at = new Map<string, number[]>()
  segs.forEach((s, i) => {
    if (used[i]) return
    for (const k of [key(s.a), key(s.b)]) {
      const list = at.get(k)
      if (list) list.push(i)
      else at.set(k, [i])
    }
  })

  /**
   * Best continuation at `p`. Closing the current chain wins outright; otherwise
   * take whichever candidate carries on straightest. Greedy "any attached segment"
   * chaining leaves nothing closed — the outer border dives down a spoke and ends
   * up halfway round an inner ring.
   */
  const best = (p: Pt, incoming: Pt, backward: boolean, farEnd: string) => {
    let bestJ = -1
    let bestFlip = false
    let bestScore = -Infinity
    for (const j of at.get(key(p)) ?? []) {
      if (used[j]) continue
      const flip = backward ? key(segs[j].b) !== key(p) : key(segs[j].a) !== key(p)
      const d = backward ? dirIn(segs[j], flip) : dirOut(segs[j], flip)
      let score = backward ? dot(d, incoming) : dot(incoming, d)
      const lands = backward ? key(segStart(segs[j], flip)) : key(segEnd(segs[j], flip))
      if (lands === farEnd) score += 10
      if (score > bestScore) {
        bestScore = score
        bestJ = j
        bestFlip = flip
      }
    }
    return bestJ < 0 ? null : { j: bestJ, flip: bestFlip }
  }

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = true
    const items: { s: Seg; flip: boolean }[] = [{ s: segs[i], flip: false }]

    let head = segs[i].a
    let end = segs[i].b
    let endDir = dirIn(segs[i], false)
    for (;;) {
      const pick = best(end, endDir, false, key(head))
      if (!pick) break
      used[pick.j] = true
      items.push({ s: segs[pick.j], flip: pick.flip })
      endDir = dirIn(segs[pick.j], pick.flip)
      end = segEnd(segs[pick.j], pick.flip)
      if (key(end) === key(head)) break
    }

    let headDir = dirOut(segs[i], false)
    while (key(head) !== key(end)) {
      const pick = best(head, headDir, true, key(end))
      if (!pick) break
      used[pick.j] = true
      items.unshift({ s: segs[pick.j], flip: pick.flip })
      headDir = dirOut(segs[pick.j], pick.flip)
      head = segStart(segs[pick.j], pick.flip)
    }

    const path: Path = [{ t: 'M', p: head }]
    for (const it of items) path.push(segCmd(it.s, it.flip))
    if (key(head) === key(end)) path.push({ t: 'Z' })
    paths.push(path)
  }
  return paths
}

const perpDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy)
  if (l < 1e-12) return dist(p, a)
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l
}

/** Collapse runs of near-collinear line segments within each subpath. */
export function mergeCollinear(paths: Path[], tol = 2e-3): { paths: Path[]; merged: number } {
  let merged = 0
  const out = paths.map((path) => {
    const res: Path = []
    for (const c of path) {
      const prev = res[res.length - 1]
      const prev2 = res[res.length - 2]
      if (
        c.t === 'L' &&
        prev &&
        prev.t === 'L' &&
        prev2 &&
        prev2.t !== 'Z' &&
        perpDist(prev.p, prev2.p, c.p) < tol
      ) {
        res[res.length - 1] = c
        merged++
        continue
      }
      res.push(c)
    }
    return res
  })
  return { paths: out, merged }
}

/** Replace arcs with line approximations. Off by default: a true arc cuts smoother. */
export function polygonize(paths: Path[], maxChord: number): { paths: Path[]; n: number } {
  let n = 0
  const out = paths.map((path) => {
    const res: Path = []
    let at: Pt | null = null
    let start: Pt | null = null
    for (const c of path) {
      if (c.t === 'A' && at) {
        for (const p of sampleArc(at, c, maxChord)) res.push({ t: 'L', p })
        at = c.p
        n++
      } else {
        res.push(c)
        if (c.t === 'M') {
          at = c.p
          start = c.p
        } else if (c.t === 'L') at = c.p
        else if (c.t === 'Z') at = start
      }
    }
    return res
  })
  return { paths: out, n }
}

/** Total cut length in mm — a decent proxy for how long the job will take. */
export function cutLength(paths: Path[]): number {
  let total = 0
  for (const s of toSegs(paths).segs) {
    if (s.k === 'L') total += dist(s.a, s.b)
    else {
      const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
      const a1 = Math.atan2(s.b.y - s.c.y, s.b.x - s.c.x)
      total += span(a0, a1, s.sweep) * s.r
    }
  }
  return total
}
