// Freehand drawing.
//
// The in-progress stroke bypasses the app's render path entirely: we mutate one
// path element's `d` attribute directly and the <use> clones mirror it live. That
// is what keeps a 12- or 64-fold kaleidoscope at pointer-event rate without any
// canvas, worker or frame budget games.

import type { Doc, Settings } from './model'
import type { Pt } from './geom/core'
import { rdp } from './geom/rdp'
import type { Refs } from './render'
import { toUser } from './render'
import { fold, snap } from './geom/wedge'

const MIN_STEP = 0.25 // mm between retained raw samples

export type DrawHost = {
  doc: () => Doc
  settings: () => Settings
  commit: (pts: Pt[]) => void
}

export function enableDrawing(r: Refs, host: DrawHost) {
  let pts: Pt[] = []
  let active = false

  const place = (raw: Pt): Pt => {
    const doc = host.doc()
    const s = host.settings()
    let p = fold(raw, { n: doc.n, mirror: doc.mirror })
    if (s.constraints.snap === 'enforce') {
      p = snap(p, { n: doc.n, mirror: doc.mirror }, s.guides.rings, s.guides.radials, doc.R)
    }
    if (s.constraints.innerRadius === 'enforce') {
      const rr = Math.hypot(p.x, p.y)
      const min = s.machine.minInner
      if (rr > 1e-6 && rr < min) p = { x: (p.x / rr) * min, y: (p.y / rr) * min }
      else if (rr <= 1e-6 && min > 0) p = { x: min, y: 0 }
    }
    return p
  }

  const paint = () => {
    if (pts.length < 2) {
      r.scratch.setAttribute('d', '')
      return
    }
    let d = `M${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)}`
    for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(3)} ${pts[i].y.toFixed(3)}`
    r.scratch.setAttribute('d', d)
  }

  r.svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    active = true
    try {
      r.svg.setPointerCapture(ev.pointerId)
    } catch {
      /* synthetic events have no capturable pointer */
    }
    pts = [place(toUser(r.svg, ev))]
    paint()
    ev.preventDefault()
  })

  r.svg.addEventListener('pointermove', (ev) => {
    if (!active) return
    const p = place(toUser(r.svg, ev))
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) {
      pts.push(p)
      paint()
    }
  })

  const finish = (ev: PointerEvent) => {
    if (!active) return
    active = false
    try {
      r.svg.releasePointerCapture(ev.pointerId)
    } catch {
      /* pointer already gone */
    }
    const raw = pts
    pts = []
    r.scratch.setAttribute('d', '')
    if (raw.length >= 2) host.commit(rdp(raw, host.settings().ex.rdpTol || 0.05))
  }

  r.svg.addEventListener('pointerup', finish)
  r.svg.addEventListener('pointercancel', finish)
}
