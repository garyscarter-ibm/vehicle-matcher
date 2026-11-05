import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';

const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const only = (v, fields) => object(v) && Object.keys(v).every((key) => fields.includes(key));
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
const occupying = (hold) => OCCUPYING_STATES.includes(hold.state);
const view = (state, action) => ({ state, editable: false, supportOwner: 'employee', action });
const unavailable = () => result('unavailable', { code: 'manual-claims-unavailable', retryable: true,
  reason: 'Reservation storage or its authority is unavailable. No successful reservation is implied.', view: view('unavailable', 'retry') });
const invalid = (field) => result('invalid', { code: 'invalid-manual-claim', reasons: [{ field, reason: 'Supply only the registered command fields and expected versions.' }],
  view: view('validation', 'correct-fields') });
const conflict = (reason) => result('conflict', { reason, view: view('conflict', reason === 'release-required' ? 'release-before-change' : 'refresh-review') });
const stale = (resource, expectedVersion, currentVersion) => result('stale-version', { resource, expectedVersion, currentVersion, view: view('conflict', 'refresh-review') });
const termsDigest = (decision) => inputDigest({ policy: decision.versions.policy, points: decision.terms?.points,
  allowanceInputs: decision.terms?.allowanceInputs, contribution: decision.terms?.contribution,
  provenance: decision.terms ? { sourceRef: decision.terms.provenance.sourceRef, version: decision.terms.provenance.version,
    assurance: decision.terms.provenance.assurance } : null });
const currentConsumer = (context) => `manual:claim-current:${context.employeeId}:${context.entitlementSlotId}`;
const commandKey = (context, id) => `manual-claims:${context.employeeId}:${context.entitlementSlotId}:${id}`;
const pending = (operation) => result('pending', { operationId: operation.operationId, operationType: operation.operationType,
  lastKnownState: operation.lastKnownState, view: view('pending', 'check-status') });
const actionFields = ['commandId', 'holdId', 'expectedHoldVersion', 'expectedDraftVersion'];

export class ManualClaimsService {
  #repository; #policy; #clock; #identity; #manual; #adapter; #registration;
  constructor({ repository, policy, clock, identity, manual, adapter } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
    this.#manual = manual; this.#adapter = adapter;
  }
  async #safe(work) { try { return await work(); } catch { return unavailable(); } }
  async #guard(context) {
    if (!this.#repository || !this.#policy || !this.#clock || !this.#identity || !this.#manual
      || !['local-synthetic', 'remote'].includes(this.#adapter?.mode)
      || this.#adapter.mode === 'remote' && (typeof this.#adapter.execute !== 'function' || typeof this.#adapter.reconcile !== 'function')) return unavailable();
    if (this.#registration && (await this.#registration).status !== 'ok') return unavailable();
    return this.#identity.requireRole(context, 'employee');
  }
  async #time(context) {
    const clock = await this.#clock.now(context);
    return clock.status === 'ok' && clock.value.runId === context.runId && Number.isFinite(Date.parse(clock.value.now))
      ? clock : clock.status !== 'ok' ? clock : unavailable();
  }
  async #timing(context, now) {
    const read = { runId: context.runId, asOf: now, policyVersion: context.policyVersion };
    const values = await Promise.all(['hold.cart.durationSeconds', 'hold.cart.orderReview.durationSeconds', 'hold.cart.orderReview.transition']
      .map((key) => this.#policy.getAssumption(key, read)));
    if (values.some((r) => r.status !== 'ok' || r.policyVersion !== context.policyVersion)
      || !positive(values[0].value.value) || !positive(values[1].value.value) || values[2].value.value !== 'once-from-preview') return unavailable();
    return ok({ preview: values[0].value.value, review: values[1].value.value, assumptions: values.map((r) => r.value) });
  }
  async #replay(context, kind, input, allowed) {
    const guard = await this.#guard(context); if (guard.status !== 'ok') return { error: guard };
    if (!only(input, allowed) || !text(input.commandId)) return { error: invalid('command') };
    let digest;
    try { digest = inputDigest({ kind, input }); } catch { return { error: invalid('command') }; }
    const command = { commandId: commandKey(context, input.commandId), inputDigest: digest };
    const prior = await this.#repository.read(context, ref(context, 'event_receipts', { consumerId: 'command:transaction', eventId: command.commandId }));
    if (prior.status === 'ok') return { error: prior.value.inputDigest === digest ? structuredClone(prior.value.outcome) : conflict('idempotency-input-changed') };
    return prior.status === 'not-found' ? { command } : { error: prior };
  }
  async #current(context) {
    const receipts = await this.#repository.query(context, 'event_receipts', { consumerId: currentConsumer(context) });
    if (receipts.status !== 'ok') return receipts;
    const last = receipts.value.sort((a, b) => Number(a.eventId) - Number(b.eventId)).at(-1);
    return last ? this.#repository.read(context, ref(context, 'holds', { holdId: last.outcome.value.holdId }))
      : result('not-found', { resourceType: 'manual-claim', view: view('no-claim', 'browse-stock') });
  }
  async #snapshot(context, holdId) {
    const held = holdId ? await this.#repository.read(context, ref(context, 'holds', { holdId })) : await this.#current(context);
    if (held.status !== 'ok') return held;
    const h = held.value;
    if (h.employeeId !== context.employeeId || h.entitlementSlotId !== context.entitlementSlotId || h.type !== 'cart') return result('forbidden', { reason: 'This claim belongs to another entitlement.' });
    const quote = await this.#repository.read(context, ref(context, 'quotes', { quoteId: h.quoteId }));
    if (quote.status !== 'ok') return unavailable();
    const now = await this.#time(context); if (now.status !== 'ok') return now;
    const operations = await this.#repository.query(context, 'pending_operations', { holdId: h.holdId, state: 'pending' });
    if (operations.status !== 'ok') return operations;
    // Reads use the existing repository port. Refuse a torn cross-query projection
    // if a concurrent command changed the hold while its quote/operation was read.
    const latest = await this.#repository.read(context, ref(context, 'holds', { holdId: h.holdId }));
    if (latest.status !== 'ok') return latest;
    if (latest.value.version !== h.version) return stale('hold', h.version, latest.value.version);
    if (h.state.endsWith('-pending') && !operations.value[0]) return unavailable();
    const state = h.state === 'active' ? 'quoted' : h.state;
    const value = { state, hold: h, quote: quote.value, pendingOperation: operations.value[0] ? {
      operationId: operations.value[0].operationId, operationType: operations.value[0].operationType,
      lastKnownState: operations.value[0].lastKnownState } : null, now: now.value.now, clockVersion: now.value.clockVersion,
      view: view(state.endsWith('-pending') ? 'pending' : state, state.endsWith('-pending') ? 'check-status' : state === 'quoted'
        ? h.phase === 'order-review' ? 'submit-or-cancel' : 'review-or-cancel' : state === 'allocated' ? 'continue-order-handoff' : 'browse-stock') };
    return value.pendingOperation ? { ...pending(operations.value[0]), value } : ok(value);
  }
  async #localFinish(tx, context, hold, target, reason) {
    const claimed = await tx.list('claims', { holdId: hold.holdId });
    if (claimed.status !== 'ok') return claimed;
    const claim = claimed.value[0]; if (!claim) return unavailable();
    const stock = await tx.get(ref(context, 'stock', { orderUuid: hold.orderUuid })); if (stock.status !== 'ok') return stock;
    const changed = await tx.compareAndSwap(ref(context, 'holds', { holdId: hold.holdId }), hold.version,
      { state: target, ...(reason ? { releaseReason: reason } : {}) });
    if (changed.status !== 'ok') return changed;
    const updatedClaim = await tx.compareAndSwap(ref(context, 'claims', { claimId: claim.claimId }), claim.version, { state: target });
    if (updatedClaim.status !== 'ok') return updatedClaim;
    if (['released', 'expired', 'claim-failed', 'allocated'].includes(target)) {
      const allocated = target === 'allocated';
      const changedStock = await tx.compareAndSwap(ref(context, 'stock', { orderUuid: hold.orderUuid }), stock.value.version,
        { state: allocated ? 'allocated' : 'released', available: !allocated, held: false, allocated });
      if (changedStock.status !== 'ok') return changedStock;
      if (allocated) {
        const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: hold.entitlementSlotId })); if (slot.status !== 'ok') return slot;
        const occupied = await tx.compareAndSwap(ref(context, 'entitlement_slots', { entitlementSlotId: hold.entitlementSlotId }), slot.value.version, { state: 'allocated' });
        if (occupied.status !== 'ok') return occupied;
      }
    }
    return changed;
  }
  async #assertCurrent(tx, context, account, draft, time, quote = null) {
    const employee = await tx.get(ref(context, 'employees', { employeeId: context.employeeId })); if (employee.status !== 'ok') return employee;
    if (['principalId', 'employeeId', 'companyId', 'gradeId', 'schemeId', 'entitlementSlotId']
      .some((key) => employee.value[key] !== context[key])) return conflict('employee-authority-changed');
    if (account.versions.employee !== null && employee.value.version !== account.versions.employee) return stale('employee', account.versions.employee, employee.value.version);
    const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId })); if (slot.status !== 'ok') return slot;
    if (slot.value.version !== account.versions.slot) return stale('entitlement-slot', account.versions.slot, slot.value.version);
    if (slot.value.employeeId !== context.employeeId || ['disabled', 'allocated'].includes(slot.value.state)) return conflict('entitlement-unavailable');
    const drafts = await tx.list('event_receipts', { consumerId: `manual:draft:${context.employeeId}` }); if (drafts.status !== 'ok') return drafts;
    const current = drafts.value.map((r) => r.outcome.value).sort((a, b) => a.draftVersion - b.draftVersion).at(-1);
    if (!current || current.draftVersion !== draft.draftVersion) return stale('manual-draft', draft.draftVersion, current?.draftVersion ?? 0);
    const run = await tx.get(ref(context, 'runs', {})); if (run.status !== 'ok') return run;
    if (run.value.clockVersion !== time.clockVersion) return stale('clock', time.clockVersion, run.value.clockVersion);
    if (run.value.policyVersion !== context.policyVersion) return conflict('policy-changed');
    if (quote) {
      const stock = await tx.get(ref(context, 'stock', { orderUuid: quote.orderUuid })); if (stock.status !== 'ok') return stock;
      if (stock.value.version !== quote.eligibility.stockVersion) return stale('stock', quote.eligibility.stockVersion, stock.value.version);
      if (stock.value.state !== 'held' || stock.value.allocated === true || stock.value.configurationId !== quote.configurationId
        || inputDigest(stock.value.facts) !== inputDigest(quote.facts)) return conflict('claimed-stock-changed');
    }
    return ok({ slot: slot.value });
  }
  async #operation(tx, context, hold, command, operationType, target, reason) {
    const operationId = `manual-op:${inputDigest([command.commandId, operationType])}`;
    const quote = await tx.get(ref(context, 'quotes', { quoteId: hold.quoteId })); if (quote.status !== 'ok') return quote;
    const stock = await tx.get(ref(context, 'stock', { orderUuid: hold.orderUuid })); if (stock.status !== 'ok') return stock;
    const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: hold.entitlementSlotId })); if (slot.status !== 'ok') return slot;
    const operation = { runId: context.runId, operationId, operationType, idempotencyKey: command.commandId,
      inputDigest: command.inputDigest, holdId: hold.holdId, lastKnownState: hold.state,
      state: 'pending', attempts: 0, payload: { runId: context.runId, orderUuid: hold.orderUuid, holdId: hold.holdId,
        employeeId: hold.employeeId, entitlementSlotId: hold.entitlementSlotId, quoteId: hold.quoteId,
        expiresAt: hold.expiresAt, target, reason: reason ?? null, quote: quote.value,
        expectedStockVersion: stock.value.version, expectedSlotVersion: slot.value.version, expectedHoldVersion: hold.version } };
    const inserted = await tx.insert('pending_operations', operation); if (inserted.status !== 'ok') return inserted;
    return pending(inserted.value);
  }
  async #drive(context, operationId, execute = false) {
    const found = await this.#repository.read(context, ref(context, 'pending_operations', { operationId }));
    if (found.status !== 'ok' || found.value.state !== 'pending') return found;
    const operation = found.value;
    let response;
    // Network effects are always outside repository transactions. A persisted intent
    // is reconciled before any retry; only an authoritative absent result may resend.
    try {
      response = await this.#adapter[execute ? 'execute' : 'reconcile'](structuredClone(operation));
      if (!execute && response?.status === 'not-found') response = await this.#adapter.execute(structuredClone(operation));
    } catch { return pending(operation); }
    if (!['confirmed', 'rejected'].includes(response?.status)
      || response.operationId !== operation.operationId || response.runId !== context.runId
      || response.orderUuid !== operation.payload.orderUuid) return pending(operation);
    const command = { commandId: `manual:ack:${inputDigest([operationId, response.status])}`,
      inputDigest: inputDigest({ operationId, status: response.status }) };
    return this.#repository.transaction(context, command, async (tx) => {
      const current = await tx.get(ref(context, 'pending_operations', { operationId })); if (current.status !== 'ok') return current;
      if (current.value.state !== 'pending') return ok({ reconciled: true });
      const hold = await tx.get(ref(context, 'holds', { holdId: operation.holdId })); if (hold.status !== 'ok') return hold;
      if (hold.value.operationId !== operationId) return conflict('operation-superseded');
      const target = response.status === 'confirmed' ? operation.payload.target
        : operation.operationType === 'manual-claim' ? 'claim-failed' : 'active';
      const completed = await this.#localFinish(tx, context, hold.value, target, operation.payload.reason);
      if (completed.status !== 'ok') return completed;
      return tx.compareAndSwap(ref(context, 'pending_operations', { operationId }), current.value.version,
        { state: 'completed', attempts: current.value.attempts + 1, outcome: { status: response.status },
          ...(text(response.providerReference) ? { providerReference: response.providerReference } : {}) });
    });
  }
  async #expire(context, hold, time) {
    const command = { commandId: `manual:expiry:${inputDigest([hold.holdId, hold.expiresAt, hold.version])}`,
      inputDigest: inputDigest({ holdId: hold.holdId, expiresAt: hold.expiresAt, version: hold.version }) };
    let intentCreated = false;
    const outcome = await this.#repository.transaction(context, command, async (tx) => {
      const current = await tx.get(ref(context, 'holds', { holdId: hold.holdId })); if (current.status !== 'ok') return current;
      if (current.value.state !== 'active' || Date.parse(current.value.expiresAt) > Date.parse(time.now)) return ok({ noChange: true });
      if (this.#adapter.mode === 'local-synthetic') return this.#localFinish(tx, context, current.value, 'expired', 'expiry');
      const started = await this.#operation(tx, context, current.value, command, 'manual-release', 'expired', 'expiry');
      if (started.status !== 'pending') return started;
      const changed = await this.#localFinish(tx, context, current.value, 'release-pending', 'expiry'); if (changed.status !== 'ok') return changed;
      const attached = await tx.compareAndSwap(ref(context, 'holds', { holdId: hold.holdId }), changed.value.version, { operationId: started.operationId });
      intentCreated = attached.status === 'ok';
      return attached.status === 'ok' ? started : attached;
    });
    if (outcome.status === 'pending') await this.#drive(context, outcome.operationId, intentCreated);
    return outcome;
  }
  async #reconcile(context) {
    const now = await this.#time(context); if (now.status !== 'ok') return now;
    const operations = await this.#repository.query(context, 'pending_operations', { state: 'pending' }); if (operations.status !== 'ok') return operations;
    for (const operation of operations.value.filter((r) => ['manual-claim', 'manual-release', 'manual-allocate'].includes(r.operationType))) {
      const driven = await this.#drive(context, operation.operationId); if (driven.status === 'unavailable' || driven.status === 'stale-run') return driven;
    }
    const holds = await this.#repository.query(context, 'holds', { type: 'cart', state: 'active' }); if (holds.status !== 'ok') return holds;
    for (const hold of holds.value.filter((r) => Date.parse(r.expiresAt) <= Date.parse(now.value.now))) {
      const expired = await this.#expire(context, hold, now.value);
      if (!['ok', 'pending'].includes(expired.status)) return expired;
    }
    const remaining = await this.#repository.query(context, 'pending_operations', { state: 'pending' }); if (remaining.status !== 'ok') return remaining;
    const unresolved = remaining.value.find((r) => ['manual-claim', 'manual-release', 'manual-allocate'].includes(r.operationType));
    return unresolved ? pending(unresolved) : ok({ reconciled: true, now: now.value.now });
  }
  registerClockHandler() {
    this.#registration ??= this.#clock?.registerHandler({ handlerId: 'manual-claim-expiry', stage: 'manual-expiry',
      handle: ({ context }) => this.#safe(() => this.#reconcile(context)) }) ?? Promise.resolve(unavailable());
    return this.#registration;
  }
  async #read(context, work) {
    return this.#safe(async () => {
      const guard = await this.#guard(context); if (guard.status !== 'ok') return guard;
      const reconciled = await this.#reconcile(context); if (!['ok', 'pending'].includes(reconciled.status)) return reconciled;
      return work();
    });
  }
  readAccount(context) { return this.#read(context, () => this.#manual.readAccount(context)); }
  readDraft(context) { return this.#read(context, () => this.#manual.readDraft(context)); }
  readClaim(context) { return this.#read(context, () => this.#snapshot(context)); }
  readQuote(context) { return this.readClaim(context); }
  browseStock(context) { return this.#read(context, async () => {
    const stock = await this.#manual.browseStock(context); if (stock.status !== 'ok') return stock;
    const rows = await this.#repository.query(context, 'stock'); if (rows.status !== 'ok') return rows;
    const decisions = stock.value.decisions.map((decision) => ({ ...decision,
      claimInput: decision.gateStatus === 'eligible' ? { orderUuid: decision.orderUuid,
        expectedStockVersion: rows.value.find((r) => r.orderUuid === decision.orderUuid)?.version ?? null,
        expectedDraftVersion: decision.draftVersion, expectedContextVersion: stock.value.versions.context,
        expectedTermsDigest: termsDigest(decision) } : null }));
    return ok({ ...stock.value, decisions, cars: decisions.filter((d) => d.gateStatus === 'eligible') });
  }); }
  saveDraft(context, input) { return this.#read(context, () => this.#manual.saveDraft(context, input)); }
  claim(context, input) { return this.#safe(async () => {
    const replay = await this.#replay(context, 'claim', input, ['commandId', 'orderUuid', 'expectedStockVersion', 'expectedDraftVersion', 'expectedContextVersion', 'expectedTermsDigest']);
    if (replay.error) return replay.error;
    if (!text(input.orderUuid) || !positive(input.expectedStockVersion) || !positive(input.expectedDraftVersion)
      || !text(input.expectedContextVersion) || !text(input.expectedTermsDigest)) return invalid('versions');
    const reconciled = await this.#reconcile(context); if (!['ok', 'pending'].includes(reconciled.status)) return reconciled;
    const [account, draft, browsed, time] = await Promise.all([this.#manual.readAccount(context), this.#manual.readDraft(context), this.#manual.browseStock(context), this.#time(context)]);
    for (const r of [account, draft, browsed, time]) if (r.status !== 'ok') return r;
    if (input.expectedDraftVersion !== draft.value.draftVersion) return stale('manual-draft', input.expectedDraftVersion, draft.value.draftVersion);
    if (input.expectedContextVersion !== account.value.contextVersion) return stale('manual-context', input.expectedContextVersion, account.value.contextVersion);
    const decision = browsed.value.decisions.find((d) => d.orderUuid === input.orderUuid);
    if (!decision || decision.gateStatus !== 'eligible' || !decision.terms) return conflict('car-not-eligible-or-available');
    if (input.expectedTermsDigest !== termsDigest(decision)) return stale('manual-terms', input.expectedTermsDigest, termsDigest(decision));
    const timing = await this.#timing(context, time.value.now); if (timing.status !== 'ok') return timing;
    const id = inputDigest([context.runId, replay.command.commandId]); const holdId = `manual-hold:${id}`; const quoteId = `manual-quote:${id}`;
    const expiresAt = new Date(Date.parse(time.value.now) + timing.value.preview * 1000).toISOString();
    let intentCreated = false;
    const claimed = await this.#repository.transaction(context, replay.command, async (tx) => {
      const checked = await this.#assertCurrent(tx, context, account.value, draft.value, time.value); if (checked.status !== 'ok') return checked;
      const occupied = await tx.list('holds', { employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId }); if (occupied.status !== 'ok') return occupied;
      if (occupied.value.some((h) => occupying(h) || h.state === 'allocated')) return conflict('release-required');
      const car = await tx.get(ref(context, 'stock', { orderUuid: input.orderUuid })); if (car.status !== 'ok') return car;
      if (car.value.version !== input.expectedStockVersion) return stale('stock', input.expectedStockVersion, car.value.version);
      if (car.value.state !== 'released' || car.value.available !== true || car.value.held === true || car.value.allocated === true) return conflict('stock-unavailable');
      if (car.value.configurationId !== decision.configurationId || inputDigest(car.value.facts) !== inputDigest(decision.snapshot)) return conflict('stock-facts-changed');
      const quote = await tx.insert('quotes', { runId: context.runId, quoteId, orderUuid: input.orderUuid,
        employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, configurationId: car.value.configurationId,
        facts: decision.snapshot, eligibility: { ...decision.evidence.eligibility, contextVersion: account.value.contextVersion,
          termsDigest: termsDigest(decision), driverId: draft.value.choices.driverId, sources: account.value.versions,
          stockVersion: car.value.version + 2,
          timing: timing.value }, terms: decision.terms,
        draftVersion: draft.value.draftVersion, policyVersion: context.policyVersion, quotedAt: time.value.now,
        validUntil: decision.terms.validUntil, expiresAt: decision.terms.validUntil, provenance: decision.terms.provenance,
        monthlyPoints: decision.terms.points, allowance: decision.terms.allowanceInputs });
      if (quote.status !== 'ok') return quote;
      // The foundation's conditionalClaim accepts available; the released -> available
      // normalization and exact conditional claim occur inside this one transaction.
      const available = await tx.compareAndSwap(ref(context, 'stock', { orderUuid: input.orderUuid }), car.value.version, { state: 'available' });
      if (available.status !== 'ok') return available;
      const remote = this.#adapter.mode === 'remote';
      const held = await tx.conditionalClaim({ orderUuid: input.orderUuid, holdId, claimId: `manual-claim:${id}`,
        employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, renewalId: draft.value.renewalId,
        type: 'cart', state: remote ? 'claim-pending' : 'active', phase: 'preview', expiresAt,
        policyVersion: context.policyVersion, quoteId, expectedStockVersion: available.value.version, expectedSlotVersion: checked.value.slot.version });
      if (held.status !== 'ok') return held;
      const receipts = await tx.list('event_receipts', { consumerId: currentConsumer(context) }); if (receipts.status !== 'ok') return receipts;
      const recorded = await tx.recordReceipt({ consumerId: currentConsumer(context), eventId: String(receipts.value.length + 1),
        inputDigest: replay.command.inputDigest, state: 'completed', outcome: ok({ holdId }) }); if (recorded.status !== 'ok') return recorded;
      if (remote) {
        const operation = await this.#operation(tx, context, held.value.hold, replay.command, 'manual-claim', 'active'); if (operation.status !== 'pending') return operation;
        const attached = await tx.compareAndSwap(ref(context, 'holds', { holdId }), held.value.hold.version, { operationId: operation.operationId });
        intentCreated = attached.status === 'ok';
        return attached.status === 'ok' ? operation : attached;
      }
      return ok({ state: 'quoted', hold: held.value.hold, quote: quote.value, pendingOperation: null,
        now: time.value.now, clockVersion: time.value.clockVersion, view: view('quoted', 'review-or-cancel') });
    });
    if (claimed.status === 'pending') await this.#drive(context, claimed.operationId, intentCreated);
    return claimed;
  }); }
  async #active(context, input) {
    if (!text(input.holdId) || !positive(input.expectedHoldVersion) || !positive(input.expectedDraftVersion)) return invalid('versions');
    const reconciled = await this.#reconcile(context); if (!['ok', 'pending'].includes(reconciled.status)) return reconciled;
    const held = await this.#snapshot(context, input.holdId); if (held.status !== 'ok') return held;
    if (held.value.hold.version !== input.expectedHoldVersion) return stale('hold', input.expectedHoldVersion, held.value.hold.version);
    if (held.value.quote.draftVersion !== input.expectedDraftVersion) return stale('manual-draft', input.expectedDraftVersion, held.value.quote.draftVersion);
    if (held.value.hold.state !== 'active') return conflict('claim-not-active');
    if (Date.parse(held.value.hold.expiresAt) <= Date.parse(held.value.now)) return conflict('claim-expired');
    return held;
  }
  async #revalidate(context, input, held) {
    const [account, draft, stock] = await Promise.all([this.#manual.readAccount(context), this.#manual.readDraft(context), this.#manual.revalidateHeldSelection(context, input.holdId)]);
    for (const r of [account, draft, stock]) if (r.status !== 'ok') return r;
    if (draft.value.requiresRefresh || account.value.contextVersion !== held.quote.eligibility.contextVersion) return conflict('context-changed-release-required');
    if (draft.value.draftVersion !== input.expectedDraftVersion || held.quote.draftVersion !== input.expectedDraftVersion) return stale('manual-draft', input.expectedDraftVersion, draft.value.draftVersion);
    const decision = stock.value.decisions.find((d) => d.orderUuid === held.hold.orderUuid);
    if (!decision || decision.gateStatus !== 'eligible') return conflict('car-no-longer-eligible');
    if (termsDigest(decision) !== held.quote.eligibility.termsDigest || inputDigest(decision.snapshot) !== inputDigest(held.quote.facts)) return conflict('quote-changed-release-required');
    if (Date.parse(held.quote.validUntil) <= Date.parse(held.now)) return conflict('quote-expired');
    return ok({ account: account.value, draft: draft.value });
  }
  beginReview(context, input) { return this.#safe(async () => {
    const replay = await this.#replay(context, 'review', input, actionFields); if (replay.error) return replay.error;
    const held = await this.#active(context, input); if (held.status !== 'ok') return held;
    const checked = await this.#revalidate(context, input, held.value); if (checked.status !== 'ok') return checked;
    const timing = held.value.quote.eligibility.timing;
    return this.#repository.transaction(context, replay.command, async (tx) => {
      const current = await this.#assertCurrent(tx, context, checked.value.account, checked.value.draft, { clockVersion: held.value.clockVersion }, held.value.quote); if (current.status !== 'ok') return current;
      const hold = await tx.get(ref(context, 'holds', { holdId: input.holdId })); if (hold.status !== 'ok') return hold;
      if (hold.value.version !== input.expectedHoldVersion) return stale('hold', input.expectedHoldVersion, hold.value.version);
      if (hold.value.state !== 'active') return conflict('claim-not-active');
      let value = hold.value;
      if (value.phase === 'preview' && !value.reviewStartedAt) {
        const expiresAt = new Date(Date.parse(held.value.now) + timing.review * 1000).toISOString();
        const claims = await tx.list('claims', { holdId: input.holdId }); if (claims.status !== 'ok' || !claims.value[0]) return unavailable();
        const changed = await tx.compareAndSwap(ref(context, 'holds', { holdId: input.holdId }), value.version,
          { phase: 'order-review', reviewStartedAt: held.value.now, expiresAt }); if (changed.status !== 'ok') return changed;
        const changedClaim = await tx.compareAndSwap(ref(context, 'claims', { claimId: claims.value[0].claimId }), claims.value[0].version, { expiresAt }); if (changedClaim.status !== 'ok') return changedClaim;
        value = changed.value;
      }
      return ok({ ...held.value, hold: value, state: 'quoted', view: view('quoted', 'submit-or-cancel') });
    });
  }); }
  release(context, input) { return this.#safe(async () => {
    const replay = await this.#replay(context, 'release', input, [...actionFields, 'reason']); if (replay.error) return replay.error;
    if (!['cancel', 'change', 'back'].includes(input.reason)) return invalid('reason');
    return this.#finish(context, input, replay.command, 'released', input.reason);
  }); }
  allocate(context, input) { return this.#safe(async () => {
    const replay = await this.#replay(context, 'allocate', input, actionFields); if (replay.error) return replay.error;
    return this.#finish(context, input, replay.command, 'allocated');
  }); }
  async #finish(context, input, command, target, reason) {
    const held = await this.#active(context, input); if (held.status !== 'ok') return held;
    let checked;
    if (target === 'allocated') {
      if (held.value.hold.phase !== 'order-review') return conflict('order-review-required');
      checked = await this.#revalidate(context, input, held.value); if (checked.status !== 'ok') return checked;
    }
    let intentCreated = false;
    const finished = await this.#repository.transaction(context, command, async (tx) => {
      if (checked) { const current = await this.#assertCurrent(tx, context, checked.value.account, checked.value.draft, { clockVersion: held.value.clockVersion }, held.value.quote); if (current.status !== 'ok') return current; }
      const hold = await tx.get(ref(context, 'holds', { holdId: input.holdId })); if (hold.status !== 'ok') return hold;
      if (hold.value.version !== input.expectedHoldVersion) return stale('hold', input.expectedHoldVersion, hold.value.version);
      if (hold.value.state !== 'active') return conflict('claim-not-active');
      if (this.#adapter.mode === 'remote') {
        const operation = await this.#operation(tx, context, hold.value, command, target === 'allocated' ? 'manual-allocate' : 'manual-release', target, reason);
        if (operation.status !== 'pending') return operation;
        const changed = await this.#localFinish(tx, context, hold.value, target === 'allocated' ? 'selection-pending' : 'release-pending', reason); if (changed.status !== 'ok') return changed;
        const attached = await tx.compareAndSwap(ref(context, 'holds', { holdId: input.holdId }), changed.value.version, { operationId: operation.operationId });
        intentCreated = attached.status === 'ok';
        return attached.status === 'ok' ? operation : attached;
      }
      const changed = await this.#localFinish(tx, context, hold.value, target, reason);
      return changed.status === 'ok' ? ok({ ...held.value, state: target, hold: changed.value,
        view: view(target, target === 'allocated' ? 'continue-order-handoff' : 'browse-stock') }) : changed;
    });
    if (finished.status === 'pending') await this.#drive(context, finished.operationId, intentCreated);
    return finished;
  }
}

export const createManualClaimsService = (options) => new ManualClaimsService(options);
