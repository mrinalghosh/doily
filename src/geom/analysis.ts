// Non-destructive analysis. Reads geometry, never mutates it — every check here is
// a report, so toggling one on or off can never alter what gets cut.

import type { Settings } from '../model'
import type { Path, Pt } from './core'
import { polylines } from './core'

export type Analysis = {
  minR: number
  /** Sample points where two features sit closer together than the minimum feature size. */
  thin: Pt[]
  /** Connected groups of cut line. See the caveat in `analyze`. */
  groups: number
  /** Groups that are a single closed loop touching nothing — holes, or floaters. */
  freeLoops: number
  samples: number
  ms: number
}

class DSU {
  p: number[]
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    while (this.p[x] !== x) x = this.p[x] = this.p[this.p[x]]
    return x
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.p[ra] = rb
  }
}

/**
 * `groups` is a proxy, not a proof. Genuinely answering "will the part stay in one
 * piece?" needs a planar arrangement of every intersection and a face-adjacency
 * walk. What this does instead is sample the cut lines and union samples that are
 * within touching distance, which reliably catches the common failure — a ring or
 * a stroke floating free of everything else — but will not catch a subtle case
 * where the cuts are all connected yet still isolate an interior region.
 */
export function analyze(paths: Path[], s: Settings): Analysis {
  const t0 = performance.now()
  const minFeature = Math.max(s.machine.minFeature, 1e-3)
  const step = minFeature / 4
  const touch = step * 1.5

  // Sample every subpath, tagging each point with the subpath it came from.
  const px: number[] = []
  const py: number[] = []
  const owner: number[] = []
  const isClosed: boolean[] = []
  let subpaths = 0
  let minR = Infinity

  for (const path of paths) {
    for (const line of polylines(path, step)) {
      const id = subpaths++
      const first = line[0]
      const last = line[line.length - 1]
      isClosed.push(Math.hypot(last.x - first.x, last.y - first.y) < 1e-3)
      for (let i = 0; i < line.length; i++) {
        const p = line[i]
        const r = Math.hypot(p.x, p.y)
        if (r < minR) minR = r
        // Re-space samples so a long straight run is not under-sampled.
        if (i > 0) {
          const q = line[i - 1]
          const d = Math.hypot(p.x - q.x, p.y - q.y)
          const n = Math.floor(d / step)
          for (let k = 1; k <= n; k++) {
            const t = (k * step) / d
            px.push(q.x + (p.x - q.x) * t)
            py.push(q.y + (p.y - q.y) * t)
            owner.push(id)
          }
        }
        px.push(p.x)
        py.push(p.y)
        owner.push(id)
      }
    }
  }

  const cell = minFeature
  const grid = new Map<number, number[]>()
  const gk = (ix: number, iy: number) => ix * 73856093 + iy * 19349663
  for (let i = 0; i < px.length; i++) {
    const k = gk(Math.floor(px[i] / cell), Math.floor(py[i] / cell))
    const list = grid.get(k)
    if (list) list.push(i)
    else grid.set(k, [i])
  }

  const dsu = new DSU(Math.max(subpaths, 1))
  const wantThin = s.analysis.thin
  const wantGroups = s.analysis.groups

  // Where two features genuinely meet. A spoke landing on a ring produces a band
  // of samples in the "thin" distance window on the approach, which is a junction
  // rather than a sliver — so junctions are recorded first and used to suppress
  // those candidates below.
  const suppressR = minFeature * 2
  const junctions = new Set<string>()
  const jkey = (pair: string, x: number, y: number) =>
    `${pair}|${Math.floor(x / suppressR)},${Math.floor(y / suppressR)}`
  const pairOf = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)

  type Cand = { i: number; j: number; pair: string }
  const cands: Cand[] = []

  if (wantThin || wantGroups) {
    for (let i = 0; i < px.length; i++) {
      const ix = Math.floor(px[i] / cell)
      const iy = Math.floor(py[i] / cell)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get(gk(ix + ox, iy + oy))
          if (!list) continue
          for (const j of list) {
            if (j <= i) continue
            if (owner[i] === owner[j]) continue
            const d = Math.hypot(px[i] - px[j], py[i] - py[j])
            if (d < touch) {
              const pair = pairOf(owner[i], owner[j])
              if (wantGroups) dsu.union(owner[i], owner[j])
              junctions.add(jkey(pair, px[i], py[i]))
            } else if (d < minFeature && wantThin) {
              cands.push({ i, j, pair: pairOf(owner[i], owner[j]) })
            }
          }
        }
      }
    }
  }

  const nearJunction = (pair: string, x: number, y: number) => {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        if (junctions.has(jkey(pair, x + ox * suppressR, y + oy * suppressR))) return true
      }
    }
    return false
  }

  const thinIdx = new Set<number>()
  for (const c of cands) {
    const mx = (px[c.i] + px[c.j]) / 2
    const my = (py[c.i] + py[c.j]) / 2
    if (nearJunction(c.pair, mx, my)) continue
    thinIdx.add(c.i)
    thinIdx.add(c.j)
  }

  let groups = 0
  let freeLoops = 0
  if (wantGroups && subpaths > 0) {
    const members = new Map<number, number[]>()
    for (let i = 0; i < subpaths; i++) {
      const r = dsu.find(i)
      const list = members.get(r)
      if (list) list.push(i)
      else members.set(r, [i])
    }
    groups = members.size
    // A group that is a single closed loop touching nothing else: a hole or a
    // free-floating ring. Intentional for holes, a structural bug otherwise —
    // the tool cannot tell which, so it reports the count and you judge.
    for (const list of members.values()) {
      if (list.length === 1 && isClosed[list[0]]) freeLoops++
    }
  }

  const thin: Pt[] = []
  if (wantThin) for (const i of thinIdx) thin.push({ x: px[i], y: py[i] })

  return {
    minR: minR === Infinity ? 0 : minR,
    thin,
    groups,
    freeLoops,
    samples: px.length,
    ms: performance.now() - t0,
  }
}
