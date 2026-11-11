import { randomUUID } from 'node:crypto';
import { inputDigest, ok, result } from '../repository/index.js';
import { modelBrowseFacts } from '../stock/demo-provider.js';
import { CURRENT_CAR_STATE } from '../lifecycle/current-car/index.js';
import { configurationIdDisplayImage, modelDisplayImage } from '../vehicle-evidence/display-images.js';

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
async function seedGenericManualContext({ repository, identity, clock, context }) {
  const allowed = await identity.requireRole(context, 'employee'); if (allowed.status !== 'ok') return allowed;
  const time = await clock.now(context); if (time.status !== 'ok') return time;
  const now = time.value.now;
  const image = await modelDisplayImage('G21 Touring|320i');
  const previousImage = await modelDisplayImage('F70 Sports Hatch|120');
  return repository.transaction(context, { commandId: `manual:fixture:v1:${context.employeeId}`,
    inputDigest: inputDigest({ fixtureVersion: 'manual-records-v1', employeeId: context.employeeId }) }, async (tx) => {
    const found = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
    if (found.status !== 'ok') return found;
    const slot = await tx.get({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } });
    if (slot.status !== 'ok') return slot;
    const fresh = NEW_ORDER_EMPLOYEES.has(context.employeeId);
    const contractId = `current:${context.employeeId}`;
    const manualContext = manualDemoRecords({ context, employee: found.value, now, image, previousImage });
    const updated = await tx.compareAndSwap({ table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } }, found.value.version,
      { contract: { ...found.value.contract, manualContext } });
    if (updated.status !== 'ok') return updated;
    const entitled = await tx.compareAndSwap({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } },
      slot.value.version, { contractId: fresh ? null : contractId, renewalId: `renewal:${context.employeeId}`, state: 'entitled' });
    return entitled.status === 'ok' ? ok({ fixtureVersion: 'manual-records-v1', employeeId: context.employeeId }) : entitled;
  });
}

function manualDemoRecords({ context, employee, now, image, previousImage }) {
  const source = { mode: 'synthetic', sourceRef: 'fixture:manual-records-v1', schemaVersion: '1',
    sourceVersion: 'manual-records-v1', effectiveFrom: now, observedAt: now };
  const fact = (value, unit = null) => ({ status: 'known', value, unit, provenance: {
    sourceRef: source.sourceRef, version: source.sourceVersion, observedAt: now, assurance: 'synthetic-scenario' } });
  const driverId = `driver:${context.employeeId}`; const contractId = `current:${context.employeeId}`;
  const contract = { contractId, employeeId: context.employeeId, schemeId: context.schemeId,
    slotId: context.entitlementSlotId, driverId, status: 'current', model: 'BMW 3 Series Touring 320i',
    ...(image ? { media: { src: `/${image.asset}`, alt: 'BMW 3 Series Touring' } } : {}),
    // Synthetic contract record of the car Paula drives now; shown in offer comparisons.
    vehicle: { configuration: '320i M Sport Touring', modelLine: 'G21 Touring', eligibilityModelKey: 'G21 Touring|320i', body: 'estate', fuel: 'petrol', seats: 5, boot: 500,
      mpg: 42.8, zeroTo62: 7.6, points: 1100, sizeClass: 2, tags: ['family'] }, // sizeClass, tags: demo-provider.js G21 Touring|320i
    actualCollectionDate: '2026-06-01', contractEndDate: '2026-12-01', returnedDate: null,
    annualMileage: 12000, mileageUnit: 'mi/year', months: 6, currentOdometer: { value: 5200, unit: 'mi' },
    earliestCollectionDate: '2026-11-12', latestCollectionDate: '2026-12-01', source };
  const fresh = NEW_ORDER_EMPLOYEES.has(context.employeeId);
  const manualContext = { recordSetId: `manual:${context.employeeId}:v1`, source,
    account: { employeeId: context.employeeId, name: employee.name, companyId: context.companyId,
      gradeId: context.gradeId, schemeId: context.schemeId, employeeNumber: numberFor(context.employeeId),
      address: { line1: '27 Ashdown Road', town: 'Bracknell', postcode: 'RG12 9ZZ' },
      contact: { phone: '01632 960000', email: employee.email || emailFor(employee.name) },
      allowanceOverride: null },
    drivers: [{ driverId, employeeId: context.employeeId, name: employee.name, kind: 'employee',
      eligible: fact(true), licence: { displayNumber: licenceFor(employee.name), categories: ['car'],
        validFrom: '2010-01-01', validUntil: '2030-01-01', source } },
    { driverId: `nominated:${context.employeeId}`, employeeId: context.employeeId, name: 'Casey Ward',
      kind: 'nominated', relationship: 'spouse', eligible: fact(true),
      licence: { displayNumber: licenceFor('Casey Ward'), categories: ['car'], validFrom: '2012-01-01', validUntil: '2030-01-01', source } }],
    employeeFacts: { essentials: {}, charging: fact('home'), requiredBy: fact('2026-12-01T23:59:59.999Z') },
    contracts: fresh ? [] : [contract], histories: [{ schemeId: context.schemeId, entries: fresh ? [] : [contract] },
      { schemeId: 'pcs-ukfs-bmw', entries: fresh ? [] : [{ contractId: `historic:${context.employeeId}`, employeeId: context.employeeId,
        schemeId: 'pcs-ukfs-bmw', status: 'returned', model: 'BMW 1 Series Sports Hatch 120',
        ...(previousImage ? { media: { src: `/${previousImage.asset}`, alt: 'BMW 1 Series Sports Hatch' } } : {}),
        vehicle: { configuration: '120 M Sport', body: 'hatchback', fuel: 'petrol' },
        actualCollectionDate: '2025-01-01', returnedDate: '2025-12-01', source }] },
      { schemeId: 'motorcycle-choices', entries: [] }] };
  return manualContext;
}

// Versioned corrections apply only to untouched synthetic preparation. Real source
// edits and frozen order/lifecycle decisions are never overwritten by a demo seed.
async function applyDemoProfile({ repository, identity, clock, policy, context }) {
  if (!policy) return ok({ updated: false });
  const allowed = await identity.requireRole(context, 'employee'); if (allowed.status !== 'ok') return allowed;
  const time = await clock.now(context); if (time.status !== 'ok') return time;
  const read = { runId: context.runId, policyVersion: context.policyVersion, asOf: time.value.now };
  const configured = await policy.getAssumption('employee.demoProfiles.v1', read);
  if (configured.status === 'not-found' || configured.code === 'unknown-assumption') return ok({ updated: false });
  if (configured.status !== 'ok') return configured;
  const profile = configured.value.value?.profiles?.[context.employeeId];
  if (!profile) return ok({ updated: false });
  const key = profile.current?.vehicle?.eligibilityModelKey;
  const facts = modelBrowseFacts(key);
  const [image, previousImage, legacyImage, legacyPrevious, points] = await Promise.all([
    configurationIdDisplayImage(profile.current?.vehicle?.configurationId, key),
    modelDisplayImage(profile.previous?.imageKey), modelDisplayImage('G21 Touring|320i'),
    modelDisplayImage('F70 Sports Hatch|120'), policy.getPointsCost(context, { eligibilityModelKey: key }, read),
  ]);
  if (!facts || !image || !previousImage || points.status !== 'ok' || !profile.profileVersion)
    return result('unavailable', { reason: 'Employee profile preparation is unavailable.', retryable: true });
  return repository.transaction(context, { commandId: `manual:profile:${profile.profileVersion}:${context.employeeId}`,
    inputDigest: inputDigest(profile) }, async (tx) => {
    const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
    const found = await tx.get(ref); if (found.status !== 'ok') return found;
    const manual = found.value.contract?.manualContext;
    if (!manual || manual.source?.sourceVersion !== 'manual-records-v1') return ok({ updated: false, reason: 'source-preserved' });
    const expected = manualDemoRecords({ context, employee: found.value, now: manual.source.observedAt,
      image: legacyImage, previousImage: legacyPrevious });
    if (inputDigest(manual) !== inputDigest(expected)) return ok({ updated: false, reason: 'source-edits-preserved' });
    const slot = await tx.get({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } });
    if (slot.status !== 'ok') return slot;
    if (slot.value.employeeId !== context.employeeId || slot.value.state !== 'entitled'
      || slot.value.contractId !== `current:${context.employeeId}`) return ok({ updated: false, reason: 'lifecycle-preserved' });
    // Even completed order operations can be the source for a current-car return.
    for (const table of ['holds', 'claims', 'offers', 'quotes', 'renewal_cases']) {
      const rows = await tx.list(table, { employeeId: context.employeeId }); if (rows.status !== 'ok') return rows;
      if (rows.value.length) return ok({ updated: false, reason: 'order-history-preserved' });
    }
    const operations = await tx.list('pending_operations', { operationType: 'selection-order' });
    if (operations.status !== 'ok') return operations;
    const relationships = await tx.list('event_receipts', { consumerId: CURRENT_CAR_STATE });
    if (relationships.status !== 'ok') return relationships;
    if (operations.value.some((row) => row.payload?.context?.employeeId === context.employeeId)
      || relationships.value.some((row) => row.outcome?.value?.employeeId === context.employeeId))
      return ok({ updated: false, reason: 'lifecycle-preserved' });
    const next = structuredClone(manual);
    const source = { ...manual.source, sourceRef: `fixture:${profile.profileVersion}`, sourceVersion: profile.profileVersion,
      effectiveFrom: time.value.now, observedAt: time.value.now };
    next.employeeFacts.requiredBy = { ...next.employeeFacts.requiredBy, value: `${profile.current.contractEndDate}T23:59:59.999Z` };
    for (const fact of Object.values(next.employeeFacts)) if (fact.provenance) fact.provenance = {
      ...fact.provenance, sourceRef: source.sourceRef, version: source.sourceVersion, observedAt: source.observedAt };
    next.source = source; next.recordSetId = `manual:${context.employeeId}:${profile.profileVersion}`;
    next.account.address = structuredClone(profile.address); next.account.contact.phone = profile.phone;
    const nominee = next.drivers.find((driver) => driver.kind === 'nominated');
    Object.assign(nominee, profile.nominatedDriver);
    nominee.licence.displayNumber = licenceFor(nominee.name);
    for (const driver of next.drivers) { driver.licence.source = source; driver.eligible.provenance = {
      ...driver.eligible.provenance, sourceRef: source.sourceRef, version: source.sourceVersion, observedAt: source.observedAt }; }
    const vehicle = { ...Object.fromEntries(Object.entries(facts).map(([name, fact]) => [name, fact.value])),
      ...profile.current.vehicle, points: points.value.monthlyPoints };
    const current = { ...next.contracts[0], ...profile.current, vehicle, source,
      media: { src: `/${image.asset}`, alt: profile.current.model } };
    next.contracts = [current];
    next.histories.find((history) => history.schemeId === context.schemeId).entries = [current];
    const { imageKey, ...previous } = profile.previous;
    const history = next.histories.find((row) => row.schemeId === 'pcs-ukfs-bmw');
    history.entries = [{ ...history.entries[0], ...previous, source,
      media: { src: `/${previousImage.asset}`, alt: previous.model } }];
    const updated = await tx.compareAndSwap(ref, found.value.version, { contract: { ...found.value.contract, manualContext: next } });
    return updated.status === 'ok' ? ok({ updated: true, profileVersion: profile.profileVersion }) : updated;
  });
}

export async function seedManualDemoContext(input) {
  const seeded = await seedGenericManualContext(input);
  if (seeded.status !== 'ok') return seeded;
  const applied = await applyDemoProfile(input);
  return applied.status === 'ok' ? seeded : applied;
}

// Existing browser sessions need the correction at startup, before their next read.
// Fresh records still use the normal login/scenario preparation boundary.
export async function adoptRetainedDemoProfiles({ repository, identity, clock, policy }) {
  const presenter = await identity.createPresenterSession(`manual-profile-adoption:${randomUUID()}`);
  if (presenter.status !== 'ok') return presenter;
  const rows = await repository.query(presenter.value.context, 'employees'); if (rows.status !== 'ok') return rows;
  for (const employee of rows.value.filter((row) => row.roles.includes('employee') && row.contract?.manualContext)) {
    const resolved = await identity.resolveEmployeeContext(presenter.value.context, employee.employeeId);
    if (resolved.status !== 'ok') return resolved;
    const applied = await applyDemoProfile({ repository, identity, clock, policy, context: resolved.value });
    if (applied.status !== 'ok') return applied;
  }
  return ok({});
}
