# Qlik Sense extensions

Visualization extensions for Qlik Sense / Qlik Cloud by Benjamin Rode (MIT).

| Extension | Folder | Upload | Look |
|---|---|---|---|
| Sunburst — concentric part-to-whole rings with drilldown or independent layers | `sunburst/` | `sunburst.zip` | Plain, matches Qlik's native charts |
| BFT — the same ring chart, vintage badge styling (paper, grain, frame, custom palettes) | `bft/` | `bft.zip` | Decorative |
| Editable Gantt — editable project timeline on the sheet | `editable-gantt/` | `editable-gantt.zip` | Plain |

Each folder is a complete extension (`.qext`, `.js`, `properties.js`, `style.css`, `README.md`).
Upload the matching zip in the Qlik Management Console under Extensions.

Sunburst and BFT expect one regular dimension per ring. A Qlik drill-down master
dimension exposes one level at a time, so it yields a single ring; both charts
show a note when they detect one.

`dev-preview/` holds standalone HTML harnesses that run each extension against
mock data. Serve this folder over HTTP, for example
`python -m http.server 8765`, then open `http://localhost:8765/dev-preview/`.
