import { inputDigest, ok, result } from '../../repository/index.js';
import { DECISION_OPERATION } from '../../adapters/synthetic-ordering-status.js';
import { loadLifecyclePolicy, SELECTION_STAGE } from './policy.js';
import { enumerateSelectionOrders, findSelectionOrder, listSelectionOrders, readRenewalAuthority } from './source.js';

export const CONTRACT = 'lifecycle.stages.v1';
export const HANDLER_ID = 'lifecycle-approvals';
export const HANDLER_STAGE = 'pending-reconciliation';
export const EXCEPTION_CONSUMER = 'lifecycle:exceptions';
const ORDER_FAILURES = ['lifecycle-policy-unavailable', 'lifecycle-policy-invalid', 'selection-source-invalid'];
const MAX_FAILED = 20;
export const revisionConsumer = (orderUuid) => `lifecycle:approval:${orderUuid}`;
const revisionEvent = (n) => `revision:${String(n).padStart(6, '0')}`;
const decisionId = (runId, orderUuid, stage) => `lifecycle-approval:${inputDigest([runId, orderUuid, stage])}`;
const ref = (runId, table, key) => ({ table, key: { runId, ...key } });
// Validated only with both a slot and a renewal; otherwise the renewal ID is withheld (FUCQ-116 consumer rule).
const authority = (slot, renewalId) => (typeof slot === 'string' && slot && renewalId ? { renewalId, renewalAuthority: 'validated' }
  : { renewalId: null, renewalAuthority: 'missing' });
const command = (commandId, value) => ({ commandId, inputDigest: inputDigest(value) });
const unavailable = () => result('unavailable', { retryable: true, reason: 'Order progress is unavailable. Try again shortly.' });
// Repository writes made by the tick handler carry a system principal, never the presenter's identity.
const systemContext = (context) => ({ environmentId: context.environmentId, runId: context.runId, principalId: HANDLER_ID, roles: [] });

export class LifecycleApprovalService {
  #repository; #policy; #clock; #identity; #status; #start; #port; #handover;
  // `handover` is FUCQ-167's appointment outcome port; its completed handover becomes the final tracker stage (FUCQ-253).
  constructor({ repository, policy, clock, identity, status, handover } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity; this.#status = status; this.#handover = handover;
  }

  start() {
    this.#start ??= this.#clock?.registerHandler({ handlerId: HANDLER_ID, stage: HANDLER_STAGE, handle: (tick) => this.#safe(() => this.#tick(tick)) })
      ?? Promise.resolve(unavailable());
    return this.#start;
  }

  async #safe(work) { try { return await work(); } catch { return unavailable(); } }

  async #role(context) {
    if (!this.#identity) return unavailable();
    for (const role of ['employee', 'greg', 'presenter']) {
      const allowed = await this.#identity.requireRole(context, role);
      if (allowed.status === 'ok') return ok(role);
      if (allowed.status !== 'forbidden') return allowed;
    }
    return result('forbidden', { reason: 'Order progress needs an employee, Greg or presenter session.' });
  }

  #policyFor(context, source, asOf) {
    return loadLifecyclePolicy(this.#policy, { runId: context.runId, asOf, policyVersion: source.source.policyVersion }, source.source.approvalStages);
  }

  async #revisions(list, orderUuid) {
    const rows = await list('event_receipts', { consumerId: revisionConsumer(orderUuid) });
    if (rows.status !== 'ok') return rows;
    const values = rows.value.filter((r) => r.state === 'completed' && r.outcome?.status === 'ok').map((r) => r.outcome.value)
      .sort((a, b) => a.lifecycleRevision - b.lifecycleRevision);
    return ok(values.at(-1) ?? null);
  }

  // Revision 0 is derived from the acknowledged selection alone; nothing is persisted until the first tick.
  #initial(source, policy) {
    return { schemaVersion: 1, lifecycleRevision: 0, runId: source.runId, orderUuid: source.orderUuid, employeeId: source.employeeId,
      entitlementSlotId: source.entitlementSlotId, route: source.route, source: source.source, policyVersion: policy.policyVersion,
      stageList: policy.stageList, outcome: 'in-progress', currentStage: SELECTION_STAGE, transition: null,
      stages: policy.stageList.map((stage, index) => index === 0
        ? { stage, state: 'approved', at: source.source.receivedAt, providerReference: source.source.providerReference, operationId: source.source.operationId }
        : { stage, state: 'not-started', at: null, providerReference: null, operationId: null }) };
  }

  // A completed handover is derived at read time from the appointment projection; the stored revision is unchanged.
  #handedOver(record, handover) {
    if (!handover || record.stageList.includes(handover.stage)) return record;
    const row = { stage: handover.stage, state: 'approved', at: handover.at, providerReference: handover.providerReference, operationId: null };
    return { ...record, stageList: [...record.stageList, handover.stage], stages: [...record.stages, row], currentStage: handover.stage, outcome: 'handed-over' };
  }

  #project(stored, policy, renewalId, operation, asOf, handover = null) {
    const record = this.#handedOver(stored, handover);
    const step = record !== stored ? handover : record.outcome === 'in-progress' ? policy.ownership.stages[record.currentStage] : policy.ownership.outcomes[record.outcome];
    const blocked = operation?.state === 'pending' && operation.lastKnownState === 'unsupported'
      ? { code: operation.outcome?.code ?? 'unsupported', reason: operation.outcome?.reason ?? 'This approval update is not supported.' }
      : operation?.state === 'pending' && operation.lastKnownState === 'unknown'
        ? { code: 'provider-uncertain', reason: 'Waiting for the approval system to confirm the last update.' } : null;
    return { contractVersion: CONTRACT, schemaVersion: 1, runId: record.runId, orderUuid: record.orderUuid, employeeId: record.employeeId,
      entitlementSlotId: record.entitlementSlotId, ...authority(record.entitlementSlotId, renewalId), route: record.route,
      source: { orderReference: null, ...record.source }, policyVersion: policy.policyVersion, policy: { policyVersion: policy.policyVersion, provenance: policy.provenance },
      lifecycleRevision: record.lifecycleRevision, asOf, stageList: record.stageList, currentStage: record.currentStage,
      stages: record.stages, owner: step.owner, nextStep: step.nextStep, outcome: record.outcome, blocked,
      provider: { mode: this.#status?.mode ?? null, provider: this.#status?.provider ?? null, synthetic: this.#status?.mode === 'synthetic' } };
  }

  read(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context); if (role.status !== 'ok') return role;
    return this.#readAs(context, input, role.value);
  }); }

  listOrders(context) { return this.#safe(async () => {
    const role = await this.#role(context); if (role.status !== 'ok') return role;
    return this.#listAs(context, role.value);
  }); }

  // Server-internal port for DemoClock handlers (FUCQ-116): no route and no browser role check. The clock's
  // current-run check and run-bound repository reads still refuse any other run or environment.
  stagePort() {
    this.#port ??= Object.freeze({ contractVersion: CONTRACT,
      read: (context, input = {}) => this.#safe(() => this.#readAs(context, input, 'system')),
      listOrders: (context) => this.#safe(() => this.#listAs(context, 'system')) });
    return this.#port;
  }

  async #readAs(context, input, scope) {
    if (!input || typeof input.orderUuid !== 'string' || !input.orderUuid || input.orderUuid.length > 128
      || Object.keys(input).some((k) => k !== 'orderUuid')) {
      return result('invalid', { code: 'invalid-order', reasons: [{ field: 'orderUuid', reason: 'Choose an order to view.' }] });
    }
    if (!this.#repository || !this.#clock || !this.#policy) return unavailable();
    const time = await this.#clock.now(context); if (time.status !== 'ok') return time;
    const query = (table, filter) => this.#repository.query(context, table, filter);
    const source = await findSelectionOrder(query, input.orderUuid, scope === 'employee' ? context.employeeId : undefined);
    if (source.status !== 'ok') return source;
    return this.#view(context, source.value, time.value.now);
  }

  // One order's pinned-policy or source defect is listed in `failed` (bounded) and skipped; global failures still refuse.
  async #listAs(context, scope) {
    if (!this.#repository || !this.#clock || !this.#policy) return unavailable();
    const time = await this.#clock.now(context); if (time.status !== 'ok') return time;
    const found = await enumerateSelectionOrders((table, filter) => this.#repository.query(context, table, filter));
    if (found.status !== 'ok') return found;
    const mine = (o) => scope !== 'employee' || o.employeeId === context.employeeId;
    const views = []; const failed = found.value.invalid.filter(mine).map(({ orderUuid, status, code }) => ({ orderUuid, status, code }));
    for (const source of found.value.orders.filter(mine).sort((a, b) => (a.orderUuid < b.orderUuid ? -1 : 1))) {
      const view = await this.#view(context, source, time.value.now);
      if (view.status === 'ok') views.push(view.value);
      else if (view.scope !== 'policy-wide' && ORDER_FAILURES.includes(view.code)) failed.push({ orderUuid: source.orderUuid, status: view.status, code: view.code });
      else return view;
    }
    return ok({ contractVersion: CONTRACT, asOf: time.value.now, orders: views,
      failed: failed.slice(0, MAX_FAILED), failedCount: failed.length });
  }

  async #view(context, source, asOf) {
    const policy = await this.#policyFor(context, source, asOf); if (policy.status !== 'ok') return policy;
    const current = await this.#revisions((t, f) => this.#repository.query(context, t, f), source.orderUuid);
    if (current.status !== 'ok') return current;
    const record = current.value ?? this.#initial(source, policy.value);
    const renewal = await readRenewalAuthority((r) => this.#repository.read(context, r), context.runId, source);
    if (renewal.status !== 'ok') return renewal;
    let operation = null;
    if (record.outcome === 'in-progress' && record.currentStage !== SELECTION_STAGE) {
      const found = await this.#repository.read(context, ref(context.runId, 'pending_operations', { operationId: decisionId(context.runId, source.orderUuid, record.currentStage) }));
      if (found.status === 'ok') operation = found.value; else if (found.status !== 'not-found') return found;
    }
    return ok(this.#project(record, policy.value, renewal.value.renewalId, operation, asOf, await this.#handoverOf(context, record, asOf)));
  }

  // Only a sent order can be handed over. A failing outcome read keeps today's view rather than hiding the order.
  async #handoverOf(context, record, asOf) {
    if (record.outcome !== 'sent-to-ordering' || typeof this.#handover?.read !== 'function') return null;
    try {
      const found = await this.#handover.read(context, { orderUuid: record.orderUuid, asOf });
      const v = found?.status === 'ok' ? found.value : null;
      return v && typeof v.stage === 'string' && v.stage && typeof v.at === 'string' && typeof v.owner === 'string' && typeof v.nextStep === 'string' ? v : null;
    } catch { return null; }
  }

  async #tick({ context, tickId, now }) {
    if (!this.#repository || !this.#policy || typeof this.#status?.requestDecision !== 'function' || typeof this.#status?.reconcile !== 'function') return unavailable();
    const system = systemContext(context);
    const orders = await listSelectionOrders((t, f) => this.#repository.query(system, t, f)); if (orders.status !== 'ok') return orders;
    // Startup reconciles uncertain writes only; stage waits progress on presenter ticks alone (HLD review Q3).
    const run = await this.#repository.read(system, ref(system.runId, 'tick_runs', { tickId })); if (run.status !== 'ok') return run;
    const startup = run.value.targetClock?.kind === 'startup';
    const counts = { orders: orders.value.length, advanced: 0, waiting: 0, blocked: 0, uncertain: 0, finished: 0, failed: [] };
    // One order's refusal is recorded and skipped so others still progress; its stable command IDs make the retry safe.
    for (const source of [...orders.value].sort((a, b) => (a.orderUuid < b.orderUuid ? -1 : 1))) {
      let step; try { step = await this.#advance(system, tickId, now, source, startup); } catch { step = unavailable(); }
      if (step.status === 'ok') counts[step.value] += 1;
      else if (step.scope === 'policy-wide') return step;
      else counts.failed.push({ orderUuid: source.orderUuid, status: step.status, code: step.code ?? step.reason ?? null });
    }
    return ok({ handlerId: HANDLER_ID, ...counts });
  }

  #operation(system, source, stage, policy) {
    const operationId = decisionId(system.runId, source.orderUuid, stage);
    const declines = policy.decline.enabled && policy.decline.stage === stage;
    const payload = { context: system, orderUuid: source.orderUuid, stage, ticksRequired: policy.ticks[stage], ticksElapsed: 0, occurredAt: null,
      policyVersion: policy.policyVersion, ...(declines ? { reasonCode: policy.decline.reasonCode, reason: policy.decline.reason } : {}) };
    return { runId: system.runId, operationId, operationType: DECISION_OPERATION, idempotencyKey: operationId,
      inputDigest: inputDigest({ orderUuid: source.orderUuid, stage, decision: declines ? 'declined' : 'approved', policyVersion: policy.policyVersion }),
      payload, state: 'pending', lastKnownState: 'waiting', attempts: 0, intendedDecision: declines ? 'declined' : 'approved' };
  }

  async #append(tx, previous, next) {
    const value = { ...next, lifecycleRevision: previous.lifecycleRevision + 1 };
    const recorded = await tx.recordReceipt({ consumerId: revisionConsumer(value.orderUuid), eventId: revisionEvent(value.lifecycleRevision),
      eventType: 'lifecycle-stage-changed', inputDigest: inputDigest(value), state: 'completed', outcome: ok(value) });
    return recorded.status === 'ok' ? ok(value) : recorded;
  }

  async #advance(system, tickId, now, source, startup) {
    const policy = await this.#policyFor(system, source, now); if (policy.status !== 'ok') return policy;
    const p = policy.value;
    const current = await this.#revisions((t, f) => this.#repository.query(system, t, f), source.orderUuid);
    if (current.status !== 'ok') return current;
    if (!current.value) {
      if (startup) return ok('waiting');
      const initial = this.#initial(source, p);
      const first = p.stageList[1];
      const started = await this.#repository.transaction(system, command(`lifecycle:start:${source.orderUuid}`, source), async (tx) => {
        const fresh = await this.#revisions((t, f) => tx.list(t, f), source.orderUuid); if (fresh.status !== 'ok') return fresh;
        if (fresh.value) return ok(fresh.value);
        const operation = this.#operation(system, source, first, p);
        const inserted = await tx.insert('pending_operations', operation); if (inserted.status !== 'ok') return inserted;
        const stages = initial.stages.map((s) => s.stage === first ? { ...s, state: 'pending', at: now, operationId: operation.operationId } : s);
        return this.#append(tx, initial, { ...initial, stages, currentStage: first,
          transition: { transitionId: `${source.orderUuid}:${first}:pending`, stage: first, state: 'pending', occurredAt: now } });
      });
      return started.status === 'ok' ? ok('advanced') : started;
    }
    const record = current.value;
    if (record.outcome !== 'in-progress') return ok('finished');
    const opRef = ref(system.runId, 'pending_operations', { operationId: decisionId(system.runId, source.orderUuid, record.currentStage) });
    let operation = await this.#repository.read(system, opRef); if (operation.status !== 'ok') return operation;
    if (operation.value.state !== 'pending') return unavailable();
    let response;
    if (operation.value.lastKnownState === 'waiting') {
      if (startup) return ok('waiting');
      // Counted once per tick ID: a retried tick replays this command instead of counting twice.
      const counted = await this.#repository.transaction(system, command(`lifecycle:count:${tickId}:${operation.value.operationId}`, { tickId }), async (tx) => {
        const fresh = await tx.get(opRef); if (fresh.status !== 'ok') return fresh;
        if (fresh.value.lastKnownState !== 'waiting') return fresh;
        const ticksElapsed = fresh.value.payload.ticksElapsed + 1; const due = ticksElapsed >= fresh.value.payload.ticksRequired;
        return tx.compareAndSwap(opRef, fresh.value.version, { lastKnownState: due ? 'requested' : 'waiting',
          payload: { ...fresh.value.payload, ticksElapsed, occurredAt: due ? now : null } });
      });
      if (counted.status !== 'ok') return counted;
      if (counted.value.lastKnownState === 'waiting') return ok('waiting');
      response = await this.#call('requestDecision', counted.value);
      operation = counted;
    } else {
      // Uncertain or refused writes are reconciled under the same operation ID before any retry.
      response = await this.#call('reconcile', operation.value);
      if (response?.status === 'not-found' && response.operationId === operation.value.operationId) response = await this.#call('requestDecision', operation.value);
    }
    return this.#settle(system, tickId, source, record, operation.value, response, p);
  }

  async #call(method, operation) {
    try { return await this.#status[method](structuredClone(operation)); } catch { return { status: 'unknown' }; }
  }

  async #settle(system, tickId, source, record, operation, response, p) {
    const opRef = ref(system.runId, 'pending_operations', { operationId: operation.operationId });
    const matches = response?.operationId === operation.operationId && response.orderUuid === source.orderUuid && response.stage === operation.payload.stage;
    const confirmed = response?.status === 'confirmed' && matches && response.state === operation.intendedDecision && typeof response.providerReference === 'string';
    if (!confirmed) {
      const refused = response?.status === 'unsupported';
      const marked = await this.#repository.transaction(system, command(`lifecycle:unsettled:${tickId}:${operation.operationId}`, response ?? null), async (tx) => {
        const fresh = await tx.get(opRef); if (fresh.status !== 'ok') return fresh;
        if (fresh.value.state !== 'pending') return fresh;
        return tx.compareAndSwap(opRef, fresh.value.version, { lastKnownState: refused ? 'unsupported' : 'unknown', attempts: fresh.value.attempts + 1,
          outcome: refused ? { status: 'unsupported', code: response.code ?? 'unsupported', reason: response.reason ?? null } : { status: 'unknown' } });
      });
      return marked.status === 'ok' ? ok(refused ? 'blocked' : 'uncertain') : marked;
    }
    const finished = await this.#repository.transaction(system, command(`lifecycle:settle:${operation.operationId}`, response), async (tx) => {
      const fresh = await tx.get(opRef); if (fresh.status !== 'ok') return fresh;
      if (fresh.value.state !== 'pending') return ok(null);
      const latest = await this.#revisions((t, f) => tx.list(t, f), source.orderUuid); if (latest.status !== 'ok') return latest;
      if (latest.value?.lifecycleRevision !== record.lifecycleRevision) return result('stale-version', { reason: 'lifecycle-revision-changed' });
      const changed = await tx.compareAndSwap(opRef, fresh.value.version, { state: 'completed', lastKnownState: response.state,
        providerReference: response.providerReference, outcome: response });
      if (changed.status !== 'ok') return changed;
      const stage = operation.payload.stage; const at = response.decidedAt;
      const index = record.stageList.indexOf(stage); const nextStage = response.state === 'approved' ? record.stageList[index + 1] : undefined;
      let stages = record.stages.map((s) => s.stage === stage ? { ...s, state: response.state, at, providerReference: response.providerReference } : s);
      if (nextStage) {
        const next = this.#operation(system, source, nextStage, p);
        const inserted = await tx.insert('pending_operations', next); if (inserted.status !== 'ok') return inserted;
        stages = stages.map((s) => s.stage === nextStage ? { ...s, state: 'pending', at, operationId: next.operationId } : s);
      }
      const outcome = response.state === 'declined' ? 'declined' : nextStage ? 'in-progress' : 'sent-to-ordering';
      const appended = await this.#append(tx, record, { ...record, stages, outcome, currentStage: nextStage ?? stage,
        transition: { transitionId: `${source.orderUuid}:${stage}:${response.state}`, stage, state: response.state, occurredAt: at } });
      if (appended.status !== 'ok' || response.state !== 'declined') return appended;
      const renewal = await readRenewalAuthority((r) => tx.get(r), system.runId, source); if (renewal.status !== 'ok') return renewal;
      const exception = { type: p.decline.eventType, employeeId: source.employeeId, renewalId: renewal.value.renewalId, orderUuid: source.orderUuid,
        occurredAt: at, stage, reasonCode: operation.payload.reasonCode ?? p.decline.reasonCode, reason: operation.payload.reason ?? p.decline.reason,
        lifecycleRevision: appended.value.lifecycleRevision, transitionId: appended.value.transition.transitionId,
        policyVersion: p.policyVersion, providerReference: response.providerReference, fictional: response.fictional === true };
      const recorded = await tx.recordReceipt({ consumerId: EXCEPTION_CONSUMER, eventId: `${p.decline.eventType}:${source.orderUuid}:${stage}`,
        eventType: p.decline.eventType, inputDigest: inputDigest(exception), state: 'completed', outcome: ok(exception) });
      return recorded.status === 'ok' ? appended : recorded;
    });
    return finished.status === 'ok' ? ok('advanced') : finished;
  }
}

export const createLifecycleApprovalService = (options) => new LifecycleApprovalService(options);
