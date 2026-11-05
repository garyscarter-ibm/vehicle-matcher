import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateVinCheckDigit, generateVin } from '../gcsp/vehicle-evidence/vin-generator.js';
import { offlineVinCheck } from './helpers/vin-checker.js';

const { fixtures } = JSON.parse(await readFile(new URL('./fixtures/gcsp/vehicle-evidence/five-wmi-reference-configurations.json', import.meta.url)));
const request = (fixture = fixtures[0], extra = {}) => ({ ...fixture, serial: '000001', ...extra });

test('regulatory assigned values independently reproduce sum 411 and remainder 4', () => {
  // Table VI assigned values only; no complete public or observed vehicle identity is retained.
  const values = [1, 7, 4, 1, 8, 5, 9, 8, 0, 5, 7, 1, 1, 8, 3, 4, 1];
  const check = calculateVinCheckDigit(values.join(''));
  assert.deepEqual(check, { sum: 411, remainder: 4, character: '4' });
  assert.equal(offlineVinCheck(values.join('')).total, 411);
});

test('exact digit/letter transliteration and every position weight are independent expectations', () => {
  const letters = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2,
    L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  for (const [char, value] of Object.entries({ ...letters, ...Object.fromEntries('0123456789'.split('').map((n) => [n, Number(n)])) })) {
    assert.equal(calculateVinCheckDigit(char + '0'.repeat(16)).sum, value * 8, char);
  }
  for (const [index, weight] of [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2].entries()) {
    const characters = Array(17).fill('0'); characters[index] = '1';
    assert.equal(calculateVinCheckDigit(characters.join('')).sum, weight);
  }
});

test('invalid length, alphabet, case and deliberately wrong checks fail offline', () => {
  for (const invalid of [null, '', '0'.repeat(16), '0'.repeat(18), 'I' + '0'.repeat(16), 'O' + '0'.repeat(16),
    'Q' + '0'.repeat(16), 'a' + '0'.repeat(16), ' ' + '0'.repeat(16), '-' + '0'.repeat(16)]) {
    assert.throws(() => calculateVinCheckDigit(invalid), TypeError);
    assert.equal(offlineVinCheck(invalid).valid, false);
  }
  const wrong = '0'.repeat(8) + '1' + '0'.repeat(8);
  assert.equal(offlineVinCheck(wrong).valid, false);
});

test('five enabled profiles finalise fictional leading-zero serials before calculating checksum', async () => {
  for (const fixture of fixtures) {
    const result = await generateVin(request(fixture));
    assert.equal(result.status, 'ok');
    assert.match(result.vin17, /^[A-HJ-NPR-Z0-9]{17}$/);
    assert.equal(result.vin17.slice(11), '000001');
    assert.equal(result.vin7, result.vin17.slice(-7));
    assert.equal(result.vin17[9], 'T');
    assert.equal(result.vin17[10], fixture.configuration.plant);
    assert.equal(offlineVinCheck(result.vin17).valid, true);
    assert.equal(result.identityKind, 'synthetic');
    assert.equal(result.profile.profileId, fixture.profileId);
    assert.equal(result.productionDate, null);
    assert.equal(result.registrationDate, null);
    assert.equal(result.completeVinDecoded, false);
    assert.equal(result.sourceKind, 'evidenced-reference');
    assert.ok(result.sources.length);
  }
});

test('independent checker validates all eleven generated checksum outcomes including X', async () => {
  const seen = new Set();
  for (let n = 0; n < 100 && seen.size < 11; n += 1) {
    const result = await generateVin(request(fixtures[0], { serial: `${n}`.padStart(6, '0') }));
    const checked = offlineVinCheck(result.vin17);
    assert.equal(checked.valid, true);
    seen.add(checked.expected);
  }
  assert.deepEqual([...seen].sort(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X']);
});

test('unsupported market/profile/era/plant and serial shapes never produce VINs', async () => {
  for (const extra of [{ usage: 'stock' }, { usage: 'corpus' }, { profileId: 'UK-OBS-001' },
    { referenceOnly: false }, { serial: 'A00001' }, { serial: '1' }, { serial: 1 },
    ...[{ market: 'GB' }, { steering: 'RHD' }, { plant: 'Z' }, { modelYear: 2027 },
      { productionEra: 'historical Europe' }, { productionDate: '2026-04-01' }]
      .map((change) => ({ configuration: { ...fixtures[0].configuration, ...change } }))]) {
    const result = await generateVin(request(fixtures[0], extra));
    assert.notEqual(result.status, 'ok');
    assert.equal(result.vin17, undefined);
  }
  const unavailable = await generateVin(request(), { registry: { resolve: async () => ({ status: 'source-unavailable' }) } });
  assert.equal(unavailable.status, 'source-unavailable');
  assert.equal((await generateVin(request(fixtures[0], { profileVersion: '2' }))).status, 'version-conflict');
});

test('catalogue dates do not become fictional production dates and equivalent letter substitutions can share checksum', async () => {
  const result = await generateVin(request(fixtures[0], { configuration: { ...fixtures[0].configuration,
    effectDate: '2027-01-05', orderDate: '2026-10-01', registrationDate: '2026-10-02' } }));
  assert.equal(result.status, 'ok');
  assert.equal(result.productionDate, null);
  assert.equal(result.registrationDate, null);
  assert.equal(calculateVinCheckDigit('A' + '0'.repeat(16)).character,
    calculateVinCheckDigit('J' + '0'.repeat(16)).character);
});
