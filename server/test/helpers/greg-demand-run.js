// Real-service setup for Greg demand tests: synthetic run, brief, release and offer writers. Lifted from gcsp-greg-demand.test.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../../gcsp/repository/index.js';
import { PolicyService } from '../../gcsp/policy/index.js';
import { createDemoRuntime } from '../../gcsp/clock/index.js';
import { BriefService } from '../../gcsp/brief/index.js';
import { createGregDemandService } from '../../gcsp/greg/index.js';
import { seedManualDemoContext } from '../../gcsp/manual-context/fixtures.js';
import { preference, essential, stock, fact } from './employee-recommendation.js';
import { getReviewedDefinitionSet } from '../../gcsp/policy/reviewed-definitions.js';

export { fact };
const seed = JSON.parse(await readFile(new URL('../../gcsp/policy/seed-v1.json', import.meta.url)));
const REVIEWED_REASONS = getReviewedDefinitionSet('offer-decline-reasons-v1').definitions.find((d) => d.key === 'offer.declineReasons.v1');

/** Fresh in-memory run. `threshold` is an explicit alternative; `canonical` keeps the seed value (5). */
export async function setup({ threshold = 1, canonical = false, policyProvider, wrapRepository = (repository) => repository, declineReasons = REVIEWED_REASONS.value } = {}) {
  const source = structuredClone(seed);
  if (!canonical) {
    source.assumptions = source.assumptions.filter((a) => a.key !== 'greg.demand.smallCountThreshold');
    source.assumptions.push({ ...source.assumptions[0], key: 'greg.demand.smallCountThreshold', value: threshold,
      unit: 'count', status: 'assumed', basis: 'Explicit alternative fixture privacy threshold.' });
  }
  if (declineReasons !== null) source.assumptions.push({ ...source.assumptions[0], key: REVIEWED_REASONS.key, value: structuredClone(declineReasons),
    unit: REVIEWED_REASONS.unit, status: REVIEWED_REASONS.status, basis: REVIEWED_REASONS.basis });
  const policy = new PolicyService({ provider: policyProvider ? policyProvider(source) : { async loadVersions() { return [source]; } } });
  const repository = wrapRepository(createMemoryRepository({ store: createMemoryStore() }));
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'greg-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context; const employee = paula.value.context;
  const service = createGregDemandService({ repository, policy, clock, identity });
  const brief = new BriefService({ repository, policy, clock, identity });
  let sequence = 0;
  const write = async (work) => {
    const commandId = `fixture-${++sequence}`;
    const value = await repository.transaction(context, { commandId, inputDigest: inputDigest(commandId) }, work);
    assert.equal(value.status, 'ok', JSON.stringify(value)); return value;
  };
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context: employee })).status, 'ok');
  return { repository, policy, clock, identity, presenter, acting, context, employee, service, brief, write };
}

export const saved = (seats = 5) => ({ schemaVersion: 1, preferences: { body: preference('estate'), fuel: preference('petrol') },
  essentials: { seats: essential(seats), modelLine: essential('G21 Touring', 'equals', null) } });

/** Save and confirm a brief at `version` (0 for the first). */
export async function confirm(f, value = saved(), version = 0) {
  const draft = await f.brief.saveDraft(f.employee, { commandId: `draft-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version, brief: value });
  assert.equal(draft.status, 'ok', JSON.stringify(draft));
  const result = await f.brief.confirm(f.employee, { commandId: `confirm-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version + 1, consent: { search: true, hold: true } });
  assert.equal(result.status, 'ok', JSON.stringify(result)); return result;
}

/** Release one visible exact car (id 1..n) into stock. */
export async function release(f, id = 1, facts = {}) {
  const candidate = stock(id, { modelLine: fact('G21 Touring'), ...facts });
  const now = (await f.clock.now(f.context)).value.now;
  return f.write((tx) => tx.insert('stock', { runId: f.context.runId, orderUuid: candidate.orderUuid,
    configurationId: candidate.configurationId, state: 'released', available: true, facts: candidate.snapshot,
    release: { availability: { ...candidate.availability, availableFrom: now } },
    visibility: { companyIds: [f.employee.companyId], schemeIds: [f.employee.schemeId], employeeIds: null } }));
}

/** Release a car and record an offer in `state`, with an optional decision and typed reason. */
export async function offer(f, id, state, decision, reason) {
  await release(f, id);
  const orderUuid = stock(id).orderUuid;
  return f.write(async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: `quote-${id}`, orderUuid, employeeId: f.employee.employeeId,
      briefVersion: 1, policyVersion: f.context.policyVersion });
    const holdState = state === 'expired' ? 'expired' : state === 'selected' ? 'allocated' : state === 'active' ? 'active' : 'released';
    await tx.insert('holds', { runId: f.context.runId, holdId: `hold-${id}`, orderUuid, employeeId: f.employee.employeeId,
      entitlementSlotId: f.employee.entitlementSlotId, type: 'buddy-offer', state: holdState,
      quoteId: `quote-${id}`, policyVersion: f.context.policyVersion });
    await tx.insert('offers', { runId: f.context.runId, offerId: `offer-${id}`, holdId: `hold-${id}`, employeeId: f.employee.employeeId,
      orderUuid, state, quoteId: `quote-${id}`, briefVersion: 1, policyVersion: f.context.policyVersion });
    if (decision) await tx.insert('decisions', { runId: f.context.runId, decisionId: `decision-${id}`, commandId: `decision-${id}`,
      offerId: `offer-${id}`, employeeId: f.employee.employeeId, decision, reason: reason ?? null,
      versions: { brief: 1, policy: f.context.policyVersion } });
    if (['active', 'selected'].includes(state)) {
      const found = await tx.get({ table: 'stock', key: { runId: f.context.runId, orderUuid } });
      await tx.compareAndSwap({ table: 'stock', key: { runId: f.context.runId, orderUuid } }, found.value.version,
        { state: state === 'selected' ? 'allocated' : 'held', available: false, held: state === 'active', allocated: state === 'selected' });
    }
    return ok({ done: true });
  });
}

/** Read the Greg projection value (asserts ok). */
export async function readDemand(f) {
  const out = await f.service.readDemand(f.context);
  assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value;
}
