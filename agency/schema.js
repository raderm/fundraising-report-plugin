// The agency's own record for an account: what the agency writes about the
// client's data, never the data itself. Reports read the standard engine9
// tables; these two tables are the only things the Fundraising Report writes.
//
// Third-party table names carry the package stem (fundraising_report_*), and
// the plugin sets no metadata.prefix, so the names are the same on every
// account. agency/sql.js creates them through MCP `sql` when the package is
// not installed on the engine9 host.
//
// No person-level data belongs here: notes are about reports, channels,
// source codes and messages, not about donors.

const AUTHOR_TYPES = ['person', 'agent'];

export const tables = [
  {
    // An executive summary of one report section for one window, written by a
    // person or an agent (e.g. the nightly summaries job).
    name: 'fundraising_report_summary',
    columns: {
      id: 'id_uuid',
      report_path: 'string', // e.g. fundraising-report-plugin/reports:reports:all_donations
      section: 'string', // tab or section key, e.g. transactions, email
      period: 'string', // ytd, qtd, mtd, 30d
      period_start: 'date',
      period_end: 'date', // exclusive
      headline: 'text',
      body: 'text', // Markdown
      figures: 'json', // the numbers the summary cites, as { name: value }
      status: { type: 'string', nullable: false, default_value: 'draft', values: ['draft', 'published', 'archived'] },
      author: 'string', // email for a person, agent name for an agent
      author_type: { type: 'string', nullable: false, default_value: 'person', values: AUTHOR_TYPES },
      created_at: 'created_at',
      modified_at: 'modified_at'
    },
    indexes: [
      { columns: 'id', primary: true },
      { columns: ['report_path', 'section', 'period', 'period_end'] },
      { columns: ['status', 'modified_at'] }
    ]
  },
  {
    // A note pinned to something on a report: a section, a channel, a source
    // code, a message, or the report as a whole.
    name: 'fundraising_report_note',
    columns: {
      id: 'id_uuid',
      report_path: 'string',
      section: 'string',
      subject_type: { type: 'string', nullable: false, default_value: 'report', values: ['report', 'section', 'channel', 'source_code', 'message', 'campaign'] },
      subject_id: 'string', // the channel name, source code, message id or campaign
      period_start: 'date', // optional: the window the note is about
      period_end: 'date',
      body: 'text', // Markdown
      visibility: { type: 'string', nullable: false, default_value: 'agency', values: ['agency', 'client'] },
      status: { type: 'string', nullable: false, default_value: 'open', values: ['open', 'resolved', 'archived'] },
      author: 'string',
      author_type: { type: 'string', nullable: false, default_value: 'person', values: AUTHOR_TYPES },
      created_at: 'created_at',
      modified_at: 'modified_at'
    },
    indexes: [
      { columns: 'id', primary: true },
      { columns: ['report_path', 'section'] },
      { columns: ['subject_type', 'subject_id'] },
      { columns: ['status', 'modified_at'] }
    ]
  }
];

export default { tables };
