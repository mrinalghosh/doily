# doily

Generate rotationally symmetric SVGs for laser cutting. Draw or parameterise one
wedge; the tool replicates it, checks it against your machine, and exports hairline
vector paths in real millimetres.

```
npm install
npm run dev
```

## How it works

Everything is authored inside the **fundamental domain** — one angular sector
containing no redundancy. For `C_n` that sector is `360/n` wide; with the mirror on
(`D_n`) it halves to `180/n`. The full doily is that one sector plus a list of
symmetry transforms.

That is the whole performance story. The canvas holds one copy of the geometry in
`<defs>` and *n* `<use>` clones pointing at it, so cost is O(n) DOM nodes rather
than O(n × points). Six full re-renders sweeping `n` from 6 to 64 measure ~3.7 ms
total. An in-progress freehand stroke mutates one path's `d` attribute directly and
every clone follows for free — no canvas, no workers, no frame budget games.

Angle 0 is the mirror axis (the centre line of a wedge); `domainAngle` is the wedge
boundary. Drawing anywhere on the canvas *folds* into the domain rather than
clamping to it, so a stroke that crosses the boundary reflects instead of
distorting.

## The document

An ordered list of elements, each either a parametric primitive with sliders or a
freehand polyline, all in domain coordinates:

| element | parameters |
| --- | --- |
| `ring` | radius — already rotationally symmetric, so emitted once, not replicated |
| `spoke` | angle, inner r, outer r |
| `petal` | angle, inner r, outer r, bulge — two arcs forming a lens |
| `scallop` | radius, depth — the border; one exact circular arc per bump |
| `hole` | at radius, angle, hole r |
| `stroke` | freehand, RDP-simplified on commit |

## Toggles

The document is always the source of truth. Analysis only reads it; export stages
run on a throwaway copy at emit time. So every toggle is free, reversible, and can
never be accidentally baked in.

**Analysis** — non-destructive overlays.

- *thin features* — samples the geometry and marks gaps narrower than the minimum
  feature size. Junctions are detected first and used to suppress candidates near
  them, so a spoke landing on a ring is not reported as a sliver.
- *cut-line groups* — a proxy, not a proof. Genuinely answering "will the part stay
  in one piece?" needs a planar arrangement of every intersection and a
  face-adjacency walk. This samples the cut lines and unions samples within touching
  distance, which reliably catches a ring or stroke floating free of everything
  else, but will not catch cuts that are all connected yet still isolate an interior
  region. It reports *free loops* (single closed loops touching nothing — holes by
  design, or floaters by mistake) separately from *structural* groups; more than one
  structural group means part of the design is not attached to the rest.
- *centre convergence* — all *n* wedges meet at the origin, so anything drawn near
  `r = 0` gets cut *n* times in a few square millimetres.

**Export pipeline** — ordered stages, each reporting what it did.

1. *replicate / flatten* — bakes transforms into absolute coordinates. Turning it
   off emits `<use>` clones instead: ~6× smaller and editable in Inkscape, but some
   importers silently drop them. Clone mode emits both `href` and `xlink:href`.
2. *dedup coincident* — under `D_n` any element touching a mirror axis produces an
   exactly overlapping twin, which the laser would cut twice. Reversing an arc swaps
   its endpoints and flips its sweep flag, so the canonical form accounts for both.
   Requires flatten, and reports as blocked without it.
3. *chain* — always on. Re-chains loose segments, preferring loop closure and then
   tangent continuity. Authored closed shapes stay closed by construction. Greedy
   chaining is geometrically correct but semantically scrambled: the border dives
   down a spoke and ends up halfway round an inner ring, leaving nothing closed.
4. *polygonise arcs* — off by default. Rotation maps arcs to arcs (rotate the
   endpoints and the centre; the flags are untouched), so transforms flatten without
   ever polygonising, and a true arc cuts smoother than 200 line segments.
5. *simplify* — RDP over runs of line commands. 0 means off.
6. *merge collinear*.

**Authoring constraints** are tri-state `off / warn / enforce`, because "clamp my
stroke to r ≥ 8 mm while I draw" and "let me draw anywhere but colour it red" are
both useful on different days.

## Output

`width`/`height` in `mm` with a matching `viewBox`, so 1 user unit = 1 mm — without
explicit physical units some importers assume 96 dpi and a 200 mm doily arrives at
53 mm. `stroke-width="0.01"` (= 0.01 mm) with `fill="none"`. Cut colour is black;
LightBurn and RDWorks map stroke *colour* to layers and largely ignore stroke width,
so colour is the more portable way to distinguish operations.

The document and settings are embedded in an SVG comment, so a re-export is
reproducible and you can tell from the file which toggles produced it.

Machine values (kerf, min feature, min inner radius, bed) are generic defaults and
only drive the checks — changing them never changes geometry.

## Keys

`⌘Z` undo · `Delete` remove selected · `Esc` deselect · drag on canvas to draw
