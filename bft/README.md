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

## Data notes

- Data comes from one straight hypercube (all dimensions + the measure). Inner
  rings are sums of the leaf rows, so use an additive measure (Sum, Count).
  Averages and distinct counts will not roll up correctly.
- Up to 25,000 rows are paged in. Null dimension values render as a neutral
  segment that cannot be selected.
- Segment order defaults to largest first; switch to *Follow sorting settings*
  to use the Sorting panel instead.

## Style

Five vintage palettes (Campfire, Tidewater, Sunbaked, Pine & Ember, National
Park) plus a custom list of hex colours. Paper background, print grain, and the
badge frame can each be switched off; paper and ink colours can be overridden.
In drilldown mode each top-level colour lightens toward the edge so a family of
segments reads as one.

## Development

`dev-preview/bft-preview.html` loads the extension against mock data with a
fake selection API. Serve the `qlik` folder over HTTP (for example
`python -m http.server 8765 --directory qlik` from the parent folder) and open
`/dev-preview/bft-preview.html`.
