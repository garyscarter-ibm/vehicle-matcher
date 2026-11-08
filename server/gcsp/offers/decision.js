import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';
import { createRepositoryManualPorts } from '../manual-context/ports.js';
import { prepareBuddySelection } from './buddy-conversion.js';

export const DECLINE_REASONS_KEY = 'offer.declineReasons.v1';
export const DECISION_EVENTS = 'offer-decisions:events:v1';
const fields = ['commandId', 'runId', 'offerId', 'decision', 'reasonCode',
  'expectedOfferVersion', 'expectedHoldVersion', 'expectedQuoteVersion', 'termsDigest', 'declarations'];
const object = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const only = (v, keys) => object(v) && Reflect.ownKeys(v).every((k) => keys.includes(k));
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const instant = (v) => typeof v === 'string' && /Z$/.test(v) && Number.isFinite(Date.parse(v));
const same = (a, b) => inputDigest(a) === inputDigest(b);
const ref = (scope, table, key = {}) => ({ table, key: { runId: scope.runId, ...key } });
const unavailable = (code = 'offer-decision-unavailable') => result('unavailable', {
  code, reason: 'Offer decisions are temporarily unavailable.', retryable: true });
const invalid = () => result('invalid', { code: 'invalid-offer-decision', reasons: [
  { field: 'command', reason: 'Supply the exact offer, decision and current revisions.' }] });
const conflict = (reason, current) => result('conflict', { reason, action: 'refresh', ...(current ? { current } : {}) });
const stale = (resource, expectedVersion, currentVersion) => result('stale-version', {
  resource, expectedVersion, currentVersion, action: 'refresh' });
const occupied = (r) => OCCUPYING_STATES.includes(r.state) || r.state === 'allocated';
// The pinned quote is kept: a changed but sufficient allowance is gated separately, never requoted.
const termsBasis = ({ termsVersion, validFrom, validUntil, provenance, allowanceInputs, ...terms }) => ({ ...terms,
  provenance: Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== 'observedAt')) });

// Access is a privately branded one-offer capability, not an employee context.
// The internal calculation factory is explicitly supplied by trusted composition;
// no employee roles or credentials are manufactured for the recommendation API.
export class OfferDecisionService {
  #repository; #policy; #clock; #access; #evaluate; #mode; #ordering;
  // With no ordering service (isolated FUCQ-106 unit composition only) accept stays a local decision.
  constructor({ repository, policy, clock, access, createStoredSubjectEvaluator, mode, ordering } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock;
    this.#access = access; this.#evaluate = createStoredSubjectEvaluator; this.#mode = mode; this.#ordering = ordering;
  }

  async #prepare(context, selector, action = 'decide') {
    if (!this.#repository || !this.#policy || !this.#clock || !this.#access?.authorizeOffer) return { error: unavailable() };
    const allowed = await this.#access.authorizeOffer(context, selector, action);
    if (allowed.status !== 'ok') return { error: allowed };
    const binding = allowed.value;
    if (!binding || !text(binding.environmentId) || binding.runId !== selector.runId || binding.offerId !== selector.offerId) {
      return { error: unavailable('offer-access-binding-mismatch') };
    }
    const scope = { runId: binding.runId, environmentId: binding.environmentId,
      principalId: 'service:offer-decisions', roles: [] };
    const current = await this.#repository.currentRun(scope.environmentId);
    if (current.status !== 'ok') return { error: current };
    if (current.value.runId !== scope.runId || current.value.current !== true || current.value.status !== 'active') {
      return { error: result('stale-run', { reason: 'This offer belongs to an earlier demo run.' }) };
    }
    const time = await this.#clock.now(scope);
    if (time.status !== 'ok') return { error: time };
    if (time.value.runId !== scope.runId || !instant(time.value.now)) return { error: unavailable() };
    return { scope, time: time.value, binding };
  }

  async #reasons(scope, read) {
    const registry = await this.#policy.getAssumption(DECLINE_REASONS_KEY, read);
    const value = registry.value?.value;
    if (registry.status !== 'ok' || registry.policyVersion !== read.policyVersion
      || !only(value, ['schemaVersion', 'reasons']) || value.schemaVersion !== 1
      || !Array.isArray(value.reasons) || !value.reasons.length
      || value.reasons.some((r) => !only(r, ['code', 'label', 'attribute']) || !text(r.code) || !text(r.label) || !text(r.attribute))
      || new Set(value.reasons.map((r) => r.code)).size !== value.reasons.length) return unavailable('decline-reasons-unavailable');
    return ok({ schemaVersion: 1, policyVersion: registry.policyVersion, key: DECLINE_REASONS_KEY,
      reasons: value.reasons.map(({ code, label, attribute }) => ({ code, label, attribute })),
      provenance: Object.fromEntries(['status', 'basis', 'source', 'sourceDate'].map((k) => [k, registry.value[k]])) });
  }

  async readReasons(context, selector) {
    try {
      if (!only(selector, ['runId', 'offerId']) || !text(selector.runId) || !text(selector.offerId)) return invalid();
      const prepared = await this.#prepare(context, selector, 'read'); if (prepared.error) return prepared.error;
      const run = await this.#repository.read(prepared.scope, ref(prepared.scope, 'runs'));
      if (run.status !== 'ok') return run;
      return this.#reasons(prepared.scope, { runId: prepared.scope.runId,
        asOf: prepared.time.now, policyVersion: run.value.policyVersion });
    } catch { return unavailable(); }
  }

  async readOperation(context, input) {
    try {
      if (!only(input, ['runId', 'offerId', 'operationId']) || !['runId', 'offerId', 'operationId'].every((k) => text(input[k]))) return invalid();
      const prepared = await this.#prepare(context, { runId: input.runId, offerId: input.offerId }, 'read');
      if (prepared.error) return prepared.error;
      const { scope } = prepared;
      const found = await this.#repository.read(scope, ref(scope, 'pending_operations', { operationId: input.operationId }));
      if (found.status !== 'ok') return found;
      const row = found.value;
      if (!['offer-selection', 'offer-decline-release'].includes(row.operationType)
        || row.offerId !== input.offerId || row.payload?.offerId !== input.offerId
        || row.payload.runId !== scope.runId || row.payload.environmentId !== scope.environmentId) return result('not-found', { resourceType: 'offer-operation' });
      // The historical command receipt is never overwritten with this live view.
      return ok({ schemaVersion: 1, runId: scope.runId, offerId: input.offerId,
        operationId: row.operationId, operationType: row.operationType,
        state: row.state, lastKnownState: row.lastKnownState, operationVersion: row.version,
        reconciliationRequired: row.state === 'pending', serverNow: prepared.time.now,
        clockVersion: prepared.time.clockVersion });
    } catch { return unavailable(); }
  }

  #view(rows, time, input, extra = {}) {
    const { offer, hold, quote } = rows;
    const state = offer.state === 'accepted' ? 'accepted' : ['rejected', 'declined'].includes(offer.state) ? 'declined'
      : offer.state === 'expired' || instant(hold.expiresAt) && Date.parse(time.now) >= Date.parse(hold.expiresAt)
        && offer.state === 'active' ? 'expired' : 'pending';
    return { schemaVersion: 1, runId: offer.runId, offerId: offer.offerId, commandId: input.commandId,
      requestedDecision: input.decision, state, reason: state === 'pending' ? offer.state : state,
      offerState: offer.state, holdState: hold.state, offerVersion: offer.version, holdVersion: hold.version,
      quoteVersion: quote.version, quoteId: quote.quoteId, policyVersion: quote.policyVersion,
      expiresAt: hold.expiresAt, serverNow: time.now, clockVersion: time.clockVersion,
      availableActions: [], operationId: offer.operationId ?? hold.operationId ?? null,
      reconciliationRequired: ['decision-pending', 'release-pending'].includes(offer.state), ...extra };
  }

  async #load(tx, scope, input, time) {
    const rows = {};
    for (const [name, table, key] of [['run', 'runs', {}], ['offer', 'offers', { offerId: input.offerId }]]) {
      const found = await tx.get(ref(scope, table, key)); if (found.status !== 'ok') return { error: found };
      rows[name] = found.value;
    }
    const { run, offer } = rows;
    if (run.environmentId !== scope.environmentId || run.current !== true || run.status !== 'active') {
      return { error: result('stale-run', { reason: 'This offer belongs to an earlier demo run.' }) };
    }
    if (run.clockInstant !== time.now || run.clockVersion !== time.clockVersion) return { error: conflict('clock-changed') };
    for (const [name, table, key] of [['hold', 'holds', { holdId: offer.holdId }],
      ['quote', 'quotes', { quoteId: offer.quoteId }], ['stock', 'stock', { orderUuid: offer.orderUuid }],
      ['employee', 'employees', { employeeId: offer.employeeId }]]) {
      const found = await tx.get(ref(scope, table, key)); if (found.status !== 'ok') return { error: found };
      rows[name] = found.value;
    }
    const { hold, quote, stock, employee } = rows;
    const slot = await tx.get(ref(scope, 'entitlement_slots', { entitlementSlotId: hold.entitlementSlotId }));
    if (slot.status !== 'ok') return { error: slot };
    rows.slot = slot.value;
    for (const table of ['claims', 'holds', 'briefs']) {
      const found = await tx.list(table); if (found.status !== 'ok') return { error: found };
      rows[table] = found.value;
    }
    const claims = rows.claims.filter((c) => c.holdId === hold.holdId);
    rows.claim = claims[0];
    const identityKeys = ['employeeId', 'orderUuid', 'quoteId', 'policyVersion', 'expiresAt'];
    if (claims.length !== 1 || hold.type !== 'buddy-offer' || rows.claim.type !== 'buddy-offer'
      || identityKeys.some((k) => offer[k] !== hold[k] || rows.claim[k] !== hold[k])
      || rows.claim.entitlementSlotId !== hold.entitlementSlotId
      || quote.employeeId !== hold.employeeId || quote.entitlementSlotId !== hold.entitlementSlotId
      || quote.orderUuid !== hold.orderUuid || quote.configurationId !== stock.configurationId
      || quote.policyVersion !== hold.policyVersion || quote.briefVersion !== offer.briefVersion
      || employee.entitlementSlotId !== hold.entitlementSlotId || rows.slot.employeeId !== employee.employeeId
      || offer.environmentId !== scope.environmentId || !instant(hold.expiresAt)
      || !same(quote.facts, stock.facts)) return { error: unavailable('offer-authority-inconsistent') };
    const alignedState = { active: 'active', accepted: 'allocated', rejected: 'released', declined: 'released',
      expired: 'expired', 'decision-pending': 'selection-pending', 'release-pending': 'release-pending' }[offer.state];
    if (!alignedState || hold.state !== alignedState || rows.claim.state !== alignedState) return { error: unavailable('offer-state-inconsistent') };
    if (offer.state !== 'active') {
      return { error: conflict('offer-no-longer-pending', this.#view(rows, time, input)) };
    }
    if (hold.operationId || offer.operationId || rows.claim.operationId) return { error: unavailable('remote-decision-protocol-required') };
    for (const [name, actual] of [['Offer', offer.version], ['Hold', hold.version], ['Quote', quote.version]]) {
      if (input[`expected${name}Version`] !== actual) return { error: stale(name.toLowerCase(), input[`expected${name}Version`], actual) };
    }
    if (Date.parse(time.now) >= Date.parse(hold.expiresAt)) return { error: conflict('deadline-passed', this.#view(rows, time, input)) };
    if (stock.state !== 'held' || stock.available !== false || stock.held !== true || stock.allocated !== false
      || ['disabled', 'allocated'].includes(rows.slot.state) || !employee.roles?.includes('employee')) return { error: conflict('selection-authority-changed') };
    if ([...rows.holds, ...rows.claims].some((row) => row.holdId !== hold.holdId && occupied(row)
      && (row.orderUuid === hold.orderUuid || row.entitlementSlotId === hold.entitlementSlotId
        || hold.renewalId && row.renewalId === hold.renewalId && row.employeeId === hold.employeeId))) {
      return { error: conflict('competing-authority') };
    }
    rows.brief = rows.briefs.filter((b) => b.employeeId === employee.employeeId && b.status === 'confirmed')
      .sort((a, b) => a.briefVersion - b.briefVersion).at(-1);
    rows.pinnedBrief = rows.briefs.find((b) => b.employeeId === employee.employeeId && b.briefVersion === quote.briefVersion && b.status === 'confirmed');
    if (!rows.brief || !rows.pinnedBrief || rows.brief.entitlementSlotId !== hold.entitlementSlotId
      || (hold.renewalId ?? null) !== (rows.brief.renewalId ?? rows.slot.renewalId ?? employee.renewalId ?? null)) {
      return { error: conflict('brief-authority-changed') };
    }
    return { rows };
  }

  async #accept(tx, scope, rows, time) {
    if (typeof this.#evaluate !== 'function') return unavailable('stored-subject-evaluator-not-configured');
    const { employee, brief, pinnedBrief, quote, run, hold } = rows;
    // A background pause is distinct from changing practical requirements.
    if (!same(brief.preferences, pinnedBrief.preferences) || !same(brief.essentials, pinnedBrief.essentials)) {
      return conflict('brief-changed-review-required');
    }
    if (!instant(quote.validUntil) || Date.parse(time.now) >= Date.parse(quote.validUntil)
      || !instant(quote.terms?.validUntil) || Date.parse(time.now) >= Date.parse(quote.terms.validUntil)
      || !instant(quote.terms?.validFrom) || Date.parse(time.now) < Date.parse(quote.terms.validFrom)) return conflict('quote-no-longer-valid');
    const subject = Object.freeze(Object.fromEntries(['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion']
      .map((key) => [key, key === 'policyVersion' ? quote.policyVersion : scope[key] ?? employee[key]])));
    const allowance = await this.#policy.getAllowance(subject, { runId: scope.runId, asOf: time.now, policyVersion: run.policyVersion });
    if (allowance.status !== 'ok' || allowance.policyVersion !== run.policyVersion
      || !Number.isFinite(allowance.value?.monthlyPoints)) return unavailable('allowance-unavailable');
    const points = quote.monthlyPoints?.value ?? quote.terms?.points?.value;
    if (!Number.isFinite(points)) return conflict('quote-no-longer-valid');
    if (allowance.value.monthlyPoints < points) return conflict('allowance-exceeded');
    const eligibility = await this.#policy.getEligibility(subject, {
      eligibilityModelKey: quote.facts?.facts?.eligibilityModelKey?.value }, {
      runId: scope.runId, asOf: time.now, policyVersion: run.policyVersion });
    if (eligibility.status !== 'ok' || eligibility.policyVersion !== run.policyVersion) return unavailable('current-eligibility-unavailable');
    if (eligibility.value.eligible !== true || eligibility.value.state !== 'eligible') return conflict('current-eligibility-refused');
    const repository = { read: (_subject, key) => tx.get(key), query: async (_subject, table, filter) => {
      const found = await tx.list(table, filter);
      return found.status === 'ok' && table === 'stock' ? ok(found.value.map((row) => row.orderUuid === hold.orderUuid
        ? { ...row, state: 'released', available: true, held: false, allocated: false } : row)) : found;
    } };
    const ports = createRepositoryManualPorts({ repository, policy: this.#policy });
    const released = await ports.releasedStock.read(subject); if (released.status !== 'ok') return released;
    const candidate = released.value.stock.find((s) => s.orderUuid === hold.orderUuid);
    const manual = employee.contract?.manualContext;
    const driver = manual?.drivers?.find((d) => d.kind === 'employee' && d.employeeId === employee.employeeId);
    if (!candidate || !manual?.employeeFacts || !driver) return unavailable('stored-employee-facts-unavailable');
    const employeeFacts = structuredClone(manual.employeeFacts);
    if (employeeFacts.driverEligible !== undefined && (employeeFacts.driverEligible.status !== driver.eligible?.status
      || employeeFacts.driverEligible.value !== driver.eligible?.value)) return conflict('driver-authority-inconsistent');
    employeeFacts.driverEligible = driver.eligible;
    const charging = brief.essentials.charging;
    employeeFacts.charging = { status: charging?.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
      value: charging?.value ?? null, unit: null, provenance: { sourceRef: charging?.source ?? 'brief:unresolved',
        version: String(brief.briefVersion), observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
    const evaluator = this.#evaluate({ policy: this.#policy,
      time: { now: async () => ok({ ...time, runId: scope.runId }) },
      provider: { resolve: async () => ok({ runId: scope.runId, environmentId: scope.environmentId,
        employeeId: employee.employeeId, factsVersion: String(brief.briefVersion), stockVersion: candidate.availability.version,
        employeeFacts, stock: [candidate] }) } });
    const evaluated = await evaluator.evaluate(subject, { schemaVersion: 1, briefVersion: brief.briefVersion,
      preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) });
    if (evaluated.status !== 'ok') return evaluated;
    const decision = evaluated.value.decisions?.find((d) => d.orderUuid === hold.orderUuid);
    return decision?.gateStatus === 'eligible' && decision.configurationId === quote.configurationId && same(decision.snapshot, quote.facts)
      && same(termsBasis(decision.terms), termsBasis(quote.terms))
      ? ok({ revalidated: true, allowance: { allowanceId: allowance.value.allowanceId ?? null,
        monthlyPoints: allowance.value.monthlyPoints, policyVersion: allowance.policyVersion } }) : conflict('accept-revalidation-failed');
  }

  // AC1: accept hands the selection to FUCQ-71's ordering service, whose callback runs inside the decision transaction.
  async #handoff(prepared, input) {
    const { scope } = prepared;
    const read = (table, key = {}) => this.#repository.read(scope, ref(scope, table, key));
    const offer = await read('offers', { offerId: input.offerId }); if (offer.status !== 'ok') return offer;
    const commandId = `offer-decision:${input.offerId}:${input.commandId}`;
    const prior = await read('decisions', { decisionId: `offer-decision:${inputDigest([scope.runId, commandId])}` });
    const replay = prior.status === 'ok' && prior.value.decision === 'accept' ? prior.value : null;
    // A new command on a settled offer is refused by the decision itself, before ordering sees it.
    if (!replay && offer.value.state !== 'active') return this.#transact(prepared, input, async () => conflict('selection-already-recorded'));
    const [run, hold, quote, stock, employee] = await Promise.all([read('runs'), read('holds', { holdId: offer.value.holdId }),
      read('quotes', { quoteId: offer.value.quoteId }), read('stock', { orderUuid: offer.value.orderUuid }),
      read('employees', { employeeId: offer.value.employeeId })]);
    const failed = [run, hold, quote, stock, employee].find((row) => row.status !== 'ok'); if (failed) return failed;
    const e = employee.value; const q = quote.value;
    const context = { runId: scope.runId, environmentId: scope.environmentId, principalId: e.principalId, employeeId: e.employeeId,
      companyId: e.companyId, gradeId: e.gradeId, schemeId: e.schemeId, entitlementSlotId: hold.value.entitlementSlotId,
      policyVersion: run.value.policyVersion, roles: ['employee'] };
    // A replay pins the stock revision the first accept saw, so its ordering intent digest is unchanged.
    const ordering = { commandId: `selection-offer:${inputDigest([input.offerId, input.commandId])}`,
      source: { type: 'buddy-offer', holdId: hold.value.holdId, expectedHoldVersion: input.expectedHoldVersion, expectedDraftVersion: q.briefVersion },
      expectedQuoteId: q.quoteId, expectedStockVersion: replay?.versions?.stock ?? stock.value.version,
      termsDigest: input.termsDigest, declarations: input.declarations };
    let decided;
    const converter = { prepare: (c, source) => prepareBuddySelection({ repository: this.#repository, clock: this.#clock }, c, source),
      convertSelection: async (_c, _allocation, { commitSelection }) => (decided = await this.#transact(prepared, input, commitSelection)) };
    const selection = await this.#ordering.submitSource(context, ordering, { converter });
    if (!['ok', 'pending'].includes(selection.status)) return selection;
    // An identical stored operation skips conversion: only the stored decision replay may succeed here.
    decided ??= await this.#transact(prepared, input, async () => conflict('selection-already-recorded'));
    return decided.status === 'ok' ? ok({ ...decided.value, selection: selection.value }) : decided;
  }

  async decide(context, input) {
    try {
      const accepting = input?.decision === 'accept';
      if (!only(input, fields) || !['commandId', 'runId', 'offerId'].every((k) => text(input[k]))
        || !['accept', 'decline'].includes(input.decision)
        || ['Offer', 'Hold', 'Quote'].some((k) => !positive(input[`expected${k}Version`]))
        || (input.decision === 'decline' ? !text(input.reasonCode) : Object.hasOwn(input, 'reasonCode'))
        || (accepting && this.#ordering ? !text(input.termsDigest) || !object(input.declarations)
          : Object.hasOwn(input, 'termsDigest') || Object.hasOwn(input, 'declarations'))) return invalid();
      const prepared = await this.#prepare(context, { runId: input.runId, offerId: input.offerId });
      if (prepared.error) return prepared.error;
      if (this.#mode !== 'local-synthetic') return unavailable('remote-decision-protocol-required');
      return await (accepting && this.#ordering ? this.#handoff(prepared, input) : this.#transact(prepared, input));
    } catch { return unavailable(); }
  }

  async #transact(prepared, input, commitSelection) {
    const { scope, time } = prepared;
    const commandId = `offer-decision:${input.offerId}:${input.commandId}`;
    const digest = inputDigest({ schemaVersion: 1, input, binding: prepared.binding });
    return await this.#repository.transaction(scope, { commandId, inputDigest: digest }, async (tx) => {
      const loaded = await this.#load(tx, scope, input, time); if (loaded.error) return loaded.error;
      const { rows } = loaded;
      const read = { runId: scope.runId, asOf: time.now, policyVersion: rows.run.policyVersion };
      const rules = await Promise.all(['hold.deadline.inclusive', 'hold.pending.blocksReallocation', 'hold.employee.maxActive']
        .map((key) => this.#policy.getAssumption(key, read)));
      if (rules.some((r) => r.status !== 'ok' || r.policyVersion !== read.policyVersion)
        || rules.slice(0, 2).some((r) => r.value?.value !== true) || !positive(rules[2].value?.value)) return unavailable('decision-rules-unavailable');
      if (new Set([...rows.holds, ...rows.claims].filter((r) => r.employeeId === rows.employee.employeeId
        && OCCUPYING_STATES.includes(r.state)).map((r) => r.holdId)).size > rules[2].value.value) return conflict('employee-hold-limit-changed');
      let reason = null; let exclusion = null; let allowance = null; let committed = null;
      if (input.decision === 'accept') {
        const checked = await this.#accept(tx, scope, rows, time); if (checked.status !== 'ok') return checked;
        allowance = checked.value.allowance;
        // Selection intent, history and allocation commit with the offer; a refusal rolls all of it back.
        if (commitSelection) { committed = await commitSelection(tx); if (committed.status !== 'ok') return committed; }
      } else {
        const reasons = await this.#reasons(scope, read); if (reasons.status !== 'ok') return reasons;
        const selected = reasons.value.reasons.find((r) => r.code === input.reasonCode);
        if (!selected) return invalid();
        const rule = await this.#policy.getAssumption('offer.declinedCar.exclusion', read);
        if (rule.status !== 'ok' || rule.policyVersion !== read.policyVersion
          || rule.value?.value !== 'untilRelevantConfirmedBriefChange') return unavailable('decline-exclusion-unavailable');
        reason = { ...selected, policyVersion: read.policyVersion, provenance: reasons.value.provenance };
        exclusion = { key: rule.value.key, value: rule.value.value, policyVersion: rule.policyVersion };
      }
      const accepting = input.decision === 'accept';
      const changed = {};
      for (const [name, table, key, patch] of [
        ['hold', 'holds', { holdId: rows.hold.holdId }, { state: accepting ? 'allocated' : 'released', ...(!accepting ? { releaseReason: 'offer-declined' } : {}) }],
        ['claim', 'claims', { claimId: rows.claim.claimId }, { state: accepting ? 'allocated' : 'released' }],
        ['offer', 'offers', { offerId: rows.offer.offerId }, { state: accepting ? 'accepted' : 'rejected' }],
        ['stock', 'stock', { orderUuid: rows.stock.orderUuid }, { state: accepting ? 'allocated' : 'released', available: !accepting, held: false, allocated: accepting }],
        ...(accepting ? [['slot', 'entitlement_slots', { entitlementSlotId: rows.slot.entitlementSlotId }, { state: 'allocated' }]] : []),
      ]) {
        const write = await tx.compareAndSwap(ref(scope, table, key), rows[name].version, patch);
        if (write.status !== 'ok') return write;
        changed[name] = write.value;
      }
      const id = inputDigest([scope.runId, commandId]); const decisionId = `offer-decision:${id}`;
      const response = ok(this.#view({ ...rows, ...changed }, time, input, { decisionId }));
      const versions = { brief: rows.brief.briefVersion, pinnedBrief: rows.quote.briefVersion,
        policy: rows.run.policyVersion, quotePolicy: rows.quote.policyVersion, employee: rows.employee.version,
        slot: rows.slot.version, stock: rows.stock.version, quote: rows.quote.version, hold: rows.hold.version,
        offer: rows.offer.version, clock: time.clockVersion, ...(exclusion ? { exclusion } : {}), ...(allowance ? { allowance } : {}) };
      const stored = await tx.insert('decisions', { runId: scope.runId, decisionId, commandId,
        offerId: rows.offer.offerId, holdId: rows.hold.holdId, employeeId: rows.employee.employeeId,
        decision: input.decision, reason, actorId: `offer:${rows.offer.offerId}`, versions,
        outcome: response, originalResponse: response });
      if (stored.status !== 'ok') return stored;
      if (committed) {
        // Briefs are immutable rows, so the selection is recorded as a receipt keyed by employee and entitlement.
        const selected = await tx.recordReceipt({ consumerId: 'brief-selection:v1', eventId: `${rows.employee.employeeId}:${rows.slot.entitlementSlotId}`,
          eventType: 'selection-recorded', state: 'completed', inputDigest: digest, outcome: ok({ briefVersion: rows.quote.briefVersion,
            offerId: rows.offer.offerId, holdId: rows.hold.holdId, orderUuid: rows.stock.orderUuid,
            operationId: committed.value.operationId, selectedAt: time.now }) });
        if (selected.status !== 'ok') return selected;
      }
      const event = { schemaVersion: 1, eventId: `offer-decision-event:${id}`,
        type: accepting ? 'offer-accepted' : 'offer-declined', runId: scope.runId,
        offerId: rows.offer.offerId, holdId: rows.hold.holdId, quoteId: rows.quote.quoteId,
        decisionId, commandId: input.commandId, employeeId: rows.employee.employeeId,
        entitlementSlotId: rows.slot.entitlementSlotId, renewalId: rows.hold.renewalId ?? null,
        orderUuid: rows.stock.orderUuid, occurredAt: time.now, policyVersion: rows.run.policyVersion,
        briefVersion: rows.brief.briefVersion, reasonCode: reason?.code ?? null, exclusion };
      const recorded = await tx.recordReceipt({ consumerId: DECISION_EVENTS, eventId: event.eventId,
        eventType: event.type, state: 'completed', inputDigest: inputDigest(event), inputVersions: versions,
        outcome: ok({ event }) });
      return recorded.status === 'ok' ? response : recorded;
    });
  }
}

export const createOfferDecisionService = (options) => new OfferDecisionService(options);
