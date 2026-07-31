import type { Built } from '../export'
import { formatReports } from '../export'
import type { Doc, Kind, Settings } from '../model'
import { PARAMS, describe } from '../model'
import { domainAngle } from '../geom/wedge'
import { btnRow, button, h, note, section, slider, toggle, tristate } from './controls'

export type PanelHost = {
  doc: Doc
  settings: Settings
  sel: string | null
  built: Built | null
  /** `structural` rebuilds the panel; leave it false from a slider so the input
   *  you are dragging is not destroyed mid-gesture. */
  mutate: (fn: () => void, structural?: boolean) => void
  settled: () => void
  select: (id: string | null) => void
  add: (kind: Kind) => void
  remove: (id: string) => void
  exportSvg: () => void
  saveJson: () => void
  loadJson: () => void
  reset: () => void
  undo: () => void
}

const KINDS: Kind[] = ['ring', 'spoke', 'petal', 'scallop', 'hole']

export function buildPanel(host: PanelHost): HTMLElement[] {
  const { doc, settings: s } = host
  const dom = domainAngle({ n: doc.n, mirror: doc.mirror })
  const out: HTMLElement[] = []

  const title = h('h1', undefined, 'doily')
  out.push(title)

  // ── symmetry ───────────────────────────────────────────────────────────────
  out.push(
    section('symmetry', [
      slider('fold (n)', doc.n, 2, 64, 1, (v) => host.mutate(() => (doc.n = v)), host.settled),
      toggle(
        'mirror (Dₙ)',
        doc.mirror,
        (v) => host.mutate(() => (doc.mirror = v), true),
        doc.mirror
          ? `dihedral — domain is ${dom.toFixed(2)}°, angle 0 is the mirror axis`
          : `rotation only — domain is ${dom.toFixed(2)}°, chiral designs allowed`,
      ),
      slider('radius mm', doc.R, 10, 400, 1, (v) => host.mutate(() => (doc.R = v)), host.settled),
    ]),
  )

  // ── elements ───────────────────────────────────────────────────────────────
  const addBtns = btnRow(...KINDS.map((k) => button('+ ' + k, () => host.add(k))))
  const list = h('div', 'list')
  for (const e of doc.elements) {
    const item = h('div', e.id === host.sel ? 'item sel' : 'item')
    const cb = h('input')
    cb.type = 'checkbox'
    cb.checked = e.on
    cb.onclick = (ev) => {
      ev.stopPropagation()
      host.mutate(() => (e.on = cb.checked), true)
      host.settled()
    }
    const mid = h('div')
    mid.append(h('span', 'k', e.kind), h('span', 'm', '  ' + describe(e)))
    const x = h('button', 'x', '×')
    x.onclick = (ev) => {
      ev.stopPropagation()
      host.remove(e.id)
    }
    item.onclick = () => host.select(e.id === host.sel ? null : e.id)
    item.append(cb, mid, x)
    list.append(item)
  }

  const selEl = doc.elements.find((e) => e.id === host.sel)
  const params: HTMLElement[] = []
  if (selEl) {
    if (selEl.kind === 'stroke') {
      params.push(note(`freehand stroke, ${selEl.pts.length} points in the domain`))
    }
    for (const p of PARAMS[selEl.kind]) {
      const cur = (selEl as unknown as Record<string, number>)[p.key]
      params.push(
        slider(
          p.label,
          cur,
          p.min,
          p.max(doc.R, dom),
          p.step,
          (v) =>
            host.mutate(() => {
              ;(selEl as unknown as Record<string, number>)[p.key] = v
            }),
          host.settled,
        ),
      )
    }
  } else {
    params.push(note('drag on the canvas to draw a freehand stroke, or select an element to edit its parameters'))
  }

  out.push(section('elements', [addBtns, list, ...params]))

  // ── analysis ───────────────────────────────────────────────────────────────
  out.push(
    section('analysis (overlays)', [
      note('read-only checks. these never alter geometry.'),
      toggle('thin features', s.analysis.thin, (v) => host.mutate(() => (s.analysis.thin = v), true), 'marks gaps narrower than min feature'),
      toggle('cut-line groups', s.analysis.groups, (v) => host.mutate(() => (s.analysis.groups = v), true), 'proxy for "does the part stay in one piece"'),
      toggle('centre convergence', s.analysis.center, (v) => host.mutate(() => (s.analysis.center = v), true), `all ${doc.n} wedges meet at the origin`),
    ]),
  )

  // ── export pipeline ────────────────────────────────────────────────────────
  const stages: HTMLElement[] = [
    note('ordered stages, each run on a copy at emit time.'),
    toggle('flatten transforms', s.ex.flatten, (v) => host.mutate(() => (s.ex.flatten = v), true), 'off = <use> clones: smaller and editable, but some importers drop them'),
    toggle('dedup coincident', s.ex.dedup, (v) => host.mutate(() => (s.ex.dedup = v), true), 'mirror axes otherwise get cut twice'),
    toggle('merge collinear', s.ex.mergeCollinear, (v) => host.mutate(() => (s.ex.mergeCollinear = v), true)),
    toggle('polygonise arcs', s.ex.polygonize, (v) => host.mutate(() => (s.ex.polygonize = v), true), 'off by default — a true arc cuts smoother'),
    slider('simplify mm', s.ex.rdpTol, 0, 0.5, 0.01, (v) => host.mutate(() => (s.ex.rdpTol = v)), host.settled),
    note('simplify 0 = off'),
  ]
  // Always present, even before the first build, so the debounced pass has
  // something to patch rather than silently finding nothing.
  const rep = h('div', 'rep')
  rep.textContent = host.built ? formatReports(host.built.reports) : 'measuring…'
  stages.push(rep)
  out.push(section('export pipeline', stages))

  // ── constraints ────────────────────────────────────────────────────────────
  out.push(
    section('authoring constraints', [
      tristate('inner radius', s.constraints.innerRadius, (m) => host.mutate(() => (s.constraints.innerRadius = m), true)),
      tristate('snap', s.constraints.snap, (m) => host.mutate(() => (s.constraints.snap = m), true)),
      slider('snap rings', s.guides.rings, 0, 24, 1, (v) => host.mutate(() => (s.guides.rings = v), true), host.settled),
      slider('snap radials', s.guides.radials, 0, 12, 1, (v) => host.mutate(() => (s.guides.radials = v), true), host.settled),
      toggle('show guides', s.guides.show, (v) => host.mutate(() => (s.guides.show = v), true)),
    ]),
  )

  // ── machine ────────────────────────────────────────────────────────────────
  out.push(
    section('machine', [
      note('generic defaults — nothing here changes geometry, only the checks.'),
      slider('kerf mm', s.machine.kerf, 0.02, 0.6, 0.01, (v) => host.mutate(() => (s.machine.kerf = v), true), host.settled),
      slider('min feature', s.machine.minFeature, 0.1, 5, 0.05, (v) => host.mutate(() => (s.machine.minFeature = v), true), host.settled),
      slider('min inner r', s.machine.minInner, 0, 60, 0.5, (v) => host.mutate(() => (s.machine.minInner = v), true), host.settled),
      slider('bed mm', s.machine.bed, 50, 1500, 10, (v) => host.mutate(() => (s.machine.bed = v), true), host.settled),
    ]),
  )

  // ── file ───────────────────────────────────────────────────────────────────
  out.push(
    section('file', [
      btnRow(button('export svg', host.exportSvg, true)),
      btnRow(button('save .json', host.saveJson), button('load .json', host.loadJson)),
      btnRow(button('undo', host.undo), button('reset', host.reset)),
      note('hairline 0.01mm, fill none, 1 user unit = 1 mm. cut colour is black; LightBurn and RDWorks map stroke colour to layers.'),
    ]),
  )

  return out
}
