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

// The stand-in: answers report runs with rows shaped like liftoff_ecu's.
const STUB = `(() => {
  const rows = {
    'All Donations': { kpis: [{ revenue: '6595140.40', gifts: 491958, donors: 140574, avg_gift: '13.40', recurring_revenue: '1411538.66', recurring_gifts: '122221', uncoded_revenue: '394560.93', unattributed_revenue: '501982.38', big_gift_revenue: '221583.00', big_gifts: '143' }],
      monthly: [{ month_no: '2026-10-01T00:00:00.000Z', revenue: '809640.26' }, { month_no: '2026-11-01T00:00:00.000Z', revenue: '489488.76' }],
      channels: [{ channel: 'Rented lists', revenue: '1981693.98', gifts: 125525, donors: 82121, avg_gift: '15.78' }, { channel: 'Email', revenue: '1517832.93', gifts: 113219, donors: 30477, avg_gift: '13.40' }],
      sizes: [{ size_order: 1, gift_size: 'Under $25', gifts: 424880, revenue: '3487967.28' }],
      top_codes: [{ source: 'LOC_EM_FR_2026', channel: 'Email', revenue: '2000', gifts: 10, donors: 9, avg_gift: '200' }],
      top_pages: [{ source: 'ecu-homepage', revenue: '61000', gifts: 900, recurring_gifts: 120, first_gift: '2026-01-02' }] },
    'New Donors': { new_donors: [{ new_donors: 79088 }] },
    'New Monthly Donors': { new_donors: [{ new_donors: 4210 }] },
    'Recurring Donors': { kpis: [{ payments: 122221, donors: 15000, revenue: '1411538.66', avg_payment: '11.55' }], monthly: [{ month: '2026-11-01T00:00:00.000Z', donors: 14000 }] },
    'Email': { kpis: [{ messages: 187, sent: '44940153', revenue: '63215.95', gifts: '4572', clicks: '216662', unsubscribes: '22609', new_monthly: '168', delivered: '44711760', complaints: '3188' }],
      monthly: [{ month: '2026-11-01T00:00:00.000Z', revenue: '63215.95' }], weekly: [],
      purpose: [{ purpose: 'Fundraising ask', messages: 97, revenue: '36491.47', sent: '20000000', clicks: '100000', unsubscribes: '9000' }],
      top_emails: [{ send_date: '2026-11-01T20:34:37.000Z', subject: 'Abdul El-Sayed (it all comes down to this)', sent: '371409', revenue: '1757.00', gifts: 90, clicks: 1000, delivered: 370000 }],
      by_size: [{ size_order: 3, messages: 118, sent: '43652743', revenue: '53864.98', zero_revenue_messages: '1' }] },
    'Texts': { kpis: [{ messages: 300, sent: '9000000', revenue: '89667.08', gifts: '7000', unsubscribes: '30000', cost: '29150.12' }], monthly: [], weekly: [],
      platforms: [{ platform: 'Tatango', messages: 100, revenue: '54520.09', cost: '21462.71', sent: '5000000', optouts: '20000' }], types: [], purposes: [], top_texts: [] },
    'Advertising': { kpis: [{ spend: '473156.69', revenue: '268630.23', gifts: '18000', impressions: '90000000', clicks: '900000', campaigns: 18 }], monthly: [],
      platforms: [{ platform: 'Meta (Facebook and Instagram)', spend: '469614.12', revenue: '268000' }], campaigns: [{ campaign: 'DD_20260422_FB', platform: 'Meta', spend: '137083.31', first_day: '2026-04-22', last_day: '2026-06-01' }] },
  };
  window.__calls = [];
  const mcp = {
    ready: Promise.resolve(),
    account: () => 'liftoff_ecu',
    accounts: async () => [{ id: 'liftoff_ecu', name: 'End Citizens United' }],
    async call(tool, args) {
      window.__calls.push({ tool, args });
      await new Promise((r) => setTimeout(r, 30));
      if (tool === 'report' && args.command === 'list') return { reports: [] };
      if (tool === 'report') {
        const data = rows[args.definition.name] || {};
        return { sections: [{ components: Object.entries(data).map(([id, d]) => ({ id, data: d })) }] };
      }
      if (tool === 'user') return { uid: 'data.engine9.ai:abc', email: 'pat@frakture.com' };
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
    mcpButton({ target }) { const b = document.createElement('button'); b.textContent = 'pat@frakture.com · End Citizens United'; document.querySelector(target).append(b); return { destroy() {} }; },
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
  [/^WITH t AS \(SELECT CASE WHEN channel/, [
    { channel: 'All channels', ytd: '6595140.40', gifts_ytd: '491958', ly_ytd: '6314280.04', ly_rest: '487590.90', mt_ytd: '11509479.38', mt_rest: '842012.37', ly_year: 2025, mt_year: 2022, days_left: 35, ly_full: '6801870.94', mt_full: '12351491.75', proj_ly: '7105000.00', proj_mt: '7077000.00' },
    { channel: 'Rented lists', ytd: '1981693.98', gifts_ytd: '125525', ly_ytd: '1598261.90', ly_rest: '78915.39', mt_ytd: '0.00', mt_rest: '0.00', proj_ly: '2079000.00', proj_mt: null, ly_full: '1677177.29' }]],
  [/^SELECT MONTH\(m\.ts\)/, [{ month_no: 1, ty: '487549.34', ly: '384570.00', mt: '633313.82', this_month: 11 }, { month_no: 12, ty: '0.00', ly: '411408.07', mt: '615881.00', this_month: 11 }]],
  [/^SELECT period, COUNT\(\*\) AS gifts/, [
    { period: 'This year', gifts: 491958, revenue: '6595140.40', uncoded_gifts: '31328', uncoded_revenue: '394560.93', offconv_gifts: '15886', offconv_revenue: '272379.73', nochannel_gifts: '136078', nochannel_revenue: '1817397.70', nocampaign_gifts: '460630', nocampaign_revenue: '6200579.47', linked_gifts: '239387', linked_revenue: '3002669.21', unreadable_gifts: '60000', unreadable_revenue: '501982.38' },
    { period: 'Last year', gifts: 480805, revenue: '6314280.04', uncoded_gifts: '15991', uncoded_revenue: '300417.21', offconv_gifts: '21262', offconv_revenue: '295298.95', nochannel_gifts: '111398', nochannel_revenue: '1309136.16', nocampaign_gifts: '464814', nocampaign_revenue: '6013862.83', linked_gifts: '195743', linked_revenue: '2372991.75', unreadable_gifts: '50000', unreadable_revenue: '459193.34' }]],
  [/^SELECT ch AS channel/, [{ channel: 'Website', codes: 40, gifts: 9000, revenue: '120000.00' }]],
  [/^SELECT DATE_FORMAT\(ts, '%m'\)/, [{ month_no: '01', y: 0, revenue: '487549.34', unreadable_revenue: '40000.00', uncoded_revenue: '30000.00' }, { month_no: '01', y: 1, revenue: '384570.00', unreadable_revenue: '30000.00', uncoded_revenue: '20000.00' }]],
  [/^SELECT COALESCE\(NULLIF\(remote_page_name/, [{ page: 'ecu-homepage', gifts: 900, revenue: '61000.00' }]],
  [/^WITH c AS \(SELECT DISTINCT m\.final_source_code_id/, [{ codes: 900, codes_with_cost: 120, codes_bad_cost: 2, codes_with_cpp: 80, cost_total: '480000.00', rtl_codes: 60, rtl_codes_with_cost: 50, rtl_cost: '400000.00' }]],
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
await page.waitForSelector('#tab .ef-tiles');
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
for (const tab of ['scorecard', 'email', 'sms', 'ads', 'recurring', 'dq']) {
  await page.click(`.ef-tab[data-tab="${tab}"]`);
  await page.waitForFunction((t) => document.querySelector('#tab h1')?.textContent && !document.querySelector('#loading') && location.hash === '#' + t, tab);
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
