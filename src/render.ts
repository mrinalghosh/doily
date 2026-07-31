// Live preview.
//
// The whole point of authoring in a fundamental domain: the canvas holds ONE copy
// of the geometry in <defs> and n <use> clones pointing at it. Editing a parameter
// or drawing a stroke rewrites the one copy and every clone follows for free, so
// cost is O(n) nodes rather than O(n x points). Mutating the in-progress stroke's
// `d` also updates all n clones with no re-render at all.

import type { Analysis } from './geom/analysis'
import type { Doc, Settings } from './model'
import { polar, toD } from './geom/core'
import { compile } from './geom/primitives'
import type { Sym } from './geom/wedge'
import { domainAngle, opTransform, ops, wedgeAngle } from './geom/wedge'

const NS = 'http://www.w3.org/2000/svg'

export type Refs = {
  svg: SVGSVGElement
  guides: SVGGElement
  dom: SVGGElement
  art: SVGGElement
  marks: SVGGElement
  scratch: SVGPathElement
}

export function setup(svg: SVGSVGElement): Refs {
  svg.innerHTML = `
    <g id="guides" fill="none" stroke-width="1" vector-effect="non-scaling-stroke"></g>
    <defs><g id="dom" fill="none" stroke="#1d2026" stroke-width="1"
              vector-effect="non-scaling-stroke" stroke-linecap="round"></g></defs>
    <g id="art"></g>
    <g id="marks"></g>`
  const q = <T extends Element>(id: string) => svg.querySelector(`#${id}`) as unknown as T
  const dom = q<SVGGElement>('dom')
  const scratch = document.createElementNS(NS, 'path')
  scratch.setAttribute('stroke', '#7fd1c1')
  scratch.setAttribute('d', '')
  dom.appendChild(scratch)
  return {
    svg,
    guides: q<SVGGElement>('guides'),
    dom,
    art: q<SVGGElement>('art'),
    marks: q<SVGGElement>('marks'),
    scratch,
  }
}

function viewBox(doc: Doc): string {
  const m = doc.R * 0.06 + 2
  const s = (doc.R + m) * 2
  return `${-(doc.R + m)} ${-(doc.R + m)} ${s} ${s}`
}

function guidesMarkup(doc: Doc, s: Settings): string {
  if (!s.guides.show) return ''
  const sym: Sym = { n: doc.n, mirror: doc.mirror }
  const d = domainAngle(sym)
  const w = wedgeAngle(sym)
  const out: string[] = []

  // The fundamental domain, shaded. Everything you author lives in here.
  const p0 = polar(doc.R, 0)
  const p1 = polar(doc.R, d)
  out.push(
    `<path d="M0 0L${p0.x.toFixed(3)} ${p0.y.toFixed(3)}` +
      `A${doc.R} ${doc.R} 0 0 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}Z"` +
      ` fill="#7fd1c1" fill-opacity="0.09" stroke="none"/>`,
  )

  // Every wedge boundary, faint, so the symmetry reads at a glance.
  const rays: string[] = []
  for (let k = 0; k < doc.n; k++) {
    const a = polar(doc.R, k * w + (doc.mirror ? d : 0))
    rays.push(`M0 0L${a.x.toFixed(3)} ${a.y.toFixed(3)}`)
  }
  out.push(`<path d="${rays.join('')}" stroke="#d8d4c8"/>`)

  // Snap guides.
  if (s.constraints.snap !== 'off') {
    const rings: string[] = []
    for (let i = 1; i <= s.guides.rings; i++) {
      const r = (doc.R * i) / s.guides.rings
      rings.push(`M${r} 0A${r} ${r} 0 1 1 ${-r} 0A${r} ${r} 0 1 1 ${r} 0`)
    }
    out.push(`<path d="${rings.join('')}" stroke="#e6e2d6"/>`)
    const rad: string[] = []
    for (let k = 0; k < doc.n * (doc.mirror ? 2 : 1) * s.guides.radials; k++) {
      const a = polar(doc.R, (k * d) / s.guides.radials)
      rad.push(`M0 0L${a.x.toFixed(3)} ${a.y.toFixed(3)}`)
    }
    out.push(`<path d="${rad.join('')}" stroke="#e6e2d6"/>`)
  }

  // Minimum inner radius: the origin is where all n wedges converge, so anything
  // drawn too close to it gets cut n times in the same few square millimetres.
  if (s.constraints.innerRadius !== 'off' && s.machine.minInner > 0) {
    const r = s.machine.minInner
    out.push(
      `<circle cx="0" cy="0" r="${r}" stroke="#e8a33d" stroke-dasharray="2 2" fill="none"/>`,
    )
  }

  out.push(`<circle cx="0" cy="0" r="${doc.R}" stroke="#cdc8ba" stroke-dasharray="4 3"/>`)
  return out.join('')
}

export function render(r: Refs, doc: Doc, s: Settings, selId: string | null) {
  const sym: Sym = { n: doc.n, mirror: doc.mirror }
  r.svg.setAttribute('viewBox', viewBox(doc))
  r.guides.innerHTML = guidesMarkup(doc, s)

  const cs = compile(doc.elements, sym)

  const domMarkup = cs
    .filter((c) => !c.global)
    .flatMap((c) =>
      c.paths.map(
        (p) =>
          `<path d="${toD(p)}"${c.id === selId ? ' stroke="#3fa694" stroke-width="2"' : ''}/>`,
      ),
    )
    .join('')
  r.dom.innerHTML = domMarkup
  r.dom.appendChild(r.scratch)

  const clones = ops(sym)
    .map((o) => `<use href="#dom" transform="${opTransform(o)}"/>`)
    .join('')
  const globals = cs
    .filter((c) => c.global)
    .flatMap((c) =>
      c.paths.map(
        (p) =>
          `<path d="${toD(p)}" fill="none" stroke="${c.id === selId ? '#3fa694' : '#1d2026'}"` +
          ` stroke-width="${c.id === selId ? 2 : 1}" vector-effect="non-scaling-stroke"/>`,
      ),
    )
    .join('')
  r.art.innerHTML = clones + globals
}

export function renderMarks(r: Refs, a: Analysis | null, s: Settings, R: number) {
  if (!a || !s.analysis.thin || a.thin.length === 0) {
    r.marks.innerHTML = ''
    return
  }
  const rr = Math.max(R / 220, 0.35)
  r.marks.innerHTML =
    `<g fill="#e5695f" fill-opacity="0.75" stroke="none">` +
    a.thin
      .map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${rr.toFixed(2)}"/>`)
      .join('') +
    `</g>`
}

/** Client coordinates to document millimetres. */
export function toUser(svg: SVGSVGElement, ev: PointerEvent) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}
