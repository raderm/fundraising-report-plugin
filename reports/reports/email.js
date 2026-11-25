import { messageSource, messageMetrics, m } from '../helpers.js';

// Email: every email sent in the range, from global_message_summary. Revenue is
// credited to the last email a donor clicked before giving. Rates are left to
// the page (sums divide cleanly, and a zero send count stays a blank).

const SOURCE = messageSource('email');
const CODE = "upper(ifnull(nullif(final_primary_source_code,''),ifnull(nullif(primary_source_code,''),'')))";
const PURPOSE = `case when ${CODE}='' then 'No source code'
  when left(${CODE},6)='FKAUTO' then 'Automated'
  when left(${CODE},7)<>'LOC_EM_' and left(${CODE},6)<>'MS_EM_' then 'Other coded'
  when substring_index(substring_index(${CODE},'_',3),'_',-1)='FR' then 'Fundraising ask'
  when substring_index(substring_index(${CODE},'_',3),'_',-1)='PET' then 'Petition'
  when substring_index(substring_index(${CODE},'_',3),'_',-1) in ('POLL','SURV') then 'Poll or survey'
  when substring_index(substring_index(${CODE},'_',3),'_',-1)='CARD' then 'Card or thank-you'
  when substring_index(substring_index(${CODE},'_',3),'_',-1) in ('INVITE','INFO','NOFR','EVENT') then 'Event or information'
  else 'Other coded' end`;

const sizeOf = (col) => `case when ${col} < 50000 then 1 when ${col} < 250000 then 2 else 3 end`;

export default {
  name: 'Email',
  description: 'Email sends, revenue credited to email, list health, and the best emails, sizes and purposes.',
  tags: ['Fundraising', 'Email'],
  data_sources: { default: SOURCE },
  sections: [
    {
      title: 'Totals',
      components: [
        {
          id: 'kpis',
          component: 'Table',
          metrics: [
            ...messageMetrics(),
            m('delivered', 'sum(delivered)'),
            m('complaints', 'sum(complaints)'),
            m('hard_bounces', 'sum(hard_bounces)'),
            m('revenue_day_1', 'sum(attributed_revenue_day_1)', 'currency'),
            m('recurring_revenue', 'sum(attributed_recurring_revenue)', 'currency'),
            m('zero_revenue_messages', 'count(distinct case when attributed_revenue=0 then message_id end)')
          ]
        }
      ]
    },
    {
      title: 'Over time',
      components: [
        {
          id: 'monthly',
          component: 'Table',
          dimensions: [{ name: 'month', eql: 'month(publish_date)' }],
          metrics: [m('revenue', 'sum(attributed_revenue)', 'currency'), m('sent', 'sum(sent)'), m('messages', 'count(distinct message_id)')]
        },
        {
          id: 'weekly',
          component: 'Table',
          dimensions: [{ name: 'week', eql: 'week(publish_date)' }],
          metrics: [m('revenue', 'sum(attributed_revenue)', 'currency'), m('sent', 'sum(sent)'), m('complaints', 'sum(complaints)')]
        }
      ]
    },
    {
      title: 'What worked',
      components: [
        {
          id: 'purpose',
          component: 'Table',
          dimensions: [{ name: 'purpose', eql: PURPOSE }],
          metrics: [
            m('messages', 'count(distinct message_id)'),
            m('sent', 'sum(sent)'),
            m('revenue', 'sum(attributed_revenue)', 'currency'),
            m('gifts', 'sum(attributed_transactions)'),
            m('clicks', 'sum(clicks)'),
            m('delivered', 'sum(delivered)'),
            m('unsubscribes', 'sum(unsubscribes)'),
            m('new_monthly', 'sum(attributed_initial_recurring_transactions)'),
            m('zero_revenue_messages', 'count(distinct case when attributed_revenue=0 then message_id end)')
          ]
        },
        {
          // Top 10 messages by revenue. One row per message (splits of one
          // subject stay separate: EQL has no REGEXP_REPLACE to clean merge tags).
          id: 'top_emails',
          component: 'Table',
          query: {
            table: 'global_message_summary',
            columns: [
              { eql: 'min(publish_date)', name: 'send_date' },
              { eql: "ifnull(nullif(max(subject),''),'(no subject)')", name: 'subject' },
              { eql: 'sum(sent)', name: 'sent' },
              { eql: 'sum(delivered)', name: 'delivered' },
              { eql: 'sum(attributed_revenue)', name: 'revenue' },
              { eql: 'sum(attributed_transactions)', name: 'gifts' },
              { eql: 'sum(clicks)', name: 'clicks' },
              { eql: 'sum(unsubscribes)', name: 'unsubscribes' },
              { eql: 'sum(attributed_initial_recurring_transactions)', name: 'new_monthly' }
            ],
            conditions: SOURCE.conditions,
            groupBy: [{ eql: 'message_id' }],
            orderBy: [{ eql: 'sum(attributed_revenue)', orderByDirection: 'desc' }],
            limit: 10
          }
        },
        {
          // Messages grouped by how many emails went out.
          id: 'by_size',
          component: 'Table',
          query: {
            table: 'msg',
            subquery: {
              table: 'global_message_summary',
              columns: [
                { eql: 'message_id', name: 'message_id' },
                // The report's conditions apply to this outer query too, so
                // it carries the columns they read.
                { eql: 'max(channel)', name: 'channel' },
                { eql: 'max(publish_date)', name: 'publish_date' },
                { eql: 'sum(sent)', name: 'sent' },
                { eql: 'sum(attributed_revenue)', name: 'revenue' }
              ],
              conditions: SOURCE.conditions,
              groupBy: [{ eql: 'message_id' }]
            },
            columns: [
              { eql: sizeOf('sent'), name: 'size_order' },
              { eql: 'count(*)', name: 'messages' },
              { eql: 'sum(sent)', name: 'sent' },
              { eql: 'sum(revenue)', name: 'revenue' },
              { eql: 'sum(case when revenue=0 then 1 else 0 end)', name: 'zero_revenue_messages' }
            ],
            groupBy: [{ eql: sizeOf('sent') }]
          }
        }
      ]
    }
  ]
};
