import type { Pt } from './core'

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Ramer-Douglas-Peucker. A two-second freehand drag arrives as ~250 raw pointer
 * samples; at 0.05mm this returns roughly 40 of them with no visible change, which
 * keeps both the DOM and the exported file honest.
 */
export function rdp(pts: Pt[], tol: number): Pt[] {
  if (tol <= 0 || pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let best = -1
    let bestD = tol
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(pts[i], pts[lo], pts[hi])
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([lo, best], [best, hi])
    }
  }
  return pts.filter((_, i) => keep[i])
}
