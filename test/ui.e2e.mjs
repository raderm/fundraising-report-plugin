// Loads ui/ in Chrome with a stand-in engine9 connection, clicks through every
// tab and period, sets up the notes tables, and adds, resolves and archives a
// note. The stand-in answers the MCP `sql` tool from an in-memory SQLite
// database, after turning the page's MariaDB into SQLite, so the SQL the page
// sends is really run.
//   npm run e2e   (needs Playwright + Chrome; node 22+ for node:sqlite)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../ui/', import.meta.url).pathname;
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    const body = await readFile(join(ROOT, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(p) || '.html'] });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(3005);

// The stand-in: answers report runs with rows shaped like a mid-size campaign account's (made-up figures).
const STUB = `(() => {
  const rows = {
    'All Donations': { kpis: [{ revenue: '4023035.64', gifts: 300094, donors: 85750, avg_gift: '8.17', recurring_revenue: '861038.58', recurring_gifts: '74555', uncoded_revenue: '240682.17', unattributed_revenue: '306209.25', big_gift_revenue: '135165.63', big_gifts: '87' }],
      monthly: [{ month_no: '2026-10-01T00:00:00.000Z', one_time: '427000', recurring: '66880.56', revenue: '493880.56' }, { month_no: '2026-11-01T00:00:00.000Z', one_time: '244000', recurring: '54588.14', revenue: '298588.14' }],
      channels: [{ channel: 'Rented lists', revenue: '1208833.33', gifts: 76570, donors: 50094, avg_gift: '9.63' }, { channel: 'Email', revenue: '925878.09', gifts: 69064, donors: 18591, avg_gift: '8.17' }],
      sizes: [{ size_order: 1, gift_size: 'Under $25', gifts: 259177, revenue: '2127660.04' }],
      top_codes: [{ source: 'LOC_EM_FR_2026', channel: 'Email', revenue: '1220', gifts: 10, donors: 9, avg_gift: '122' }],
      top_pages: [{ source: 'main-donate-page', revenue: '37210', gifts: 549, recurring_gifts: 73, first_gift: '2026-01-02' }] },
    'New Donors': { new_donors: [{ new_donors: 48244 }] },
    'New Monthly Donors': { new_donors: [{ new_donors: 2568 }] },
    'Recurring Donors': { kpis: [{ payments: 74555, donors: 9150, revenue: '861038.58', avg_payment: '7.05' }], monthly: [{ month: '2026-11-01T00:00:00.000Z', donors: 8540 }] },
    'Email': { kpis: [{ messages: 187, sent: '27413493', revenue: '38561.73', gifts: '2789', clicks: '132164', unsubscribes: '13791', new_monthly: '102', delivered: '27274174', complaints: '1945' }],
      monthly: [{ month: '2026-11-01T00:00:00.000Z', revenue: '38561.73' }], weekly: Array.from({ length: 47 }, (_, i) => ({ week: new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString(), revenue: String(20000 + ((i * 7919) % 9000) * 6), sent: '915000', complaints: String(i === 30 ? 9000 : 400 + (i % 5) * 60), optouts: String(i === 30 ? 9000 : 3000 + (i % 7) * 400) })),
      purpose: [{ purpose: 'Fundraising ask', messages: 97, revenue: '22259.80', sent: '12200000', clicks: '61000', unsubscribes: '5490' }],
      top_emails: [{ send_date: '2026-11-01T20:34:37.000Z', subject: 'It all comes down to this', sent: '226559', revenue: '1071.77', gifts: 90, clicks: 610, delivered: 225700 }],
      by_size: [{ size_order: 3, messages: 118, sent: '26628173', revenue: '32857.64', zero_revenue_messages: '1' }] },
    'Texts': { kpis: [{ messages: 300, sent: '5490000', revenue: '54696.92', gifts: '4270', unsubscribes: '18300', cost: '17781.57' }], monthly: [], weekly: Array.from({ length: 47 }, (_, i) => ({ week: new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString(), revenue: String(20000 + ((i * 7919) % 9000) * 6), sent: '915000', complaints: String(i === 30 ? 9000 : 400 + (i % 5) * 60), optouts: String(i === 30 ? 9000 : 3000 + (i % 7) * 400) })),
      platforms: [{ platform: 'Tatango', messages: 100, revenue: '33257.25', cost: '13092.25', sent: '3050000', optouts: '12200' }], types: [], purposes: [], top_texts: [] },
    'Advertising': { kpis: [{ spend: '288625.58', revenue: '163864.44', gifts: '10980', impressions: '54900000', clicks: '549000', campaigns: 18 }], monthly: [],
      platforms: [{ platform: 'Meta (Facebook and Instagram)', spend: '286464.61', revenue: '163480' }], campaigns: [{ campaign: 'ACQ_20260422_FB', platform: 'Meta', spend: '83620.82', first_day: '2026-04-22', last_day: '2026-06-01' }] },
  };
  window.__calls = [];
  const mcp = {
    ready: Promise.resolve(),
    account: () => 'demo_account',
    accounts: async () => [{ id: 'demo_account', name: 'Demo Campaign' }],
    async call(tool, args) {
      window.__calls.push({ tool, args });
      await new Promise((r) => setTimeout(r, 30));
      if (tool === 'report' && args.command === 'list') return { reports: [] };
      if (tool === 'report') {
        const data = rows[args.definition.name] || {};
        return { sections: [{ components: Object.entries(data).map(([id, d]) => ({ id, data: d })) }] };
      }
      if (tool === 'user') return { uid: 'data.engine9.ai:abc', email: 'pat@example.com' };
      if (tool === 'sql') {
        const res = await window.__sql(args);
        if (res.error) throw new Error(res.error);
        return res.result ? { ok: true, result: res.result } : { ok: true, data: res.data };
      }
      throw new Error('unexpected tool ' + tool);
    },
  };
  window.engine9Id = {
    connectMcp: () => mcp,
    isMcpSignedOut: () => false,
    mcpButton({ target }) { const b = document.createElement('button'); b.textContent = 'pat@example.com · Demo Campaign'; document.querySelector(target).append(b); return { destroy() {} }; },
  };
})();`;

// The account database: MariaDB statements, run in SQLite.
const db = new DatabaseSync(':memory:');
const sqlLog = [];
function toSqlite(text) {
  return text
    .replace(/CONVERT\(X'([0-9a-f]*)' USING utf8mb4\)/g, "CAST(X'$1' AS TEXT)")
    .replace(/UUID_v7\(\)/g, () => `'${randomUUID()}'`)
    .replace(/ ON UPDATE current_timestamp\(\)/g, '')
    .replace(/current_timestamp\(\)/g, 'CURRENT_TIMESTAMP')
    .replace(/,\n  (UNIQUE )?KEY [^\n]*?(?=,?\n)/g, '')
    .replace(/\) DEFAULT CHARSET=\S+ COLLATE=\S+$/, ')')
    .replace(/ LIMIT 10000$/, '');
}
// What the MariaDB-only report queries return (the real ones run on engine9).
const CANNED = [
  [/^SELECT kind, COUNT\(\*\) AS gifts, ROUND\(SUM\(amount\), 2\) AS revenue, COUNT\(DISTINCT transaction_source_code\)/s, [{ kind: 'merge', gifts: 881, revenue: '7565.77', codes: 2, example: '{{refcode}}' }, { kind: 'variant', gifts: 9761, revenue: '131562.84', codes: 94, example: 'v4' }]],
  [/^SELECT period, ch AS channel, COUNT\(\*\) AS gifts/s, [{ period: 'ty', channel: 'Meta ads', gifts: 5490, revenue: '163480.00' }, { period: 'ty', channel: 'Paid ads (coded)', gifts: 2440, revenue: '67100.00' }, { period: 'ly', channel: 'Meta ads', gifts: 5795, revenue: '152500.00' }]],
  [/^WITH c AS \(SELECT d\.source_code, d\.acquisition_cost AS cost/s, [{ period: 'ty', lists: 11, cost: '108743.48', signups: '366706', new_donors: '4419', raised: '176111.15' }, { period: 'ly', lists: 7, cost: '73794.14', signups: '95079', new_donors: '3464', raised: '195415.36' }]],
  [/^WITH p AS .*SUM\(a0\) AS donors_ty/s, [{ donors_ty: 85684, returning_ty: 38027, new_ty: 19191, donors_ly: 92293, returning_ly: 40138, new_ly: 22509, donors_py: 92354, new_py: 23180, new_ly_again: 5124, new_py_again: 5588, data_start_year: 2015, data_start: '2015-03-02' }]],
  [/^WITH p AS .*SELECT month, SUM\(kind/s, [{ month: '2026-10-01', started: '435', stopped: '166' }, { month: '2026-11-01', started: '259', stopped: '0' }]],
  [/^WITH p AS .*YEAR\(p\.f\) AS year/s, [{ year: 2019, donors: 25596, active: 2642, revenue: '399744.32', data_start: 1229 }, { year: 2025, donors: 579, active: 138, revenue: '33547.18', data_start: 1229 }, { year: 2026, donors: 4184, active: 2805, revenue: '260499.26', data_start: 1229 }]],
  [/^WITH fp AS /, [{ channel: 'Email', donors: 2193, active: 581, revenue: '66489.25' }, { channel: 'Text (SMS)', donors: 1565, active: 932, revenue: '97743.95' }, { channel: 'Meta ads', donors: 173, active: 126, revenue: '10105.75' }]],
  [/^SELECT SUM\(a_ty\)/, [{ base_ty: '3072', kept_ty: '2427', base_ly: '5653', kept_ly: '2200' }]],
  [/^WITH fg AS .*ORDER BY donors DESC LIMIT 12$/s, [{ source: 'LOC_EM_FR_2026', channel: 'Email', donors: 549, first_amt: '15250', later_amt: '18300', gave_again: '244', started_monthly: '30', active_90: '183' }]],
  [/^WITH fg AS .*DATE_FORMAT\(fg\.fts/s, [
    { month: '2025-11-01', channel: 'Email', donors: 1098, first_amt: '18300', later_amt: '31720', gave_again: '488', started_monthly: '2', active_90: '61' },
    { month: '2026-10-01', channel: 'Rented lists', donors: 2440, first_amt: '42700', later_amt: '36600', gave_again: '854', started_monthly: '61', active_90: '854' },
    { month: '2026-11-01', channel: 'Meta ads', donors: 427, first_amt: '7930', later_amt: '4880', gave_again: '116', started_monthly: '10', active_90: '195' }]],
  [/^WITH fg AS /, [
    { period: 'ty', channel: 'Email', donors: 7444, first_amt: '138043.94', later_amt: '163192.53', gave_again: '2747', started_monthly: '198', active_90: '3269' },
    { period: 'ty', channel: 'Meta ads', donors: 4349, first_amt: '80121.38', later_amt: '51414.48', gave_again: '1179', started_monthly: '72', active_90: '1984' },
    { period: 'ty', channel: 'Rented lists', donors: 24671, first_amt: '440749.67', later_amt: '476343.67', gave_again: '8835', started_monthly: '689', active_90: '8627' },
    { period: 'ly', channel: 'Email', donors: 11160, first_amt: '182862.29', later_amt: '319588.60', gave_again: '4962', started_monthly: '14', active_90: '653' }]],
  [/^SELECT CASE WHEN date >= /, [{ period: 'ty', channel: 'Meta ads', cost: '286730.59' }, { period: 'ty', channel: 'Google ads', cost: '2160.97' }, { period: 'ly', channel: 'Meta ads', cost: '159137.09' }]],
  [/^SELECT CASE WHEN date_created >= /, [{ period: 'ty', source: 'IMPORT', signups: 407404, still_subscribed: '238018' }, { period: 'ly', source: 'IMPORT', signups: 115944, still_subscribed: '46394' }, { period: 'ty', source: 'EM', signups: 14109, still_subscribed: '4828' }]],
  [/^SELECT CASE channel WHEN 'email'/, [{ channel: 'Meta ads', cost: '286730.59', ly_cost: '159137.09' }, { channel: 'Google ads', cost: '2160.97', ly_cost: '0.00' }]],
  [/^SELECT ROUND\(COALESCE\(SUM\(d\.acquisition_cost\)/, [{ list_cost: '0.00', codes: 0 }]],
  [/^SELECT ch AS channel, COUNT\(DISTINCT CASE WHEN y = 0/, [{ channel: 'Email', new_donors: 7418, ly_new_donors: 11147 }, { channel: 'Rented lists', new_donors: 32453, ly_new_donors: 27488 }]],
  [/^SELECT MONTH\(date_created\)/, [{ month_no: 1, ty: '98396', ly: '3870' }, { month_no: 2, ty: '22962', ly: '28871' }]],
  [/^SELECT COALESCE\(NULLIF\(subscription_status/, [{ status: 'Subscribed', people: 2674665 }, { status: 'Unsubscribed', people: 105163 }]],
  [/^WITH t AS \(SELECT CASE WHEN channel/, [
    { channel: 'All channels', ytd: '4023035.64', gifts_ytd: '300094', ly_ytd: '3851710.82', ly_rest: '297430.45', mt_ytd: '7020782.42', mt_rest: '513627.55', ly_year: 2025, mt_year: 2022, days_left: 35, ly_full: '4149141.27', mt_full: '7534409.97', proj_ly: '4334050.00', proj_mt: '4316970.00' },
    { channel: 'Rented lists', ytd: '1208833.33', gifts_ytd: '76570', ly_ytd: '974939.76', ly_rest: '48138.39', mt_ytd: '0.00', mt_rest: '0.00', proj_ly: '1268190.00', proj_mt: null, ly_full: '1023078.15' }]],
  [/^SELECT MONTH\(m\.ts\)/, [{ month_no: 1, ty: '297405.10', ly: '234587.70', mt: '386321.43', this_month: 11 }, { month_no: 12, ty: '0.00', ly: '250958.92', mt: '375687.41', this_month: 11 }]],
  [/^SELECT period, COUNT\(\*\) AS gifts/, [
    { period: 'This year', gifts: 300094, revenue: '4023035.64', uncoded_gifts: '19110', uncoded_revenue: '240682.17', offconv_gifts: '9690', offconv_revenue: '166151.64', nochannel_gifts: '83008', nochannel_revenue: '1108612.60', nocampaign_gifts: '280984', nocampaign_revenue: '3782353.48', linked_gifts: '146026', linked_revenue: '1831628.22', unreadable_gifts: '36600', unreadable_revenue: '306209.25' },
    { period: 'Last year', gifts: 293291, revenue: '3851710.82', uncoded_gifts: '9755', uncoded_revenue: '183254.50', offconv_gifts: '12970', offconv_revenue: '180132.36', nochannel_gifts: '67953', nochannel_revenue: '798573.06', nocampaign_gifts: '283537', nocampaign_revenue: '3668456.33', linked_gifts: '119403', linked_revenue: '1447524.97', unreadable_gifts: '30500', unreadable_revenue: '280107.94' }]],
  [/^SELECT ch AS channel/, [{ channel: 'Website', codes: 40, gifts: 5490, revenue: '73200.00' }]],
  // Coverage report (before the DQ_MONTHS pattern, which shares its first words). Made-up rows for October and November 2026.
  [/^SELECT DATE_FORMAT\(ts, '%m'\) AS month_no, ch AS channel/, [
    { month_no: '10', channel: 'Email', gifts: 8035, revenue: '128262.75', matched_revenue: '98593.17', tagged_revenue: '69290.38' },
    { month_no: '10', channel: 'Rented lists', gifts: 10189, revenue: '173528.10', matched_revenue: '0.00', tagged_revenue: '101609.67' },
    { month_no: '10', channel: 'Text (SMS)', gifts: 8639, revenue: '104031.76', matched_revenue: '100074.44', tagged_revenue: '69608.41' },
    { month_no: '10', channel: 'No source code', gifts: 1165, revenue: '18608.61', matched_revenue: '0.00', tagged_revenue: '0.00' },
    { month_no: '11', channel: 'Email', gifts: 5622, revenue: '71004.43', matched_revenue: '46823.40', tagged_revenue: '23263.84' },
    { month_no: '11', channel: 'Rented lists', gifts: 7710, revenue: '113362.06', matched_revenue: '0.00', tagged_revenue: '11007.88' },
    { month_no: '11', channel: 'Text (SMS)', gifts: 6984, revenue: '75021.30', matched_revenue: '71907.91', tagged_revenue: '14866.12' },
    { month_no: '11', channel: 'No source code', gifts: 585, revenue: '7350.15', matched_revenue: '0.00', tagged_revenue: '0.00' }]],
  [/^WITH cg AS/, [
    { kind: 'unmatched', code: 'site_main', channel: 'Website', gifts: 550, revenue: '45891.75' },
    { kind: 'unmatched', code: 'LOC_RTL_FR_2026.11.01_Deadline_B1_C1_Pros_N_PartnerA_7I-T1', channel: 'Rented lists', gifts: 1987, revenue: '38371.78' },
    { kind: 'unparsed', code: 'site_main', channel: 'Website', gifts: 550, revenue: '45891.75' },
    { kind: 'unparsed', code: '{{refcode}}', channel: 'Other source code', gifts: 880, revenue: '7556.62' }]],
  [/^SELECT DATE_FORMAT\(ts, '%m'\)/, [{ month_no: '01', y: 0, revenue: '297405.10', unreadable_revenue: '24400.00', uncoded_revenue: '18300.00' }, { month_no: '01', y: 1, revenue: '234587.70', unreadable_revenue: '18300.00', uncoded_revenue: '12200.00' }]],
  [/^SELECT COALESCE\(NULLIF\(remote_page_name/, [{ page: 'main-donate-page', gifts: 549, revenue: '37210.00' }]],
  [/^WITH c AS \(SELECT DISTINCT m\.final_source_code_id/, [{ codes: 900, codes_with_cost: 120, codes_bad_cost: 2, codes_with_cpp: 80, cost_total: '292800.00', rtl_codes: 60, rtl_codes_with_cost: 50, rtl_cost: '244000.00' }]],
];
function runSql(args) {
  if (args.command === 'tables') {
    return { result: { tables: db.prepare("select name from sqlite_master where type='table' and name like 'fundraising_report_%'").all().map((r) => r.name) } };
  }
  const text = args.sql;
  sqlLog.push(text);
  const canned = CANNED.find(([re]) => re.test(text));
  if (canned) return { data: canned[1] };
  try {
    const q = toSqlite(text);
    if (/^\s*select/i.test(q)) return { data: db.prepare(q).all().map((r) => ({ ...r })) };
    db.exec(q);
    return { data: [] };
  } catch (err) {
    const msg = /no such table/.test(err.message) ? `ER_NO_SUCH_TABLE: Table doesn't exist (${err.message})` : err.message;
    return { error: msg };
  }
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.route('https://unpkg.com/**', (r) => r.fulfill({ body: STUB, contentType: 'text/javascript' }));
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));

await page.exposeFunction('__sql', runSql);

const out = {};
await page.goto('http://localhost:3005/');
await page.waitForSelector('body[data-auth="in"]');
await page.waitForSelector('#tab .ef-tiles', { timeout: 8000 }).catch(async (e) => { console.log('PAGE ERRORS', errors, (await page.textContent('#tab')).slice(0, 400)); throw e; });
out.revenueTile = await page.textContent('#tab .ef-tiles .ef-card:nth-child(1) .ef-tile-value');
out.newDonors = await page.textContent('#tab .ef-tiles .ef-card:nth-child(3) .ef-tile-value');
out.lede = await page.textContent('#tab .ef-lede');
out.channelRows = await page.locator('#tx-channels tbody tr').count();
const runs = await page.evaluate(() => window.__calls.filter((c) => c.tool === 'report' && c.args.command === 'run').map((c) => [c.args.definition.name, c.args.options]));
out.runs = runs;
await page.screenshot({ path: '/tmp/ui-1-donations.png', fullPage: true });

// The account has no notes tables yet: set them up.
await page.waitForSelector('#transactions-summary button:text("Set up notes on this account")');
out.setupCopy = await page.textContent('#transactions-summary .ef-sum-meta');
await page.click('#transactions-summary button:text("Set up notes on this account")');
await page.waitForSelector('#transactions-notes textarea', { timeout: 5000 }).catch(async (e) => { console.log(await page.textContent('#transactions-summary'), sqlLog.slice(-3)); throw e; });
out.tables = db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name);
out.createSql = sqlLog.filter((q) => /^CREATE TABLE/.test(q)).length;

// Notes: add, resolve, archive.
await page.fill('#transactions-notes textarea', 'Rented lists are carrying the year. <script>alert(1)</script>');
await page.click('#transactions-notes button[type=submit]');
await page.waitForSelector('#transactions-notes .fr-note');
out.noteText = await page.textContent('#transactions-notes .fr-note .fr-body');
out.noteHasScriptTag = await page.locator('#transactions-notes .fr-note script').count();
out.insertSql = sqlLog.find((q) => /^INSERT INTO `fundraising_report_note`/.test(q));
out.insertHasRawText = out.insertSql.includes('Rented lists');
out.noteRow = db.prepare('select author, author_type, status, section, report_path, period_start from fundraising_report_note').get();
await page.click('#transactions-notes .fr-link:text("Resolve")');
await page.waitForSelector('#transactions-notes .fr-note-resolved');
await page.click('#transactions-notes .fr-link:text("Archive")');
await page.waitForSelector('#transactions-notes .fr-note', { state: 'detached' });
out.notesAfterArchive = await page.locator('#transactions-notes .fr-note').count();

// Summary: publish one.
await page.click('#transactions-summary summary');
await page.fill('#transactions-summary input', 'Revenue is up 35% on last year.');
await page.click('#transactions-summary button[type=submit]');
await page.waitForSelector('#transactions-summary .ef-sum-head');
out.summary = await page.textContent('#transactions-summary .ef-sum-head');

// Every tab renders.
for (const tab of ['scorecard', 'email', 'sms', 'ads', 'acquisition', 'dq']) {
  await page.click(`.ef-tab[data-tab="${tab}"]`);
  await page.waitForFunction((t) => document.querySelector('#tab h1')?.textContent && !document.querySelector('#loading') && location.hash === '#' + t, tab);
  if (tab === 'ads') await page.waitForFunction(() => /\$\d.*–\$\d/.test(document.querySelector('#ads-range')?.textContent || ''), null, { timeout: 8000 });
  if (tab === 'acquisition') await page.waitForFunction(() => /Bought lists/.test(document.querySelector('#acq-paid')?.textContent || ''), null, { timeout: 8000 });
  if (tab === 'dq') out.coverage = await page.textContent('#dq-coverage .ef-sub');
  out[tab] = (await page.textContent('#tab .ef-lede')) || (await page.textContent('#tab'));
  await page.screenshot({ path: `/tmp/ui-${tab}.png`, fullPage: true });
}
await page.click('.ef-segbtn[data-period="qtd"]');
await page.waitForFunction(() => !document.querySelector('#loading'));
out.url = page.url();
out.windows = await page.evaluate(() => [window.frWindows('ytd', new Date(2026, 10, 25)), window.frWindows('qtd', new Date(2026, 10, 25)), window.frWindows('30d', new Date(2026, 2, 1))]);
out.summaryRow = db.prepare('select author, status, period, section from fundraising_report_summary').get();
out.noteStatus = db.prepare('select status from fundraising_report_note').get();
out.errors = errors;
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
