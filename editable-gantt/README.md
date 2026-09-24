# Editable Gantt — Qlik Cloud extension

A beautifully simple, **editable** Gantt chart for Qlik Cloud. Plan a project
and keep the plan current all the way through it — directly on the sheet, with
no data-model plumbing required.

## Install (Qlik Cloud)

1. Zip the `editable-gantt` folder (or use the prebuilt `editable-gantt.zip`).
2. In Qlik Cloud, open the **Management Console → Extensions** and click
   **Add**, then upload the zip.
3. In any app, edit a sheet and drag **Editable Gantt** onto it from
   **Custom objects → Extensions**.

It arrives pre-seeded with a small sample plan so you can feel the
interactions immediately — delete or edit those tasks to start your own plan.

## Two ways to use it

### 1. Managed in chart (default — fully editable)

Tasks are stored inside the chart object itself and edited right on the sheet
(in analysis mode, no edit-sheet needed):

| Action | How |
| --- | --- |
| Reschedule a task | Drag its bar left/right (snaps to days, live date hint) |
| Change duration | Drag the bar's left or right edge |
| Edit details | Click a bar → popover: name, dates, progress, group, color, milestone, dependencies, notes |
| Add a task | **+ Task** in the toolbar, or hover a group row and click its **+** |
| Rename quickly | Double-click the name in the task list |
| Link tasks | Drag the small blue dot at a bar's end onto another bar (loops are blocked) |
| Remove a link | Click the arrow → **Remove link** (or select it and press Delete) |
| Collapse a phase | Click the group row |
| Undo / redo | Toolbar buttons or Ctrl+Z / Ctrl+Y |
| Zoom | Toolbar −/+, **Fit**, **Today**, or Ctrl+mouse-wheel |

Changes persist via the object's properties, so everyone who can see the sheet
sees the current plan. If you lack update rights (e.g. a published app you
can't edit), the chart shows a **Session only** badge and your edits last for
your session without saving.

### 2. From data model (read-only)

Switch **Gantt → Task source** to *From data model* and add:

- **Dimension 1** — Task name (required)
- **Dimension 2** — Group / phase (optional)
- **Measure 1** — Start date (numeric Qlik date, e.g. `Min(StartDate)`)
- **Measure 2** — End date (e.g. `Max(EndDate)`)
- **Measure 3** — Progress, `0–1` or `0–100` (optional)

Bars are read-only; clicking one makes a normal Qlik selection on the task
dimension. Tasks whose start equals end render as milestones.

## Settings (property panel → Gantt)

Row density (comfortable/compact), color by group/task/single, week start day,
today line, weekend shading, dependency arrows, and task-list width.

## Requirements

Qlik Sense 3.0 or newer, on Qlik Cloud or Qlik Sense Enterprise, in a current
browser. Editable Gantt is plain JavaScript with no build step and no external
libraries, so nothing is fetched at runtime and it works on a tenant with no
internet access. Touch and mouse are both supported.

## Development

`../dev-preview/preview.html` is a standalone harness that loads the extension
with a mocked Qlik API — open it in a browser to iterate on look and behavior
without uploading to a tenant.

## Files

- `editable-gantt.qext` — extension metadata
- `editable-gantt.js` — main module (rendering, interactions, persistence)
- `properties.js` — property panel definition
- `style.css` — styles

## Licence

MIT. Use it, change it, ship it.
