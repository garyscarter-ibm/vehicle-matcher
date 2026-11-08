// Tiny browser snapshots generated through the real BriefService and activity reader.
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../../gcsp/repository/index.js';
import { createPolicyService } from '../../gcsp/policy/index.js';
import { createDemoRuntime } from '../../gcsp/clock/index.js';
import { createBriefService } from '../../gcsp/brief/index.js';
import { createActivityService } from '../../gcsp/brief/activity.js';
import { preference, essential } from './employee-recommendation.js';

const checked = (out) => { if (out.status !== 'ok') throw new Error(`Activity fixture: ${out.status}`); return out.value; };
const KEYS = ['asOf', 'briefVersion', 'permission', 'state', 'lastSuccessfulCheck', 'searchEvidence', 'sourceStatus',
  'currentOffer', 'offers', 'stateChanges', 'stateChangesEvidence'];
function snapshot(out) {
  const v = checked(out);
  // Run-derived stock identity is not a static browser identity or an exact-display claim.
  // Storage wall-clock creation times would make regeneration non-deterministic.
  const strip = ({ orderUuid, createdAt, ...offer }) => offer;
  v.offers = v.offers.map(strip); if (v.currentOffer) v.currentOffer = strip(v.currentOffer);
  return { status: 'ok', value: Object.fromEntries(KEYS.map((key) => [key, v[key]])) };
}
const command = (commandId) => ({ commandId, inputDigest: inputDigest({ commandId }) });
const CHECKED_AT = '2026-11-04T23:30:00.000Z';
const pending = { status: 'pending', operationId: 'op', operationType: 'release-pull', lastKnownState: 'waiting' };

// One fresh synthetic run per snapshot, so no state leaks between examples.
async function scenario({ check, tick, offer, pause } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore() }); checked(await repository.open());
  try {
    const policy = createPolicyService();
    const { identity, clock } = checked(await createDemoRuntime({ repository, policy, environmentId: 'activity-body-fixture',
      environmentKind: 'synthetic', policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap',
      sessionNow: () => '2026-11-05T00:00:00.000Z' }));
    const presenter = checked(await identity.createPresenterSession('presenter'));
    const { context } = checked(await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula'));
    const brief = createBriefService({ repository, policy, identity, clock });
    const reader = createActivityService({ repository, identity, clock });
    checked(await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
    checked(await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: false } }));
    if (check) {
      // A stored allocation receipt of the real shape: this employee's slice only.
      const decisions = Array.from({ length: 12 }, (_, i) => ({ orderUuid: `car-${i}`, gateStatus: i < check.suitable ? 'eligible' : 'ineligible',
        blockers: (check.unmet ?? []).filter((u) => i >= u.from && i < u.to).map((u) => ({ code: 'essential-unmet', field: u.field, requirement: u.requirement })) }));
      const assignments = check.held ? [{ employeeId: context.employeeId, orderUuid: 'car-0' }] : [];
      checked(await repository.transaction(context, command('check'), (tx) => tx.recordReceipt({ consumerId: 'buddy-allocation',
        eventId: 'check-1', eventType: 'stock-released', inputDigest: inputDigest({ eventId: 'check-1' }), inputVersions: {}, state: 'completed',
        outcome: ok({ state: 'allocated', runId: context.runId, evaluatedAt: CHECKED_AT, inputVersions: { clock: '3' }, assignments,
          evaluations: [{ employeeId: context.employeeId, decisions }] }) })));
    }
    if (tick) {
      for (const [stage, handle] of Object.entries(tick)) {
        checked(await clock.registerHandler({ handlerId: `h-${stage}`, stage, handle: async () => handle }));
      }
      const state = checked(await clock.readState(presenter.context));
      await clock.tick(presenter.context, { eventId: 'fixture-tick', expectedClockVersion: state.clockVersion, inputDigest: inputDigest({}) });
    }
    if (offer) {
      const order = checked(await repository.query(context, 'stock'))[0];
      checked(await repository.transaction(context, command('layout-offer'), async (tx) => {
        checked(await tx.insert('quotes', { runId: context.runId, quoteId: 'layout-quote', employeeId: context.employeeId, orderUuid: order.orderUuid }));
        checked(await tx.insert('holds', { runId: context.runId, holdId: 'layout-hold', orderUuid: order.orderUuid, employeeId: context.employeeId,
          entitlementSlotId: context.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'layout-quote' }));
        return tx.insert('offers', { runId: context.runId, offerId: 'layout-offer', holdId: 'layout-hold', quoteId: 'layout-quote',
          employeeId: context.employeeId, orderUuid: order.orderUuid, state: offer.state, briefVersion: 1, policyVersion: context.policyVersion,
          expiresAt: offer.expiresAt });
      }));
    }
    if (pause) checked(await brief.pause(context, { commandId: 'pause', expectedBriefVersion: 1 }));
    return { snapshot: snapshot(await reader.readActivity(context)), context, identity, clock };
  } finally { await repository.close(); }
}
const healthy = { 'release-pull': ok({ pulled: 0 }), 'buddy-allocation': ok({}) };
const seats = { field: 'seats', requirement: { operator: 'gte', value: 5, unit: 'count' } };
const boot = { field: 'boot', requirement: { operator: 'gte', value: 430, unit: 'L' } };
const noMatch = { suitable: 0 }; const held = { suitable: 3, held: true };
const soon = '2026-11-06T09:00:00.000Z'; const earlier = '2026-11-04T22:00:00.000Z';

export async function createActivityFixtures() {
  const snapshots = {};
  const build = async (name, options) => { snapshots[name] = (await scenario(options)).snapshot; };
  await build('never-checked'); await build('paused', { pause: true });
  await build('searching', { check: noMatch, tick: healthy });
  await build('no-match-one', { check: { suitable: 0, unmet: [{ ...seats, from: 0, to: 12 }] }, tick: healthy });
  await build('no-match-two', { check: { suitable: 0, unmet: [{ ...seats, from: 0, to: 9 }, { ...boot, from: 6, to: 12 }] }, tick: healthy });
  await build('offer', { check: held, tick: healthy, offer: { state: 'active', expiresAt: soon } });
  await build('offer-declined', { check: noMatch, tick: healthy, offer: { state: 'rejected', expiresAt: soon } });
  await build('offer-expired', { check: noMatch, tick: healthy, offer: { state: 'expired', expiresAt: earlier } });
  await build('paused-offer', { check: held, tick: healthy, offer: { state: 'active', expiresAt: soon }, pause: true });
  await build('source-delayed', { check: noMatch, tick: { 'release-pull': pending, 'buddy-allocation': ok({}) } });
  await build('source-unavailable', { check: noMatch, tick: { 'release-pull': result('unavailable') } });
  const { context, identity, clock } = await scenario();
  snapshots.unavailable = await createActivityService({ identity, clock, repository: {
    query: async () => result('unavailable', { code: 'synthetic-fixture-outage', reason: 'Activity could not be loaded.', retryable: true }),
  } }).readActivity(context);
  return { source: 'Real BriefService and createActivityService over stored rows of the real shapes; synthetic demo run',
    snapshots,
    offerExample: { offerRef: { offerId: 'layout-offer' }, title: 'Your BMW offer',
      images: [{ src: '/assets/brand-hero/bmw.jpg', alt: 'BMW brand photograph, representative of the brand rather than this offer', kind: 'representative' }] } };
}

if (process.argv.includes('--write-activity-fixtures')) {
  const { writeFile } = await import('node:fs/promises');
  const value = await createActivityFixtures();
  await writeFile(new URL('../../../blocks/gcsp/activity/activity-fixtures.js', import.meta.url),
    `// Generated synthetic snapshots. Regenerate through server/test/helpers/activity-fixtures.js.\nexport const activityFixtures = ${JSON.stringify(value, null, 2)};\n`);
}
