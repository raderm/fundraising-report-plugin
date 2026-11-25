import schema from './schema.js';

// Agency summaries and notes about an account's reports. Self-scoped table
// names (fundraising_report_*), so no metadata.prefix.
const metadata = {
  name: 'Fundraising Report: Agency Notes and Summaries',
  unique: true,
  dependencies: {}
};

export { metadata, schema };
export default { metadata, schema };
