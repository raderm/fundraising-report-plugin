# Working with the Fundraising Report as an agent

You reach engine9 through the `engine9` MCP server in `.mcp.json`, signed in as the person running you. Everything you do runs with their permissions, so only work in accounts they asked you to work in.

## Running a report

Send the definition from `definitions/` (run `npm run build` first if it's missing):

```json
{ "command": "run", "account_id": "<account>", "definition": <contents of definitions/all_donations.json>,
  "options": { "start": "2026-01-01", "end": "2026-11-26" } }
```

- `start` and `end` are a `[start, end)` window on the report's date column.
- `new_donors` and `new_monthly_donors` take `first_after` / `first_before` instead.
- If the account has the package installed, you can use `"path": "fundraising-report-plugin/reports:reports:<key>"` in place of `definition`.

## Writing a summary or note

Only write to `fundraising_report_summary` and `fundraising_report_note`, and only with SQL built by `agency/sql.js`. Never write SQL by hand with values in it:

```bash
node -e "
import('./agency/sql.js').then(async ({ insertSql }) => {
  const { tables } = await import('./agency/schema.js');
  const summary = tables.find((t) => t.name === 'fundraising_report_summary');
  console.log(insertSql(summary, {
    report_path: 'fundraising-report-plugin/reports:reports:all_donations',
    section: 'transactions', period: 'ytd', period_start: '2026-01-01', period_end: '2026-11-26',
    headline: '…', body: '…', figures: { revenue: 6595140.4 }, status: 'draft', author_type: 'agent',
  }, '<the signed-in person, from the MCP user tool>'));
})"
```

Then send the output with MCP `sql` (`{ "account_id": "<account>", "sql": "<that statement>" }`).

- Set `author_type: 'agent'`. `author` is the person you're working for (from the `user` tool), so the page shows "Written by an agent for …".
- Write summaries as `draft` unless the person asks you to publish. The page shows only `published` summaries.
- Put the numbers you cite in `figures`, so a reader can check them against the report.
- If the tables don't exist, ask before creating them. It's a change to the client's database. When asked, run `createTableSql` for both tables.
- Notes are about reports, channels, source codes and messages. Never put donor names or other person-level data in them.
