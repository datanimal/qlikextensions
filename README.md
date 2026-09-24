# Qlik Sense extensions

Three visualization extensions for Qlik Sense and Qlik Cloud, written in plain
JavaScript with no build step and no external libraries. Each one is a complete,
self-contained extension you can upload and use as-is.

By Benjamin Rode. MIT licensed, so you are free to use, modify and ship these in
your own projects.

## What's here

| Extension | What it does | Download |
|---|---|---|
| **[Sunburst](sunburst/)** | Part-to-whole rings, one per dimension. Nest them as a hierarchy, where clicking an outer segment selects its whole path, or run each as an independent layer. Styled to match Qlik's native charts. | [`sunburst.zip`](sunburst.zip) |
| **[BFT](bft/)** | The same ring chart with vintage, screen-printed styling: warm paper, print grain, badge frame, and five hand-picked palettes. | [`bft.zip`](bft.zip) |
| **[Editable Gantt](editable-gantt/)** | A project timeline you edit directly on the sheet. Drag bars to reschedule, drag edges to resize, link dependencies, track progress. | [`editable-gantt.zip`](editable-gantt.zip) |

Each folder holds the full source and its own README with the complete option
list. Click an extension name above for its documentation.

## Install

1. Download the zip for the extension you want, linked in the table above.
2. **Qlik Cloud:** Management Console, then Extensions, then Add.
   **Qlik Sense Enterprise on Windows:** QMC, then Extensions, then Import.
3. Edit a sheet in any app and drag the extension onto it from the Custom
   objects panel.

No server-side configuration, licence key or internet access is needed at
runtime. The extensions require Qlik Sense 3.0 or newer and a current browser.

## Using the ring charts

Sunburst and BFT both take **one regular dimension per ring** and a single
measure.

- Add each level of your hierarchy as its own dimension. A Qlik *drill-down*
  master dimension only exposes one level at a time, so it produces a single
  ring. Both charts display a note on the object when they detect one.
- Inner rings are sums of the rows beneath them, so use an additive measure such
  as `Sum()` or `Count()`. Averages and distinct counts will not roll up
  correctly.

## Developing

`dev-preview/` holds standalone HTML harnesses that run each extension against
mock data with a stubbed selection API, so you can work on them without a Qlik
server. See [`dev-preview/README.md`](dev-preview/README.md).

After changing an extension, rebuild its zip from the extension folder so the
download stays in step with the source.
