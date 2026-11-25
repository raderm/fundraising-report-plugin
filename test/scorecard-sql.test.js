import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as q from '../scorecard/queries.js';

const SELECTS = Object.entries(q).filter(([name]) => /^(SCORECARD|DQ)_/.test(name));

test('the scorecard and data quality queries are read-only single statements', () => {
  assert.ok(SELECTS.length >= 7);
  for (const [name, sql] of SELECTS) {
    assert.match(sql, /^(SELECT|WITH)\b/, name);
    assert.ok(!/;/.test(sql), `${name} has more than one statement`);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE\s+INTO|GRANT)\b/i.test(sql), `${name} writes`);
  }
});

test('they take no input: only the database clock varies', () => {
  for (const [name, sql] of SELECTS) assert.ok(!/\{\{|\$\{|\?/.test(sql), `${name} has a placeholder`);
});

test('the channel rules keep the LIKE escapes the live database ran', () => {
  assert.match(q.CHANNEL_CASE, /sc_n LIKE 'web\\_%'/);
  assert.match(q.CHANNEL_CASE, /REGEXP '\^dm\[0-9\]'/);
});
