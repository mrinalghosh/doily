// Symmetry bookkeeping.
//
// A document is authored entirely inside the *fundamental domain* — one angular
// sector containing no redundancy. For C_n that sector is 360/n wide; for D_n the
// mirror halves it to 180/n. The full doily is that one sector plus a list of
// transforms, which is what keeps the whole thing O(n) nodes instead of
// O(n x points).

import type { Path, Pt } from './core'
import { TAU, mirrorPath, rotatePath } from './core'

export type Sym = { n: number; mirror: boolean }

/** Angular width of the fundamental domain, in degrees. */
export const domainAngle = (s: Sym) => 360 / s.n / (s.mirror ? 2 : 1)

/** Angular width of one repeated wedge, in degrees. */
export const wedgeAngle = (s: Sym) => 360 / s.n

export type Op = { rot: number; mirror: boolean }

/** Every element of the symmetry group, as an operation on the domain. */
export function ops(s: Sym): Op[] {
  const step = wedgeAngle(s)
  const out: Op[] = []
  for (let k = 0; k < s.n; k++) {
    out.push({ rot: k * step, mirror: false })
    if (s.mirror) out.push({ rot: k * step, mirror: true })
  }
  return out
}

export const opTransform = (o: Op) =>
  o.mirror ? `rotate(${o.rot.toFixed(5)}) scale(1,-1)` : `rotate(${o.rot.toFixed(5)})`

export function applyOp(path: Path, o: Op): Path {
  return rotatePath(o.mirror ? mirrorPath(path) : path, o.rot)
}

/**
 * Fold an arbitrary point into the fundamental domain.
 *
 * Lets you draw anywhere on the canvas and have the stroke land in the wedge,
 * which is far kinder than clamping (clamping distorts a stroke that crosses the
 * boundary; folding just reflects it, which is what the symmetry does anyway).
 */
export function fold(p: Pt, s: Sym): Pt {
  const r = Math.hypot(p.x, p.y)
  if (r < 1e-9) return { x: 0, y: 0 }
  const w = TAU / s.n
  let a = Math.atan2(p.y, p.x) % w
  if (a < 0) a += w
  if (s.mirror && a > w / 2) a = w - a
  return { x: r * Math.cos(a), y: r * Math.sin(a) }
}

/** Snap a domain point to the nearest concentric ring / radial guide. */
export function snap(p: Pt, s: Sym, rings: number, radials: number, R: number): Pt {
  let r = Math.hypot(p.x, p.y)
  let a = Math.atan2(p.y, p.x)
  if (rings > 0) {
    const step = R / rings
    r = Math.round(r / step) * step
  }
  if (radials > 0) {
    const step = (TAU / s.n / (s.mirror ? 2 : 1)) / radials
    a = Math.round(a / step) * step
  }
  return { x: r * Math.cos(a), y: r * Math.sin(a) }
}
