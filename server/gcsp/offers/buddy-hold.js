import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';
import { BriefService } from '../brief/index.js';
import { createRepositoryManualPorts } from '../manual-context/ports.js';
import { mintOfferToken, resolveOfferLandingUrl } from './offer-token.js';
import { BuddyRemoteLifecycle } from './buddy-remote.js';
import { createCurrentCarComparison } from './current-car-comparison.js';

const fields = ['commandId', 'orderUuid', 'expectedBriefVersion', 'expectedStockVersion', 'expectedSlotVersion', 'expectedEmployeeVersion'];
const claimFields = ['runId', 'eventId', 'operationId', 'employeeId', 'entitlementSlotId', 'renewalId', 'orderUuid',
  'quote', 'expectedVersions', 'reasons', 'renewalDue', 'score', 'lottery'];
const object = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const only = (value, keys) => object(value) && Reflect.ownKeys(value).every((key) => keys.includes(key));
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const ref = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const conflict = (reason) => result('conflict', { reason, action: 'try-next-candidate' });
const unavailable = () => result('unavailable', { code: 'buddy-hold-unavailable', retryable: true });
const stale = (table, expectedVersion, currentVersion) => result('stale-version', {
  resource: { table }, expectedVersion, currentVersion, action: 'refresh-allocation' });
const invalid = () => result('invalid', { code: 'invalid-allocation-candidate', reasons: [{ field: 'command',
  reason: 'Supply the registered exact candidate and expected authority revisions.' }] });
const same = (left, right) => inputDigest(left) === inputDigest(right);
const pending = (operation) => result('pending', { operationId: operation.operationId,
  operationType: operation.operationType, lastKnownState: operation.lastKnownState, proposedCapability: true });

// Allocation supplies only exact-car identity and observed repository revisions.
// Facts, permission, time, quote, command digest and access token are server owned.
export class BuddyHoldService {
  #repository; #policy; #clock; #identity; #adapter;
  #startup; #remote; #offerLandingUrl;
  constructor({ repository, policy, clock, identity, adapter, offerLandingUrl } = {}) {
    this.#offerLandingUrl = resolveOfferLandingUrl(offerLandingUrl);
    this.#repository = repository; this.#policy = policy; this.#clock = clock;
    this.#identity = identity; this.#adapter = adapter;
    this.#remote = new BuddyRemoteLifecycle({ repository, policy, clock, adapter, offerLandingUrl: this.#offerLandingUrl });
  }

  start() {
    this.#startup ??= (async () => {
      if (!['local-synthetic', 'remote'].includes(this.#adapter?.mode) || typeof this.#clock?.registerHandler !== 'function') return unavailable();
      if (this.#adapter.mode === 'remote' && (typeof this.#adapter.execute !== 'function'
        || typeof this.#adapter.reconcile !== 'function')) return unavailable();
      const expiry = await this.#clock.registerHandler({ handlerId: 'buddy-expiry', stage: 'buddy-expiry',
        handle: (event) => (this.#adapter.mode === 'remote' ? this.#remote.expire(event) : this.#expire(event)).catch(() => unavailable()) });
      if (expiry.status !== 'ok' || this.#adapter.mode !== 'remote') return expiry;
      return this.#clock.registerHandler({ handlerId: 'buddy-pending-operations', stage: 'pending-reconciliation',
        handle: (event) => this.#remote.reconcile(event).catch(() => unavailable()) });
    })();
    return this.#startup;
  }

  // Only DemoClock's registered handler reaches this path, including backend startup.
  // It retires existing local authority; it never issues an employee context or a claim.
  async #expire({ context, now, clockVersion, transaction }) {
    if (this.#adapter?.mode !== 'local-synthetic' || typeof transaction !== 'function'
      || !Number.isFinite(Date.parse(now))) return unavailable();
    return transaction(async (tx) => {
      const run = await tx.get(ref(context, 'runs')); if (run.status !== 'ok') return run;
      if (run.value.environmentId !== context.environmentId || run.value.clockInstant !== now
        || run.value.clockVersion !== clockVersion) return stale('clock', clockVersion, run.value.clockVersion);
      const loaded = {};
      for (const table of ['holds', 'claims', 'offers']) {
        const rows = await tx.list(table); if (rows.status !== 'ok') return rows;
        loaded[table] = rows.value;
      }
      const expired = []; const retained = [];
      for (const hold of loaded.holds.filter((row) => row.type === 'buddy-offer' && row.state === 'active')
        .sort((a, b) => a.holdId < b.holdId ? -1 : a.holdId > b.holdId ? 1 : 0)) {
        if (!Number.isFinite(Date.parse(hold.expiresAt))) return unavailable();
        const deadline = await this.#policy.getAssumption('hold.deadline.inclusive', {
          runId: context.runId, asOf: now, policyVersion: hold.policyVersion });
        if (deadline.status !== 'ok' || deadline.policyVersion !== hold.policyVersion
          || deadline.value?.value !== true) return unavailable();
        if (Date.parse(now) < Date.parse(hold.expiresAt)) continue;
        const claims = loaded.claims.filter((row) => row.holdId === hold.holdId);
        const offers = loaded.offers.filter((row) => row.holdId === hold.holdId);
        const claim = claims[0]; const offer = offers[0];
        // Pending/selected or remote-shaped records retain their exclusion until their owner reconciles.
        if (hold.operationId || claims.length !== 1 || offers.length !== 1
          || [claim, offer].some((row) => row.state !== 'active' || row.operationId)
          || claim.type !== 'buddy-offer'
          || ['orderUuid', 'employeeId', 'quoteId', 'policyVersion', 'expiresAt'].some((key) =>
            claim[key] !== hold[key] || offer[key] !== hold[key])
          || claim.entitlementSlotId !== hold.entitlementSlotId) {
          retained.push({ holdId: hold.holdId, reason: 'authority-reconciliation-required' }); continue;
        }
        const stock = await tx.get(ref(context, 'stock', { orderUuid: hold.orderUuid }));
        if (stock.status !== 'ok') return stock;
        const otherAuthority = [...loaded.holds, ...loaded.claims].some((row) => row.holdId !== hold.holdId
          && row.orderUuid === hold.orderUuid && (OCCUPYING_STATES.includes(row.state) || row.state === 'allocated'));
        if (otherAuthority || stock.value.state !== 'held' || stock.value.held !== true
          || stock.value.available !== false || stock.value.allocated !== false) {
          retained.push({ holdId: hold.holdId, reason: 'stock-reconciliation-required' }); continue;
        }
        for (const [table, key, row, patch] of [
          ['holds', { holdId: hold.holdId }, hold, { state: 'expired', releaseReason: 'buddy-expired' }],
          ['claims', { claimId: claim.claimId }, claim, { state: 'expired' }],
          ['offers', { offerId: offer.offerId }, offer, { state: 'expired' }],
          ['stock', { orderUuid: hold.orderUuid }, stock.value, { state: 'released', available: true, held: false, allocated: false }],
        ]) {
          const changed = await tx.compareAndSwap(ref(context, table, key), row.version, patch);
          if (changed.status !== 'ok') return changed;
        }
        const outcome = { holdId: hold.holdId, offerId: offer.offerId, orderUuid: hold.orderUuid,
          state: 'expired', expiredAt: now, expiresAt: hold.expiresAt, proposedCapability: true };
        const recorded = await tx.recordReceipt({ consumerId: 'buddy-expiry', eventId: hold.holdId,
          eventType: 'buddy-expired', inputDigest: inputDigest([hold.holdId, hold.orderUuid, hold.expiresAt, hold.policyVersion]),
          inputVersions: { clock: clockVersion, policy: hold.policyVersion, hold: hold.version },
          state: 'completed', outcome: ok(outcome) });
        if (recorded.status !== 'ok') return recorded;
        expired.push(outcome);
      }
      return ok({ expired, retained });
    });
  }

  async allocate(context, input) {
    try { return await this.#allocate(context, input); } catch { return unavailable(); }
  }

  async readOperation(context, input) {
    try {
      const allowed = await this.#identity?.requireRole(context, 'employee');
      if (!allowed) return unavailable();
      if (allowed.status !== 'ok') return allowed;
      if (!only(input, ['operationId']) || !text(input.operationId)) return invalid();
      const operationRef = ref(context, 'pending_operations', { operationId: input.operationId });
      const operation = await this.#repository.read(context, operationRef);
      if (operation.status !== 'ok') return operation;
      const row = operation.value;
      if (!['buddy-claim', 'buddy-release'].includes(row.operationType)) return result('not-found', { resourceType: 'buddy-operation' });
      if (row.payload?.employeeId !== context.employeeId || row.payload?.entitlementSlotId !== context.entitlementSlotId
        || row.payload?.runId !== context.runId) return result('forbidden', { reason: 'The operation belongs to another employee entitlement.' });
      const holdRef = ref(context, 'holds', { holdId: row.holdId });
      const hold = await this.#repository.read(context, holdRef);
      if (hold.status !== 'ok') return hold;
      if (hold.value.employeeId !== context.employeeId || hold.value.entitlementSlotId !== context.entitlementSlotId
        || hold.value.orderUuid !== row.payload.orderUuid) return unavailable();
      const offers = await this.#repository.query(context, 'offers', { holdId: row.holdId });
      if (offers.status !== 'ok') return offers;
      if (offers.value.some((offer) => offer.employeeId !== context.employeeId || offer.orderUuid !== row.payload.orderUuid
        || offer.quoteId !== row.payload.quoteId || offer.environmentId !== context.environmentId
        || offer.expiresAt !== row.payload.expiresAt || offer.offerId !== row.payload.offerId)) return unavailable();
      const time = await this.#clock.now(context); if (time.status !== 'ok') return time;
      const current = await this.#repository.read(context, operationRef);
      if (current.status !== 'ok') return current;
      const currentHold = await this.#repository.read(context, holdRef);
      if (currentHold.status !== 'ok') return currentHold;
      const currentOffers = await this.#repository.query(context, 'offers', { holdId: row.holdId });
      if (currentOffers.status !== 'ok') return currentOffers;
      const currentTime = await this.#clock.now(context); if (currentTime.status !== 'ok') return currentTime;
      if (offers.value.length > 1 || !same(currentOffers.value, offers.value)
        || !same(currentTime.value, time.value) || !same(current.value, row) || !same(currentHold.value, hold.value)) return stale('buddy-operation', row.version, current.value.version);
      return ok({ operationId: row.operationId, operationType: row.operationType, state: row.state,
        lastKnownState: row.lastKnownState,
        hold: { holdId: hold.value.holdId, state: hold.value.state, orderUuid: hold.value.orderUuid, expiresAt: hold.value.expiresAt },
        offer: offers.value[0] ? { offerId: offers.value[0].offerId, state: offers.value[0].state,
          quoteId: offers.value[0].quoteId, expiresAt: offers.value[0].expiresAt } : null,
        now: time.value.now, clockVersion: time.value.clockVersion, proposedCapability: true });
    } catch { return unavailable(); }
  }

  async tryClaim(context, candidate) {
    try {
      if (!only(candidate, claimFields) || !['runId', 'eventId', 'operationId', 'employeeId', 'entitlementSlotId', 'orderUuid'].every((key) => text(candidate[key]))
        || !(candidate.renewalId === null || text(candidate.renewalId))
        || !only(candidate.expectedVersions, ['stock', 'slot', 'brief', 'permission', 'employee', 'policy', 'clock'])
        || !['stock', 'slot', 'brief', 'permission', 'employee'].every((key) => positive(candidate.expectedVersions[key]))
        || !['policy', 'clock'].every((key) => text(candidate.expectedVersions[key]))
        || !only(candidate.quote, ['orderUuid', 'configurationId', 'snapshot', 'terms', 'employeeFacts', 'versions', 'reasons', 'tradeOffs'])
        || !only(candidate.quote.versions, ['brief', 'facts', 'policy', 'stock', 'snapshot', 'terms', 'clock', 'availability'])
        || !Array.isArray(candidate.quote.reasons) || !Array.isArray(candidate.quote.tradeOffs)) return invalid();
      if (candidate.runId !== context?.runId) return result('stale-run', { reason: 'Allocation belongs to another run.' });
      if (candidate.employeeId !== context.employeeId || candidate.entitlementSlotId !== context.entitlementSlotId) return conflict('allocation-owner-mismatch');
      const operationId = `allocation:${inputDigest([context.runId, candidate.eventId, context.employeeId, candidate.orderUuid])}`;
      if (candidate.operationId !== operationId) return invalid();
      inputDigest(candidate);
      return await this.#allocate(context, { commandId: operationId, orderUuid: candidate.orderUuid,
        expectedBriefVersion: candidate.expectedVersions.brief, expectedStockVersion: candidate.expectedVersions.stock,
        expectedSlotVersion: candidate.expectedVersions.slot, expectedEmployeeVersion: candidate.expectedVersions.employee }, candidate);
    } catch { return invalid(); }
  }

  async #allocate(context, input, proposal = null) {
    if (!this.#repository || !this.#policy || !this.#clock || !this.#identity) return unavailable();
    const allowed = await this.#identity.requireRole(context, 'employee');
    if (allowed.status !== 'ok') return allowed;
    const remote = this.#adapter?.mode === 'remote' && typeof this.#adapter.execute === 'function'
      && typeof this.#adapter.reconcile === 'function';
    if (this.#adapter?.mode !== 'local-synthetic' && !remote) return result('unavailable', {
      code: 'buddy-stock-mode-not-supported', retryable: false, supportedMode: 'local-synthetic' });
    if (!only(input, fields)
      || !text(input.commandId) || !text(input.orderUuid) || fields.slice(2).some((key) => !positive(input[key]))) {
      return result('invalid', { code: 'invalid-allocation-candidate', reasons: [{ field: 'command', reason: 'Supply exact stock and expected brief, stock, slot and employee revisions.' }] });
    }
    const command = { commandId: `buddy-allocation:${context.employeeId}:${input.commandId}`,
      inputDigest: inputDigest({ operation: 'buddy-allocation:v1', input, proposal, employeeId: context.employeeId,
        entitlementSlotId: context.entitlementSlotId, environmentId: context.environmentId, runId: context.runId }) };
    const time = await this.#clock.now(context);
    if (time.status !== 'ok') return time;
    if (time.value.runId !== context.runId || !Number.isFinite(Date.parse(time.value.now))) return unavailable();
    const outcome = await this.#repository.transaction(context, command, async (tx) => {
      const run = await tx.get(ref(context, 'runs')); if (run.status !== 'ok') return run;
      for (const [key, current] of [['policy', run.value.policyVersion], ['clock', run.value.clockVersion]]) {
        if (proposal && proposal.expectedVersions[key] !== current) return stale(key, proposal.expectedVersions[key], current);
      }
      if (run.value.policyVersion !== context.policyVersion) return conflict('policy-changed');
      if (run.value.clockVersion !== time.value.clockVersion || run.value.clockInstant !== time.value.now) {
        return stale('clock', time.value.clockVersion, run.value.clockVersion);
      }
      const employee = await tx.get(ref(context, 'employees', { employeeId: context.employeeId }));
      if (employee.status !== 'ok') return employee;
      if (employee.value.version !== input.expectedEmployeeVersion) return stale('employees', input.expectedEmployeeVersion, employee.value.version);
      if (['principalId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId']
        .some((key) => employee.value[key] !== context[key])) return conflict('employee-authority-changed');
      const slot = await tx.get(ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
      if (slot.status !== 'ok') return slot;
      if (slot.value.version !== input.expectedSlotVersion) return stale('entitlement_slots', input.expectedSlotVersion, slot.value.version);
      if (slot.value.employeeId !== context.employeeId || ['disabled', 'allocated'].includes(slot.value.state)) return conflict('entitlement-unavailable');
      const stock = await tx.get(ref(context, 'stock', { orderUuid: input.orderUuid })); if (stock.status !== 'ok') return stock;
      if (stock.value.version !== input.expectedStockVersion) return stale('stock', input.expectedStockVersion, stock.value.version);
      if (stock.value.state !== 'released' || stock.value.available !== true || stock.value.held === true || stock.value.allocated === true) return conflict('stock-unavailable');

      // Only the exact adapter-owned context authorized above is admitted here.
      // Transaction reads and the revalidated clock avoid repository lock reentry.
      const repository = { read: (candidateContext, key) => candidateContext === context ? tx.get(key) : Promise.resolve(conflict('context-changed')),
        query: (candidateContext, table, filter) => candidateContext === context ? tx.list(table, filter) : Promise.resolve(conflict('context-changed')) };
      const clock = { now: async (candidateContext) => candidateContext === context ? time : conflict('context-changed') };
      const identity = { requireRole: async (candidateContext, role) => candidateContext === context && role === 'employee' ? allowed : conflict('context-changed') };
      const brief = new BriefService({ repository, policy: this.#policy, clock, identity });
      const current = await brief.readCurrent(context); if (current.status !== 'ok') return current;
      if (current.value.brief.briefVersion !== input.expectedBriefVersion) return stale('briefs', input.expectedBriefVersion, current.value.brief.briefVersion);
      const savedBrief = current.value.brief;
      if (proposal && proposal.expectedVersions.permission !== savedBrief.buddy.permissionVersion) {
        return stale('permission', proposal.expectedVersions.permission, savedBrief.buddy.permissionVersion);
      }
      if (!current.value.activity.canHold) return conflict('buddy-not-permitted-to-hold');
      const renewalId = savedBrief.renewalId ?? slot.value.renewalId ?? employee.value.renewalId ?? null;
      if (renewalId !== null && !text(renewalId)) return unavailable();
      if (context.renewalId != null && context.renewalId !== renewalId || proposal && proposal.renewalId !== renewalId) return conflict('renewal-mismatch');
      const ports = createRepositoryManualPorts({ repository, policy: this.#policy });
      const released = await ports.releasedStock.read(context); if (released.status !== 'ok') return released;
      const candidate = released.value.stock.find((car) => car.orderUuid === input.orderUuid);
      if (!candidate) return conflict('stock-not-visible');
      const stored = employee.value.contract?.manualContext;
      const driver = stored?.drivers?.find((item) => item.kind === 'employee' && item.employeeId === context.employeeId);
      if (!stored?.employeeFacts || !driver) return unavailable();
      const employeeFacts = structuredClone(stored.employeeFacts);
      if (employeeFacts.driverEligible === undefined) employeeFacts.driverEligible = driver.eligible;
      const charging = savedBrief.essentials.charging;
      if (charging) employeeFacts.charging = { status: charging.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
        value: charging.value, unit: null, provenance: { sourceRef: charging.source, version: String(savedBrief.briefVersion),
          observedAt: savedBrief.confirmedAt, assurance: 'synthetic-scenario' } };
      const evaluated = await brief.evaluateCandidate(context, { candidate, employeeFacts });
      if (evaluated.status !== 'ok') return evaluated;
      const decision = evaluated.value;
      if (decision?.gateStatus !== 'eligible' || !decision.terms) return conflict('candidate-not-eligible');
      if (proposal) {
        const quote = proposal.quote;
        const expected = { brief: savedBrief.briefVersion, facts: `employee:${employee.value.version}`, policy: context.policyVersion,
          snapshot: decision.snapshot.snapshotVersion, terms: decision.terms.termsVersion, clock: time.value.clockVersion,
          availability: String(stock.value.version) };
        if (Object.entries(expected).some(([key, value]) => quote.versions[key] !== value) || !text(quote.versions.stock)) return conflict('allocation-quote-versions-mismatch');
        if (quote.orderUuid !== input.orderUuid || quote.configurationId !== stock.value.configurationId
          || !same(quote.snapshot, decision.snapshot) || !same(quote.terms, decision.terms)
          || !same(quote.employeeFacts, employeeFacts) || !same(quote.reasons, decision.reasons)
          || !same(quote.tradeOffs, decision.tradeOffs)) return conflict('allocation-quote-mismatch');
      }
      const rules = await Promise.all(['hold.buddy.durationSeconds', 'hold.employee.maxActive',
        'hold.deadline.inclusive', 'hold.pending.blocksReallocation', 'hold.replacement.releaseFirst']
        .map((key) => this.#policy.getAssumption(key, { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion })));
      if (rules.some((rule) => rule.status !== 'ok' || rule.policyVersion !== context.policyVersion)
        || !positive(rules[0].value?.value) || !positive(rules[1].value?.value)
        || rules.slice(2).some((rule) => rule.value?.value !== true)) return unavailable();
      const [duration, maximum] = rules;
      const holds = await tx.list('holds'); if (holds.status !== 'ok') return holds;
      const claims = await tx.list('claims'); if (claims.status !== 'ok') return claims;
      const authority = [...holds.value, ...claims.value];
      const occupying = new Set(authority.filter((hold) => hold.employeeId === context.employeeId && OCCUPYING_STATES.includes(hold.state))
        .map((hold) => hold.holdId));
      if (occupying.size >= maximum.value.value || authority.some((hold) =>
        hold.entitlementSlotId === context.entitlementSlotId && (OCCUPYING_STATES.includes(hold.state) || hold.state === 'allocated')
        || renewalId && hold.renewalId === renewalId && (OCCUPYING_STATES.includes(hold.state) || hold.state === 'allocated'))) return conflict('release-required');
      const expiresAt = new Date(Date.parse(time.value.now) + duration.value.value * 1000).toISOString();
      const id = inputDigest([context.runId, command.commandId]);
      const quoteId = `buddy-quote:${id}`; const holdId = `buddy-hold:${id}`; const offerId = `buddy-offer:${id}`;
      const operationId = remote ? `buddy-op:${inputDigest([command.commandId, 'buddy-claim'])}` : null;
      const quote = await tx.insert('quotes', { runId: context.runId, quoteId, orderUuid: input.orderUuid,
        employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, configurationId: stock.value.configurationId,
        facts: decision.snapshot, eligibility: { ...decision.evidence.eligibility, decision,
          currentCarComparison: createCurrentCarComparison({ context, employee: employee.value, slot: slot.value, now: time.value.now }),
          employeeVersion: employee.value.version, slotVersion: slot.value.version, stockVersion: stock.value.version,
          holdTiming: duration.value, holdRules: rules.map((rule) => rule.value) }, terms: decision.terms, briefVersion: input.expectedBriefVersion,
        policyVersion: context.policyVersion, quotedAt: time.value.now, validUntil: decision.terms.validUntil,
        expiresAt: decision.terms.validUntil, provenance: decision.terms.provenance,
        monthlyPoints: decision.terms.points, allowance: decision.terms.allowanceInputs });
      if (quote.status !== 'ok') return quote;
      const available = await tx.compareAndSwap(ref(context, 'stock', { orderUuid: input.orderUuid }), stock.value.version, { state: 'available' });
      if (available.status !== 'ok') return available;
      const held = await tx.conditionalClaim({ orderUuid: input.orderUuid, holdId, claimId: `buddy-claim:${id}`,
        employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, ...(renewalId ? { renewalId } : {}),
        type: 'buddy-offer', state: remote ? 'claim-pending' : 'active', expiresAt, policyVersion: context.policyVersion, quoteId,
        expectedStockVersion: available.value.version, expectedSlotVersion: slot.value.version });
      if (held.status !== 'ok') return held;
      if (renewalId || remote) {
        const boundClaim = await tx.compareAndSwap(ref(context, 'claims', { claimId: held.value.claim.claimId }),
          held.value.claim.version, { ...(renewalId ? { renewalId } : {}), ...(remote ? { operationId } : {}) });
        if (boundClaim.status !== 'ok') return boundClaim;
      }
      const flags = await tx.compareAndSwap(ref(context, 'stock', { orderUuid: input.orderUuid }), held.value.stockVersion,
        { available: false, held: true, allocated: false });
      if (flags.status !== 'ok') return flags;
      if (remote) {
        const attached = await tx.compareAndSwap(ref(context, 'holds', { holdId }), held.value.hold.version, { operationId });
        if (attached.status !== 'ok') return attached;
        const operation = await tx.insert('pending_operations', { runId: context.runId, operationId,
          operationType: 'buddy-claim', idempotencyKey: command.commandId, inputDigest: command.inputDigest,
          holdId, state: 'pending', attempts: 0, lastKnownState: 'claim-pending', payload: {
            runId: context.runId, environmentId: context.environmentId, orderUuid: input.orderUuid,
            employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, quoteId, expiresAt,
            holdId, offerId, jobId: `buddy-notification:${id}`, renewalId, target: 'active', reason: null, quote: quote.value,
            authority: Object.fromEntries(['principalId', 'employeeId', 'entitlementSlotId', 'companyId', 'schemeId', 'gradeId', 'policyVersion']
              .map((key) => [key, context[key]])),
            expectedStockVersion: flags.value.version, expectedSlotVersion: held.value.slotVersion,
            expectedHoldVersion: attached.value.version, expectedClaimVersion: held.value.claim.version + 1, expectedEmployeeVersion: employee.value.version,
            expectedBriefVersion: input.expectedBriefVersion, expectedPermissionVersion: current.value.brief.buddy.permissionVersion,
          } });
        return operation.status === 'ok' ? pending(operation.value) : operation;
      }
      const token = mintOfferToken({ environmentId: context.environmentId, runId: context.runId, offerId },
        { offerLandingUrl: this.#offerLandingUrl });
      const offer = await tx.insert('offers', { runId: context.runId, environmentId: context.environmentId, offerId,
        holdId, quoteId, employeeId: context.employeeId, orderUuid: input.orderUuid, state: 'active',
        briefVersion: input.expectedBriefVersion, policyVersion: context.policyVersion, expiresAt,
        tokenHash: token.tokenHash, tokenMetadata: token.tokenMetadata });
      if (offer.status !== 'ok') return offer;
      const job = await tx.enqueueNotification({ jobId: `buddy-notification:${id}`, idempotencyKey: `offer:${offerId}:notification:offer:1`,
        inputDigest: inputDigest({ offerId, messageKind: 'offer', messageVersion: '1' }), offerId,
        messageKind: 'offer', messageVersion: '1', recipientId: context.employeeId, transport: 'captured',
        state: 'pending', attempts: 0, payload: { offerLink: token.offerLink } });
      if (job.status !== 'ok') return job;
      const { tokenHash, tokenMetadata, ...offerView } = offer.value;
      return ok({ state: 'offered', hold: held.value.hold, quote: quote.value, offer: offerView,
        notification: { jobId: job.value.jobId, state: job.value.state }, now: time.value.now,
        clockVersion: time.value.clockVersion, proposedCapability: true });
    });
    // The durable original command response stays historical after reconciliation.
    if (remote && outcome.status === 'pending') await this.#remote.drive(context, outcome.operationId).catch(() => null);
    return outcome;
  }
}

export const createBuddyHoldService = (options) => new BuddyHoldService(options);
