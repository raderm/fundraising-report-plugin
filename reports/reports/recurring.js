// Recurring (monthly) donors: every recurring payment in the range
// (recurs_id > 0). Run with the period for the headline numbers, with the
// last 36 days for who is active now, and with the last 24 months for the
// month-by-month chart. New monthly donors are the new_monthly_donors report.
//
// "Run rate" here is the sum of payments in the last 36 days, a close stand-in
// for the dashboard's latest-payment-per-donor (EQL has no window functions).

const m = (name, eql, format = 'number') => ({ name, eql, format });

const payments = () => [
  m('payments', 'count(*)'),
  m('donors', 'count(distinct person_id)'),
  m('revenue', 'sum(amount)', 'currency'),
  m('avg_payment', 'sum(amount)/count(*)', 'currency')
];

export default {
  name: 'Recurring Donors',
  description: 'Recurring payments, active monthly donors and recurring revenue by month.',
  tags: ['Fundraising'],
  data_sources: {
    default: {
      table: 'transaction',
      date_column: 'ts',
      conditions: [{ eql: 'recurs_id > 0 and person_id is not null' }]
    }
  },
  sections: [
    {
      title: 'Recurring payments',
      components: [
        { id: 'kpis', component: 'Table', metrics: payments() },
        { id: 'monthly', component: 'Table', dimensions: [{ name: 'month', eql: 'month(ts)' }], metrics: payments() }
      ]
    }
  ]
};
