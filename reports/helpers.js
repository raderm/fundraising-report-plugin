// Shared EQL for the Fundraising Report: gifts with their source code and
// linked message, and the report's channel rules, the same on every tab.
//
// EQL has no REGEXP and no backslash escapes in LIKE, so patterns that need a
// literal "_" use left(), right() and locate() instead.

// A pasted ActBlue link reduced to its refcode.
const REF = `case when ifnull(source_code_dictionary.source_code,'') like '%refcode=%'
  then substring_index(substring_index(source_code_dictionary.source_code,'refcode=',-1),'&',1)
  else ifnull(source_code_dictionary.source_code,'') end`;

// Layer 1: gifts joined to their source code and the message engine9 links them to.
const GIFTS = {
  table: 'transaction',
  columns: [
    { eql: 'transaction.id', name: 'id' },
    { eql: 'transaction.person_id', name: 'person_id' },
    { eql: 'transaction.ts', name: 'ts' },
    { eql: 'transaction.amount', name: 'amount' },
    { eql: 'transaction.recurs_id', name: 'recurs_id' },
    { eql: 'transaction.remote_page_name', name: 'remote_page_name' },
    { eql: 'source_code_dictionary.source_code', name: 'source_code' },
    { eql: 'source_code_dictionary.source_code_channel', name: 'source_code_channel' },
    { eql: 'source_code_dictionary.campaign', name: 'campaign' },
    { eql: 'global_message.channel', name: 'message_channel' },
    { eql: REF, name: 'ref' }
  ],
  joins: [
    {
      table: 'source_code_dictionary',
      type: 'left',
      join_eql: 'transaction.final_source_code_id=source_code_dictionary.source_code_id'
    },
    { table: 'global_message', type: 'left', join_eql: 'transaction.final_message_id=global_message.id' }
  ]
};

// Layer 2: the two parts of a code the channel rules read. sc_t is the
// dictionary's channel, or else the second part of a PREFIX_CHANNEL_… code
// (prefix of 2 to 8 characters).
const PARSED = {
  table: 'g0',
  subquery: GIFTS,
  columns: [
    ...['id', 'person_id', 'ts', 'amount', 'recurs_id', 'remote_page_name', 'source_code', 'campaign', 'message_channel'].map(
      (c) => ({ eql: `g0.${c}`, name: c })
    ),
    { eql: 'lower(g0.ref)', name: 'sc_n' },
    {
      eql: `upper(ifnull(nullif(g0.source_code_channel,''),
        case when locate('_', g0.ref) between 3 and 9
          and substring(g0.ref, locate('_', g0.ref) + 1, 1) not in ('_', '')
        then substring_index(substring_index(g0.ref,'_',2),'_',-1) else '' end))`,
      name: 'sc_t'
    }
  ]
};

/** The report's channel rules, applied to a row of PARSED (alias `g1`). */
export const CHANNEL_EQL = `case
  when g1.message_channel='email' then 'Email'
  when g1.message_channel='sms' then 'Text (SMS)'
  when g1.message_channel='facebook_ad' then 'Meta ads'
  when g1.message_channel='google_ad' then 'Google ads'
  when ifnull(g1.source_code,'')='' then 'No source code'
  when g1.sc_t in ('EM','EMAIL') then 'Email'
  when g1.sc_t in ('BC','P2P','TEXT','SMS','MMS','TXT') or g1.sc_t like 'P2P-%' then 'Text (SMS)'
  when g1.sc_t='RTL' then 'Rented lists'
  when g1.sc_t='ABTY' then 'ActBlue thank-you page'
  when g1.sc_t in ('AD','ADS') or g1.sc_n like 'rtiads%' then 'Paid ads (coded)'
  when g1.sc_t in ('WEB','SITE','WEBSITE') then 'Website'
  when g1.sc_t in ('DM','MAIL') then 'Direct mail'
  when g1.sc_t in ('SOC','SOCIAL') then 'Social media'
  when g1.sc_n like 'website%' or left(g1.sc_n,4)='web_' or g1.sc_n like 'web-%' or left(g1.sc_n,5)='site_'
    or g1.sc_n like 'site-%' or locate('_site_', g1.sc_n) > 0 or right(g1.sc_n,5)='_site' then 'Website'
  when g1.sc_n like 'email%' or left(g1.sc_n,3)='em_' or locate('_email', g1.sc_n) > 0 or g1.sc_n like '%-email%' then 'Email'
  when g1.sc_n like 'sms%' or g1.sc_n like 'mms%' or g1.sc_n like 'txt%' or g1.sc_n like '%p2p%'
    or locate('_txt', g1.sc_n) > 0 or g1.sc_n like '%-txt%' or locate('_sms', g1.sc_n) > 0 or g1.sc_n like '%-sms%' then 'Text (SMS)'
  when g1.sc_n like 'social%' or g1.sc_n like '%socialmedia%' or g1.sc_n like '%social-media%' or locate('social_media', g1.sc_n) > 0
    or g1.sc_n like '%twitter%' or g1.sc_n='facebook' or g1.sc_n like 'facebook-%' or left(g1.sc_n,9)='facebook_'
    or g1.sc_n like 'instagram%' or g1.sc_n like 'bluesky%' or g1.sc_n like 'tiktok%' or g1.sc_n like 'linktree%' then 'Social media'
  when (left(g1.sc_n,2)='dm' and substring(g1.sc_n,3,1) between '0' and '9') or g1.sc_n like '%directmail%'
    or g1.sc_n like '%direct-mail%' or locate('direct_mail', g1.sc_n) > 0 then 'Direct mail'
  when g1.sc_n like '%-website%' or locate('_website', g1.sc_n) > 0 or g1.sc_n like '%homepage%' or g1.sc_n like 'home-%'
    or g1.sc_n like 'hero-%' or g1.sc_n like 'menu-%' or g1.sc_n like '%-menu%' or g1.sc_n like '%sticky%' or g1.sc_n like '%popup%'
    or g1.sc_n like 'nav-%' or g1.sc_n like '%-nav%' or g1.sc_n like '%header%' or g1.sc_n like '%footer%' or g1.sc_n like '%banner%'
    or g1.sc_n like '%-cta%' then 'Website'
  else 'Other source code' end`;

/**
 * Layer 3, the table every Fundraising Report component reads (alias `gifts`):
 * one row per gift with ts, amount, person_id, recurs_id, remote_page_name,
 * source_code, campaign and channel.
 */
export const GIFTS_SUBQUERY = {
  table: 'g1',
  subquery: PARSED,
  columns: [
    ...['id', 'person_id', 'ts', 'amount', 'recurs_id', 'remote_page_name', 'source_code', 'campaign'].map((c) => ({
      eql: `g1.${c}`,
      name: c
    })),
    { eql: CHANNEL_EQL, name: 'channel' }
  ]
};

/** The gift data source: every component's base table, dated by `ts`. */
export const GIFTS_SOURCE = { table: 'gifts', date_column: 'ts', subquery: GIFTS_SUBQUERY };

export const UNATTRIBUTED = "channel in ('No source code','Other source code')";
export const UNCODED = "ifnull(source_code,'')=''";

// ---- Message tables -------------------------------------------------------

/** Email and texts: global_message_summary, dated by publish_date. */
export const messageSource = (channel) => ({
  table: 'global_message_summary',
  date_column: 'publish_date',
  conditions: [{ eql: `channel='${channel}' and publish_date is not null` }]
});

/** Ads: global_message_summary_by_date, dated by the day the platform reported. */
export const AD_SOURCE = {
  table: 'global_message_summary_by_date',
  date_column: 'date',
  conditions: [{ eql: "right(channel,3)='_ad'" }]
};

export const AD_SPEND = 'ifnull(spend_override,spend)';
export const AD_PLATFORM = "case when channel='facebook_ad' then 'Meta (Facebook and Instagram)' when channel='google_ad' then 'Google Ads' else replace(channel,'_ad','') end";
export const SMS_PLATFORM = "case when bot_path like '%Switchboard%' then 'Switchboard' when bot_path like '%Tatango%' then 'Tatango' else ifnull(nullif(bot_nickname,''),ifnull(nullif(bot_label,''),'Other')) end";

/** A metric object; `format` is the display hint the report system passes through. */
export const m = (name, eql, format = 'number') => ({ name, eql, format });

/** Sums that every message report shares. */
export const messageMetrics = () => [
  m('messages', 'count(distinct message_id)'),
  m('sent', 'sum(sent)'),
  m('revenue', 'sum(attributed_revenue)', 'currency'),
  m('gifts', 'sum(attributed_transactions)'),
  m('clicks', 'sum(clicks)'),
  m('unsubscribes', 'sum(unsubscribes)'),
  m('revenue_day1', 'sum(attributed_revenue_day_1)', 'currency'),
  m('recurring_revenue', 'sum(attributed_recurring_revenue)', 'currency'),
  m('new_monthly', 'sum(attributed_initial_recurring_transactions)'),
  m('zero_revenue_messages', 'count(distinct case when attributed_revenue=0 then message_id end)')
];
