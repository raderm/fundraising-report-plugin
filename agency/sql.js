// SQL for the agency tables, run through the engine9 MCP `sql` tool as the
// signed-in person. A third-party package can't rely on the engine9 host
// loading it, so the page creates its own tables and writes its own rows.
//
// Rules this file keeps:
//   - It only ever names the tables in ./schema.js (fundraising_report_*).
//   - Every value is checked against its column, then written as a hex
//     literal (CONVERT(X'…' USING utf8mb4)), so no text from a person is ever
//     read as SQL, whatever the server's sql_mode.
//   - id is UUID_v7(), timestamps are the database's own; author is set by
//     the caller from the signed-in person, never from form input.
//
// The column types follow @engine9/core's MySQL dialect, so the tables match
// what engine9 would create if the package were installed on the host.
//
// This file is plain JavaScript with no imports: scripts/build-ui.mjs copies
// it into the page as ui/agency-sql.js.

export const SERVER_COLUMNS = ['id', 'created_at', 'modified_at', 'author'];
const MAX = { string: 255, text: 65535, json: 65535 };

export class AgencyValueError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgencyValueError';
  }
}

const spec = (s) => (typeof s === 'string' ? { type: s } : s || { type: 'string' });
const ident = (name) => {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new AgencyValueError(`Bad identifier ${name}`);
  return '`' + name + '`';
};

function utf8Hex(text) {
  let hex = '';
  for (const b of new TextEncoder().encode(text)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** A string as SQL that can't be anything but that string. */
export function textLiteral(text) {
  return text === '' ? "''" : `CONVERT(X'${utf8Hex(text)}' USING utf8mb4)`;
}

function columnDDL(name, s) {
  const c = spec(s);
  let type;
  switch (c.type) {
    case 'id_uuid': return `${ident(name)} uuid NOT NULL`;
    case 'string': type = `varchar(${c.length || 255})`; break;
    case 'text': type = 'text'; break;
    case 'json': type = 'json'; break;
    case 'date': type = 'date'; break;
    case 'datetime': type = 'datetime'; break;
    case 'boolean': type = 'tinyint(1)'; break;
    case 'int': type = 'int'; break;
    case 'bigint': type = 'bigint'; break;
    case 'foreign_uuid': type = 'uuid'; break;
    case 'created_at': return `${ident(name)} timestamp NOT NULL DEFAULT current_timestamp()`;
    case 'modified_at': return `${ident(name)} timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()`;
    default: throw new AgencyValueError(`No DDL for column type ${c.type}`);
  }
  const notNull = c.nullable === false ? ' NOT NULL' : ' NULL';
  // Defaults come from ./schema.js, never from a person; keep them to plain words.
  if (c.default_value !== undefined && !/^[A-Za-z0-9_ .-]*$/.test(String(c.default_value))) throw new AgencyValueError(`Bad default for ${name}`);
  const def = c.default_value !== undefined ? ` DEFAULT '${c.default_value}'` : '';
  return `${ident(name)} ${type}${notNull}${def}`;
}

/** CREATE TABLE IF NOT EXISTS for one table of the schema. */
export function createTableSql(table) {
  const cols = Object.entries(table.columns).map(([n, s]) => columnDDL(n, s));
  const keys = [];
  for (const ix of table.indexes || []) {
    const columns = [].concat(ix.columns);
    const list = columns.map(ident).join(', ');
    if (ix.primary) keys.push(`PRIMARY KEY (${list})`);
    else keys.push(`${ix.unique ? 'UNIQUE ' : ''}KEY ${ident(`${table.name}_${columns.join('_')}`.slice(0, 64))} (${list})`);
  }
  return `CREATE TABLE IF NOT EXISTS ${ident(table.name)} (\n  ${[...cols, ...keys].join(',\n  ')}\n) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;
}

function valueSql(name, s, value) {
  const c = spec(s);
  if (value === null || value === undefined) {
    if (c.nullable === false) throw new AgencyValueError(`${name} may not be empty`);
    return 'NULL';
  }
  if (Array.isArray(c.values) && !c.values.includes(value)) throw new AgencyValueError(`${name} must be one of ${c.values.join(', ')}`);
  switch (c.type) {
    case 'string':
    case 'text': {
      if (typeof value !== 'string') throw new AgencyValueError(`${name} must be text`);
      const max = c.type === 'text' ? MAX.text : c.length || MAX.string;
      if (value.length > max) throw new AgencyValueError(`${name} is longer than ${max} characters`);
      return textLiteral(value);
    }
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AgencyValueError(`${name} must be a date, YYYY-MM-DD`);
      return `'${value}'`;
    case 'json': {
      if (typeof value !== 'object') throw new AgencyValueError(`${name} must be an object or list`);
      const text = JSON.stringify(value);
      if (text.length > MAX.json) throw new AgencyValueError(`${name} is too large`);
      return textLiteral(text);
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new AgencyValueError(`${name} must be true or false`);
      return value ? '1' : '0';
    case 'int':
    case 'bigint':
      if (!Number.isInteger(value)) throw new AgencyValueError(`${name} must be a whole number`);
      return String(value);
    default:
      throw new AgencyValueError(`${name} can't be written`);
  }
}

function checked(table, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new AgencyValueError('values must be an object');
  const out = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (SERVER_COLUMNS.includes(name)) throw new AgencyValueError(`${name} is set automatically`);
    if (!Object.prototype.hasOwnProperty.call(table.columns, name)) throw new AgencyValueError(`${table.name} has no column ${name}`);
    out.push([name, valueSql(name, table.columns[name], value)]);
  }
  return out;
}

function uuidLiteral(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AgencyValueError('Bad row id');
  return `'${id.toLowerCase()}'`;
}

/** INSERT with id = UUID_v7(); author from the signed-in person. */
export function insertSql(table, values, author) {
  const pairs = checked(table, values);
  if (Object.prototype.hasOwnProperty.call(table.columns, 'author')) pairs.push(['author', valueSql('author', table.columns.author, String(author || ''))]);
  const cols = ['id', ...pairs.map(([n]) => n)].map(ident).join(', ');
  return `INSERT INTO ${ident(table.name)} (${cols}) VALUES (UUID_v7(), ${pairs.map(([, v]) => v).join(', ')})`;
}

/** UPDATE one row by id. */
export function updateSql(table, id, values) {
  const pairs = checked(table, values);
  if (!pairs.length) throw new AgencyValueError('Nothing to change');
  return `UPDATE ${ident(table.name)} SET ${pairs.map(([n, v]) => `${ident(n)} = ${v}`).join(', ')} WHERE ${ident('id')} = ${uuidLiteral(id)}`;
}

/** The row just inserted by this person: newest first, for reading back after INSERT. */
export function latestByAuthorSql(table, author) {
  return `SELECT * FROM ${ident(table.name)} WHERE ${ident('author')} = ${textLiteral(String(author))} ORDER BY ${ident('created_at')} DESC, ${ident('id')} DESC LIMIT 1`;
}
