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

const WIN = { ty: { start: '2026-01-01', end: '2026-11-26' }, ly: { start: '2025-01-01', end: '2025-11-26' } };

test('the acquisition queries are read-only and only take checked dates', () => {
  const built = { ACQ_PERIOD: q.ACQ_PERIOD(WIN.ty, WIN.ly), ACQ_CODES: q.ACQ_CODES(WIN.ty, WIN.ly), ACQ_COST: q.ACQ_COST(WIN.ty, WIN.ly), ACQ_SIGNUPS: q.ACQ_SIGNUPS(WIN.ty, WIN.ly), ACQ_MONTHLY: q.ACQ_MONTHLY, RETENTION: q.RETENTION(WIN.ty, WIN.ly), ACQ_BOUGHT_LISTS: q.ACQ_BOUGHT_LISTS(WIN.ty, WIN.ly), ADS_CODED_GIFTS: q.ADS_CODED_GIFTS(WIN.ty, WIN.ly), REC_KEPT: q.REC_KEPT(WIN.ty, WIN.ly) };
  for (const [name, sql] of Object.entries(built)) {
    assert.match(sql, /^(SELECT|WITH)\b/, name);
    assert.ok(!/;/.test(sql), `${name} has more than one statement`);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE\s+INTO|GRANT)\b/i.test(sql), `${name} writes`);
  }
  assert.match(built.ACQ_PERIOD, /'2026-11-26'/);
});

test('a bad date is refused instead of reaching the database', () => {
  const bad = { start: "2026-01-01' OR 1=1 --", end: '2026-11-26' };
  assert.throws(() => q.ACQ_PERIOD(bad, WIN.ly), /YYYY-MM-DD/);
  assert.throws(() => q.RETENTION(bad, WIN.ly), /YYYY-MM-DD/);
  assert.throws(() => q.ACQ_COST(WIN.ty, { start: '2025-01-01', end: 'x' }), /YYYY-MM-DD/);
});
