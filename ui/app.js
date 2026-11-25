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

  function bars(rows, xKey, yKey, format, xFormat = fmt.month) {
    if (!rows.length) return el('p', { class: 'ef-empty', text: 'Nothing in this range yet.' });
    const max = Math.max(...rows.map((r) => num(r[yKey]) || 0), 1);
    const cols = rows.map((r) => el('div', { class: 'ef-bar-col', title: `${xFormat(r[xKey])}: ${format(num(r[yKey]))}` },
      el('div', { class: 'ef-bar-top', text: format(num(r[yKey])) }),
      el('div', { class: 'ef-bar', style: `height:${Math.max(1, ((num(r[yKey]) || 0) / max) * 170)}px;background:var(--ef-accent)` })));
    return el('div', { class: 'ef-chart' },
      el('div', { class: 'ef-bars', role: 'img', 'aria-label': 'Bar chart' }, cols),
      el('div', { class: 'ef-axis' }, rows.map((r) => el('div', { text: xFormat(r[xKey]) }))));
  }

  function table(columns, rows, empty = 'Nothing in this range yet.') {
    if (!rows.length) return el('p', { class: 'ef-empty', text: empty });
    return el('div', { class: 'ef-tablewrap' }, el('table', { class: 'ef-table ef-table-num' },
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

  // ---- Tabs --------------------------------------------------------------------
  const TABS = {
    transactions: {
      title: 'All Donations',
      async load(w) {
        const [[ty, ly], ndTy, ndLy] = await Promise.all([both('all_donations', w), firstGifts('new_donors', w.ty), firstGifts('new_donors', w.ly)]);
        return { ty, ly, nd: [num(ndTy.new_donors?.[0]?.new_donors), num(ndLy.new_donors?.[0]?.new_donors)] };
      },
      render({ ty, ly, nd }) {
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
          card('tx-monthly', 'Revenue by month', 'Each month in the selected period.', bars(ty.monthly.slice().sort((a, b) => String(a.month_no).localeCompare(String(b.month_no))), 'month_no', 'revenue', fmt.money)),
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
          card('email-monthly', 'Revenue by month', null, bars(ty.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month))), 'month', 'revenue', fmt.money)),
          card('email-purpose', 'By purpose', 'Read from the third part of each send\'s source code (LOC_EM_FR is a fundraising ask).', table([
            { label: 'Purpose', value: (r) => r.purpose },
            { label: 'Messages', value: (r) => num(r.messages), fmt: fmt.int },
            { label: 'Revenue', value: (r) => num(r.revenue), fmt: fmt.money },
            { label: 'Share', value: (r) => r.__share, fmt: fmt.pct },
            { label: 'vs last year', value: (r) => r.__change, fmt: fmt.change, cls: changeCls },
            { label: 'Per 1,000 sent', value: rpm, fmt: fmt.money2 },
            { label: 'Click rate', value: ctr, fmt: fmt.pct },
            { label: 'Unsub rate', value: (r) => div(r.unsubscribes, r.sent), fmt: fmt.pct2 },
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
          card('sms-monthly', 'Revenue by month', null, bars(ty.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month))), 'month', 'revenue', fmt.money)),
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
        ];
      },
    },

    ads: {
      title: 'Advertising',
      async load(w) { const [ty, ly] = await both('advertising', w); return { ty, ly }; },
      render({ ty, ly }) {
        const k = ty.kpis[0] || {}, l = ly.kpis[0] || {};
        const rpd = (r) => div(r.revenue, r.spend);
        if (!num(k.spend) && !num(l.spend)) return [lede('No ad spend has reached engine9 for this account in this period.')];
        return [
          lede(`Ads cost ${fmt.money(num(k.spend))} and raised ${fmt.money(num(k.revenue))} in gifts credited to them: ${fmt.money2(rpd(k))} back for every $1.`),
          tiles(
            tile('Ad spend', k.spend, l.spend, fmt.money, { note: `${fmt.int(num(k.campaigns))} campaigns · last year ${fmt.money(num(l.spend))}` }),
            tile('Raised from ads', k.revenue, l.revenue, fmt.money),
            tile('Raised per $1 spent', rpd(k), rpd(l), fmt.money2),
            tile('Cost per gift', div(k.spend, k.gifts), div(l.spend, l.gifts), fmt.money2, { lowerIsBetter: true }),
            tile('Impressions', k.impressions, l.impressions, fmt.int),
            tile('Click rate (CTR)', div(k.clicks, k.impressions), div(l.clicks, l.impressions), fmt.pct2)),
          card('ads-monthly', 'Spend by month', null, bars(ty.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month))), 'month', 'spend', fmt.money)),
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
        const [channels, months] = await Promise.all([query('SCORECARD_CHANNELS'), query('SCORECARD_MONTHS')]);
        return { channels, months };
      },
      render({ channels, months }) {
        const all = channels.find((r) => r.channel === 'All channels') || {};
        const lyY = all.ly_year, mtY = all.mt_year;
        const rows = channels.filter((r) => r.channel !== 'All channels');
        const changeOf = (r) => change(r.ytd, r.ly_ytd);
        return [
          lede(`Revenue so far this year is ${fmt.money(num(all.ytd))}${moreLess(change(all.ytd, all.ly_ytd))}. Paced like ${lyY}, the year ends near ${fmt.money(num(all.proj_ly))}; paced like ${mtY}, near ${fmt.money(num(all.proj_mt))}. ${fmt.int(num(all.days_left))} days remain.`),
          tiles(
            tile('Revenue so far', all.ytd, all.ly_ytd, fmt.money, { note: `${fmt.int(num(all.gifts_ytd))} gifts · same dates ${lyY} ${fmt.money(num(all.ly_ytd))}` }),
            tile(`Projected year-end (${lyY} pace)`, all.proj_ly, all.ly_full, fmt.money, { note: `${lyY} full year ${fmt.money(num(all.ly_full))}` }),
            tile(`Projected year-end (${mtY} pace)`, all.proj_mt, all.mt_full, fmt.money, { note: `${mtY} full year ${fmt.money(num(all.mt_full))}` }),
            tile(`Raised after today in ${lyY}`, all.ly_rest, NaN, fmt.money, { note: `${fmt.pct(div(all.ly_rest, all.ly_full))} of the ${lyY} total` })),
          card('sc-channels', 'Year-end projection by channel', `This year's total so far, grown by the share each comparison year raised after today's date. Always the calendar year, whatever period is picked. A dash means that channel had no revenue to pace from.`, table([
            { label: 'Channel', value: (r) => r.channel },
            { label: 'So far', value: (r) => num(r.ytd), fmt: fmt.money },
            { label: `Same dates ${lyY}`, value: (r) => num(r.ly_ytd), fmt: fmt.money },
            { label: 'Change', value: changeOf, fmt: fmt.change, cls: (r) => { const v = changeOf(r); return isNaN(v) ? '' : v > 0 ? 'ef-good' : v < 0 ? 'ef-bad' : ''; } },
            { label: `Year-end, ${lyY} pace`, value: (r) => num(r.proj_ly), fmt: fmt.money },
            { label: `Year-end, ${mtY} pace`, value: (r) => num(r.proj_mt), fmt: fmt.money },
            { label: `${lyY} full year`, value: (r) => num(r.ly_full), fmt: fmt.money },
          ], rows)),
          card('sc-months', 'Revenue by month', `This year, ${lyY} and ${mtY}. The current month is still in progress.`, table([
            { label: 'Month', value: (r) => MONTH_NAMES[num(r.month_no) - 1] },
            { label: 'This year', value: (r) => (num(r.month_no) <= num(r.this_month) ? num(r.ty) : NaN), fmt: fmt.money },
            { label: String(lyY), value: (r) => num(r.ly), fmt: fmt.money },
            { label: String(mtY), value: (r) => num(r.mt), fmt: fmt.money },
          ], months)),
        ];
      },
    },

    dq: {
      title: 'Data Quality',
      async load() {
        const [summary, off, months, pages, acq] = await Promise.all(['DQ_SUMMARY', 'DQ_OFF_CONVENTION', 'DQ_MONTHS', 'DQ_PAGES', 'DQ_ACQUISITION_COST'].map(query));
        return { summary, off, months, pages, acq: acq[0] || {} };
      },
      render({ summary, off, months, pages, acq }) {
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
        return [
          lede(`${fmt.pct(share(t, 'uncoded'))} of this year's revenue (${fmt.money(num(t.uncoded_revenue))}) came in with no source code, and ${fmt.pct(share(t, 'offconv'))} used a code outside the LOC_ and MS_ naming convention. Gifts are counted for the year to date, whatever period is picked.`),
          tiles(
            mk('No source code', 'uncoded'),
            mk('Outside the LOC_ / MS_ convention', 'offconv'),
            mk('Source code has no channel', 'nochannel'),
            mk('Source code has no campaign', 'nocampaign'),
            mk('No readable channel', 'unreadable', { note: `Revenue that can't be credited to a channel · ${fmt.money(num(t.unreadable_revenue))}` }),
            tile('Linked to an email, text or ad', share(t, 'linked'), share(l, 'linked'), fmt.pct, { note: `${fmt.money(num(t.linked_revenue))} · ${fmt.int(num(t.linked_gifts))} gifts · last year ${fmt.pct(share(l, 'linked'))}` })),
          card('dq-off', 'Codes outside the naming convention', 'Gifts whose source code doesn\'t start with LOC_ or MS_, by the channel they read as.', table([
            { label: 'Reads as', value: (r) => r.channel },
            { label: 'Codes', value: (r) => num(r.codes), fmt: fmt.int },
            { label: 'Gifts', value: (r) => num(r.gifts), fmt: fmt.int },
            { label: 'Raised', value: (r) => num(r.revenue), fmt: fmt.money },
          ], off, 'Every source code this year follows the convention.')),
          card('dq-months', 'Revenue with no readable channel, by month', 'Share of each month\'s revenue that has no source code, or a code that reads as no channel.', table([
            { label: 'Month', value: (r) => MONTH_NAMES[num(r.month_no) - 1] },
            { label: 'This year', value: (r) => unread(r.ty), fmt: fmt.pct },
            { label: 'Last year', value: (r) => unread(r.ly), fmt: fmt.pct },
          ], [...byMonth.values()].sort((a, b) => num(a.month_no) - num(b.month_no)))),
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

    recurring: {
      title: 'Recurring Donors',
      async load(w) {
        const today = new Date();
        const { end } = w.ty;
        const [[ty, ly], active, months, newTy, newLy] = await Promise.all([
          both('recurring', w),
          run('recurring', { start: iso(addDays(new Date(end + 'T00:00:00'), -36)), end }),
          run('recurring', { start: iso(new Date(today.getFullYear(), today.getMonth() - 23, 1)), end }),
          firstGifts('new_monthly_donors', w.ty),
          firstGifts('new_monthly_donors', w.ly),
        ]);
        return { ty, ly, active, months, nm: [num(newTy.new_donors?.[0]?.new_donors), num(newLy.new_donors?.[0]?.new_donors)] };
      },
      render({ ty, ly, active, months, nm }) {
        const k = ty.kpis[0] || {}, l = ly.kpis[0] || {}, a = active.kpis[0] || {};
        return [
          lede(`${fmt.int(num(a.donors))} monthly donors made a payment in the last 36 days, worth about ${fmt.money(num(a.revenue))} a month. ${fmt.int(nm[0])} new monthly donors started in this period.`),
          tiles(
            tile('Active monthly donors', a.donors, NaN, fmt.int, { note: 'Paid in the last 36 days' }),
            tile('Monthly run rate', a.revenue, NaN, fmt.money, { note: 'Payments in the last 36 days' }),
            tile('New monthly donors', nm[0], nm[1], fmt.int, { note: `First recurring payment on record · last year ${fmt.int(nm[1])}` }),
            tile('Recurring revenue', k.revenue, l.revenue, fmt.money, { note: `${fmt.int(num(k.payments))} payments · last year ${fmt.money(num(l.revenue))}` }),
            tile('Average payment', k.avg_payment, l.avg_payment, fmt.money2)),
          card('rec-monthly', 'Active monthly donors by month, last 24 months', 'Donors who made a recurring payment that month. The current month is still in progress.',
            bars(months.monthly.slice().sort((a, b) => String(a.month).localeCompare(String(b.month))), 'month', 'donors', fmt.int)),
        ];
      },
    },
  };

  // ---- Agency summaries and notes ------------------------------------------------
  const REPORT_FOR_TAB = { transactions: 'all_donations', email: 'email', sms: 'sms', ads: 'advertising', recurring: 'recurring' };
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
