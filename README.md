# Qlik Sense extensions

Visualization extensions for Qlik Sense / Qlik Cloud by Benjamin Rode (MIT).

| Extension | Folder | Upload |
|---|---|---|
| Bullseye Rings — concentric part-to-whole rings with drilldown or independent layers | `bullseye/` | `bullseye.zip` |
| Editable Gantt — editable project timeline on the sheet | `editable-gantt/` | `editable-gantt.zip` |

Each folder is a complete extension (`.qext`, `.js`, `properties.js`, `style.css`, `README.md`).
Upload the matching zip in the Qlik Management Console under Extensions.

`dev-preview/` holds standalone HTML harnesses that run each extension against
mock data. Serve this folder over HTTP, for example
`python -m http.server 8765`, then open `http://localhost:8765/dev-preview/`.
