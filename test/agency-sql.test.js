import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tables } from '../agency/schema.js';
import { createTableSql, insertSql, updateSql, textLiteral, AgencyValueError } from '../agency/sql.js';

const [summary, note] = tables;
const unhex = (sql) => [...sql.matchAll(/X'([0-9a-f]*)'/g)].map((m) => Buffer.from(m[1], 'hex').toString('utf8'));

test('tables are named for this package and nothing else', () => {
  assert.deepEqual(tables.map((t) => t.name), ['fundraising_report_summary', 'fundraising_report_note']);
});

test('CREATE TABLE uses the MariaDB types engine9 would use', () => {
  const sql = createTableSql(note);
  assert.match(sql, /^CREATE TABLE IF NOT EXISTS `fundraising_report_note` \(/);
  assert.match(sql, /`id` uuid NOT NULL/);
  assert.match(sql, /`body` text NULL/);
  assert.match(sql, /`status` varchar\(255\) NOT NULL DEFAULT 'open'/);
  assert.match(sql, /`modified_at` timestamp NOT NULL DEFAULT current_timestamp\(\) ON UPDATE current_timestamp\(\)/);
  assert.match(sql, /PRIMARY KEY \(`id`\)/);
  assert.match(sql, /KEY `fundraising_report_note_subject_type_subject_id` \(`subject_type`, `subject_id`\)/);
  assert.match(createTableSql(summary), /`figures` json NULL/);
});

test('text is only ever sent as a hex literal', () => {
  const nasty = "O'Brien \\'; DROP TABLE person; -- 🚀";
  const sql = insertSql(note, { body: nasty, report_path: 'r', section: 's' }, 'pat@example.com');
  assert.ok(!sql.includes('DROP'));
  assert.ok(!sql.includes("O'Brien"));
  assert.ok(unhex(sql).includes(nasty));
  assert.equal(textLiteral(''), "''");
});

test('insert sets id and author itself', () => {
  const sql = insertSql(note, { body: 'x' }, 'pat@example.com');
  assert.match(sql, /\(`id`, `body`, `author`\) VALUES \(UUID_v7\(\), /);
  assert.ok(unhex(sql).includes('pat@example.com'));
  for (const col of ['id', 'author', 'created_at', 'modified_at']) {
    assert.throws(() => insertSql(note, { [col]: 'x' }, 'me'), AgencyValueError);
  }
});

test('values are checked against their columns', () => {
  assert.throws(() => insertSql(note, { nope: 1 }, 'me'), /no column nope/);
  assert.throws(() => insertSql(note, { status: 'deleted' }, 'me'), /one of/);
  assert.throws(() => insertSql(note, { period_start: "2026-01-01'; --" }, 'me'), /YYYY-MM-DD/);
  assert.throws(() => insertSql(note, { body: 5 }, 'me'), /text/);
  assert.throws(() => insertSql(note, { section: 'x'.repeat(256) }, 'me'), /longer/);
  assert.throws(() => insertSql(summary, { figures: 'not json' }, 'me'), /object/);
  assert.match(insertSql(summary, { figures: { a: 1 } }, 'me'), /CONVERT\(X'7b2261223a317d' USING utf8mb4\)/);
});

test('update targets one row by a real uuid', () => {
  const id = '01a213bd-1e85-78ac-b668-9bdfb57c96f3';
  assert.equal(updateSql(note, id, { status: 'resolved' }), "UPDATE `fundraising_report_note` SET `status` = CONVERT(X'7265736f6c766564' USING utf8mb4) WHERE `id` = '01a213bd-1e85-78ac-b668-9bdfb57c96f3'");
  assert.throws(() => updateSql(note, "x' OR '1'='1", { status: 'resolved' }), /Bad row id/);
  assert.throws(() => updateSql(note, id, {}), /Nothing to change/);
});
