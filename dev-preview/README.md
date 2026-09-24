# Dev previews

Standalone harnesses that run each extension in a plain browser, with no Qlik
server involved. Useful for working on layout, styling and interaction quickly.

| File | Runs |
|---|---|
| `sunburst-preview.html` | the Sunburst ring chart |
| `bft-preview.html` | the BFT ring chart |
| `preview.html` | the Editable Gantt chart |

## Running them

The pages load the extension's real source over relative paths, so they must be
served over HTTP. Opening the file directly with a `file://` URL will not work.

From the repository root:

```
python -m http.server 8765
```

Then open `http://localhost:8765/dev-preview/sunburst-preview.html`.

Any static file server will do. Nothing is compiled, so a browser refresh picks
up your edits immediately.

## What the harness fakes

Each page supplies the small amount of Qlik the extension actually touches:

- **A tiny AMD shim** standing in for RequireJS, which resolves the extension's
  `define()` dependencies and hands it the stylesheet as a string.
- **A mock hypercube** built from sample sales data by region, country, city and
  channel, shaped exactly like `qHyperCube` with `qMatrix`, `qElemNumber` and
  per-cell selection states.
- **A stubbed `backendApi.selectValues`** that records each call, updates the
  mock selection state and repaints, so selection behaviour can be exercised
  end to end. Calls are logged in the corner of the page.

The toolbar along the top toggles the extension's options live, including the
number of dimensions, so you can see how the chart behaves as rings are added
and removed. "Confirm selections" applies the pending selection the way Qlik
does when you accept it, which is what makes single-value rings collapse.

Because the selection API is a stand-in, treat the harness as a fast way to
check rendering and interaction, not as proof that Qlik's engine will behave
identically. Verify selection changes in a real app before shipping.
