import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reports, include } from '../reports/index.js';
import { CHANNEL_EQL } from '../reports/helpers.js';

const COMPONENTS = new Set(['StatCard', 'ComposedChart', 'Table']);

test('every report is portable JSON that `report run` accepts', () => {
  for (const [key, def] of Object.entries(reports)) {
    const json = JSON.stringify({ schema_version: 1, ...def });
    assert.deepEqual(JSON.parse(json), { schema_version: 1, ...def }, `${key}: has functions or undefined`);
    assert.ok(json.length < 200_000, `${key}: over the 200KB cap`);
    assert.ok(def.sections.length <= 32, `${key}: over 32 sections`);
    const ids = def.sections.flatMap((s) => s.components.map((c) => c.id));
    assert.equal(new Set(ids).size, ids.length, `${key}: duplicate component ids`);
    assert.ok(ids.length <= 32, `${key}: over 32 components`);
    for (const s of def.sections) for (const c of s.components) assert.ok(COMPONENTS.has(c.component), `${key}/${c.id}`);
  }
});

test('EQL has no syntax the parser rejects', () => {
  for (const [key, def] of Object.entries(reports)) {
    const json = JSON.stringify(def);
    assert.doesNotMatch(json, /regexp/i, `${key}: EQL has no REGEXP`);
    assert.doesNotMatch(json, /\\\\_/, `${key}: EQL has no backslash escapes in LIKE`);
  }
  assert.doesNotMatch(CHANNEL_EQL, /\\/);
});

test('new donors keeps its window out of the inner query', () => {
  const d = reports.new_donors;
  assert.equal(d.data_sources.default.date_column, undefined, 'a date column would be pushed into the subquery');
  assert.equal(d.filters.properties.first_after.filter.column, 'first_ts');
});

test('installing the reports installs the agency tables', () => {
  assert.deepEqual(include, ['fundraising-report-plugin/agency']);
});
