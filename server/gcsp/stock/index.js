import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { text, object, invalid, unavailable, validatePull } from './port.js';

export { createSyntheticStockProvider, createStockPullFixtureProvider } from './synthetic-provider.js';
export { createGeneratedStockProvider } from './generated-provider.js';
export { STOCK_PULL_VERSION } from './port.js';
export const STOCK_RELEASE_HANDLER = 'stock-release';
export const STOCK_RELEASE_CONSUMER = 'stock-release';
const QUEUE = 'stock-supply-queue';
const ref = (context, orderUuid) => ({ table: 'stock', key: { runId: context.runId, orderUuid } });
const identityMatches = (a, b) => ['orderUuid', 'orderNumber', 'configurationId', 'wholesalerOrderId', 'corpusVersion', 'revision']
  .every((key) => a[key] === b[key]);
const conflict = (reason) => result('conflict', { reason, current: {} });

export function createStockReleaseService({ repository, policy, clock, identity, provider }) {
  if (!repository || !policy || !clock || !identity || typeof provider?.pull !== 'function') {
    throw new TypeError('Inject repository, PolicyService, DemoClock, identity and a stock pull provider.');
  }
  let registration;
  async function settings(context, now) {
    const active = await policy.getActiveVersion({ runId: context.runId, asOf: now });
    if (active.status !== 'ok') return unavailable();
    const read = { runId: context.runId, asOf: now, policyVersion: active.policyVersion };
    const size = await policy.getAssumption('supply.release.size', read);
    const lead = await policy.getAssumption('supply.leadTimeDays', read);
    if (size.status !== 'ok' || lead.status !== 'ok' || size.policyVersion !== active.policyVersion
      || lead.policyVersion !== active.policyVersion || !Number.isSafeInteger(size.value.value) || size.value.value <= 0
      || !Number.isSafeInteger(lead.value.value) || lead.value.value < 0
      || !Number.isFinite(new Date(Date.parse(now) + lead.value.value * 86400000).getTime())) return unavailable();
    return ok({ releaseSize: size.value.value, leadTimeDays: lead.value.value, policyVersion: active.policyVersion });
  }
  async function current(context) {
    const time = await clock.now(context);
    if (time.status !== 'ok') return time;
    const run = await repository.currentRun(context.environmentId);
    if (run.status !== 'ok') return run.status === 'not-found' ? unavailable() : run;
    return run.value.runId === context.runId ? time : result('stale-run', { reason: 'The current demonstration run changed.' });
  }
  async function handle(tick) {
    const { context } = tick;
    const time = await current(context);
    if (time.status !== 'ok') return time;
    if (!validInstant(tick.now) || time.value.now !== tick.now || time.value.clockVersion !== tick.clockVersion) return conflict('release-clock-changed');
    const config = await settings(context, tick.now);
    if (config.status !== 'ok') return config;
    const releases = await repository.query(context, 'event_receipts', { consumerId: STOCK_RELEASE_CONSUMER, state: 'completed' });
    if (releases.status !== 'ok') return releases;
    const queued = await repository.query(context, 'event_receipts', { consumerId: QUEUE, state: 'completed' });
    if (queued.status !== 'ok') return queued;
    const request = { runId: context.runId, asOf: tick.now, eventId: tick.eventId, ...config.value,
      released: releases.value.map((row) => ({ trancheId: row.eventId, orderUuids: row.outcome.value.orderUuids })),
      queuedSupply: queued.value.map((row) => row.outcome.value) };
    let response;
    try { response = await provider.pull(structuredClone(request)); } catch { return unavailable(); }
    const pulled = validatePull(response, request);
    if (pulled.status !== 'ok') return pulled;
    const snapshot = pulled.value;
    return tick.transaction(async (tx) => {
      const run = await tx.get({ table: 'runs', key: { runId: context.runId } });
      if (run.status !== 'ok') return run;
      if (!run.value.current || run.value.status !== 'active') return result('stale-run', { reason: 'The current demonstration run changed.' });
      if (run.value.clockInstant !== tick.now || run.value.clockVersion !== tick.clockVersion) return conflict('release-clock-changed');
      const rows = await tx.list('stock');
      if (rows.status !== 'ok') return rows;
      for (const car of snapshot.stock) {
        const known = rows.value.find((row) => row.orderUuid === car.orderUuid);
        if (known && !identityMatches(known, car)) return conflict('stock-identity-changed');
      }
      const tranche = snapshot.tranche;
      const unseen = snapshot.stock.filter((car) => !rows.value.some((row) => row.orderUuid === car.orderUuid && row.state !== 'unreleased'));
      if (unseen.some((car) => !tranche?.orderUuids.includes(car.orderUuid))) return invalid('stock', 'Unreleased cars must belong to the reported tranche.');
      if (!tranche) return ok({ kind: 'no-release', runId: context.runId, tickId: tick.tickId, orderUuids: [] });
      const exact = snapshot.stock.filter((car) => tranche.orderUuids.includes(car.orderUuid));
      const digest = inputDigest({ tranche, stock: exact, source: snapshot.source });
      const receipt = await tx.getReceipt(STOCK_RELEASE_CONSUMER, tranche.trancheId);
      if (receipt.status === 'ok') return receipt.value.inputDigest === digest ? receipt.value.outcome : conflict('tranche-input-changed');
      if (receipt.status !== 'not-found') return receipt;
      if (tranche.orderUuids.length > config.value.releaseSize) return invalid('tranche', 'Release exceeds the policy size.');
      if (tranche.supplyId !== null) {
        const queue = await tx.getReceipt(QUEUE, tranche.supplyId);
        if (queue.status !== 'ok') return invalid('supplyId', 'Supply has not been confirmed and queued.');
        if (Date.parse(queue.value.outcome.value.eligibleFrom) > Date.parse(tick.now)) return invalid('supplyId', 'Confirmed supply is outside its policy lead time.');
      }
      const release = { trancheId: tranche.trancheId, windowId: tranche.windowId, supplyId: tranche.supplyId,
        releasedAt: tick.now, policyVersion: config.value.policyVersion, sourceVersion: snapshot.source.version };
      const added = [];
      for (const car of snapshot.stock) {
        const known = rows.value.find((row) => row.orderUuid === car.orderUuid);
        if (known && (known.state !== 'unreleased' || known.release)) continue;
        if (known && (known.held === true || known.allocated === true
          || known.status && known.status !== 'unreleased')) return conflict('unreleased-stock-occupied');
        if (!tranche.orderUuids.includes(car.orderUuid)) return invalid('tranche', 'Car is not in this release.');
        if (car.availability && Date.parse(car.availability.availableUntil) <= Date.parse(tick.now)) return invalid('availability', 'The source availability interval has ended.');
        const availability = { state: 'available', availableFrom: tick.now, version: tranche.trancheId,
          ...(car.availability ?? {}) };
        const state = { state: 'released', status: 'available', available: true, held: false, allocated: false,
          release: { ...release, availability } };
        const { availability: sourceAvailability, ...stockCar } = car;
        const written = known ? await tx.compareAndSwap(ref(context, car.orderUuid), known.version, state)
          : await tx.insert('stock', { ...stockCar, runId: context.runId, ...state });
        if (written.status !== 'ok') return written;
        added.push(car.orderUuid);
      }
      const outcome = ok({ kind: 'stock-released', runId: context.runId, trancheId: tranche.trancheId,
        windowId: tranche.windowId, supplyId: tranche.supplyId, tickId: tick.tickId, releasedAt: tick.now,
        orderUuids: added, visibleOrderUuids: tranche.orderUuids, policyVersion: config.value.policyVersion, source: snapshot.source });
      const recorded = await tx.recordReceipt({ consumerId: STOCK_RELEASE_CONSUMER, eventId: tranche.trancheId,
        eventType: 'stock-released', handlerId: STOCK_RELEASE_HANDLER, inputDigest: digest,
        inputVersions: { clock: tick.clockVersion, policy: config.value.policyVersion, source: snapshot.source.version }, state: 'completed', outcome });
      return recorded.status === 'ok' ? outcome : recorded;
    });
  }
  return Object.freeze({
    register() {
      registration ??= clock.registerHandler({ handlerId: STOCK_RELEASE_HANDLER, stage: 'release-pull', handle });
      return registration;
    },
    async queueConfirmedSupply(context, command, supply) {
      const allowed = await identity.requireRole(context, 'greg');
      if (allowed.status !== 'ok') return allowed;
      if (!object(command) || !text(command.commandId) || !object(supply)
        || Object.keys(supply).some((key) => !['runId', 'supplyId', 'state', 'confirmedAt', 'sourceVersion'].includes(key))
        || supply.runId !== context.runId || supply.state !== 'confirmed' || !text(supply.supplyId)
        || !text(supply.sourceVersion) || !validInstant(supply.confirmedAt)) return invalid('confirmedSupply', 'Supply a run-bound provider confirmation reference, without stock rows.');
      const time = await current(context);
      if (time.status !== 'ok') return time;
      if (Date.parse(supply.confirmedAt) > Date.parse(time.value.now)) return invalid('confirmedAt', 'A future confirmation is not confirmed supply.');
      const config = await settings(context, time.value.now);
      if (config.status !== 'ok') return config;
      const digest = inputDigest(supply);
      return repository.transaction(context, { commandId: `stock:queue:${command.commandId}`, inputDigest: digest }, async (tx) => {
        const prior = await tx.getReceipt(QUEUE, supply.supplyId);
        if (prior.status === 'ok') return prior.value.inputDigest === digest ? prior.value.outcome : conflict('confirmation-input-changed');
        if (prior.status !== 'not-found') return prior;
        const eligibleFrom = new Date(Date.parse(supply.confirmedAt) + config.value.leadTimeDays * 86400000).toISOString();
        const outcome = ok({ ...supply, eligibleFrom, policyVersion: config.value.policyVersion });
        const saved = await tx.recordReceipt({ consumerId: QUEUE, eventId: supply.supplyId, inputDigest: digest,
          eventType: 'confirmed-supply-queued', handlerId: STOCK_RELEASE_HANDLER, inputVersions: { policy: config.value.policyVersion }, state: 'completed', outcome });
        return saved.status === 'ok' ? outcome : saved;
      });
    },
  });
}
