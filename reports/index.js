import all_donations from './reports/all_donations.js';
import new_donors, { new_monthly_donors } from './reports/new_donors.js';
import recurring from './reports/recurring.js';
import email from './reports/email.js';
import sms from './reports/sms.js';
import advertising from './reports/advertising.js';

// Plugin path: fundraising-report-plugin/reports. Report paths:
// fundraising-report-plugin/reports:reports:<key>. No metadata.prefix, no
// metadata.version (the package.json version is the only version).
const metadata = {
  name: 'Fundraising Reports',
  unique: true,
  // Installing the reports on a host that loads this package also installs
  // the agency tables.
  include: ['fundraising-report-plugin/agency'],
  dependencies: {
    '@engine9/schemas/transaction/core': '>=1.9.0',
    '@engine9/schemas/message': '>=1.9.0',
    '@engine9/schemas/source_code': '>=1.9.0'
  }
};

export const include = metadata.include;

export const reports = {
  all_donations,
  new_donors,
  new_monthly_donors,
  recurring,
  email,
  sms,
  advertising
};

export { metadata };
export default { metadata, reports };
