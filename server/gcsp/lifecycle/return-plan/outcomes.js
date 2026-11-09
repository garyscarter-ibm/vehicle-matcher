import { inputDigest, ok, result } from '../../repository/index.js';
import { validInstant } from '../../policy/file-provider.js';
import { RETURN_OUTCOME_OPERATION } from '../../adapters/synthetic-return-outcomes.js';
import { readRenewalAuthority } from '../approvals/source.js';
import { applyCurrentCarEvent } from '../current-car/index.js';
import { loadReturnOutcomePolicy, loadReturnPolicy } from './policy.js';

// FUCQ-168: returned and missed outcomes of a scheduled return, recorded apart from the return appointment itself.
export const RETURN_OUTCOME_HANDLER_ID = 'lifecycle-return-outcomes';
export const RETURN_OUTCOME_STATE = 'lifecycle-return-outcomes:state:v1';
export const RETURN_EXCEPTION_CONSUMER = 'lifecycle-return:exceptions:v1';
const RETURN_APPOINTMENT_STATE = 'lifecycle-return-appointments:state:v1';
const COMMANDS = 'lifecycle-return-outcomes';
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const stateRef = (runId, orderUuid) => ({ table: 'event_receipts', key: { runId, consumerId: RETURN_OUTCOME_STATE, eventId: orderUuid } });
const opRef = (runId, operationId) => ({ table: 'pending_operations', key: { runId, operationId } });
const unavailable = () => result('unavailable', { code: 'return-outcomes-unavailable', retryable: true, reason: 'Return outcomes are unavailable. Try again shortly.' });
const plusSeconds = (instant, seconds) => new Date(Date.parse(instant) + seconds * 1000).toISOString();

export class ReturnOutcomeRecorder {
  #repository; #policy; #clock; #provider; #describe; #start;
  constructor({ repository, policy, clock, provider, describe } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#provider = provider; this.#describe = describe;
  }

  start() {
    this.#start ??= this.#clock?.registerHandler({ handlerId: RETURN_OUTCOME_HANDLER_ID, stage: 'pending-reconciliation',
      handle: (tick) => this.#safe(() => this.#tick(tick)) }) ?? Promise.resolve(unavailable());
    return this.#start;
  }

  async #safe(work) { try { return await work(); } catch { return unavailable(); } }
  #system(context) { return { environmentId: context.environmentId, runId: context.runId, principalId: RETURN_OUTCOME_HANDLER_ID, roles: [] }; }

  // The recorded outcome projection for one order, or null while the return has none.
  async read(context, orderUuid) {
    const found = await this.#repository.read(context, stateRef(context.runId, orderUuid));
    return found.status === 'not-found' ? ok(null) : found.status === 'ok' ? ok(found.value.outcome.value) : found;
  }

  async #tick({ context, tickId, now }) {
    if (!this.#repository || !this.#policy) return unavailable();
    const system = this.#system(context);
    const run = await this.#repository.read(system, { table: 'tick_runs', key: { runId: system.runId, tickId } }); if (run.status !== 'ok') return run;
    const startup = run.value.targetClock?.kind === 'startup';
    const rows = await this.#repository.query(system, 'event_receipts', { consumerId: RETURN_APPOINTMENT_STATE }); if (rows.status !== 'ok') return rows;
    const summary = { handlerId: RETURN_OUTCOME_HANDLER_ID, orders: rows.value.length, applied: 0, waiting: 0, blocked: 0, uncertain: 0, idle: 0, failed: [] };
    // One order's failure is recorded and skipped; stable operation IDs make the retry safe.
    for (const row of [...rows.value].sort((a, b) => (a.eventId < b.eventId ? -1 : 1))) {
      let step; try { step = await this.#progress(system, tickId, now, startup, row.outcome.value); } catch { step = unavailable(); }
      if (step.status !== 'ok') { summary.failed.push({ orderUuid: row.eventId, status: step.status, code: step.code ?? null }); continue; }
      summary[['applied', 'waiting', 'blocked', 'uncertain'].includes(step.value) ? step.value : 'idle'] += 1;
    }
    summary.failed = summary.failed.slice(0, 20);
    return ok(summary);
  }

  // Startup only reconciles uncertain writes; a new outcome starts on a presenter tick once the return is scheduled.
  async #progress(system, tickId, now, startup, a) {
    const existing = await this.#repository.read(system, stateRef(system.runId, a.orderUuid));
    if (existing.status === 'ok') {
      const p = existing.value.outcome.value; if (p.state !== 'awaiting') return ok('idle');
      const op = await this.#repository.read(system, opRef(system.runId, p.operationId)); if (op.status !== 'ok') return op;
      if (op.value.state !== 'pending') return ok('idle');
      return this.#recover(system, op.value, now, tickId, !startup, p.policyVersion);
    }
    if (existing.status !== 'not-found') return existing;
    if (startup || a.state !== 'scheduled' || a.pending || !object(a.slot)) return ok('idle');
    const config = await loadReturnOutcomePolicy(this.#policy, { runId: system.runId, asOf: now, policyVersion: a.policyVersion }); if (config.status !== 'ok') return config;
    if (!config.value.enabled) return ok('idle');
    // Without the outcome step composed, only an enabled scenario needs it; that order is reported as failed.
    if (typeof this.#provider?.confirmOutcome !== 'function' || typeof this.#provider?.reconcile !== 'function') return unavailable();
    const described = await this.#describe(system, a, now); if (described.status !== 'ok') return described;
    const opened = await this.#open(system, a, config.value, described.value); if (opened.status !== 'ok') return opened;
    return opened.value.state === 'pending' ? this.#write(system, opened.value, now, tickId, a.policyVersion) : ok('idle');
  }

  // One transaction creates the outcome projection and its operation, pinning the keyed scenario and exception type.
  #open(system, a, config, d) {
    const operationId = `return-outcome:${inputDigest([system.runId, a.orderUuid]).slice(0, 32)}:outcome`;
    const appointment = { purpose: 'return', slotId: a.slot.slotId, slot: a.slot, providerReference: a.history.at(-1)?.providerReference ?? null };
    const payload = { context: system, orderUuid: a.orderUuid, step: 'outcome', slot: a.slot, confirmAfter: plusSeconds(a.slot.end, config.delaySecondsAfterSlotEnd),
      outcome: config.outcome, appointment };
    const { context: _context, ...stable } = payload;
    const operation = { runId: system.runId, operationId, operationType: RETURN_OUTCOME_OPERATION, idempotencyKey: operationId, inputDigest: inputDigest(stable),
      payload, state: 'pending', lastKnownState: 'waiting', attempts: 0 };
    const projection = { schemaVersion: 1, runId: system.runId, orderUuid: a.orderUuid, employeeId: d.employeeId, policyVersion: a.policyVersion, state: 'awaiting',
      operationId, appointment, location: d.location, oldContractId: d.oldContractId, entitlementSlotId: d.entitlementSlotId, exceptionType: config.exceptionType,
      at: null, providerReference: null, pending: { operationId, lastKnownState: 'waiting' }, blocked: null };
    return this.#repository.transaction(system, { commandId: `${COMMANDS}:open:${a.orderUuid}`, inputDigest: inputDigest([a.orderUuid, a.slot.slotId, a.policyVersion]) }, async (tx) => {
      const prior = await tx.get(opRef(system.runId, operationId));
      if (prior.status === 'ok') return ok(prior.value);
      if (prior.status !== 'not-found') return prior;
      const inserted = await tx.insert('pending_operations', operation); if (inserted.status !== 'ok') return inserted;
      const stored = await tx.insert('event_receipts', { runId: system.runId, consumerId: RETURN_OUTCOME_STATE, eventId: a.orderUuid,
        inputDigest: inputDigest({ orderUuid: a.orderUuid, operationId }), eventType: 'lifecycle-return-outcome-state', handlerId: RETURN_OUTCOME_HANDLER_ID,
        inputVersions: { policy: a.policyVersion }, state: 'projection', outcome: ok(projection) });
      return stored.status === 'ok' ? ok(inserted.value) : stored;
    });
  }

  // Provider calls run outside transactions; a throw or timeout is an unknown outcome reconciled under the same operation ID.
  async #call(policyVersion, now, method, ...args) {
    const config = await loadReturnPolicy(this.#policy, { runId: args[0].runId, asOf: now, policyVersion });
    if (config.status !== 'ok') return { status: 'unknown' };
    let timer;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'unknown' }), config.value.providerTimeoutMs); });
      return await Promise.race([Promise.resolve().then(() => this.#provider[method](...args.map((v) => structuredClone(v)))), timeout]);
    } catch { return { status: 'unknown' }; } finally { clearTimeout(timer); }
  }

  async #write(system, operation, now, tag, policyVersion) {
    return this.#settle(system, operation, await this.#call(policyVersion, now, 'confirmOutcome', operation, now), tag);
  }

  // Only `not-found` allows the same write again, and only on a presenter tick.
  async #recover(system, operation, now, tag, retry, policyVersion) {
    let response = await this.#call(policyVersion, now, 'reconcile', operation);
    if (response?.status === 'not-found' && response.operationId === operation.operationId) {
      if (!retry) return ok('waiting');
      response = await this.#call(policyVersion, now, 'confirmOutcome', operation, now);
    }
    return this.#settle(system, operation, response, tag);
  }

  async #settle(system, operation, r, tag) {
    const { orderUuid } = operation.payload; const runId = system.runId;
    const good = object(r) && r.operationId === operation.operationId && r.orderUuid === orderUuid && r.step === 'outcome' && r.status === operation.payload.outcome
      && text(r.providerReference, 128) && validInstant(r.at);
    const waiting = r?.status === 'in-progress' && r.operationId === operation.operationId;
    const refused = r?.status === 'unsupported';
    const label = good ? 'applied' : waiting ? 'waiting' : refused ? 'blocked' : 'uncertain';
    return this.#repository.transaction(system, { commandId: `${COMMANDS}:settle:${operation.operationId}:${good ? 'done' : tag}`,
      inputDigest: inputDigest(good ? r : { label, code: r?.code ?? null }) }, async (tx) => {
      const fresh = await tx.get(opRef(runId, operation.operationId)); if (fresh.status !== 'ok') return fresh;
      if (fresh.value.state !== 'pending') return ok('settled');
      const found = await tx.get(stateRef(runId, orderUuid)); if (found.status !== 'ok') return found;
      const p = found.value.outcome.value; if (p.state !== 'awaiting') return ok('settled');
      let next = p; let patch = null;
      if (good) {
        next = { ...p, state: r.status, at: r.at, providerReference: r.providerReference, pending: null, blocked: null };
        patch = { state: 'completed', lastKnownState: r.status, providerReference: r.providerReference, outcome: r };
        const done = r.status === 'returned' ? await this.#returned(tx, runId, p, r) : await this.#missed(tx, runId, p, r);
        if (done.status !== 'ok') return done;
      } else if (waiting) {
        if (fresh.value.lastKnownState !== 'waiting') patch = { lastKnownState: 'waiting' };
      } else if (refused) {
        next = { ...p, pending: null, blocked: { code: r.code ?? 'unsupported', reason: r.reason ?? 'This update is not supported.' } };
        patch = { lastKnownState: 'unsupported', attempts: fresh.value.attempts + 1, outcome: { status: 'unsupported', code: r.code ?? 'unsupported', reason: r.reason ?? null } };
      } else {
        next = { ...p, blocked: null, pending: { operationId: operation.operationId, lastKnownState: 'unknown' } };
        patch = { lastKnownState: 'unknown', attempts: fresh.value.attempts + 1, outcome: { status: 'unknown' } };
      }
      if (patch) { const changed = await tx.compareAndSwap(opRef(runId, operation.operationId), fresh.value.version, patch); if (changed.status !== 'ok') return changed; }
      if (JSON.stringify(next) !== JSON.stringify(p)) {
        const stored = await tx.compareAndSwap(stateRef(runId, orderUuid), found.value.version, { outcome: ok(next) }); if (stored.status !== 'ok') return stored;
      }
      return ok(label);
    });
  }

  // A confirmed return changes the current-car relationship in the same transaction as the outcome.
  #returned(tx, runId, p, r) {
    return applyCurrentCarEvent(tx, runId, { type: 'return-confirmed', orderUuid: p.orderUuid, employeeId: p.employeeId, occurredAt: r.at,
      providerReference: r.providerReference, oldContractId: p.oldContractId, location: p.location,
      appointment: { purpose: 'return', slotId: p.appointment.slotId, providerReference: p.appointment.providerReference } });
  }

  // A missed return keeps her current car and emits the keyed lifecycle-exception receipt the renewal-risk trigger reads.
  async #missed(tx, runId, p, r) {
    const renewal = await readRenewalAuthority((ref) => tx.get(ref), runId, { employeeId: p.employeeId, entitlementSlotId: p.entitlementSlotId });
    if (renewal.status !== 'ok') return renewal;
    const value = { employeeId: p.employeeId, renewalId: renewal.value.renewalId, orderUuid: p.orderUuid, occurredAt: r.at, exceptionType: p.exceptionType,
      oldContractId: p.oldContractId, entitlementSlotId: p.entitlementSlotId, renewalAuthority: renewal.value.renewalId ? 'validated' : 'missing',
      location: p.location, appointment: { purpose: 'return', slotId: p.appointment.slotId, providerReference: p.appointment.providerReference },
      providerReference: r.providerReference, policyVersion: p.policyVersion, fictional: true };
    return tx.recordReceipt({ consumerId: RETURN_EXCEPTION_CONSUMER, eventId: `${p.orderUuid}:return-missed`, eventType: p.exceptionType, handlerId: RETURN_OUTCOME_HANDLER_ID,
      inputDigest: inputDigest(value), inputVersions: { policy: p.policyVersion }, state: 'completed', outcome: ok(value) });
  }
}
