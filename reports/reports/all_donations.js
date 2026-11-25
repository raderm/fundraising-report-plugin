import { GIFTS_SOURCE, GIFTS_SUBQUERY, UNATTRIBUTED, UNCODED } from '../helpers.js';

// All Donations: every gift in the date range, whatever brought it in.
// Run it once for the period and once for the same dates a year earlier; the
// page compares the two runs. Charts that always cover the calendar year run
// it again with start = January 1. New donors are their own report
// (new_donors), because the date range would cut off the history they need.

const money = (eql, name) => ({ name, eql, format: 'currency' });
const count = (eql, name) => ({ name, eql, format: 'number' });

const SIZE_ORDER = 'case when amount < 25 then 1 when amount < 100 then 2 when amount < 250 then 3 when amount < 1000 then 4 else 5 end';
const SIZE_LABEL = `case when amount < 25 then 'Under $25' when amount < 100 then '$25 to $99'
  when amount < 250 then '$100 to $249' when amount < 1000 then '$250 to $999' else '$1,000 or more' end`;

const topBy = (conditions, columns, groupBy) => ({
  table: 'gifts',
  subquery: GIFTS_SUBQUERY,
  columns,
  conditions,
  groupBy,
  // Order by the expression: a bare column name is read as a table column.
  orderBy: [{ eql: 'sum(amount)', orderByDirection: 'desc' }],
  limit: 10
});

export default {
  name: 'All Donations',
  description: 'Revenue, donors, channels, gift sizes and the top source codes and uncoded pages, from every gift.',
  tags: ['Fundraising'],
  data_sources: { default: GIFTS_SOURCE },
  sections: [
    {
      title: 'Headline numbers',
      components: [
        {
          id: 'kpis',
          component: 'Table',
          metrics: [
            money('sum(amount)', 'revenue'),
            count('count(*)', 'gifts'),
            count('count(distinct person_id)', 'donors'),
            money('sum(amount)/count(*)', 'avg_gift'),
            money('sum(case when recurs_id > 0 then amount else 0 end)', 'recurring_revenue'),
            count('sum(case when recurs_id > 0 then 1 else 0 end)', 'recurring_gifts'),
            money(`sum(case when ${UNCODED} then amount else 0 end)`, 'uncoded_revenue'),
            money(`sum(case when ${UNATTRIBUTED} then amount else 0 end)`, 'unattributed_revenue'),
            money('sum(case when amount >= 1000 then amount else 0 end)', 'big_gift_revenue'),
            count('sum(case when amount >= 1000 then 1 else 0 end)', 'big_gifts')
          ]
        }
      ]
    },
    {
      title: 'Revenue by month',
      components: [
        {
          id: 'monthly',
          component: 'Table',
          dimensions: [{ name: 'month_no', eql: 'month(ts)' }],
          metrics: [
            money('sum(case when recurs_id = 0 then amount else 0 end)', 'one_time'),
            money('sum(case when recurs_id > 0 then amount else 0 end)', 'recurring'),
            money('sum(amount)', 'revenue'),
            count('count(*)', 'gifts')
          ]
        }
      ]
    },
    {
      title: 'Revenue by channel and gift size',
      components: [
        {
          id: 'channels',
          component: 'Table',
          dimensions: [{ name: 'channel', eql: 'channel' }],
          metrics: [
            money('sum(amount)', 'revenue'),
            count('count(*)', 'gifts'),
            count('count(distinct person_id)', 'donors'),
            money('sum(amount)/count(*)', 'avg_gift')
          ]
        },
        {
          id: 'sizes',
          component: 'Table',
          dimensions: [
            { name: 'size_order', eql: SIZE_ORDER },
            { name: 'gift_size', eql: SIZE_LABEL }
          ],
          metrics: [count('count(*)', 'gifts'), money('sum(amount)', 'revenue')]
        }
      ]
    },
    {
      title: 'Top sources',
      components: [
        {
          id: 'top_pages',
          component: 'Table',
          query: topBy(
            [{ eql: UNCODED }],
            [
              { eql: "ifnull(nullif(remote_page_name,''),'(no page name)')", name: 'source' },
              { eql: 'sum(amount)', name: 'revenue' },
              { eql: 'count(*)', name: 'gifts' },
              { eql: 'count(distinct person_id)', name: 'donors' },
              { eql: 'sum(amount)/count(*)', name: 'avg_gift' },
              { eql: 'sum(case when recurs_id > 0 then 1 else 0 end)', name: 'recurring_gifts' },
              { eql: 'min(ts)', name: 'first_gift' }
            ],
            [{ eql: "ifnull(nullif(remote_page_name,''),'(no page name)')" }]
          )
        },
        {
          id: 'top_codes',
          component: 'Table',
          query: topBy(
            [{ eql: `not (${UNCODED})` }],
            [
              { eql: 'source_code', name: 'source' },
              { eql: 'max(channel)', name: 'channel' },
              { eql: "ifnull(max(campaign),'')", name: 'campaign' },
              { eql: 'sum(amount)', name: 'revenue' },
              { eql: 'count(*)', name: 'gifts' },
              { eql: 'count(distinct person_id)', name: 'donors' },
              { eql: 'sum(amount)/count(*)', name: 'avg_gift' }
            ],
            [{ eql: 'source_code' }]
          )
        }
      ]
    }
  ]
};
