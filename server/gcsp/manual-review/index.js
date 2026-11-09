import { inputDigest, ok, result } from '../repository/core.js';
import { validInstant } from '../policy/file-provider.js';
import { object, only, identifier, revision, invalid, validateCommand, validateDetails, safeDetails } from './validation.js';

const ref = (binding, table, key = {}) => ({ table, key: { runId: binding.runId, ...key } });
const consumer = (b) => `manual:review-details:${b.employeeId}:${b.entitlementSlotId}:${b.holdId}`;
const currentConsumer = (b) => `manual:claim-current:${b.employeeId}:${b.entitlementSlotId}`;
const latest = (rows) => rows.filter((r) => /^\d+$/.test(r.eventId)).sort((a, b) => Number(a.eventId) - Number(b.eventId)).at(-1);
const unavailable = (source = 'review-details') => result('unavailable', { code: 'manual-review-source-unavailable', source, retryable: true,
  reason: 'Review details are unavailable. Saved inputs have been retained.', view: { state: 'unavailable', editable: false, action: 'retry', supportOwner: 'scheme-support' } });
const conflict = (code) => result('conflict', { code, reason: code, action: 'refresh',
  view: { state: 'conflict', editable: false, action: 'refresh-review', supportOwner: 'employee' } });
const stale = (resource, expectedVersion, currentVersion) => result('stale-version', { code: 'stale-review-details', resource,
  expectedVersion, currentVersion, action: 'refresh', view: { state: 'conflict', editable: false, action: 'refresh-review', supportOwner: 'employee' } });
const bindingOf = (context, hold, quote) => ({ runId: context.runId, employeeId: context.employeeId,
  entitlementSlotId: context.entitlementSlotId, holdId: hold.holdId, quoteId: quote.quoteId,
  expectedHoldVersion: hold.version, expectedDraftVersion: quote.draftVersion });
const initialDetails = (draft) => safeDetails(draft.choices);
const currentRevision = (snapshot) => snapshot.metadata?.reviewDetailsVersion ?? 0;
const editable = (s) => s.hold.state === 'active' && !s.frozen && !s.pending
  && Date.parse(s.now) < Date.parse(s.hold.expiresAt) && Date.parse(s.now) < Date.parse(s.quote.validUntil);

export class ManualReviewDetailsService {
  #repository; #policy; #identity; #manualClaims;
  constructor({ repository, policy, identity, manualClaims } = {}) {
    this.#repository = repository; this.#policy = policy; this.#identity = identity; this.#manualClaims = manualClaims;
  }
  async #safe(work) { try { return await work(); } catch { return unavailable(); } }
  async #guard(context) {
    if (!this.#identity?.requireRole) return unavailable('identity');
    const guarded = await this.#identity.requireRole(context, 'employee');
    if (guarded.status !== 'ok') return guarded;
    if (!this.#repository || !this.#policy || !this.#manualClaims?.readClaim) return unavailable('configuration');
    const run = await this.#repository.currentRun(context.environmentId);
    return run.status !== 'ok' ? run : run.value.runId !== context.runId ? result('stale-run', { reason: 'The current run has changed.' }) : guarded;
  }
  #reader(context) {
    return { get: (r) => this.#repository.read(context, r), list: (table, filter) => this.#repository.query(context, table, filter),
      getReceipt: (consumerId, eventId) => this.#repository.read(context, ref(context, 'event_receipts', { consumerId, eventId })) };
  }
  async #snapshot(tx, b) {
    const run = await tx.get(ref(b, 'runs')); if (run.status !== 'ok') return run;
    if (run.value.current !== true || run.value.status !== 'active') return result('stale-run', { reason: 'The current run has changed.' });
    if (!validInstant(run.value.clockInstant) || !(/^\d+$/.test(run.value.clockVersion) && Number.isSafeInteger(Number(run.value.clockVersion)) && Number(run.value.clockVersion) > 0)) return unavailable('clock');
    const employee = await tx.get(ref(b, 'employees', { employeeId: b.employeeId })); if (employee.status !== 'ok') return employee;
    const slot = await tx.get(ref(b, 'entitlement_slots', { entitlementSlotId: b.entitlementSlotId })); if (slot.status !== 'ok') return slot;
    if (slot.value.employeeId !== b.employeeId || employee.value.entitlementSlotId !== b.entitlementSlotId
      || b.principalId !== undefined && employee.value.principalId !== b.principalId) return result('forbidden', { reason: 'This entitlement belongs to another employee.' });
    const pointers = await tx.list('event_receipts', { consumerId: currentConsumer(b) }); if (pointers.status !== 'ok') return pointers;
    const pointer = latest(pointers.value);
    if (!pointer) return result('not-found', { resourceType: 'manual-claim' });
    if (b.holdId && pointer.outcome?.value?.holdId !== b.holdId) return conflict('claim-binding-changed');
    const held = await tx.get(ref(b, 'holds', { holdId: pointer.outcome?.value?.holdId })); if (held.status !== 'ok') return held;
    const hold = held.value;
    if (hold.employeeId !== b.employeeId || hold.entitlementSlotId !== b.entitlementSlotId || hold.type !== 'cart') return result('forbidden', { reason: 'This claim belongs to another entitlement.' });
    if (b.quoteId && b.quoteId !== hold.quoteId) return conflict('quote-binding-changed');
    const quoted = await tx.get(ref(b, 'quotes', { quoteId: hold.quoteId })); if (quoted.status !== 'ok') return unavailable('quote');
    const quote = quoted.value;
    if (quote.employeeId !== b.employeeId || quote.entitlementSlotId !== b.entitlementSlotId || quote.orderUuid !== hold.orderUuid
      || quote.policyVersion !== hold.policyVersion || !validInstant(quote.validUntil) || !validInstant(hold.expiresAt)) return conflict('quote-binding-changed');
    const stock = await tx.get(ref(b, 'stock', { orderUuid: hold.orderUuid })); if (stock.status !== 'ok') return unavailable('stock');
    if (stock.value.orderUuid !== quote.orderUuid || stock.value.configurationId !== quote.configurationId
      || !/^[0-9]{7}$/.test(stock.value.orderNumber)) return conflict('stock-binding-changed');
    if (b.expectedHoldVersion !== undefined && hold.version !== b.expectedHoldVersion) return stale('hold', b.expectedHoldVersion, hold.version);
    if (b.expectedDraftVersion !== undefined && quote.draftVersion !== b.expectedDraftVersion) return stale('manual-draft', b.expectedDraftVersion, quote.draftVersion);
    const receipt = await tx.getReceipt(`manual:draft:${b.employeeId}`, String(quote.draftVersion));
    if (receipt.status !== 'ok') return unavailable('pinned-draft');
    const draft = receipt.value.outcome?.value;
    if (!object(draft) || draft.runId !== b.runId || draft.employeeId !== b.employeeId || draft.entitlementSlotId !== b.entitlementSlotId
      || draft.draftStage !== 'complete' || draft.draftVersion !== quote.draftVersion || draft.policyVersion !== quote.policyVersion
      || !['replacement', 'new'].includes(draft.choices?.mode) || !object(draft.choices?.contact)) return unavailable('pinned-draft');
    const bound = bindingOf(b, hold, quote);
    const receipts = await tx.list('event_receipts', { consumerId: consumer(bound) }); if (receipts.status !== 'ok') return receipts;
    const lastMetadata = latest(receipts.value);
    const metadata = lastMetadata?.outcome?.value ?? null;
    if (lastMetadata && (!metadata || lastMetadata.outcome.status !== 'ok' || String(metadata.reviewDetailsVersion) !== lastMetadata.eventId)) return unavailable('metadata');
    if (metadata && (!revision(metadata.reviewDetailsVersion) || metadata.reviewDetailsVersion < 1
      || ['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId', 'expectedDraftVersion'].some((key) => metadata.binding?.[key] !== bound[key]))) return unavailable('metadata');
    const lock = await tx.getReceipt(`${consumer(bound)}:freeze`, 'selection');
    if (!['ok', 'not-found'].includes(lock.status)) return lock;
    if (lock.status === 'ok' && (!object(lock.value.outcome?.value) || lock.value.outcome.status !== 'ok'
      || lock.value.outcome.value.reviewDetailsVersion !== (metadata?.reviewDetailsVersion ?? 0)
      || ['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId', 'expectedDraftVersion'].some((key) => lock.value.outcome.value.binding?.[key] !== bound[key]))) return unavailable('freeze');
    const operations = await tx.list('pending_operations', { holdId: hold.holdId, state: 'pending' }); if (operations.status !== 'ok') return operations;
    return ok({ binding: bound, hold, quote, stock: stock.value, draft, metadata, frozen: lock.status === 'ok' ? lock.value.outcome.value : null,
      pending: operations.value.some((op) => op.operationType === 'manual-allocate'), now: run.value.clockInstant, clockVersion: run.value.clockVersion });
  }
  async #constraints(s) {
    const p = await this.#policy.getAssumption('manual.context.v1', { runId: s.binding.runId, asOf: s.now, policyVersion: s.quote.policyVersion });
    const row = p.value;
    if (p.status !== 'ok' || p.policyVersion !== s.quote.policyVersion || row?.policyVersion !== s.quote.policyVersion
      || row.key !== 'manual.context.v1' || !['assumed', 'verified'].includes(row.status) || typeof row.source !== 'string' || !row.source.trim()
      || !validInstant(row.effectiveFrom) || typeof row.basis !== 'string' || !row.basis.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(row.sourceDate)
      || !Number.isSafeInteger(row.value?.maximumSpecialRequirements) || row.value.maximumSpecialRequirements <= 0
      || !Number.isSafeInteger(row.value?.maximumReturnMileage) || row.value.maximumReturnMileage <= 0) return unavailable('policy');
    return ok({ maximumSpecialRequirements: row.value.maximumSpecialRequirements, maximumReturnMileage: row.value.maximumReturnMileage,
      mileageUnit: 'mi', textLengthUnit: 'UTF-16 code units', provenance: structuredClone(row) });
  }
  #projection(s, constraints) {
    const canEdit = editable(s);
    return { binding: s.binding, reviewDetailsVersion: currentRevision(s), details: s.metadata?.details ?? initialDetails(s.draft),
      constraints, mode: s.draft.choices.mode, currentContract: s.draft.currentContract ?? null,
      requestedCollection: { date: s.draft.choices.requestedCollectionDate, locationId: s.draft.choices.collectionLocationId },
      oldContractId: s.draft.choices.oldContractId ?? null, contract: s.draft.contract ?? null,
      hold: s.hold, quote: s.quote, orderNumber: s.stock.orderNumber, stockVersion: s.stock.version, now: s.now, clockVersion: s.clockVersion,
      frozen: Boolean(s.frozen), editable: canEdit, canContinue: canEdit,
      view: { state: s.frozen ? 'locked' : s.pending || s.hold.state.endsWith('-pending') ? 'pending'
        : canEdit ? 'review' : s.hold.state === 'active' ? 'expired' : s.hold.state,
      editable: canEdit, action: canEdit ? 'save-review-details' : s.frozen || s.pending ? 'check-status' : 'refresh-claim', supportOwner: 'employee' } };
  }
  readReviewDetails(context) { return this.#safe(async () => {
    const guard = await this.#guard(context); if (guard.status !== 'ok') return guard;
    const claim = await this.#manualClaims.readClaim(context); if (!['ok', 'pending'].includes(claim.status)) return claim;
    if (!claim.value?.hold || !claim.value?.quote) return unavailable('claim');
    const b = { ...context, ...bindingOf(context, claim.value.hold, claim.value.quote) };
    const snapshot = await this.#snapshot(this.#reader(context), b); if (snapshot.status !== 'ok') return snapshot;
    const constraints = await this.#constraints(snapshot.value); if (constraints.status !== 'ok') return constraints;
    // These read fences detect a save, freeze, hold transition or presenter tick during projection.
    const after = await this.#snapshot(this.#reader(context), b); if (after.status !== 'ok') return after;
    if (inputDigest(snapshot.value) !== inputDigest(after.value)) return conflict('review-read-changed');
    return ok(this.#projection(snapshot.value, constraints.value));
  }); }
  saveReviewDetails(context, input) { return this.#safe(async () => {
    const guard = await this.#guard(context); if (guard.status !== 'ok') return guard;
    const shape = validateCommand(input); if (shape) return shape;
    let digest; try { digest = inputDigest(input); } catch { return invalid('command', 'Supply JSON review details.'); }
    const command = { commandId: `manual:review-details:${context.employeeId}:${context.entitlementSlotId}:${input.commandId}`, inputDigest: digest };
    const prior = await this.#repository.read(context, ref(context, 'event_receipts', { consumerId: 'command:transaction', eventId: command.commandId }));
    if (prior.status === 'ok') return prior.value.inputDigest === digest ? structuredClone(prior.value.outcome) : conflict('idempotency-input-changed');
    if (prior.status !== 'not-found') return prior;
    const claim = await this.#manualClaims.readClaim(context); if (claim.status !== 'ok') return claim;
    const b = { ...context, holdId: input.holdId, quoteId: input.quoteId, expectedHoldVersion: input.expectedHoldVersion, expectedDraftVersion: input.expectedDraftVersion };
    const snapshot = await this.#snapshot(this.#reader(context), b); if (snapshot.status !== 'ok') return snapshot;
    const constraints = await this.#constraints(snapshot.value); if (constraints.status !== 'ok') return constraints;
    const validation = validateDetails(input.details, snapshot.value.draft.choices.mode, constraints.value); if (validation) return validation;
    return this.#repository.transaction(context, command, async (tx) => {
      const checked = await this.#snapshot(tx, b); if (checked.status !== 'ok') return checked;
      const s = checked.value;
      if (s.clockVersion !== snapshot.value.clockVersion || s.now !== snapshot.value.now) return stale('clock', snapshot.value.clockVersion, s.clockVersion);
      if (s.frozen || s.pending || ['selection-pending', 'allocated'].includes(s.hold.state)) return conflict('review-details-locked');
      if (s.hold.state !== 'active') return conflict('claim-not-active');
      if (!editable(s)) return conflict('claim-expired');
      if (currentRevision(s) !== input.expectedReviewDetailsVersion) return stale('review-details', input.expectedReviewDetailsVersion, currentRevision(s));
      const metadata = { binding: s.binding, reviewDetailsVersion: currentRevision(s) + 1, details: safeDetails(input.details),
        constraints: constraints.value, savedAt: s.now, clockVersion: s.clockVersion };
      const saved = await tx.recordReceipt({ consumerId: consumer(s.binding), eventId: String(metadata.reviewDetailsVersion), inputDigest: digest,
        state: 'completed', outcome: ok(metadata) });
      return saved.status === 'ok' ? ok(this.#projection({ ...s, metadata }, constraints.value)) : saved;
    });
  }); }
  // Trusted backend port. The caller MUST return a refusal to roll its transaction back.
  // It performs no repository transaction, identity operation, policy call or network call.
  freezeReviewDetails(tx, binding, expectedDetailsVersion) { return this.#safe(async () => {
    const keys = ['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId', 'expectedHoldVersion', 'expectedDraftVersion'];
    if (!only(binding, keys) || keys.slice(0, 5).some((key) => !identifier(binding[key]))
      || !revision(binding.expectedHoldVersion) || binding.expectedHoldVersion === 0 || !revision(binding.expectedDraftVersion)
      || binding.expectedDraftVersion === 0 || !revision(expectedDetailsVersion)) return invalid('binding', 'Supply the complete trusted selection binding and revisions.');
    const checked = await this.#snapshot(tx, binding); if (checked.status !== 'ok') return checked;
    const s = checked.value;
    if (currentRevision(s) !== expectedDetailsVersion) return stale('review-details', expectedDetailsVersion, currentRevision(s));
    if (Date.parse(s.now) >= Date.parse(s.hold.expiresAt) || Date.parse(s.now) >= Date.parse(s.quote.validUntil)) return conflict('claim-expired');
    if (s.frozen) return inputDigest(s.frozen.binding) === inputDigest(binding) && s.frozen.reviewDetailsVersion === expectedDetailsVersion
      ? ok(structuredClone(s.frozen)) : conflict('review-details-locked');
    if (s.pending || ['selection-pending', 'allocated'].includes(s.hold.state)) return conflict('review-details-locked');
    if (s.hold.state !== 'active') return conflict('claim-not-active');
    if (!editable(s)) return conflict('claim-expired');
    if (!s.metadata) return conflict('review-details-not-saved');
    const snapshot = { ...structuredClone(s.metadata), binding: s.binding, frozenAt: s.now, frozenClockVersion: s.clockVersion };
    const recorded = await tx.recordReceipt({ consumerId: `${consumer(binding)}:freeze`, eventId: 'selection', inputDigest: inputDigest({ binding, expectedDetailsVersion }),
      state: 'completed', outcome: ok(snapshot) });
    return recorded.status === 'ok' ? ok(snapshot) : recorded;
  }); }
}
