import { inputDigest, ok } from '../repository/index.js';

// FUCQ-224: Jordan (identity.demo.principals) starts with no current car, so presenters can walk the new-order route.
const NEW_ORDER_EMPLOYEES = new Set(['employee-jordan']);

// Explicit backend-only preparation for repeatable trials. Identity's seeded employee
// and entitlement are read first; no URL or client command can choose this profile.
export async function seedManualDemoContext({ repository, identity, clock, context }) {
  const allowed = await identity.requireRole(context, 'employee'); if (allowed.status !== 'ok') return allowed;
  const time = await clock.now(context); if (time.status !== 'ok') return time;
  const now = time.value.now;
  return repository.transaction(context, { commandId: `manual:fixture:v1:${context.employeeId}`,
    inputDigest: inputDigest({ fixtureVersion: 'manual-records-v1', employeeId: context.employeeId }) }, async (tx) => {
    const found = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
    if (found.status !== 'ok') return found;
    const slot = await tx.get({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } });
    if (slot.status !== 'ok') return slot;
    const source = { mode: 'synthetic', sourceRef: 'fixture:manual-records-v1', schemaVersion: '1',
      sourceVersion: 'manual-records-v1', effectiveFrom: now, observedAt: now };
    const fact = (value, unit = null) => ({ status: 'known', value, unit, provenance: {
      sourceRef: source.sourceRef, version: source.sourceVersion, observedAt: now, assurance: 'synthetic-scenario' } });
    const driverId = `driver:${context.employeeId}`; const contractId = `current:${context.employeeId}`;
    const contract = { contractId, employeeId: context.employeeId, schemeId: context.schemeId,
      slotId: context.entitlementSlotId, driverId, status: 'current', model: 'BMW 3 Series Touring 320i',
      // Synthetic contract record of the car Paula drives now; shown in offer comparisons.
      vehicle: { configuration: '320i M Sport Touring', body: 'estate', fuel: 'petrol', seats: 5, boot: 500,
        mpg: 42.8, zeroTo62: 7.6, points: 1100 },
      actualCollectionDate: '2026-06-01', contractEndDate: '2026-12-01', returnedDate: null,
      annualMileage: 12000, mileageUnit: 'mi/year', months: 6, currentOdometer: { value: 5200, unit: 'mi' },
      earliestCollectionDate: '2026-11-12', latestCollectionDate: '2026-12-01', source };
    const fresh = NEW_ORDER_EMPLOYEES.has(context.employeeId);
    const manualContext = { recordSetId: `manual:${context.employeeId}:v1`, source,
      account: { employeeId: context.employeeId, name: found.value.name, companyId: context.companyId,
        gradeId: context.gradeId, schemeId: context.schemeId, employeeNumber: `DEMO-${context.employeeId}`,
        address: { line1: '1 Fictional Way', town: 'Example Town', postcode: 'ZZ1 1ZZ' },
        contact: { phone: '01632 960000', email: `${context.employeeId}@example.invalid` },
        allowanceOverride: null },
      drivers: [{ driverId, employeeId: context.employeeId, name: found.value.name, kind: 'employee',
        eligible: fact(true), licence: { displayNumber: 'FICTIONAL-LICENCE', categories: ['car'],
          validFrom: '2010-01-01', validUntil: '2030-01-01', source } },
      { driverId: `nominated:${context.employeeId}`, employeeId: context.employeeId, name: 'Casey (fictional)',
        kind: 'nominated', relationship: 'spouse', eligible: fact(true),
        licence: { displayNumber: 'FICTIONAL-NOMINEE', categories: ['car'], validFrom: '2012-01-01', validUntil: '2030-01-01', source } }],
      employeeFacts: { essentials: {}, charging: fact('home'), requiredBy: fact('2026-12-01T23:59:59.999Z') },
      contracts: fresh ? [] : [contract], histories: [{ schemeId: context.schemeId, entries: fresh ? [] : [contract] },
        { schemeId: 'pcs-ukfs-bmw', entries: fresh ? [] : [{ contractId: `historic:${context.employeeId}`, employeeId: context.employeeId,
          schemeId: 'pcs-ukfs-bmw', status: 'returned', actualCollectionDate: '2025-01-01', returnedDate: '2025-12-01', source }] },
        { schemeId: 'motorcycle-choices', entries: [] }] };
    const updated = await tx.compareAndSwap({ table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } }, found.value.version,
      { contract: { ...found.value.contract, manualContext } });
    if (updated.status !== 'ok') return updated;
    const entitled = await tx.compareAndSwap({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } },
      slot.value.version, { contractId: fresh ? null : contractId, renewalId: `renewal:${context.employeeId}`, state: 'entitled' });
    return entitled.status === 'ok' ? ok({ fixtureVersion: 'manual-records-v1', employeeId: context.employeeId }) : entitled;
  });
}
