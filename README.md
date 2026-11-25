# Fundraising Report plugin for engine9

A third-party engine9 plugin, built the way any outside developer would build one: it lives in its own repository, talks to engine9 only through the public MCP server, and does everything with the permissions of whoever is signed in. Nothing here is part of engine9 itself.

It has three parts:

| Part | What it is | Where |
|---|---|---|
| Reports | Seven EQL report definitions over the standard engine9 tables (`transaction`, `source_code_dictionary`, `global_message`, …), plus the read-only SQL for the Scorecard and Data Quality tabs. Nothing is written. | `reports/`, `scorecard/`, built to `definitions/*.json` |
| Agency notes | Two tables the plugin owns, `fundraising_report_summary` and `fundraising_report_note`, for executive summaries and team notes. The only thing the plugin writes. | `agency/schema.js`, `agency/sql.js` |
| Page | A static page with no server of its own. It signs in to engine9, runs the reports and reads and writes notes, all through MCP. | `ui/` |

## How it uses your permissions

The page and agents call the engine9 MCP server (`https://data.engine9.ai/mcp`) as you, after you sign in with your engine9 (Delegate) login:

- **`report run`** with a portable `definition` from `definitions/` (or by `path`, if the plugin is installed on the account; see below).
- **`sql`** to read and write the two `fundraising_report_*` tables (and once per account, to create them), and to run the read-only SELECTs behind the Scorecard and Data Quality tabs (`scorecard/queries.js`).
- **`user`** to get your email, which is recorded as the author of anything you write.

So you see exactly the accounts your engine9 login can open, and a note can only be saved where your login can write to the account database (today, account admins and superadmins). The plugin holds no keys and stores nothing outside the account's own database.

Every value written goes through `agency/sql.js`. It checks the value against its column, then sends text only as a hex literal (`CONVERT(X'…' USING utf8mb4)`), so what someone types can't be read as SQL. Only the two plugin tables are ever named. Update and archive change one row by its id.

## Run it on your machine

You need Node 20 or later.

```bash
git clone https://github.com/raderm/fundraising-report-plugin.git
cd fundraising-report-plugin
npm run build      # makes ui/definitions.js, ui/agency-sql.js and definitions/*.json
npm start          # serves ui/ at http://localhost:3000
```

Open http://localhost:3000, click **Connect to engine9**, sign in and pick an account. `localhost:3000` is already allowed by engine9's login, so there's no setup on the engine9 side.

The first time you open an account, the notes panel shows **Set up notes on this account**. Clicking it creates the two tables in that account's database (`CREATE TABLE IF NOT EXISTS`, nothing else). The reports work without it.

To point the page at a different engine9 server, edit `ui/config.js`.

## Use it from Claude Code

`.mcp.json` adds the engine9 MCP server to Claude Code for this folder. Run `/mcp` in Claude Code and sign in with your engine9 login. After that, agents in this repo work with your permissions. `AGENTS.md` says how they run the reports and write summaries.

## Install it on an account (optional)

Running reports by definition needs nothing installed. Installing the package on an account lets the reports run by path, so they show up in engine9's report list. engine9 only loads plugin packages its operator has allowed, so this needs one change on the engine9 host:

1. Publish this package (or make it installable from git), then add `fundraising-report-plugin` to `engine9.pluginPackages` on the host and redeploy.
2. Install it on an account: MCP `plugin` with `{ "command": "install", "path": "fundraising-report-plugin/reports" }`. That also installs `fundraising-report-plugin/agency`, which creates the same two tables.

The tables are the same either way, so an account set up from the page keeps its notes if the package is installed later.

## Tests

```bash
npm test        # report definitions and the SQL builder
npm run e2e     # the page in Chrome against a stand-in engine9 (needs Playwright)
```

The end-to-end test runs the SQL the page sends in an in-memory SQLite database, so table setup, inserts, updates and the escaping are really run.

## What's in each report

| Path | Tab |
|---|---|
| `fundraising-report-plugin/reports:reports:all_donations` | All Donations |
| `…:new_donors`, `…:new_monthly_donors` | New donor counts (first gift in the window) |
| `…:email` | Email |
| `…:sms` | SMS |
| `…:advertising` | Advertising |
| `scorecard/queries.js` (SQL, not a report definition) | Scorecard, Acquisition, Data Quality |
| `…:recurring` | The Recurring donors section of All Donations |

The Scorecard (year-end projection by channel) and Data Quality (coding gaps, year to date) tabs run as plain read-only SQL through `sql`, because they need REGEXP, window functions and per-year comparisons that EQL reports can't express. Data Quality is computed live; the original dashboard rebuilt it weekly from a snapshot.

Acquisition (new donors by first-gift channel) and the Scorecard cost, new-donor and list-growth figures use the same read-only SQL. The new-donor queries scan every gift, so the first load can take 15 to 40 seconds on a large account; results are cached for the session.

Donor retention is a section of All Donations (one read-only query comparing each donor across this period, the same dates last year and the year before).
