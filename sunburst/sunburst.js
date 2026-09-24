/* ============================================================
 * Sunburst — a Qlik Sense visualization extension (plain, Qlik-native styling)
 *
 * A part-to-whole chart drawn as concentric rings, one ring per
 * dimension (dimension 1 innermost, like the layers of a target).
 *
 * Two behaviours:
 *  - "drilldown":   rings nest as a hierarchy (a sunburst). Clicking an
 *                   outer segment selects the segment AND every ancestor
 *                   value on its path back to the centre.
 *  - "independent": every dimension splits the whole measure on its own
 *                   ring. Rings are selected independently.
 *
 * Data comes from a single straight hypercube (all dimensions + one
 * measure). Ring values are sums of the leaf rows, so the measure should
 * be additive (Sum, Count) for the inner rings to be meaningful.
 * ============================================================ */
define(["qlik", "text!./style.css", "./properties"], function (qlik, css, properties) {
  "use strict";

  /* ---------- one-time style injection ---------- */
  if (!document.getElementById("sb-style")) {
    var styleTag = document.createElement("style");
    styleTag.id = "sb-style";
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  var TAU = Math.PI * 2;
  var MAX_ROWS = 25000;
  var NULL_KEY = "__null__";

  /* ================= palettes =================
   * Qlik Sense's standard "12 colours" first; a colour-blind-safe set and a
   * softer set as alternatives.
   */
  var PALETTES = {
    qlik12: {
      colors: ["#332288", "#6699CC", "#88CCEE", "#44AA99", "#117733", "#999933",
        "#DDCC77", "#661100", "#CC6677", "#AA4466", "#882255", "#AA4499"]
    },
    safe: {
      colors: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"]
    },
    soft: {
      colors: ["#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2", "#EECA3B",
        "#B279A2", "#FF9DA6", "#9D755D", "#BAB0AC"]
    }
  };
  var INK = "#404040";      /* Qlik Sense body text */
  var MUTED = "#595959";
  var WHITE = "#FFFFFF";

  var DEFAULTS = {
    mode: "drilldown",
    drillSelect: "path",
    segmentOrder: "value",
    reverseRings: false,
    collapseSingles: true,
    spin: false,
    hole: 0.35,
    ringGap: 2,
    segmentGap: 1,
    showLabels: true,
    labelContent: "name",
    showCenter: true,
    centerLabel: "",
    numberFormat: "compact",
    showLegend: true,
    palette: "qlik12",
    customColors: "",
    shading: "tint"
  };

  /* ================= small utilities ================= */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function f2(v) { return Math.round(v * 100) / 100; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hexToRgb(h) {
    h = String(h || "").trim().replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    return "#" + c.map(function (v) {
      v = clamp(Math.round(v), 0, 255);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function mix(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    if (!A || !B) return a;
    return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  }
  function luminance(h) {
    var c = hexToRgb(h);
    if (!c) return 0;
    var lin = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  }
  function parseColorList(s) {
    return String(s || "").split(/[,;\s]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return hexToRgb(x); })
      .map(function (x) { return x[0] === "#" ? x : "#" + x; });
  }
  function trimZeros(s) { return s.indexOf(".") < 0 ? s : s.replace(/\.?0+$/, ""); }
  function fmtNumber(v, mode, dec) {
    if (typeof v !== "number" || !isFinite(v)) return "-";
    if (mode === "exact") {
      try { return v.toLocaleString(undefined, { maximumFractionDigits: dec }); }
      catch (e) { return String(Math.round(v * 100) / 100); }
    }
    var a = Math.abs(v);
    var units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]];
    for (var i = 0; i < units.length; i++) {
      if (a >= units[i][0]) {
        var x = v / units[i][0], ax = Math.abs(x);
        return trimZeros(x.toFixed(ax < 10 ? 2 : ax < 100 ? 1 : 0)) + units[i][1];
      }
    }
    if (a >= 100) return String(Math.round(v));
    if (a >= 10) return trimZeros(v.toFixed(1));
    return trimZeros(v.toFixed(2));
  }
  function fmtPct(p) {
    if (!isFinite(p)) return "-";
    var x = p * 100;
    return trimZeros(x.toFixed(x >= 10 ? 0 : x >= 1 ? 1 : 2)) + "%";
  }
  function fitText(str, maxW, fs, charW) {
    str = String(str == null ? "" : str);
    var cw = fs * (charW || 0.55);
    var maxChars = Math.floor(maxW / cw + 1e-6);
    if (str.length <= maxChars) return str;
    if (maxChars < 3) return "";
    return str.slice(0, maxChars - 1).replace(/\s+$/, "") + "…";
  }
  function inEditMode() {
    try {
      return !!(qlik && qlik.navigation && qlik.navigation.getMode &&
        qlik.navigation.getMode() === "edit");
    } catch (e) { return false; }
  }

  /* ================= options & theme ================= */
  function getOpts(layout) {
    var p = layout.props || {}, o = {}, k;
    for (k in DEFAULTS) {
      o[k] = (p[k] === undefined || p[k] === null) ? DEFAULTS[k] : p[k];
    }
    o.hole = clamp(+o.hole || 0, 0, 0.7);
    o.ringGap = clamp(+o.ringGap || 0, 0, 20);
    o.segmentGap = clamp(+o.segmentGap || 0, 0, 8);
    return o;
  }
  function resolveTheme(o) {
    var base = PALETTES[o.palette] || PALETTES.qlik12;
    var colors = base.colors;
    if (o.palette === "custom") {
      var c = parseColorList(o.customColors);
      if (c.length) colors = c;
    }
    /* paper = the colour between segments, tint = what outer rings lighten toward */
    return { colors: colors, paper: WHITE, ink: INK, muted: MUTED, tint: WHITE };
  }

  /* ================= data fetching (page through the cube) ================= */
  function fetchAll(self, layout) {
    var hc = layout.qHyperCube;
    var rows = [];
    (hc.qDataPages || []).forEach(function (p) {
      if (p && p.qArea && p.qArea.qTop === rows.length) rows = rows.concat(p.qMatrix || []);
    });
    var width = hc.qSize ? hc.qSize.qcx : 0;
    var total = Math.min(hc.qSize ? hc.qSize.qcy : rows.length, MAX_ROWS);
    var api = self && self.backendApi;
    if (!width || rows.length >= total || !api || !api.getData) return Promise.resolve(rows);
    var pageH = Math.max(1, Math.floor(10000 / width));
    function next() {
      if (rows.length >= total) return rows;
      var h = Math.min(pageH, total - rows.length);
      return Promise.resolve(api.getData([{ qTop: rows.length, qLeft: 0, qWidth: width, qHeight: h }]))
        .then(function (pages) {
          var m = pages && pages[0] && pages[0].qMatrix;
          if (!m || !m.length) return rows;
          rows = rows.concat(m);
          return next();
        });
    }
    return Promise.resolve().then(next);
  }

  /* ================= model ================= */
  function buildModel(layout, rows, o) {
    var hc = layout.qHyperCube;
    var dimInfo = hc.qDimensionInfo || [];
    var nDims = dimInfo.length;
    var measInfo = (hc.qMeasureInfo || [])[0] || {};
    var model = {
      mode: o.mode === "independent" ? "independent" : "drilldown",
      nDims: nDims,
      dims: dimInfo.map(function (d) { return d.qFallbackTitle || ""; }),
      measureTitle: measInfo.qFallbackTitle || "",
      decimals: (measInfo.qNumFormat && typeof measInfo.qNumFormat.qnDec === "number") ? clamp(measInfo.qNumFormat.qnDec, 0, 10) : 2,
      nodes: [],
      byId: {},
      rings: [],
      root: { id: "root", depth: 0, children: [], map: {}, value: 0, weight: 0, name: "Total" },
      total: 0
    };
    var idc = 0;
    function mk(cell, d, parent) {
      var isNull = !cell || cell.qElemNumber < 0 || cell.qIsNull;
      var n = {
        id: "n" + (idc++),
        name: cell && cell.qText != null && cell.qText !== "" ? cell.qText : "-",
        elem: cell ? cell.qElemNumber : -2,
        selectable: !isNull,
        isNull: isNull,
        dim: d, depth: d + 1, parent: parent,
        children: [], map: {}, value: 0, weight: 0,
        state: cell && cell.qState ? cell.qState : "O"
      };
      model.nodes.push(n);
      model.byId[n.id] = n;
      return n;
    }
    function keyOf(cell) {
      return (!cell || cell.qElemNumber < 0) ? NULL_KEY : String(cell.qElemNumber);
    }
    for (var d = 0; d < nDims; d++) {
      model.rings.push({ dim: d, children: [], map: {}, value: 0, weight: 0 });
    }
    var root = model.root;
    rows.forEach(function (row) {
      var mc = row[nDims];
      var v = mc && typeof mc.qNum === "number" && isFinite(mc.qNum) ? mc.qNum : 0;
      var w = Math.max(0, v);
      root.value += v; root.weight += w;
      var node, cell, key, child, i;
      if (model.mode === "drilldown") {
        node = root;
        for (i = 0; i < nDims; i++) {
          cell = row[i]; key = keyOf(cell);
          child = node.map[key];
          if (!child) { child = mk(cell, i, node); node.map[key] = child; node.children.push(child); }
          child.value += v; child.weight += w;
          if (cell && cell.qState === "S") child.state = "S";
          else if (cell && cell.qState === "X" && child.state !== "S") child.state = "X";
          node = child;
        }
      } else {
        for (i = 0; i < nDims; i++) {
          cell = row[i]; key = keyOf(cell);
          var ring = model.rings[i];
          child = ring.map[key];
          if (!child) { child = mk(cell, i, null); ring.map[key] = child; ring.children.push(child); }
          child.value += v; child.weight += w;
          ring.value += v; ring.weight += w;
          if (cell && cell.qState === "S") child.state = "S";
          else if (cell && cell.qState === "X" && child.state !== "S") child.state = "X";
        }
      }
    });
    model.total = root.value;

    /* ordering + sibling index */
    var byValue = o.segmentOrder !== "source";
    function order(list) {
      if (byValue) {
        list.sort(function (a, b) {
          if (a.isNull !== b.isNull) return a.isNull ? 1 : -1;
          return b.weight - a.weight;
        });
      }
      list.forEach(function (c, i) { c.index = i; c.siblings = list.length; });
    }
    if (model.mode === "drilldown") {
      (function rec(n) { order(n.children); n.children.forEach(rec); })(root);
    } else {
      model.rings.forEach(function (r) { order(r.children); });
    }
    /* A dimension left with a single value carries no information; hide its
     * ring (optionally) and let the others take the space. */
    var distinct = [], k;
    for (k = 0; k < nDims; k++) distinct.push({});
    model.nodes.forEach(function (nd) { distinct[nd.dim][nd.isNull ? NULL_KEY : nd.elem] = true; });
    model.collapsed = []; model.visibleDims = []; model.ringOf = {}; model.collapsedValue = [];
    for (k = 0; k < nDims; k++) {
      var one = !!o.collapseSingles && Object.keys(distinct[k]).length === 1;
      model.collapsed.push(one);
      if (!one) model.visibleDims.push(k);
    }
    if (!model.visibleDims.length && nDims) { model.collapsed[nDims - 1] = false; model.visibleDims.push(nDims - 1); }
    model.visibleDims.forEach(function (dim, i) { model.ringOf[dim] = i; });
    model.nodes.forEach(function (nd) { nd.hidden = model.collapsed[nd.dim]; });
    for (k = 0; k < nDims; k++) {
      var val = null;
      if (model.collapsed[k]) {
        for (var j = 0; j < model.nodes.length; j++) if (model.nodes[j].dim === k) { val = model.nodes[j].name; break; }
      }
      model.collapsedValue.push(val);
    }
    return model;
  }

  /* nodes on the innermost ring that is actually drawn */
  function firstVisibleLevel(model) {
    var lvl = [model.root], d = 0;
    while (d < model.nDims && model.collapsed[d]) {
      lvl = lvl.reduce(function (acc, t) { return acc.concat(t.children); }, []);
      d++;
    }
    return lvl.reduce(function (acc, t) { return acc.concat(t.children); }, []);
  }

  /* ================= colours ================= */
  function assignColors(model, o, theme) {
    var pal = theme.colors, n = pal.length;
    var nullColor = mix(theme.ink, theme.paper, 0.78);
    model.nodes.forEach(function (nd) { nd.color = pal[0]; });
    if (model.mode === "drilldown") {
      firstVisibleLevel(model).forEach(function (top) {
        var base = pal[top.index % n];
        (function rec(node, depthFromTop) {
          if (node.isNull) node.color = nullColor;
          else if (o.shading === "flat" || depthFromTop === 0) node.color = base;
          else {
            var sib = node.siblings > 1 ? node.index / (node.siblings - 1) : 0.3;
            var t = clamp(0.12 * depthFromTop + 0.30 * sib, 0, 0.66);
            node.color = mix(base, theme.tint, t);
          }
          node.children.forEach(function (c) { rec(c, depthFromTop + 1); });
        })(top, 0);
      });
    } else {
      model.rings.forEach(function (ring, d) {
        ring.children.forEach(function (c) {
          if (c.isNull) { c.color = nullColor; return; }
          var base = pal[(c.index + d * 3) % n];
          c.color = o.shading === "flat" ? base : mix(base, theme.tint, clamp(d * 0.09, 0, 0.45));
        });
      });
    }
  }

  /* ================= geometry ================= */
  function pt(cx, cy, r, a) { return f2(cx + r * Math.sin(a)) + "," + f2(cy - r * Math.cos(a)); }
  function arcPath(cx, cy, r0, r1, a0, a1) {
    var span = a1 - a0;
    if (span <= 0) return "";
    r1 = f2(r1); r0 = f2(r0);
    var d;
    if (span >= TAU - 1e-5) {
      d = "M" + f2(cx) + "," + f2(cy - r1) +
        " A" + r1 + "," + r1 + " 0 1 1 " + f2(cx) + "," + f2(cy + r1) +
        " A" + r1 + "," + r1 + " 0 1 1 " + f2(cx) + "," + f2(cy - r1) + " Z";
      if (r0 > 0.5) {
        d += " M" + f2(cx) + "," + f2(cy - r0) +
          " A" + r0 + "," + r0 + " 0 1 0 " + f2(cx) + "," + f2(cy + r0) +
          " A" + r0 + "," + r0 + " 0 1 0 " + f2(cx) + "," + f2(cy - r0) + " Z";
      }
      return d;
    }
    var large = span > Math.PI ? 1 : 0;
    d = "M" + pt(cx, cy, r1, a0) + " A" + r1 + "," + r1 + " 0 " + large + " 1 " + pt(cx, cy, r1, a1);
    if (r0 > 0.5) {
      d += " L" + pt(cx, cy, r0, a1) + " A" + r0 + "," + r0 + " 0 " + large + " 0 " + pt(cx, cy, r0, a0) + " Z";
    } else {
      d += " L" + f2(cx) + "," + f2(cy) + " Z";
    }
    return d;
  }

  function computeGeometry(W, H, nDims, o) {
    var pad = 6;
    var R = Math.max(10, Math.min(W, H) / 2 - pad);
    var hole = R * o.hole;
    if (o.showCenter && hole < 22 && R > 80) hole = 22;
    var gap = o.ringGap;
    var band = (R - hole - gap * (nDims - 1)) / nDims;
    if (band < 4) { gap = 0; band = (R - hole) / nDims; }
    return { cx: W / 2, cy: H / 2, R: R, hole: hole, gap: gap, band: band, n: nDims };
  }

  function ringRadii(geom, ringIdx) {
    var r0 = geom.hole + ringIdx * (geom.band + geom.gap);
    return [r0, r0 + geom.band];
  }

  function layoutModel(model, geom, o) {
    var n = model.visibleDims.length;
    function ringIndexFor(dim) { var i = model.ringOf[dim]; return o.reverseRings ? n - 1 - i : i; }
    if (model.mode === "drilldown") {
      (function rec(node, a0, a1) {
        var span = a1 - a0, acc = a0, W = node.weight, k = node.children.length;
        node.children.forEach(function (c) {
          var s = W > 0 ? span * c.weight / W : span / k;
          c.a0 = acc; c.a1 = acc + s; acc += s;
          var rr = c.hidden ? [0, 0] : ringRadii(geom, ringIndexFor(c.dim));
          c.r0 = rr[0]; c.r1 = rr[1];
          rec(c, c.a0, c.a1);
        });
      })(model.root, 0, TAU);
    } else {
      model.rings.forEach(function (ring) {
        var acc = 0, W = ring.weight, k = ring.children.length;
        var rr = model.collapsed[ring.dim] ? [0, 0] : ringRadii(geom, ringIndexFor(ring.dim));
        ring.children.forEach(function (c) {
          var s = W > 0 ? TAU * c.weight / W : TAU / k;
          c.a0 = acc; c.a1 = acc + s; acc += s;
          c.r0 = rr[0]; c.r1 = rr[1];
        });
      });
    }
  }

  /* ================= SVG building ================= */
  function labelSvg(n, model, o, theme, geom) {
    if (n.hidden) return "";
    var span = n.a1 - n.a0;
    if (span <= 0) return "";
    var band = n.r1 - n.r0, rMid = (n.r0 + n.r1) / 2;
    var fs = clamp(band * 0.36, 8, 14);
    if (band < fs + 6) return "";
    var arcLen = span * rMid;
    var am = (n.a0 + n.a1) / 2;
    var name = String(n.name == null ? "" : n.name);
    var textW = name.length * fs * 0.55;
    /* Wide wedges get an upright label when the whole name fits: an upright
     * line at angle `am` spends |sin| of its length radially (limited by the
     * band) and |cos| tangentially (limited by the chord). */
    var horizontal = false;
    if (span > 1.25) {
      var chord = 2 * rMid * Math.sin(Math.min(span, Math.PI) / 2);
      var radialCap = (band - 6) / Math.max(Math.abs(Math.sin(am)), 0.05);
      var tangCap = (chord * 0.9) / Math.max(Math.abs(Math.cos(am)), 0.05);
      horizontal = textW <= Math.min(radialCap, tangCap, arcLen * 0.85);
    }
    var maxW = horizontal ? textW : arcLen - 8;
    if (maxW < fs * 1.5) return "";
    var text = fitText(name, maxW, fs);
    /* a two-letter stub with an ellipsis says nothing: drop it */
    if (!text || (text !== name && text.length < 5)) return "";
    var second = "";
    if (o.labelContent !== "name" && band > fs * 2.5) {
      second = o.labelContent === "pct"
        ? fmtPct(model.total ? n.value / model.total : 0)
        : fmtNumber(n.value, o.numberFormat, model.decimals);
    }
    var deg = am * 180 / Math.PI;
    var rot = horizontal ? 0 : ((deg > 90 && deg < 270) ? deg + 180 : deg);
    var fill = luminance(n.color) > 0.3 ? theme.ink : theme.tint;
    var x = f2(geom.cx + rMid * Math.sin(am)), y = f2(geom.cy - rMid * Math.cos(am));
    var s = '<text class="sb-label" transform="translate(' + x + ',' + y + ') rotate(' + f2(rot) + ')"' +
      ' data-am="' + f2(deg) + '" data-x="' + x + '" data-y="' + y + '" data-h="' + (horizontal ? 1 : 0) + '"' +
      ' text-anchor="middle" font-size="' + f2(fs) + '" fill="' + fill + '">';
    if (second) {
      s += '<tspan x="0" dy="-0.5em">' + esc(text) + '</tspan>' +
        '<tspan x="0" dy="1.15em" font-size="' + f2(fs * 0.85) + '" font-weight="400">' + esc(second) + '</tspan>';
    } else {
      s += '<tspan x="0" dy="0.35em">' + esc(text) + '</tspan>';
    }
    return s + "</text>";
  }

  function buildSvg(st, W, H, geom) {
    var model = st.model, o = st.opts, theme = st.theme;
    var s = [];
    var cx = f2(geom.cx), cy = f2(geom.cy);
    s.push('<g class="sb-rot">');
    s.push('<g class="sb-segs" fill-rule="evenodd">');
    model.nodes.forEach(function (n) {
      if (n.hidden || !(n.a1 > n.a0)) return;
      var d = arcPath(geom.cx, geom.cy, n.r0, n.r1, n.a0, n.a1);
      if (!d) return;
      s.push('<path class="sb-seg' + (n.selectable ? "" : " sb-nosel") + '" data-id="' + n.id + '" d="' + d +
        '" fill="' + n.color + '" stroke="' + theme.paper + '" stroke-width="' + o.segmentGap +
        '" stroke-linejoin="round"/>');
    });
    s.push("</g>");
    if (o.showLabels) {
      s.push('<g class="sb-labels">');
      model.nodes.forEach(function (n) { s.push(labelSvg(n, model, o, theme, geom)); });
      s.push("</g>");
    }
    s.push('<g class="sb-selg" fill="none" stroke="' + theme.ink + '" stroke-width="1.5" stroke-linejoin="round"></g>');
    s.push("</g>");
    if (o.spin) {
      /* the pointer the wheel comes to rest against, at 12 o'clock */
      var py = geom.cy - geom.R;
      s.push('<path class="sb-pointer" d="M' + cx + ',' + f2(py + 13) +
        ' L' + f2(geom.cx - 9) + ',' + f2(py - 7) +
        ' L' + f2(geom.cx + 9) + ',' + f2(py - 7) + ' Z" fill="' + theme.ink +
        '" stroke="' + theme.paper + '" stroke-width="1.5" stroke-linejoin="round"/>');
    }
    if (o.showCenter) {
      var r = geom.hole - Math.max(geom.gap, 2) - 1;
      if (r >= 16) {
        st.centerR = r;
        s.push('<g class="sb-center">' +
          '<text class="sb-c-label" x="' + cx + '" y="' + f2(geom.cy - r * 0.30) + '" text-anchor="middle" fill="' + theme.muted + '"></text>' +
          '<text class="sb-c-value" x="' + cx + '" y="' + f2(geom.cy + r * 0.12) + '" text-anchor="middle" fill="' + theme.ink + '"></text>' +
          '<text class="sb-c-sub" x="' + cx + '" y="' + f2(geom.cy + r * 0.44) + '" text-anchor="middle" fill="' + theme.muted + '"></text>' +
          "</g>");
      } else st.centerR = 0;
    } else st.centerR = 0;
    return s.join("");
  }

  /* ================= legend ================= */
  function renderLegend(st) {
    var o = st.opts, m = st.model, L = st.legendEl;
    if (!o.showLegend) { L.style.display = "none"; L.innerHTML = ""; return; }
    L.style.display = "";
    var h = [];
    var nVis = m.visibleDims.length;
    var key = m.dims.map(function (t, i) {
      if (m.collapsed[i]) return { ring: -1, title: t, value: m.collapsedValue[i] };
      var ri = m.ringOf[i];
      return { ring: o.reverseRings ? nVis - ri : ri + 1, title: t };
    }).sort(function (a, b) { return a.ring - b.ring; });
    if (m.nDims > 1 || m.mode !== "drilldown") {
      h.push('<div class="sb-ringkey">' + key.map(function (k) {
        if (k.ring < 0) return '<span class="sb-rk sb-rk-fixed">' + esc(k.title) + ": " + esc(k.value) + "</span>";
        return '<span class="sb-rk"><b>' + k.ring + "</b>" + esc(k.title) + "</span>";
      }).join("") + "</div>");
    }
    if (m.mode === "drilldown") {
      h.push('<div class="sb-chips">' + firstVisibleLevel(m).slice(0, 40).map(function (c) {
        return '<span class="sb-chip" data-id="' + c.id + '"><i class="sb-sw" style="background:' + c.color + '"></i>' + esc(c.name) + "</span>";
      }).join("") + "</div>");
    }
    L.innerHTML = h.join("");
  }

  /* ================= selection state visuals ================= */
  function applySelectionClasses(st) {
    var m = st.model, selDims = {}, sel = [];
    m.nodes.forEach(function (n) { if (n.state === "S") selDims[n.dim] = true; });
    var segs = st.svg.querySelectorAll(".sb-seg");
    st.segEls = {};
    for (var i = 0; i < segs.length; i++) {
      var el = segs[i], n = m.byId[el.getAttribute("data-id")];
      if (!n) continue;
      st.segEls[n.id] = el;
      var faded = n.state === "X" || (selDims[n.dim] && n.state !== "S");
      el.classList.toggle("sb-faded", !!faded);
      if (n.state === "S") sel.push('<path d="' + el.getAttribute("d") + '"/>');
    }
    var g = st.svg.querySelector(".sb-selg");
    if (g) g.innerHTML = sel.join("");
  }

  /* ================= centre medallion ================= */
  function updateCenter(st, node) {
    var r = st.centerR;
    if (!r) return;
    var svg = st.svg, m = st.model, o = st.opts;
    var lab = svg.querySelector(".sb-c-label"), val = svg.querySelector(".sb-c-value"), sub = svg.querySelector(".sb-c-sub");
    if (!lab || !val || !sub) return;
    var label = node ? node.name : (o.centerLabel || m.measureTitle || "");
    var value = fmtNumber(node ? node.value : m.total, o.numberFormat, m.decimals);
    var subTxt = "";
    if (node) subTxt = m.total ? fmtPct(node.value / m.total) + " of total" : "";
    var fsL = clamp(r * 0.16, 7, 12);
    var fsV = clamp(r * 0.40, 11, 46);
    fsV = Math.min(fsV, (1.7 * r) / Math.max(1, value.length * 0.6));
    var fsS = clamp(r * 0.12, 6.5, 10);
    lab.setAttribute("font-size", f2(fsL));
    val.setAttribute("font-size", f2(fsV));
    sub.setAttribute("font-size", f2(fsS));
    lab.textContent = fitText(label, 1.65 * r, fsL, 0.75);
    val.textContent = value;
    sub.textContent = r > 30 ? fitText(subTxt, 1.6 * r, fsS, 0.75) : "";
  }

  /* ================= tooltip ================= */
  function showTip(st, node, evt) {
    var tip = st.tip, m = st.model, o = st.opts, theme = st.theme;
    var h = [];
    if (m.mode === "drilldown") {
      var crumbs = [], a = node.parent;
      while (a && a.depth > 0) { crumbs.unshift(a.name); a = a.parent; }
      h.push('<div class="t-crumb">' + esc(crumbs.length ? crumbs.join(" › ") : m.dims[node.dim]) + "</div>");
    } else {
      h.push('<div class="t-crumb">' + esc(m.dims[node.dim]) + "</div>");
    }
    h.push('<div class="t-name">' + esc(node.name) + "</div>");
    h.push('<div class="t-row"><span>' + esc(m.measureTitle || "Value") + "</span><span>" +
      esc(fmtNumber(node.value, o.numberFormat, m.decimals)) + "</span></div>");
    if (m.total) h.push('<div class="t-row"><span>of total</span><span>' + fmtPct(node.value / m.total) + "</span></div>");
    if (m.mode === "drilldown" && node.parent && node.parent.depth > 0 && node.parent.value) {
      h.push('<div class="t-row"><span>of ' + esc(fitText(node.parent.name, 120, 12)) + "</span><span>" + fmtPct(node.value / node.parent.value) + "</span></div>");
    }
    tip.innerHTML = h.join("");
    tip.style.display = "block";
    moveTip(st, evt);
  }
  function moveTip(st, evt) {
    var tip = st.tip;
    if (tip.style.display === "none" || !evt) return;
    var rect = st.root.getBoundingClientRect();
    var x = evt.clientX - rect.left + 14, y = evt.clientY - rect.top + 14;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > rect.width - 4) x = evt.clientX - rect.left - tw - 12;
    if (y + th > rect.height - 4) y = evt.clientY - rect.top - th - 12;
    tip.style.left = Math.max(2, x) + "px";
    tip.style.top = Math.max(2, y) + "px";
  }
  function hideTip(st) { st.tip.style.display = "none"; }

  /* ================= hover ================= */
  function setHover(st, node, evt) {
    var svg = st.svg;
    if (st.hover === node) { if (node) moveTip(st, evt); return; }
    st.hover = node;
    var id;
    if (!node) {
      svg.classList.remove("sb-hovering");
      for (id in st.segEls) st.segEls[id].classList.remove("sb-lit");
      hideTip(st);
      updateCenter(st, null);
      return;
    }
    svg.classList.add("sb-hovering");
    var lit = {}, a = node;
    while (a && a.depth > 0) { lit[a.id] = true; a = a.parent; }
    (function rec(n) { n.children.forEach(function (c) { lit[c.id] = true; rec(c); }); })(node);
    for (id in st.segEls) st.segEls[id].classList.toggle("sb-lit", !!lit[id]);
    updateCenter(st, node);
    showTip(st, node, evt);
  }

  /* ================= selection ================= */
  function doSelect(st, node) {
    var self = st.self, m = st.model, o = st.opts;
    if (!node || !node.selectable) return;
    if (!self || !self.backendApi || !self.backendApi.selectValues) return;
    if (inEditMode()) return;
    var api = self.backendApi, calls = [];
    function sel(dim, elems, toggle) {
      calls.push(function () { return Promise.resolve(api.selectValues(dim, elems, toggle)); });
    }
    if (m.mode === "independent") {
      sel(node.dim, [node.elem], true);
    } else {
      var anc = [], a = node.parent;
      while (a && a.depth > 0) { anc.unshift(a); a = a.parent; }
      if (o.drillSelect === "additive") {
        anc.forEach(function (x) { if (x.selectable && x.state !== "S") sel(x.dim, [x.elem], true); });
        sel(node.dim, [node.elem], true);
      } else {
        /* "path": the clicked segment's ancestry becomes THE selected path.
         * Deeper rings are cleared so the selection reads top-down. */
        var pathSelected = anc.every(function (x) { return x.state === "S"; });
        var deeper = {};
        m.nodes.forEach(function (n) {
          if (n.dim > node.dim && n.state === "S" && n.elem >= 0) {
            (deeper[n.dim] = deeper[n.dim] || {})[n.elem] = true;
          }
        });
        Object.keys(deeper).forEach(function (d) {
          sel(+d, Object.keys(deeper[d]).map(Number), true);
        });
        if (!pathSelected) {
          anc.forEach(function (x) { if (x.selectable) sel(x.dim, [x.elem], false); });
        }
        sel(node.dim, [node.elem], pathSelected);
      }
    }
    calls.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve())
      .catch(function (e) { if (window.console) console.warn("Sunburst: selection failed", e); });
  }

  /* ================= DOM & events ================= */
  var STATES = {};
  function getState(id) {
    if (!STATES[id]) STATES[id] = { id: id.replace(/[^a-zA-Z0-9_-]/g, "") };
    return STATES[id];
  }

  /* ================= wheel of fortune spin =================
   * The drawn rings live in a <g class="sb-rot"> that we rotate. The centre
   * medallion and the pointer stay put. Rotation is kept in state so a
   * repaint (a selection, say) leaves the wheel where the user spun it.
   */
  var FRICTION = 0.9965;   /* velocity decay per millisecond */
  var STOP_VEL = 0.0015;   /* deg/ms below which the wheel is at rest */
  var DRAG_SLOP = 4;       /* deg of travel before a drag stops being a click */

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }
  function normDeg(d) {
    d = d % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
  function pointerAngle(st, evt) {
    var r = st.svg.getBoundingClientRect();
    if (!r.width || !r.height || !st.geom) return 0;
    var sx = r.width / st.geom.W, sy = r.height / st.geom.H;
    var cx = r.left + st.geom.cx * sx, cy = r.top + st.geom.cy * sy;
    return Math.atan2(evt.clientY - cy, evt.clientX - cx) * 180 / Math.PI;
  }
  /* Labels are painted on the wheel, so a spin would leave half of them
   * upside down. Flip the ones that have crossed to the far side, and hold
   * upright labels upright. Only labels that actually changed are touched. */
  function reorientLabels(st) {
    var list = st.labelEls;
    if (!list) return;
    var s = st.spin || 0;
    for (var i = 0; i < list.length; i++) {
      var L = list[i], rot;
      if (L.horiz) rot = -s;
      else {
        var abs = ((L.am + s) % 360 + 360) % 360;
        rot = (abs > 90 && abs < 270) ? L.am + 180 : L.am;
      }
      if (rot !== L.rot) {
        L.rot = rot;
        L.el.setAttribute("transform", "translate(" + L.x + "," + L.y + ") rotate(" + f2(rot) + ")");
      }
    }
  }
  function collectLabels(st) {
    st.labelEls = null;
    if (!spinOn(st)) return;
    var els = st.svg.querySelectorAll(".sb-label"), out = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      out.push({ el: e, am: +e.getAttribute("data-am"), x: e.getAttribute("data-x"),
        y: e.getAttribute("data-y"), horiz: e.getAttribute("data-h") === "1", rot: null });
    }
    st.labelEls = out;
  }
  function applyRotation(st) {
    var g = st.svg.querySelector(".sb-rot");
    if (!g || !st.geom) return;
    var deg = st.spin || 0;
    g.setAttribute("transform", "rotate(" + f2(deg) + "," + f2(st.geom.cx) + "," + f2(st.geom.cy) + ")");
    reorientLabels(st);
  }
  function stopCoast(st) {
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
    st.vel = 0;
  }
  function coast(st) {
    /* cancel any frame in flight but keep the velocity we were just handed */
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
    var last = nowMs();
    function step(now) {
      st.raf = null;
      var dt = Math.min(64, now - last);
      last = now;
      st.spin = (st.spin || 0) + st.vel * dt;
      st.vel *= Math.pow(FRICTION, dt);
      applyRotation(st);
      if (Math.abs(st.vel) > STOP_VEL) st.raf = requestAnimationFrame(step);
      else st.vel = 0;
    }
    st.raf = requestAnimationFrame(step);
  }
  function spinOn(st) { return !!(st.opts && st.opts.spin); }

  function bindSpin(st) {
    var svg = st.svg;
    function down(e) {
      if (!spinOn(st) || !st.model || e.button > 0) return;
      stopCoast(st);
      setHover(st, null);
      st.drag = { last: pointerAngle(st, e), travel: 0, vel: 0,
        t: nowMs() };
      if (svg.setPointerCapture && e.pointerId !== undefined) {
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
      e.preventDefault();
    }
    function move(e) {
      if (!st.drag) return;
      var a = pointerAngle(st, e);
      var d = normDeg(a - st.drag.last);
      var now = nowMs();
      var dt = now - st.drag.t;
      st.drag.last = a;
      st.drag.t = now;
      st.drag.travel += Math.abs(d);
      st.spin = (st.spin || 0) + d;
      /* smooth the velocity so one jittery frame cannot fling the wheel */
      if (dt > 0) st.drag.vel = 0.75 * (d / dt) + 0.25 * st.drag.vel;
      applyRotation(st);
      e.preventDefault();
    }
    function up(e) {
      if (!st.drag) return;
      var drag = st.drag;
      st.drag = null;
      if (svg.releasePointerCapture && e.pointerId !== undefined) {
        try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
      /* a real spin should not also select the segment under the cursor, but
       * only the click the browser fires right after this drag is swallowed */
      st.suppressClick = drag.travel > DRAG_SLOP ? nowMs() : 0;
      var idle = (nowMs()) - drag.t;
      if (drag.travel > DRAG_SLOP && idle < 120 && Math.abs(drag.vel) > STOP_VEL) {
        st.vel = Math.max(-2.5, Math.min(2.5, drag.vel));
        coast(st);
      }
    }
    if (window.PointerEvent) {
      svg.addEventListener("pointerdown", down);
      svg.addEventListener("pointermove", move);
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointercancel", up);
    } else {
      svg.addEventListener("mousedown", down);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    }
  }

  function nodeFromEvent(st, evt) {
    var t = evt.target;
    while (t && t !== st.root) {
      if (t.getAttribute && t.getAttribute("data-id")) return st.model && st.model.byId[t.getAttribute("data-id")];
      t = t.parentNode;
    }
    return null;
  }

  function bindEvents(st) {
    var svg = st.svg;
    bindSpin(st);
    svg.addEventListener("mousemove", function (e) {
      if (!st.model || st.drag || st.vel) return;
      var n = nodeFromEvent(st, e);
      setHover(st, n && n.dim !== undefined ? n : null, e);
    });
    svg.addEventListener("mouseleave", function () { setHover(st, null); });
    svg.addEventListener("click", function (e) {
      if (!st.model) return;
      if (st.suppressClick && nowMs() - st.suppressClick < 400) { st.suppressClick = 0; return; }
      var n = nodeFromEvent(st, e);
      if (n) doSelect(st, n);
    });
    st.legendEl.addEventListener("click", function (e) {
      if (!st.model) return;
      var n = nodeFromEvent(st, e);
      if (n) doSelect(st, n);
    });
  }

  function ensureDom(el, st) {
    var root = el.firstElementChild;
    if (!root || !root.classList.contains("sb-root")) {
      el.innerHTML = '<div class="sb-root">' +
        '<svg class="sb-svg" xmlns="http://www.w3.org/2000/svg"></svg>' +
        '<div class="sb-legend"></div>' +
        '<div class="sb-note" style="display:none"></div>' +
        '<div class="sb-tip" style="display:none"></div>' +
        '<div class="sb-empty" style="display:none"></div>' +
        "</div>";
      root = el.firstElementChild;
      st.root = root;
      st.svg = root.querySelector(".sb-svg");
      st.legendEl = root.querySelector(".sb-legend");
      st.noteEl = root.querySelector(".sb-note");
      st.tip = root.querySelector(".sb-tip");
      st.emptyEl = root.querySelector(".sb-empty");
      bindEvents(st);
    } else {
      st.root = root;
      st.svg = root.querySelector(".sb-svg");
      st.legendEl = root.querySelector(".sb-legend");
      st.noteEl = root.querySelector(".sb-note");
      st.tip = root.querySelector(".sb-tip");
      st.emptyEl = root.querySelector(".sb-empty");
    }
    return root;
  }

  /* Qlik drill-down (hierarchic group) dimensions expose one level at a
   * time, so they can only ever produce one ring. Say so. */
  function renderNote(st, hc) {
    var drill = (hc.qDimensionInfo || []).filter(function (d) { return d.qGrouping === "H"; });
    if (!drill.length) { st.noteEl.style.display = "none"; st.noteEl.textContent = ""; return; }
    st.noteEl.textContent = "“" + (drill[0].qFallbackTitle || "Dimension") + "” is a drill-down dimension, " +
      "which shows one level at a time. Add each level as its own dimension to get one ring per level.";
    st.noteEl.style.display = "";
  }

  function showEmpty(st, msg) {
    st.svg.innerHTML = "";
    st.legendEl.innerHTML = "";
    st.legendEl.style.display = "none";
    st.noteEl.style.display = "none";
    st.emptyEl.textContent = msg;
    st.emptyEl.style.display = "flex";
    st.model = null;
  }

  /* ================= render ================= */
  function render(self, el, layout, rows) {
    var qId = (layout.qInfo && layout.qInfo.qId) || "x";
    var st = getState(qId);
    var o = getOpts(layout), theme = resolveTheme(o);
    var hc = layout.qHyperCube || {};
    ensureDom(el, st);
    st.self = self; st.opts = o; st.theme = theme; st.layout = layout; st.hover = null;
    st.root.style.color = theme.ink;

    var nDims = (hc.qDimensionInfo || []).length, nMeas = (hc.qMeasureInfo || []).length;
    if (!nDims || !nMeas) { showEmpty(st, "Add at least one dimension and one measure."); return; }
    st.emptyEl.style.display = "none";

    var model = buildModel(layout, rows, o);
    st.model = model;
    if (!rows.length) { showEmpty(st, "No data to display."); return; }

    assignColors(model, o, theme);
    renderLegend(st);
    renderNote(st, hc);

    var W = Math.max(20, st.root.clientWidth);
    var H = Math.max(20, st.root.clientHeight -
      (o.showLegend ? st.legendEl.offsetHeight : 0) - st.noteEl.offsetHeight);
    var geom = computeGeometry(W, H, model.visibleDims.length, o);
    geom.W = W; geom.H = H;
    st.geom = geom;
    layoutModel(model, geom, o);

    st.svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    st.svg.setAttribute("width", W);
    st.svg.setAttribute("height", H);
    st.svg.classList.remove("sb-hovering");
    st.svg.classList.toggle("sb-spinnable", !!o.spin);
    if (!o.spin) { stopCoast(st); st.spin = 0; }
    st.svg.innerHTML = buildSvg(st, W, H, geom);
    collectLabels(st);
    applyRotation(st);
    hideTip(st);
    applySelectionClasses(st);
    updateCenter(st, null);
  }

  /* ================= extension interface ================= */
  return {
    initialProperties: {
      version: 1.0,
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: [],
        qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 8, qHeight: 1250 }],
        qSuppressMissing: true,
        qSuppressZero: false
      },
      props: JSON.parse(JSON.stringify(DEFAULTS)),
      showTitles: true,
      title: ""
    },
    definition: properties,
    support: { snapshot: true, export: true, exportData: true },
    paint: function ($element, layout) {
      var self = this;
      var el = $element[0] || $element;
      return fetchAll(self, layout).then(function (rows) {
        render(self, el, layout, rows);
      }).catch(function (e) {
        if (window.console) console.error("Sunburst:", e);
        var st = getState((layout.qInfo && layout.qInfo.qId) || "x");
        ensureDom(el, st);
        showEmpty(st, "Sunburst could not render: " + (e && e.message ? e.message : e));
      });
    }
  };
});
