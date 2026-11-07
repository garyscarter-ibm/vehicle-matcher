import { inputDigest, ok, result } from '../../repository/index.js';
import { validInstant } from '../../policy/file-provider.js';
import { applicableItems, loadDocumentPolicy, policyUnavailable } from './policy.js';

export const DOCUMENTS_HANDLER_ID = 'lifecycle-documents';
export const DOCUMENTS_CONTRACT = 'lifecycle.documents.v1';
export const STAGE_CONTRACT = 'lifecycle.stages.v1';
// Versioned per-order projection in the existing receipts table (no shared schema change); see shared-contracts patch.
const STATE_CONSUMER = 'lifecycle-documents:state:v1';
const EXCEPTION_CONSUMER = 'lifecycle-documents:exceptions:v1';
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const stateRef = (context, orderUuid) => ({ table: 'event_receipts', key: { runId: context.runId, consumerId: STATE_CONSUMER, eventId: orderUuid } });
const at = (instant, seconds) => new Date(Date.parse(instant) + seconds * 1000).toISOString();
const invalid = (field, reason) => result('invalid', { code: 'invalid-document-command', reasons: [{ field, reason }], action: 'review-and-retry' });
const unavailable = () => result('unavailable', { reason: 'Document tracking is unavailable. Ask the scheme team to check the service.', retryable: true });
const notOpen = (reason, extra = {}) => ({ status: 'not-open', reason, ...extra });

// Classifies one synchronous FUCQ-111 stage read; never fabricates an approved stage.
export function observeStage(read, { context, orderUuid, openingStage, openingState }) {
  if (!read || typeof read.status !== 'string') return notOpen('stage-read-unavailable');
  if (read.status === 'not-found') return notOpen('no-lifecycle-for-order');
  if (read.status === 'unsupported') return notOpen('stage-mode-unsupported');
  if (read.status === 'forbidden') return { status: 'forbidden', reason: 'stage-read-forbidden' };
  if (read.status !== 'ok' || !object(read.value)) return notOpen('stage-read-unavailable', { producerStatus: read.status, producerCode: read.code ?? null });
  const v = read.value;
  if (v.contractVersion !== STAGE_CONTRACT) return notOpen('stage-contract-unsupported');
  if (v.runId !== context.runId || v.orderUuid !== orderUuid || !text(v.employeeId, 128)) return notOpen('stage-identity-mismatch');
  const employeeId = v.employeeId; // carried on every identified view so foreign pending/declined orders are refused
  // Order-specific renewal authority from the producer; never replaced by the employee's default slot.
  const authority = v.renewalAuthority === 'validated' ? text(v.entitlementSlotId, 128) && text(v.renewalId, 128)
    : v.renewalAuthority === 'missing' && v.renewalId == null && (v.entitlementSlotId == null || text(v.entitlementSlotId, 128));
  if (!authority) return notOpen('stage-renewal-authority-invalid', { employeeId });
  const order = { entitlementSlotId: v.entitlementSlotId ?? null, renewalId: v.renewalId ?? null, renewalAuthority: v.renewalAuthority };
  // Producer view nests its pins (policy.policyVersion); a top-level field is accepted too.
  const policyVersion = v.policyVersion ?? v.policy?.policyVersion;
  if (!(Number.isSafeInteger(v.lifecycleRevision) && v.lifecycleRevision > 0) || !text(policyVersion, 128)) return notOpen('stage-revision-missing', { employeeId });
  if (!Array.isArray(v.stages)) return notOpen('stage-read-unavailable', { employeeId });
  const stage = v.stages.find((row) => row?.stage === openingStage);
  if (!stage) return notOpen('opening-stage-not-in-lifecycle', { employeeId, lifecycleRevision: v.lifecycleRevision });
  if (stage.state !== openingState || !validInstant(stage.at)) return notOpen('opening-stage-not-reached', { employeeId, lifecycleRevision: v.lifecycleRevision, stageState: stage.state ?? null });
  return { status: 'open', employeeId, order, observation: { contractVersion: v.contractVersion, stage: openingStage, state: stage.state,
    stageAt: stage.at, providerReference: stage.providerReference ?? null, lifecycleRevision: v.lifecycleRevision, stagePolicyVersion: policyVersion } };
}

const overdueAt = (item, now) => item.owner === 'employee' && !['complete', 'failed'].includes(item.status) && Date.parse(now) > Date.parse(item.dueAt);
function readiness(projection) {
  const of = (kind) => projection.items.filter((item) => item.kind === kind);
  const done = (list) => list.every((item) => item.status === 'complete');
  const failed = projection.items.filter((item) => item.status === 'failed').map((item) => item.itemId);
  const documentsComplete = done(of('document')); const vehicleReady = done(of('readiness'));
  const ready = documentsComplete && vehicleReady;
  return { ready, state: ready ? 'ready' : failed.length ? 'failed' : 'waiting', documentsComplete, vehicleReady,
    blocking: projection.items.filter((item) => item.status !== 'complete').map((item) => item.itemId), failed };
}
function present(projection, version, now) {
  const items = projection.items.map(({ operationId, fail, failureReason, progressAt, ...item }) => ({ ...item, overdue: overdueAt(item, now) }));
  return { contractVersion: DOCUMENTS_CONTRACT, runId: projection.runId, orderUuid: projection.orderUuid, employeeId: projection.employeeId,
    documentsRevision: version, policyVersion: projection.policyVersion, openedAt: projection.openedAt, opening: projection.opening,
    lastObservedRevision: projection.lastObservedRevision, providerMode: projection.providerMode, items,
    tasks: items.filter((item) => item.owner === 'employee').map((item) => ({ itemId: item.itemId, label: item.label, action: item.action,
      status: item.status, dueAt: item.dueAt, overdue: item.overdue, actionable: item.status === 'waiting-for-employee',
      acknowledgement: item.acknowledgement ?? null })),
    readiness: readiness(projection), assumptions: projection.assumptions, fictional: true };
}

export class LifecycleDocumentService {
  #repository; #policy; #clock; #identity; #stages; #provider; #start;
  constructor({ repository, policy, clock, identity, lifecycleStages, provider } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
    this.#stages = lifecycleStages; this.#provider = provider;
  }

  start() {
    this.#start ??= this.#clock.registerHandler({ handlerId: DOCUMENTS_HANDLER_ID, stage: 'pending-reconciliation', handle: (tick) => this.#tick(tick) });
    return this.#start;
  }

  async #now(context) {
    if (!this.#repository || !this.#clock || !this.#policy || !this.#identity) return { error: unavailable() };
    const time = await this.#clock.now(context); if (time.status !== 'ok') return { error: time };
    const run = await this.#repository.read(context, { table: 'runs', key: { runId: context.runId } });
    if (run.status !== 'ok') return { error: run };
    return { now: time.value.now, read: { runId: context.runId, asOf: time.value.now, policyVersion: run.value.policyVersion } };
  }

  // Checks the order's own slot belongs to the employee and agrees with the producer's renewal; no default-slot fallback.
  async #orderOwner(tx, context, employeeId, order) {
    const employee = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId } });
    if (employee.status === 'not-found' || employee.status === 'ok' && !employee.value.roles?.includes('employee')) return ok({ refused: 'stage-employee-unknown' });
    if (employee.status !== 'ok') return employee;
    if (order.entitlementSlotId === null) return ok({ employee: employee.value });
    const slot = await tx.get({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: order.entitlementSlotId } });
    if (slot.status === 'not-found' || slot.status === 'ok' && slot.value.employeeId !== employeeId) return ok({ refused: 'stage-slot-mismatch' });
    if (slot.status !== 'ok') return slot;
    if (order.renewalId !== null && text(slot.value.renewalId, 128) && slot.value.renewalId !== order.renewalId) return ok({ refused: 'stage-renewal-mismatch' });
    return ok({ employee: employee.value });
  }

  async #open(context, tickId, now, orderUuid, read) {
    const config = await loadDocumentPolicy(this.#policy, read);
    if (config.status !== 'ok') return config;
    const observed = observeStage(await this.#readStage(context, orderUuid), { context, orderUuid, ...config.value });
    if (observed.status !== 'open') return ok({ orderUuid, opened: false, ...observed, status: 'not-open' });
    return this.#repository.transaction(context, { commandId: `lifecycle-documents:open:${tickId}:${orderUuid}:${observed.observation.lifecycleRevision}`,
      inputDigest: inputDigest({ tickId, orderUuid, observation: observed.observation, order: observed.order, policyVersion: read.policyVersion }) }, async (tx) => {
      const existing = await tx.get(stateRef(context, orderUuid));
      if (existing.status === 'ok') {
        // Replay or later revision: keep document progress, record only the latest observed source revision.
        const projection = existing.value.outcome.value;
        if (projection.lastObservedRevision === observed.observation.lifecycleRevision) return ok({ orderUuid, opened: false, status: 'already-open' });
        const changed = await tx.compareAndSwap(stateRef(context, orderUuid), existing.value.version,
          { outcome: ok({ ...projection, lastObservedRevision: observed.observation.lifecycleRevision }) });
        return changed.status === 'ok' ? ok({ orderUuid, opened: false, status: 'already-open' }) : changed;
      }
      if (existing.status !== 'not-found') return existing;
      const owner = await this.#orderOwner(tx, context, observed.employeeId, observed.order);
      if (owner.status !== 'ok') return owner;
      if (owner.value.refused) return ok({ orderUuid, opened: false, status: 'not-open', reason: owner.value.refused });
      const items = applicableItems(config.value, owner.value.employee.schemeId).map((item) => {
        const operationId = inputDigest([context.runId, orderUuid, item.itemId]).slice(0, 32);
        const assumption = config.value.assumptions[0];
        return { itemId: item.itemId, kind: item.kind, label: item.label, owner: item.owner, status: item.owner === 'employee' ? 'waiting-for-employee' : 'not-started',
          dueAt: at(now, item.dueSeconds), providerReference: null, reason: null, completedAt: null, ...(item.action ? { action: item.action } : {}),
          assumption: { key: assumption.key, itemId: item.itemId, status: assumption.status, basis: item.basis, synthetic: true },
          ...(item.owner === 'employee' ? {} : { operationId, progressAt: at(now, item.progressSeconds),
            fail: config.value.failItemIds.includes(item.itemId), failureReason: config.value.failureReason }) };
      });
      const projection = { runId: context.runId, orderUuid, employeeId: observed.employeeId, ...observed.order,
        policyVersion: read.policyVersion, openedAt: now, opening: observed.observation, lastObservedRevision: observed.observation.lifecycleRevision,
        providerMode: this.#provider?.mode ?? 'unavailable', exceptionTypes: config.value.exceptionTypes, items, assumptions: config.value.assumptions };
      const inserted = await tx.insert('event_receipts', { runId: context.runId, consumerId: STATE_CONSUMER, eventId: orderUuid,
        inputDigest: inputDigest({ orderUuid, opening: observed.observation }), eventType: 'lifecycle-documents-state', handlerId: DOCUMENTS_HANDLER_ID,
        inputVersions: { policy: read.policyVersion, lifecycleRevision: observed.observation.lifecycleRevision }, state: 'projection', outcome: ok(projection) });
      return inserted.status === 'ok' ? ok({ orderUuid, opened: true, items: items.length }) : inserted;
    });
  }

  async #readStage(context, orderUuid) {
    if (!this.#stages || typeof this.#stages.read !== 'function') return result('unavailable', { reason: 'lifecycle-stage-producer-missing' });
    try { return await this.#stages.read(context, { orderUuid }); } catch { return unavailable(); }
  }

  // Provider calls run outside transactions with stable operation IDs; results then commit with any exception receipts.
  async #advance(context, tickId, now, row) {
    const projection = row.outcome.value;
    const results = {};
    for (const item of projection.items.filter((entry) => entry.owner !== 'employee' && ['not-started', 'in-progress'].includes(entry.status))) {
      const op = { operationId: item.operationId, runId: context.runId, orderUuid: projection.orderUuid, itemId: item.itemId, context,
        fail: item.fail, failureReason: item.failureReason, openedAt: projection.openedAt, progressAt: item.progressAt };
      if (!this.#provider) { results[item.itemId] = { step: item.status, status: 'unavailable' }; continue; }
      try {
        const outcome = item.status === 'not-started' ? await this.#provider.start(op) : await this.#provider.progress(op, now);
        results[item.itemId] = { step: item.status, status: outcome?.status ?? 'unavailable', providerReference: outcome?.providerReference ?? null, reason: outcome?.reason ?? null };
      } catch { results[item.itemId] = { step: item.status, status: 'unavailable' }; }
    }
    return this.#repository.transaction(context, { commandId: `lifecycle-documents:apply:${tickId}:${projection.orderUuid}:${row.version}`,
      inputDigest: inputDigest({ tickId, now, results }) }, async (tx) => {
      const found = await tx.get(stateRef(context, projection.orderUuid)); if (found.status !== 'ok') return found;
      const current = found.value.outcome.value;
      const counts = { started: 0, completed: 0, failed: 0, overdue: 0, unsupported: 0, unavailable: 0 };
      const exceptions = [];
      const items = current.items.map((item) => {
        const r = results[item.itemId];
        if (r && r.step === item.status) {
          if (item.status === 'not-started' && r.status === 'accepted') { counts.started += 1; return { ...item, status: 'in-progress', providerReference: r.providerReference }; }
          if (item.status === 'in-progress' && r.status === 'complete') { counts.completed += 1; return { ...item, status: 'complete', completedAt: now }; }
          if (item.status === 'in-progress' && r.status === 'failed') {
            counts.failed += 1; exceptions.push([item, current.exceptionTypes.failed]);
            return { ...item, status: 'failed', reason: r.reason ?? current.items.find((i) => i.itemId === item.itemId).failureReason };
          }
          if (['unsupported', 'unavailable'].includes(r.status)) { counts[r.status] += 1; return item.lastProviderOutcome === r.status ? item : { ...item, lastProviderOutcome: r.status }; }
        }
        if (overdueAt(item, now) && !item.overdueRecordedAt) { counts.overdue += 1; exceptions.push([item, current.exceptionTypes.overdue]); return { ...item, overdueRecordedAt: now }; }
        return item;
      });
      for (const [item, type] of exceptions) {
        const value = { employeeId: current.employeeId, renewalId: current.renewalId, orderUuid: current.orderUuid, occurredAt: now,
          itemId: item.itemId, exceptionType: type, policyVersion: current.policyVersion, lifecycleRevision: current.opening.lifecycleRevision,
          entitlementSlotId: current.entitlementSlotId, renewalAuthority: current.renewalAuthority, fictional: true };
        const eventId = `${current.orderUuid}:${item.itemId}:${type}`;
        const recorded = await tx.recordReceipt({ consumerId: EXCEPTION_CONSUMER, eventId, eventType: type, handlerId: DOCUMENTS_HANDLER_ID,
          inputDigest: inputDigest({ eventId, occurredAt: now }), inputVersions: { policy: current.policyVersion }, state: 'completed', outcome: ok(value) });
        if (recorded.status !== 'ok') return recorded;
      }
      const changed = items.some((item, index) => item !== current.items[index]);
      if (changed) {
        const updated = await tx.compareAndSwap(stateRef(context, current.orderUuid), found.value.version, { outcome: ok({ ...current, items }) });
        if (updated.status !== 'ok') return updated;
      }
      return ok({ orderUuid: current.orderUuid, ...counts });
    });
  }

  async #tick({ context, tickId, now }) {
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    if (prepared.now !== now) return result('stale-version', { reason: 'Clock changed during this tick. Refresh and retry.' });
    // One order's failure is recorded and skipped; others still progress. Retries reuse stable per-order command IDs.
    const summary = { producer: 'ok', opened: 0, notOpen: [], orders: [], blocked: [], producerFailed: [], producerFailedCount: 0 };
    const lister = typeof this.#stages?.listOrders === 'function' ? 'listOrders' : typeof this.#stages?.list === 'function' ? 'list' : null;
    if (lister) {
      let listed;
      try { listed = await this.#stages[lister](context); } catch { listed = unavailable(); }
      if (listed?.status === 'ok' && Array.isArray(listed.value?.orders)) {
        // The producer's per-order diagnostics stay visible; those orders are simply not opened.
        if (Array.isArray(listed.value.failed)) summary.producerFailed = listed.value.failed.slice(0, 20).map(({ orderUuid, status, code }) => ({ orderUuid, status, code }));
        summary.producerFailedCount = Number.isSafeInteger(listed.value.failedCount) ? listed.value.failedCount : summary.producerFailed.length;
        for (const orderUuid of listed.value.orders.map((o) => o?.orderUuid).filter((id) => text(id, 128))) {
          const opened = await this.#open(context, tickId, now, orderUuid, prepared.read);
          if (opened.status !== 'ok') { summary.blocked.push({ orderUuid, step: 'open', status: opened.status }); continue; }
          if (opened.value.opened) summary.opened += 1; else if (opened.value.status !== 'already-open') summary.notOpen.push({ orderUuid, reason: opened.value.reason });
        }
      } else summary.producer = { status: listed?.status ?? 'unavailable', code: listed?.code ?? null, scope: listed?.scope ?? null };
    } else summary.producer = 'missing';
    const rows = await this.#repository.query(context, 'event_receipts', { consumerId: STATE_CONSUMER });
    if (rows.status !== 'ok') return rows;
    for (const row of rows.value) {
      const advanced = await this.#advance(context, tickId, now, row);
      if (advanced.status !== 'ok') { summary.blocked.push({ orderUuid: row.eventId, step: 'progress', status: advanced.status }); continue; }
      summary.orders.push(advanced.value);
    }
    return ok(summary);
  }

  async #employeeOrOperator(context) {
    if (!this.#identity) return unavailable();
    for (const role of ['employee', 'greg', 'presenter']) {
      const allowed = await this.#identity.requireRole(context, role);
      if (allowed.status === 'ok') return ok(role);
      if (allowed.status !== 'forbidden') return allowed; // stale-run, expired session and the like pass through
    }
    return result('forbidden', { reason: 'Only the employee, the scheme team or the presenter can read document progress.' });
  }

  async readItems(context) {
    const allowed = await this.#identity?.requireRole(context, 'employee'); if (!allowed) return unavailable();
    if (allowed.status !== 'ok') return allowed;
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    const rows = await this.#repository.query(context, 'event_receipts', { consumerId: STATE_CONSUMER });
    if (rows.status !== 'ok') return rows;
    const own = rows.value.filter((row) => row.outcome?.value?.employeeId === context.employeeId);
    return ok({ contractVersion: DOCUMENTS_CONTRACT, now: prepared.now, orders: own.map((row) => present(row.outcome.value, row.version, prepared.now)) });
  }

  // The single handover-readiness authority: appointment completion reads this, nothing else marks ready.
  async readReadiness(context, input = {}) {
    const role = await this.#employeeOrOperator(context); if (role.status !== 'ok') return role;
    if (!object(input) || !text(input.orderUuid, 128) || Object.keys(input).some((key) => key !== 'orderUuid')) return invalid('orderUuid', 'Supply the order to check.');
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    const row = await this.#repository.read(context, stateRef(context, input.orderUuid));
    if (row.status === 'ok') {
      const projection = row.value.outcome.value;
      if (role.value === 'employee' && projection.employeeId !== context.employeeId) return result('forbidden', { reason: 'These documents belong to another employee.' });
      return ok({ orderUuid: input.orderUuid, documentsRevision: row.value.version, opened: true, ...readiness(projection) });
    }
    if (row.status !== 'not-found') return row;
    const config = await loadDocumentPolicy(this.#policy, prepared.read);
    const observed = config.status === 'ok' ? observeStage(await this.#readStage(context, input.orderUuid), { context, orderUuid: input.orderUuid, ...config.value })
      : notOpen('document-policy-unavailable');
    if (observed.status === 'forbidden') return result('forbidden', { reason: 'This order is not visible to you.' });
    if (role.value === 'employee' && observed.employeeId && observed.employeeId !== context.employeeId) return result('forbidden', { reason: 'These documents belong to another employee.' });
    const reason = observed.status === 'open' ? 'awaiting-document-tick' : observed.reason;
    const cause = observed.producerStatus ? { producerStatus: observed.producerStatus, producerCode: observed.producerCode } : {};
    return ok({ orderUuid: input.orderUuid, opened: false, ready: false, state: 'not-open', reason, documentsComplete: false, vehicleReady: false, ...cause });
  }

  async completeTask(context, input = {}) {
    const allowed = await this.#identity?.requireRole(context, 'employee'); if (!allowed) return unavailable();
    if (allowed.status !== 'ok') return allowed;
    if (!object(input) || !text(input.commandId, 128) || !text(input.orderUuid, 128) || !text(input.itemId, 64)
      || input.acknowledgement !== 'synthetic' || Object.keys(input).some((key) => !['commandId', 'orderUuid', 'itemId', 'acknowledgement'].includes(key))) {
      return invalid('task', 'Supply commandId, orderUuid, itemId and acknowledgement "synthetic".');
    }
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    const outcome = await this.#repository.transaction(context, { commandId: `lifecycle-documents:task:${context.employeeId}:${input.commandId}`,
      inputDigest: inputDigest(input) }, async (tx) => {
      const found = await tx.get(stateRef(context, input.orderUuid));
      if (found.status === 'not-found') return result('not-found', { resourceType: 'document-items', reason: 'No document items are open for this order.' });
      if (found.status !== 'ok') return found;
      const projection = found.value.outcome.value;
      if (projection.employeeId !== context.employeeId) return result('forbidden', { reason: 'These documents belong to another employee.' });
      const item = projection.items.find((entry) => entry.itemId === input.itemId);
      if (!item || item.owner !== 'employee') return result('forbidden', { reason: 'This item is not yours to complete.' });
      if (item.status !== 'waiting-for-employee') return result('conflict', { reason: 'task-not-waiting', current: { status: item.status } });
      const acknowledgement = { kind: 'synthetic-acknowledgement', label: 'Synthetic acknowledgement. Not a signature.', at: prepared.now, actorId: context.principalId };
      const items = projection.items.map((entry) => entry === item ? { ...entry, status: 'complete', completedAt: prepared.now, acknowledgement } : entry);
      const updated = await tx.compareAndSwap(stateRef(context, input.orderUuid), found.value.version, { outcome: ok({ ...projection, items }) });
      return updated.status === 'ok' ? ok({ order: present(updated.value.outcome.value, updated.value.version, prepared.now) }) : updated;
    });
    return outcome;
  }
}

export const createLifecycleDocumentService = (options) => new LifecycleDocumentService(options);
export { policyUnavailable };
