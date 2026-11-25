// Fundraising Report: a page with no server of its own.
//
// It signs the person in to engine9 (connectMcp: Delegate, then the server's
// consent screen), lets them pick an account, and calls engine9 MCP tools as
// that person:
//   report run  — the Fundraising Reports (fundraising-report-plugin/reports),
//                 by path when installed on the account, else by definition
//   sql         — reads and writes the fundraising_report_* tables (summaries
//                 and notes), with the person's own engine9 permissions
//   user        — who is signed in, for the author of a note
// The page stores nothing itself. Every figure comes from a report run on
// page load; notes live in the account's own database.
(function () {
  const CFG = Object.assign(
    { servers: ['https://data.engine9.ai/mcp'], pluginPath: 'fundraising-report-plugin/reports' },
    window.FR_CONFIG || {}
  );
  const DEFS = window.FR_DEFINITIONS || {};
  const PERIODS = { ytd: 'Year to date', qtd: 'FEC quarter to date', mtd: 'Month to date', '30d': 'Past 30 days' };
  const $ = (sel, root = document) => root.querySelector(sel);

  const mcp = engine9Id.connectMcp({ servers: CFG.servers });
  const params = new URLSearchParams(location.search);
  const state = {
    period: PERIODS[params.get('period')] ? params.get('period') : 'ytd',
    tab: (location.hash || '#transactions').slice(1),
    account: null,
    accountName: '',
    installed: null, // Set of report keys installed on the account, or empty
    cache: new Map(),
    loadId: 0,
  };

  // ---- Dates -----------------------------------------------------------------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const lastYear = (d) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());

  /** The period and the same dates a year earlier, as [start, end) ISO dates. */
  function windows(period, today = new Date()) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let start;
    if (period === '30d') start = addDays(t, -29);
    else if (period === 'mtd') start = new Date(t.getFullYear(), t.getMonth(), 1);
    else if (period === 'qtd') start = new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1);
    else start = new Date(t.getFullYear(), 0, 1);
    const end = addDays(t, 1);
    return {
      ty: { start: iso(start), end: iso(end) },
      ly: { start: iso(lastYear(start)), end: iso(lastYear(end)) },
    };
  }
  window.frWindows = windows; // for tests

  // ---- engine9 calls -----------------------------------------------------------
  async function call(tool, args) {
    try {
      return await mcp.call(tool, args);
    } catch (err) {
      if (engine9Id.isMcpSignedOut && engine9Id.isMcpSignedOut(err)) signedOut();
      throw err;
    }
  }

  async function detectInstalled() {
    try {
      const list = await call('report', { command: 'list' });
      const prefix = CFG.pluginPath + ':reports:';
      return new Set((list.reports || []).map((r) => r.path).filter((p) => p && p.startsWith(prefix)).map((p) => p.slice(prefix.length)));
    } catch {
      return new Set();
    }
  }

  /** Run one report; returns { componentId: rows }. Cached per account and options. */
  async function run(key, options) {
    const cacheKey = JSON.stringify([state.account, key, options]);
    if (!state.cache.has(cacheKey)) {
      const args = state.installed && state.installed.has(key)
        ? { command: 'run', path: `${CFG.pluginPath}:reports:${key}`, options }
        : { command: 'run', definition: DEFS[key], options };
      const p = call('report', args).then((res) => {
        const out = {};
        for (const s of res.sections || []) for (const c of s.components || []) out[c.id] = c.data || [];
        return out;
      });
      p.catch(() => state.cache.delete(cacheKey));
      state.cache.set(cacheKey, p);
    }
    return state.cache.get(cacheKey);
  }
  const both = (key, w, extra = {}) => Promise.all([run(key, { ...w.ty, ...extra }), run(key, { ...w.ly, ...extra })]);
  const firstGifts = (key, win) => {
    const after = iso(addDays(new Date(win.start + 'T00:00:00'), -1)) + ' 23:59:59';
    return run(key, { first_after: after, first_before: win.end });
  };

  // ---- Formatting ----------------------------------------------------------------
  const num = (v) => (v == null || v === '' ? NaN : +v);
  const div = (a, b) => (num(b) ? num(a) / num(b) : NaN);
  const fmt = {
    money: (v) => (isNaN(v) ? '—' : Math.abs(v) >= 1e5 ? (v < 0 ? '-$' : '$') + Math.round(Math.abs(v) / 1000).toLocaleString('en-US') + 'K' : '$' + Math.round(v).toLocaleString('en-US')),
    money2: (v) => (isNaN(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    int: (v) => (isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US')),
    // Same abbreviation rule as fmt.money, for counts: 100,000 and up reads as 482K.
    count: (v) => (isNaN(v) ? '—' : Math.abs(v) >= 1e5 ? (v < 0 ? '-' : '') + Math.round(Math.abs(v) / 1000).toLocaleString('en-US') + 'K' : Math.round(v).toLocaleString('en-US')),
    pct: (v) => (isNaN(v) ? '—' : (v * 100).toFixed(v < 0.1 && v > -0.1 ? 1 : 0) + '%'),
    pct2: (v) => (isNaN(v) ? '—' : (v * 100).toFixed(2) + '%'),
    change: (v) => (isNaN(v) || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(0) + '%'),
    month: (v) => (v ? new Date(String(v).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : ''),
    day: (v) => (v ? new Date(String(v).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'),
  };
  const change = (a, b) => (num(b) ? (num(a) - num(b)) / num(b) : NaN);

  // ---- Building blocks (textContent only: data never becomes HTML) ---------------
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return e;
  }

  function tile(label, ty, ly, format, { lowerIsBetter = false, note } = {}) {
    const ch = change(ty, ly);
    const cls = isNaN(ch) || ch === 0 ? '' : (ch > 0) !== lowerIsBetter ? 'ef-good' : 'ef-bad';
    return el('div', { class: 'ef-card' },
      el('div', { class: 'ef-tile-label', text: label }),
      el('div', { class: `ef-tile-value ${cls} ${isNaN(ch) || ch === 0 ? '' : ch > 0 ? 'ef-up' : 'ef-down'}`, text: format(num(ty)) }),
      el('div', { class: 'ef-tile-note', text: note || `Same dates last year ${format(num(ly))}` }));
  }

  function bars(rows, xKey, yKey, format, xFormat = fmt.month, sub) {
    if (!rows.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const max = Math.max(...rows.map((r) => num(r[yKey]) || 0), 1);
    const cols = rows.map((r) => el('div', { class: 'ef-bar-col', title: `${xFormat(r[xKey])}: ${format(num(r[yKey]))}` },
      el('div', { class: 'ef-bar-top', text: format(num(r[yKey])) }),
      el('div', { class: 'ef-bar', style: `height:${Math.max(1, ((num(r[yKey]) || 0) / max) * 170)}px;background:var(--ef-accent)` })));
    return el('div', { class: 'ef-chart' },
      el('div', { class: 'ef-bars', role: 'img', 'aria-label': 'Bar chart' }, cols),
      axisRow(rows, xKey, xFormat, sub));
  }

  // ---- More chart types (DOM/SVG built with textContent only) ----------------------
  const PALETTE = ['var(--ef-accent)', '#5b7c99', '#c9a227', '#8a6bbf', '#7a8581'];
  const legend = (items) => el('div', { class: 'ef-legend' }, items.map((i) => el('span', {},
    el('i', { class: i.line ? 'ef-key ef-key-ly' : 'ef-key', style: i.line ? null : `background:${i.color}` }), i.label)));
  const axisRow = (rows, xKey, xFormat, sub) => el('div', { class: 'ef-axis' }, rows.map((r) =>
    el('div', {}, xFormat(r[xKey]), sub ? el('b', { class: 'ef-sub-fig', text: sub(r) }) : null)));

  // "View chart data as a table" under every chart.
  function dataTable(columns, rows) {
    return el('details', { class: 'ef-alt' }, el('summary', { text: 'View chart data as a table' }), table(columns, rows));
  }

  // Bars on a scale: gridlines with labels, no numbers on the bars, the exact value on hover.
  // series: [{ key, label, color }] (several series sit side by side); xLabel(row, i) is the short axis text.
  const niceMax = (v) => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  function scaledBars(rows, series, { xLabel, tip, format, reference, referenceLabel, over, height = 200 }) {
    if (!rows.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const vals = rows.flatMap((r) => series.map((x) => num(r[x.key]))).filter((v) => !isNaN(v));
    const top = niceMax(Math.max(...vals, reference || 0, 1e-9) * 1.05);
    const step = Math.ceil(rows.length / 18);
    const grid = [0, 1, 2, 3, 4].map((g) => el('div', { class: 'ef-grid', style: `bottom:${g * 25}%` }, el('span', { class: 'ef-grid-label', text: format((top / 4) * g) })));
    const refLine = reference != null && !isNaN(reference) ? el('div', { class: 'ef-ref', style: `bottom:${(reference / top) * 100}%` }, el('span', { text: referenceLabel })) : null;
    const cols = rows.map((r, i) => el('div', { class: 'ef-bar-col ef-hovercol' + (i < rows.length * 0.15 ? ' ef-tip-left' : i > rows.length * 0.85 ? ' ef-tip-right' : ''), tabindex: '0' },
      el('div', { class: 'ef-group' }, series.map((x) => {
        const v = num(r[x.key]);
        return el('div', { class: 'ef-bar', style: `height:${isNaN(v) ? 0 : Math.max(v > 0 ? 2 : 0, (v / top) * height)}px;background:${over && over(r, x) ? 'var(--color-bad)' : x.color}` });
      })),
      el('div', { class: 'ef-hover', role: 'tooltip', text: tip(r, i) })));
    return el('div', { class: 'ef-chart' },
      el('div', { class: 'ef-plot ef-has-axis', style: `height:${height}px` }, grid, refLine, el('div', { class: 'ef-bars ef-scaled', style: `height:${height}px` }, cols)),
      el('div', { class: 'ef-axis ef-has-axis' }, rows.map((r, i) => el('div', { text: i % step === 0 ? xLabel(r, i) : '' }))),
      series.length > 1 ? legend(series.map((x) => ({ label: x.label, color: x.color }))) : null);
  }

  // Revenue by week: week number on the axis, the total on hover only.
  function weekly(rows) {
    const sorted = (rows || []).slice().sort((a, b) => String(a.week).localeCompare(String(b.week))).map((r, i) => ({ ...r, n: i + 1, v: num(r.revenue) }));
    return el('div', {},
      scaledBars(sorted, [{ key: 'v', label: 'Revenue', color: PALETTE[0] }], { xLabel: (r) => String(r.n), tip: (r) => `Week ${r.n} (from ${fmt.day(r.week)}): ${fmt.money(r.v)}`, format: fmt.money }),
      dataTable([{ label: 'Week', value: (r) => r.n }, { label: 'Starts', value: (r) => r.week, fmt: fmt.day }, { label: 'Revenue', value: (r) => r.v, fmt: fmt.money }], sorted));
  }

  // Weekly rate as bars on a scale. A reference line marks a limit or the average; weeks over `flagOver` turn red and are listed.
  function rateWeeks(rows, rateOf, { reference, referenceLabel, flagOver }) {
    const sorted = (rows || []).slice().sort((a, b) => String(a.week).localeCompare(String(b.week))).map((r, i) => ({ ...r, n: i + 1, rate: rateOf(r) }));
    const ok = sorted.filter((r) => !isNaN(r.rate));
    if (!ok.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const spikes = flagOver ? ok.filter((r) => r.rate > flagOver) : [];
    return el('div', {},
      scaledBars(sorted, [{ key: 'rate', label: 'Weekly rate', color: PALETTE[0] }], { xLabel: (r) => String(r.n), tip: (r) => `Week ${r.n} (from ${fmt.day(r.week)}): ${fmt.pct2(r.rate)}`, format: fmt.pct2, reference, referenceLabel, over: flagOver ? (r) => r.rate > flagOver : null }),
      spikes.length ? el('p', { class: 'ef-note' }, el('b', { text: 'Weeks to look at. ' }), spikes.map((r) => `Week ${r.n} (starts ${fmt.day(r.week)}, ${fmt.pct2(r.rate)})`).join('; ') + '.') : null,
      dataTable([{ label: 'Week', value: (r) => r.n }, { label: 'Starts', value: (r) => r.week, fmt: fmt.day }, { label: 'Rate', value: (r) => r.rate, fmt: fmt.pct2 }], sorted));
  }

  // Stacked bars. series: [{key,label,color}]; opts.ly = field holding same-period-last-year total.
  function stackedBars(rows, xKey, series, format, { xFormat = fmt.month, ly, sub, height = 170 } = {}) {
    if (!rows.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const tot = (r) => series.reduce((s, x) => s + (num(r[x.key]) || 0), 0);
    const max = Math.max(...rows.map((r) => Math.max(tot(r), ly ? num(r[ly]) || 0 : 0)), 1);
    const cols = rows.map((r) => el('div', { class: 'ef-bar-col', title: `${xFormat(r[xKey])}: ${format(tot(r))}` },
      el('div', { class: 'ef-bar-top', text: format(tot(r)) }),
      ly && num(r[ly]) ? el('div', { class: 'ef-ly-tick', style: `bottom:${(num(r[ly]) / max) * height}px` }) : null,
      ...series.slice().reverse().map((x, i, a) => el('div', { class: 'ef-bar', style: `height:${((num(r[x.key]) || 0) / max) * height}px;background:${x.color};${i === 0 ? 'border-radius:3px 3px 0 0' : 'border-radius:0'}` }))));
    return el('div', { class: 'ef-chart' },
      el('div', { class: 'ef-bars', role: 'img', 'aria-label': 'Stacked bar chart' }, cols),
      axisRow(rows, xKey, xFormat, sub),
      legend([...series.map((x) => ({ label: x.label, color: x.color })), ...(ly ? [{ label: 'Same period last year', line: true }] : [])]));
  }

  // Paired bars: two bars per x (for example cost beside revenue).
  function pairedBars(rows, xKey, [a, b], format, { xFormat = fmt.month, sub, height = 170 } = {}) {
    if (!rows.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const max = Math.max(...rows.flatMap((r) => [num(r[a.key]) || 0, num(r[b.key]) || 0]), 1);
    const one = (r, s) => el('div', { class: 'ef-pair-bar', title: `${xFormat(r[xKey])} ${s.label}: ${format(num(r[s.key]))}` },
      el('div', { class: 'ef-bar-top', text: format(num(r[s.key])) }),
      el('div', { class: 'ef-bar', style: `width:100%;height:${Math.max(1, ((num(r[s.key]) || 0) / max) * height)}px;background:${s.color}` }));
    return el('div', { class: 'ef-chart' },
      el('div', { class: 'ef-bars', role: 'img', 'aria-label': 'Paired bar chart' }, rows.map((r) => el('div', { class: 'ef-bar-col ef-pair' }, one(r, a), one(r, b)))),
      axisRow(rows, xKey, xFormat, sub),
      legend([{ label: a.label, color: a.color }, { label: b.label, color: b.color }]));
  }

  // Diverging bars: positive above the axis, negative below.
  function divergingBars(rows, xKey, pos, neg, format, { xFormat = fmt.month, height = 110 } = {}) {
    if (!rows.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const max = Math.max(...rows.flatMap((r) => [Math.abs(num(r[pos.key]) || 0), Math.abs(num(r[neg.key]) || 0)]), 1);
    const col = (r) => el('div', { class: 'ef-bar-col', title: `${xFormat(r[xKey])}: ${format(num(r[pos.key]))} / -${format(Math.abs(num(r[neg.key])))}` },
      el('div', { class: 'ef-div-half ef-div-up' }, el('div', { class: 'ef-bar', style: `height:${(Math.abs(num(r[pos.key]) || 0) / max) * height}px;background:${pos.color}` })),
      el('div', { class: 'ef-div-half ef-div-down' }, el('div', { class: 'ef-bar', style: `height:${(Math.abs(num(r[neg.key]) || 0) / max) * height}px;background:${neg.color};border-radius:0 0 3px 3px` })));
    return el('div', { class: 'ef-chart' },
      el('div', { class: 'ef-bars ef-div', style: `height:${height * 2}px`, role: 'img', 'aria-label': 'Diverging bar chart' }, rows.map(col)),
      axisRow(rows, xKey, xFormat),
      legend([{ label: pos.label, color: pos.color }, { label: neg.label, color: neg.color }]));
  }

  // Line chart (SVG). lines: [{label, color, dashed, points:[y|null per x]}]; band: {low:[], high:[]} shaded range.
  function lineChart(xLabels, lines, format, { band, height = 220 } = {}) {
    const W = 760, H = height, L = 52, R = 12, T = 12, B = 26;
    const ys = lines.flatMap((l) => l.points).concat(band ? band.high : []).filter((v) => v != null && !isNaN(v));
    if (!ys.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const max = Math.max(...ys, 1);
    const X = (i) => L + (xLabels.length < 2 ? 0 : (i / (xLabels.length - 1)) * (W - L - R));
    const Y = (v) => T + (1 - v / max) * (H - T - B);
    const S = 'http://www.w3.org/2000/svg';
    const n = (tag, a = {}, ...k) => { const e = document.createElementNS(S, tag); for (const [x, v] of Object.entries(a)) e.setAttribute(x, v); for (const c of k) if (c != null) e.append(c); return e; };
    const svg = n('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ef-line', role: 'img', 'aria-label': 'Line chart' });
    for (let g = 0; g <= 4; g++) {
      const v = (max / 4) * g;
      svg.append(n('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: 'var(--cds-chart-grid)' }));
      const t = n('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--cds-text-secondary)' }); t.textContent = format(v); svg.append(t);
    }
    xLabels.forEach((lb, i) => { const t = n('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--cds-text-secondary)' }); t.textContent = lb; svg.append(t); });
    if (band) {
      const idx = band.high.map((v, i) => (v != null && band.low[i] != null ? i : -1)).filter((i) => i >= 0);
      if (idx.length) svg.append(n('polygon', { fill: 'var(--ef-accent)', opacity: 0.18, points: [...idx.map((i) => `${X(i)},${Y(band.high[i])}`), ...idx.slice().reverse().map((i) => `${X(i)},${Y(band.low[i])}`)].join(' ') }));
    }
    for (const l of lines) {
      const pts = l.points.map((v, i) => (v == null || isNaN(v) ? null : `${X(i)},${Y(v)}`)).filter(Boolean);
      for (const pt of pts) { const [cx, cy] = pt.split(','); svg.append(n('circle', { cx, cy, r: 3, fill: l.color })); }
      if (pts.length) svg.append(n('polyline', { points: pts.join(' '), fill: 'none', stroke: l.color, 'stroke-width': 2.5, ...(l.dashed ? { 'stroke-dasharray': l.dashed } : {}) }));
    }
    return el('div', { class: 'ef-chart' }, svg, legend([...lines.map((l) => ({ label: l.label, color: l.color })), ...(band ? [{ label: band.label || 'Projected range', color: 'rgba(0,0,0,.18)' }] : [])]));
  }

  function table(columns, rows, empty = 'Nothing in this range yet.', cls = 'ef-table-num') {
    if (!rows.length) return el('p', { class: 'ef-empty', text: empty });
    return el('div', { class: 'ef-tablewrap' }, el('table', { class: 'ef-table ' + cls },
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { text: c.label })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, columns.map((c) => {
        const v = c.value(r);
        return el('td', { class: c.cls ? c.cls(r) : '', text: c.fmt ? c.fmt(v) : v == null || v === '' ? '—' : String(v) });
      }))))));
  }

  const card = (id, title, sub, ...body) => el('section', { class: 'ef-card', id }, el('h2', { class: 'ef-h2', text: title }), sub ? el('p', { class: 'ef-sub', text: sub }) : null, ...body);
  const tiles = (...t) => el('section', { class: 'ef-tiles' }, ...t);
  const changeCls = (r) => { const v = r.__change; return isNaN(v) ? '' : v > 0 ? 'ef-good' : v < 0 ? 'ef-bad' : ''; };
  const withLy = (rows, lyRows, key, field) => {
    const ly = new Map(lyRows.map((r) => [r[key], r]));
    const total = rows.reduce((s, r) => s + (num(r[field]) || 0), 0);
    return rows.map((r) => {
      const l = ly.get(r[key]);
      return { ...r, __share: div(r[field], total), __ly: l ? num(l[field]) : 0, __change: l ? change(r[field], l[field]) : NaN };
    }).sort((a, b) => num(b[field]) - num(a[field]));
  };
  const lede = (text) => el('p', { class: 'ef-lede', text });
  const moreLess = (v) => (isNaN(v) || !isFinite(v) ? '' : Math.abs(v) < 0.0005 ? ', the same as the same dates last year' : `, ${fmt.pct(Math.abs(v))} ${v < 0 ? 'less' : 'more'} than the same dates last year`);

  // Read-only SQL for the Scorecard and Data Quality tabs (scorecard/queries.js).
  const Q = window.FR_SQL || {};
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function query(name) {
    const cacheKey = JSON.stringify([state.account, 'sql', name]);
    if (!state.cache.has(cacheKey)) {
      const p = sql(Q[name]);
      p.catch(() => state.cache.delete(cacheKey));
      state.cache.set(cacheKey, p);
    }
    return state.cache.get(cacheKey);
  }

  // Queries that take the picked period's windows (dates only; checked in scorecard/queries.js).
  function queryWith(name, w) {
    const cacheKey = JSON.stringify([state.account, 'sql', name, w.ty, w.ly]);
    if (!state.cache.has(cacheKey)) {
      const p = sql(Q[name](w.ty, w.ly));
      p.catch(() => state.cache.delete(cacheKey));
      state.cache.set(cacheKey, p);
    }
    return state.cache.get(cacheKey);
  }

  // ---- Donor retention (a section of All Donations) -------------------------------
  function retentionCard(r, w) {
    const sub = 'Who is giving in the selected period, compared with who gave in the same dates a year earlier. The bars split this period\'s donors into returning (also gave in those dates last year), came back (gave before, but not then) and new (first gift ever).';
    if (!r) return card('tx-retention', 'Donor retention', sub, el('p', { class: 'ef-empty', text: 'Retention could not be worked out just now. Try again in a moment.' }));
    const d = (k) => num(r[k]);
    const start = String(r.data_start || '').slice(0, 10);
    const shift = (day, years) => { const t = new Date(`${day}T00:00:00Z`); t.setUTCFullYear(t.getUTCFullYear() - years); return t.toISOString().slice(0, 10); };
    if (!d('donors_ly') || !start || start >= w.ly.end) {
      return card('tx-retention', 'Donor retention', sub, el('p', { class: 'ef-note', text: `There are no gift records for the same dates last year (records start ${start ? fmt.day(start) : 'later than that'}), so there is nothing to compare this period's donors with yet.` }));
    }
    const partial = start > w.ly.start;
    const haveYearBefore = start <= shift(w.ly.start, 1);
    const retTy = div(d('returning_ty'), d('donors_ly'));
    const retLy = haveYearBefore ? div(d('returning_ly'), d('donors_py')) : NaN;
    const firstTy = div(d('new_ly_again'), d('new_ly'));
    const firstLy = haveYearBefore ? div(d('new_py_again'), d('new_py')) : NaN;
    const cameTy = d('donors_ty') - d('returning_ty') - d('new_ty');
    const cameLy = d('donors_ly') - d('returning_ly') - d('new_ly');
    const lapsedTy = d('donors_ly') - d('returning_ty');
    const lapsedLy = haveYearBefore ? d('donors_py') - d('returning_ly') : NaN;
    const pct1 = (v) => (isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`);
    const earlier = (v, f) => (isNaN(v) ? '' : ` · a year earlier ${f(v)}`);
    const series = [
      { label: 'Returning', color: PALETTE[0], text: '#fff' },
      { label: 'Came back', color: PALETTE[3], text: '#fff' },
      { label: 'New', color: PALETTE[2], text: '#212529' }];
    const strip = (label, vals, total) => el('div', { class: 'ef-ret-row' },
      el('div', { class: 'ef-note', text: `${label} · ${fmt.int(total)} donors` }),
      el('div', { class: 'ef-ret-strip', role: 'img', 'aria-label': `${label}: ${series.map((x, i) => `${x.label} ${fmt.int(vals[i])}`).join(', ')}` },
        series.map((x, i) => { const share = div(vals[i], total); return el('span', { style: `width:${(isNaN(share) ? 0 : share * 100).toFixed(2)}%;background:${x.color};color:${x.text}`, title: `${x.label}: ${fmt.int(vals[i])}`, text: share >= 0.08 ? `${x.label} ${fmt.pct(share)}` : '' }); })));
    return card('tx-retention', 'Donor retention', sub,
      tiles(
        tile('Donor retention', retTy, retLy, pct1, { note: `Of ${fmt.int(d('donors_ly'))} donors last year${earlier(retLy, pct1)}` }),
        tile('First-year retention', firstTy, firstLy, pct1, { note: `Of ${fmt.int(d('new_ly'))} new donors last year${earlier(firstLy, pct1)}` }),
        tile('Came back', cameTy, cameLy, fmt.int, { note: `Lapsed donors who gave again · last year ${fmt.int(cameLy)}` }),
        tile('Lapsed', lapsedTy, lapsedLy, fmt.int, { lowerIsBetter: true, note: `Last year's donors who haven't given again${earlier(lapsedLy, fmt.int)}` })),
      legend(series.map((x) => ({ label: x.label, color: x.color }))),
      strip('This period', [d('returning_ty'), cameTy, d('new_ty')], d('donors_ty')),
      strip('Same dates last year', [d('returning_ly'), cameLy, d('new_ly')], d('donors_ly')),
      partial ? el('p', { class: 'ef-note', text: `Gift records start ${fmt.day(start)}, partway through last year's dates, so retention compares against only part of last year's donors.` }) : null,
      !haveYearBefore ? el('p', { class: 'ef-note', text: 'Gift records start after the dates a year before last, so the "a year earlier" comparisons are left out.' }) : null);
  }

  // ---- Recurring donors (a section of All Donations) ----------------------------
  async function loadRecurring(w) {
    const today = new Date();
    const { end } = w.ty;
    const optional = (p) => p.catch(() => null);
    const [[ty, ly], active, months, newTy, newLy, flow, cohorts, channels, kept] = await Promise.all([
      both('recurring', w),
      run('recurring', { start: iso(addDays(new Date(end + 'T00:00:00'), -35)), end }),
      run('recurring', { start: iso(new Date(today.getFullYear(), today.getMonth() - 23, 1)), end }),
      firstGifts('new_monthly_donors', w.ty),
      firstGifts('new_monthly_donors', w.ly),
      optional(query('REC_FLOW')), optional(queryWith('REC_COHORTS', w)), optional(queryWith('REC_CHANNELS', w)), optional(queryWith('REC_KEPT', w)),
    ]);
    return { ty, ly, active, months, nm: [num(newTy.new_donors?.[0]?.new_donors), num(newLy.new_donors?.[0]?.new_donors)], flow, cohorts, channels, kept: kept?.[0] || null };
  }

  function recurringCards({ ty, ly, active, months, nm, flow, cohorts, channels, kept }) {
    const k = ty.kpis[0] || {}, l = ly.kpis[0] || {}, a = active.kpis[0] || {};
    const keptTy = kept ? div(kept.kept_ty, kept.base_ty) : NaN, keptLy = kept ? div(kept.kept_ly, kept.base_ly) : NaN;
    const monthKey = (v) => String(v).slice(0, 7);
    const activeRows = months.monthly.slice().sort((a2, b) => String(a2.month).localeCompare(String(b.month)));
    const flowBy = new Map((flow || []).map((r) => [monthKey(r.month), r]));
    const rows = activeRows.map((r) => ({ month: String(r.month).slice(0, 10), donors: num(r.donors), started: num(flowBy.get(monthKey(r.month))?.started), stopped: num(flowBy.get(monthKey(r.month))?.stopped) }));
    const cohortTable = (label, data, empty) => {
      const total = data.reduce((t, r) => ({ donors: t.donors + r.donors, active: t.active + r.active, revenue: t.revenue + r.revenue }), { donors: 0, active: 0, revenue: 0 });
      const all = [...data, { ...total, label: 'All', bold: true }];
      return table([
        { label, value: (r) => r.label },
        { label: 'Donors', value: (r) => r.donors, fmt: fmt.int },
        { label: 'Still active', value: (r) => r.active, fmt: fmt.int },
        { label: 'Kept', value: (r) => div(r.active, r.donors), fmt: fmt.pct },
        { label: 'Revenue in period', value: (r) => r.revenue, fmt: fmt.money },
        { label: 'Share', value: (r) => div(r.revenue, total.revenue), fmt: fmt.pct },
      ], data.length ? all : [], empty);
    };
    // By start year: the latest eight years, with anything earlier folded into the first of them.
    const years = (cohorts || []).map((r) => ({ year: num(r.year), donors: num(r.donors), active: num(r.active), revenue: num(r.revenue), dataStart: num(r.data_start) }));
    const keepFrom = years.length > 8 ? years[years.length - 8].year : -Infinity;
    const folded = years.length > 8 ? (() => {
      const out = [];
      const early = years.filter((r) => r.year <= keepFrom);
      out.push({ label: `${keepFrom} and earlier`, donors: early.reduce((t, r) => t + r.donors, 0), active: early.reduce((t, r) => t + r.active, 0), revenue: early.reduce((t, r) => t + r.revenue, 0) });
      for (const r of years.filter((x) => x.year > keepFrom)) out.push({ ...r, label: String(r.year) });
      return out;
    })() : years.map((r) => ({ ...r, label: String(r.year) }));
    const dataStart = years[0]?.dataStart;
    const CH = { 'Text (SMS)': 'Texts', 'Meta ads': 'Paid ads', 'Google ads': 'Paid ads', 'Paid ads (coded)': 'Paid ads', 'Social media': 'Social', 'Other source code': 'Other' };
    const byChannel = new Map();
    for (const r of channels || []) {
      const name = CH[r.channel] || r.channel;
      const g = byChannel.get(name) || { label: name, donors: 0, active: 0, revenue: 0 };
      g.donors += num(r.donors); g.active += num(r.active); g.revenue += num(r.revenue);
      byChannel.set(name, g);
    }
    const channelRows = [...byChannel.values()].sort((a2, b) => b.donors - a2.donors);
    const mLab = (v) => fmt.month(v);
    return [
      card('tx-recurring', 'Recurring donors', `${fmt.int(num(a.donors))} monthly donors are active, worth about ${fmt.money(num(a.revenue))} a month. ${fmt.int(nm[0])} new monthly donors started in this period, against ${fmt.int(nm[1])} in the same dates last year.`, tiles(
        tile('Active monthly donors', a.donors, NaN, fmt.int, { note: 'Paid in the last 35 days' }),
        tile('Monthly run rate', a.revenue, NaN, fmt.money, { note: 'Payments in the last 35 days' }),
        tile('New monthly donors', nm[0], nm[1], fmt.int, { note: `First monthly payment came in this period · last year ${fmt.int(nm[1])}` }),
        kept ? tile('Kept since January 1', keptTy, keptLy, fmt.pct, { note: `${fmt.int(num(kept.kept_ty))} of ${fmt.int(num(kept.base_ty))} donors active then still give · last year ${fmt.pct(keptLy)}` }) : null,
        tile('Average payment', k.avg_payment, l.avg_payment, fmt.money2, { note: `${fmt.int(num(k.payments))} payments in this period · last year ${fmt.money2(num(l.avg_payment))}` }))),
      card('rec-monthly', 'Active monthly donors by month, last 24 months', 'Top: monthly donors who made a payment that month. Bottom: donors who started (up) and donors whose last payment came that month (down). A donor counts as stopped once 45 days pass with no payment, so the latest weeks will add stops later. The current month is still in progress.', rows.length ? el('div', {},
        scaledBars(rows, [{ key: 'donors', label: 'Active donors', color: PALETTE[0] }], { xLabel: (r) => mLab(r.month), tip: (r) => `${mLab(r.month)}: ${fmt.int(r.donors)} active`, format: fmt.count }),
        flow ? divergingBars(rows, 'month', { key: 'started', label: 'Started', color: PALETTE[3] }, { key: 'stopped', label: 'Stopped', color: PALETTE[2] }, fmt.int, { xFormat: mLab }) : null,
        dataTable([{ label: 'Month', value: (r) => r.month, fmt: mLab }, { label: 'Active', value: (r) => r.donors, fmt: fmt.int }, ...(flow ? [{ label: 'Started', value: (r) => r.started, fmt: fmt.int }, { label: 'Stopped', value: (r) => r.stopped, fmt: fmt.int }] : [])], rows)) : el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' })),
      cohorts ? card('rec-cohorts', 'Monthly donors by year they started', `How many monthly donors each year's first payments produced and how many still give.${dataStart ? ` Gift records start in ${dataStart}, so the earliest group also holds everyone already giving monthly then.` : ''}`, cohortTable('Started', folded, 'No monthly donors on record.')) : null,
      channels ? card('rec-channels', 'Monthly donors by sign-up channel', 'The channel of each donor\'s first monthly payment, all years.', cohortTable('Channel', channelRows, 'No monthly donors on record.')) : null,
    ].filter(Boolean);
  }

  // ---- Tabs --------------------------------------------------------------------
  const TABS = {
    transactions: {
      title: 'All Donations',
      async load(w) {
        const [[ty, ly], ndTy, ndLy, rec, ret] = await Promise.all([both('all_donations', w), firstGifts('new_donors', w.ty), firstGifts('new_donors', w.ly), loadRecurring(w), queryWith('RETENTION', w).then((rows) => rows[0] || null).catch(() => null)]);
        return { ty, ly, nd: [num(ndTy.new_donors?.[0]?.new_donors), num(ndLy.new_donors?.[0]?.new_donors)], rec, ret, w };
      },
      render({ ty, ly, nd, rec, ret, w }) {
        const k = ty.kpis[0] || {}, l = ly.kpis[0] || {};
        return [
          lede(`Donors have given ${fmt.money(num(k.revenue))}${moreLess(change(k.revenue, l.revenue))}. ${fmt.pct(div(k.unattributed_revenue, k.revenue))} of it can't be credited to a channel.`),
          tiles(
            tile('Revenue', k.revenue, l.revenue, fmt.money, { note: `${fmt.int(num(k.gifts))} gifts · last year ${fmt.money(num(l.revenue))}` }),
            tile('Donors', k.donors, l.donors, fmt.int),
            tile('New donors', nd[0], nd[1], fmt.int, { note: `First gift on record · last year ${fmt.int(nd[1])}` }),
            tile('Average gift', k.avg_gift, l.avg_gift, fmt.money2),
            tile('Monthly (recurring) revenue', k.recurring_revenue, l.recurring_revenue, fmt.money, { note: `${fmt.pct(div(k.recurring_revenue, k.revenue))} of revenue · last year ${fmt.money(num(l.recurring_revenue))}` }),
            tile('Gifts of $1,000 or more', k.big_gift_revenue, l.big_gift_revenue, fmt.money, { note: `${fmt.int(num(k.big_gifts))} gifts · last year ${fmt.money(num(l.big_gift_revenue))}` })),
          card('tx-monthly', 'Revenue by month', 'Each bar splits one-time gifts from monthly (recurring) payments. The dark line on each month is the same month last year, counted only up to today\'s date.', (() => {
            const lyBy = new Map(ly.monthly.map((r) => [String(r.month_no).slice(5, 7), num(r.revenue)]));
            const rows = ty.monthly.slice().sort((a, b) => String(a.month_no).localeCompare(String(b.month_no))).map((r) => ({ ...r, ly_revenue: lyBy.get(String(r.month_no).slice(5, 7)) }));
            return el('div', {}, stackedBars(rows, 'month_no', [{ key: 'one_time', label: 'One-time', color: PALETTE[0] }, { key: 'recurring', label: 'Monthly (recurring)', color: PALETTE[1] }], fmt.money, { ly: 'ly_revenue' }),
              dataTable([{ label: 'Month', value: (r) => r.month_no, fmt: fmt.month }, { label: 'One-time', value: (r) => num(r.one_time), fmt: fmt.money }, { label: 'Monthly', value: (r) => num(r.recurring), fmt: fmt.money }, { label: 'Total', value: (r) => num(r.revenue), fmt: fmt.money }, { label: 'Same month last year', value: (r) => r.ly_revenue, fmt: fmt.money }], rows));
          })()),
          card('tx-channels', 'Revenue by channel', 'The linked email, text or ad, or else the channel in the source code. Change compares with the same dates last year.',
            table([
              { label: 'Channel', value: (r) => r.channel },
              { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
              { label: 'Share', value: (r) => r.__share, fmt: fmt.pct },
              { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
              { label: 'Donors', value: (r) => num(r.donors), fmt: fmt.int },
              { label: 'Avg gift', value: (r) => num(r.avg_gift), fmt: fmt.money2 },
              { label: 'Last year', value: (r) => r.__ly, fmt: fmt.money },
              { label: 'Change', value: (r) => r.__change, fmt: fmt.change, cls: changeCls },
            ], withLy(ty.channels, ly.channels, 'channel', 'revenue'))),
          card('tx-sizes', 'Revenue by gift size', null, table([
            { label: 'Gift size', value: (r) => r.gift_size },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Share', value: (r) => r.__share, fmt: fmt.pct },
            { label: 'Change', value: (r) => r.__change, fmt: fmt.change, cls: changeCls },
          ], withLy(ty.sizes, ly.sizes, 'gift_size', 'revenue').sort((a, b) => num(a.size_order) - num(b.size_order)))),
          retentionCard(ret, w),
          ...recurringCards(rec),
          card('tx-codes', 'Top 10 source codes', null, table([
            { label: 'Source code', value: (r) => r.source },
            { label: 'Channel', value: (r) => r.channel },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Donors', value: (r) => num(r.donors), fmt: fmt.int },
            { label: 'Avg gift', value: (r) => num(r.avg_gift), fmt: fmt.money2 },
          ], ty.top_codes)),
          card('tx-pages', 'Top 10 ActBlue pages with no source code', 'Adding a source code to links that point at these pages would let their gifts count toward a channel.', table([
            { label: 'ActBlue page', value: (r) => r.source },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Recurring payments', value: (r) => num(r.recurring_gifts), fmt: fmt.int },
            { label: 'First gift', value: (r) => r.first_gift, fmt: fmt.day },
          ], ty.top_pages, 'Every gift in this period has a source code.')),
        ];
      },
    },

    email: {
      title: 'Email',
      async load(w) { const [ty, ly] = await both('email', w); return { ty, ly }; },
      render({ ty, ly }) {
        const k = ty.kpis[0] || {}, l = ly.kpis[0] || {};
        const rpm = (r) => div(num(r.revenue) * 1000, r.sent);
        const ctr = (r) => div(r.clicks, num(r.delivered) || r.sent);
        const SIZE = { 1: 'Under 50,000', 2: '50,000 to 249,999', 3: '250,000 or more' };
        return [
          lede(`Email raised ${fmt.money(num(k.revenue))}${moreLess(change(k.revenue, l.revenue))}. Each 1,000 emails raised ${fmt.money2(rpm(k))}, against ${fmt.money2(rpm(l))} a year ago.`),
          tiles(
            tile('Revenue', k.revenue, l.revenue, fmt.money, { note: `${fmt.int(num(k.gifts))} gifts · last year ${fmt.money(num(l.revenue))}` }),
            tile('Revenue per 1,000 sent', rpm(k), rpm(l), fmt.money2),
            tile('Average gift', div(k.revenue, k.gifts), div(l.revenue, l.gifts), fmt.money2),
            tile('New monthly donors', k.new_monthly, l.new_monthly, fmt.int),
            tile('Click rate', ctr(k), ctr(l), fmt.pct),
            tile('Spam complaint rate', div(k.complaints, k.sent), div(l.complaints, l.sent), fmt.pct2, { lowerIsBetter: true, note: `Filtering starts above 0.3% · last year ${fmt.pct2(div(l.complaints, l.sent))}` })),
          card('email-monthly', 'Revenue by month', 'Bars show revenue. The figure under each month is revenue per 1,000 emails sent, the fairest way to compare months with different volumes.', (() => {
            const rows = ty.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));
            return el('div', {}, bars(rows, 'month', 'revenue', fmt.money, fmt.month, (r) => fmt.money2(rpm(r))),
              dataTable([{ label: 'Month', value: (r) => r.month, fmt: fmt.month }, { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money }, { label: 'Emails sent', value: (r) => num(r.sent), fmt: fmt.int }, { label: 'Per 1,000 sent', value: rpm, fmt: fmt.money2 }], rows));
          })()),
          card('email-weekly', 'Revenue by week', 'Weeks start on Monday.', weekly(ty.weekly)),
          card('email-money', 'Where the money came from', 'Shares of email revenue in the selected period.', table([
            { label: 'Measure', value: (r) => r.label },
            { label: 'Share', value: (r) => r.share, fmt: fmt.pct },
          ], [
            { label: 'Raised within 24 hours of the send', share: div(k.revenue_day_1, k.revenue) },
            { label: 'From monthly (recurring) gifts', share: div(k.recurring_revenue, k.revenue) },
            { label: 'From the top 10 emails', share: div(ty.top_emails.reduce((t, r) => t + (num(r.revenue) || 0), 0), k.revenue) },
          ].filter((r) => !isNaN(r.share))),
            isNaN(num(k.zero_revenue_messages)) ? null : el('p', { class: 'ef-note', text: `${fmt.int(num(k.zero_revenue_messages))} of ${fmt.int(num(k.messages))} sends in this period raised nothing.` })),
          card('email-purpose', 'By purpose', 'Read from the third part of each send\'s source code (LOC_EM_FR is a fundraising ask).', table([
            { label: 'Purpose', value: (r) => r.purpose },
            { label: 'Sends', value: (r) => num(r.messages), fmt: fmt.int },
            { label: 'Emails sent', value: (r) => num(r.sent), fmt: fmt.int },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Share', value: (r) => r.__share, fmt: fmt.pct },
            { label: 'vs last year', value: (r) => r.__change, fmt: fmt.change, cls: changeCls },
            { label: 'Per 1,000 sent', value: rpm, fmt: fmt.money2 },
            { label: 'Click rate', value: ctr, fmt: fmt.pct },
            { label: 'Unsub rate', value: (r) => div(r.unsubscribes, r.sent), fmt: fmt.pct2 },
            { label: 'Raised $0', value: (r) => num(r.zero_revenue_messages), fmt: fmt.int },
            { label: 'New monthly', value: (r) => num(r.new_monthly), fmt: fmt.int },
          ], withLy(ty.purpose, ly.purpose, 'purpose', 'revenue'))),
          card('email-top', 'Top 10 emails by revenue', 'Revenue is credited to the email the donor clicked last before giving.', table([
            { label: 'Sent', value: (r) => r.send_date, fmt: fmt.day },
            { label: 'Subject', value: (r) => r.subject },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Emails sent', value: (r) => num(r.sent), fmt: fmt.int },
            { label: 'Per 1,000 sent', value: rpm, fmt: fmt.money2 },
            { label: 'Click rate', value: ctr, fmt: fmt.pct },
          ], ty.top_emails)),
          card('email-size', 'By send size', null, table([
            { label: 'Send size', value: (r) => SIZE[r.size_order] },
            { label: 'Messages', value: (r) => num(r.messages), fmt: fmt.int },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Per 1,000 sent', value: rpm, fmt: fmt.money2 },
            { label: 'Raised $0', value: (r) => num(r.zero_revenue_messages), fmt: fmt.int },
          ], ty.by_size.slice().sort((a, b) => num(a.size_order) - num(b.size_order)))),
          card('email-health', 'List health', 'Weekly spam complaint rate against the 0.3% line where inbox providers start sending mail to spam.', rateWeeks(ty.weekly, (r) => div(r.complaints, r.sent), { reference: 0.003, referenceLabel: '0.3% limit', flagOver: 0.003 })),
        ];
      },
    },

    sms: {
      title: 'SMS',
      async load(w) { const [ty, ly] = await both('sms', w); return { ty, ly }; },
      render({ ty, ly }) {
        const k = ty.kpis[0] || {}, l = ly.kpis[0] || {};
        const rpd = (r) => div(r.revenue, r.cost);
        const cols = (label, key) => [
          { label, value: (r) => r[key] },
          { label: 'Messages', value: (r) => num(r.messages), fmt: fmt.int },
          { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
          { label: 'Share', value: (r) => r.__share, fmt: fmt.pct },
          { label: 'Cost', value: (r) => num(r.cost), fmt: fmt.money },
          { label: 'Raised per $1', value: rpd, fmt: fmt.money2 },
          { label: 'Opt-out rate', value: (r) => div(r.optouts, r.sent), fmt: fmt.pct2 },
          { label: 'vs last year', value: (r) => r.__change, fmt: fmt.change, cls: changeCls },
        ];
        return [
          lede(`Texts raised ${fmt.money(num(k.revenue))}${moreLess(change(k.revenue, l.revenue))}. They cost ${fmt.money(num(k.cost))} to send, so each $1 brought back ${fmt.money2(rpd(k))}.`),
          tiles(
            tile('Revenue', k.revenue, l.revenue, fmt.money, { note: `${fmt.int(num(k.gifts))} gifts · last year ${fmt.money(num(l.revenue))}` }),
            tile('Sending cost', k.cost, l.cost, fmt.money, { lowerIsBetter: true }),
            tile('Raised per $1 of cost', rpd(k), rpd(l), fmt.money2),
            tile('Net after cost', num(k.revenue) - num(k.cost), num(l.revenue) - num(l.cost), fmt.money),
            tile('Revenue per 1,000 texts', div(num(k.revenue) * 1000, k.sent), div(num(l.revenue) * 1000, l.sent), fmt.money2),
            tile('Opt-out rate', div(k.unsubscribes, k.sent), div(l.unsubscribes, l.sent), fmt.pct2, { lowerIsBetter: true })),
          card('sms-monthly', 'Sending cost and revenue by month', 'Each month shows what texts cost to send beside what they raised. The figure under each month is the amount raised for every $1 of sending cost.', (() => {
            const rows = ty.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));
            return el('div', {}, pairedBars(rows, 'month', [{ key: 'cost', label: 'Sending cost (left bar)', color: PALETTE[4] }, { key: 'revenue', label: 'Raised (right bar)', color: PALETTE[0] }], fmt.money, { sub: (r) => fmt.money2(rpd(r)) }),
              dataTable([{ label: 'Month', value: (r) => r.month, fmt: fmt.month }, { label: 'Sending cost', value: (r) => num(r.cost), fmt: fmt.money }, { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money }, { label: 'Raised per $1', value: rpd, fmt: fmt.money2 }], rows));
          })()),
          card('sms-weekly', 'Revenue by week', 'Weeks start on Monday.', weekly(ty.weekly)),
          card('sms-platforms', 'By platform', null, table(cols('Platform', 'platform'), withLy(ty.platforms, ly.platforms, 'platform', 'revenue'))),
          card('sms-types', 'By message type', 'Broadcasts go to the whole list; peer-to-peer texts are sent one by one.', table(cols('Type', 'type'), withLy(ty.types, ly.types, 'type', 'revenue'))),
          card('sms-purposes', 'By purpose', null, table(cols('Purpose', 'purpose'), withLy(ty.purposes, ly.purposes, 'purpose', 'revenue'))),
          card('sms-top', 'Top 10 texts by revenue', null, table([
            { label: 'Sent', value: (r) => r.send_date, fmt: fmt.day },
            { label: 'Message', value: (r) => r.message },
            { label: 'Platform', value: (r) => r.platform },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Cost', value: (r) => num(r.cost), fmt: fmt.money },
            { label: 'Raised per $1', value: rpd, fmt: fmt.money2 },
          ], ty.top_texts)),
          card('sms-health', 'List health', 'Weekly opt-out rate against this period\'s average. Weeks over twice the average are listed below the chart.', (() => {
            const avg = div(k.unsubscribes, k.sent);
            return rateWeeks(ty.weekly, (r) => div(r.optouts, r.sent), { reference: avg, referenceLabel: 'Period average', flagOver: isNaN(avg) ? 0 : avg * 2 });
          })()),
          card('sms-gaps', 'Gaps in the text data', 'What this tab can and can\'t tell you.', el('ul', { class: 'ef-gaps' },
            [['No delivery counts. ', 'Texting platforms don\'t report delivered texts to engine9, so click and opt-out rates use texts sent.'],
              ['Message text isn\'t stored. ', 'Messages are named by their source code. Type and purpose are read from that code\'s naming pattern, so a message coded outside the pattern shows as Other.'],
              ['Revenue is last-click. ', 'A gift counts for the text only if the text was the last thing the donor clicked.'],
              [num(k.cost) > 0 ? 'Cost is the platform\'s sending charge. ' : 'No sending cost is on record. ', num(k.cost) > 0 ? 'It is the charge as reported to engine9. Staff time, list fees and short-code fees aren\'t included.' : 'Texting platforms haven\'t reported a charge to engine9 for this period, so raised per $1 and net can\'t be judged.']]
              .map(([b, t]) => el('li', {}, el('b', { text: b }), t)))),
        ];
      },
    },

    ads: {
      title: 'Advertising',
      async load(w) { const [[ty, ly], signups] = await Promise.all([both('advertising', w), queryWith('ACQ_SIGNUPS', w).catch(() => null)]); return { ty, ly, signups, w }; },
      render({ ty, ly, signups, w }) {
        const k = ty.kpis[0] || {}, l = ly.kpis[0] || {};
        const rpd = (r) => div(r.revenue, r.spend);
        const adSignups = (period) => (signups || []).filter((r) => r.period === period && r.source === 'AD').reduce((t, r) => t + (num(r.signups) || 0), 0);
        if (!num(k.spend) && !num(l.spend)) return [lede('No ad spend has reached engine9 for this account in this period.')];
        return [
          lede(`Ads cost ${fmt.money(num(k.spend))} and raised ${fmt.money(num(k.revenue))} in gifts credited to them: ${fmt.money2(rpd(k))} back for every $1.`),
          tiles(
            tile('Ad spend', k.spend, l.spend, fmt.money, { note: `${fmt.int(num(k.campaigns))} campaigns · last year ${fmt.money(num(l.spend))}` }),
            tile('Raised from ads', k.revenue, l.revenue, fmt.money),
            tile('Raised per $1 spent', rpd(k), rpd(l), fmt.money2),
            tile('Cost per gift', div(k.spend, k.gifts), div(l.spend, l.gifts), fmt.money2, { lowerIsBetter: true }),
            tile('New people reached', k.new_people, l.new_people, fmt.int, { note: `${fmt.money2(div(k.spend, k.new_people))} each · last year ${fmt.int(num(l.new_people))}` }),
            tile('Impressions', k.impressions, l.impressions, fmt.count, { note: `${fmt.money2(div(num(k.spend) * 1000, k.impressions))} per 1,000 (CPM) · last year ${fmt.count(num(l.impressions))}` }),
            tile('Clicks', k.clicks, l.clicks, fmt.count, { note: `${fmt.pct2(div(k.clicks, k.impressions))} of impressions (CTR) · last year ${fmt.count(num(l.clicks))}` }),
            tile('Cost per click', div(k.spend, k.clicks), div(l.spend, l.clicks), fmt.money2, { lowerIsBetter: true, note: `Spend ÷ clicks · last year ${fmt.money2(div(l.spend, l.clicks))}` })),
          card('ads-acquisition', 'Acquisition from ads', 'New donors and email sign-ups ads brought in during the selected period, and what each cost. Compare with bought and rented lists on the Acquisition tab.', (() => {
            const box = el('div', {}, el('p', { class: 'ef-empty', text: 'Counting new donors from ads. This can take up to a minute the first time.' }));
            const AD = ['Meta ads', 'Google ads'];
            const donors = (rows, p) => rows.filter((r) => r.period === p && AD.includes(r.channel)).reduce((t, r) => t + (num(r.donors) || 0), 0);
            queryWith('ACQ_PERIOD', w).then((rows) => {
              const nTy = donors(rows, 'ty'), nLy = donors(rows, 'ly');
              box.replaceChildren(tiles(
                tile('New donors from ads', nTy, nLy, fmt.int, { note: `First gift credited to an ad · last year ${fmt.int(nLy)}` }),
                tile('Cost per new donor', div(k.spend, nTy), div(l.spend, nLy), fmt.money2, { lowerIsBetter: true, note: 'Upper bound: all spend ÷ new donors' }),
                signups ? tile('Email sign-ups from ads', adSignups('ty'), adSignups('ly'), fmt.int, { note: `Ad-coded email platform records · ${fmt.money2(div(k.spend, adSignups('ty')))} spend per sign-up` }) : null,
                el('div', { class: 'ef-card', id: 'ads-range' }, el('div', { class: 'ef-tile-label', text: 'Raised per $1, as a range' }),
                  el('div', { class: 'ef-tile-value', text: '…' }), el('div', { class: 'ef-tile-note', text: `Strict: last-click gifts ${fmt.money2(rpd(k))}. Working out the generous end.` }))),
              el('p', { class: 'ef-note' }, el('b', { text: 'Why a range. ' }), 'The low end counts only gifts whose last click was on an ad. The high end adds gifts whose source code marks them as ads, as the Scorecard does. Later gifts from donors the ads brought in are in neither figure; the Acquisition tab adds those.'));
              queryWith('ADS_CODED_GIFTS', w).then((g) => {
                const coded = (p) => g.filter((r) => r.period === p).reduce((t, r) => t + (num(r.revenue) || 0), 0);
                const hi = (rev, coded2, spend) => div(Math.max(num(rev) || 0, coded2), spend);
                const lyHi = hi(l.revenue, coded('ly'), l.spend), tyHi = hi(k.revenue, coded('ty'), k.spend);
                const slot = box.querySelector('#ads-range');
                if (!slot) return;
                slot.replaceChildren(el('div', { class: 'ef-tile-label', text: 'Raised per $1, as a range' }),
                  el('div', { class: 'ef-tile-value', text: `${fmt.money2(rpd(k))}–${fmt.money2(tyHi)}` }),
                  el('div', { class: 'ef-tile-note', text: `Strict: last-click gifts · generous: all ad-coded gifts · last year ${fmt.money2(rpd(l))}–${fmt.money2(lyHi)}` }));
              }).catch(() => {
                const slot = box.querySelector('#ads-range');
                if (slot) slot.replaceChildren(el('div', { class: 'ef-tile-label', text: 'Raised per $1, as a range' }), el('div', { class: 'ef-tile-value', text: fmt.money2(rpd(k)) }), el('div', { class: 'ef-tile-note', text: 'Strict: gifts whose last click was an ad. The generous end could not be worked out just now.' }));
              });
            }).catch(() => box.replaceChildren(el('p', { class: 'ef-empty', text: 'New donors from ads could not be counted right now.' })));
            return box;
          })()),
          card('ads-monthly', 'Spend and revenue by month', 'Each month shows what ads cost beside what they raised. The figure under each month is the amount raised for every $1 spent.', (() => {
            const rows = ty.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));
            return el('div', {}, pairedBars(rows, 'month', [{ key: 'spend', label: 'Spend (left bar)', color: PALETTE[4] }, { key: 'revenue', label: 'Raised (right bar)', color: PALETTE[0] }], fmt.money, { sub: (r) => fmt.money2(rpd(r)) }),
              dataTable([{ label: 'Month', value: (r) => r.month, fmt: fmt.month }, { label: 'Spend', value: (r) => num(r.spend), fmt: fmt.money }, { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money }, { label: 'Raised per $1', value: rpd, fmt: fmt.money2 }], rows));
          })()),
          card('ads-platforms', 'By platform', 'Spend change compares with the same dates last year.', table([
            { label: 'Platform', value: (r) => r.platform },
            { label: 'Spend', value: (r) => num(r.spend), fmt: fmt.money },
            { label: 'Spend change', value: (r) => r.__change, fmt: fmt.change },
            { label: 'Impressions', value: (r) => num(r.impressions), fmt: fmt.int },
            { label: 'Clicks', value: (r) => num(r.clicks), fmt: fmt.int },
            { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Per $1', value: rpd, fmt: fmt.money2 },
          ], withLy(ty.platforms, ly.platforms, 'platform', 'spend'))),
          card('ads-campaigns', 'Top 15 campaigns by spend', null, table([
            { label: 'Campaign', value: (r) => r.campaign },
            { label: 'Platform', value: (r) => r.platform },
            { label: 'Ran', value: (r) => `${fmt.day(r.first_day)} – ${fmt.day(r.last_day)}` },
            { label: 'Spend', value: (r) => num(r.spend), fmt: fmt.money },
            { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Per $1', value: rpd, fmt: fmt.money2 },
          ], ty.campaigns)),
        ];
      },
    },

    scorecard: {
      title: 'Scorecard',
      async load() {
        const optional = (name) => query(name).catch(() => []);
        const [channels, months, cost, listCost, newDonors, listMonths, listStatus] = await Promise.all([
          query('SCORECARD_CHANNELS'), query('SCORECARD_MONTHS'),
          optional('SCORECARD_COST'), optional('SCORECARD_LIST_COST'), optional('SCORECARD_NEW_DONORS'),
          optional('SCORECARD_LIST_MONTHS'), optional('SCORECARD_LIST_STATUS')]);
        return { channels, months, cost, listCost: listCost[0] || {}, newDonors, listMonths, listStatus };
      },
      render({ channels, months, cost, listCost, newDonors, listMonths, listStatus }) {
        const all = channels.find((r) => r.channel === 'All channels') || {};
        const lyY = all.ly_year, mtY = all.mt_year;
        const costBy = new Map(cost.map((r) => [r.channel, r]));
        const ndBy = new Map(newDonors.map((r) => [r.channel, r]));
        // Rented-list cost has no date; it is counted against Rented lists for this year only.
        const costOf = (ch) => (num(costBy.get(ch)?.cost) || 0) + (ch === 'Rented lists' ? num(listCost.list_cost) || 0 : 0);
        const lyCostOf = (ch) => num(costBy.get(ch)?.ly_cost) || 0;
        const rows = channels.filter((r) => r.channel !== 'All channels').map((r) => ({ ...r, cost_ty: costOf(r.channel), nd: num(ndBy.get(r.channel)?.new_donors) || 0, nd_ly: num(ndBy.get(r.channel)?.ly_new_donors) || 0 }));
        const totalCost = cost.reduce((t, r) => t + (num(r.cost) || 0), 0) + (num(listCost.list_cost) || 0), totalLyCost = cost.reduce((t, r) => t + (num(r.ly_cost) || 0), 0);
        const totalNd = newDonors.reduce((t, r) => t + (num(r.new_donors) || 0), 0), totalNdLy = newDonors.reduce((t, r) => t + (num(r.ly_new_donors) || 0), 0);
        // New donors in channels the table doesn't list (for example the "coded" bucket) still count in the total.
        const changeOf = (r) => change(r.ytd, r.ly_ytd);
        const lo = (r) => Math.min(num(r.proj_ly), num(r.proj_mt)), hi = (r) => Math.max(num(r.proj_ly), num(r.proj_mt));
        const range = (r, f) => (isNaN(lo(r)) || isNaN(hi(r)) ? '—' : lo(r) === hi(r) ? f(lo(r)) : `${f(lo(r))}–${f(hi(r))}`);
        const mFmt = (v) => (isNaN(v) ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : fmt.money(v));

        // Cumulative revenue by month: this year, last year, midterm year, plus the projected range from today to December.
        const monthRows = months.slice().sort((a, b) => num(a.month_no) - num(b.month_no));
        const cum = (key, upto = 12) => { let t = 0; return monthRows.map((r) => (num(r.month_no) <= upto ? (t += num(r[key]) || 0) : null)); };
        const thisM = num(monthRows[0]?.this_month) || 12;
        const tyCum = cum('ty', thisM), lyCum = cum('ly'), mtCum = cum('mt');
        const band = { low: monthRows.map(() => null), high: monthRows.map(() => null), label: 'Projected range' };
        const startVal = tyCum[thisM - 1] ?? num(all.ytd);
        for (let i = thisM - 1; i < 12; i++) {
          const f = (i - (thisM - 1)) / Math.max(1, 12 - thisM);
          band.low[i] = startVal + (lo(all) - startVal) * f; band.high[i] = startVal + (hi(all) - startVal) * f;
        }
        const monthLabels = MONTH_NAMES.slice(0, monthRows.length || 12);
        const listRows = listMonths.slice().sort((a, b) => num(a.month_no) - num(b.month_no));
        const signTy = listRows.reduce((t, r) => t + (num(r.month_no) <= thisM ? num(r.ty) || 0 : 0), 0);
        const signLy = listRows.reduce((t, r) => t + (num(r.month_no) <= thisM ? num(r.ly) || 0 : 0), 0);
        const status = (name) => num(listStatus.find((r) => r.status === name)?.people);
        const haveCost = cost.length > 0;
        return [
          lede(`Revenue so far this year is ${fmt.money(num(all.ytd))}${moreLess(change(all.ytd, all.ly_ytd))}. At the pace of ${lyY} and ${mtY} the year ends between ${range(all, mFmt)}. ${fmt.int(num(all.days_left))} days remain.`),
          tiles(
            tile('Raised', all.ytd, all.ly_ytd, fmt.money, { note: `${fmt.int(num(all.gifts_ytd))} gifts · same dates ${lyY} ${fmt.money(num(all.ly_ytd))}` }),
            tile('Tracked cost', totalCost, totalLyCost, fmt.money, { lowerIsBetter: true, note: haveCost ? `Ad and sending spend on record, plus rented-list costs · same dates ${lyY} ${fmt.money(totalLyCost)}` : 'No cost is on record for this account' }),
            tile('Net', num(all.ytd) - totalCost, num(all.ly_ytd) - totalLyCost, fmt.money, { note: `Raised minus tracked cost · same dates ${lyY} ${fmt.money(num(all.ly_ytd) - totalLyCost)}` }),
            tile('New donors', totalNd, totalNdLy, fmt.int, { note: `First gift ever came in this year · same dates ${lyY} ${fmt.int(totalNdLy)}` })),
          tiles(
            tile('Projected year-end', hi(all), all.ly_full, mFmt, { note: `${range(all, mFmt)} · ${lyY} full year ${mFmt(num(all.ly_full))}` }),
            tile('To match last year', Math.max(0, num(all.ly_full) - num(all.ytd)), NaN, fmt.money, { note: `Still to raise to reach ${lyY}'s ${mFmt(num(all.ly_full))}` }),
            tile('Projected gifts', Math.max(num(all.proj_gifts_ly) || 0, num(all.proj_gifts_mt) || 0) || NaN, NaN, fmt.int, { note: isNaN(num(all.proj_gifts_ly)) && isNaN(num(all.proj_gifts_mt)) ? 'Not enough history to pace from' : `${fmt.int(Math.min(num(all.proj_gifts_ly), num(all.proj_gifts_mt)))} to ${fmt.int(Math.max(num(all.proj_gifts_ly), num(all.proj_gifts_mt)))} gifts by year-end` }),
            tile(`Raised after today in ${lyY}`, all.ly_rest, NaN, fmt.money, { note: `${fmt.pct(div(all.ly_rest, all.ly_full))} of the ${lyY} total` })),
          card('sc-projection', 'Cumulative revenue', `Running total through the year. The shaded band is the projected range: this year's total so far grown by the share ${lyY} and ${mtY} raised after today's date.`, el('div', {},
            lineChart(monthLabels, [
              { label: 'This year', color: PALETTE[0], points: tyCum },
              { label: String(lyY), color: PALETTE[1], points: lyCum },
              { label: `${mtY} (midterm year)`, color: PALETTE[4], dashed: '4 4', points: mtCum }], mFmt, { band }),
            dataTable([{ label: 'Month', value: (r) => r.m }, { label: 'This year', value: (r) => r.ty, fmt: fmt.money }, { label: String(lyY), value: (r) => r.ly, fmt: fmt.money }, { label: String(mtY), value: (r) => r.mt, fmt: fmt.money }],
              monthLabels.map((m, i) => ({ m, ty: tyCum[i] ?? NaN, ly: lyCum[i], mt: mtCum[i] }))))),
          card('sc-channels', 'Channels side by side', `Revenue, cost, net and new donors this year to date, with the year-end projection. Always the calendar year, whatever period is picked. A dash means there is nothing to measure.`, table([
            { label: 'Channel', value: (r) => r.channel },
            { label: 'Revenue', value: (r) => num(r.ytd), fmt: fmt.money },
            { label: 'Share', value: (r) => div(r.ytd, all.ytd), fmt: fmt.pct },
            { label: `vs ${lyY}`, value: changeOf, fmt: fmt.change, cls: (r) => { const v = changeOf(r); return isNaN(v) ? '' : v > 0 ? 'ef-good' : v < 0 ? 'ef-bad' : ''; } },
            { label: 'Cost', value: (r) => (r.cost_ty ? r.cost_ty : NaN), fmt: fmt.money },
            { label: 'Net', value: (r) => (r.cost_ty ? num(r.ytd) - r.cost_ty : NaN), fmt: fmt.money },
            { label: 'Raised per $1', value: (r) => (r.cost_ty ? div(r.ytd, r.cost_ty) : NaN), fmt: fmt.money2 },
            { label: 'New donors', value: (r) => (r.nd || NaN), fmt: fmt.int },
            { label: 'Projected year-end', value: (r) => range(r, mFmt) },
            { label: 'Based on', value: (r) => (num(r.ly_ytd) && num(r.mt_ytd) ? `${lyY} and ${mtY} pace` : num(r.ly_ytd) ? `${lyY} pace only` : num(r.mt_ytd) ? `${mtY} pace only` : '—') },
          ], rows),
            el('p', { class: 'ef-note' }, el('b', { text: 'How to read this. ' }), 'Cost is the ad and sending spend recorded on messages, plus the cost of rented-list source codes used this year. Channels with no recorded cost show a dash, not $0. New donors counts the channel of each person\'s first gift.')),
          card('sc-months', 'Revenue by month', `This year, ${lyY} and ${mtY}. The current month is still in progress.`, table([
            { label: 'Month', value: (r) => MONTH_NAMES[num(r.month_no) - 1] },
            { label: 'This year', value: (r) => (num(r.month_no) <= num(r.this_month) ? num(r.ty) : NaN), fmt: fmt.money },
            { label: String(lyY), value: (r) => num(r.ly), fmt: fmt.money },
            { label: String(mtY), value: (r) => num(r.mt), fmt: fmt.money },
          ], months)),
          card('sc-list', 'List growth', 'Email sign-ups by month, from the email platform records, and where the list stands today.', !listRows.length ? el('p', { class: 'ef-empty', text: 'No email platform records are available for this account.' }) : el('div', {},
            tiles(
              tile('Sign-ups this year', signTy, signLy, fmt.int, { note: `Through this month · ${lyY} same months ${fmt.int(signLy)}` }),
              tile('Subscribed now', status('Subscribed'), NaN, fmt.int, { note: 'People who can be emailed today' }),
              tile('Unsubscribed', status('Unsubscribed'), NaN, fmt.int, { note: 'Opted out of email' }),
              tile('Not subscribed', status('Not Subscribed'), NaN, fmt.int, { note: 'On file but never opted in' })),
            pairedBars(listRows.map((r) => ({ ...r, month: `2000-${String(r.month_no).padStart(2, '0')}-01` })), 'month', [{ key: 'ly', label: String(lyY), color: PALETTE[4] }, { key: 'ty', label: 'This year', color: PALETTE[0] }], fmt.int, { xFormat: (v) => MONTH_NAMES[num(String(v).slice(5, 7)) - 1] }),
            dataTable([{ label: 'Month', value: (r) => MONTH_NAMES[num(r.month_no) - 1] }, { label: String(lyY), value: (r) => num(r.ly), fmt: fmt.int }, { label: 'This year', value: (r) => num(r.ty), fmt: fmt.int }], listRows),
            el('p', { class: 'ef-note' }, el('b', { text: 'What is missing. ' }), 'The email platform on this account does not record when people opt out, so there is no month-by-month loss line. The status counts above show today\'s list only.'))),
        ];
      },
    },

    acquisition: {
      title: 'Acquisition',
      async load(w) {
        const optional = (p) => p.catch(() => null);
        const [period, monthly, codes, cost, signups] = await Promise.all([
          queryWith('ACQ_PERIOD', w), query('ACQ_MONTHLY'), optional(queryWith('ACQ_CODES', w)), optional(queryWith('ACQ_COST', w)), optional(queryWith('ACQ_SIGNUPS', w))]);
        // Bought lists are slow, so the tab does not wait for them.
        const bought = queryWith('ACQ_BOUGHT_LISTS', w).catch(() => null);
        return { period, monthly, codes: codes || [], cost: cost || [], signups, bought, w };
      },
      render({ period, monthly, codes, cost, signups, bought, w }) {
        const ORIGINS = [
          { key: 'Email', label: 'Email', members: ['Email'], color: PALETTE[0] },
          { key: 'Texts', label: 'Texts', members: ['Text (SMS)'], color: PALETTE[1] },
          { key: 'Paid ads', label: 'Paid ads', members: ['Meta ads', 'Google ads', 'Paid ads (coded)'], color: PALETTE[2] },
          { key: 'Rented lists', label: 'Rented lists', members: ['Rented lists'], color: PALETTE[3] },
          { key: 'Website and other', label: 'Website and other', members: ['Website', 'Social media', 'Direct mail', 'ActBlue thank-you page', 'Other source code'], color: '#4f9d8a' },
          { key: 'No readable channel', label: 'No readable channel', members: ['No source code'], color: '#b9c1be' },
        ];
        const originOf = (ch) => (ORIGINS.find((o) => o.members.includes(ch)) || ORIGINS[4]).key;
        const sum = (rows, f) => rows.reduce((t, r) => t + (num(r[f]) || 0), 0);
        const ty = period.filter((r) => r.period === 'ty'), ly = period.filter((r) => r.period === 'ly');
        const nTy = sum(ty, 'donors'), nLy = sum(ly, 'donors');
        const perDonor = (rows, f) => div(sum(rows, f), sum(rows, 'donors'));
        const laterTy = sum(ty, 'later_amt'), laterLy = sum(ly, 'later_amt');
        const again = (rows) => div(sum(rows, 'gave_again'), sum(rows, 'donors'));
        // Paid acquisition: ad cost, rented lists (no cost on record), with each source's new donors and what they've given.
        const costOf = (ch) => num(cost.find((r) => r.period === 'ty' && r.channel === ch)?.cost) || 0;
        const donorsOf = (rows, chs) => rows.filter((r) => chs.includes(r.channel));
        const paidSources = [
          { name: 'Paid ads – Meta', chs: ['Meta ads'], cost: costOf('Meta ads'), how: 'First gift credited to a Meta ad' },
          { name: 'Paid ads – Google', chs: ['Google ads'], cost: costOf('Google ads'), how: 'First gift credited to a Google ad' },
          { name: 'Rented lists', chs: ['Rented lists'], cost: NaN, how: 'RTL codes; no rental cost is on record' },
        ].map((s) => { const rows = donorsOf(ty, s.chs); return { ...s, donors: sum(rows, 'donors'), raised: sum(rows, 'first_amt') + sum(rows, 'later_amt') }; });
        const adRows = paidSources.slice(0, 2);
        const adCost = sum(adRows, 'cost'), adDonors = sum(adRows, 'donors'), adRaised = sum(adRows, 'raised');
        const costed = (r) => !isNaN(r.cost) && r.cost > 0;
        // By month and origin (stacked), then by quarter.
        const months = [...new Set(monthly.map((r) => String(r.month).slice(0, 10)))].sort();
        const thisYear = new Date().getFullYear();
        const monthRows = months.map((m) => { const row = { month: m }; for (const o of ORIGINS) row[o.key] = 0; for (const r of monthly.filter((x) => String(x.month).slice(0, 10) === m)) row[originOf(r.channel)] += num(r.donors) || 0; return row; });
        const mLabel = (v) => MONTH_NAMES[num(String(v).slice(5, 7)) - 1] + (num(String(v).slice(0, 4)) < thisYear ? ' LY' : '');
        const quarters = new Map();
        for (const r of monthly) {
          const d = String(r.month).slice(0, 10), q = `${d.slice(0, 4)}-Q${Math.floor((num(d.slice(5, 7)) - 1) / 3) + 1}`;
          const g = quarters.get(q) || { q, donors: 0, first: 0, later: 0, again: 0 };
          g.donors += num(r.donors) || 0; g.first += num(r.first_amt) || 0; g.later += num(r.later_amt) || 0; g.again += num(r.gave_again) || 0;
          quarters.set(q, g);
        }
        const qRows = [...quarters.values()].sort((a, b) => a.q.localeCompare(b.q)).map((g) => ({ ...g, label: `Q${g.q.slice(-1)}${num(g.q.slice(0, 4)) < thisYear ? ' LY' : ''}`, first_avg: div(g.first, g.donors), later_avg: div(g.later, g.donors), again_share: div(g.again, g.donors) }));
        // Origin table.
        const originRows = ORIGINS.map((o) => {
          const a = ty.filter((r) => o.members.includes(r.channel)), b = ly.filter((r) => o.members.includes(r.channel));
          return { origin: o.label, donors: sum(a, 'donors'), ly_donors: sum(b, 'donors'), first_avg: perDonor(a, 'first_amt'), value: div(sum(a, 'first_amt') + sum(a, 'later_amt'), sum(a, 'donors')), again: again(a), monthly: sum(a, 'started_monthly'), active: div(sum(a, 'active_90'), sum(a, 'donors')), cpd: o.key === 'Paid ads' && adDonors ? div(adCost, adDonors) : NaN };
        }).filter((r) => r.donors || r.ly_donors);
        const top = originRows.slice().sort((a, b) => b.donors - a.donors)[0];
        const sources = (() => {
          if (!signups) return [];
          const by = new Map();
          for (const r of signups) { const g = by.get(r.source) || { source: r.source, ty: 0, ly: 0, subscribed: 0 }; if (r.period === 'ty') { g.ty += num(r.signups) || 0; g.subscribed += num(r.still_subscribed) || 0; } else g.ly += num(r.signups) || 0; by.set(r.source, g); }
          return [...by.values()].filter((g) => g.ty || g.ly).sort((a, b) => b.ty - a.ty).slice(0, 12);
        })();
        // Paid acquisition card: ads plus bought lists. Bought lists take about a minute to work out, so they fill in when ready.
        const adSignups = sum(signups ? signups.filter((r) => r.period === 'ty' && r.source === 'AD') : [], 'signups');
        const allSignups = sum(signups ? signups.filter((r) => r.period === 'ty') : [], 'signups');
        const paidCard = (bought) => {
          const bl = bought ? bought.find((r) => r.period === 'ty') : null;
          const lists = bl ? { name: 'Bought lists (co-registration)', cost: num(bl.cost), signups: num(bl.signups), donors: num(bl.new_donors), raised: num(bl.raised), how: `${fmt.int(num(bl.lists))} imported lists with a purchase price on the source code; new donors are list names who first gave after joining` } : null;
          const rows = [...(lists ? [lists] : []), ...paidSources.map((r) => ({ ...r, signups: NaN }))];
          const costAll = adCost + (lists ? lists.cost : 0), donorsAll = adDonors + (lists ? lists.donors : 0), raisedAll = adRaised + (lists ? lists.raised : 0);
          const paidSignups = adSignups + (lists ? lists.signups : 0);
          return card('acq-paid', 'Paid acquisition: what it cost and what it has returned', 'Every paid way of finding new supporters in this period. Raised per $1 counts only gifts from people who were new donors, from their first gift up to today, so it keeps growing as they give again.', tiles(
            tile('Paid acquisition cost', costAll, NaN, fmt.money, { note: `${lists ? `${fmt.money(lists.cost)} bought lists · ` : ''}${fmt.money(adCost)} ads` }),
            tile('New donors from paid sources', donorsAll, NaN, fmt.int, { note: donorsAll ? `${fmt.money2(div(costAll, donorsAll))} per new donor` : 'None in this period' }),
            tile('Raised per $1 so far', div(raisedAll, costAll), NaN, fmt.money2, { note: `New donors only · ads ${fmt.money2(div(adRaised, adCost))}${lists ? `, bought lists ${fmt.money2(div(lists.raised, lists.cost))}` : ''}` }),
            signups ? tile('Email sign-ups, all sources', allSignups, NaN, fmt.int, { note: `${fmt.int(paidSignups)} from paid sources` }) : null),
            table([
              { label: 'Source', value: (r) => r.name },
              { label: 'Cost', value: (r) => (costed(r) ? r.cost : 'Not recorded'), fmt: (v) => (typeof v === 'number' ? fmt.money(v) : v) },
              { label: 'Email sign-ups', value: (r) => r.signups, fmt: fmt.int },
              { label: 'Cost per sign-up', value: (r) => (costed(r) ? div(r.cost, r.signups) : NaN), fmt: fmt.money2 },
              { label: 'New donors', value: (r) => r.donors, fmt: fmt.int },
              { label: 'Cost per new donor', value: (r) => (costed(r) ? div(r.cost, r.donors) : NaN), fmt: fmt.money2 },
              { label: 'Raised by those donors', value: (r) => r.raised, fmt: fmt.money },
              { label: 'Per $1', value: (r) => (costed(r) ? div(r.raised, r.cost) : NaN), fmt: fmt.money2 },
              { label: 'How it\'s counted', value: (r) => r.how },
            ], rows.filter((r) => r.donors || costed(r)), undefined, 'ef-table-text'),
            bought === undefined ? el('p', { class: 'ef-note', text: 'Working out bought lists. This takes about a minute and fills in here.' }) : null,
            bought === null ? el('p', { class: 'ef-note', text: 'Bought lists could not be worked out just now, so only ads and rented lists are shown.' }) : null,
            adSignups > 0 ? el('p', { class: 'ef-note', text: `Ad sign-ups (${fmt.int(adSignups)}) can't be split between Meta and Google, so they appear only in the totals above.` }) : null,
            paidSources[2].donors ? el('p', { class: 'ef-note' }, el('b', { text: 'Rented lists can\'t show payback yet. ' }), `They brought in ${fmt.int(paidSources[2].donors)} new donors who have given ${fmt.money(paidSources[2].raised)}, but no rental cost is entered on the RTL source codes. The Data Quality tab lists this.`) : null);
        };
        const paidSlot = el('div', {}, paidCard(undefined));
        if (bought) bought.then((rows) => paidSlot.replaceChildren(paidCard(rows)));
        const SIGN = { IMPORT: 'Imported lists', RTL: 'Rented lists', AD: 'Paid ads', EM: 'Email', BC: 'Text broadcast', P2P: 'Text peer-to-peer' };
        return [
          lede(`${fmt.int(nTy)} people have given for the first time in this period, against ${fmt.int(nLy)} in the same dates last year. Together they have given ${fmt.money(sum(ty, 'first_amt') + laterTy)}.${top ? ` ${top.origin} brought in the most new donors (${fmt.int(top.donors)}).` : ''}`),
          el('details', { class: 'ef-card ef-details' }, el('summary', { text: 'Read this first: how origin is worked out' }),
            el('p', { text: 'Origin means the channel of a person\'s first gift, not their first sign-up. Someone who joined at an event and later gave from an email counts as an email donor.' }),
            el('p', { text: 'Channel is read from the linked message, else from the source code, by the rules on the All Donations tab. First gifts with no readable code are grey in the chart.' }),
            el('p', { text: 'Ad cost per new donor is an upper bound: it divides all ad spend by donors whose first gift was credited to an ad.' }),
            el('p', { text: 'Recent donors have had less time to give again, so compare quarters with that in mind. New donors are counted from January 1 of last year, so at least a year of history stands behind each.' })),
          paidSlot,
          card('acq-signups', 'Email sign-ups by source', 'People added to the email list in this period, grouped by the type part of the source code on their email platform record.', signups === null || !sources.length
            ? el('p', { class: 'ef-empty', text: 'No email platform records are available for this account.' })
            : table([
              { label: 'Source', value: (r) => SIGN[r.source] || r.source },
              { label: 'Sign-ups', value: (r) => r.ty, fmt: fmt.int },
              { label: 'vs last year', value: (r) => change(r.ty, r.ly), fmt: fmt.change, cls: (r) => { const v = change(r.ty, r.ly); return isNaN(v) ? '' : v > 0 ? 'ef-good' : v < 0 ? 'ef-bad' : ''; } },
              { label: 'Still subscribed', value: (r) => div(r.subscribed, r.ty), fmt: fmt.pct },
            ], sources)),
          tiles(
            tile('New donors', nTy, nLy, fmt.int, { note: `First gift on record came in this period · last year ${fmt.int(nLy)}` }),
            tile('First-gift revenue', sum(ty, 'first_amt'), sum(ly, 'first_amt'), fmt.money, { note: `${fmt.money2(perDonor(ty, 'first_amt'))} average first gift · last year ${fmt.money2(perDonor(ly, 'first_amt'))}` }),
            tile('Later gifts from new donors', laterTy, laterLy, fmt.money, { note: `Every gift after the first · last year ${fmt.money(laterLy)}` }),
            tile('Gave again', again(ty), again(ly), fmt.pct, { note: `${fmt.int(sum(ty, 'gave_again'))} made a second gift · last year ${fmt.pct(again(ly))}` }),
            tile('Started monthly on day one', sum(ty, 'started_monthly'), sum(ly, 'started_monthly'), fmt.int, { note: `First gift was a recurring payment · last year ${fmt.int(sum(ly, 'started_monthly'))}` })),
          card('acq-months', 'New donors by month and origin', 'Each bar counts people whose first gift came that month, split by the channel of that gift, from January last year. Segments stack in the legend\'s order, bottom to top. The current month is still in progress.', el('div', {},
            stackedBars(monthRows, 'month', ORIGINS.map((o) => ({ key: o.key, label: o.label, color: o.color })), fmt.int, { xFormat: mLabel }),
            dataTable([{ label: 'Month', value: (r) => r.month, fmt: mLabel }, ...ORIGINS.map((o) => ({ label: o.label, value: (r) => r[o.key], fmt: fmt.int })), { label: 'Total', value: (r) => ORIGINS.reduce((t, o) => t + r[o.key], 0), fmt: fmt.int }], monthRows))),
          card('acq-origin', 'Where new donors in this period came from', 'One row per origin channel, for people whose first gift came in the selected period. Value per donor is everything they have given so far, first gift included. Cost per new donor only exists for ads.', table([
            { label: 'Origin channel', value: (r) => r.origin },
            { label: 'New donors', value: (r) => r.donors, fmt: fmt.int },
            { label: 'Last year', value: (r) => r.ly_donors, fmt: fmt.int },
            { label: 'Avg first gift', value: (r) => r.first_avg, fmt: fmt.money2 },
            { label: 'Value per donor', value: (r) => r.value, fmt: fmt.money2 },
            { label: 'Gave again', value: (r) => r.again, fmt: fmt.pct },
            { label: 'Started monthly', value: (r) => r.monthly, fmt: fmt.int },
            { label: 'Gave in last 90 days', value: (r) => r.active, fmt: fmt.pct },
            { label: 'Cost per new donor', value: (r) => r.cpd, fmt: fmt.money2 },
          ], originRows)),
          card('acq-quarters', 'What each quarter\'s new donors have given since', 'Average value per donor for each quarter\'s new donors, split into the first gift and everything given after it, up to today. The bold figure under each quarter is the share who gave again.', el('div', {},
            stackedBars(qRows, 'label', [{ key: 'first_avg', label: 'First gift', color: PALETTE[0] }, { key: 'later_avg', label: 'Later gifts', color: PALETTE[1] }], fmt.money2, { xFormat: (v) => v, sub: (r) => fmt.pct(r.again_share) }),
            dataTable([{ label: 'Quarter', value: (r) => r.label }, { label: 'First gift', value: (r) => r.first_avg, fmt: fmt.money2 }, { label: 'Later gifts', value: (r) => r.later_avg, fmt: fmt.money2 }, { label: 'Gave again', value: (r) => r.again_share, fmt: fmt.pct }], qRows))),
          card('acq-codes', 'Top 12 first-gift source codes in this period', 'The source codes that brought in the most new donors in the period, with what those donors have given.', table([
            { label: 'Source code', value: (r) => r.source },
            { label: 'Channel', value: (r) => r.channel },
            { label: 'New donors', value: (r) => num(r.donors), fmt: fmt.int },
            { label: 'Avg first gift', value: (r) => div(r.first_amt, r.donors), fmt: fmt.money2 },
            { label: 'Value per donor', value: (r) => div(num(r.first_amt) + num(r.later_amt), r.donors), fmt: fmt.money2 },
            { label: 'Gave again', value: (r) => div(r.gave_again, r.donors), fmt: fmt.pct },
          ], codes, 'No new donors in this period.')),
        ];
      },
    },

    dq: {
      title: 'Data Quality',
      async load() {
        const [summary, off, months, pages, acq] = await Promise.all(['DQ_SUMMARY', 'DQ_OFF_CONVENTION', 'DQ_MONTHS', 'DQ_PAGES', 'DQ_ACQUISITION_COST'].map(query));
        const flaws = await query('DQ_CODE_FLAWS').catch(() => []);
        return { summary, off, months, pages, acq: acq[0] || {}, flaws };
      },
      render({ summary, off, months, pages, acq, flaws }) {
        const t = summary.find((r) => r.period === 'This year') || {}, l = summary.find((r) => r.period === 'Last year') || {};
        const share = (r, k) => div(r[k + '_revenue'], r.revenue);
        const mk = (label, k, opts = {}) => tile(label, share(t, k), share(l, k), fmt.pct, { lowerIsBetter: true, ...opts, note: `${fmt.money(num(t[k + '_revenue']))} · ${fmt.int(num(t[k + '_gifts']))} gifts · last year ${fmt.pct(share(l, k))}` });
        const byMonth = new Map();
        for (const r of months) {
          const m = byMonth.get(r.month_no) || { month_no: r.month_no };
          m[num(r.y) === 0 ? 'ty' : 'ly'] = r;
          byMonth.set(r.month_no, m);
        }
        const unread = (r) => (r ? div(r.unreadable_revenue, r.revenue) : NaN);
        // Issues ranked by what they hide. High at $100K or 5% of revenue, medium at $10K or 1%, otherwise low.
        const sev = (rev, cap) => { const v = rawSev(rev); return cap && ORDER_N[v] < ORDER_N[cap] ? cap : v; };
        const ORDER_N = { High: 0, Medium: 1, Low: 2 };
        const rawSev = (rev) => (rev >= 1e5 || rev / num(t.revenue) >= 0.05 ? 'High' : rev >= 1e4 || rev / num(t.revenue) >= 0.01 ? 'Medium' : 'Low');
        const flawOf = (kind) => flaws.find((r) => r.kind === kind);
        const topPage = pages[0]?.page;
        const rtlNoCost = num(acq.rtl_codes) - num(acq.rtl_codes_with_cost);
        const issues = [
          { issue: 'Gifts with no source code', rev: num(t.uncoded_revenue), see: `${fmt.money(num(t.uncoded_revenue))} and ${fmt.int(num(t.uncoded_gifts))} gifts, ${fmt.pct(share(t, 'uncoded'))} of revenue`, affects: 'Channel revenue, acquisition origin', fix: `Set a default source code on every live contribution form${topPage ? `, starting with ${topPage}` : ''}`, owner: 'Digital team' },
          { issue: 'Codes outside the naming convention', rev: num(t.offconv_revenue), see: `${fmt.money(num(t.offconv_revenue))} and ${fmt.int(num(t.offconv_gifts))} gifts, ${fmt.pct(share(t, 'offconv'))} of revenue`, affects: 'Channel is guessed from words in the code', fix: 'Move onto the LOC_ / MS_ convention or map the code in the dictionary', owner: 'Data team', cap: 'Medium' },
          { issue: 'Code channel field empty', rev: num(t.nochannel_revenue), see: `${fmt.pct(div(t.nochannel_gifts, num(t.gifts) - num(t.uncoded_gifts)))} of coded gifts (${fmt.money(num(t.nochannel_revenue))})`, affects: 'Channel depends on code naming', fix: 'Fill the channel on the source codes that lack it', owner: 'Data team', cap: 'Medium' },
          { issue: 'Campaign field empty', rev: num(t.nocampaign_revenue), see: `${fmt.pct(div(t.nocampaign_gifts, num(t.gifts) - num(t.uncoded_gifts)))} of coded gifts (${fmt.money(num(t.nocampaign_revenue))})`, affects: 'Roll-ups by campaign', fix: 'Set the campaign field when codes are created', owner: 'Data team', cap: 'Low' },
          flawOf('merge') ? { issue: 'Source code shipped as an unfilled merge tag', rev: num(flawOf('merge').revenue), see: `${fmt.int(num(flawOf('merge').gifts))} gifts whose code is a literal merge tag such as ${flawOf('merge').example} (${fmt.money(num(flawOf('merge').revenue))})`, affects: 'Email and ad revenue that cannot be traced to a send', fix: 'Add a merge-field check to pre-send QA', owner: 'Email team' } : null,
          flawOf('variant') ? { issue: 'Variant codes used as live codes', rev: num(flawOf('variant').revenue), see: `${fmt.int(num(flawOf('variant').codes))} codes such as ${flawOf('variant').example}: ${fmt.int(num(flawOf('variant').gifts))} gifts, ${fmt.money(num(flawOf('variant').revenue))}`, affects: 'Email results by send', fix: 'Suffix the parent code instead of using v1, v2, ctrl or test on its own', owner: 'Email team', cap: 'Medium' } : null,
          rtlNoCost > 0 ? { issue: 'Rented-list codes carry no cost', rev: Infinity, see: `${fmt.int(rtlNoCost)} of ${fmt.int(num(acq.rtl_codes))} rented-list codes have no cost on file`, affects: 'Raised per $1, acquisition payback', fix: 'Enter the rental cost when RTL codes are created', owner: 'List manager' } : null,
        ].filter(Boolean).map((r) => ({ ...r, severity: r.rev === Infinity ? 'High' : sev(r.rev, r.cap) }));
        const ORDER = { High: 0, Medium: 1, Low: 2 };
        issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.rev === Infinity ? 1 : 0) - (a.rev === Infinity ? 1 : 0) || b.rev - a.rev);
        const trendMonths = [...byMonth.values()].sort((a, b) => num(a.month_no) - num(b.month_no)).map((m) => ({ ...m, ty_share: unread(m.ty), ly_share: unread(m.ly), ty_dollars: num(m.ty?.unreadable_revenue), ly_dollars: num(m.ly?.unreadable_revenue) }));
        const highCount = issues.filter((i) => i.severity === 'High').length;
        return [
          lede(`${fmt.pct(1 - share(t, 'unreadable'))} of this year's revenue can be traced to a channel. The ${fmt.pct(share(t, 'unreadable'))} (${fmt.money(num(t.unreadable_revenue))}) that can't comes from gifts with no source code or a code that reads as no channel.${highCount ? ` ${highCount} issue${highCount > 1 ? 's are' : ' is'} rated high below.` : ''} Gifts are counted for the year to date, whatever period is picked.`),
          card('dq-glance', 'Data health at a glance', null, tiles(
            tile('Revenue traced to a channel', 1 - share(t, 'unreadable'), 1 - share(l, 'unreadable'), fmt.pct, { note: `${fmt.money(num(t.revenue) - num(t.unreadable_revenue))} of ${fmt.money(num(t.revenue))} · last year ${fmt.pct(1 - share(l, 'unreadable'))}` }),
            tile('Gifts linked to a specific message', div(t.linked_gifts, t.gifts), div(l.linked_gifts, l.gifts), fmt.pct, { note: `${fmt.int(num(t.linked_gifts))} of ${fmt.int(num(t.gifts))} gifts` }),
            tile('Coded gifts whose code has a channel field', 1 - div(t.nochannel_gifts, num(t.gifts) - num(t.uncoded_gifts)), 1 - div(l.nochannel_gifts, num(l.gifts) - num(l.uncoded_gifts)), fmt.pct, { note: 'The rest is read from the code\'s naming' }),
            tile('Rented-list codes with a recorded cost', div(acq.rtl_codes_with_cost, acq.rtl_codes), NaN, fmt.pct, { note: `${fmt.int(num(acq.rtl_codes_with_cost))} of ${fmt.int(num(acq.rtl_codes))} RTL codes` }))),
          card('dq-issues', 'Issues, ranked by what they hide', 'High when an issue touches $100K or 5% of revenue; medium at $10K or 1%; otherwise low. Severity is shown as a word, not just a color. Owners are suggestions for the client team to confirm.', table([
            { label: 'Severity', value: (r) => r.severity, cls: (r) => (r.severity === 'High' ? 'ef-bad' : r.severity === 'Medium' ? 'ef-warn' : '') },
            { label: 'Issue', value: (r) => r.issue },
            { label: 'What we see this year', value: (r) => r.see },
            { label: 'Affects', value: (r) => r.affects },
            { label: 'Recommended fix', value: (r) => r.fix },
            { label: 'Owner', value: (r) => r.owner },
          ], issues, 'No issues found.', 'ef-table-text')),
          card('dq-trend', 'Is coding getting better?', 'Share of each month\'s revenue with no readable channel, this year beside last year. Lower is better.', trendMonths.length ? el('div', {},
            scaledBars(trendMonths, [{ key: 'ly_share', label: 'Last year', color: PALETTE[4] }, { key: 'ty_share', label: 'This year', color: PALETTE[0] }], { xLabel: (r) => MONTH_NAMES[num(r.month_no) - 1], tip: (r) => `${MONTH_NAMES[num(r.month_no) - 1]}: this year ${fmt.pct(r.ty_share)}, last year ${fmt.pct(r.ly_share)}`, format: fmt.pct }),
            dataTable([{ label: 'Month', value: (r) => MONTH_NAMES[num(r.month_no) - 1] }, { label: 'This year', value: (r) => r.ty_share, fmt: fmt.pct }, { label: 'Last year', value: (r) => r.ly_share, fmt: fmt.pct }], trendMonths)) : el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' })),
          card('dq-recs', 'Recommendations for the client team', 'The issues above, grouped by when to fix them: high this week, medium this month, low this quarter.', ...[['This week', 'High'], ['This month', 'Medium'], ['This quarter', 'Low']].map(([label, severity]) => {
            const list = issues.filter((i) => i.severity === severity);
            return el('div', {}, el('h3', { class: 'ef-h2', text: label }), list.length ? el('ul', {}, list.map((i) => el('li', { text: `${i.fix} (${i.owner}).` }))) : el('p', { class: 'ef-empty', text: 'Nothing at this level.' }));
          })),
          card('dq-fields', 'Field completeness', 'Share of this year\'s revenue with each field filled in. Last year is on the same dates.', tiles(
            mk('No source code', 'uncoded'),
            mk('Outside the LOC_ / MS_ convention', 'offconv'),
            mk('Source code has no channel', 'nochannel'),
            mk('Source code has no campaign', 'nocampaign'),
            mk('No readable channel', 'unreadable', { note: `Revenue that can't be credited to a channel · ${fmt.money(num(t.unreadable_revenue))}` }),
            tile('Linked to an email, text or ad', share(t, 'linked'), share(l, 'linked'), fmt.pct, { note: `${fmt.money(num(t.linked_revenue))} · ${fmt.int(num(t.linked_gifts))} gifts · last year ${fmt.pct(share(l, 'linked'))}` }))),
          card('dq-off', 'Codes outside the naming convention', 'Gifts whose source code doesn\'t start with LOC_ or MS_, by the channel they read as.', table([
            { label: 'Reads as', value: (r) => r.channel },
            { label: 'Codes', value: (r) => num(r.codes), fmt: fmt.int },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money },
          ], off, 'Every source code this year follows the convention.')),
          card('dq-months', 'Revenue with no readable channel, by month', 'Dollars each month with no source code, or a code that reads as no channel, this year beside last year.', trendMonths.length ? el('div', {},
            scaledBars(trendMonths, [{ key: 'ly_dollars', label: 'Last year', color: PALETTE[4] }, { key: 'ty_dollars', label: 'This year', color: PALETTE[0] }], { xLabel: (r) => MONTH_NAMES[num(r.month_no) - 1], tip: (r) => `${MONTH_NAMES[num(r.month_no) - 1]}: this year ${fmt.money(r.ty_dollars)} (${fmt.pct(r.ty_share)}), last year ${fmt.money(r.ly_dollars)} (${fmt.pct(r.ly_share)})`, format: fmt.money }),
            dataTable([{ label: 'Month', value: (r) => MONTH_NAMES[num(r.month_no) - 1] }, { label: 'This year', value: (r) => r.ty_dollars, fmt: fmt.money }, { label: 'Share', value: (r) => r.ty_share, fmt: fmt.pct }, { label: 'Last year', value: (r) => r.ly_dollars, fmt: fmt.money }, { label: 'Share', value: (r) => r.ly_share, fmt: fmt.pct }], trendMonths)) : el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' })),
          card('dq-pages', 'Pages taking gifts with no source code', 'The 10 pages (for ActBlue, the contribution form) with the most uncoded revenue this year.', table([
            { label: 'Page', value: (r) => r.page },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money },
          ], pages, 'Every gift this year has a source code.')),
          card('dq-acq', 'Acquisition costs on file', 'Source codes used this year that have an acquisition cost in the source code dictionary.', table([
            { label: '', value: (r) => r.label },
            { label: 'Source codes', value: (r) => r.codes, fmt: fmt.int },
            { label: 'With a cost', value: (r) => r.with_cost, fmt: fmt.int },
            { label: 'Cost on file', value: (r) => r.cost, fmt: fmt.money },
          ], [
            { label: 'All source codes', codes: num(acq.codes), with_cost: num(acq.codes_with_cost), cost: num(acq.cost_total) },
            { label: 'Rented lists (RTL)', codes: num(acq.rtl_codes), with_cost: num(acq.rtl_codes_with_cost), cost: num(acq.rtl_cost) },
          ]), num(acq.codes_bad_cost) ? el('p', { class: 'ef-sum-meta', text: `${fmt.int(num(acq.codes_bad_cost))} codes hold a cost of $1 million or more, which is left out as an error.` }) : null),
        ];
      },
    },
  };

  // ---- Agency summaries and notes ------------------------------------------------
  const REPORT_FOR_TAB = { transactions: 'all_donations', email: 'email', sms: 'sms', ads: 'advertising' };
  const REPORT_PATH = (tab) => `${CFG.pluginPath}:reports:${REPORT_FOR_TAB[tab] || tab}`;
  const A = window.FR_AGENCY;
  const T = Object.fromEntries(A.tables.map((t) => [t.name, t]));
  const SUMMARY = 'fundraising_report_summary';
  const NOTE = 'fundraising_report_note';
  const lit = A.textLiteral;
  let me = null; // the signed-in person's email: the author of what they write

  async function sql(text) {
    return (await call('sql', { command: 'query', sql: text })).data || [];
  }
  async function author() {
    if (!me) {
      const u = await call('user', {});
      me = u.email || u.uid;
      if (!me) throw new Error("engine9 didn't say who is signed in, so notes can't be saved.");
    }
    return me;
  }

  // engine9 reports a failed tool call to the page without the database's own
  // message ("sql failed"), so don't rely on error text to learn what's wrong:
  // ask which tables exist.
  async function haveNotesTables() {
    const res = await call('sql', { command: 'tables', filter: '^fundraising_report_' });
    const names = ((res.result || {}).tables || []).map((t) => (typeof t === 'string' ? t : t.name || t.table_name || Object.values(t)[0]));
    return names.includes(SUMMARY) && names.includes(NOTE);
  }
  function noteError(err) {
    const msg = String((err && err.message) || err);
    if (/^sql failed$|^tool_error$/i.test(msg) || !msg) return "engine9 refused the request without saying why. Your login may not be allowed to use the sql tool on this account, or the account's database may be unavailable.";
    return msg;
  }

  /** Create the two tables on this account. Only the person's own click does this. */
  function setupCard(card, done) {
    const msg = el('p', { class: 'fr-msg', role: 'status' });
    const btn = el('button', { type: 'button', class: 'ef-segbtn', text: 'Set up notes on this account', onclick: async () => {
      btn.disabled = true; msg.textContent = 'Creating the tables…';
      try {
        for (const t of A.tables) await sql(A.createTableSql(t));
        done();
      } catch (err) { btn.disabled = false; msg.textContent = noteError(err); }
    } });
    card.replaceChildren(
      el('h2', { class: 'ef-h2', text: 'Executive summary and agency notes' }),
      el('p', { class: 'ef-sum-meta', text: `This account doesn't have the notes tables yet. Setting up adds two tables (${SUMMARY} and ${NOTE}) to ${state.accountName || state.account}'s engine9 database. Nothing else changes.` }),
      btn, msg);
  }

  async function agencyPanel(tabKey, w) {
    const wrap = el('div', { class: 'ef-stack' });
    const summaryCard = el('section', { class: 'ef-card ef-summary', id: `${tabKey}-summary` }, el('h2', { class: 'ef-h2', text: 'Executive summary' }), el('p', { class: 'ef-sum-meta', text: 'Loading…' }));
    const notesCard = el('section', { class: 'ef-card', id: `${tabKey}-notes` }, el('h2', { class: 'ef-h2', text: 'Agency notes' }), el('p', { class: 'ef-sum-meta', text: 'Loading…' }));
    wrap.append(summaryCard, notesCard);
    const path = REPORT_PATH(tabKey);

    const draw = async () => {
      let summary, notes;
      try {
        if (!(await haveNotesTables())) {
          notesCard.remove();
          setupCard(summaryCard, draw);
          return;
        }
        [summary, notes] = await Promise.all([
          sql(`SELECT * FROM ${SUMMARY} WHERE report_path = ${lit(path)} AND section = ${lit(tabKey)} AND period = ${lit(state.period)} AND status = 'published' ORDER BY modified_at DESC LIMIT 1`),
          sql(`SELECT * FROM ${NOTE} WHERE report_path = ${lit(path)} AND status <> 'archived' ORDER BY created_at DESC LIMIT 50`),
        ]);
        notesAvailable = true;
      } catch (err) {
        notesAvailable = false;
        summaryCard.replaceChildren(el('h2', { class: 'ef-h2', text: 'Executive summary' }), el('p', { class: 'ef-sum-meta', text: noteError(err) }));
        notesCard.remove();
        return;
      }
      if (!wrap.contains(notesCard)) wrap.append(notesCard);
      const s = summary[0];
      summaryCard.replaceChildren(...[
        el('h2', { class: 'ef-h2', text: 'Executive summary' }),
        s ? el('p', { class: 'ef-sum-head', text: s.headline || '' }) : el('p', { class: 'ef-sum-meta', text: 'No summary has been written for this tab and period yet.' }),
        s && s.body ? el('div', { class: 'fr-body', text: s.body }) : null,
        s ? el('p', { class: 'ef-sum-meta', text: `${s.author_type === 'agent' ? 'Written by an agent' + (s.author ? ' for ' + s.author : '') : 'Written by ' + (s.author || 'Frakture')} · ${fmt.day(s.modified_at)}` }) : null,
        summaryForm(tabKey, path, w, s, draw)].filter(Boolean));
      notesCard.replaceChildren(
        el('h2', { class: 'ef-h2', text: 'Agency notes' }),
        notes.length ? el('ul', { class: 'fr-notes' }, notes.map((n) => el('li', { class: `fr-note fr-note-${n.status}` },
          el('div', { class: 'fr-body', text: n.body || '' }),
          el('div', { class: 'ef-sum-meta' },
            `${n.subject_type !== 'report' && n.subject_id ? n.subject_type.replace('_', ' ') + ': ' + n.subject_id + ' · ' : ''}${n.author || ''}${n.author_type === 'agent' ? ' (agent)' : ''} · ${fmt.day(n.created_at)}${n.status === 'resolved' ? ' · resolved' : ''} `,
            n.status === 'open' ? el('button', { type: 'button', class: 'fr-link', text: 'Resolve', onclick: () => save(NOTE, { status: 'resolved' }, n.id).then(draw) }) : null,
            ' ',
            el('button', { type: 'button', class: 'fr-link', text: 'Archive', onclick: () => save(NOTE, { status: 'archived' }, n.id).then(draw) }))))) : el('p', { class: 'ef-sum-meta', text: 'No notes on this tab yet.' }),
        noteForm(tabKey, path, w, draw));
    };
    await draw();
    return wrap;
  }

  /** Insert (no id) or update (id) one row, as the signed-in person. */
  async function save(table, values, id) {
    if (id) return sql(A.updateSql(T[table], id, values));
    return sql(A.insertSql(T[table], values, await author()));
  }

  function noteForm(tabKey, path, w, done) {
    const body = el('textarea', { class: 'fr-input', rows: 3, maxlength: 5000, 'aria-label': 'New note', placeholder: 'Add a note for the team…' });
    const subject = el('input', { class: 'fr-input', maxlength: 255, 'aria-label': 'About (optional)', placeholder: 'About: a channel, source code or campaign (optional)' });
    const msg = el('p', { class: 'fr-msg', role: 'status' });
    return el('form', { class: 'fr-form', onsubmit: async (e) => {
      e.preventDefault();
      if (!body.value.trim()) return;
      msg.textContent = 'Saving…';
      try {
        await save(NOTE, {
          report_path: path, section: tabKey, body: body.value.trim(),
          subject_type: subject.value.trim() ? 'campaign' : 'report', subject_id: subject.value.trim() || null,
          period_start: w.ty.start, period_end: w.ty.end, visibility: 'agency', author_type: 'person',
        });
        body.value = ''; subject.value = ''; msg.textContent = '';
        done();
      } catch (err) { msg.textContent = noteError(err); }
    } }, body, subject, el('button', { type: 'submit', class: 'ef-segbtn', text: 'Add note' }), msg);
  }

  function summaryForm(tabKey, path, w, current, done) {
    const headline = el('input', { class: 'fr-input', maxlength: 500, 'aria-label': 'Headline', placeholder: 'One-sentence headline', value: current?.headline || '' });
    const body = el('textarea', { class: 'fr-input', rows: 5, maxlength: 20000, 'aria-label': 'Summary' });
    body.value = current?.body || '';
    const msg = el('p', { class: 'fr-msg', role: 'status' });
    const form = el('form', { class: 'fr-form', onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = 'Saving…';
      try {
        await save(SUMMARY, {
          report_path: path, section: tabKey, period: state.period, period_start: w.ty.start, period_end: w.ty.end,
          headline: headline.value.trim(), body: body.value.trim(), status: 'published', author_type: 'person',
        }, current && current.period_end === w.ty.end ? current.id : undefined);
        done();
      } catch (err) { msg.textContent = noteError(err); }
    } }, headline, body, el('button', { type: 'submit', class: 'ef-segbtn', text: current ? 'Update summary' : 'Publish summary' }), msg);
    return el('details', { class: 'ef-details' }, el('summary', { text: current ? 'Edit this summary' : 'Write a summary' }), form);
  }

  // ---- Page ----------------------------------------------------------------------
  function setAuth(s) { document.body.dataset.auth = s; }
  function signedOut() { state.account = null; me = null; state.cache.clear(); setAuth('out'); }

  function syncChrome() {
    document.querySelectorAll('.ef-segbtn[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === state.period)));
    document.querySelectorAll('.ef-tab[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  }

  async function show() {
    if (!state.account) return;
    if (!TABS[state.tab]) state.tab = 'transactions';
    syncChrome();
    const id = ++state.loadId;
    const tab = TABS[state.tab];
    const w = windows(state.period);
    const main = $('#tab');
    const header = el('header', {},
      el('p', { class: 'ef-eyebrow', text: `${state.accountName || state.account} · ${tab.title} · ${PERIODS[state.period]}` }),
      el('h1', { class: 'ef-title', text: tab.title }));
    main.replaceChildren(header, el('p', { class: 'ef-sum-meta', id: 'loading', text: 'Running the reports on engine9…' }));
    try {
      const [model, agency] = await Promise.all([tab.load(w), agencyPanel(state.tab, w)]);
      if (id !== state.loadId) return;
      const parts = tab.render(model);
      main.replaceChildren(header, parts[0], agency, ...parts.slice(1),
        el('p', { class: 'ef-sum-meta', text: `${PERIODS[state.period]}: ${w.ty.start} to ${w.ty.end} (end not included), against ${w.ly.start} to ${w.ly.end}. ${state.installed && state.installed.size ? 'Reports from the installed Fundraising Reports plugin.' : 'Reports sent from this page; the Fundraising Reports plugin is not installed on this account.'}` }));
    } catch (err) {
      if (id !== state.loadId) return;
      main.replaceChildren(header, el('p', { class: 'ef-err', text: `engine9 couldn't run this tab: ${String((err && err.message) || err)}` }));
    }
  }

  async function onAccount(account) {
    state.cache.clear();
    if (!account) return signedOut();
    state.account = account.id;
    state.accountName = account.name || account.id;
    setAuth('in');
    state.installed = await detectInstalled();
    show();
  }

  document.querySelectorAll('.ef-segbtn[data-period]').forEach((b) => b.addEventListener('click', () => {
    state.period = b.dataset.period;
    const u = new URL(location.href); u.searchParams.set('period', state.period); history.replaceState(null, '', u);
    show();
  }));
  document.querySelectorAll('.ef-tab[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    const u = new URL(location.href); u.hash = state.tab; history.replaceState(null, '', u);
    show();
  }));

  engine9Id.mcpButton({ mcp, target: '[data-e9-mcp-button]', onAccountChange: (account) => onAccount(account) });
  setAuth('checking');
  mcp.ready.then(async () => {
    const id = mcp.account();
    if (!id) return setAuth('out');
    let name = id;
    try { const list = await mcp.accounts(); name = (list.find((a) => a.id === id) || {}).name || id; } catch { /* keep the id */ }
    onAccount({ id, name });
  });
})();
