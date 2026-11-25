// Read-only SQL for the Scorecard and Data Quality tabs, run through the
// engine9 MCP `sql` tool as the signed-in person. These need window functions,
// REGEXP and per-year comparisons that EQL report definitions can't express,
// so they are plain SELECTs. They never write and take no user input: the only
// variable is today's date, which the database supplies (CURDATE()).
//
// Plain JavaScript with no imports: scripts/build-ui.mjs copies it into the
// page as ui/scorecard-sql.js.

// The source code on a gift, with an ActBlue refcode=… link reduced to its refcode.
const REF = `(CASE WHEN COALESCE(d.source_code, '') LIKE '%refcode=%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(COALESCE(d.source_code, ''), 'refcode=', -1), '&', 1) ELSE COALESCE(d.source_code, '') END)`;

/** Every gift with its source code, the linked message's channel, and the code's lowercase name (sc_n) and type (sc_t). */
export const GIFT_ROWS = `SELECT m.id, m.person_id, m.ts, m.amount, m.recurs_id, m.remote_page_name, m.final_message_id, d.source_code AS transaction_source_code, d.source_code_channel, d.campaign, g.channel, LOWER(${REF}) AS sc_n, UPPER(COALESCE(NULLIF(d.source_code_channel, ''), CASE WHEN ${REF} REGEXP '^[A-Za-z0-9]{2,8}_[^_]+' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(${REF}, '_', 2), '_', -1) END, '')) AS sc_t FROM \`transaction\` m LEFT JOIN source_code_dictionary d ON d.source_code_id = m.final_source_code_id LEFT JOIN global_message g ON g.id = m.final_message_id`;

/** A gift's channel: the linked message, else the source code's channel field or its words. Same rules as reports/helpers.js. */
export const CHANNEL_CASE = `CASE WHEN channel = 'email' THEN 'Email' WHEN channel = 'sms' THEN 'Text (SMS)' WHEN channel = 'facebook_ad' THEN 'Meta ads' WHEN channel = 'google_ad' THEN 'Google ads' WHEN COALESCE(transaction_source_code, '') = '' THEN 'No source code' WHEN sc_t IN ('EM', 'EMAIL') THEN 'Email' WHEN sc_t IN ('BC', 'P2P', 'TEXT', 'SMS', 'MMS', 'TXT') OR sc_t LIKE 'P2P-%' THEN 'Text (SMS)' WHEN sc_t = 'RTL' THEN 'Rented lists' WHEN sc_t = 'ABTY' THEN 'ActBlue thank-you page' WHEN sc_t IN ('AD', 'ADS') OR sc_n LIKE 'rtiads%' THEN 'Paid ads (coded)' WHEN sc_t IN ('WEB', 'SITE', 'WEBSITE') THEN 'Website' WHEN sc_t IN ('DM', 'MAIL') THEN 'Direct mail' WHEN sc_t IN ('SOC', 'SOCIAL') THEN 'Social media' WHEN (sc_n LIKE 'website%' OR sc_n LIKE 'web\\_%' OR sc_n LIKE 'web-%' OR sc_n LIKE 'site\\_%' OR sc_n LIKE 'site-%' OR sc_n LIKE '%\\_site\\_%' OR sc_n LIKE '%\\_site') THEN 'Website' WHEN (sc_n LIKE 'email%' OR sc_n LIKE 'em\\_%' OR sc_n LIKE '%\\_email%' OR sc_n LIKE '%-email%') THEN 'Email' WHEN (sc_n LIKE 'sms%' OR sc_n LIKE 'mms%' OR sc_n LIKE 'txt%' OR sc_n LIKE '%p2p%' OR sc_n LIKE '%\\_txt%' OR sc_n LIKE '%-txt%' OR sc_n LIKE '%\\_sms%' OR sc_n LIKE '%-sms%') THEN 'Text (SMS)' WHEN (sc_n LIKE 'social%' OR sc_n LIKE '%socialmedia%' OR sc_n LIKE '%social-media%' OR sc_n LIKE '%social\\_media%' OR sc_n LIKE '%twitter%' OR sc_n LIKE 'facebook' OR sc_n LIKE 'facebook-%' OR sc_n LIKE 'facebook\\_%' OR sc_n LIKE 'instagram%' OR sc_n LIKE 'bluesky%' OR sc_n LIKE 'tiktok%' OR sc_n LIKE 'linktree%') THEN 'Social media' WHEN sc_n REGEXP '^dm[0-9]' OR (sc_n LIKE '%directmail%' OR sc_n LIKE '%direct-mail%' OR sc_n LIKE '%direct\\_mail%') THEN 'Direct mail' WHEN (sc_n LIKE '%-website%' OR sc_n LIKE '%\\_website%' OR sc_n LIKE '%homepage%' OR sc_n LIKE 'home-%' OR sc_n LIKE 'hero-%' OR sc_n LIKE 'menu-%' OR sc_n LIKE '%-menu%' OR sc_n LIKE '%sticky%' OR sc_n LIKE '%popup%' OR sc_n LIKE 'nav-%' OR sc_n LIKE '%-nav%' OR sc_n LIKE '%header%' OR sc_n LIKE '%footer%' OR sc_n LIKE '%banner%' OR sc_n LIKE '%-cta%') THEN 'Website' ELSE 'Other source code' END`;

const YEAR_START = 'MAKEDATE(YEAR(CURDATE()), 1)';
const TOMORROW = '(CURDATE() + INTERVAL 1 DAY)';

/**
 * Scorecard: revenue and gifts by channel this year to date, last year and the
 * last midterm year (four years ago) split into the same dates and the rest of
 * the year, and two year-end projections (this year's total so far grown by the
 * share each comparison year raised after today's date). Always the calendar year.
 */
export const SCORECARD_CHANNELS = `WITH t AS (SELECT ${CHANNEL_CASE} AS channel, YEAR(CURDATE()) - YEAR(ts) AS y, ts < CURDATE() + INTERVAL 1 DAY - INTERVAL (YEAR(CURDATE()) - YEAR(ts)) YEAR AS to_date, amount FROM (${GIFT_ROWS} WHERE (m.ts >= MAKEDATE(YEAR(CURDATE()) - 1, 1) AND m.ts < CURDATE() + INTERVAL 1 DAY) OR (m.ts >= MAKEDATE(YEAR(CURDATE()) - 4, 1) AND m.ts < MAKEDATE(YEAR(CURDATE()) - 3, 1))) x), c AS (SELECT channel, ROUND(SUM(CASE WHEN y = 0 THEN amount ELSE 0 END), 2) AS ytd, SUM(y = 0) AS gifts_ytd, ROUND(SUM(CASE WHEN y = 1 AND to_date THEN amount ELSE 0 END), 2) AS ly_ytd, ROUND(SUM(CASE WHEN y = 1 AND NOT to_date THEN amount ELSE 0 END), 2) AS ly_rest, SUM(y = 1 AND to_date) AS ly_gifts_ytd, SUM(y = 1 AND NOT to_date) AS ly_gifts_rest, ROUND(SUM(CASE WHEN y = 4 AND to_date THEN amount ELSE 0 END), 2) AS mt_ytd, ROUND(SUM(CASE WHEN y = 4 AND NOT to_date THEN amount ELSE 0 END), 2) AS mt_rest, SUM(y = 4 AND to_date) AS mt_gifts_ytd, SUM(y = 4 AND NOT to_date) AS mt_gifts_rest FROM t GROUP BY channel), u AS (SELECT * FROM c UNION ALL SELECT 'All channels', SUM(ytd), SUM(gifts_ytd), SUM(ly_ytd), SUM(ly_rest), SUM(ly_gifts_ytd), SUM(ly_gifts_rest), SUM(mt_ytd), SUM(mt_rest), SUM(mt_gifts_ytd), SUM(mt_gifts_rest) FROM c) SELECT u.*, YEAR(CURDATE()) - 1 AS ly_year, YEAR(CURDATE()) - 4 AS mt_year, DATEDIFF(MAKEDATE(YEAR(CURDATE()) + 1, 1), CURDATE()) - 1 AS days_left, ROUND(u.ly_ytd + u.ly_rest, 2) AS ly_full, ROUND(u.mt_ytd + u.mt_rest, 2) AS mt_full, ROUND(u.ytd * (1 + u.ly_rest / NULLIF(u.ly_ytd, 0)), 2) AS proj_ly, ROUND(u.ytd * (1 + u.mt_rest / NULLIF(u.mt_ytd, 0)), 2) AS proj_mt, ROUND(u.gifts_ytd * (1 + u.ly_gifts_rest / NULLIF(u.ly_gifts_ytd, 0))) AS proj_gifts_ly, ROUND(u.gifts_ytd * (1 + u.mt_gifts_rest / NULLIF(u.mt_gifts_ytd, 0))) AS proj_gifts_mt FROM u ORDER BY u.channel = 'All channels' DESC, u.ytd DESC`;

/** Scorecard: revenue for each month of this year, last year and the last midterm year. */
export const SCORECARD_MONTHS = `SELECT MONTH(m.ts) AS month_no, ROUND(SUM(CASE WHEN YEAR(m.ts) = YEAR(CURDATE()) THEN m.amount ELSE 0 END), 2) AS ty, ROUND(SUM(CASE WHEN YEAR(m.ts) = YEAR(CURDATE()) - 1 THEN m.amount ELSE 0 END), 2) AS ly, ROUND(SUM(CASE WHEN YEAR(m.ts) = YEAR(CURDATE()) - 4 THEN m.amount ELSE 0 END), 2) AS mt, ROUND(SUM(CASE WHEN YEAR(m.ts) = YEAR(CURDATE()) - 1 AND m.ts < CURDATE() + INTERVAL 1 DAY - INTERVAL 1 YEAR THEN m.amount ELSE 0 END), 2) AS ly_to_date, ROUND(SUM(CASE WHEN YEAR(m.ts) = YEAR(CURDATE()) - 4 AND m.ts < CURDATE() + INTERVAL 1 DAY - INTERVAL 4 YEAR THEN m.amount ELSE 0 END), 2) AS mt_to_date, MONTH(CURDATE()) AS this_month FROM \`transaction\` m WHERE (m.ts >= MAKEDATE(YEAR(CURDATE()) - 1, 1) AND m.ts < CURDATE() + INTERVAL 1 DAY) OR (m.ts >= MAKEDATE(YEAR(CURDATE()) - 4, 1) AND m.ts < MAKEDATE(YEAR(CURDATE()) - 3, 1)) GROUP BY 1 ORDER BY 1`;

// ---- Data Quality: this year to date, with the same dates last year -------------

const GIFTS_WITH_CHANNEL = `SELECT x.*, ${CHANNEL_CASE} AS ch FROM (${GIFT_ROWS}) x`;

const THIS_YEAR = `ts >= ${YEAR_START} AND ts < ${TOMORROW}`;
const LAST_YEAR = `ts >= ${YEAR_START} - INTERVAL 1 YEAR AND ts < ${TOMORROW} - INTERVAL 1 YEAR`;
const CODED = `(COALESCE(transaction_source_code, '') <> '')`;
const CONVENTION = `(sc_n LIKE 'loc\\_%' OR sc_n LIKE 'ms\\_%')`;

/** One row per period: gifts and revenue, and how many of each have a coding gap. */
export const DQ_SUMMARY = `SELECT period, COUNT(*) AS gifts, ROUND(SUM(amount), 2) AS revenue,
  SUM(NOT ${CODED}) AS uncoded_gifts, ROUND(SUM(CASE WHEN NOT ${CODED} THEN amount END), 2) AS uncoded_revenue,
  SUM(${CODED} AND NOT ${CONVENTION}) AS offconv_gifts, ROUND(SUM(CASE WHEN ${CODED} AND NOT ${CONVENTION} THEN amount END), 2) AS offconv_revenue,
  SUM(${CODED} AND COALESCE(source_code_channel, '') = '') AS nochannel_gifts, ROUND(SUM(CASE WHEN ${CODED} AND COALESCE(source_code_channel, '') = '' THEN amount END), 2) AS nochannel_revenue,
  SUM(${CODED} AND COALESCE(campaign, '') = '') AS nocampaign_gifts, ROUND(SUM(CASE WHEN ${CODED} AND COALESCE(campaign, '') = '' THEN amount END), 2) AS nocampaign_revenue,
  SUM(final_message_id IS NOT NULL) AS linked_gifts, ROUND(SUM(CASE WHEN final_message_id IS NOT NULL THEN amount END), 2) AS linked_revenue,
  SUM(ch IN ('No source code', 'Other source code')) AS unreadable_gifts, ROUND(SUM(CASE WHEN ch IN ('No source code', 'Other source code') THEN amount END), 2) AS unreadable_revenue
FROM (SELECT g.*, CASE WHEN ${THIS_YEAR} THEN 'This year' ELSE 'Last year' END AS period FROM (${GIFTS_WITH_CHANNEL}) g WHERE (${THIS_YEAR}) OR (${LAST_YEAR})) z GROUP BY period ORDER BY period DESC`;

/** Gifts whose source code is outside the LOC_ / MS_ convention, by the channel they read as. */
export const DQ_OFF_CONVENTION = `SELECT ch AS channel, COUNT(DISTINCT transaction_source_code) AS codes, COUNT(*) AS gifts, ROUND(SUM(amount), 2) AS revenue FROM (${GIFTS_WITH_CHANNEL}) g WHERE ${THIS_YEAR} AND ${CODED} AND NOT ${CONVENTION} GROUP BY ch ORDER BY revenue DESC`;

/** Revenue with no readable channel, and uncoded revenue, by month this year and last. */
export const DQ_MONTHS = `SELECT DATE_FORMAT(ts, '%m') AS month_no, YEAR(CURDATE()) - YEAR(ts) AS y, ROUND(SUM(amount), 2) AS revenue, ROUND(SUM(CASE WHEN ch IN ('No source code', 'Other source code') THEN amount END), 2) AS unreadable_revenue, ROUND(SUM(CASE WHEN NOT ${CODED} THEN amount END), 2) AS uncoded_revenue FROM (${GIFTS_WITH_CHANNEL}) g WHERE (${THIS_YEAR}) OR (${LAST_YEAR}) GROUP BY 1, 2 ORDER BY 1, 2`;

/**
 * Gifts this year whose source code is a literal merge tag that never got filled in (for example
 * {{refcode}} or *|REFCODE|*), and gifts coded with a test variant (v1, v2, ctrl, test) instead of the parent code.
 */
export const DQ_CODE_FLAWS = `SELECT kind, COUNT(*) AS gifts, ROUND(SUM(amount), 2) AS revenue, COUNT(DISTINCT transaction_source_code) AS codes, MAX(transaction_source_code) AS example FROM (SELECT transaction_source_code, amount, CASE WHEN LOWER(transaction_source_code) REGEXP '\\\\{\\\\{|\\\\}\\\\}|%%|\\\\*\\\\||\\\\|\\\\*|\\\\[\\\\[|\\\\$\\\\{|<%|%7b' THEN 'merge' WHEN LOWER(transaction_source_code) REGEXP '(^|[_-])(v[0-9]+|ctrl|control|test|variant[0-9a-z]*)($|[_-])' THEN 'variant' END AS kind FROM (${GIFT_ROWS} WHERE m.ts >= ${YEAR_START} AND m.ts < ${TOMORROW}) g WHERE COALESCE(transaction_source_code, '') <> '') z WHERE kind IS NOT NULL GROUP BY kind`;

/** ActBlue (or other) pages taking gifts that have no source code. */
export const DQ_PAGES = `SELECT COALESCE(NULLIF(remote_page_name, ''), '(no page name)') AS page, COUNT(*) AS gifts, ROUND(SUM(amount), 2) AS revenue FROM (${GIFT_ROWS}) g WHERE ${THIS_YEAR} AND NOT ${CODED} GROUP BY 1 ORDER BY revenue DESC LIMIT 10`;

/** How many of the source codes used this year have an acquisition cost in the source code dictionary. */
export const DQ_ACQUISITION_COST = `WITH c AS (SELECT DISTINCT m.final_source_code_id AS id FROM \`transaction\` m WHERE m.ts >= ${YEAR_START} AND m.ts < ${TOMORROW}), d AS (SELECT d.source_code_id, UPPER(COALESCE(d.source_code_channel, '')) AS scc, d.acquisition_cost AS cost, d.acquisition_cost_per_person AS cpp, (d.acquisition_cost > 0 AND d.acquisition_cost < 1000000) AS ok_cost, (d.acquisition_cost >= 1000000) AS bad_cost, (d.acquisition_cost_per_person > 0 AND d.acquisition_cost_per_person < 10000) AS ok_cpp FROM c JOIN source_code_dictionary d ON d.source_code_id = c.id) SELECT COUNT(*) AS codes, SUM(ok_cost) AS codes_with_cost, SUM(bad_cost) AS codes_bad_cost, SUM(ok_cpp) AS codes_with_cpp, ROUND(COALESCE(SUM(CASE WHEN ok_cost THEN cost END), 0), 2) AS cost_total, SUM(scc = 'RTL') AS rtl_codes, SUM(scc = 'RTL' AND (ok_cost OR ok_cpp)) AS rtl_codes_with_cost, ROUND(COALESCE(SUM(CASE WHEN scc = 'RTL' AND ok_cost THEN cost END), 0), 2) AS rtl_cost FROM d`;

// ---- Scorecard: cost, new donors and list growth ------------------------------

const SC_CHANNEL_OF_MESSAGE = `CASE channel WHEN 'email' THEN 'Email' WHEN 'sms' THEN 'Text (SMS)' WHEN 'facebook_ad' THEN 'Meta ads' WHEN 'google_ad' THEN 'Google ads' ELSE NULL END`;

/**
 * Tracked cost by channel for this year to date and the same dates last year:
 * sending and ad spend recorded on messages. Rented and bought list costs sit on
 * the source code dictionary with no date, so they are returned separately
 * (list_cost, this year's codes only).
 */
export const SCORECARD_COST = `SELECT ${SC_CHANNEL_OF_MESSAGE} AS channel, ROUND(SUM(CASE WHEN YEAR(date) = YEAR(CURDATE()) THEN COALESCE(spend_override, spend) ELSE 0 END), 2) AS cost, ROUND(SUM(CASE WHEN YEAR(date) = YEAR(CURDATE()) - 1 THEN COALESCE(spend_override, spend) ELSE 0 END), 2) AS ly_cost FROM global_message_summary_by_date WHERE date >= MAKEDATE(YEAR(CURDATE()) - 1, 1) AND date < CURDATE() + INTERVAL 1 DAY - INTERVAL (YEAR(CURDATE()) - YEAR(date)) YEAR AND ${SC_CHANNEL_OF_MESSAGE} IS NOT NULL GROUP BY 1`;

/** Cost of the rented-list (RTL) source codes used this year, from the source code dictionary. */
export const SCORECARD_LIST_COST = `SELECT ROUND(COALESCE(SUM(d.acquisition_cost), 0), 2) AS list_cost, COUNT(*) AS codes FROM (SELECT DISTINCT m.final_source_code_id AS id FROM \`transaction\` m WHERE m.ts >= ${YEAR_START} AND m.ts < ${TOMORROW}) c JOIN source_code_dictionary d ON d.source_code_id = c.id WHERE UPPER(COALESCE(d.source_code_channel, '')) = 'RTL' AND d.acquisition_cost > 0 AND d.acquisition_cost < 1000000`;

/** People whose first-ever gift fell this year (or the same dates last year), by the channel of that gift. */
export const SCORECARD_NEW_DONORS = `SELECT ch AS channel, COUNT(DISTINCT CASE WHEN y = 0 THEN person_id END) AS new_donors, COUNT(DISTINCT CASE WHEN y = 1 THEN person_id END) AS ly_new_donors FROM (SELECT x.*, ${CHANNEL_CASE} AS ch, YEAR(CURDATE()) - YEAR(ts) AS y FROM (${GIFT_ROWS} JOIN (SELECT person_id, MIN(ts) AS fts FROM \`transaction\` GROUP BY person_id HAVING MIN(ts) >= MAKEDATE(YEAR(CURDATE()) - 1, 1)) f ON f.person_id = m.person_id AND f.fts = m.ts) x WHERE ts < CURDATE() + INTERVAL 1 DAY - INTERVAL (YEAR(CURDATE()) - YEAR(ts)) YEAR) z GROUP BY ch`;

/** Email sign-ups by month, this year and last (email platform records by date created). */
export const SCORECARD_LIST_MONTHS = `SELECT MONTH(date_created) AS month_no, SUM(YEAR(date_created) = YEAR(CURDATE())) AS ty, SUM(YEAR(date_created) = YEAR(CURDATE()) - 1) AS ly FROM acoustic_jsv_person WHERE date_created >= MAKEDATE(YEAR(CURDATE()) - 1, 1) GROUP BY 1 ORDER BY 1`;

/** The email list as it stands today, by subscription status. */
export const SCORECARD_LIST_STATUS = `SELECT COALESCE(NULLIF(subscription_status, ''), 'Unknown') AS status, COUNT(*) AS people FROM acoustic_jsv_person GROUP BY 1 ORDER BY people DESC`;

// ---- Acquisition: new donors and where they came from -----------------------------
// These take the report's date windows ({ start, end } as YYYY-MM-DD, end exclusive).
// Dates are checked here and are the only input; nothing else varies.

const ymd = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new Error('Expected a YYYY-MM-DD date');
  return String(d);
};

/** One row per person whose first-ever gift is on or after `from`: that gift's channel, source code, date, amount and whether it recurs. */
const ACQ_FIRSTS = (from) => `SELECT person_id, MIN(ch) AS ch, MIN(sc) AS sc, MIN(fts) AS fts, SUM(amount) AS first_amt, MAX(recurs_id > 0) AS first_recurring FROM (SELECT x.person_id, x.ts AS fts, x.amount, x.recurs_id, x.transaction_source_code AS sc, ${CHANNEL_CASE} AS ch FROM (${GIFT_ROWS} JOIN (SELECT person_id, MIN(ts) AS fts FROM \`transaction\` GROUP BY person_id HAVING MIN(ts) >= '${ymd(from)}') f ON f.person_id = m.person_id AND f.fts = m.ts) x) y GROUP BY person_id`;

const ACQ_WITH_TOTALS = (from) => `WITH fg AS (${ACQ_FIRSTS(from)}), tot AS (SELECT t.person_id, SUM(t.amount) AS total, MAX(t.ts) AS last_ts FROM \`transaction\` t JOIN fg ON fg.person_id = t.person_id GROUP BY t.person_id)`;

const ACQ_MEASURES = `COUNT(*) AS donors, ROUND(SUM(fg.first_amt), 2) AS first_amt, ROUND(SUM(tot.total - fg.first_amt), 2) AS later_amt, SUM(tot.total > fg.first_amt) AS gave_again, SUM(fg.first_recurring) AS started_monthly, SUM(tot.last_ts >= CURDATE() - INTERVAL 90 DAY) AS active_90`;

/** New donors in the period and the same dates last year, by the channel of their first gift. */
export const ACQ_PERIOD = (ty, ly) => `${ACQ_WITH_TOTALS(ly.start)} SELECT CASE WHEN fg.fts >= '${ymd(ty.start)}' AND fg.fts < '${ymd(ty.end)}' THEN 'ty' ELSE 'ly' END AS period, fg.ch AS channel, ${ACQ_MEASURES} FROM fg JOIN tot ON tot.person_id = fg.person_id WHERE (fg.fts >= '${ymd(ty.start)}' AND fg.fts < '${ymd(ty.end)}') OR (fg.fts >= '${ymd(ly.start)}' AND fg.fts < '${ymd(ly.end)}') GROUP BY 1, 2`;

/** New donors by month of first gift and channel, from January last year (not tied to the picked period). */
export const ACQ_MONTHLY = `${ACQ_WITH_TOTALS('1900-01-01').replace("'1900-01-01'", 'MAKEDATE(YEAR(CURDATE()) - 1, 1)')} SELECT DATE_FORMAT(fg.fts, '%Y-%m-01') AS month, fg.ch AS channel, ${ACQ_MEASURES} FROM fg JOIN tot ON tot.person_id = fg.person_id GROUP BY 1, 2 ORDER BY 1`;

/** The source codes that brought in the most new donors in the period. */
export const ACQ_CODES = (ty, ly) => `${ACQ_WITH_TOTALS(ty.start)} SELECT COALESCE(NULLIF(fg.sc, ''), '(no source code)') AS source, MIN(fg.ch) AS channel, ${ACQ_MEASURES} FROM fg JOIN tot ON tot.person_id = fg.person_id WHERE fg.fts >= '${ymd(ty.start)}' AND fg.fts < '${ymd(ty.end)}' GROUP BY 1 ORDER BY donors DESC LIMIT 12`;

/** Ad spend recorded on messages in the period and the same dates last year. */
export const ACQ_COST = (ty, ly) => `SELECT CASE WHEN date >= '${ymd(ty.start)}' AND date < '${ymd(ty.end)}' THEN 'ty' ELSE 'ly' END AS period, ${SC_CHANNEL_OF_MESSAGE} AS channel, ROUND(SUM(COALESCE(spend_override, spend)), 2) AS cost FROM global_message_summary_by_date WHERE channel IN ('facebook_ad', 'google_ad') AND ((date >= '${ymd(ty.start)}' AND date < '${ymd(ty.end)}') OR (date >= '${ymd(ly.start)}' AND date < '${ymd(ly.end)}')) GROUP BY 1, 2`;

/** Email sign-ups in the period by the type part of their source code (LOC_EM_… reads as EM), with how many are still subscribed. */
export const ACQ_SIGNUPS = (ty, ly) => `SELECT CASE WHEN date_created >= '${ymd(ty.start)}' AND date_created < '${ymd(ty.end)}' THEN 'ty' ELSE 'ly' END AS period, CASE WHEN COALESCE(source_code, '') = '' THEN '(no source code)' WHEN source_code REGEXP '^[A-Za-z0-9]{2,8}_[^_]+' THEN UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(source_code, '_', 2), '_', -1)) ELSE '(other format)' END AS source, COUNT(*) AS signups, SUM(subscription_status = 'Subscribed') AS still_subscribed FROM acoustic_jsv_person WHERE (date_created >= '${ymd(ty.start)}' AND date_created < '${ymd(ty.end)}') OR (date_created >= '${ymd(ly.start)}' AND date_created < '${ymd(ly.end)}') GROUP BY 1, 2`;

/**
 * Bought lists (co-registration): imported email lists whose source code has a purchase price
 * (acquisition_cost) in the source-code dictionary. Each list counts in the period holding the
 * import date written in its code (LOC_IMPORT_EM_LP_YYYYMMDD_...). Per period: lists, cost, people
 * added to the email platform with those codes, how many of them first gave after joining, and
 * what those new donors have given since.
 */
export const ACQ_BOUGHT_LISTS = (ty, ly) => `WITH c AS (SELECT d.source_code, d.acquisition_cost AS cost, STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(d.source_code, '_', 5), '_', -1), '%Y%m%d') AS dt FROM source_code_dictionary d WHERE UPPER(COALESCE(d.source_code_channel, '')) = 'IMPORT' AND d.acquisition_cost > 0 AND d.acquisition_cost < 1000000), codes AS (SELECT source_code, cost, CASE WHEN dt >= '${ymd(ty.start)}' AND dt < '${ymd(ty.end)}' THEN 'ty' WHEN dt >= '${ymd(ly.start)}' AND dt < '${ymd(ly.end)}' THEN 'ly' END AS period FROM c), pp AS (SELECT a.source_code, a.date_created, r.person_id FROM acoustic_jsv_person a JOIN codes ON codes.source_code = a.source_code AND codes.period IS NOT NULL LEFT JOIN person_remote r ON r.remote_person_id = a.remote_person_id), f AS (SELECT t.person_id, MIN(t.ts) AS fts, SUM(t.amount) AS total FROM \`transaction\` t JOIN (SELECT DISTINCT person_id FROM pp WHERE person_id IS NOT NULL) q ON q.person_id = t.person_id GROUP BY t.person_id), s AS (SELECT pp.source_code, COUNT(*) AS signups, SUM(f.fts >= pp.date_created) AS new_donors, SUM(CASE WHEN f.fts >= pp.date_created THEN f.total END) AS raised FROM pp LEFT JOIN f ON f.person_id = pp.person_id GROUP BY pp.source_code) SELECT codes.period, COUNT(*) AS lists, ROUND(SUM(codes.cost), 2) AS cost, SUM(COALESCE(s.signups, 0)) AS signups, SUM(COALESCE(s.new_donors, 0)) AS new_donors, ROUND(SUM(COALESCE(s.raised, 0)), 2) AS raised FROM codes LEFT JOIN s ON s.source_code = codes.source_code WHERE codes.period IS NOT NULL GROUP BY codes.period`;

/**
 * Gifts read as coming from ads (a linked Meta or Google ad message, or an ad source code) in the
 * period and the same dates last year. The generous end of the Ads tab's raised-per-$1 range;
 * the strict end counts only gifts whose last click was on an ad.
 */
export const ADS_CODED_GIFTS = (ty, ly) => `SELECT period, ch AS channel, COUNT(*) AS gifts, ROUND(SUM(amount), 2) AS revenue FROM (SELECT x.*, CASE WHEN ts >= '${ymd(ty.start)}' AND ts < '${ymd(ty.end)}' THEN 'ty' ELSE 'ly' END AS period, ${CHANNEL_CASE} AS ch FROM (${GIFT_ROWS} WHERE (m.ts >= '${ymd(ty.start)}' AND m.ts < '${ymd(ty.end)}') OR (m.ts >= '${ymd(ly.start)}' AND m.ts < '${ymd(ly.end)}')) x) z WHERE ch IN ('Meta ads', 'Google ads', 'Paid ads (coded)') GROUP BY 1, 2`;

// ---- Donor retention (a section of All Donations) ---------------------------------
// One row per person: the first gift on record and whether they gave in the period (a0),
// in the same dates a year earlier (a1) and in the same dates two years earlier (a2).
// Windows are checked dates, end exclusive; only `ty` and `ly` come from the page.

/**
 * Donors in the period and the same dates last year, split into returning (also gave a year
 * before), came back (gave earlier, but not then) and new (first gift ever). Also last year's
 * donors who gave again, new donors who gave again, and the same for the year before.
 */
export const RETENTION = (ty, ly) => {
  const t0 = `'${ymd(ty.start)}'`, t1 = `'${ymd(ty.end)}'`, l0 = `'${ymd(ly.start)}'`, l1 = `'${ymd(ly.end)}'`;
  const m0 = `(${l0} - INTERVAL 1 YEAR)`, m1 = `(${l1} - INTERVAL 1 YEAR)`;
  return `WITH p AS (SELECT person_id, MIN(ts) AS f, MAX(ts >= ${t0} AND ts < ${t1}) AS a0, MAX(ts >= ${l0} AND ts < ${l1}) AS a1, MAX(ts >= ${m0} AND ts < ${m1}) AS a2 FROM \`transaction\` WHERE person_id IS NOT NULL AND ts < ${t1} GROUP BY person_id) SELECT SUM(a0) AS donors_ty, SUM(a0 AND a1) AS returning_ty, SUM(a0 AND f >= ${t0}) AS new_ty, SUM(a1) AS donors_ly, SUM(a1 AND a2) AS returning_ly, SUM(a1 AND f >= ${l0}) AS new_ly, SUM(a2) AS donors_py, SUM(a2 AND f >= ${m0}) AS new_py, SUM(a1 AND f >= ${l0} AND a0) AS new_ly_again, SUM(a2 AND f >= ${m0} AND a1) AS new_py_again, YEAR(MIN(f)) AS data_start_year, DATE_FORMAT(MIN(f), '%Y-%m-%d') AS data_start FROM p`;
};

// ---- Recurring donors (folded into All Donations) --------------------------------
// A monthly donor counts as active with a payment in the last 35 days, and as stopped
// once 45 days pass with no payment. Windows are checked dates, as for Acquisition.

const REC = `\`transaction\` WHERE recurs_id > 0 AND person_id IS NOT NULL`;
const REC_PEOPLE = `SELECT person_id, MIN(ts) AS f, MAX(ts) AS l FROM ${REC} GROUP BY person_id`;

/** Monthly donors who started and who stopped, by month, for the last 24 months. */
export const REC_FLOW = `WITH p AS (${REC_PEOPLE}) SELECT month, SUM(kind = 's') AS started, SUM(kind = 'e') AS stopped FROM (SELECT DATE_FORMAT(f, '%Y-%m-01') AS month, 's' AS kind FROM p WHERE f >= DATE_FORMAT(CURDATE() - INTERVAL 23 MONTH, '%Y-%m-01') UNION ALL SELECT DATE_FORMAT(l, '%Y-%m-01') AS month, 'e' AS kind FROM p WHERE l >= DATE_FORMAT(CURDATE() - INTERVAL 23 MONTH, '%Y-%m-01') AND l < CURDATE() - INTERVAL 45 DAY) e GROUP BY month ORDER BY month`;

/** Monthly donors by the year of their first monthly payment, with who still gives and what they gave in the period. */
export const REC_COHORTS = (ty) => `WITH p AS (${REC_PEOPLE}), r AS (SELECT person_id, SUM(amount) AS rev FROM ${REC} AND ts >= '${ymd(ty.start)}' AND ts < '${ymd(ty.end)}' GROUP BY person_id) SELECT YEAR(p.f) AS year, COUNT(*) AS donors, SUM(p.l >= CURDATE() - INTERVAL 35 DAY) AS active, ROUND(COALESCE(SUM(r.rev), 0), 2) AS revenue, (SELECT MIN(YEAR(ts)) FROM \`transaction\`) AS data_start FROM p LEFT JOIN r ON r.person_id = p.person_id GROUP BY 1 ORDER BY 1`;

/** Monthly donors by the channel of their first monthly payment. */
export const REC_CHANNELS = (ty) => `WITH fp AS (SELECT person_id, MIN(ch) AS ch FROM (SELECT x.person_id, ${CHANNEL_CASE} AS ch FROM (${GIFT_ROWS} JOIN (SELECT person_id, MIN(ts) AS fts FROM ${REC} GROUP BY person_id) f ON f.person_id = m.person_id AND f.fts = m.ts AND m.recurs_id > 0) x) y GROUP BY person_id), p AS (${REC_PEOPLE}), r AS (SELECT person_id, SUM(amount) AS rev FROM ${REC} AND ts >= '${ymd(ty.start)}' AND ts < '${ymd(ty.end)}' GROUP BY person_id) SELECT fp.ch AS channel, COUNT(*) AS donors, SUM(p.l >= CURDATE() - INTERVAL 35 DAY) AS active, ROUND(COALESCE(SUM(r.rev), 0), 2) AS revenue FROM fp JOIN p ON p.person_id = fp.person_id LEFT JOIN r ON r.person_id = fp.person_id GROUP BY 1`;

/**
 * Of the monthly donors active on January 1 (a payment in the 35 days before), how many are still
 * giving at the end of the period. Run for this year and for last year on the same dates.
 */
export const REC_KEPT = (ty, ly) => {
  const jan = (w) => { const d = new Date(`${ymd(w.end)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return `${d.getUTCFullYear()}-01-01`; };
  const one = (tag, w) => `MAX(ts >= '${jan(w)}' - INTERVAL 35 DAY AND ts < '${jan(w)}') AS a_${tag}, MAX(ts >= '${ymd(w.end)}' - INTERVAL 35 DAY AND ts < '${ymd(w.end)}') AS k_${tag}`;
  return `SELECT SUM(a_ty) AS base_ty, SUM(a_ty AND k_ty) AS kept_ty, SUM(a_ly) AS base_ly, SUM(a_ly AND k_ly) AS kept_ly FROM (SELECT person_id, ${one('ty', ty)}, ${one('ly', ly)} FROM ${REC} AND ts >= '${jan(ly)}' - INTERVAL 35 DAY GROUP BY person_id) z`;
};
