// Prints a report as portable JSON, for MCP `report run` with `definition`.
//   node reports/fundraising/test/print-definition.mjs all_donations
import { reports } from '../reports/index.js';
const key = process.argv[2] || 'all_donations';
console.log(JSON.stringify({ schema_version: 1, ...reports[key] }));
