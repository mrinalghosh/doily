# TODO

Things known to be wrong, missing, or deliberately deferred as of the first build.
Nothing here blocks using the tool; the defaults produce a cuttable file.

## Bugs and rough edges

- **`warn` constraints don't warn.** `constraints.innerRadius` and
  `constraints.snap` are tri-state, but only `enforce` does anything to the
  geometry (`src/draw.ts:27`) and only `off` vs. not-`off` changes the guides
  (`src/render.ts:98`). In `warn` you get the guide circle and nothing else — a
  stroke that crosses inside `minInner` is never flagged. Either mark violating
  geometry red, or collapse the control to a two-state toggle.
- **`loadJson` merges settings shallowly.** `src/main.ts:204` does
  `{ ...settings, ...parsed.settings }`, while `loadSettings` merges per section.
  A hand-edited `.json` with a partial `machine` block silently drops the
  defaults for the keys it omits. Both paths should call one merge helper.
- **Folding is pointwise, so boundary crossings cut the corner.** Each raw
  pointer sample is folded independently (`src/draw.ts:30`); two consecutive
  samples on opposite sides of the wedge boundary become a straight chord in
  folded space rather than the reflected path. At `MIN_STEP = 0.25` mm the error
  is small, but a fast stroke across the boundary will show it. Fix: split the
  segment at the crossing before folding.
- **No schema version on the persisted document.** `loadDoc` only checks that
  `n` is a number and `elements` is an array, so any change to the element model
  will happily load a stale `localStorage` doc and produce nonsense. Add a
  version field and a migration (or a clean-slate fallback).
- **`polygonize` uses `max(kerf, 0.05)` as its chord tolerance**
  (`src/export.ts:144`). Kerf is a beam width, not a sagitta — they happen to be
  the same order of magnitude, which is why it looks fine. It should be its own
  setting.

## Undo

- Covers the document only. Settings and machine values aren't undoable.
- No redo (`⇧⌘Z`).
- Undo clears the selection, which is jarring when you're iterating on one
  element's sliders.

## Known limitations (documented, not solved)

- **Cut-group connectivity is a proxy, not a proof.** It samples cut lines and
  unions samples within touching distance. That reliably catches something
  floating free of everything else, but it cannot catch a fully connected cut set
  that still isolates an interior region. The real answer needs a planar
  arrangement of every intersection plus a face-adjacency walk.
- **Kerf is warn-only — there is no kerf compensation on export.** Holes cut
  slightly large and posts slightly thin by half a kerf per side. Compensate by
  hand for now, or implement a proper offset.
- **No cut ordering, travel optimisation, or colour-based layer separation**
  (inner holes before the outer border, etc.). Chaining produces properly closed
  loops, which is the precondition for it, but ordering is currently left to the
  machine software.
- **Analysis sampling doesn't exploit symmetry.** It's O(total cut length), so it
  reaches ~133 ms at n=64. It could analyse one wedge plus its two neighbours and
  multiply. It's debounced off the interaction path, so this is a nicety.
- **`mergeCollinear` is line-only.** Consecutive arcs on the same circle stay
  separate, so a ring exports as two half-arc commands rather than one.

## Missing features

- Elements can't be reordered or duplicated in the panel, and can't be renamed.
- Committed strokes can't be edited — only deleted and redrawn.
- One `localStorage` slot; no named designs.
- No numeric entry beside the sliders, so tuning finer than the slider step means
  editing the JSON.
- No SVG import to seed a wedge from existing artwork.
- **No tests and no CI.** The geometry core — `arc3`, `fold`, the direction
  independent segment canonicalisation in `dedup`, and `chain`'s closure
  preference — is exactly the kind of code that should have unit tests, and it's
  where the two real bugs of the build so far turned up.

## Waiting on machine details

Machine values are generic placeholders: kerf 0.15 mm, min feature 0.6 mm, min
inner radius 8 mm, bed 300 mm. Replace them with the real numbers for the cutter,
and confirm the target software (LightBurn, RDWorks, something else) so the
colour and layer conventions can be set to match rather than guessed.
