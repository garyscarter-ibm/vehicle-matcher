import { inputDigest, ok } from '../repository/index.js';
import { modelDisplayImage } from '../vehicle-evidence/display-images.js';

// FUCQ-224: Jordan (identity.demo.principals) starts with no current car, so presenters can walk the new-order route.
const NEW_ORDER_EMPLOYEES = new Set(['employee-jordan']);

// Shown address and licence are derived from the name: unroutable .test mail, and a licence number that cannot validate.
const person = (name) => name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
const emailFor = (name) => { const [first, ...rest] = person(name); return `${[first, rest.at(-1)].filter(Boolean).join('.')}@bmwgroup.test`; };
const licenceFor = (name) => { const [first, ...rest] = person(name).map((part) => part.toUpperCase());
  return `${(rest.at(-1) ?? first).slice(0, 5).padEnd(5, '9')}900000${first[0]}${(rest.at(-1) ?? first)[0]}9XX`; };
const numberFor = (id) => `E${String([...id].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) % 900000, 7) + 100000)}`;

// Explicit backend-only preparation for repeatable trials. Identity's seeded employee
// and entitlement are read first; no URL or client command can choose this profile.
export async function seedManualDemoContext({ repository, identity, clock, context }) {
  const allowed = await identity.requireRole(context, 'employee'); if (allowed.status !== 'ok') return allowed;
  const time = await clock.now(context); if (time.status !== 'ok') return time;
  const now = time.value.now;
  const image = await modelDisplayImage('G21 Touring|320i');
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
      ...(image ? { media: { src: `/${image.asset}`, alt: 'BMW 3 Series Touring: representative image',
        caption: 'Representative image, not your exact car' } } : {}),
      // Synthetic contract record of the car Paula drives now; shown in offer comparisons.
      vehicle: { configuration: '320i M Sport Touring', body: 'estate', fuel: 'petrol', seats: 5, boot: 500,
        mpg: 42.8, zeroTo62: 7.6, points: 1100 },
      actualCollectionDate: '2026-06-01', contractEndDate: '2026-12-01', returnedDate: null,
      annualMileage: 12000, mileageUnit: 'mi/year', months: 6, currentOdometer: { value: 5200, unit: 'mi' },
      earliestCollectionDate: '2026-11-12', latestCollectionDate: '2026-12-01', source };
    const fresh = NEW_ORDER_EMPLOYEES.has(context.employeeId);
    const manualContext = { recordSetId: `manual:${context.employeeId}:v1`, source,
      account: { employeeId: context.employeeId, name: found.value.name, companyId: context.companyId,
        gradeId: context.gradeId, schemeId: context.schemeId, employeeNumber: numberFor(context.employeeId),
        address: { line1: '27 Ashdown Road', town: 'Bracknell', postcode: 'RG12 9ZZ' },
        contact: { phone: '01632 960000', email: found.value.email || emailFor(found.value.name) },
        allowanceOverride: null },
      drivers: [{ driverId, employeeId: context.employeeId, name: found.value.name, kind: 'employee',
        eligible: fact(true), licence: { displayNumber: licenceFor(found.value.name), categories: ['car'],
          validFrom: '2010-01-01', validUntil: '2030-01-01', source } },
      { driverId: `nominated:${context.employeeId}`, employeeId: context.employeeId, name: 'Casey Ward',
        kind: 'nominated', relationship: 'spouse', eligible: fact(true),
        licence: { displayNumber: licenceFor('Casey Ward'), categories: ['car'], validFrom: '2012-01-01', validUntil: '2030-01-01', source } }],
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
