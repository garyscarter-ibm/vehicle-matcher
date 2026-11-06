import { inputDigest, ok, result } from '../repository/core.js';
import { validInstant } from '../policy/file-provider.js';
export { createSyntheticProductionAdapter } from './synthetic-production.js';

const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fields = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const unavailable = (reason = 'Production adapter is unavailable. Retry without creating another request.') => result('unavailable', { reason, retryable: true });
const invalid = (field, reason) => result('invalid', { code: 'invalid-supply-command', reasons: [{ field, reason }] });
const conflict = (reason) => result('conflict', { reason, current: {} });
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
const provenance = (p) => object(p) && p.mode === 'synthetic' && text(p.providerId) && text(p.sourceVersion) && text(p.label);
const stale = (resource, expectedVersion, currentVersion) => result('stale-version', { resource, expectedVersion, currentVersion, action: 'refresh' });

export function createSupplyService({ repository, policy, clock, identity, production, releases } = {}) {
  if (!repository || !policy || !clock || !identity) throw new TypeError('Inject repository, PolicyService, DemoClock and identity.');
  async function current(context, role) {
    const allowed = await identity.requireRole(context, role); if (allowed.status !== 'ok') return allowed;
    const time = await clock.now(context); if (time.status !== 'ok') return time;
    const run = await repository.currentRun(context.environmentId); if (run.status !== 'ok') return run;
    if (run.value.runId !== context.runId) return result('stale-run', { reason: 'The demonstration run changed.' });
    if (!validInstant(time.value.now) || time.value.runId !== context.runId) return unavailable('The demo clock is unavailable.');
    if (run.value.policyVersion !== context.policyVersion) return stale({ table: 'policy' }, context.policyVersion, run.value.policyVersion);
    return ok({ now: time.value.now, clockVersion: time.value.clockVersion, policyVersion: run.value.policyVersion });
  }
  const cmd = (context, operation, input) => ({ commandId: `supply:${operation}:${context.principalId}:${input.commandId}`, inputDigest: inputDigest(input) });
  async function replay(context, command) {
    const found = await repository.read(context, ref(context, 'event_receipts', { consumerId: 'command:transaction', eventId: command.commandId }));
    return found.status === 'not-found' ? null : found.status !== 'ok' ? found
      : found.value.inputDigest === command.inputDigest ? found.value.outcome : conflict('idempotency-input-changed');
  }
  async function describe() {
    try {
      const out = await production?.describe?.();
      return out?.status === 'ok' && provenance(out.value?.provenance) && Array.isArray(out.value.choices)
        && out.value.choices.every((c) => fields(c, ['model', 'derivative']) && text(c.model) && text(c.derivative)) ? out : unavailable();
    } catch { return unavailable(); }
  }
  async function fence(tx, context, time) {
    const run = await tx.get(ref(context, 'runs', {})); if (run.status !== 'ok') return run;
    if (!run.value.current || run.value.status !== 'active') return result('stale-run', { reason: 'The demonstration run changed.' });
    if (run.value.policyVersion !== time.policyVersion || run.value.clockVersion !== time.clockVersion) return conflict('Supply inputs changed. Refresh before submitting.');
    return ok(run.value);
  }
  async function callProduction(method, value) {
    try {
      const out = await production?.[method]?.(structuredClone(value));
      return object(out) && ['ok', 'invalid', 'unavailable', 'conflict', 'stale-version'].includes(out.status) ? out : unavailable();
    } catch { return unavailable(); }
  }
  const methods = {
    async submit(context, input) {
      const time = await current(context, 'greg'); if (time.status !== 'ok') return time;
      if (!fields(input, ['commandId', 'model', 'derivative', 'quantity', 'expectedPolicyVersion', 'expectedStockVersion'])
        || !['commandId', 'model', 'derivative', 'expectedPolicyVersion', 'expectedStockVersion'].every((k) => text(input[k]))
        || !positive(input.quantity)) return invalid('request', 'Supply model, derivative, positive quantity and current policy/stock versions.');
      const command = cmd(context, 'submit', input); const prior = await replay(context, command); if (prior) return prior;
      if (input.expectedPolicyVersion !== time.value.policyVersion) return stale({ table: 'policy' }, input.expectedPolicyVersion, time.value.policyVersion);
      const rows = await repository.query(context, 'stock'); if (rows.status !== 'ok') return rows;
      const stockVersion = inputDigest(rows.value);
      if (input.expectedStockVersion !== stockVersion) return stale({ table: 'stock' }, input.expectedStockVersion, stockVersion);
      const requestId = `request-${inputDigest([context.runId, context.principalId, input.commandId]).slice(0, 32)}`;
      const response = await callProduction('submit', { runId: context.runId, requestId, commandId: command.commandId,
        input: { model: input.model, derivative: input.derivative, quantity: input.quantity }, requestedAt: time.value.now });
      if (response.status !== 'ok') return response;
      if (!fields(response.value, ['state', 'providerReference', 'provenance']) || response.value.state !== 'requested'
        || !text(response.value.providerReference) || !provenance(response.value.provenance)) return unavailable('Production did not acknowledge request intent.');
      const authorized = await identity.requireRole(context, 'greg'); if (authorized.status !== 'ok') return authorized;
      return repository.transaction(context, command, async (tx) => {
        const valid = await fence(tx, context, time.value); if (valid.status !== 'ok') return valid;
        const stock = await tx.list('stock'); if (stock.status !== 'ok') return stock;
        if (inputDigest(stock.value) !== stockVersion) return conflict('Stock changed during submission. Refresh before retrying.');
        const added = await tx.insert('future_order_requests', { runId: context.runId, requestId, commandId: input.commandId,
          model: input.model, derivative: input.derivative, quantity: input.quantity, state: 'requested', requestedAt: time.value.now,
          requestedBy: context.principalId, policyVersion: time.value.policyVersion, stockVersion,
          providerReference: response.value.providerReference, provenance: response.value.provenance, history: [] });
        return added.status === 'ok' ? ok({ request: added.value }) : added;
      });
    },
    async stepProduction(context, input) {
      const time = await current(context, 'presenter'); if (time.status !== 'ok') return time;
      if (!fields(input, ['commandId', 'requestId', 'expectedVersion', 'action', 'quantity', 'delayUntil', 'reason'])
        || !text(input.commandId) || !text(input.requestId) || !positive(input.expectedVersion)
        || !['confirm', 'delay'].includes(input.action)) return invalid('production', 'Supply a request/version and confirm or delay action.');
      if (input.action === 'confirm' && (!positive(input.quantity) || input.delayUntil !== undefined || input.reason !== undefined)
        || input.action === 'delay' && (input.quantity !== undefined || !validInstant(input.delayUntil)
          || !text(input.reason))) return invalid('production', 'Confirm a positive quantity, or supply a future delay date and reason.');
      const command = cmd(context, 'production', input); const prior = await replay(context, command); if (prior) return prior;
      if (input.action === 'delay' && Date.parse(input.delayUntil) <= Date.parse(time.value.now)) return invalid('delayUntil', 'Supply a future delay date.');
      const requestRef = ref(context, 'future_order_requests', { requestId: input.requestId });
      const found = await repository.read(context, requestRef); if (found.status !== 'ok') return found;
      if (found.value.version !== input.expectedVersion) return stale(requestRef, input.expectedVersion, found.value.version);
      const confirmed = await repository.query(context, 'confirmed_supply', { requestId: input.requestId }); if (confirmed.status !== 'ok') return confirmed;
      const remaining = found.value.quantity - confirmed.value.reduce((n, s) => n + s.quantity, 0);
      if (remaining <= 0 || input.action === 'confirm' && input.quantity > remaining) return conflict('Production cannot confirm more than the outstanding request.');
      const lead = await policy.getAssumption('supply.leadTimeDays', { runId: context.runId, policyVersion: time.value.policyVersion, asOf: time.value.now });
      if (lead.status !== 'ok' || lead.policyVersion !== time.value.policyVersion || !Number.isSafeInteger(lead.value.value) || lead.value.value < 0) return unavailable('The supply lead-time policy is unavailable.');
      // A new acknowledgement supersedes a prior delay for this quantity. F92's
      // queue derives eligibility from this same confirmation instant and policy.
      const expected = Date.parse(time.value.now) + lead.value.value * 86400000;
      if (!Number.isFinite(new Date(expected).getTime())) return unavailable('The supply lead-time policy is invalid.');
      const response = await callProduction('respond', { runId: context.runId, request: found.value, input,
        now: time.value.now, expectedAt: new Date(expected).toISOString() });
      if (response.status !== 'ok') return response;
      const ack = response.value;
      if (!object(ack) || !provenance(ack.provenance) || !text(ack.providerReference)
        || input.action === 'delay' && (!fields(ack, ['state', 'delayUntil', 'reason', 'providerReference', 'provenance'])
          || ack.state !== 'delayed' || ack.delayUntil !== input.delayUntil || ack.reason !== input.reason)
        || input.action === 'confirm' && (!fields(ack, ['state', 'quantity', 'confirmedAt', 'expectedAt', 'supplyId', 'providerReference', 'provenance'])
          || ack.state !== 'confirmed' || ack.quantity !== input.quantity || ack.confirmedAt !== time.value.now
          || !text(ack.supplyId) || !validInstant(ack.expectedAt) || Date.parse(ack.expectedAt) !== expected)) return unavailable('Production acknowledgement is invalid.');
      const authorized = await identity.requireRole(context, 'presenter'); if (authorized.status !== 'ok') return authorized;
      return repository.transaction(context, command, async (tx) => {
        const valid = await fence(tx, context, time.value); if (valid.status !== 'ok') return valid;
        const request = await tx.get(requestRef); if (request.status !== 'ok') return request;
        if (request.value.version !== input.expectedVersion) return stale(requestRef, input.expectedVersion, request.value.version);
        let supply = null;
        if (ack.state === 'confirmed') {
          const added = await tx.insert('confirmed_supply', { runId: context.runId, supplyId: ack.supplyId, requestId: input.requestId,
            commandId: input.commandId, quantity: ack.quantity, state: 'confirmed', confirmedAt: ack.confirmedAt, expectedAt: ack.expectedAt,
            policyVersion: time.value.policyVersion, sourceVersion: ack.provenance.sourceVersion,
            providerReference: ack.providerReference, provenance: ack.provenance });
          if (added.status !== 'ok') return added; supply = added.value;
        }
        const state = ack.state === 'delayed' ? 'delayed' : input.quantity === remaining ? 'confirmed' : 'partly-confirmed';
        const history = [...request.value.history, { state: ack.state, at: time.value.now, actor: context.principalId,
          providerReference: ack.providerReference, provenance: ack.provenance,
          ...(supply ? { supplyId: supply.supplyId, quantity: supply.quantity, expectedAt: supply.expectedAt }
            : { until: ack.delayUntil, reason: ack.reason }) }];
        const changed = await tx.compareAndSwap(requestRef, input.expectedVersion, { state, history });
        return changed.status === 'ok' ? ok({ request: changed.value, supply }) : changed;
      });
    },
    async queueConfirmed(context, input) {
      const time = await current(context, 'greg'); if (time.status !== 'ok') return time;
      if (!fields(input, ['commandId', 'requestId']) || !text(input.commandId) || !text(input.requestId)) return invalid('queue', 'Supply request and command IDs.');
      const request = await repository.read(context, ref(context, 'future_order_requests', { requestId: input.requestId }));
      if (request.status !== 'ok') return request;
      const supplies = await repository.query(context, 'confirmed_supply', { requestId: input.requestId }); if (supplies.status !== 'ok') return supplies;
      if (typeof releases?.queueConfirmedSupply !== 'function') return unavailable('Confirmed supply is saved; the release queue is unavailable. Retry queueing.');
      const queued = [];
      for (const supply of supplies.value) {
        const reference = { runId: context.runId, supplyId: supply.supplyId, state: supply.state,
          confirmedAt: supply.confirmedAt, sourceVersion: supply.sourceVersion };
        let out; try { out = await releases.queueConfirmedSupply(context,
          { commandId: `${input.commandId}:${supply.supplyId}` }, reference); } catch { return unavailable('Confirmed supply is saved; release queueing failed. Retry queueing.'); }
        if (out?.status !== 'ok') return out?.status ? out : unavailable();
        queued.push(out.value);
      }
      return ok({ requestId: input.requestId, queued });
    },
    async readTracking(context) {
      const time = await current(context, 'greg'); if (time.status !== 'ok') return time;
      const names = ['future_order_requests', 'confirmed_supply', 'stock', 'event_receipts'];
      const load = async () => {
        const values = await Promise.all(names.map((t) => repository.query(context, t)));
        const error = values.find((v) => v.status !== 'ok');
        return error ? { error } : Object.fromEntries(names.map((t, i) => [t, values[i].value]));
      };
      const rows = await load(); if (rows.error) return rows.error;
      const adapter = await describe(); const requests = [];
      for (const request of rows.future_order_requests) {
        const supplies = rows.confirmed_supply.filter((s) => s.requestId === request.requestId);
        const released = new Set(); const releaseTimes = [];
        for (const receipt of rows.event_receipts.filter((r) => r.consumerId === 'stock-release' && r.state === 'completed'
          && r.eventType === 'stock-released' && r.outcome?.status === 'ok'
          && supplies.some((s) => s.supplyId === r.outcome.value?.supplyId))) {
          const value = receipt.outcome.value;
          if (value.runId !== context.runId || value.kind !== 'stock-released' || value.trancheId !== receipt.eventId
            || !Array.isArray(value.orderUuids) || !value.orderUuids.every(text) || !validInstant(value.releasedAt)
            || Date.parse(value.releasedAt) > Date.parse(time.value.now)) return unavailable('Release provenance is unavailable.');
          for (const id of value.orderUuids) {
            const stock = rows.stock.find((s) => s.orderUuid === id);
            if (!stock || stock.release?.supplyId !== value.supplyId || stock.release?.trancheId !== value.trancheId
              || stock.release?.releasedAt !== value.releasedAt || stock.release?.sourceVersion !== value.source?.version
              || stock.release?.policyVersion !== value.policyVersion || !['released', 'held', 'allocated'].includes(stock.state)) return unavailable('Release provenance is unavailable.');
            released.add(id);
          }
          if (value.orderUuids.length) releaseTimes.push(value.releasedAt);
        }
        const confirmedQuantity = supplies.reduce((n, s) => n + s.quantity, 0);
        if (confirmedQuantity > request.quantity || released.size > confirmedQuantity) return unavailable('Supply quantities disagree with their release history.');
        const delay = confirmedQuantity < request.quantity ? request.history.filter((h) => h.state === 'delayed').at(-1) ?? null : null;
        const queued = supplies.map((s) => ({ supplyId: s.supplyId, quantity: s.quantity, expectedAt: s.expectedAt,
          queued: rows.event_receipts.some((r) => r.consumerId === 'stock-supply-queue' && r.eventId === s.supplyId
            && r.state === 'completed' && r.outcome?.status === 'ok') }));
        requests.push({ ...request, stage: released.size ? released.size === request.quantity ? 'released' : 'partly-released' : request.state,
          confirmedQuantity, releasedQuantity: released.size, outstandingQuantity: request.quantity - confirmedQuantity,
          supplies: queued, delay, latestReleasedAt: releaseTimes.sort().at(-1) ?? null });
      }
      const after = await load(); if (after.error) return after.error;
      const end = await current(context, 'greg'); if (end.status !== 'ok') return end;
      if (inputDigest(rows) !== inputDigest(after) || time.value.clockVersion !== end.value.clockVersion) return conflict('Order tracking changed during the read. Refresh.');
      return ok({ runId: context.runId, asOf: time.value.now, versions: { policy: time.value.policyVersion,
        stock: inputDigest(rows.stock), clock: time.value.clockVersion }, requests,
        adapter: adapter.status === 'ok' ? { status: 'ready', ...adapter.value } : { status: 'unavailable' } });
    },
  };
  return Object.freeze(methods);
}
