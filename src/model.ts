import type { Pt } from './geom/core'

export type Mode = 'off' | 'warn' | 'enforce'

export type Element =
  | { id: string; kind: 'ring'; on: boolean; r: number }
  | { id: string; kind: 'spoke'; on: boolean; a: number; r0: number; r1: number }
  | { id: string; kind: 'petal'; on: boolean; a: number; r0: number; r1: number; bulge: number }
  | { id: string; kind: 'scallop'; on: boolean; r: number; depth: number }
  | { id: string; kind: 'hole'; on: boolean; r: number; a: number; rh: number }
  | { id: string; kind: 'stroke'; on: boolean; pts: Pt[] }

export type Kind = Element['kind']

export type Doc = {
  n: number
  mirror: boolean
  R: number
  elements: Element[]
}

export type Settings = {
  machine: { kerf: number; minFeature: number; minInner: number; bed: number }
  /** Non-destructive overlays. These only ever read the document. */
  analysis: { thin: boolean; groups: boolean; center: boolean }
  /** Ordered export stages, each run on a throwaway copy at emit time. */
  ex: {
    flatten: boolean
    dedup: boolean
    mergeCollinear: boolean
    polygonize: boolean
    rdpTol: number
  }
  /** Authoring constraints — tri-state, because "clamp me" and "just warn me" are
   *  both things you want on different days. */
  constraints: { innerRadius: Mode; snap: Mode }
  guides: { rings: number; radials: number; show: boolean }
}

let seq = 0
export const uid = () => `e${(seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Rings are already rotationally symmetric, so they are emitted once rather than
 *  replicated — n coincident circles is exactly the overcut problem we warn about. */
export const isGlobal = (e: Element) => e.kind === 'ring'

export const defaultSettings = (): Settings => ({
  machine: { kerf: 0.15, minFeature: 0.6, minInner: 8, bed: 300 },
  analysis: { thin: true, groups: true, center: true },
  ex: { flatten: true, dedup: true, mergeCollinear: true, polygonize: false, rdpTol: 0.05 },
  constraints: { innerRadius: 'warn', snap: 'off' },
  guides: { rings: 6, radials: 3, show: true },
})

export const defaultDoc = (): Doc => ({
  n: 12,
  mirror: true,
  R: 90,
  elements: [
    { id: uid(), kind: 'scallop', on: true, r: 88, depth: 9 },
    // Ties the scalloped border to ring 70. Without it the border falls away as a
    // separate piece — exactly what the cut-group check is there to catch.
    { id: uid(), kind: 'spoke', on: true, a: 0, r0: 70, r1: 88 },
    { id: uid(), kind: 'hole', on: true, r: 78, a: 7.5, rh: 2.5 },
    { id: uid(), kind: 'ring', on: true, r: 70 },
    // r1 lands exactly on ring 70 so the central rosette is tied to the border.
    { id: uid(), kind: 'petal', on: true, a: 0, r0: 34, r1: 70, bulge: 8 },
    { id: uid(), kind: 'spoke', on: true, a: 0, r0: 24, r1: 34 },
    { id: uid(), kind: 'ring', on: true, r: 24 },
  ],
})

/** Defaults for a freshly added element, scaled to the current disc. */
export function newElement(kind: Kind, R: number): Element {
  const id = uid()
  switch (kind) {
    case 'ring':
      return { id, kind, on: true, r: +(R * 0.5).toFixed(1) }
    case 'spoke':
      return { id, kind, on: true, a: 0, r0: +(R * 0.3).toFixed(1), r1: +(R * 0.5).toFixed(1) }
    case 'petal':
      return {
        id,
        kind,
        on: true,
        a: 0,
        r0: +(R * 0.35).toFixed(1),
        r1: +(R * 0.7).toFixed(1),
        bulge: +(R * 0.08).toFixed(1),
      }
    case 'scallop':
      return { id, kind, on: true, r: +(R * 0.95).toFixed(1), depth: +(R * 0.1).toFixed(1) }
    case 'hole':
      return { id, kind, on: true, r: +(R * 0.6).toFixed(1), a: 0, rh: +(R * 0.04).toFixed(1) }
    case 'stroke':
      return { id, kind, on: true, pts: [] }
  }
}

/** Slider spec per primitive — the parameter UI is generated from this. */
export const PARAMS: Record<Kind, { key: string; label: string; min: number; max: (R: number, dom: number) => number; step: number }[]> = {
  ring: [{ key: 'r', label: 'radius', min: 0, max: (R) => R, step: 0.5 }],
  spoke: [
    { key: 'a', label: 'angle', min: 0, max: (_R, d) => d, step: 0.25 },
    { key: 'r0', label: 'inner r', min: 0, max: (R) => R, step: 0.5 },
    { key: 'r1', label: 'outer r', min: 0, max: (R) => R, step: 0.5 },
  ],
  petal: [
    { key: 'a', label: 'angle', min: 0, max: (_R, d) => d, step: 0.25 },
    { key: 'r0', label: 'inner r', min: 0, max: (R) => R, step: 0.5 },
    { key: 'r1', label: 'outer r', min: 0, max: (R) => R, step: 0.5 },
    { key: 'bulge', label: 'bulge', min: 0.2, max: (R) => R / 3, step: 0.25 },
  ],
  scallop: [
    { key: 'r', label: 'radius', min: 0, max: (R) => R, step: 0.5 },
    { key: 'depth', label: 'depth', min: 0.5, max: (R) => R / 2, step: 0.25 },
  ],
  hole: [
    { key: 'r', label: 'at radius', min: 0, max: (R) => R, step: 0.5 },
    { key: 'a', label: 'angle', min: 0, max: (_R, d) => d, step: 0.25 },
    { key: 'rh', label: 'hole r', min: 0.2, max: (R) => R / 4, step: 0.1 },
  ],
  stroke: [],
}

export function describe(e: Element): string {
  switch (e.kind) {
    case 'ring':
      return `r ${e.r}`
    case 'spoke':
      return `${e.a}° ${e.r0}–${e.r1}`
    case 'petal':
      return `${e.a}° ${e.r0}–${e.r1} b${e.bulge}`
    case 'scallop':
      return `r ${e.r} d${e.depth}`
    case 'hole':
      return `r ${e.r} ${e.a}° ø${(e.rh * 2).toFixed(1)}`
    case 'stroke':
      return `${e.pts.length} pts`
  }
}
