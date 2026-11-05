import { createPolicyService } from '../../gcsp/policy/index.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
export const instant = '2026-11-05T12:00:00.000Z';
export const context = { runId: 'run-employee', environmentId: 'demo', employeeId: 'employee-test', roles: ['employee'],
  companyId: 'demo-bmw-fs-uk', schemeId: 'choices-fs-uk', gradeId: 'G7', policyVersion: 'gcsp-policy-v1' };
export const provenance = (assurance = 'synthetic-scenario') => ({ sourceRef: 'fixture:employee', observedAt: instant, version: 'facts-v1', assurance });
export const fact = (value, unit = null, assurance = 'synthetic-scenario') => ({ status: value === null ? 'unknown' : 'known', value, unit,
  provenance: provenance(value === null ? 'unknown' : assurance) });
export const preference = (value, importance = 100) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' });
export const essential = (value, operator = 'gte', unit = 'count') => ({ value, operator, unit, state: 'confirmed', source: 'employee' });
export const brief = () => ({ schemaVersion: 1, briefVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } });
export function stock(id = 1, facts = {}) {
  const orderUuid = `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  return { orderUuid, configurationId: 'RzIxOlMx', availability: { state: 'available', availableFrom: instant, availableUntil: '2027-01-01T00:00:00.000Z', version: 'availability-v1' },
    snapshot: createVehicleSnapshot({ sourceNamespace: 'fixture:employee', identityKind: 'exact-stock', sourceKeys: { stockId: orderUuid },
      snapshotVersion: 'snapshot-v1', observedAt: instant, display: { name: `Synthetic exact car ${id}` }, facts: {
        eligibilityModelKey: fact('G21 Touring|320i'), body: fact('estate'), fuel: fact('petrol'), seats: fact(5, 'count'), boot: fact(500, 'L'),
        zeroTo62: fact(7, 's'), mpg: fact(45, 'mpg-imperial'), sizeClass: fact(3, 'ordinal-1-5'), tags: fact(['cruiser']), ...facts,
      } }) };
}
export const providerValue = (cars = [stock()]) => ({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
  factsVersion: 'employee-facts-v1', stockVersion: 'stock-v1', employeeFacts: { driverEligible: fact(true), essentials: {}, charging: fact('home'), annualMileage: fact(12000, 'mi/year'),
    requiredBy: fact('2026-12-01T00:00:00.000Z') }, stock: cars });
export const provider = (value = providerValue()) => ({ async resolve() { return { status: 'ok', value }; } });
export const time = { async now() { return { status: 'ok', value: { now: instant, runId: context.runId, clockVersion: 'clock-v1' } }; } };
export const policy = () => createPolicyService();
