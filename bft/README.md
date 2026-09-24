# BFT — Qlik Sense extension

A part-to-whole chart drawn as concentric rings, like the layers of a target.
One dimension gives you a donut. Add more and each becomes a ring, dimension 1
in the centre.

## Two behaviours

**Drilldown (default).** Rings nest as a hierarchy: ring 2 splits each ring-1
segment, ring 3 splits each ring-2 segment, and so on. Clicking an outer segment
selects that value *and* every ancestor value back to the centre, so the
selection always reads as a complete path (for example Region › Country › City).

- *Selects its path* (default): the clicked path replaces any other path, and
  deeper rings are cleared so the selection stays top-down. Clicking a sibling
  under the same parent toggles it, so multi-select within one ring still works.
- *Adds to the current selection*: plain toggle of the clicked value, with any
  missing ancestors selected as well.

**Independent layers.** Every dimension splits the whole measure on its own
ring. Clicking a segment toggles only that value in that field; the other rings
are untouched.

## Install

1. Zip the `bft` folder (or use `bft.zip` next to it).
2. Qlik Cloud: Management Console › Extensions › Add. Qlik Sense Enterprise on
   Windows: QMC › Extensions › Import.
3. Add **BFT** to a sheet with 1–6 dimensions and 1 measure.

## Requirements

Qlik Sense 3.0 or newer, on Qlik Cloud or Qlik Sense Enterprise, in a current
browser. BFT is plain JavaScript with no build step and no external
libraries, so nothing is fetched at runtime and it works on a tenant with no
internet access. Touch and mouse are both supported.

## Data notes

- Data comes from one straight hypercube (all dimensions + the measure). Inner
  rings are sums of the leaf rows, so use an additive measure (Sum, Count).
  Averages and distinct counts will not roll up correctly.
- Up to 25,000 rows are paged in. Null dimension values render as a neutral
  segment that cannot be selected.
- *Hide rings with a single value* (on by default): when selections leave a
  dimension with one value, its ring is removed and the others expand. The
  fixed value stays in the ring key (for example "Region: North America") and
  in tooltip breadcrumbs.
- Segment order defaults to largest first; switch to *Follow sorting settings*
  to use the Sorting panel instead.

## Style

Five vintage palettes (Campfire, Tidewater, Sunbaked, Pine & Ember, National
Park) plus a custom list of hex colours. Paper background, print grain, and the
badge frame can each be switched off; paper and ink colours can be overridden.
In drilldown mode each top-level colour lightens toward the edge so a family of
segments reads as one.

## Wheel of Fortune mode

Switch it on under Rings and the chart becomes a wheel you can spin. Click and
drag anywhere on the rings to turn it; let go while still moving and it keeps
spinning, slowing under friction until it rests against the pointer at the top.
Grab it again to stop it dead.

- A short click still selects a segment. Only a click that follows real drag
  travel is swallowed, so spinning never makes a selection by accident.
- Labels stay right way up as the wheel turns.
- Selections, tooltips and the centre total all work at any angle; the centre
  and the pointer stay put while the rings move.
- The angle is remembered, so a selection elsewhere on the sheet will not
  reset the wheel. Turning the mode off returns it to 12 o'clock.

## Development

`dev-preview/bft-preview.html` loads the extension against mock data with a
fake selection API. Serve the `qlik` folder over HTTP (for example
`python -m http.server 8765 --directory qlik` from the parent folder) and open
`/dev-preview/bft-preview.html`.

## Licence

MIT. Use it, change it, ship it.
