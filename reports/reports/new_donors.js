// New donors: people whose first gift on record falls in a window.
//
// This report has no date column on purpose. ReportWorker pushes start/end
// into the innermost query, which would cut first gifts down to the window
// itself (every donor would look new). Instead, the window comes in as the
// `first_after` / `first_before` filters, which apply only to the outer query,
// after each person's first gift has been found across all history.
//
// Run: { first_after: '<window start minus one second>', first_before: '<window end>' }

const report = (name, description, condition) => ({
  name,
  description,
  tags: ['Fundraising'],
  data_sources: {
    default: {
      table: 'first_gift',
      subquery: {
        table: 'transaction',
        columns: [
          { eql: 'transaction.person_id', name: 'person_id' },
          { eql: 'min(transaction.ts)', name: 'first_ts' }
        ],
        conditions: [{ eql: condition }],
        groupBy: [{ eql: 'transaction.person_id' }]
      }
    }
  },
  filters: {
    title: 'Window',
    type: 'object',
    properties: {
      first_after: {
        type: 'string',
        title: 'First gift after',
        description: 'Exclusive lower bound on the first gift, e.g. 2025-12-31 23:59:59',
        filter: { column: 'first_ts', operator: '>' }
      },
      first_before: {
        type: 'string',
        title: 'First gift before',
        description: 'Exclusive upper bound on the first gift, e.g. 2026-11-26',
        filter: { column: 'first_ts', operator: '<' }
      }
    }
  },
  sections: [
    {
      title: 'New donors',
      components: [{ id: 'new_donors', component: 'Table', metrics: [{ name: 'new_donors', eql: 'count(*)', format: 'number' }] }]
    }
  ]
});

export default report(
  'New Donors',
  'People whose first gift on record falls in the window.',
  'transaction.person_id is not null'
);

/** Same, for a donor's first recurring payment: new monthly donors. */
export const new_monthly_donors = report(
  'New Monthly Donors',
  "People whose first recurring payment on record falls in the window.",
  'transaction.person_id is not null and transaction.recurs_id > 0'
);
