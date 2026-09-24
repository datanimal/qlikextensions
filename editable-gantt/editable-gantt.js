/* ============================================================
 * Editable Gantt — a Qlik Cloud visualization extension
 *
 * Two task sources:
 *  - "managed": tasks live in the object's own properties and are
 *    edited directly on the sheet (drag, resize, link, click-to-edit).
 *    Changes persist via applyPatches.
 *  - "data": tasks come from the hypercube (read-only, with Qlik
 *    selections on click).
 * ============================================================ */
define(["text!./style.css", "./properties"], function (css, properties) {
  "use strict";

  /* ---------- one-time style injection ---------- */
  if (!document.getElementById("eg-style")) {
    var styleTag = document.createElement("style");
    styleTag.id = "eg-style";
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  /* ================= date utilities =================
   * All date math uses "day numbers": whole days since 1970-01-01 UTC.
   */
  var DAY = 86400000;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dnFromISO(iso) {
    var p = String(iso || "").split("-");
    var dn = Date.UTC(+p[0], (+p[1] || 1) - 1, +p[2] || 1) / DAY;
    return isFinite(dn) ? Math.round(dn) : null;
  }
  function isoFromDn(dn) {
    var d = new Date(dn * DAY);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function ymd(dn) {
    var d = new Date(dn * DAY);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
  function dnFromYMD(y, m, d) { return Date.UTC(y, m, d) / DAY; }
  function todayDn() {
    var n = new Date();
    return dnFromYMD(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function dow(dn) { return ((dn + 4) % 7 + 7) % 7; } /* 0 = Sunday */
  function isWknd(dn) { var w = dow(dn); return w === 0 || w === 6; }
  function fmtShort(dn) {
    var p = ymd(dn);
    return MONTHS[p.m] + " " + p.d;
  }
  function fmtRange(a, b) {
    if (a === b) return fmtShort(a);
    var pa = ymd(a), pb = ymd(b);
    if (pa.m === pb.m && pa.y === pb.y) return MONTHS[pa.m] + " " + pa.d + " – " + pb.d;
    return fmtShort(a) + " – " + fmtShort(b);
  }
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function newId() {
    return "t" + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  }

  /* ================= palette ================= */
  var PALETTE = ["#4A7CF6", "#8A63E8", "#2FB9A8", "#4CAF7D", "#E8A33D",
    "#E8635A", "#D95CA8", "#3AA6DC", "#6B7A8F", "#B0893B"];

  /* ================= sample plan (seeded on first insert) ================= */
  function buildSample() {
    var t = todayDn();
    var monday = t - ((dow(t) + 6) % 7);
    var a = monday - 21;
    function iso(off) { return isoFromDn(a + off); }
    function mk(id, name, group, s, e, prog, deps, extra) {
      var o = { id: id, name: name, group: group, start: iso(s), end: iso(e),
        progress: prog, deps: deps || [] };
      if (extra) { for (var k in extra) o[k] = extra[k]; }
      return o;
    }
    return {
      rev: 0,
      tasks: [
        mk("s1", "Kickoff & goals", "Planning", 0, 2, 100),
        mk("s2", "Requirements & scope", "Planning", 3, 8, 100, ["s1"]),
        mk("s3", "Wireframes", "Design", 7, 13, 90, ["s2"]),
        mk("s4", "Visual design", "Design", 12, 19, 55, ["s3"]),
        mk("s5", "Build sprint 1", "Build", 18, 27, 25, ["s4"],
          { notes: "Core features first. Click any bar to edit it — drag to reschedule." }),
        mk("s6", "Build sprint 2", "Build", 28, 36, 0, ["s5"]),
        mk("s7", "QA & bug fixes", "Build", 33, 40, 0, ["s5"]),
        mk("s8", "Launch prep", "Launch", 39, 44, 0, ["s7"]),
        mk("s9", "Go live", "Launch", 46, 46, 0, ["s8"], { milestone: true })
      ]
    };
  }

  /* ================= per-object session state ================= */
  var STATES = {};
  function getState(id) {
    if (!STATES[id]) {
      STATES[id] = {
        ppd: null, collapsed: {}, undo: [], redo: [],
        optimistic: null, uiLock: false, pendingLayout: null,
        saveTimer: null, persistWarn: false, sl: 0, st: 0,
        pendingAnchor: null, editAfterRender: null, selLink: null,
        renderIndex: {}, firstRendered: false, hoverTimer: null
      };
    }
    return STATES[id];
  }

  /* ================= data access ================= */
  function currentData(layout, state) {
    var base = (layout.ganttData && Array.isArray(layout.ganttData.tasks))
      ? layout.ganttData : { tasks: [], rev: 0 };
    if (state.optimistic && (state.optimistic.rev || 0) >= (base.rev || 0)) {
      return state.optimistic;
    }
    state.optimistic = null;
    return base;
  }

  function cubeTasks(layout) {
    var hc = layout.qHyperCube;
    if (!hc) return { error: "No data. Configure dimensions and measures." };
    var nd = hc.qDimensionInfo.length, nm = hc.qMeasureInfo.length;
    if (nd < 1 || nm < 2) {
      return {
        error: "Data mode needs a Task dimension plus Start and End date measures " +
          "(optional: Group dimension, Progress measure)."
      };
    }
    var rows = ((hc.qDataPages && hc.qDataPages[0]) || {}).qMatrix || [];
    var tasks = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var sRaw = r[nd] && r[nd].qNum;
      var eRaw = r[nd + 1] && r[nd + 1].qNum;
      if (!isFinite(sRaw) || !isFinite(eRaw)) continue;
      var s = Math.round(sRaw - 25569), e = Math.round(eRaw - 25569);
      if (e < s) { var tmp = s; s = e; e = tmp; }
      var prog = null;
      if (nm > 2 && r[nd + 2] && isFinite(r[nd + 2].qNum)) {
        prog = r[nd + 2].qNum;
        if (prog <= 1) prog = prog * 100;
        prog = clampNum(Math.round(prog), 0, 100);
      }
      tasks.push({
        id: "r" + i,
        name: (r[0] && r[0].qText) || "—",
        qElem: r[0] ? r[0].qElemNumber : -1,
        group: nd > 1 ? ((r[1] && r[1].qText) || "") : "",
        start: isoFromDn(s), end: isoFromDn(e),
        progress: prog === null ? 0 : prog,
        milestone: s === e,
        deps: []
      });
    }
    return { tasks: tasks };
  }

  /* ================= persistence ================= */
  function scheduleSave(ctx) {
    var state = ctx.state;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      state.saveTimer = null;
      doSave(ctx);
    }, 400);
  }

  function doSave(ctx) {
    var state = ctx.state;
    if (!state.optimistic || !ctx.backendApi || !ctx.backendApi.applyPatches) return;
    var patches = [{
      qPath: "/ganttData", qOp: "replace",
      qValue: JSON.stringify(state.optimistic)
    }];
    var p;
    try { p = ctx.backendApi.applyPatches(patches, false); }
    catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(function () {
      if (state.persistWarn) { state.persistWarn = false; }
    }).catch(function () {
      /* No update rights (e.g. published app) — fall back to a session-only
         soft patch so the chart still works, and show a badge. */
      try { ctx.backendApi.applyPatches(patches, true); } catch (e2) { /* noop */ }
      if (!state.persistWarn) {
        state.persistWarn = true;
        var tb = ctx.el.querySelector(".eg-tb-badge-slot");
        if (tb && !tb.firstChild) {
          var b = document.createElement("span");
          b.className = "eg-badge";
          b.textContent = "Session only";
          b.title = "You don't have edit rights on this app, so changes live only in this session.";
          tb.appendChild(b);
        }
      }
    });
  }

  function commit(ctx, newData, opts) {
    opts = opts || {};
    var state = ctx.state;
    var prev = currentData(ctx.layout, state);
    if (opts.pushUndo !== false) {
      state.undo.push(deepClone(prev));
      if (state.undo.length > 40) state.undo.shift();
      state.redo = [];
    }
    newData.rev = (prev.rev || 0) + 1;
    state.optimistic = newData;
    scheduleSave(ctx);
    renderAll(ctx);
  }

  function doUndoRedo(ctx, isRedo) {
    var state = ctx.state;
    var from = isRedo ? state.redo : state.undo;
    var to = isRedo ? state.undo : state.redo;
    if (!from.length) return;
    var cur = deepClone(currentData(ctx.layout, state));
    var next = from.pop();
    to.push(cur);
    next.rev = (cur.rev || 0) + 1;
    state.optimistic = next;
    scheduleSave(ctx);
    renderAll(ctx);
  }

  /* ================= misc helpers ================= */
  function ce(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgEl(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }
  function toast(ctx, msg) {
    var old = ctx.el.querySelector(".eg-toast");
    if (old) old.remove();
    var root = ctx.el.querySelector(".eg-root");
    if (!root) return;
    var t = ce("div", "eg-toast", root);
    t.textContent = msg;
    setTimeout(function () { t.remove(); }, 2400);
  }
  function dependsOn(tasks, a, b) { /* does a depend transitively on b? */
    var map = {};
    tasks.forEach(function (t) { map[t.id] = t; });
    var seen = {}, stack = [a];
    while (stack.length) {
      var cur = stack.pop();
      if (cur === b) return true;
      if (seen[cur]) continue;
      seen[cur] = 1;
      var t = map[cur];
      ((t && t.deps) || []).forEach(function (d) { stack.push(d); });
    }
    return false;
  }

  var ICONS = {
    zoomOut: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4 14 14M5 7h4"/></svg>',
    zoomIn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4 14 14M7 5v4M5 7h4"/></svg>',
    fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>',
    today: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 3V1.5M10.5 3V1.5"/><circle cx="8" cy="10" r="1.6" fill="currentColor" stroke="none"/></svg>',
    undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3 3 6l3 3"/><path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3l3 3-3 3"/><path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H10"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    chev: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5 5 6.5 8 3.5"/></svg>'
  };

  function mkBtn(parent, icon, label, title, onClick) {
    var b = ce("button", "eg-btn", parent);
    b.type = "button";
    b.title = title || "";
    if (icon) b.innerHTML = ICONS[icon];
    if (label) {
      var s = document.createElement("span");
      s.textContent = label;
      b.appendChild(s);
    }
    b.addEventListener("click", onClick);
    return b;
  }

  /* ================= time axis ticks ================= */
  function buildTicks(ppd, r0, r1, weekStart) {
    var minor = [], major = [], kind;
    var p0 = ymd(r0), p1 = ymd(r1);
    var y, m, dn, s, e;

    function pushMonthsMajor() {
      y = p0.y; m = p0.m;
      while (true) {
        s = dnFromYMD(y, m, 1);
        e = dnFromYMD(y, m + 1, 1) - 1;
        if (s > r1) break;
        var w = (Math.min(e, r1) - Math.max(s, r0) + 1) * ppd;
        major.push({
          s: Math.max(s, r0), e: Math.min(e, r1),
          label: w < 74 ? (MONTHS[m] + " ’" + String(y).slice(2)) : (MONTHS[m] + " " + y)
        });
        m++; if (m > 11) { m = 0; y++; }
      }
    }
    function pushYearsMajor() {
      for (y = p0.y; y <= p1.y; y++) {
        s = dnFromYMD(y, 0, 1); e = dnFromYMD(y + 1, 0, 1) - 1;
        major.push({ s: Math.max(s, r0), e: Math.min(e, r1), label: String(y) });
      }
    }

    if (ppd >= 18) {
      kind = "day";
      for (dn = r0; dn <= r1; dn++) {
        minor.push({ s: dn, e: dn, label: String(ymd(dn).d), wknd: isWknd(dn) });
      }
      pushMonthsMajor();
    } else if (ppd >= 6.5) {
      kind = "week";
      var start = r0 - ((dow(r0) - weekStart + 7) % 7);
      for (dn = start; dn <= r1; dn += 7) {
        minor.push({ s: Math.max(dn, r0), e: Math.min(dn + 6, r1), label: String(ymd(dn).d) });
      }
      pushMonthsMajor();
    } else if (ppd >= 1.6) {
      kind = "month";
      y = p0.y; m = p0.m;
      while (true) {
        s = dnFromYMD(y, m, 1); e = dnFromYMD(y, m + 1, 1) - 1;
        if (s > r1) break;
        minor.push({ s: Math.max(s, r0), e: Math.min(e, r1), label: MONTHS[m] });
        m++; if (m > 11) { m = 0; y++; }
      }
      pushYearsMajor();
    } else {
      kind = "quarter";
      y = p0.y; m = Math.floor(p0.m / 3) * 3;
      while (true) {
        s = dnFromYMD(y, m, 1); e = dnFromYMD(y, m + 3, 1) - 1;
        if (s > r1) break;
        minor.push({ s: Math.max(s, r0), e: Math.min(e, r1), label: "Q" + (m / 3 + 1) });
        m += 3; if (m > 11) { m = 0; y++; }
      }
      pushYearsMajor();
    }
    return { minor: minor, major: major, kind: kind };
  }

  /* ================= main render ================= */
  function renderAll(ctx) {
    var el = ctx.el, layout = ctx.layout, state = ctx.state;
    var props = layout.props || {};
    var dataMode = props.mode === "data";
    var canEdit = !dataMode && ctx.backendApi && ctx.backendApi.applyPatches;
    state.pendingLayout = null;
    state.selLink = null;

    /* preserve scroll of previous render */
    var oldScroller = el.querySelector(".eg-tl");
    if (oldScroller) { state.sl = oldScroller.scrollLeft; state.st = oldScroller.scrollTop; }

    /* ----- resolve tasks ----- */
    var srcErr = null, rawTasks = [];
    if (dataMode) {
      var cube = cubeTasks(layout);
      if (cube.error) srcErr = cube.error; else rawTasks = cube.tasks;
    } else {
      rawTasks = currentData(layout, state).tasks;
    }

    /* normalize for rendering */
    var tasks = [];
    rawTasks.forEach(function (t, i) {
      var s = dnFromISO(t.start), e = dnFromISO(t.end);
      if (s === null) return;
      if (e === null || t.milestone) e = s;
      if (e < s) e = s;
      tasks.push({
        raw: t, id: t.id, name: t.name || "Untitled", group: t.group || "",
        s: s, e: e, progress: clampNum(Math.round(t.progress || 0), 0, 100),
        milestone: !!t.milestone, notes: t.notes || "",
        deps: t.deps || [], color: t.color || null,
        qElem: t.qElem, idx: i
      });
    });

    /* ----- groups & rows ----- */
    var groupsOrder = [], groupMap = {};
    tasks.forEach(function (t) {
      if (!(t.group in groupMap)) {
        groupMap[t.group] = { name: t.group, tasks: [], idx: groupsOrder.length };
        groupsOrder.push(t.group);
      }
      groupMap[t.group].tasks.push(t);
    });
    var hasGroups = groupsOrder.some(function (g) { return g !== ""; });

    function colorOf(t) {
      if (t.color) return t.color;
      if (props.colorMode === "single") return "#4A7CF6";
      if (props.colorMode === "task") return PALETTE[t.idx % PALETTE.length];
      return PALETTE[groupMap[t.group].idx % PALETTE.length];
    }

    var compact = props.density === "compact";
    var rowH = compact ? 30 : 38;
    var grpH = compact ? 27 : 32;
    var barH = compact ? 17 : 22;
    var HEAD = 56;

    var rows = [], yCur = 0;
    function pushTaskRow(t) {
      rows.push({ kind: "task", t: t, y: yCur, h: rowH }); yCur += rowH;
    }
    if (hasGroups) {
      groupsOrder.forEach(function (g) {
        var grp = groupMap[g];
        var collapsed = !!state.collapsed[g];
        rows.push({ kind: "group", g: grp, y: yCur, h: grpH, collapsed: collapsed });
        yCur += grpH;
        if (!collapsed) grp.tasks.forEach(pushTaskRow);
      });
    } else {
      tasks.forEach(pushTaskRow);
    }
    var rowsH = yCur;

    /* ----- range ----- */
    var minDn, maxDn;
    if (tasks.length) {
      minDn = Infinity; maxDn = -Infinity;
      tasks.forEach(function (t) {
        if (t.s < minDn) minDn = t.s;
        if (t.e > maxDn) maxDn = t.e;
      });
    } else {
      minDn = todayDn() - 10; maxDn = todayDn() + 40;
    }
    var pad = Math.max(5, Math.round((maxDn - minDn) * 0.08));
    minDn -= pad; maxDn += pad;
    var totalDays = maxDn - minDn + 1;

    /* ----- skeleton DOM ----- */
    el.innerHTML = "";
    var root = ce("div", "eg-root", el);
    root.tabIndex = 0;

    var toolbar = ce("div", "eg-toolbar", root);
    var body = ce("div", "eg-body", root);
    var side = ce("div", "eg-side", body);
    side.style.width = (props.sidebarWidth || 230) + "px";
    var sideHead = ce("div", "eg-side-head", side);
    var sideHeadLbl = ce("span", null, sideHead);
    sideHeadLbl.textContent = "Tasks";
    var sideCount = ce("span", "eg-side-count", sideHead);
    sideCount.textContent = String(tasks.length);
    var sideBody = ce("div", "eg-side-body", side);
    var sideRows = ce("div", "eg-side-rows", sideBody);
    var tl = ce("div", "eg-tl", body);
    var canvas = ce("div", "eg-canvas", tl);

    /* measure */
    var viewW = Math.max(200, tl.clientWidth || 600);
    var viewH = Math.max(120, tl.clientHeight || 300);
    if (state.ppd === null) {
      state.ppd = clampNum((viewW - 30) / totalDays, 1.2, 60);
    }
    var ppd = state.ppd;
    var totalW = Math.max(Math.ceil(totalDays * ppd), viewW);
    var bodyH = Math.max(rowsH, viewH - HEAD);
    canvas.style.width = totalW + "px";
    canvas.style.height = (HEAD + bodyH) + "px";

    function x(dn) { return (dn - minDn) * ppd; }

    /* ----- toolbar ----- */
    function zoomBy(f) {
      var day = minDn + (tl.scrollLeft + viewW / 2) / ppd;
      state.ppd = clampNum(ppd * f, 1.2, 60);
      state.pendingAnchor = { day: day, px: viewW / 2 };
      renderAll(ctx);
    }
    var tbZoom = ce("div", "eg-tb-group", toolbar);
    mkBtn(tbZoom, "zoomOut", null, "Zoom out", function () { zoomBy(1 / 1.4); });
    mkBtn(tbZoom, "zoomIn", null, "Zoom in", function () { zoomBy(1.4); });
    mkBtn(tbZoom, "fit", null, "Fit whole plan", function () {
      state.ppd = clampNum((viewW - 30) / totalDays, 1.2, 60);
      state.pendingAnchor = { day: minDn + totalDays / 2, px: viewW / 2 };
      renderAll(ctx);
    });
    mkBtn(tbZoom, "today", null, "Scroll to today", function () {
      state.pendingAnchor = { day: todayDn(), px: viewW * 0.35 };
      renderAll(ctx);
    });

    if (canEdit) {
      ce("div", "eg-tb-sep", toolbar);
      var tbEdit = ce("div", "eg-tb-group", toolbar);
      var undoBtn = mkBtn(tbEdit, "undo", null, "Undo (Ctrl+Z)", function () { doUndoRedo(ctx, false); });
      var redoBtn = mkBtn(tbEdit, "redo", null, "Redo (Ctrl+Y)", function () { doUndoRedo(ctx, true); });
      undoBtn.disabled = !state.undo.length;
      redoBtn.disabled = !state.redo.length;
    }
    ce("div", "eg-tb-spacer", toolbar);
    var badgeSlot = ce("div", "eg-tb-badge-slot", toolbar);
    if (state.persistWarn) {
      var badge = ce("span", "eg-badge", badgeSlot);
      badge.textContent = "Session only";
      badge.title = "You don't have edit rights on this app, so changes live only in this session.";
    }
    if (canEdit) {
      var addBtn = mkBtn(toolbar, "plus", "Task", "Add a task", function () {
        addTask(ctx, null);
      });
      addBtn.classList.add("eg-btn-primary");
    }

    /* ----- error / empty states ----- */
    if (srcErr) {
      var errBox = ce("div", "eg-empty", body);
      errBox.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h5M8 16h8"/></svg>';
      var eh = ce("h3", null, errBox); eh.textContent = "Waiting for data";
      var ep = ce("p", null, errBox); ep.textContent = srcErr;
      return;
    }

    /* ----- ticks & header ----- */
    var weekStart = props.weekStart === 0 ? 0 : 1;
    var ticks = buildTicks(ppd, minDn, maxDn, weekStart);
    var head = ce("div", "eg-head", canvas);
    head.style.width = totalW + "px";
    ticks.major.forEach(function (c) {
      var d = ce("div", "eg-tick eg-tick-major", head);
      d.style.left = x(c.s) + "px";
      d.style.width = ((c.e - c.s + 1) * ppd) + "px";
      d.textContent = c.label;
    });
    ticks.minor.forEach(function (c) {
      var d = ce("div", "eg-tick eg-tick-minor" + (c.wknd ? " wknd" : ""), head);
      d.style.left = x(c.s) + "px";
      d.style.width = ((c.e - c.s + 1) * ppd) + "px";
      d.textContent = c.label;
    });

    /* ----- background layer ----- */
    var bg = ce("div", "eg-layer eg-bg", canvas);
    bg.style.width = totalW + "px";
    bg.style.height = bodyH + "px";
    if (ticks.kind === "day" && props.shadeWeekends !== false) {
      ticks.minor.forEach(function (c) {
        if (!c.wknd) return;
        var w = ce("div", "eg-wknd", bg);
        w.style.left = x(c.s) + "px";
        w.style.width = ppd + "px";
      });
    }
    var majorStarts = {};
    ticks.major.forEach(function (c) { majorStarts[c.s] = 1; });
    ticks.minor.forEach(function (c) {
      var l = ce("div", "eg-gline" + (majorStarts[c.s] ? " major" : ""), bg);
      l.style.left = x(c.s) + "px";
    });
    rows.forEach(function (r, i) {
      var rb = ce("div", "eg-rowbg" + (r.kind === "group" ? " grp" : ""), bg);
      rb.style.top = r.y + "px";
      rb.style.height = r.h + "px";
      rb.dataset.row = i;
    });

    var today = todayDn();
    if (props.showToday !== false && today >= minDn && today <= maxDn) {
      var tline = ce("div", "eg-todayline", bg);
      tline.style.left = (x(today) + ppd / 2) + "px";
      var pill = ce("div", "eg-todaypill", head);
      pill.style.left = (x(today) + ppd / 2) + "px";
      pill.textContent = "TODAY";
    }

    /* ----- links svg ----- */
    var linksSvg = svgEl("svg");
    linksSvg.setAttribute("class", "eg-links");
    linksSvg.setAttribute("width", totalW);
    linksSvg.setAttribute("height", bodyH);
    linksSvg.style.top = HEAD + "px";
    var markerId = "eg-arrow-" + (layout.qInfo ? layout.qInfo.qId : "x");
    var defs = svgEl("defs");
    var marker = svgEl("marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("viewBox", "0 0 8 8");
    marker.setAttribute("refX", "7"); marker.setAttribute("refY", "4");
    marker.setAttribute("markerWidth", "6"); marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    var mpath = svgEl("path");
    mpath.setAttribute("d", "M0 0 L8 4 L0 8 z");
    mpath.setAttribute("fill", "#9aa4bd");
    marker.appendChild(mpath);
    defs.appendChild(marker);
    linksSvg.appendChild(defs);
    canvas.appendChild(linksSvg);

    /* ----- bars layer ----- */
    var bars = ce("div", "eg-layer eg-bars", canvas);
    bars.style.width = totalW + "px";
    bars.style.height = bodyH + "px";

    state.renderIndex = {};
    var taskById = {};
    tasks.forEach(function (t) { taskById[t.id] = t; });

    rows.forEach(function (r, rowIdx) {
      if (r.kind === "group") {
        var gs = Infinity, ge = -Infinity;
        r.g.tasks.forEach(function (t) {
          if (t.s < gs) gs = t.s;
          if (t.e > ge) ge = t.e;
        });
        if (isFinite(gs)) {
          var sum = ce("div", "eg-gsum", bars);
          sum.style.left = (x(gs) + 1) + "px";
          sum.style.width = Math.max(6, (ge - gs + 1) * ppd - 2) + "px";
          sum.style.top = (r.y + (r.h - 8) / 2) + "px";
          sum.style.setProperty("--c", PALETTE[r.g.idx % PALETTE.length]);
        }
        return;
      }
      var t = r.t;
      var c = colorOf(t);
      var entry = {
        s: t.s, e: t.e, y: r.y, rowH: r.h, rowIdx: rowIdx, task: t,
        milestone: t.milestone
      };
      state.renderIndex[t.id] = entry;

      if (t.milestone) {
        var size = Math.min(r.h - 8, 22);
        var mel = ce("div", "eg-mile" + (canEdit ? "" : " ro"), bars);
        mel.dataset.id = t.id;
        mel.style.width = size + "px";
        mel.style.height = size + "px";
        mel.style.top = (r.y + (r.h - size) / 2) + "px";
        mel.style.left = (x(t.s) + ppd / 2 - size / 2) + "px";
        mel.style.setProperty("--c", c);
        ce("div", "eg-mile-shape", mel);
        var ml = ce("div", "eg-lbl-m", mel);
        ml.textContent = t.name;
        if (canEdit) ce("div", "eg-dot", mel);
        entry.el = mel; entry.size = size;
      } else {
        var bw = Math.max(4, (t.e - t.s + 1) * ppd - 2);
        var bar = ce("div", "eg-bar" + (canEdit ? "" : " ro"), bars);
        bar.dataset.id = t.id;
        bar.style.left = (x(t.s) + 1) + "px";
        bar.style.width = bw + "px";
        bar.style.top = (r.y + (r.h - barH) / 2) + "px";
        bar.style.height = barH + "px";
        bar.style.setProperty("--c", c);
        if (t.progress > 0) {
          var prog = ce("div", "eg-prog" + (t.progress >= 100 ? " full" : ""), bar);
          prog.style.width = t.progress + "%";
        }
        var fits = bw > (t.name.length * 6.2 + 22);
        if (fits) {
          var lbl = ce("div", "eg-lbl", bar);
          lbl.textContent = t.name;
          if (t.progress >= 100) {
            var chk = ce("span", "eg-done", lbl);
            chk.textContent = "✓";
          }
        } else {
          var out = ce("div", "eg-lbl-out", bars);
          out.textContent = t.name;
          out.style.left = (x(t.e + 1) + 7) + "px";
          out.style.top = (r.y + r.h / 2) + "px";
          entry.outEl = out;
        }
        if (canEdit) {
          ce("div", "eg-handle eg-handle-l", bar);
          ce("div", "eg-handle eg-handle-r", bar);
          ce("div", "eg-dot", bar);
        }
        entry.el = bar;
      }
    });

    /* ----- sidebar rows ----- */
    sideRows.style.height = rowsH + "px";
    rows.forEach(function (r, rowIdx) {
      if (r.kind === "group") {
        var gRow = ce("div", "eg-srow eg-sgroup" + (r.collapsed ? " collapsed" : ""), sideRows);
        gRow.style.top = r.y + "px";
        gRow.style.height = r.h + "px";
        var chev = ce("span", "eg-chev", gRow);
        chev.innerHTML = ICONS.chev;
        var gn = ce("span", "eg-sgroup-name", gRow);
        gn.textContent = r.g.name || "Ungrouped";
        var gc = ce("span", "eg-sgroup-count", gRow);
        gc.textContent = String(r.g.tasks.length);
        if (canEdit) {
          var ga = ce("button", "eg-gadd", gRow);
          ga.type = "button"; ga.textContent = "+"; ga.title = "Add task to " + (r.g.name || "group");
          ga.addEventListener("click", function (ev) {
            ev.stopPropagation();
            addTask(ctx, r.g.name);
          });
        }
        gRow.addEventListener("click", function () {
          state.collapsed[r.g.name] = !state.collapsed[r.g.name];
          renderAll(ctx);
        });
        return;
      }
      var t = r.t;
      var sRow = ce("div", "eg-srow", sideRows);
      sRow.style.top = r.y + "px";
      sRow.style.height = r.h + "px";
      sRow.dataset.row = rowIdx;
      sRow.dataset.id = t.id;
      var dot = ce("span", "eg-srow-dot", sRow);
      dot.style.background = colorOf(t);
      if (t.milestone) dot.style.transform = "rotate(45deg)";
      var nm = ce("span", "eg-srow-name", sRow);
      nm.textContent = t.name;
      var meta = ce("span", "eg-srow-meta", sRow);
      meta.textContent = t.milestone ? fmtShort(t.s) : ((t.e - t.s + 1) + "d");
      if (canEdit) {
        sRow.addEventListener("dblclick", function () {
          startInlineRename(ctx, sRow, t);
        });
      }
    });

    /* ================= link drawing ================= */
    function barAnchors(entry) {
      if (entry.milestone) {
        var cx = x(entry.s) + ppd / 2;
        return {
          x1: cx + entry.size / 2 + 2, x2: cx - entry.size / 2 - 2,
          cy: entry.y + entry.rowH / 2
        };
      }
      return {
        x1: x(entry.e + 1) - 1, x2: x(entry.s) + 1,
        cy: entry.y + entry.rowH / 2
      };
    }

    function drawLinks() {
      /* clear all except defs */
      Array.prototype.slice.call(linksSvg.childNodes).forEach(function (n) {
        if (n !== defs) n.remove();
      });
      var oldChip = canvas.querySelector(".eg-linkchip");
      if (oldChip) oldChip.remove();
      if (props.showLinks === false || dataMode) return;

      tasks.forEach(function (t) {
        (t.deps || []).forEach(function (depId) {
          var pe = state.renderIndex[depId], se = state.renderIndex[t.id];
          if (!pe || !se) return;
          var a = barAnchors(pe), b = barAnchors(se);
          var x1 = a.x1, y1 = a.cy, x2 = b.x2 - 3, y2 = b.cy;
          var dx = Math.max(26, Math.abs(x2 - x1) / 2);
          var d = "M" + x1 + " " + y1 +
            " C" + (x1 + dx) + " " + y1 + " " + (x2 - dx) + " " + y2 +
            " " + x2 + " " + y2;
          var sel = state.selLink && state.selLink.pred === depId && state.selLink.succ === t.id;
          var vis = svgEl("path");
          vis.setAttribute("d", d);
          vis.setAttribute("fill", "none");
          vis.setAttribute("stroke", sel ? "#4a7cf6" : "#9aa4bd");
          vis.setAttribute("stroke-width", sel ? "2.2" : "1.5");
          vis.setAttribute("marker-end", "url(#" + markerId + ")");
          linksSvg.appendChild(vis);
          if (canEdit) {
            var hit = svgEl("path");
            hit.setAttribute("d", d);
            hit.setAttribute("fill", "none");
            hit.setAttribute("stroke", "transparent");
            hit.setAttribute("stroke-width", "11");
            hit.setAttribute("class", "eg-link");
            hit.addEventListener("click", function (ev) {
              ev.stopPropagation();
              state.selLink = { pred: depId, succ: t.id };
              drawLinks();
              var chip = ce("div", "eg-linkchip", canvas);
              chip.textContent = "Remove link";
              chip.style.left = ((x1 + x2) / 2) + "px";
              chip.style.top = (HEAD + (y1 + y2) / 2 - 16) + "px";
              chip.addEventListener("click", function (e2) {
                e2.stopPropagation();
                var nd = deepClone(currentData(layout, state));
                var succ = nd.tasks.filter(function (q) { return q.id === t.id; })[0];
                if (succ) succ.deps = (succ.deps || []).filter(function (q) { return q !== depId; });
                commit(ctx, nd);
              });
            });
            linksSvg.appendChild(hit);
          }
        });
      });
    }
    drawLinks();

    /* ----- empty state (managed, no tasks) ----- */
    if (!tasks.length && canEdit) {
      var empty = ce("div", "eg-empty", tl);
      empty.style.position = "sticky";
      empty.style.left = "0";
      empty.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 6h9M4 12h13M4 18h7"/><rect x="15" y="4" width="6" height="4" rx="2" fill="currentColor" stroke="none" opacity=".35"/><rect x="10" y="10" width="9" height="4" rx="2" fill="currentColor" stroke="none" opacity=".55"/><rect x="13" y="16" width="7" height="4" rx="2" fill="currentColor" stroke="none" opacity=".35"/></svg>';
      var h3 = ce("h3", null, empty); h3.textContent = "Plan your project";
      var pp = ce("p", null, empty);
      pp.textContent = "Add tasks and shape the timeline right here on the sheet — drag bars to reschedule as things change.";
      var eb = ce("button", "eg-btn eg-btn-primary", empty);
      eb.type = "button"; eb.textContent = "Add your first task";
      eb.addEventListener("click", function () { addTask(ctx, null); });
    }

    /* ================= scrolling ================= */
    tl.addEventListener("scroll", function () {
      state.sl = tl.scrollLeft; state.st = tl.scrollTop;
      sideRows.style.transform = "translateY(" + (-tl.scrollTop) + "px)";
    });
    tl.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var rect = tl.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var day = minDn + (tl.scrollLeft + px) / ppd;
      state.ppd = clampNum(ppd * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1.2, 60);
      state.pendingAnchor = { day: day, px: px };
      renderAll(ctx);
    }, { passive: false });

    /* row hover sync */
    function setHover(rowIdx, on) {
      var a = bg.querySelector('.eg-rowbg[data-row="' + rowIdx + '"]');
      var b = sideRows.querySelector('.eg-srow[data-row="' + rowIdx + '"]');
      [a, b].forEach(function (n) { if (n) n.classList.toggle("hov", on); });
    }
    [bg, sideRows].forEach(function (host) {
      host.addEventListener("mouseover", function (e) {
        var n = e.target.closest("[data-row]");
        if (n) setHover(n.dataset.row, true);
      });
      host.addEventListener("mouseout", function (e) {
        var n = e.target.closest("[data-row]");
        if (n) setHover(n.dataset.row, false);
      });
    });

    /* ================= tooltip ================= */
    function removeTip() {
      if (state.hoverTimer) { clearTimeout(state.hoverTimer); state.hoverTimer = null; }
      var tip = root.querySelector(".eg-tip");
      if (tip) tip.remove();
    }
    bars.addEventListener("mouseover", function (e) {
      var bel = e.target.closest(".eg-bar, .eg-mile");
      if (!bel || state.dragging || root.querySelector(".eg-pop")) return;
      removeTip();
      state.hoverTimer = setTimeout(function () {
        var t = taskById[bel.dataset.id];
        if (!t) return;
        var tip = ce("div", "eg-tip", root);
        tip.style.setProperty("--c", colorOf(t));
        var tn = ce("div", "eg-tip-name", tip); tn.textContent = t.name;
        var r1 = ce("div", "eg-tip-row", tip);
        if (t.group) {
          var gchip = ce("span", "eg-tip-chip", r1);
          gchip.textContent = t.group;
        }
        var dr = ce("span", null, r1);
        dr.textContent = t.milestone ? fmtShort(t.s)
          : fmtRange(t.s, t.e) + " · " + (t.e - t.s + 1) + "d";
        if (!t.milestone) {
          var r2 = ce("div", "eg-tip-row", tip);
          var pb = ce("span", "eg-tip-progbar", r2);
          var pf = document.createElement("i");
          pf.style.width = t.progress + "%";
          pb.appendChild(pf);
          var pv = ce("span", null, r2);
          pv.textContent = t.progress + "%";
        }
        if (t.notes) {
          var nn = ce("div", "eg-tip-notes", tip);
          nn.textContent = t.notes.length > 180 ? t.notes.slice(0, 180) + "…" : t.notes;
        }
        var rootRect = root.getBoundingClientRect();
        var bRect = bel.getBoundingClientRect();
        var left = clampNum(bRect.left - rootRect.left, 8, rootRect.width - 246);
        var top = bRect.top - rootRect.top - tip.offsetHeight - 8;
        if (top < 44) top = bRect.bottom - rootRect.top + 8;
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      }, 300);
    });
    bars.addEventListener("mouseout", function (e) {
      if (e.target.closest(".eg-bar, .eg-mile")) removeTip();
    });

    /* ================= drag interactions ================= */
    function rowTaskAtY(yy) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.kind === "task" && yy >= r.y && yy < r.y + r.h) return r.t;
      }
      return null;
    }

    function applyEntryGeometry(entry) {
      var t = entry.task;
      if (entry.milestone) {
        entry.el.style.left = (x(entry.s) + ppd / 2 - entry.size / 2) + "px";
      } else {
        entry.el.style.left = (x(entry.s) + 1) + "px";
        entry.el.style.width = Math.max(4, (entry.e - entry.s + 1) * ppd - 2) + "px";
        if (entry.outEl) entry.outEl.style.left = (x(entry.e + 1) + 7) + "px";
      }
    }

    bars.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var bel = e.target.closest(".eg-bar, .eg-mile");
      if (!bel) return;
      var id = bel.dataset.id;
      var entry = state.renderIndex[id];
      if (!entry) return;
      removeTip();

      var mode = "move";
      if (e.target.classList.contains("eg-handle-l")) mode = "l";
      else if (e.target.classList.contains("eg-handle-r")) mode = "r";
      else if (e.target.classList.contains("eg-dot")) mode = "link";

      e.preventDefault();
      root.focus({ preventScroll: true });
      state.uiLock = true;
      state.dragging = true;
      var drag = {
        mode: mode, id: id, x0: e.clientX, y0: e.clientY,
        s0: entry.s, e0: entry.e, moved: false, hint: null,
        tempPath: null, target: null
      };
      try { bel.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

      function canvasPoint(ev) {
        var rect = canvas.getBoundingClientRect();
        return { cx: ev.clientX - rect.left, cy: ev.clientY - rect.top - HEAD };
      }

      function onMove(ev) {
        var dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          drag.moved = true;
          bel.classList.add("dragging");
        }
        if (!drag.moved) return;

        if (drag.mode === "link") {
          if (!canEdit) return;
          var pt = canvasPoint(ev);
          if (!drag.tempPath) {
            drag.tempPath = svgEl("path");
            drag.tempPath.setAttribute("fill", "none");
            drag.tempPath.setAttribute("stroke", "#4a7cf6");
            drag.tempPath.setAttribute("stroke-width", "1.8");
            drag.tempPath.setAttribute("stroke-dasharray", "5 4");
            linksSvg.appendChild(drag.tempPath);
          }
          var a = barAnchors(entry);
          var dxx = Math.max(26, Math.abs(pt.cx - a.x1) / 2);
          drag.tempPath.setAttribute("d",
            "M" + a.x1 + " " + a.cy +
            " C" + (a.x1 + dxx) + " " + a.cy + " " + (pt.cx - dxx) + " " + pt.cy +
            " " + pt.cx + " " + pt.cy);
          var target = rowTaskAtY(pt.cy);
          if (drag.target && (!target || target.id !== drag.target.id)) {
            var prevEl = state.renderIndex[drag.target.id];
            if (prevEl && prevEl.el) prevEl.el.classList.remove("linktarget");
          }
          drag.target = (target && target.id !== id) ? target : null;
          if (drag.target) {
            var tEl = state.renderIndex[drag.target.id];
            if (tEl && tEl.el) tEl.el.classList.add("linktarget");
          }
          return;
        }

        if (!canEdit) return;
        var dd = Math.round(dx / ppd);
        var ns = drag.s0, ne = drag.e0;
        if (drag.mode === "move") { ns = drag.s0 + dd; ne = drag.e0 + dd; }
        else if (drag.mode === "l") { ns = Math.min(drag.s0 + dd, drag.e0); }
        else if (drag.mode === "r") { ne = Math.max(drag.e0 + dd, drag.s0); }
        entry.s = ns; entry.e = ne;
        applyEntryGeometry(entry);
        drawLinks();
        if (!drag.hint) drag.hint = ce("div", "eg-draghint", canvas);
        drag.hint.textContent = fmtRange(ns, ne);
        drag.hint.style.left = (x(ns) + ((ne - ns + 1) * ppd) / 2) + "px";
        drag.hint.style.top = (HEAD + entry.y - 4) + "px";
      }

      function onUp(ev) {
        bel.removeEventListener("pointermove", onMove);
        bel.removeEventListener("pointerup", onUp);
        bel.removeEventListener("pointercancel", onUp);
        bel.classList.remove("dragging");
        state.dragging = false;
        state.uiLock = false;
        if (drag.hint) drag.hint.remove();
        if (drag.tempPath) drag.tempPath.remove();
        if (drag.target) {
          var tEl = state.renderIndex[drag.target.id];
          if (tEl && tEl.el) tEl.el.classList.remove("linktarget");
        }

        if (drag.mode === "link" && drag.moved && canEdit) {
          if (drag.target) {
            var nd = deepClone(currentData(layout, state));
            var succ = nd.tasks.filter(function (q) { return q.id === drag.target.id; })[0];
            if (succ) {
              succ.deps = succ.deps || [];
              if (succ.deps.indexOf(id) >= 0) {
                toast(ctx, "Already linked");
                flushPending(ctx);
              } else if (dependsOn(nd.tasks, id, drag.target.id)) {
                toast(ctx, "That would create a loop");
                flushPending(ctx);
              } else {
                succ.deps.push(id);
                commit(ctx, nd);
                return;
              }
            }
          } else {
            flushPending(ctx);
          }
          return;
        }

        if (drag.moved && canEdit) {
          if (entry.s !== drag.s0 || entry.e !== drag.e0) {
            var nd2 = deepClone(currentData(layout, state));
            var tt = nd2.tasks.filter(function (q) { return q.id === id; })[0];
            if (tt) {
              tt.start = isoFromDn(entry.s);
              tt.end = isoFromDn(entry.e);
              commit(ctx, nd2);
              return;
            }
          }
          flushPending(ctx);
          return;
        }

        /* plain click */
        if (canEdit) {
          openEditor(ctx, id);
        } else if (dataMode && ctx.backendApi && ctx.backendApi.selectValues) {
          var t = taskById[id];
          if (t && t.qElem !== undefined && t.qElem >= 0) {
            ctx.backendApi.selectValues(0, [t.qElem], true);
          }
          flushPending(ctx);
        } else {
          flushPending(ctx);
        }
      }

      bel.addEventListener("pointermove", onMove);
      bel.addEventListener("pointerup", onUp);
      bel.addEventListener("pointercancel", onUp);
    });

    /* deselect link on background click */
    root.addEventListener("mousedown", function (e) {
      if (state.selLink && !e.target.closest(".eg-linkchip") && !e.target.closest(".eg-link")) {
        state.selLink = null;
        drawLinks();
      }
    });

    /* ================= keyboard ================= */
    root.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && canEdit) {
        var k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndoRedo(ctx, false); return; }
        if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); doUndoRedo(ctx, true); return; }
      }
      if (e.key === "Escape") {
        var pop = root.querySelector(".eg-pop");
        if (pop) { closeEditor(ctx, true); return; }
        if (state.selLink) { state.selLink = null; drawLinks(); }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && state.selLink && canEdit) {
        e.preventDefault();
        var nd = deepClone(currentData(layout, state));
        var succ = nd.tasks.filter(function (q) { return q.id === state.selLink.succ; })[0];
        if (succ) {
          succ.deps = (succ.deps || []).filter(function (q) { return q !== state.selLink.pred; });
          commit(ctx, nd);
        }
      }
    });

    /* ----- restore scroll / anchors ----- */
    if (state.pendingAnchor) {
      var an = state.pendingAnchor;
      state.pendingAnchor = null;
      tl.scrollLeft = clampNum((an.day - minDn) * ppd - an.px, 0, totalW);
      tl.scrollTop = state.st || 0;
    } else if (!state.firstRendered) {
      if (today >= minDn && today <= maxDn) {
        tl.scrollLeft = clampNum(x(today) - viewW * 0.35, 0, totalW);
      }
    } else {
      tl.scrollLeft = state.sl || 0;
      tl.scrollTop = state.st || 0;
    }
    sideRows.style.transform = "translateY(" + (-tl.scrollTop) + "px)";
    state.firstRendered = true;

    /* keep context for editor/rename helpers */
    ctx.root = root;
    ctx.tl = tl;
    ctx.taskById = taskById;
    ctx.colorOf = colorOf;
    ctx.canEdit = !!canEdit;
    ctx.drawLinks = drawLinks;
    state.lastCtx = ctx;

    /* re-open editor for a just-added task */
    if (state.editAfterRender) {
      var eid = state.editAfterRender;
      state.editAfterRender = null;
      var en = state.renderIndex[eid];
      if (en) {
        tl.scrollLeft = clampNum(x(en.s) - viewW * 0.3, 0, totalW);
        tl.scrollTop = clampNum(en.y - viewH / 2, 0, Math.max(0, rowsH - viewH + HEAD));
        sideRows.style.transform = "translateY(" + (-tl.scrollTop) + "px)";
        openEditor(ctx, eid);
      }
    }
  }

  function flushPending(ctx) {
    var state = ctx.state;
    if (state.pendingLayout) {
      var l = state.pendingLayout;
      state.pendingLayout = null;
      renderAll({ el: ctx.el, layout: l, state: state, backendApi: ctx.backendApi });
    }
  }

  /* ================= add task ================= */
  function addTask(ctx, groupName) {
    var state = ctx.state;
    var data = deepClone(currentData(ctx.layout, state));
    var t0 = todayDn();
    var s = t0, e = t0 + 4;
    var insertAt = data.tasks.length;
    if (groupName) {
      var lastIdx = -1, lastEnd = -Infinity;
      data.tasks.forEach(function (t, i) {
        if ((t.group || "") === groupName) {
          lastIdx = i;
          var en = dnFromISO(t.end) || dnFromISO(t.start);
          if (en !== null && en > lastEnd) lastEnd = en;
        }
      });
      if (lastIdx >= 0) {
        insertAt = lastIdx + 1;
        if (isFinite(lastEnd)) { s = lastEnd + 1; e = s + 4; }
      }
    }
    var nt = {
      id: newId(), name: "New task", group: groupName || "",
      start: isoFromDn(s), end: isoFromDn(e), progress: 0, deps: []
    };
    data.tasks.splice(insertAt, 0, nt);
    state.editAfterRender = nt.id;
    commit(ctx, data);
  }

  /* ================= inline rename (sidebar) ================= */
  function startInlineRename(ctx, rowEl, t) {
    var state = ctx.state;
    var nameEl = rowEl.querySelector(".eg-srow-name");
    if (!nameEl) return;
    state.uiLock = true;
    var input = document.createElement("input");
    input.type = "text";
    input.value = t.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function finish(saveIt) {
      if (done) return;
      done = true;
      state.uiLock = false;
      var v = input.value.trim();
      if (saveIt && v && v !== t.name) {
        var nd = deepClone(currentData(ctx.layout, state));
        var tt = nd.tasks.filter(function (q) { return q.id === t.id; })[0];
        if (tt) { tt.name = v; commit(ctx, nd); return; }
      }
      flushPending(ctx);
      renderAll(ctx);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  /* ================= editor popover ================= */
  function closeEditor(ctx, commitIfChanged) {
    var state = ctx.state;
    var root = ctx.root;
    if (!root) return;
    var pop = root.querySelector(".eg-pop");
    if (!pop) return;
    var draft = pop._draft, original = pop._original;
    if (pop._outside) root.removeEventListener("mousedown", pop._outside, true);
    pop.remove();
    state.uiLock = false;
    if (commitIfChanged && draft && JSON.stringify(draft) !== JSON.stringify(original)) {
      var nd = deepClone(currentData(ctx.layout, state));
      var idx = -1;
      nd.tasks.forEach(function (q, i) { if (q.id === draft.id) idx = i; });
      if (idx >= 0) { nd.tasks[idx] = draft; commit(ctx, nd); return; }
    }
    flushPending(ctx);
  }

  function openEditor(ctx, id) {
    var state = ctx.state;
    var root = ctx.root;
    closeEditor(ctx, true);
    var data = currentData(ctx.layout, state);
    var original = data.tasks.filter(function (q) { return q.id === id; })[0];
    if (!original) return;
    var draft = deepClone(original);
    draft.deps = draft.deps || [];
    state.uiLock = true;

    var pop = ce("div", "eg-pop", root);
    pop._draft = draft;
    pop._original = deepClone(original);

    function field(labelText) {
      var l = ce("label", null, pop);
      l.textContent = labelText;
      return l;
    }

    /* name */
    field("Task name");
    var nameIn = ce("input", null, pop);
    nameIn.type = "text";
    nameIn.value = draft.name || "";
    nameIn.addEventListener("input", function () { draft.name = nameIn.value; });

    /* dates */
    field("Dates");
    var dates = ce("div", "eg-pop-dates", pop);
    var dsWrap = ce("div", null, dates), deWrap = ce("div", null, dates);
    var dsIn = ce("input", null, dsWrap); dsIn.type = "date"; dsIn.value = draft.start || "";
    var deIn = ce("input", null, deWrap); deIn.type = "date"; deIn.value = draft.end || draft.start || "";
    deIn.disabled = !!draft.milestone;
    dsIn.addEventListener("change", function () {
      if (!dsIn.value) return;
      draft.start = dsIn.value;
      if (draft.milestone || (draft.end && draft.end < draft.start)) {
        draft.end = draft.start; deIn.value = draft.start;
      }
    });
    deIn.addEventListener("change", function () {
      if (!deIn.value) return;
      draft.end = deIn.value;
      if (draft.start && draft.end < draft.start) {
        draft.start = draft.end; dsIn.value = draft.end;
      }
    });

    /* milestone */
    var msLabel = ce("label", "eg-check", pop);
    var msIn = ce("input", null, msLabel);
    msIn.type = "checkbox";
    msIn.checked = !!draft.milestone;
    var msTxt = document.createElement("span");
    msTxt.textContent = "Milestone (single date)";
    msLabel.appendChild(msTxt);
    msIn.addEventListener("change", function () {
      draft.milestone = msIn.checked;
      deIn.disabled = msIn.checked;
      if (msIn.checked) { draft.end = draft.start; deIn.value = draft.start || ""; }
    });

    /* progress */
    field("Progress");
    var progRow = ce("div", "eg-pop-prog", pop);
    var progIn = ce("input", null, progRow);
    progIn.type = "range"; progIn.min = "0"; progIn.max = "100"; progIn.step = "5";
    progIn.value = String(draft.progress || 0);
    var progVal = ce("span", "eg-pv", progRow);
    progVal.textContent = (draft.progress || 0) + "%";
    progIn.addEventListener("input", function () {
      draft.progress = +progIn.value;
      progVal.textContent = progIn.value + "%";
    });

    /* group */
    field("Group");
    var grpIn = ce("input", null, pop);
    grpIn.type = "text";
    grpIn.value = draft.group || "";
    grpIn.placeholder = "e.g. Design";
    var dlId = "eg-dl-" + id;
    grpIn.setAttribute("list", dlId);
    var dl = ce("datalist", null, pop);
    dl.id = dlId;
    var seenG = {};
    data.tasks.forEach(function (t) {
      var g = t.group || "";
      if (g && !seenG[g]) {
        seenG[g] = 1;
        var o = document.createElement("option");
        o.value = g;
        dl.appendChild(o);
      }
    });
    grpIn.addEventListener("input", function () { draft.group = grpIn.value.trim(); });

    /* color */
    field("Color");
    var sw = ce("div", "eg-swatches", pop);
    function markSel() {
      Array.prototype.forEach.call(sw.children, function (b) {
        b.classList.toggle("sel", (b._c || null) === (draft.color || null));
      });
    }
    var autoB = ce("button", "eg-sw eg-sw-auto", sw);
    autoB.type = "button"; autoB.title = "Automatic"; autoB._c = null;
    autoB.addEventListener("click", function () { draft.color = null; markSel(); });
    PALETTE.forEach(function (c) {
      var b = ce("button", "eg-sw", sw);
      b.type = "button"; b.style.background = c; b._c = c; b.title = c;
      b.addEventListener("click", function () { draft.color = c; markSel(); });
    });
    markSel();

    /* dependencies */
    field("Depends on");
    var depsBox = ce("div", "eg-deps", pop);
    function nameOf(tid) {
      var t = data.tasks.filter(function (q) { return q.id === tid; })[0];
      return t ? t.name : "(deleted)";
    }
    function renderDeps() {
      depsBox.innerHTML = "";
      draft.deps.forEach(function (d) {
        var row = ce("div", "eg-dep", depsBox);
        var sp = ce("span", null, row); sp.textContent = nameOf(d);
        var xb = ce("button", null, row); xb.type = "button"; xb.textContent = "×";
        xb.addEventListener("click", function () {
          draft.deps = draft.deps.filter(function (q) { return q !== d; });
          renderDeps();
        });
      });
      var sel = ce("select", null, depsBox);
      var o0 = document.createElement("option");
      o0.value = ""; o0.textContent = "+ Add dependency…";
      sel.appendChild(o0);
      data.tasks.forEach(function (t) {
        if (t.id === id || draft.deps.indexOf(t.id) >= 0) return;
        var o = document.createElement("option");
        o.value = t.id; o.textContent = t.name;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () {
        if (!sel.value) return;
        if (dependsOn(data.tasks, sel.value, id)) {
          toast(ctx, "That would create a loop");
          sel.value = "";
          return;
        }
        draft.deps.push(sel.value);
        renderDeps();
      });
    }
    renderDeps();

    /* notes */
    field("Notes");
    var notesIn = ce("textarea", null, pop);
    notesIn.rows = 2;
    notesIn.value = draft.notes || "";
    notesIn.addEventListener("input", function () { draft.notes = notesIn.value; });

    /* footer */
    var foot = ce("div", "eg-pop-foot", pop);
    var delBtn = ce("button", "eg-pop-del", foot);
    delBtn.type = "button"; delBtn.textContent = "Delete";
    delBtn.addEventListener("click", function () {
      if (!delBtn._armed) {
        delBtn._armed = true;
        delBtn.textContent = "Confirm delete?";
        return;
      }
      var nd = deepClone(currentData(ctx.layout, state));
      nd.tasks = nd.tasks.filter(function (q) { return q.id !== id; });
      nd.tasks.forEach(function (t) {
        t.deps = (t.deps || []).filter(function (d) { return d !== id; });
      });
      pop._draft = null;
      closeEditor(ctx, false);
      commit(ctx, nd);
    });
    var doneBtn = ce("button", "eg-pop-done", foot);
    doneBtn.type = "button"; doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", function () { closeEditor(ctx, true); });

    /* position near the bar */
    var entry = state.renderIndex[id];
    var rootRect = root.getBoundingClientRect();
    var left = 20, top = 60;
    if (entry && entry.el) {
      var bRect = entry.el.getBoundingClientRect();
      left = clampNum(bRect.left - rootRect.left, 8, Math.max(8, rootRect.width - 288));
      top = bRect.bottom - rootRect.top + 10;
    }
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    /* flip above if overflowing */
    var overflow = (top + pop.offsetHeight) - rootRect.height;
    if (overflow > 0 && entry && entry.el) {
      var bRect2 = entry.el.getBoundingClientRect();
      var above = bRect2.top - rootRect.top - pop.offsetHeight - 10;
      pop.style.top = Math.max(8, above > 44 ? above : top - overflow - 8) + "px";
    }

    /* outside click closes */
    var outside = function (e) {
      if (!pop.contains(e.target)) closeEditor(ctx, true);
    };
    pop._outside = outside;
    setTimeout(function () {
      root.addEventListener("mousedown", outside, true);
    }, 0);

    nameIn.focus();
    nameIn.select();
  }

  /* ================= extension interface ================= */
  return {
    initialProperties: {
      version: 1.0,
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: [],
        qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 6, qHeight: 1500 }],
        qSuppressMissing: true
      },
      props: {
        mode: "managed",
        density: "comfortable",
        colorMode: "group",
        weekStart: 1,
        showToday: true,
        shadeWeekends: true,
        showLinks: true,
        sidebarWidth: 230
      },
      ganttData: buildSample(),
      showTitles: true,
      title: "Project timeline"
    },
    definition: properties,
    support: { snapshot: true, export: true, exportData: true },
    paint: function ($element, layout) {
      var el = $element[0] || $element;
      var state = getState(layout.qInfo ? layout.qInfo.qId : "x");
      var ctx = {
        el: el, layout: layout, state: state,
        backendApi: this.backendApi
      };
      if (state.uiLock) {
        /* an editor or drag is active — defer this paint */
        state.pendingLayout = layout;
        return;
      }
      renderAll(ctx);
    }
  };
});
