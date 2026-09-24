define([], function () {
  "use strict";

  function isDataMode(p) {
    return p.props && p.props.mode === "data";
  }

  return {
    type: "items",
    component: "accordion",
    items: {
      gantt: {
        type: "items",
        label: "Gantt",
        items: {
          mode: {
            ref: "props.mode",
            label: "Task source",
            type: "string",
            component: "dropdown",
            options: [
              { value: "managed", label: "Managed in chart (editable)" },
              { value: "data", label: "From data model (read-only)" }
            ],
            defaultValue: "managed"
          },
          managedHint: {
            component: "text",
            label:
              "Tasks are stored inside this object and edited directly on the " +
              "sheet: drag bars to reschedule, drag edges to resize, click a " +
              "bar to edit details, drag the blue dot to link tasks.",
            show: function (p) { return !isDataMode(p); }
          },
          dataHint: {
            component: "text",
            label:
              "Expected data: Dimension 1 = Task name, Dimension 2 (optional) " +
              "= Group. Measure 1 = Start date, Measure 2 = End date, " +
              "Measure 3 (optional) = Progress (0–1 or 0–100). " +
              "Dates must be numeric Qlik dates.",
            show: isDataMode
          },
          density: {
            ref: "props.density",
            label: "Row density",
            type: "string",
            component: "dropdown",
            options: [
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" }
            ],
            defaultValue: "comfortable"
          },
          colorMode: {
            ref: "props.colorMode",
            label: "Color tasks",
            type: "string",
            component: "dropdown",
            options: [
              { value: "group", label: "By group" },
              { value: "task", label: "By task" },
              { value: "single", label: "Single color" }
            ],
            defaultValue: "group"
          },
          weekStart: {
            ref: "props.weekStart",
            label: "Week starts on",
            type: "number",
            component: "dropdown",
            options: [
              { value: 1, label: "Monday" },
              { value: 0, label: "Sunday" }
            ],
            defaultValue: 1
          },
          showToday: {
            ref: "props.showToday",
            label: "Today line",
            type: "boolean",
            component: "switch",
            options: [
              { value: true, label: "Show" },
              { value: false, label: "Hide" }
            ],
            defaultValue: true
          },
          shadeWeekends: {
            ref: "props.shadeWeekends",
            label: "Shade weekends",
            type: "boolean",
            component: "switch",
            options: [
              { value: true, label: "On" },
              { value: false, label: "Off" }
            ],
            defaultValue: true
          },
          showLinks: {
            ref: "props.showLinks",
            label: "Dependency arrows",
            type: "boolean",
            component: "switch",
            options: [
              { value: true, label: "Show" },
              { value: false, label: "Hide" }
            ],
            defaultValue: true
          },
          sidebarWidth: {
            ref: "props.sidebarWidth",
            label: "Task list width",
            type: "number",
            component: "slider",
            min: 140,
            max: 380,
            step: 10,
            defaultValue: 230
          }
        }
      },
      dimensions: {
        uses: "dimensions",
        min: 0,
        max: 2
      },
      measures: {
        uses: "measures",
        min: 0,
        max: 3
      },
      sorting: { uses: "sorting" },
      appearance: { uses: "settings" }
    }
  };
});
