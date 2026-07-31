// Core geometry: points, an SVG-shaped path model, and transforms that preserve arcs.
//
// Everything is in millimetres, origin at the centre of the doily. The path model
// mirrors SVG's own commands so export is a straight serialisation, and arcs carry
// their centre so rotation/mirroring/sampling never has to re-solve for it.

export type Pt = { x: number; y: number }

export type Cmd =
  | { t: 'M'; p: Pt }
  | { t: 'L'; p: Pt }
  | { t: 'A'; p: Pt; r: number; large: boolean; sweep: boolean; c: Pt }
  | { t: 'Z' }

export type Path = Cmd[]

export const TAU = Math.PI * 2
export const rad = (deg: number) => (deg * Math.PI) / 180
export const deg = (r: number) => (r * 180) / Math.PI

export const pt = (x: number, y: number): Pt => ({ x, y })
export const polar = (r: number, aDeg: number): Pt => {
  const a = rad(aDeg)
  return { x: r * Math.cos(a), y: r * Math.sin(a) }
}
export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
export const len = (p: Pt) => Math.hypot(p.x, p.y)
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Angular span from a0 to a1 travelling in the given sweep direction. */
export function span(a0: number, a1: number, sweep: boolean): number {
  let d = sweep ? a1 - a0 : a0 - a1
  while (d < 0) d += TAU
  while (d >= TAU) d -= TAU
  return d
}

/**
 * Circular arc from `a` to `b` passing through `through`.
 *
 * This is the workhorse for every curved primitive: pick the two endpoints and a
 * point the curve should bow through, and the flags fall out of the circumcircle.
 * Collinear input degrades to a line rather than blowing up.
 */
export function arc3(a: Pt, through: Pt, b: Pt): Cmd {
  const m = through
  const d =
    2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y))
  if (Math.abs(d) < 1e-9) return { t: 'L', p: b }

  const sa = a.x * a.x + a.y * a.y
  const sm = m.x * m.x + m.y * m.y
  const sb = b.x * b.x + b.y * b.y
  const cx = (sa * (m.y - b.y) + sm * (b.y - a.y) + sb * (a.y - m.y)) / d
  const cy = (sa * (b.x - m.x) + sm * (a.x - b.x) + sb * (m.x - a.x)) / d
  const c = { x: cx, y: cy }
  const r = dist(c, a)

  // Turn direction a -> m -> b decides which way round the circle we travel.
  const cross = (m.x - a.x) * (b.y - m.y) - (m.y - a.y) * (b.x - m.x)
  const sweep = cross > 0
  const s = span(Math.atan2(a.y - cy, a.x - cx), Math.atan2(b.y - cy, b.x - cx), sweep)
  return { t: 'A', p: b, r, large: s > Math.PI, sweep, c }
}

/** A full circle as two half arcs — closed under rotation and mirroring. */
export function circlePath(c: Pt, r: number): Path {
  const right = { x: c.x + r, y: c.y }
  const left = { x: c.x - r, y: c.y }
  return [
    { t: 'M', p: right },
    { t: 'A', p: left, r, large: false, sweep: true, c: { ...c } },
    { t: 'A', p: right, r, large: false, sweep: true, c: { ...c } },
    { t: 'Z' },
  ]
}

const rotPt = (p: Pt, aDeg: number): Pt => {
  const a = rad(aDeg)
  const co = Math.cos(a)
  const si = Math.sin(a)
  return { x: p.x * co - p.y * si, y: p.x * si + p.y * co }
}

/**
 * Rotation maps arcs to arcs: rotate the endpoints and the centre and the flags
 * are untouched. This is why the exporter can bake transforms into coordinates
 * without ever polygonising a curve.
 */
export function rotatePath(path: Path, aDeg: number): Path {
  return path.map((c) => {
    switch (c.t) {
      case 'M':
      case 'L':
        return { ...c, p: rotPt(c.p, aDeg) }
      case 'A':
        return { ...c, p: rotPt(c.p, aDeg), c: rotPt(c.c, aDeg) }
      case 'Z':
        return c
    }
  })
}

/** Reflection across the x-axis. Radius survives; the sweep direction flips. */
export function mirrorPath(path: Path): Path {
  return path.map((c) => {
    switch (c.t) {
      case 'M':
      case 'L':
        return { ...c, p: { x: c.p.x, y: -c.p.y } }
      case 'A':
        return {
          ...c,
          p: { x: c.p.x, y: -c.p.y },
          c: { x: c.c.x, y: -c.c.y },
          sweep: !c.sweep,
        }
      case 'Z':
        return c
    }
  })
}

const f = (n: number) => {
  const s = n.toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

export function toD(path: Path): string {
  const out: string[] = []
  for (const c of path) {
    switch (c.t) {
      case 'M':
        out.push(`M${f(c.p.x)} ${f(c.p.y)}`)
        break
      case 'L':
        out.push(`L${f(c.p.x)} ${f(c.p.y)}`)
        break
      case 'A':
        out.push(
          `A${f(c.r)} ${f(c.r)} 0 ${c.large ? 1 : 0} ${c.sweep ? 1 : 0} ${f(c.p.x)} ${f(c.p.y)}`,
        )
        break
      case 'Z':
        out.push('Z')
        break
    }
  }
  return out.join('')
}

/** Sample an arc command into points, given where the pen currently is. */
export function sampleArc(
  from: Pt,
  c: Extract<Cmd, { t: 'A' }>,
  maxChord: number,
): Pt[] {
  const a0 = Math.atan2(from.y - c.c.y, from.x - c.c.x)
  const a1 = Math.atan2(c.p.y - c.c.y, c.p.x - c.c.x)
  const s = span(a0, a1, c.sweep)
  const steps = Math.max(2, Math.ceil((s * c.r) / Math.max(maxChord, 1e-3)))
  const dir = c.sweep ? 1 : -1
  const out: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const a = a0 + dir * s * (i / steps)
    out.push({ x: c.c.x + c.r * Math.cos(a), y: c.c.y + c.r * Math.sin(a) })
  }
  return out
}

/** Flatten a path to polylines (one per subpath) for measurement and analysis. */
export function polylines(path: Path, maxChord = 0.4): Pt[][] {
  const subs: Pt[][] = []
  let cur: Pt[] = []
  let start: Pt | null = null
  let at: Pt | null = null
  for (const c of path) {
    if (c.t === 'M') {
      if (cur.length > 1) subs.push(cur)
      cur = [c.p]
      start = c.p
      at = c.p
    } else if (c.t === 'L') {
      cur.push(c.p)
      at = c.p
    } else if (c.t === 'A') {
      if (at) cur.push(...sampleArc(at, c, maxChord))
      at = c.p
    } else if (c.t === 'Z') {
      if (start) cur.push(start)
      at = start
    }
  }
  if (cur.length > 1) subs.push(cur)
  return subs
}
