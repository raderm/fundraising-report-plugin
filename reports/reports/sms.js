import { messageSource, messageMetrics, m, SMS_PLATFORM } from '../helpers.js';

// Texts: every text message in the range, from global_message_summary.
// Revenue is credited to the last text a donor clicked before giving; cost is
// the platform's sending charge (`spend`).

const SOURCE = messageSource('sms');
const NAME = "upper(ifnull(nullif(label,''),ifnull(nullif(subject,''),'')))";
const PART = (n) => `substring_index(substring_index(${NAME},'_',${n}),'_',-1)`;
const TYPE = `case when left(${NAME},4)<>'LOC_' then 'Other' when ${PART(2)}='BC' then 'Broadcast'
  when ${PART(2)}='P2P' then 'Peer-to-peer' when ${PART(2)}='RTL' then 'Rented list' else 'Other' end`;
const PURPOSE = `case when left(${NAME},4)<>'LOC_' then 'Other' when ${PART(3)}='FR' then 'Fundraising ask'
  when ${PART(3)}='PET' then 'Petition' when ${PART(3)}='SURV' then 'Survey' else 'Other' end`;

const costMetrics = () => [
  m('messages', 'count(distinct message_id)'),
  m('sent', 'sum(sent)'),
  m('revenue', 'sum(attributed_revenue)', 'currency'),
  m('gifts', 'sum(attributed_transactions)'),
  m('cost', 'sum(spend)', 'currency'),
  m('clicks', 'sum(clicks)'),
  m('optouts', 'sum(unsubscribes)')
];

export default {
  name: 'Texts',
  description: 'Texts sent, revenue credited to texts, sending cost, opt-outs, platforms, message types and the best texts.',
  tags: ['Fundraising', 'SMS'],
  data_sources: { default: SOURCE },
  sections: [
    {
      title: 'Totals',
      components: [
        {
          id: 'kpis',
          component: 'Table',
          metrics: [...messageMetrics(), m('cost', 'sum(spend)', 'currency'), m('new_people', 'sum(origin_person_count)')]
        }
      ]
    },
    {
      title: 'Over time',
      components: [
        { id: 'monthly', component: 'Table', dimensions: [{ name: 'month', eql: 'month(publish_date)' }], metrics: costMetrics() },
        { id: 'weekly', component: 'Table', dimensions: [{ name: 'week', eql: 'week(publish_date)' }], metrics: costMetrics() }
      ]
    },
    {
      title: 'Platforms and types',
      components: [
        { id: 'platforms', component: 'Table', dimensions: [{ name: 'platform', eql: SMS_PLATFORM }], metrics: costMetrics() },
        { id: 'types', component: 'Table', dimensions: [{ name: 'type', eql: TYPE }], metrics: costMetrics() },
        { id: 'purposes', component: 'Table', dimensions: [{ name: 'purpose', eql: PURPOSE }], metrics: costMetrics() }
      ]
    },
    {
      title: 'Top texts',
      components: [
        {
          id: 'top_texts',
          component: 'Table',
          query: {
            table: 'global_message_summary',
            columns: [
              { eql: 'min(publish_date)', name: 'send_date' },
              { eql: "ifnull(nullif(max(label),''),ifnull(nullif(max(subject),''),'(no name)'))", name: 'message' },
              { eql: `max(${SMS_PLATFORM})`, name: 'platform' },
              { eql: `max(${TYPE})`, name: 'type' },
              { eql: 'sum(sent)', name: 'sent' },
              { eql: 'sum(attributed_revenue)', name: 'revenue' },
              { eql: 'sum(attributed_transactions)', name: 'gifts' },
              { eql: 'sum(spend)', name: 'cost' },
              { eql: 'sum(clicks)', name: 'clicks' },
              { eql: 'sum(unsubscribes)', name: 'optouts' },
              { eql: 'sum(attributed_initial_recurring_transactions)', name: 'new_monthly' }
            ],
            conditions: SOURCE.conditions,
            groupBy: [{ eql: 'message_id' }],
            orderBy: [{ eql: 'sum(attributed_revenue)', orderByDirection: 'desc' }],
            limit: 10
          }
        }
      ]
    }
  ]
};
