import { inputDigest, ok, result } from '../repository/index.js';
import { SchemeOrderTerms, unavailable } from './terms.js';
export { SchemeOrderTerms } from './terms.js';
export { createManualOrderConversion } from './manual-conversion.js';

const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
const conflict = (reason) => result('conflict', { reason, view: { state: 'review-required', action: 'review-selection' } });
const invalid = (field) => result('invalid', { reasons: [{ field, reason: 'Review the required selection fields and declarations.' }],
  view: { state: 'validation', action: 'correct-fields' } });
const operationId = (context) => `selection:${inputDigest([context.runId, context.employeeId, context.entitlementSlotId])}`;
const command = (id, value) => ({ commandId: id, inputDigest: inputDigest(value) });
const active = (o) => o.state === 'pending';
const scopeMatches = (o, r) => r?.operationId === o.operationId && r.runId === o.runId && r.orderUuid === o.payload.orderUuid;
const projection = (o) => {
  const value = { schemaVersion: 1, operationId: o.operationId, operationState: o.lastKnownState,
    selectionReceived: true, selection: o.payload.selection,
    order: o.state === 'completed' ? o.outcome : null, failure: o.state === 'failed' ? o.outcome : null,
    view: { state: o.state === 'completed' ? 'awaiting-approval' : o.state === 'failed' ? 'handoff-failed' : 'handoff-pending',
      action: o.state === 'completed' ? 'view-order' : o.state === 'failed' ? 'contact-support' : 'check-status' } };
  return active(o) ? result('pending', { operationId: o.operationId, operationType: o.operationType,
    lastKnownState: o.lastKnownState, value }) : ok(value);
};

export class ManualOrderService {
  #repository; #identity; #clock; #terms; #converters; #adapter; #registration;
  constructor({ repository, identity, clock, policy, terms = new SchemeOrderTerms({ policy }), converters, adapter } = {}) {
    this.#repository = repository; this.#identity = identity; this.#clock = clock;
    this.#terms = terms; this.#converters = converters; this.#adapter = adapter;
  }
  async #safe(work) { try { return await work(); } catch { return unavailable(); } }
  async #guard(context) {
    if (!this.#repository || !this.#identity || !this.#clock || !this.#terms || !this.#registration
      || (await this.#registration).status !== 'ok' || typeof this.#adapter?.execute !== 'function'
      || typeof this.#adapter?.reconcile !== 'function') return unavailable();
    const role = await this.#identity.requireRole(context, 'employee'); if (role.status !== 'ok') return role;
    const time = await this.#clock.now(context);
    return time.status === 'ok' && time.value.runId === context.runId && Number.isFinite(Date.parse(time.value.now)) ? time
      : time.status === 'ok' ? unavailable() : time;
  }
  registerClockHandler() {
    this.#registration ??= this.#clock?.registerHandler({ handlerId: 'selection-order-reconciliation', stage: 'pending-reconciliation',
      handle: ({ context }) => this.#safe(async () => {
        const rows = await this.#repository.query(context, 'pending_operations', { operationType: 'selection-order', state: 'pending' });
        if (rows.status !== 'ok') return rows;
        for (const row of rows.value) {
          const driven = await this.#drive(row.payload.context, row.operationId);
          if (!['ok', 'pending'].includes(driven.status)) return driven;
        }
        return ok({ reconciled: rows.value.length });
      }) }) ?? Promise.resolve(unavailable());
    return this.#registration;
  }
  readTerms(context) { return this.#safe(async () => {
    const time = await this.#guard(context); return time.status === 'ok' ? this.#terms.read(context, { asOf: time.value.now }) : time;
  }); }
  async #read(context) {
    const found = await this.#repository.read(context, ref(context, 'pending_operations', { operationId: operationId(context) }));
    if (found.status === 'ok' && (found.value.payload.context.employeeId !== context.employeeId
      || found.value.payload.context.principalId !== context.principalId
      || found.value.payload.context.entitlementSlotId !== context.entitlementSlotId)) return result('forbidden');
    return found;
  }
  readOrder(context) { return this.#safe(async () => {
    const allowed = await this.#guard(context); if (allowed.status !== 'ok') return allowed;
    const found = await this.#read(context); return found.status === 'ok' ? projection(found.value) : found;
  }); }
  submit(context, input) { return this.#safe(async () => {
    const time = await this.#guard(context); if (time.status !== 'ok') return time;
    if (!only(input, ['commandId', 'source', 'expectedQuoteId', 'expectedStockVersion', 'termsDigest', 'declarations'])
      || !text(input.commandId) || !text(input.expectedQuoteId) || !text(input.termsDigest) || !positive(input.expectedStockVersion)
      || !only(input.source, ['type', 'holdId', 'expectedHoldVersion', 'expectedDraftVersion'])
      || !['cart', 'buddy-offer'].includes(input.source.type) || !text(input.source.holdId)
      || !positive(input.source.expectedHoldVersion) || !positive(input.source.expectedDraftVersion) || !object(input.declarations)) return invalid('selection');
    const { commandId, ...intent } = input;
    const digest = inputDigest(intent); const id = operationId(context);
    const prior = await this.#read(context);
    if (prior.status === 'ok') return prior.value.inputDigest === digest ? this.#drive(context, id, true) : conflict('active-selection-exists');
    if (prior.status !== 'not-found') return prior;
    const converter = this.#converters?.[input.source.type];
    if (typeof converter?.prepare !== 'function' || typeof converter.allocate !== 'function' && typeof converter.convertSelection !== 'function') return unavailable('selection-source-unsupported');
    const terms = await this.#terms.read(context, { asOf: time.value.now }); if (terms.status !== 'ok') return terms;
    if (input.termsDigest !== terms.value.termsDigest) return conflict('terms-changed');
    const prepared = await converter.prepare(context, input.source); if (prepared.status !== 'ok') return prepared;
    const mode = prepared.value.draft?.choices?.mode;
    if (!['new', 'replacement'].includes(mode)) return invalid('draft');
    const required = terms.value.declarations.filter((d) => d.appliesTo === 'all' || d.appliesTo === mode);
    if (required.some((d) => input.declarations[d.id] !== true)
      || Object.keys(input.declarations).some((key) => !required.some((d) => d.id === key))) return invalid('declarations');
    // The source authority owns conversion. Its trusted callback lets intent/history and allocation
    // commit together without copying source-specific validation or opening a nested transaction.
    const atomicConversion = typeof converter.convertSelection === 'function';
    const commitSelection = async (tx) => {
      const existing = await tx.get(ref(context, 'pending_operations', { operationId: id }));
      if (existing.status === 'ok') return existing.value.inputDigest === digest ? ok(existing.value) : conflict('active-selection-exists');
      if (existing.status !== 'not-found') return existing;
      const hold = await tx.get(ref(context, 'holds', { holdId: input.source.holdId })); if (hold.status !== 'ok') return hold;
      const h = hold.value;
      if (h.employeeId !== context.employeeId || h.entitlementSlotId !== context.entitlementSlotId || h.type !== input.source.type) return result('forbidden');
      if (h.state !== 'active' || h.version !== input.source.expectedHoldVersion) return conflict('claim-changed');
      if (Date.parse(h.expiresAt) <= Date.parse(time.value.now)) return conflict('claim-expired');
      const quote = await tx.get(ref(context, 'quotes', { quoteId: h.quoteId })); if (quote.status !== 'ok') return quote;
      const q = quote.value;
      if (q.quoteId !== input.expectedQuoteId || q.orderUuid !== h.orderUuid || q.employeeId !== context.employeeId
        || q.entitlementSlotId !== context.entitlementSlotId || q.policyVersion !== context.policyVersion
        || q.draftVersion !== input.source.expectedDraftVersion) return conflict('quote-changed');
      if (!Number.isFinite(Date.parse(q.validUntil)) || Date.parse(q.validUntil) <= Date.parse(time.value.now)) return conflict('quote-expired');
      const stock = await tx.get(ref(context, 'stock', { orderUuid: h.orderUuid })); if (stock.status !== 'ok') return stock;
      if (stock.value.version !== input.expectedStockVersion || stock.value.state !== 'held'
        || stock.value.configurationId !== q.configurationId || !/^\d{7}$/.test(stock.value.orderNumber)
        || inputDigest(stock.value.facts) !== inputDigest(q.facts)) return conflict('stock-changed');
      const employee = await tx.get(ref(context, 'employees', { employeeId: context.employeeId })); if (employee.status !== 'ok') return employee;
      if (['principalId', 'employeeId', 'companyId', 'gradeId', 'schemeId', 'entitlementSlotId'].some((key) => employee.value[key] !== context[key])) return result('forbidden');
      const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId })); if (slot.status !== 'ok') return slot;
      if (slot.value.employeeId !== context.employeeId || ['allocated', 'disabled'].includes(slot.value.state)) return conflict('entitlement-unavailable');
      const run = await tx.get(ref(context, 'runs', {})); if (run.status !== 'ok') return run;
      if (run.value.clockVersion !== time.value.clockVersion || run.value.policyVersion !== context.policyVersion) return conflict('clock-or-policy-changed');
      const selection = { schemaVersion: 1, receivedAt: time.value.now, source: input.source, quote: q,
        stock: { orderUuid: stock.value.orderUuid, orderNumber: stock.value.orderNumber, configurationId: stock.value.configurationId, facts: stock.value.facts },
        terms: terms.value, declarations: input.declarations, draft: prepared.value.draft, employee: prepared.value.employee,
        driver: prepared.value.driver, oldContract: prepared.value.oldContract ?? null, sourceVersions: prepared.value.versions ?? null,
        employeeAuthority: { employeeId: employee.value.employeeId, principalId: employee.value.principalId, companyId: employee.value.companyId,
          gradeId: employee.value.gradeId, schemeId: employee.value.schemeId, version: employee.value.version }, vehicleSlot: slot.value };
      const operation = { runId: context.runId, operationId: id, operationType: 'selection-order', idempotencyKey: id, inputDigest: digest,
        state: 'pending', lastKnownState: 'allocation-pending', attempts: 0,
        payload: { context, orderUuid: h.orderUuid, atomicConversion, selection, allocationInput: { commandId: id, holdId: h.holdId,
          expectedHoldVersion: h.version, expectedDraftVersion: input.source.expectedDraftVersion } } };
      const stored = await tx.insert('pending_operations', operation); if (stored.status !== 'ok') return stored;
      const received = await tx.recordReceipt({ consumerId: `ordering:history:${context.employeeId}`, eventId: `${id}:received`,
        eventType: 'selection-received', inputDigest: digest, state: 'completed', outcome: ok({ operationId: id, selection }) });
      return received.status === 'ok' ? stored : received;
    };
    const started = atomicConversion
      ? await converter.convertSelection(context, { commandId: id, holdId: input.source.holdId,
        expectedHoldVersion: input.source.expectedHoldVersion, expectedDraftVersion: input.source.expectedDraftVersion }, { commitSelection })
      : await this.#repository.transaction(context, command(`ordering:submit:${id}`, intent), commitSelection);
    if (!['ok', 'pending'].includes(started.status)) return started;
    return this.#drive(context, id, true);
  }); }
  async #update(context, operation, patch) {
    const updated = await this.#repository.transaction(context, command(`ordering:update:${operation.operationId}:${operation.version}`, patch), async (tx) => {
      const current = await tx.get(ref(context, 'pending_operations', { operationId: operation.operationId }));
      if (current.status !== 'ok' || !active(current.value)) return current;
      return tx.compareAndSwap(ref(context, 'pending_operations', { operationId: operation.operationId }), operation.version, patch);
    });
    return updated.status === 'stale-version' ? this.#repository.read(context, ref(context, 'pending_operations', { operationId: operation.operationId })) : updated;
  }
  async #allocated(context, operation) {
    const current = await this.#repository.read(context, ref(context, 'holds', { holdId: operation.payload.selection.source.holdId }));
    if (current.status !== 'ok') return current;
    return this.#repository.transaction(context, command(`ordering:allocation-read:${operation.operationId}:${current.value.version}`, operation.inputDigest), async (tx) => {
      const hold = await tx.get(ref(context, 'holds', { holdId: operation.payload.selection.source.holdId })); if (hold.status !== 'ok') return hold;
      if (hold.value.employeeId !== context.employeeId || hold.value.entitlementSlotId !== context.entitlementSlotId
        || hold.value.orderUuid !== operation.payload.orderUuid) return result('forbidden');
      if (hold.value.state !== 'allocated') return ok({ allocated: false, state: hold.value.state });
      const claims = await tx.list('claims', { holdId: operation.payload.selection.source.holdId }); if (claims.status !== 'ok') return claims;
      const stock = await tx.get(ref(context, 'stock', { orderUuid: operation.payload.orderUuid })); if (stock.status !== 'ok') return stock;
      const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId })); if (slot.status !== 'ok') return slot;
      return claims.value.length === 1 && claims.value[0].state === 'allocated' && claims.value[0].employeeId === context.employeeId
        && claims.value[0].orderUuid === operation.payload.orderUuid && stock.value.state === 'allocated'
        && slot.value.state === 'allocated' ? ok({ allocated: true }) : unavailable('allocation-not-atomic');
    });
  }
  async #drive(context, id, allowAllocation = false) {
    const time = await this.#clock.now(context); if (time.status !== 'ok') return time;
    let found = await this.#repository.read(context, ref(context, 'pending_operations', { operationId: id })); if (found.status !== 'ok') return found;
    let operation = found.value;
    if (!active(operation)) return projection(operation);
    if (operation.lastKnownState === 'allocation-pending') {
      let allocated = await this.#allocated(context, operation); if (allocated.status !== 'ok') return allocated;
      if (!allocated.value.allocated) {
        if (['released', 'expired', 'claim-failed'].includes(allocated.value.state)) {
          const failed = await this.#update(context, operation, { state: 'failed', lastKnownState: 'allocation-failed', outcome: { reason: allocated.value.state } });
          return failed.status === 'ok' ? projection(failed.value) : failed;
        }
        // Persisted context is a scope snapshot, never a fresh employee credential.
        // Tick reconciliation observes F66's own pending work; only authenticated submit can start conversion.
        if (!allowAllocation || operation.payload.atomicConversion) return projection(operation);
        let outcome;
        try { outcome = await this.#converters[operation.payload.selection.source.type].allocate(context, operation.payload.allocationInput); }
        catch { return projection(operation); }
        if (['invalid', 'conflict', 'stale-version', 'forbidden', 'not-found'].includes(outcome.status)) {
          const failed = await this.#update(context, operation, { state: 'failed', lastKnownState: 'allocation-failed',
            outcome: { status: outcome.status, reason: outcome.reason ?? outcome.code ?? 'allocation-review-required' } });
          return failed.status === 'ok' ? projection(failed.value) : failed;
        }
        if (outcome.status !== 'ok') return projection(operation);
        // Do not reuse the pre-allocation read receipt after changing authority.
        const attempted = await this.#update(context, operation, { attempts: operation.attempts + 1 });
        if (attempted.status !== 'ok') return attempted;
        operation = attempted.value;
        allocated = await this.#allocated(context, operation); if (allocated.status !== 'ok') return allocated;
        if (!allocated.value.allocated) return projection(operation);
      }
      const changed = await this.#update(context, operation, { lastKnownState: 'handoff-pending' }); if (changed.status !== 'ok') return changed;
      operation = changed.value;
    }
    if (!active(operation)) return projection(operation);
    let response;
    try {
      // Every attempt, including a restarted service, asks the provider before any resend.
      response = await this.#adapter.reconcile(operation);
      if (response?.status === 'not-found' && scopeMatches(operation, response)) response = await this.#adapter.execute(operation);
    } catch { response = { status: 'unknown' }; }
    const selected = operation.payload.selection;
    const confirmed = response?.status === 'confirmed' && scopeMatches(operation, response)
      && response.orderNumber === selected.stock.orderNumber && response.configurationId === selected.stock.configurationId
      && response.orderStatus === selected.terms.approvalStages[0];
    const rejected = ['rejected', 'unsupported'].includes(response?.status) && scopeMatches(operation, response);
    if (!confirmed && !rejected) {
      const changed = await this.#update(context, operation, { lastKnownState: 'unknown', attempts: operation.attempts + 1 });
      return changed.status === 'ok' ? projection(changed.value) : changed;
    }
    const finished = await this.#repository.transaction(context, command(`ordering:finish:${id}`, response), async (tx) => {
      const current = await tx.get(ref(context, 'pending_operations', { operationId: id })); if (current.status !== 'ok') return current;
      if (!active(current.value)) return current;
      const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId: id }), current.value.version,
        { state: confirmed ? 'completed' : 'failed', lastKnownState: confirmed ? 'acknowledged' : 'handoff-failed', outcome: response });
      if (changed.status !== 'ok') return changed;
      const receipt = await tx.recordReceipt({ consumerId: `ordering:history:${context.employeeId}`, eventId: `${id}:outcome`,
        eventType: confirmed ? 'selection-acknowledged' : 'selection-handoff-failed', inputDigest: inputDigest(response), state: 'completed',
        outcome: ok({ operationId: id, at: time.value.now, employeeId: context.employeeId,
          entitlementSlotId: context.entitlementSlotId, order: response }) });
      return receipt.status === 'ok' ? changed : receipt;
    });
    return finished.status === 'ok' ? projection(finished.value) : finished;
  }
}
export const createManualOrderService = (options) => new ManualOrderService(options);
