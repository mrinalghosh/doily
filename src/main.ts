import './style.css'

import type { Analysis } from './geom/analysis'
import { analyze } from './geom/analysis'
import type { Built } from './export'
import { analysisPaths, build, formatReports } from './export'
import type { Doc, Kind, Settings } from './model'
import { defaultDoc, defaultSettings, newElement, uid } from './model'
import { enableDrawing } from './draw'
import { render, renderMarks, setup } from './render'
import { buildPanel } from './ui/panel'

const clone = <T>(v: T): T => structuredClone(v)

// ── state ────────────────────────────────────────────────────────────────────
let doc: Doc = loadDoc()
let settings: Settings = loadSettings()
let sel: string | null = null
let built: Built | null = null
let analysis: Analysis | null = null

/** Last settled document, so slider drags collapse to one undo step. */
let baseline = clone(doc)
const history: Doc[] = []

function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem('doily.doc')
    if (!raw) return defaultDoc()
    const d = JSON.parse(raw) as Doc
    if (typeof d.n !== 'number' || !Array.isArray(d.elements)) return defaultDoc()
    return d
  } catch {
    return defaultDoc()
  }
}

function loadSettings(): Settings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem('doily.settings')
    if (!raw) return base
    const s = JSON.parse(raw) as Partial<Settings>
    return {
      machine: { ...base.machine, ...s.machine },
      analysis: { ...base.analysis, ...s.analysis },
      ex: { ...base.ex, ...s.ex },
      constraints: { ...base.constraints, ...s.constraints },
      guides: { ...base.guides, ...s.guides },
    }
  } catch {
    return base
  }
}

const persist = () => {
  localStorage.setItem('doily.doc', JSON.stringify(doc))
  localStorage.setItem('doily.settings', JSON.stringify(settings))
}

// ── dom ──────────────────────────────────────────────────────────────────────
const svg = document.getElementById('canvas') as unknown as SVGSVGElement
const panelEl = document.getElementById('panel')!
const hudEl = document.getElementById('hud')!
const refs = setup(svg)

// ── refresh ──────────────────────────────────────────────────────────────────
let heavyTimer: number | undefined

function refresh(structural = false) {
  render(refs, doc, settings, sel)
  if (structural) renderPanel()
  persist()
  clearTimeout(heavyTimer)
  heavyTimer = setTimeout(heavy, 140) as unknown as number
}

function renderPanel() {
  const scroll = panelEl.scrollTop
  panelEl.replaceChildren(...buildPanel(host))
  panelEl.scrollTop = scroll
}

/**
 * The measured passes. Debounced off the interaction path so dragging a slider
 * never waits on analysis — the geometry itself is cheap, the sampling is not.
 */
function heavy() {
  built = build(doc, settings)
  analysis = analyze(analysisPaths(doc), settings)
  renderMarks(refs, analysis, settings, doc.R)
  updateHud()
  // Patch the stage report in place rather than rebuilding the panel, which would
  // yank the input out from under a live drag.
  const rep = panelEl.querySelector('.rep')
  if (rep) rep.textContent = formatReports(built.reports)
}

function chip(text: string, level: '' | 'warn' | 'bad' = '') {
  const d = document.createElement('div')
  d.className = level ? `chip ${level}` : 'chip'
  d.textContent = text
  return d
}

function updateHud() {
  const chips: HTMLElement[] = []
  const grp = doc.mirror ? `D${doc.n}` : `C${doc.n}`
  chips.push(chip(`${grp} · ${doc.elements.filter((e) => e.on).length} elements`))
  if (built) {
    chips.push(chip(`${built.bbox.w.toFixed(0)} × ${built.bbox.h.toFixed(0)} mm`))
    chips.push(chip(`${built.pathCount} paths · ${(built.cutMm / 1000).toFixed(2)} m cut`))
    if (built.overBed) chips.push(chip(`exceeds ${settings.machine.bed} mm bed`, 'bad'))
  }
  if (analysis) {
    if (settings.analysis.center && analysis.minR + 1e-6 < settings.machine.minInner) {
      chips.push(
        chip(
          `centre: geometry reaches r ${analysis.minR.toFixed(1)} mm, min ${settings.machine.minInner} mm`,
          'warn',
        ),
      )
    }
    if (settings.analysis.thin && analysis.thin.length) {
      chips.push(chip(`thin: ${analysis.thin.length} samples under ${settings.machine.minFeature} mm`, 'bad'))
    }
    if (settings.analysis.groups && analysis.groups > 1) {
      // Free loops are holes falling out by design; more than one *structural*
      // group means part of the design is not attached to the rest.
      const structural = analysis.groups - analysis.freeLoops
      chips.push(
        chip(
          `${analysis.groups} cut groups · ${analysis.freeLoops} free loops · ${structural} structural`,
          structural > 1 ? 'warn' : '',
        ),
      )
    }
    chips.push(chip(`analysis ${analysis.ms.toFixed(0)} ms · ${analysis.samples} samples`))
  }
  hudEl.replaceChildren(...chips)
}

// ── host ─────────────────────────────────────────────────────────────────────
const host = {
  get doc() {
    return doc
  },
  get settings() {
    return settings
  },
  get sel() {
    return sel
  },
  get built() {
    return built
  },
  mutate(fn: () => void, structural = false) {
    fn()
    refresh(structural)
  },
  settled() {
    history.push(baseline)
    if (history.length > 200) history.shift()
    baseline = clone(doc)
    renderPanel()
  },
  select(id: string | null) {
    sel = id
    refresh(true)
  },
  add(kind: Kind) {
    const e = newElement(kind, doc.R)
    doc.elements.push(e)
    sel = e.id
    host.settled()
    refresh(true)
  },
  remove(id: string) {
    doc.elements = doc.elements.filter((e) => e.id !== id)
    if (sel === id) sel = null
    host.settled()
    refresh(true)
  },
  exportSvg() {
    const b = build(doc, settings)
    download(`doily-${doc.mirror ? 'D' : 'C'}${doc.n}.svg`, b.svg, 'image/svg+xml')
  },
  saveJson() {
    download('doily.json', JSON.stringify({ doc, settings }, null, 2), 'application/json')
  },
  loadJson() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const parsed = JSON.parse(await f.text()) as { doc?: Doc; settings?: Settings }
        if (parsed.doc) {
          doc = parsed.doc
          for (const e of doc.elements) if (!e.id) e.id = uid()
        }
        if (parsed.settings) settings = { ...settings, ...parsed.settings }
        sel = null
        baseline = clone(doc)
        refresh(true)
      } catch (err) {
        alert(`could not read that file: ${String(err)}`)
      }
    }
    input.click()
  },
  reset() {
    history.push(baseline)
    doc = defaultDoc()
    baseline = clone(doc)
    sel = null
    refresh(true)
  },
  undo() {
    const prev = history.pop()
    if (!prev) return
    doc = prev
    baseline = clone(doc)
    sel = null
    refresh(true)
  },
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ── drawing ──────────────────────────────────────────────────────────────────
enableDrawing(refs, {
  doc: () => doc,
  settings: () => settings,
  commit(pts) {
    const e = newElement('stroke', doc.R)
    if (e.kind === 'stroke') e.pts = pts
    doc.elements.push(e)
    sel = e.id
    host.settled()
    refresh(true)
  },
})

// ── keys ─────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (ev) => {
  const tag = (ev.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' && (ev.target as HTMLInputElement).type !== 'range') return
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault()
    host.undo()
  } else if ((ev.key === 'Backspace' || ev.key === 'Delete') && sel) {
    ev.preventDefault()
    host.remove(sel)
  } else if (ev.key === 'Escape') {
    host.select(null)
  }
})

// Dev handle: lets you inspect the pipeline output from the console without
// round-tripping through a file download.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).doily = {
    build: () => build(doc, settings),
    get doc() {
      return doc
    },
    get settings() {
      return settings
    },
    get analysis() {
      return analysis
    },
  }
}

refresh(true)
