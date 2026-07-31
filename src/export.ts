// The export pipeline.
//
// Nothing here touches the document. Every stage runs on a throwaway copy of the
// compiled geometry, so each toggle is free, reversible, and can never be
// accidentally baked in. Each stage also reports what it did, so a toggle is not a
// black box.

import type { Doc, Settings } from './model'
import type { Path, Pt } from './geom/core'
import { polylines, toD } from './geom/core'
import { compile } from './geom/primitives'
import { rdp } from './geom/rdp'
import { chain, cutLength, dedup, mergeCollinear, polygonize, toSegs } from './geom/segs'
import type { Sym } from './geom/wedge'
import { applyOp, opTransform, ops } from './geom/wedge'

export type StageReport = { name: string; note: string; state: 'ran' | 'off' | 'blocked' }

export function formatReports(reports: StageReport[]): string {
  return reports
    .map((r) => {
      const mark = r.state === 'ran' ? '·' : r.state === 'blocked' ? '!' : '○'
      return `${mark} ${r.name}${r.note ? ' — ' + r.note : ''}`
    })
    .join('\n')
}

export type Built = {
  svg: string
  reports: StageReport[]
  pathCount: number
  cutMm: number
  bbox: { w: number; h: number }
  overBed: boolean
}

/** Expand the fundamental domain into absolute geometry, baking in every transform. */
export function replicate(doc: Doc): Path[] {
  const sym: Sym = { n: doc.n, mirror: doc.mirror }
  const out: Path[] = []
  for (const c of compile(doc.elements, sym)) {
    if (c.global) out.push(...c.paths)
    else for (const o of ops(sym)) for (const p of c.paths) out.push(applyOp(p, o))
  }
  return out
}

/** Geometry as the analysis layer wants it: absolute, and always deduplicated
 *  (dedup removes no geometry, only exact repeats, so this stays independent of
 *  whatever the export toggles happen to be set to). */
export function analysisPaths(doc: Doc): Path[] {
  return chain(dedup(toSegs(replicate(doc))).set)
}

function bboxOf(paths: Path[]): { min: Pt; max: Pt } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of paths) {
    for (const line of polylines(p, 0.5)) {
      for (const q of line) {
        if (q.x < x0) x0 = q.x
        if (q.y < y0) y0 = q.y
        if (q.x > x1) x1 = q.x
        if (q.y > y1) y1 = q.y
      }
    }
  }
  if (!Number.isFinite(x0)) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
  return { min: { x: x0, y: y0 }, max: { x: x1, y: y1 } }
}

/** RDP over each maximal run of consecutive line commands. */
function simplify(paths: Path[], tol: number): { paths: Path[]; dropped: number } {
  let dropped = 0
  const out = paths.map((path) => {
    const res: Path = []
    let run: Pt[] = []
    const flush = () => {
      if (run.length > 2) {
        const kept = rdp(run, tol)
        dropped += run.length - kept.length
        for (let i = 1; i < kept.length; i++) res.push({ t: 'L', p: kept[i] })
      } else {
        for (let i = 1; i < run.length; i++) res.push({ t: 'L', p: run[i] })
      }
      run = []
    }
    let at: Pt | null = null
    for (const c of path) {
      if (c.t === 'L') {
        if (run.length === 0 && at) run.push(at)
        run.push(c.p)
        at = c.p
        continue
      }
      flush()
      res.push(c)
      if (c.t !== 'Z') at = c.p
    }
    flush()
    return res
  })
  return { paths: out, dropped }
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString()

export function build(doc: Doc, s: Settings): Built {
  const sym: Sym = { n: doc.n, mirror: doc.mirror }
  const reports: StageReport[] = []
  const add = (name: string, state: StageReport['state'], note: string) =>
    reports.push({ name, note, state })

  let flat: Path[] = []
  let body = ''
  let pathCount = 0

  if (s.ex.flatten) {
    flat = replicate(doc)
    add('replicate', 'ran', `${ops(sym).length} ops → ${flat.length} paths`)

    let set = toSegs(flat)
    const before = set.segs.length

    if (s.ex.dedup) {
      const r = dedup(set)
      set = r.set
      add('dedup', 'ran', `${r.removed} coincident of ${before} segments removed`)
    } else {
      add('dedup', 'off', 'coincident lines kept — mirror axes will be cut twice')
    }

    flat = chain(set)
    const closedCount = flat.filter((p) => p.some((c) => c.t === 'Z')).length
    add(
      'chain',
      'ran',
      `${set.segs.length} segments → ${flat.length} subpaths (${closedCount} closed)`,
    )

    if (s.ex.polygonize) {
      const r = polygonize(flat, Math.max(s.machine.kerf, 0.05))
      flat = r.paths
      add('polygonize', 'ran', `${r.n} arcs converted to line runs`)
    } else {
      add('polygonize', 'off', 'true arcs preserved')
    }

    if (s.ex.rdpTol > 0) {
      const r = simplify(flat, s.ex.rdpTol)
      flat = r.paths
      add('simplify', 'ran', `${r.dropped} points dropped at ${s.ex.rdpTol}mm`)
    } else {
      add('simplify', 'off', 'all points kept')
    }

    if (s.ex.mergeCollinear) {
      const r = mergeCollinear(flat)
      flat = r.paths
      add('merge collinear', 'ran', `${r.merged} segments merged`)
    } else {
      add('merge collinear', 'off', '')
    }

    pathCount = flat.length
    body = flat.map((p) => `    <path d="${toD(p)}"/>`).join('\n')
  } else {
    // Clone mode: one authored wedge plus n transforms. Much smaller and still
    // editable in Inkscape, but some importers silently drop <use>.
    const cs = compile(doc.elements, sym)
    let domain = cs.filter((c) => !c.global).flatMap((c) => c.paths)
    let globals = cs.filter((c) => c.global).flatMap((c) => c.paths)

    add('replicate', 'off', 'emitting <use> clones — verify your importer supports them')
    add('dedup', 'blocked', 'needs flatten: duplicates arise between clones')

    if (s.ex.polygonize) {
      const a = polygonize(domain, Math.max(s.machine.kerf, 0.05))
      const b = polygonize(globals, Math.max(s.machine.kerf, 0.05))
      domain = a.paths
      globals = b.paths
      add('polygonize', 'ran', `${a.n + b.n} arcs converted`)
    } else {
      add('polygonize', 'off', 'true arcs preserved')
    }

    if (s.ex.rdpTol > 0) {
      const a = simplify(domain, s.ex.rdpTol)
      domain = a.paths
      add('simplify', 'ran', `${a.dropped} points dropped at ${s.ex.rdpTol}mm`)
    } else {
      add('simplify', 'off', 'all points kept')
    }

    if (s.ex.mergeCollinear) {
      const a = mergeCollinear(domain)
      domain = a.paths
      add('merge collinear', 'ran', `${a.merged} segments merged`)
    } else {
      add('merge collinear', 'off', '')
    }

    // Both spellings: SVG 2 dropped xlink, but the importers most likely to be
    // handed a clone-mode file are also the ones that only understand xlink:href.
    const clones = ops(sym)
      .map(
        (o) =>
          `    <use href="#wedge" xlink:href="#wedge" transform="${opTransform(o)}"/>`,
      )
      .join('\n')
    body =
      `  <defs>\n    <g id="wedge">\n` +
      domain.map((p) => `      <path d="${toD(p)}"/>`).join('\n') +
      `\n    </g>\n  </defs>\n` +
      clones +
      (globals.length
        ? '\n' + globals.map((p) => `    <path d="${toD(p)}"/>`).join('\n')
        : '')
    pathCount = domain.length + globals.length
    flat = replicate(doc)
  }

  const bb = bboxOf(flat)
  const pad = 1
  const x0 = bb.min.x - pad
  const y0 = bb.min.y - pad
  const w = Math.max(bb.max.x - bb.min.x + pad * 2, 1)
  const h = Math.max(bb.max.y - bb.min.y + pad * 2, 1)

  const meta = JSON.stringify({ doc, settings: s }).replace(/--/g, '- -')
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- doily :: ${meta} -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"\n` +
    `     width="${n2(w)}mm" height="${n2(h)}mm" viewBox="${n2(x0)} ${n2(y0)} ${n2(w)} ${n2(h)}">\n` +
    `  <g fill="none" stroke="#000000" stroke-width="0.01" stroke-linecap="round">\n` +
    body +
    `\n  </g>\n</svg>\n`

  return {
    svg,
    reports,
    pathCount,
    cutMm: cutLength(flat),
    bbox: { w, h },
    overBed: w > s.machine.bed || h > s.machine.bed,
  }
}
