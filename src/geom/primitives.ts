// Compiling document elements into paths inside the fundamental domain.
//
// Domain convention: angle 0 is the mirror axis (the centre line of a wedge) and
// `domainAngle` is the wedge boundary. So a scallop's apex sits at 0 and its notch
// at the boundary, and a petal at angle 0 is centred in its wedge.

import type { Element } from '../model'
import { isGlobal } from '../model'
import type { Path, Pt } from './core'
import { arc3, circlePath, dist, polar, polylines, span } from './core'
import type { Sym } from './wedge'
import { domainAngle } from './wedge'

export type Compiled = { id: string; global: boolean; paths: Path[] }

/**
 * Half of a scallop bump, as an exact circular arc.
 *
 * The full bump must be one smooth circle spanning the wedge, so its centre has to
 * lie on the mirror axis. Solving for that centre (rather than bowing through a
 * guessed midpoint) is what keeps consecutive bumps tangent-free of kinks.
 */
function scallopHalf(r: number, depth: number, d: number): Path {
  const apex: Pt = { x: r, y: 0 }
  const notch = polar(r - depth, d)

  if (depth < 0.05) {
    // Degenerate: just an arc of the base circle.
    const p1 = polar(r, d)
    return [
      { t: 'M', p: apex },
      { t: 'A', p: p1, r, large: false, sweep: true, c: { x: 0, y: 0 } },
    ]
  }

  const denom = 2 * (notch.x - r)
  if (Math.abs(denom) < 1e-9) return [{ t: 'M', p: apex }, { t: 'L', p: notch }]

  const cx = ((r - depth) * (r - depth) - r * r) / denom
  const c: Pt = { x: cx, y: 0 }
  const rho = dist(c, apex)
  const a0 = Math.atan2(apex.y - c.y, apex.x - c.x)
  const a1 = Math.atan2(notch.y - c.y, notch.x - c.x)
  const sweep = span(a0, a1, true) <= Math.PI
  const s = span(a0, a1, sweep)
  return [
    { t: 'M', p: apex },
    { t: 'A', p: notch, r: rho, large: s > Math.PI, sweep, c },
  ]
}

function scallopFull(r: number, depth: number, d: number): Path {
  const p0 = polar(r - depth, 0)
  const p1 = polar(r - depth, d)
  const apex = polar(r, d / 2)
  return [{ t: 'M', p: p0 }, arc3(p0, apex, p1)]
}

function petal(a: number, r0: number, r1: number, bulge: number): Path[] {
  if (r1 - r0 < 0.1) return []
  const p0 = polar(r0, a)
  const p1 = polar(r1, a)
  const L = dist(p0, p1)
  const ux = (p1.x - p0.x) / L
  const uy = (p1.y - p0.y) / L
  const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
  const out: Pt = { x: m.x - uy * bulge, y: m.y + ux * bulge }
  const inn: Pt = { x: m.x + uy * bulge, y: m.y - ux * bulge }
  return [[{ t: 'M', p: p0 }, arc3(p0, out, p1), arc3(p1, inn, p0), { t: 'Z' }]]
}

export function compileElement(e: Element, sym: Sym): Path[] {
  const d = domainAngle(sym)
  switch (e.kind) {
    case 'ring':
      return e.r > 0.05 ? [circlePath({ x: 0, y: 0 }, e.r)] : []
    case 'spoke': {
      if (Math.abs(e.r1 - e.r0) < 0.05) return []
      return [[{ t: 'M', p: polar(e.r0, e.a) }, { t: 'L', p: polar(e.r1, e.a) }]]
    }
    case 'petal':
      return petal(e.a, e.r0, e.r1, e.bulge)
    case 'scallop': {
      if (e.r <= e.depth) return []
      return [sym.mirror ? scallopHalf(e.r, e.depth, d) : scallopFull(e.r, e.depth, d)]
    }
    case 'hole':
      return e.rh > 0.05 ? [circlePath(polar(e.r, e.a), e.rh)] : []
    case 'stroke': {
      if (e.pts.length < 2) return []
      const p: Path = [{ t: 'M', p: e.pts[0] }]
      for (let i = 1; i < e.pts.length; i++) p.push({ t: 'L', p: e.pts[i] })
      return [p]
    }
  }
}

export function compile(elements: Element[], sym: Sym): Compiled[] {
  return elements
    .filter((e) => e.on)
    .map((e) => ({ id: e.id, global: isGlobal(e), paths: compileElement(e, sym) }))
    .filter((c) => c.paths.length > 0)
}

/**
 * Smallest radius any geometry reaches — drives the centre-convergence check.
 * Sampled rather than solved analytically: an arc can dip nearer the origin than
 * either endpoint, and sampling gets that right without a pile of special cases.
 */
export function minRadius(cs: Compiled[]): number {
  let min = Infinity
  for (const c of cs) {
    for (const p of c.paths) {
      for (const line of polylines(p, 0.5)) {
        for (const q of line) {
          const r = Math.hypot(q.x, q.y)
          if (r < min) min = r
        }
      }
    }
  }
  return min === Infinity ? 0 : min
}
