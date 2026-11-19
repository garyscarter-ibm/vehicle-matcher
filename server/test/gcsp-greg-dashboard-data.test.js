// Demand copy for Greg screens (FUCQ-101): gate and key labels, and source hygiene. No network, no port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gateInfo, keyLabel, requirementText } from '../../blocks/gcsp/greg/demand-copy.js';

const GREG_DIR = new URL('../../blocks/gcsp/greg/', import.meta.url);

test('gate and key labels cover known codes and keep unknown codes visible', () => {
  assert.deepEqual(gateInfo('essential-unmet:seats'), { code: 'essential-unmet', field: 'seats', label: 'Essential not met: Seats', severity: 'blocker' });
  assert.equal(gateInfo('driver-unconfirmed').severity, 'needs-confirmation');
  assert.equal(gateInfo('stock-not-visible').severity, 'blocker');
  assert.equal(gateInfo('declined-unchanged').severity, 'blocker');
  for (const code of ['availability-expired', 'not-available', 'not-yet-available', 'policy-exclude', 'required-by']) assert.equal(gateInfo(code).severity, 'blocker', code);
  for (const code of ['availability-date-unconfirmed', 'availability-unconfirmed', 'eligibility-unconfirmed', 'employee-essentials-unconfirmed']) assert.equal(gateInfo(code).severity, 'needs-confirmation', code);
  const unknown = gateInfo('something-new:wheel');
  assert.equal(unknown.severity, 'unknown');
  assert.match(unknown.label, /something-new:wheel/);
  assert.equal(keyLabel('suv'), 'SUV');
  assert.equal(keyLabel('unspecified'), 'No preference stated');
  assert.equal(requirementText({ field: 'seats', operator: 'gte', value: 5, unit: 'count' }), 'Seats at least 5');
  assert.equal(requirementText({ field: 'modelLine', operator: 'equals', value: 'G21 Touring', unit: null }), 'Model line is G21 Touring');
});

test('no em dash in any gate label, and no inline-script patterns in the top-level blocks/gcsp/greg modules', async () => {
  const strings = [];
  const collect = (node) => {
    if (typeof node === 'string') strings.push(node);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
  };
  for (const code of ['no-released-stock', 'stock-not-visible', 'declined-unchanged', 'essential-unmet:seats', 'mystery:thing']) collect(gateInfo(code));
  assert.ok(strings.length > 4);
  for (const text of strings) assert.equal(/[—–]/.test(text), false, text);

  const files = (await readdir(GREG_DIR)).filter((n) => n.endsWith('.js'));
  assert.ok(files.length >= 1);
  for (const file of files) {
    const source = await readFile(new URL(file, GREG_DIR), 'utf8');
    assert.equal(/[—–]/.test(source.replace(/\/\/.*$/gm, '')), false, `${file} em dash in code`);
    assert.equal(/\bon[a-z]+\s*=/.test(source), false, `${file} inline handler`);
    assert.equal(/\beval\s*\(/.test(source), false, `${file} eval`);
    assert.equal(/new Function/.test(source), false, `${file} new Function`);
    assert.equal(/set(Timeout|Interval)\s*\(\s*['"`]/.test(source), false, `${file} string timer`);
  }
});
