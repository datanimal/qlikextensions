define([], function () {
  "use strict";

  function isDrill(p) { return !p.props || p.props.mode !== "independent"; }
  function isCustom(p) { return p.props && p.props.palette === "custom"; }

  return {
    type: "items",
    component: "accordion",
    items: {
      dimensions: { uses: "dimensions", min: 1, max: 6 },
      measures: { uses: "measures", min: 1, max: 1 },
      sorting: { uses: "sorting" },
      addons: { uses: "addons" },

      rings: {
        type: "items",
        label: "Rings",
        items: {
          mode: {
            ref: "props.mode",
            label: "Ring behaviour",
            type: "string",
            component: "dropdown",
            options: [
              { value: "drilldown", label: "Drilldown (nested hierarchy)" },
              { value: "independent", label: "Independent layers" }
            ],
            defaultValue: "drilldown"
          },
          drillHint: {
            component: "text",
            label:
              "Dimension 1 is the inner ring; each further dimension nests " +
              "inside the one before it. Selecting an outer segment also " +
              "selects every value on its path back to the centre.",
            show: isDrill
          },
          indepHint: {
            component: "text",
            label:
              "Every dimension is drawn as its own ring, each splitting the " +
              "whole measure on its own. Selections in one ring do not touch " +
              "the others.",
            show: function (p) { return !isDrill(p); }
          },
          drillSelect: {
            ref: "props.drillSelect",
            label: "Click on a segment",
            type: "string",
            component: "dropdown",
            options: [
              { value: "path", label: "Selects its path (replaces other paths)" },
              { value: "additive", label: "Adds to the current selection" }
            ],
            defaultValue: "path",
            show: isDrill
          },
          segmentOrder: {
            ref: "props.segmentOrder",
            label: "Segment order",
            type: "string",
            component: "dropdown",
            options: [
              { value: "value", label: "Largest first" },
              { value: "source", label: "Follow sorting settings" }
            ],
            defaultValue: "value"
          },
          reverseRings: {
            ref: "props.reverseRings",
            label: "Last dimension in the centre",
            type: "boolean",
            defaultValue: false
          },
          collapseSingles: {
            ref: "props.collapseSingles",
            label: "Hide rings with a single value",
            type: "boolean",
            defaultValue: true
          },
          collapseHint: {
            component: "text",
            label:
              "When selections leave a dimension with one value, its ring is " +
              "removed and the others take the space. The value stays visible " +
              "in the ring key and in tooltips.",
            show: function (p) { return !p.props || p.props.collapseSingles !== false; }
          },
          hole: {
            ref: "props.hole",
            label: "Centre size",
            type: "number",
            component: "slider",
            min: 0,
            max: 0.7,
            step: 0.05,
            defaultValue: 0.3
          },
          ringGap: {
            ref: "props.ringGap",
            label: "Gap between rings (px)",
            type: "number",
            component: "slider",
            min: 0,
            max: 14,
            step: 1,
            defaultValue: 3
          },
          segmentGap: {
            ref: "props.segmentGap",
            label: "Gap between segments (px)",
            type: "number",
            component: "slider",
            min: 0,
            max: 6,
            step: 0.5,
            defaultValue: 2
          }
        }
      },

      labels: {
        type: "items",
        label: "Labels & centre",
        items: {
          showLabels: {
            ref: "props.showLabels",
            label: "Segment labels",
            type: "boolean",
            defaultValue: true
          },
          labelContent: {
            ref: "props.labelContent",
            label: "Label shows",
            type: "string",
            component: "dropdown",
            options: [
              { value: "name", label: "Name" },
              { value: "pct", label: "Name and share of total" },
              { value: "value", label: "Name and value" }
            ],
            defaultValue: "name",
            show: function (p) { return !p.props || p.props.showLabels !== false; }
          },
          showCenter: {
            ref: "props.showCenter",
            label: "Centre medallion",
            type: "boolean",
            defaultValue: true
          },
          centerLabel: {
            ref: "props.centerLabel",
            label: "Centre caption",
            type: "string",
            expression: "optional",
            defaultValue: "",
            show: function (p) { return !p.props || p.props.showCenter !== false; }
          },
          numberFormat: {
            ref: "props.numberFormat",
            label: "Number format",
            type: "string",
            component: "dropdown",
            options: [
              { value: "compact", label: "Compact (1.2M, 45k)" },
              { value: "exact", label: "Exact" }
            ],
            defaultValue: "compact"
          },
          showLegend: {
            ref: "props.showLegend",
            label: "Legend and ring key",
            type: "boolean",
            defaultValue: true
          }
        }
      },

      colors: {
        type: "items",
        label: "Colours & style",
        items: {
          palette: {
            ref: "props.palette",
            label: "Palette",
            type: "string",
            component: "dropdown",
            options: [
              { value: "campfire", label: "Campfire" },
              { value: "tidewater", label: "Tidewater" },
              { value: "sunbaked", label: "Sunbaked" },
              { value: "pine", label: "Pine & Ember" },
              { value: "park", label: "National Park" },
              { value: "custom", label: "Custom" }
            ],
            defaultValue: "campfire"
          },
          customColors: {
            ref: "props.customColors",
            label: "Custom colours (hex, comma separated)",
            type: "string",
            expression: "optional",
            defaultValue: "#D9713A, #2D5A62, #E2B34C, #973A2B, #4E7A5A, #2A3550",
            show: isCustom
          },
          shading: {
            ref: "props.shading",
            label: "Outer rings",
            type: "string",
            component: "dropdown",
            options: [
              { value: "tint", label: "Lighten toward the edge" },
              { value: "flat", label: "Flat colours" }
            ],
            defaultValue: "tint"
          },
          paper: {
            ref: "props.paper",
            label: "Paper background",
            type: "boolean",
            defaultValue: true
          },
          grain: {
            ref: "props.grain",
            label: "Print grain",
            type: "boolean",
            defaultValue: true
          },
          frame: {
            ref: "props.frame",
            label: "Badge frame",
            type: "boolean",
            defaultValue: true
          },
          paperColor: {
            ref: "props.paperColor",
            label: "Paper colour (hex, blank = palette default)",
            type: "string",
            expression: "optional",
            defaultValue: ""
          },
          inkColor: {
            ref: "props.inkColor",
            label: "Ink colour (hex, blank = palette default)",
            type: "string",
            expression: "optional",
            defaultValue: ""
          }
        }
      },

      settings: { uses: "settings" }
    }
  };
});
