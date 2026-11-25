import { AD_SOURCE, AD_SPEND, AD_PLATFORM, m } from '../helpers.js';

// Paid ads: every *_ad channel in global_message_summary_by_date, dated by the
// day the platform reported (not the ad's publish_date). Spend uses the
// correction entered in engine9 when there is one.

const adMetrics = () => [
  m('spend', `sum(${AD_SPEND})`, 'currency'),
  m('impressions', 'sum(impressions)'),
  m('clicks', 'sum(clicks)'),
  m('revenue', 'sum(attributed_revenue)', 'currency'),
  m('gifts', 'sum(attributed_transactions)')
];

export default {
  name: 'Advertising',
  description: 'Ad spend, reach, clicks and the gifts credited to ads, by month, platform and campaign.',
  tags: ['Fundraising', 'Ads'],
  data_sources: { default: AD_SOURCE },
  sections: [
    {
      title: 'Totals',
      components: [
        {
          id: 'kpis',
          component: 'Table',
          metrics: [
            ...adMetrics(),
            m('new_people', 'sum(origin_person_count)'),
            m('new_monthly', 'sum(attributed_initial_recurring_transactions)'),
            m('campaigns', "count(distinct nullif(campaign_name,''))")
          ]
        }
      ]
    },
    {
      title: 'By month and platform',
      components: [
        { id: 'monthly', component: 'Table', dimensions: [{ name: 'month', eql: 'month(date)' }], metrics: adMetrics() },
        { id: 'platforms', component: 'Table', dimensions: [{ name: 'platform', eql: AD_PLATFORM }], metrics: adMetrics() }
      ]
    },
    {
      title: 'Top campaigns',
      components: [
        {
          id: 'campaigns',
          component: 'Table',
          query: {
            table: 'global_message_summary_by_date',
            columns: [
              { eql: AD_PLATFORM, name: 'platform' },
              { eql: "ifnull(nullif(campaign_name,''),'(no campaign name)')", name: 'campaign' },
              { eql: 'count(distinct message_id)', name: 'ads' },
              { eql: `sum(${AD_SPEND})`, name: 'spend' },
              { eql: 'sum(impressions)', name: 'impressions' },
              { eql: 'sum(clicks)', name: 'clicks' },
              { eql: 'sum(attributed_revenue)', name: 'revenue' },
              { eql: 'sum(attributed_transactions)', name: 'gifts' },
              { eql: 'min(date)', name: 'first_day' },
              { eql: 'max(date)', name: 'last_day' }
            ],
            conditions: AD_SOURCE.conditions,
            groupBy: [{ eql: AD_PLATFORM }, { eql: "ifnull(nullif(campaign_name,''),'(no campaign name)')" }],
            orderBy: [{ eql: `sum(${AD_SPEND})`, orderByDirection: 'desc' }],
            limit: 15
          }
        }
      ]
    }
  ]
};
