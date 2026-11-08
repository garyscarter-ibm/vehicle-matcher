import { createMemoryRepository, createMemoryStore } from '../repository/memory.js';
import { inputDigest, ok, FOUNDATION_TABLES } from '../repository/core.js';
import { DemoIdentityAdapter } from '../identity/index.js';
import { DemoClock } from '../clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../manual-context/index.js';
import { createManualClaimsService } from '../manual-claims/index.js';
import { createSyntheticManualStockAdapter } from '../adapters/manual-stock.js';
import { createBriefService } from '../brief/index.js';
import { createBuddyHoldService } from '../offers/buddy-hold.js';
import { createAllocationService } from '../allocation/index.js';
import { createOfferAccessService } from '../offers/access.js';
import { createOfferDecisionService } from '../offers/decision.js';
import { verifyOfferToken, resolveOfferLandingUrl } from '../offers/offer-token.js';
import { createStoredSubjectRecommendationEvaluator } from '../recommendation/index.js';
import { getReviewedDefinitionSet } from '../policy/reviewed-definitions.js';
import { CapturedTransport } from '../notify/captured.js';
import { NotificationDispatcher } from '../notify/index.js';
import { createVehicleSnapshot, freezeVehicleData } from '../../vehicles/index.js';
import { validInstant } from '../policy/file-provider.js';

export class ComparisonRunError extends Error {
  constructor(code, boundary) {
    super(`Comparison run ${code}: ${boundary}.`);
    this.name = 'ComparisonRunError'; this.code = code; this.boundary = boundary;
  }
}
const check = (condition, boundary) => {
  if (!condition) throw new ComparisonRunError('invalid-input', boundary);
};
const value = (outcome, boundary) => {
  if (outcome?.status !== 'ok') throw new ComparisonRunError(outcome?.status ?? 'unavailable', boundary);
  return outcome.value;
};
const command = (commandId, input) => ({ commandId, inputDigest: inputDigest(input) });
const ref = (scope, table, key = {}) => ({ table, key: { runId: scope.runId, ...key } });
const principalId = (id) => `comparison:${id}`;
const slotId = (id) => `comparison-slot:${id}`;
const renewalId = (id) => `comparison-renewal:${id}`;
const contractId = (id) => `comparison-current:${id}`;
const driverId = (id) => `comparison-driver:${id}`;

export async function comparisonAssumption(policy, key, read) {
  const result = await policy.getAssumption(key, read);
  const row = value(result, key);
  check(result.policyVersion === read.policyVersion && row.policyVersion === read.policyVersion, key);
  return row;
}
function typedFact(raw, row, now) {
  check(raw && ['known', 'unknown'].includes(raw.status) && (raw.value === null) === (raw.status === 'unknown')
    && (raw.unit === null || typeof raw.unit === 'string'), row.key);
  return { status: raw.status, value: structuredClone(raw.value), unit: raw.unit,
    provenance: { sourceRef: row.source, version: `${row.policyVersion}:${row.key}`, observedAt: now,
      assurance: raw.status === 'unknown' ? 'unknown' : 'synthetic-scenario' } };
}
function underlyingEssentials(employee) {
  return Object.fromEntries(Object.entries(employee.underlyingNeeds.essentials).map(([key, requirement]) => [key,
    { ...structuredClone(requirement), state: 'confirmed', source: 'synthetic-underlying-needs' }]));
}
const HOLD_KEY = 'hold.buddy.durationSeconds';
const DECLINE_REASONS_KEY = 'offer.declineReasons.v1';
// Keys the buddy services read that a run resolves itself; nothing here is published or written to policy.
function buddyOverrides(manifest, adapterRow) {
  const hold = manifest.assumptions.find((row) => row.key === HOLD_KEY);
  const reasons = getReviewedDefinitionSet('offer-decline-reasons-v1')?.definitions.find((row) => row.key === DECLINE_REASONS_KEY);
  check(hold && reasons, 'buddy-overrides');
  return { [HOLD_KEY]: (row) => (hold.overlay === true ? { ...row, value: structuredClone(hold.value), overlay: true,
    baselineValue: structuredClone(hold.baselineValue) } : row),
  [DECLINE_REASONS_KEY]: (row, read) => row ?? { ...structuredClone(reasons), policyVersion: read.policyVersion,
    effectiveFrom: adapterRow.effectiveFrom } };
}
function isolatedIdentityPolicy(policy, template, employees, overrides = {}) {
  const presenter = template.value.filter((person) => person.roles?.includes('presenter'));
  check(presenter.length === 1, 'identity.demo.principals');
  const principals = [...structuredClone(presenter), ...employees.map((employee) => ({
    principalId: principalId(employee.employeeId), employeeId: employee.employeeId,
    entitlementSlotId: slotId(employee.employeeId), name: `${employee.employeeId} (fictional)`, roles: ['employee'],
    companyId: employee.companyId, schemeId: employee.schemeId, gradeId: employee.gradeId,
  }))];
  // Principal rows are run inputs; every business-policy read still reaches the supplied PolicyService.
  return { getActiveVersion: policy.getActiveVersion.bind(policy), getAllowance: policy.getAllowance.bind(policy),
    getEligibility: policy.getEligibility.bind(policy), getPointsCost: policy.getPointsCost.bind(policy),
    async getAssumption(key, read) {
      const result = await policy.getAssumption(key, read);
      if (key === 'identity.demo.principals' && result.status === 'ok') {
        return { ...result, value: { ...result.value, value: structuredClone(principals) } };
      }
      const override = overrides[key];
      if (!override) return result;
      if (result.status === 'ok') return { ...result, value: override(result.value, read) };
      // Only an absent key is supplied from the reviewed set, at the run's own pinned version.
      return result.code === 'unknown-assumption' && read?.policyVersion === result.policyVersion
        ? { ...result, status: 'ok', value: override(null, read) } : result;
    } };
}
// Employee facts shared by the manual records and the per-seed evaluation.
export function comparisonEmployeeFacts(employee, adapterRow, now) {
  return { ...Object.fromEntries(Object.entries(adapterRow.value.employeeFacts).map(([key, raw]) => [key, typedFact(raw, adapterRow, now)])),
    essentials: underlyingEssentials(employee), requiredBy: typedFact({ status: 'known', value: employee.renewalAt, unit: null }, adapterRow, now) };
}
export const comparisonDriverFact = (adapterRow, now) => typedFact(adapterRow.value.driver.eligible, adapterRow, now);
function manualRecords(employee, adapterRow, now) {
  const adapter = adapterRow.value;
  const id = employee.employeeId;
  const source = { mode: 'synthetic', sourceRef: adapterRow.source, schemaVersion: '1',
    sourceVersion: `${adapterRow.policyVersion}:${adapter.fixtureVersion}`, effectiveFrom: now, observedAt: now };
  const licence = { ...structuredClone(adapter.driver.licence), source };
  const contract = { contractId: contractId(id), employeeId: id, schemeId: employee.schemeId,
    slotId: slotId(id), driverId: driverId(id), status: 'current',
    contractEndDate: employee.renewalAt.slice(0, 10), earliestCollectionDate: now.slice(0, 10),
    latestCollectionDate: employee.renewalAt.slice(0, 10), source };
  return { recordSetId: `comparison:${id}:${adapter.fixtureVersion}`, source,
    account: { employeeId: id, name: `${id} (fictional)`, companyId: employee.companyId,
      gradeId: employee.gradeId, schemeId: employee.schemeId, allowanceOverride: null },
    drivers: [{ driverId: driverId(id), employeeId: id, name: `${id} (fictional)`, kind: adapter.driver.kind,
      eligible: typedFact(adapter.driver.eligible, adapterRow, now), licence }],
    employeeFacts: comparisonEmployeeFacts(employee, adapterRow, now),
    contracts: [contract], histories: [{ schemeId: employee.schemeId, entries: [contract] }] };
}
export function comparisonStockRows(inputs, adapterRow) {
  const { manifest, stock, releaseSchedule, employees } = inputs;
  const adapter = adapterRow.value;
  check(stock.length < 10000000 && Number.isSafeInteger(adapter.stockAvailabilityDaysAfterHorizon)
    && adapter.stockAvailabilityDaysAfterHorizon > 0, 'comparison.recordAdapter.v1');
  const until = new Date(Date.parse(manifest.startsAt) + (manifest.horizonDays + adapter.stockAvailabilityDaysAfterHorizon) * 86400000).toISOString();
  return stock.map((car, index) => {
    const releases = releaseSchedule.filter((release) => release.orderUuids.includes(car.orderUuid));
    check(releases.length === 1 && validInstant(releases[0].at), 'releaseSchedule');
    const raw = adapter.stockFactsByModelLine[car.modelLine] ?? {};
    const facts = Object.fromEntries(Object.entries(raw).map(([key, fact]) => [key, typedFact(fact, adapterRow, manifest.startsAt)]));
    facts.eligibilityModelKey = typedFact({ status: 'known', value: car.eligibilityModelKey, unit: null }, adapterRow, manifest.startsAt);
    facts.modelLine = typedFact({ status: 'known', value: car.modelLine, unit: null }, adapterRow, manifest.startsAt);
    const snapshot = createVehicleSnapshot({ sourceNamespace: 'comparison-synthetic', identityKind: 'exact-stock',
      sourceKeys: { stockId: car.orderUuid }, snapshotVersion: `${car.snapshotVersion}:${adapter.fixtureVersion}`,
      observedAt: manifest.startsAt, display: { name: `${car.configuration.model} (synthetic)` }, facts });
    return { orderUuid: car.orderUuid, orderNumber: String(index + 1).padStart(7, '0'), configurationId: car.configurationId,
      state: 'unreleased', available: false, held: false, allocated: false, facts: snapshot,
      visibility: { companyIds: [...new Set(employees.map((e) => e.companyId))],
        schemeIds: [...new Set(employees.map((e) => e.schemeId))], employeeIds: null },
      release: { releaseId: releases[0].releaseId, at: releases[0].at,
        availability: { state: 'available', availableFrom: releases[0].at, availableUntil: until,
          version: `comparison:${manifest.inputHash}:${releases[0].releaseId}` } } };
  });
}

export async function openComparisonRun(options = {}) {
  check(Object.keys(options).every((key) => ['inputs', 'policy', 'route', 'codeRevision', 'evaluation'].includes(key)), 'options');
  const { inputs, policy, route, codeRevision, evaluation } = options;
  check(inputs?.manifest && Array.isArray(inputs.employees) && Array.isArray(inputs.stock)
    && Array.isArray(inputs.releaseSchedule) && typeof route === 'string' && route.length > 0
    && typeof codeRevision === 'string' && codeRevision.length > 0, 'inputs');
  const { manifest, employees } = inputs;
  check(validInstant(manifest.startsAt) && typeof manifest.policyVersion === 'string'
    && manifest.inputHash === inputDigest({ employees, stock: inputs.stock, releaseSchedule: inputs.releaseSchedule })
    && new Set(employees.map((employee) => employee.employeeId)).size === employees.length, 'inputHash');
  check(evaluation?.inputHash === manifest.inputHash && evaluation.policyVersion === manifest.policyVersion, 'evaluation');
  const identityDigest = inputDigest({ seed: manifest.seed, route, inputHash: manifest.inputHash,
    policyVersion: manifest.policyVersion, policyHash: manifest.policyHash, codeRevision });
  const environmentId = `comparison-${identityDigest.slice(0, 32)}`;
  const scope = { environmentId, runId: `comparison-run-${identityDigest.slice(0, 32)}`, principalId: 'comparison-bootstrap', roles: [] };
  const read = { runId: scope.runId, asOf: manifest.startsAt, policyVersion: manifest.policyVersion };
  const adapterRow = await comparisonAssumption(policy, 'comparison.recordAdapter.v1', read);
  const adapter = adapterRow.value;
  check(adapter.schemaVersion === 1 && adapter.kind === 'synthetic-mechanics-only'
    && adapter.unknownFieldRule === 'retain-unknown-no-inference'
    && adapter.orderReferences === 'sequential-run-local-seven-digits'
    && adapter.collectionChoice === 'first-permitted-driver-contract-location; renewal-date'
    && typeof adapter.fixtureVersion === 'string' && Array.isArray(adapter.limitations), 'comparison.recordAdapter.v1');
  const [principals, clockCommands] = await Promise.all([
    comparisonAssumption(policy, 'identity.demo.principals', read), comparisonAssumption(policy, 'clock.commands.v1', read),
  ]);
  for (const employee of employees) {
    const allowance = value(await policy.getAllowance(employee, read), 'allowance');
    check(allowance.policyVersion === manifest.policyVersion && allowance.monthlyPoints === employee.pointsAllowance
      && allowance.unit === employee.pointsUnit, 'coherent-allowance-variant');
  }
  const runPolicy = isolatedIdentityPolicy(policy, principals, employees, route === 'buddy' ? buddyOverrides(manifest, adapterRow) : {});
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => manifest.startsAt, snapshot: 'shallow' });
  value(await repository.open(), 'repository.open');
  let closed = false;
  try {
    const rows = comparisonStockRows(inputs, adapterRow).map((row) => ['stock', row]);
    const versions = { policy: manifest.policyVersion, scenario: adapter.fixtureVersion,
      fixture: adapter.fixtureVersion, corpus: manifest.configurationSource.version, comparison: { seed: manifest.seed, route, identityDigest } };
    value(await repository.resetRun(scope, command('comparison-bootstrap', { identityDigest }), {
      expectedCurrentRunId: null, nextRun: { runId: scope.runId, environmentId, status: 'active', current: true,
        scenarioVersion: versions.scenario, fixtureVersion: versions.fixture, corpusVersion: versions.corpus,
        policyVersion: versions.policy, clockInstant: manifest.startsAt,
        clockVersion: clockCommands.value.initialClockVersion, versions }, rows,
    }), 'repository.resetRun');
    const identity = new DemoIdentityAdapter({ repository, policy: runPolicy, sessionNow: () => manifest.startsAt,
      currentRun: async () => { const run = value(await repository.currentRun(environmentId), 'currentRun');
        return { environmentId, runId: run.runId }; } });
    const presenter = value(await identity.createPresenterSession('comparison-presenter'), 'presenter').context;
    const clock = new DemoClock({ repository, policy: runPolicy, identity, environmentId, environmentKind: 'synthetic' });
    const contexts = new Map();
    for (const employee of employees) {
      const context = value(await identity.switchPrincipal(presenter, principalId(employee.employeeId), `comparison-session:${employee.employeeId}`), 'employee-session').context;
      contexts.set(employee.employeeId, context);
      value(await repository.transaction(context, command(`comparison-records:${employee.employeeId}`, { employee, adapter: adapter.fixtureVersion }), async (tx) => {
        const found = await tx.get(ref(context, 'employees', { employeeId: employee.employeeId }));
        if (found.status !== 'ok') return found;
        const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
        if (slot.status !== 'ok') return slot;
        const saved = await tx.compareAndSwap(ref(context, 'employees', { employeeId: employee.employeeId }), found.value.version,
          { contract: { manualContext: manualRecords(employee, adapterRow, manifest.startsAt) } });
        if (saved.status !== 'ok') return saved;
        return tx.compareAndSwap(ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }), slot.value.version,
          { contractId: contractId(employee.employeeId), renewalId: renewalId(employee.employeeId), state: 'entitled' });
      }), 'manual-records');
    }
    const manual = new ManualContextService({ repository, policy: runPolicy, clock, identity,
      ports: createRepositoryManualPorts({ repository, policy: runPolicy }) });
    const stockAdapter = createSyntheticManualStockAdapter();
    const claims = createManualClaimsService({ repository, policy: runPolicy, clock, identity, manual, adapter: stockAdapter });
    value(await claims.registerClockHandler(), 'manual-expiry-handler');
    for (const employee of employees) {
      const context = contexts.get(employee.employeeId);
      const account = value(await claims.readAccount(context), 'manual-account');
      // An account with no collection date inside FUCQ-66's lead time cannot order; the route records that.
      if (['ordering-closed', 'not-yet-eligible'].includes(account.state)) continue;
      check(account.state === 'ready', 'manual-account-ready');
      const driver = account.drivers.find((entry) => entry.driverId === driverId(employee.employeeId));
      const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(context.schemeId) && entry.driverKinds.includes(driver.kind));
      const location = account.choices.collectionLocations.find((entry) => option && entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
      check(option && location && account.choices.brands.length > 0, 'manual-options');
      const choices = { mode: 'replacement', oldContractId: contractId(employee.employeeId), slotId: context.entitlementSlotId,
        schemeId: context.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
        requestedCollectionDate: employee.renewalAt.slice(0, 10), collectionLocationId: location.locationId,
        brand: account.choices.brands[0], contact: { phone: adapter.contact.phone,
          email: adapter.contact.emailTemplate.replace('{employeeId}', employee.employeeId) },
        expectedReturnMileage: adapter.expectedReturnMileage, specialRequirements: adapter.specialRequirements };
      value(await claims.saveDraft(context, { commandId: 'comparison-initial-draft', expectedDraftVersion: 0,
        expectedContextVersion: account.contextVersion, choices }), 'manual-draft');
    }
    // The same service composition as server/gcsp/runtime.js; allocation is called per release, not on a clock stage.
    const transport = new CapturedTransport({ repository });
    let buddy;
    if (route === 'buddy') {
      const brief = createBriefService({ repository, policy: runPolicy, clock, identity });
      const hold = createBuddyHoldService({ repository, policy: runPolicy, clock, identity, adapter: stockAdapter, offerLandingUrl: resolveOfferLandingUrl() });
      value(await hold.start(), 'buddy-expiry-handler');
      const access = createOfferAccessService({ repository, policy: runPolicy, clock, identity, environmentId,
        sessionNow: () => manifest.startsAt, verifyOfferToken });
      // Not started: no clock handler or commit observer; the route drains the outbox once per release.
      const dispatcher = new NotificationDispatcher({ repository, policy: runPolicy, clock, environmentId, transport });
      buddy = Object.freeze({ brief, hold, access, dispatcher,
        allocation: createAllocationService({ repository, policy: runPolicy, clock, identity, claim: hold }),
        decisions: createOfferDecisionService({ repository, policy: runPolicy, clock, access,
          createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator, mode: stockAdapter.mode }) });
    }
    return Object.freeze({ repository, clock, identity, claims, buddy, presenter, evaluation,
      transport, policy: runPolicy, inputs,
      metadata: freezeVehicleData({ seed: manifest.seed, policyVersion: manifest.policyVersion, route,
        runId: scope.runId, environmentId, identityDigest, inputHash: manifest.inputHash, codeRevision,
        adapter: adapterRow, limitations: adapter.limitations }),
      employeeContext(employeeId) { check(contexts.has(employeeId), 'employeeId'); return contexts.get(employeeId); },
      async snapshot() {
        return Object.fromEntries(await Promise.all(FOUNDATION_TABLES.map(async (table) => [table,
          value(await repository.query(scope, table), `snapshot:${table}`)])));
      },
      async release(releaseId) {
        const release = inputs.releaseSchedule.find((entry) => entry.releaseId === releaseId);
        check(release, 'releaseId');
        const time = value(await clock.now(scope), 'release-clock');
        check(Date.parse(time.now) >= Date.parse(release.at), 'release-not-due');
        return repository.transaction(scope, command(`comparison-release:${releaseId}`, release), async (tx) => {
          for (const orderUuid of release.orderUuids) {
            const found = await tx.get(ref(scope, 'stock', { orderUuid })); if (found.status !== 'ok') return found;
            if (found.value.state !== 'unreleased') continue;
            const changed = await tx.compareAndSwap(ref(scope, 'stock', { orderUuid }), found.value.version, { state: 'released', available: true });
            if (changed.status !== 'ok') return changed;
          }
          return ok({ releaseId, at: time.now, orderUuids: release.orderUuids });
        });
      },
      async advanceTo(to) {
        const current = value(await clock.readState(presenter), 'clock-state');
        return clock.advance(presenter, { commandId: `comparison-advance:${to}`, expectedClockVersion: current.clockVersion, to });
      },
      async tick(eventId) {
        const current = value(await clock.readState(presenter), 'clock-state');
        return clock.tick(presenter, { eventId, expectedClockVersion: current.clockVersion,
          inputDigest: inputDigest({ eventId, now: current.now, identityDigest }) });
      },
      async close() { if (!closed) { closed = true; return repository.close(); } return ok({ closed: true }); },
    });
  } catch (error) { await repository.close(); throw error; }
}
