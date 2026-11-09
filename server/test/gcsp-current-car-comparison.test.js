import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentCarComparison } from '../gcsp/offers/current-car-comparison.js';

function input() {
  const context = { runId: 'run-one', employeeId: 'employee-one', entitlementSlotId: 'slot-one',
    companyId: 'company-one', schemeId: 'scheme-one' };
  const source = { mode: 'synthetic', sourceRef: 'fixture:current-contract', sourceVersion: 'v1',
    schemaVersion: '1', effectiveFrom: '2026-11-05T09:00:00.000Z', observedAt: '2026-11-05T09:00:00.000Z' };
  const contract = { contractId: 'current-one', employeeId: context.employeeId, slotId: context.entitlementSlotId,
    schemeId: context.schemeId, status: 'current', model: 'BMW 3 Series Touring 320i', source };
  return { context, now: '2026-11-05T12:00:00.000Z', employee: { ...context, version: 2,
    contract: { manualContext: { source, contracts: [contract] } } },
  slot: { runId: context.runId, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
    contractId: contract.contractId, version: 3 } };
}

test('current contract yields only truthful model/provenance and explicit unknown comparisons', () => {
  const x = input(); const pin = createCurrentCarComparison(x);
  assert.equal(pin.schemaVersion, '1'); assert.equal(pin.comparisonAvailable, false);
  assert.equal(pin.display.state, 'partial'); assert.equal(pin.display.model, 'BMW 3 Series Touring 320i');
  assert.deepEqual(pin.display.source, { mode: 'synthetic', sourceVersion: 'v1', observedAt: x.now.replace('12:', '09:') });
  assert.deepEqual(pin.display.unknowns, ['configuration', 'body', 'fuel', 'seats', 'boot', 'mpg', 'zeroTo62', 'points']);
  assert.equal(pin.binding.contractId, x.slot.contractId); assert.equal(pin.binding.employeeVersion, 2); assert.equal(pin.binding.slotVersion, 3);
  assert.equal(Object.hasOwn(pin.display, 'contractId'), false); assert.equal(Object.hasOwn(pin.display, 'employeeVersion'), false);
  assert.equal(Object.hasOwn(pin.display.source, 'sourceRef'), false);
});

test('allowlist excludes raw employee/contract/contact/licence and guessed specifications', () => {
  const x = input(); const secret = 'excluded-sensitive-source-data';
  const stored = x.employee.contract.manualContext;
  stored.account = { address: secret, contact: secret }; stored.drivers = [{ licence: secret }];
  Object.assign(stored.contracts[0], { address: secret, contact: secret, licence: secret, vin: secret,
    configurationId: secret, facts: { seats: 5 }, points: 500, extra: secret });
  stored.source.extra = secret;
  const pin = createCurrentCarComparison(x);
  assert.equal(pin.display.state, 'partial'); assert.equal(JSON.stringify(pin).includes(secret), false);
  assert.equal(Object.hasOwn(pin, 'facts'), false); assert.equal(Object.hasOwn(pin, 'points'), false);
});

test('snapshot copies and freezes its metadata instead of retaining a mutable source object', () => {
  const x = input(); const before = structuredClone(x); const pin = createCurrentCarComparison(x);
  assert.deepEqual(x, before);
  x.employee.contract.manualContext.contracts[0].model = 'Changed';
  x.employee.contract.manualContext.source.sourceVersion = 'changed';
  x.employee.version = 99;
  assert.equal(pin.display.model, 'BMW 3 Series Touring 320i'); assert.equal(pin.binding.source.sourceVersion, 'v1');
  assert.equal(pin.binding.employeeVersion, 2);
  assert.throws(() => { pin.display.model = 'Overwritten'; }, TypeError);
  assert.throws(() => pin.display.unknowns.push('invented'), TypeError);
});

test('recorded current-contract facts are copied, giving an available comparison', () => {
  const x = input(); x.employee.contract.manualContext.contracts[0].vehicle = { configuration: '320i M Sport Touring', body: 'estate',
    fuel: 'petrol', seats: 5, boot: 500, mpg: 42.8, zeroTo62: 7.6, points: 1100 };
  const pin = createCurrentCarComparison(x);
  assert.equal(pin.comparisonAvailable, true); assert.equal(pin.display.state, 'available'); assert.deepEqual(pin.display.unknowns, []);
  assert.deepEqual(pin.display.facts.boot, { value: 500, unit: 'L' }); assert.equal(pin.display.facts.configuration.value, '320i M Sport Touring');
});

test('invalid recorded facts are dropped to unknown and a valid subset gives a partial comparison', () => {
  const x = input(); x.employee.contract.manualContext.contracts[0].vehicle = { configuration: ' ', body: { x: 1 }, fuel: 'petrol',
    seats: '5', boot: -1, mpg: NaN, zeroTo62: Infinity, points: 1100, extra: 'secret-extra' };
  const pin = createCurrentCarComparison(x);
  assert.equal(pin.comparisonAvailable, true); assert.equal(pin.display.state, 'partial');
  assert.deepEqual(Object.keys(pin.display.facts), ['fuel', 'points']);
  assert.deepEqual(pin.display.unknowns, ['configuration', 'body', 'seats', 'boot', 'mpg', 'zeroTo62']);
  assert.equal(JSON.stringify(pin).includes('secret-extra'), false);
  x.employee.contract.manualContext.contracts[0].vehicle = { body: 'x'.repeat(257), seats: 0 };
  const none = createCurrentCarComparison(x);
  assert.equal(none.comparisonAvailable, false); assert.equal(Object.hasOwn(none.display, 'facts'), false); assert.equal(none.display.unknowns.length, 8);
});

const invalidations = {
  missing: (x) => { delete x.employee.contract; },
  duplicate: (x) => x.employee.contract.manualContext.contracts.push(structuredClone(x.employee.contract.manualContext.contracts[0])),
  employee: (x) => { x.employee.contract.manualContext.contracts[0].employeeId = 'other'; },
  slot: (x) => { x.employee.contract.manualContext.contracts[0].slotId = 'other'; },
  scheme: (x) => { x.employee.contract.manualContext.contracts[0].schemeId = 'other'; },
  contract: (x) => { x.slot.contractId = 'other'; },
  returned: (x) => { x.employee.contract.manualContext.contracts[0].status = 'returned'; },
  model: (x) => { x.employee.contract.manualContext.contracts[0].model = ' '; },
  run: (x) => { x.slot.runId = 'other'; },
  authority: (x) => { x.employee.companyId = 'other'; },
  revision: (x) => { x.employee.version = null; },
  source: (x) => { x.employee.contract.manualContext.contracts[0].source = null; },
  future: (x) => { x.employee.contract.manualContext.source.effectiveFrom = '2026-11-06T00:00:00.000Z'; },
  futureObservation: (x) => { x.employee.contract.manualContext.source.observedAt = '2026-11-06T00:00:00.000Z'; },
  malformedDate: (x) => { x.employee.contract.manualContext.source.observedAt = 'not-a-date'; },
  unsupportedSource: (x) => { x.employee.contract.manualContext.source.mode = 'unverified'; },
};
for (const [name, change] of Object.entries(invalidations)) {
  test(`${name} current-contract input yields unavailable comparison without exposing another source`, () => {
    const x = input(); change(x); const pin = createCurrentCarComparison(x);
    assert.equal(pin.comparisonAvailable, false); assert.equal(pin.display.state, 'unavailable');
    assert.equal(pin.display.model, null); assert.equal(pin.display.source, null);
    assert.equal(pin.binding.contractId, null); assert.equal(pin.binding.source, null);
  });
}
