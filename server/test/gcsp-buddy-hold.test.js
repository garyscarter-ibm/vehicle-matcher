import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { hashOfferToken, verifyOfferToken, mintOfferToken } from '../gcsp/offers/offer-token.js';
import { stock, essential, preference, fact } from './helpers/employee-recommendation.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const briefData = (seats = 5) => ({ schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(seats) } });
const rowRef = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
async function setup(t, { policy = createPolicyService(), consent = { search: true, hold: true }, seats = 5, facts = {} } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  t.after(() => repository.close());
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'buddy-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  assert.equal((await clock.advance(presenter.value.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  const brief = new BriefService({ repository, policy, clock, identity });
  assert.equal((await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0,
    expectedDraftVersion: 0, brief: briefData(seats) })).status, 'ok');
  assert.equal((await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent })).status, 'ok');
  const car = stock(1, facts);
  assert.equal((await repository.transaction(context, command('released-fixture'), (tx) => tx.insert('stock', {
    runId: context.runId, orderUuid: car.orderUuid, orderNumber: '9123456', configurationId: car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
    release: { eventId: 'fixture-release', availability: car.availability },
    visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null },
  }))).status, 'ok');
  const f = { repository, store, policy, clock, identity, context, presenter, brief, car };
  const employee = await repository.read(context, rowRef(f, 'employees', { employeeId: context.employeeId }));
  const slot = await repository.read(context, rowRef(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
  f.input = { commandId: 'allocate', orderUuid: car.orderUuid, expectedBriefVersion: 1, expectedStockVersion: 1,
    expectedEmployeeVersion: employee.value.version, expectedSlotVersion: slot.value.version };
  f.service = service(f);
  return f;
}
const service = (f, overrides = {}) => new BuddyHoldService({ repository: f.repository, policy: f.policy,
  clock: f.clock, identity: f.identity, adapter: { mode: 'local-synthetic' }, ...overrides });
async function absent(f) {
  for (const table of ['holds', 'claims', 'quotes', 'offers', 'notification_outbox']) {
    assert.equal((await f.repository.query(f.context, table)).value.length, 0, table);
  }
  const current = await f.repository.read(f.context, rowRef(f, 'stock', { orderUuid: f.car.orderUuid }));
  assert.equal(current.value.state, 'released'); assert.equal(current.value.version, 1);
}
async function patch(f, table, key, value) {
  const current = await f.repository.read(f.context, rowRef(f, table, key));
  return f.repository.transaction(f.context, command(`patch:${table}:${current.value.version}`),
    (tx) => tx.compareAndSwap(rowRef(f, table, key), current.value.version, value));
}

test('atomic local allocation pins truthful quote, hold, offer and one notification; replay is stable', async (t) => {
  const f = await setup(t); const allocated = await f.service.allocate(f.context, f.input);
  assert.equal(allocated.status, 'ok');
  const { hold, quote, offer, notification } = allocated.value;
  assert.equal(allocated.value.state, 'offered'); assert.equal(allocated.value.proposedCapability, true);
  assert.equal(hold.type, 'buddy-offer'); assert.equal(hold.state, 'active'); assert.equal(offer.state, 'active');
  assert.equal(hold.orderUuid, f.car.orderUuid); assert.equal(offer.holdId, hold.holdId); assert.equal(offer.quoteId, quote.quoteId);
  assert.equal(quote.briefVersion, 1); assert.equal(quote.policyVersion, f.context.policyVersion);
  assert.equal(quote.facts.sourceKeys.stockId, f.car.orderUuid); assert.equal(quote.eligibility.decision.gateStatus, 'eligible');
  assert.equal(quote.terms.points.value > 0, true); assert.equal(quote.eligibility.employeeVersion, f.input.expectedEmployeeVersion);
  const currentCar = quote.eligibility.currentCarComparison;
  assert.equal(currentCar.comparisonAvailable, false); assert.equal(currentCar.display.state, 'partial');
  assert.equal(currentCar.display.model, 'Fictional BMW 320i Touring');
  assert.equal(currentCar.binding.employeeVersion, f.input.expectedEmployeeVersion);
  assert.equal(currentCar.binding.slotVersion, f.input.expectedSlotVersion);
  const timing = await f.policy.getAssumption('hold.buddy.durationSeconds', { runId: f.context.runId,
    asOf: allocated.value.now, policyVersion: f.context.policyVersion });
  assert.equal(Date.parse(hold.expiresAt) - Date.parse(allocated.value.now), timing.value.value * 1000);
  assert.equal(offer.expiresAt, hold.expiresAt);
  const jobs = (await f.repository.query(f.context, 'notification_outbox')).value;
  assert.equal(jobs.length, 1); assert.equal(jobs[0].jobId, notification.jobId);
  assert.equal(jobs[0].messageKind, 'offer'); assert.equal(jobs[0].messageVersion, '1');
  assert.equal(jobs[0].idempotencyKey, `offer:${offer.offerId}:notification:offer:1`);
  const heldStock = (await f.repository.read(f.context, rowRef(f, 'stock', { orderUuid: f.car.orderUuid }))).value;
  assert.equal(heldStock.state, 'held'); assert.equal(heldStock.held, true); assert.equal(heldStock.available, false);
  assert.deepEqual(await f.service.allocate(f.context, f.input), allocated);
  assert.equal((await f.repository.query(f.context, 'holds')).value.length, 1);
  assert.equal((await f.repository.query(f.context, 'notification_outbox')).value.length, 1);
  assert.equal((await f.service.allocate(f.context, { ...f.input, expectedBriefVersion: 2 })).reason, 'idempotency-input-changed');
});

test('token is cryptographic, offer/run/environment bound and absent from responses and metadata', async (t) => {
  const f = await setup(t); const allocated = await f.service.allocate(f.context, f.input);
  assert.equal(allocated.status, 'ok');
  const offer = (await f.repository.query(f.context, 'offers')).value[0];
  const job = (await f.repository.query(f.context, 'notification_outbox')).value[0];
  const token = new URL(job.payload.offerLink, 'https://demo.invalid').hash.slice('#token='.length);
  const binding = { environmentId: f.context.environmentId, runId: f.context.runId, offerId: offer.offerId };
  assert.equal(Buffer.from(token, 'base64url').length >= 32, true);
  assert.equal(verifyOfferToken(token, binding, offer.tokenHash), true);
  for (const key of Object.keys(binding)) assert.equal(verifyOfferToken(token, { ...binding, [key]: 'different' }, offer.tokenHash), false);
  assert.equal(hashOfferToken(token, binding) === offer.tokenHash, true);
  assert.equal(verifyOfferToken('bad', binding, offer.tokenHash), false);
  assert.equal(JSON.stringify(allocated).includes(token), false);
  assert.equal(JSON.stringify(offer).includes(token), false);
  const another = mintOfferToken(binding);
  assert.equal(another.tokenHash === offer.tokenHash, false);
});

test('local quote preserves current-car metadata after the authenticated employee source changes', async (t) => {
  const f = await setup(t); const original = await f.service.allocate(f.context, f.input); assert.equal(original.status, 'ok');
  const employee = (await f.repository.read(f.context, rowRef(f, 'employees', { employeeId: f.context.employeeId }))).value;
  const changed = structuredClone(employee.contract);
  changed.manualContext.contracts[0].model = 'Revised current car';
  assert.equal((await patch(f, 'employees', { employeeId: f.context.employeeId }, { contract: changed })).status, 'ok');
  const quote = (await f.repository.read(f.context, rowRef(f, 'quotes', { quoteId: original.value.quote.quoteId }))).value;
  assert.deepEqual(quote, original.value.quote);
  assert.equal(quote.eligibility.currentCarComparison.display.model, 'Fictional BMW 320i Touring');
});

test('plaintext token remains only in the outbox link, including repository receipts', async (t) => {
  const f = await setup(t); assert.equal((await f.service.allocate(f.context, f.input)).status, 'ok');
  const job = (await f.repository.query(f.context, 'notification_outbox')).value[0];
  const token = new URL(job.payload.offerLink, 'https://demo.invalid').hash.slice('#token='.length);
  const otherTables = Object.fromEntries(Object.entries(f.store.state.tables).filter(([table]) => table !== 'notification_outbox'));
  assert.equal(JSON.stringify(otherTables).includes(token), false);
});

test('policy duration is consumed from its pinned source', async (t) => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((item) => item.key === 'hold.buddy.durationSeconds').value = 1234;
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const f = await setup(t, { policy }); const allocated = await f.service.allocate(f.context, f.input);
  assert.equal(allocated.status, 'ok');
  assert.equal(Date.parse(allocated.value.hold.expiresAt) - Date.parse(allocated.value.now), 1234000);
  assert.equal(allocated.value.quote.eligibility.holdTiming.value, 1234);
});

test('stale brief, stock, slot and employee revisions fail before any allocation writes', async (t) => {
  for (const key of ['expectedBriefVersion', 'expectedStockVersion', 'expectedSlotVersion', 'expectedEmployeeVersion']) {
    await t.test(key, async (child) => {
      const f = await setup(child);
      assert.equal((await f.service.allocate(f.context, { ...f.input, [key]: 99 })).status, 'stale-version');
      await absent(f);
    });
  }
});

test('pause, independent consent, essentials and eligibility reject without offer/job/hold', async (t) => {
  for (const [name, options] of [['search-off', { consent: { search: false, hold: true } }],
    ['hold-off', { consent: { search: true, hold: false } }], ['essential', { seats: 9 }],
    ['eligibility', { facts: { eligibilityModelKey: fact('G70 Saloon|760e xDrive') } }], ['paused', {}]]) {
    await t.test(name, async (child) => {
      const f = await setup(child, options);
      if (name === 'paused') {
        assert.equal((await f.brief.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 })).status, 'ok');
        f.input.expectedBriefVersion = 2;
      }
      assert.equal((await f.service.allocate(f.context, f.input)).status, 'conflict');
      await absent(f);
    });
  }
});

test('stored employee facts and exact released stock remain authority', async (t) => {
  const f = await setup(t);
  const employee = (await f.repository.read(f.context, rowRef(f, 'employees', { employeeId: f.context.employeeId }))).value;
  const contract = structuredClone(employee.contract); contract.manualContext.drivers[0].eligible = fact(false);
  assert.equal((await patch(f, 'employees', { employeeId: f.context.employeeId }, { contract })).status, 'ok');
  f.input.expectedEmployeeVersion += 1;
  assert.equal((await f.service.allocate(f.context, f.input)).reason, 'candidate-not-eligible');
  await absent(f);
  assert.equal((await f.service.allocate(f.context, { ...f.input, employeeFacts: { driverEligible: fact(true) } })).status, 'invalid');
  assert.equal((await f.service.allocate({ ...f.context }, f.input)).status, 'forbidden');
  assert.equal((await service(f, { adapter: { mode: 'remote' } }).allocate(f.context, f.input)).code, 'buddy-stock-mode-not-supported');
});

test('outbox and late storage failures roll back quote, claim, stock flags and offer', async (t) => {
  for (const failure of ['outbox', 'offer', 'stock-flags']) {
    await t.test(failure, async (child) => {
      const f = await setup(child); let writes = 0;
      const repository = { ...f.repository, transaction: (context, cmd, work) => f.repository.transaction(context, cmd, (tx) => work({ ...tx,
        insert: async (table, row) => {
          if (failure === 'offer' && table === 'offers') throw Error('injected storage failure');
          const outcome = await tx.insert(table, row); if (outcome.status === 'ok') writes += 1; return outcome;
        },
        compareAndSwap: async (ref, version, patch) => {
          if (failure === 'stock-flags' && patch.held === true) throw Error('injected flags failure');
          return tx.compareAndSwap(ref, version, patch);
        },
        enqueueNotification: async () => { throw Error('injected outbox failure'); },
      })) };
      assert.equal((await service(f, { repository }).allocate(f.context, f.input)).status, 'unavailable');
      assert.equal(writes > 0, true); await absent(f);
    });
  }
});

test('concurrent exact-car allocations have only one committed success', async (t) => {
  const f = await setup(t);
  const outcomes = await Promise.all(['first', 'second'].map((commandId) => f.service.allocate(f.context, { ...f.input, commandId })));
  assert.equal(outcomes.filter((item) => item.status === 'ok').length, 1);
  assert.equal((await f.repository.query(f.context, 'offers')).value.length, 1);
  assert.equal((await f.repository.query(f.context, 'notification_outbox')).value.length, 1);
});

test('repository contract only: cart and buddy claims share exclusive exact-car authority in both directions', async (t) => {
  for (const firstType of ['cart', 'buddy-offer']) {
    await t.test(firstType, async (child) => {
      const f = await setup(child);
      const first = await f.repository.transaction(f.context, command('raw-first'), async (tx) => {
        const quote = await tx.insert('quotes', { runId: f.context.runId, quoteId: 'raw-quote', orderUuid: f.car.orderUuid,
          employeeId: f.context.employeeId, policyVersion: f.context.policyVersion }); if (quote.status !== 'ok') return quote;
        const available = await tx.compareAndSwap(rowRef(f, 'stock', { orderUuid: f.car.orderUuid }), 1, { state: 'available' });
        return tx.conditionalClaim({ orderUuid: f.car.orderUuid, holdId: 'raw-hold', claimId: 'raw-claim', employeeId: f.context.employeeId,
          entitlementSlotId: f.context.entitlementSlotId, type: firstType, expiresAt: '2026-11-06T00:00:00.000Z',
          policyVersion: f.context.policyVersion, quoteId: 'raw-quote', expectedStockVersion: available.value.version,
          expectedSlotVersion: f.input.expectedSlotVersion });
      });
      assert.equal(first.status, 'ok');
      const second = await f.repository.transaction(f.context, command('raw-second'), (tx) => tx.conditionalClaim({
        orderUuid: f.car.orderUuid, holdId: 'raw-other-hold', claimId: 'raw-other-claim', employeeId: f.context.employeeId,
        entitlementSlotId: f.context.entitlementSlotId, type: firstType === 'cart' ? 'buddy-offer' : 'cart', expiresAt: '2026-11-06T00:00:00.000Z',
        policyVersion: f.context.policyVersion, quoteId: 'raw-quote', expectedStockVersion: first.value.stockVersion,
        expectedSlotVersion: first.value.slotVersion }));
      assert.equal(second.status, 'conflict'); assert.equal(second.reason, 'car-occupied');
      assert.equal((await f.repository.query(f.context, 'holds')).value.length, 1);
      assert.equal((await f.repository.query(f.context, 'offers')).value.length, 0);
    });
  }
});

// This constructs the published candidate shape with real evaluation; it does not
// load or invoke the paused FUCQ-96 producer or its identity extension.
async function allocationCandidate(f) {
  const read = async (table, key) => (await f.repository.read(f.context, rowRef(f, table, key))).value;
  const employee = await read('employees', { employeeId: f.context.employeeId });
  const slot = await read('entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId });
  const brief = (await f.brief.readCurrent(f.context)).value.brief;
  const instant = (await f.clock.now(f.context)).value;
  const pool = (await f.repository.query(f.context, 'stock')).value.filter((row) => ['released', 'available'].includes(row.state)
    && row.available === true && !row.held && !row.allocated);
  const employeeFacts = structuredClone(employee.contract.manualContext.employeeFacts);
  const driver = employee.contract.manualContext.drivers.find((row) => row.kind === 'employee' && row.employeeId === f.context.employeeId);
  if (employeeFacts.driverEligible === undefined) employeeFacts.driverEligible = driver.eligible;
  const charging = brief.essentials.charging;
  if (charging) employeeFacts.charging = { status: charging.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
    value: charging.value, unit: null, provenance: { sourceRef: charging.source, version: String(brief.briefVersion),
      observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
  const evaluator = createEmployeeRecommendationService({ policy: f.policy, time: { async now() { return ok(instant); } },
    provider: { async resolve() { return ok({ runId: f.context.runId, environmentId: f.context.environmentId,
      employeeId: f.context.employeeId, factsVersion: `employee:${employee.version}`, stockVersion: inputDigest(pool), employeeFacts,
      stock: pool.map((row) => ({ orderUuid: row.orderUuid, configurationId: row.configurationId, snapshot: row.facts,
        availability: { ...row.release.availability, state: 'available', version: String(row.version) } })) }); } } });
  const evaluated = await evaluator.recommend(f.context, { schemaVersion: brief.schemaVersion, briefVersion: brief.briefVersion,
    preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) });
  assert.equal(evaluated.status, 'ok');
  const decision = evaluated.value.decisions.find((row) => row.orderUuid === f.car.orderUuid);
  assert.equal(decision.gateStatus, 'eligible');
  const row = pool.find((item) => item.orderUuid === f.car.orderUuid); const eventId = 'released-event';
  return { runId: f.context.runId, eventId,
    operationId: `allocation:${inputDigest([f.context.runId, eventId, f.context.employeeId, row.orderUuid])}`,
    employeeId: f.context.employeeId, entitlementSlotId: f.context.entitlementSlotId,
    renewalId: brief.renewalId ?? slot.renewalId ?? employee.renewalId ?? null, orderUuid: row.orderUuid,
    quote: { orderUuid: row.orderUuid, configurationId: row.configurationId, snapshot: decision.snapshot, terms: decision.terms,
      employeeFacts: decision.employeeFacts, versions: decision.versions, reasons: decision.reasons, tradeOffs: decision.tradeOffs },
    expectedVersions: { stock: row.version, slot: slot.version, brief: brief.briefVersion, permission: brief.buddy.permissionVersion,
      employee: employee.version, policy: f.context.policyVersion, clock: instant.clockVersion },
    reasons: [{ code: 'eligible-fit', score: decision.score }], renewalDue: '2026-12-01T00:00:00.000Z',
    score: decision.score, lottery: inputDigest('fixture-lottery') };
}

test('published allocation-shaped tryClaim revalidates and replays one operation with slot-derived renewal', async (t) => {
  const f = await setup(t); const candidate = await allocationCandidate(f);
  assert.equal(f.context.renewalId == null, true);
  const first = await f.service.tryClaim(f.context, candidate); assert.equal(first.status, 'ok');
  assert.equal(first.value.hold.renewalId, candidate.renewalId);
  const claim = (await f.repository.query(f.context, 'claims')).value[0];
  assert.equal(claim.renewalId, candidate.renewalId);
  assert.deepEqual(await f.service.tryClaim(f.context, candidate), first);
  assert.equal((await f.repository.query(f.context, 'offers')).value.length, 1);
  assert.equal((await f.service.tryClaim(f.context, { ...candidate, score: -1 })).reason, 'idempotency-input-changed');
});

test('allocation candidate checks all seven expected versions', async (t) => {
  for (const key of ['stock', 'slot', 'brief', 'permission', 'employee', 'policy', 'clock']) {
    await t.test(key, async (child) => {
      const f = await setup(child); const candidate = await allocationCandidate(f);
      candidate.expectedVersions[key] = ['policy', 'clock'].includes(key) ? 'changed-version' : 99;
      assert.equal((await f.service.tryClaim(f.context, candidate)).status, 'stale-version'); await absent(f);
    });
  }
});

test('allocation rejects forged owner, run, operation, renewal, quote facts, terms and source pins', async (t) => {
  const changes = {
    owner: (c) => { c.employeeId = 'another'; }, slot: (c) => { c.entitlementSlotId = 'another'; },
    run: (c) => { c.runId = 'another'; }, operation: (c) => { c.operationId = 'another'; },
    renewal: (c) => { c.renewalId = 'another'; }, configuration: (c) => { c.quote.configurationId = 'another'; },
    snapshot: (c) => { c.quote.snapshot.facts.seats.value = 50; }, terms: (c) => { c.quote.terms.points.value = 1; },
    facts: (c) => { c.quote.employeeFacts.driverEligible.value = false; },
    quoteVersion: (c) => { c.quote.versions.facts = 'forged'; },
    explanations: (c) => { c.quote.reasons = [{ code: 'forged-eligible' }]; },
    extraAuthority: (c) => { c.eligible = true; },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async (child) => {
      const f = await setup(child); const candidate = structuredClone(await allocationCandidate(f)); change(candidate);
      assert.equal((await f.service.tryClaim(f.context, candidate)).status === 'ok', false); await absent(f);
    });
  }
});

test('direct allocation also persists slot-derived renewal without a context renewal field', async (t) => {
  const f = await setup(t); const candidate = await allocationCandidate(f);
  const allocated = await f.service.allocate(f.context, f.input); assert.equal(allocated.status, 'ok');
  assert.equal(allocated.value.hold.renewalId, candidate.renewalId);
  assert.equal((await f.repository.query(f.context, 'claims')).value[0].renewalId, candidate.renewalId);
});

test('an allocated hold or allocated/pending claim on another slot blocks the same renewal', async (t) => {
  for (const source of ['holds', 'claims', 'claims-pending']) {
    await t.test(source, async (child) => {
      const f = await setup(child); const candidate = await allocationCandidate(f);
      const otherCar = (await f.repository.query(f.context, 'stock')).value.find((row) => row.orderUuid !== f.car.orderUuid);
      const seeded = await f.repository.transaction(f.context, command('allocated-other-slot'), async (tx) => {
        for (const [table, row] of [
          ['entitlement_slots', { entitlementSlotId: 'other-slot', employeeId: f.context.employeeId, capacity: 1, renewalId: candidate.renewalId }],
          ['quotes', { quoteId: 'old-quote', employeeId: f.context.employeeId, orderUuid: otherCar.orderUuid }],
          ['holds', { holdId: 'old-hold', orderUuid: otherCar.orderUuid, employeeId: f.context.employeeId, entitlementSlotId: 'other-slot',
            quoteId: 'old-quote', type: 'cart', state: source === 'holds' ? 'allocated' : 'released', renewalId: candidate.renewalId }],
          ...(source.startsWith('claims') ? [['claims', { claimId: 'old-claim', holdId: 'old-hold', orderUuid: otherCar.orderUuid,
            employeeId: f.context.employeeId, entitlementSlotId: 'other-slot', type: 'cart', state: source === 'claims' ? 'allocated' : 'claim-pending', renewalId: candidate.renewalId }]] : []),
        ]) {
          const inserted = await tx.insert(table, { runId: f.context.runId, ...row }); if (inserted.status !== 'ok') return inserted;
        }
        return ok(null);
      });
      assert.equal(seeded.status, 'ok');
      assert.equal((await f.service.tryClaim(f.context, candidate)).reason, 'release-required');
      assert.equal((await f.repository.query(f.context, 'offers')).value.length, 0);
      assert.equal((await f.repository.query(f.context, 'notification_outbox')).value.length, 0);
      assert.equal((await f.repository.query(f.context, 'holds')).value.length, 1);
    });
  }
});
