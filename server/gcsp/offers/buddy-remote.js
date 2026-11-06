import { randomUUID } from 'node:crypto';
import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';
import { createRepositoryManualPorts } from '../manual-context/ports.js';
import { createStoredSubjectRecommendationEvaluator } from '../recommendation/index.js';
import { mintOfferToken } from './offer-token.js';

const ref = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const same = (a, b) => inputDigest(a) === inputDigest(b);
const pending = (operation) => result('pending', { operationId: operation.operationId,
  operationType: operation.operationType, lastKnownState: operation.lastKnownState, proposedCapability: true });
const retained = () => ok({ state: 'retained', reason: 'authority-reconciliation-required' });
const unavailable = () => result('unavailable', { code: 'buddy-remote-unavailable', retryable: true });
const remoteType = (operation) => ['buddy-claim', 'buddy-release'].includes(operation.operationType);
const occupied = (row) => OCCUPYING_STATES.includes(row.state) || row.state === 'allocated';
const subjectKeys = ['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion'];
const termsBasis = ({ termsVersion, validFrom, validUntil, provenance, ...terms }) => ({ ...terms,
  provenance: Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== 'observedAt')) });

// Backend lifecycle only. A subject is derived from an authenticated durable intent;
// it is never used as a session or passed to an employee write entry.
export class BuddyRemoteLifecycle {
  #repository; #policy; #clock; #adapter;
  constructor({ repository, policy, clock, adapter }) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#adapter = adapter;
  }

  async #transaction(context, phase, work) {
    const id = randomUUID();
    return this.#repository.transaction(context, { commandId: `buddy-remote:${phase}:${id}`,
      inputDigest: inputDigest([phase, id]) }, work);
  }

  async #load(tx, context, operation) {
    const p = operation.payload;
    if (!remoteType(operation) || operation.runId !== context.runId || p?.runId !== context.runId
      || p.environmentId !== context.environmentId || operation.holdId !== p.holdId
      || !Number.isFinite(Date.parse(p.expiresAt))) return null;
    const found = {};
    for (const [name, table, key] of [
      ['run', 'runs', {}], ['hold', 'holds', { holdId: operation.holdId }],
      ['stock', 'stock', { orderUuid: p.orderUuid }], ['quote', 'quotes', { quoteId: p.quoteId }],
      ['employee', 'employees', { employeeId: p.employeeId }],
      ['slot', 'entitlement_slots', { entitlementSlotId: p.entitlementSlotId }],
    ]) {
      const row = await tx.get(ref(context, table, key)); if (row.status !== 'ok') return null;
      found[name] = row.value;
    }
    for (const table of ['holds', 'claims', 'offers', 'briefs']) {
      const rows = await tx.list(table); if (rows.status !== 'ok') return null;
      found[table] = rows.value;
    }
    const claims = found.claims.filter((row) => row.holdId === operation.holdId);
    const offers = found.offers.filter((row) => row.holdId === operation.holdId);
    if (claims.length !== 1 || offers.length > 1) return null;
    found.claim = claims[0]; found.offer = offers[0] ?? null;
    if (found.run.environmentId !== context.environmentId
      || ['hold', 'claim', ...(found.offer ? ['offer'] : [])].some((name) =>
        ['orderUuid', 'employeeId', 'quoteId', 'expiresAt'].some((key) => found[name][key] !== p[key])
        || found[name].policyVersion !== p.authority?.policyVersion)
      || [found.hold, found.claim].some((row) => row.type !== 'buddy-offer'
        || row.entitlementSlotId !== p.entitlementSlotId || (row.renewalId ?? null) !== p.renewalId)
      || found.quote.employeeId !== p.employeeId || found.quote.orderUuid !== p.orderUuid
      || found.quote.entitlementSlotId !== p.entitlementSlotId || !same(found.quote, p.quote)) return null;
    let origin = operation;
    if (operation.operationType === 'buddy-release') {
      const original = await tx.get(ref(context, 'pending_operations', { operationId: p.sourceClaimOperationId }));
      if (original.status !== 'ok' || original.value.operationType !== 'buddy-claim'
        || original.value.state !== 'confirmed' || original.value.holdId !== operation.holdId
        || !same(original.value.payload.authority, p.authority)
        || ['runId', 'environmentId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'renewalId', 'quoteId', 'expiresAt', 'offerId', 'jobId']
          .some((key) => original.value.payload[key] !== p[key])) return null;
      origin = original.value;
    }
    const receipt = await tx.get(ref(context, 'event_receipts', {
      consumerId: 'command:transaction', eventId: origin.idempotencyKey }));
    if (receipt.status !== 'ok' || receipt.value.inputDigest !== origin.inputDigest
      || receipt.value.outcome?.status !== 'pending' || receipt.value.outcome.operationId !== origin.operationId
      || receipt.value.outcome.operationType !== 'buddy-claim') return null;
    return { ...found, origin };
  }

  #aligned(operation, rows) {
    const p = operation.payload;
    const state = operation.operationType === 'buddy-claim' ? 'claim-pending' : 'release-pending';
    return [rows.hold, rows.claim].every((row) => row.state === state && row.operationId === operation.operationId)
      && rows.hold.version === p.expectedHoldVersion && rows.claim.version === p.expectedClaimVersion
      && (!rows.offer || operation.operationType === 'buddy-release' && rows.offer.state === state
        && rows.offer.operationId === operation.operationId && rows.offer.version === p.expectedOfferVersion)
      && rows.stock.state === 'held' && rows.stock.available === false && rows.stock.held === true && rows.stock.allocated === false
      && ![...rows.holds, ...rows.claims].some((row) => row.holdId !== operation.holdId
        && occupied(row) && (row.orderUuid === p.orderUuid || row.entitlementSlotId === p.entitlementSlotId
          || rows.hold.renewalId && row.renewalId === rows.hold.renewalId));
  }

  async #valid(tx, context, operation, rows) {
    const p = operation.payload; const { employee, slot, stock, run, quote } = rows;
    const now = run.clockInstant;
    if (!Number.isFinite(Date.parse(now)) || Date.parse(now) >= Date.parse(p.expiresAt)
      || !Number.isFinite(Date.parse(quote.validUntil)) || Date.parse(now) >= Date.parse(quote.validUntil)
      || run.policyVersion !== p.authority.policyVersion || stock.version !== p.expectedStockVersion
      || slot.version !== p.expectedSlotVersion || employee.version !== p.expectedEmployeeVersion
      || ['principalId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId']
        .some((key) => employee[key] !== p.authority[key])
      || !employee.roles?.includes('employee') || slot.employeeId !== p.employeeId || ['disabled', 'allocated'].includes(slot.state)) return false;
    const brief = rows.briefs.filter((row) => row.employeeId === p.employeeId && row.status === 'confirmed')
      .sort((a, b) => a.briefVersion - b.briefVersion).at(-1);
    if (!brief || brief.briefVersion !== p.expectedBriefVersion || brief.policyVersion !== run.policyVersion
      || brief.buddy?.permissionVersion !== p.expectedPermissionVersion || brief.buddy.searchConsent !== true
      || brief.buddy.holdConsent !== true || brief.buddy.paused !== false
      || brief.entitlementSlotId !== p.entitlementSlotId
      || (brief.renewalId ?? slot.renewalId ?? employee.renewalId ?? null) !== (rows.hold.renewalId ?? null)) return false;
    const subject = Object.freeze(Object.fromEntries(subjectKeys.map((key) => [key,
      key === 'runId' ? context.runId : key === 'environmentId' ? context.environmentId : employee[key] ?? run[key]])));
    const read = { runId: context.runId, asOf: now, policyVersion: run.policyVersion };
    const rules = await Promise.all(['hold.deadline.inclusive', 'hold.pending.blocksReallocation',
      'hold.replacement.releaseFirst', 'hold.employee.maxActive'].map((key) => this.#policy.getAssumption(key, read)));
    if (rules.some((row) => row.status !== 'ok' || row.policyVersion !== run.policyVersion)
      || rules.slice(0, 3).some((row) => row.value.value !== true)
      || !Number.isSafeInteger(rules[3].value.value) || rules[3].value.value < 1
      || new Set([...rows.holds, ...rows.claims].filter((row) => row.employeeId === p.employeeId && occupied(row))
        .map((row) => row.holdId)).size > rules[3].value.value) return false;
    // Expose the currently owned exact car to the shared calculation as available.
    // All visibility/facts still come from the real repository port; no write occurs.
    const repository = { read: (candidate, key) => candidate === subject ? tx.get(key) : Promise.resolve(unavailable()),
      query: async (candidate, table, filter) => {
        if (candidate !== subject) return unavailable();
        const result = await tx.list(table, filter);
        return result.status === 'ok' && table === 'stock' ? ok(result.value.map((row) => row.orderUuid === p.orderUuid
          ? { ...row, state: 'released', available: true, held: false, allocated: false } : row)) : result;
      } };
    const ports = createRepositoryManualPorts({ repository, policy: this.#policy });
    const released = await ports.releasedStock.read(subject);
    if (released.status !== 'ok') return false;
    const candidate = released.value.stock.find((row) => row.orderUuid === p.orderUuid);
    const stored = employee.contract?.manualContext;
    const driver = stored?.drivers?.find((row) => row.kind === 'employee' && row.employeeId === p.employeeId);
    if (!candidate || !stored?.employeeFacts || !driver) return false;
    const facts = structuredClone(stored.employeeFacts);
    if (facts.driverEligible === undefined) facts.driverEligible = driver.eligible;
    const charging = brief.essentials.charging;
    facts.charging = { status: charging?.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
      value: charging?.value ?? null, unit: null, provenance: { sourceRef: charging?.source ?? 'brief:unresolved',
        version: String(brief.briefVersion), observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
    const evaluator = createStoredSubjectRecommendationEvaluator({ policy: this.#policy,
      time: { now: async () => ok({ runId: context.runId, now, clockVersion: run.clockVersion }) },
      provider: { resolve: async () => ok({ runId: subject.runId, environmentId: subject.environmentId,
        employeeId: subject.employeeId, factsVersion: String(brief.briefVersion),
        stockVersion: candidate.availability.version, employeeFacts: facts, stock: [candidate] }) } });
    const evaluated = await evaluator.evaluate(subject, { schemaVersion: 1, briefVersion: brief.briefVersion,
      preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) });
    const decision = evaluated.status === 'ok' ? evaluated.value.decisions[0] : null;
    return decision?.gateStatus === 'eligible' && decision.terms && same(decision.snapshot, quote.facts)
      && same(termsBasis(decision.terms), termsBasis(quote.terms));
  }

  async #release(tx, context, operation, rows, reason) {
    const p = operation.payload;
    const operationId = `buddy-op:${inputDigest([operation.operationId, 'buddy-release'])}`;
    const changed = {};
    for (const [table, key, row] of [['holds', 'holdId', rows.hold], ['claims', 'claimId', rows.claim],
      ...(rows.offer ? [['offers', 'offerId', rows.offer]] : [])]) {
      const updated = await tx.compareAndSwap(ref(context, table, { [key]: row[key] }), row.version,
        { state: 'release-pending', operationId, ...(table === 'holds' ? { releaseReason: reason } : {}) });
      if (updated.status !== 'ok') return updated;
      changed[table] = updated.value;
    }
    const release = await tx.insert('pending_operations', { runId: context.runId, operationId,
      operationType: 'buddy-release', idempotencyKey: `${operation.idempotencyKey}:release`,
      inputDigest: inputDigest([operation.operationId, p.orderUuid, reason]), holdId: operation.holdId,
      state: 'pending', attempts: 0, lastKnownState: 'release-pending', payload: { ...p,
        sourceClaimOperationId: operation.operationId, target: reason === 'buddy-expired' ? 'expired' : 'released', reason,
        expectedStockVersion: rows.stock.version, expectedSlotVersion: rows.slot.version,
        expectedHoldVersion: changed.holds.version, expectedClaimVersion: changed.claims.version,
        expectedOfferVersion: changed.offers?.version ?? null } });
    return release.status === 'ok' ? pending(release.value) : release;
  }

  async #finish(tx, context, operation, rows, state, remoteState) {
    for (const [table, key, row] of [['holds', 'holdId', rows.hold], ['claims', 'claimId', rows.claim],
      ...(rows.offer ? [['offers', 'offerId', rows.offer]] : [])]) {
      const changed = await tx.compareAndSwap(ref(context, table, { [key]: row[key] }), row.version,
        { state, ...(table === 'holds' ? { releaseReason: operation.payload.reason ?? 'buddy-claim-rejected' } : {}) });
      if (changed.status !== 'ok') return changed;
    }
    const stock = await tx.compareAndSwap(ref(context, 'stock', { orderUuid: operation.payload.orderUuid }), rows.stock.version,
      { state: 'released', available: true, held: false, allocated: false });
    if (stock.status !== 'ok') return stock;
    const outcome = { state, holdId: rows.hold.holdId, orderUuid: rows.hold.orderUuid,
      ...(rows.offer ? { offerId: rows.offer.offerId } : {}), expiresAt: rows.hold.expiresAt,
      ...(state === 'expired' ? { expiredAt: rows.run.clockInstant } : {}), proposedCapability: true };
    if (state === 'expired') {
      const receipt = await tx.recordReceipt({ consumerId: 'buddy-expiry', eventId: rows.hold.holdId,
        eventType: 'buddy-expired', inputDigest: inputDigest([rows.hold.holdId, rows.hold.orderUuid, rows.hold.expiresAt, rows.hold.policyVersion]),
        inputVersions: { clock: rows.run.clockVersion, policy: rows.hold.policyVersion, hold: rows.hold.version },
        state: 'completed', outcome: ok(outcome) });
      if (receipt.status !== 'ok') return receipt;
    }
    const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId: operation.operationId }),
      operation.version, { state: remoteState, lastKnownState: remoteState, outcome });
    return changed.status === 'ok' ? ok(outcome) : changed;
  }

  async #offered(tx, context, operation, rows) {
    const p = operation.payload;
    for (const [table, key, row] of [['holds', 'holdId', rows.hold], ['claims', 'claimId', rows.claim]]) {
      const changed = await tx.compareAndSwap(ref(context, table, { [key]: row[key] }), row.version, { state: 'active' });
      if (changed.status !== 'ok') return changed;
    }
    const token = mintOfferToken({ environmentId: p.environmentId, runId: p.runId, offerId: p.offerId });
    const offer = await tx.insert('offers', { runId: p.runId, environmentId: p.environmentId, offerId: p.offerId,
      holdId: operation.holdId, quoteId: p.quoteId, employeeId: p.employeeId, orderUuid: p.orderUuid,
      state: 'active', briefVersion: p.expectedBriefVersion, policyVersion: p.authority.policyVersion,
      expiresAt: p.expiresAt, operationId: operation.operationId, tokenHash: token.tokenHash, tokenMetadata: token.tokenMetadata });
    if (offer.status !== 'ok') return offer;
    const job = await tx.enqueueNotification({ jobId: p.jobId, idempotencyKey: `offer:${p.offerId}:notification:offer:1`,
      inputDigest: inputDigest({ offerId: p.offerId, messageKind: 'offer', messageVersion: '1' }), offerId: p.offerId,
      messageKind: 'offer', messageVersion: '1', recipientId: p.employeeId, transport: 'captured',
      state: 'pending', attempts: 0, payload: { offerLink: token.offerLink } });
    if (job.status !== 'ok') return job;
    const outcome = { state: 'offered', offerId: p.offerId, holdId: p.holdId, quoteId: p.quoteId,
      notification: { jobId: p.jobId, state: job.value.state }, expiresAt: p.expiresAt, proposedCapability: true };
    const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId: operation.operationId }),
      operation.version, { state: 'confirmed', lastKnownState: 'confirmed', outcome });
    return changed.status === 'ok' ? ok(outcome) : changed;
  }

  async #attempt(context, operationId) {
    const prepared = await this.#transaction(context, 'attempt', async (tx) => {
      const found = await tx.get(ref(context, 'pending_operations', { operationId }));
      if (found.status !== 'ok') return found;
      const operation = found.value;
      if (operation.state !== 'pending') return ok({ terminal: true });
      if (!Number.isSafeInteger(operation.attempts) || operation.attempts < 0) return retained();
      const rows = await this.#load(tx, context, operation);
      if (!rows || !this.#aligned(operation, rows)) return retained();
      const valid = operation.operationType === 'buddy-release' || await this.#valid(tx, context, operation, rows);
      const execute = valid && (operation.attempts === 0 || operation.lastKnownState === 'not-found');
      const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId }), operation.version,
        { attempts: operation.attempts + 1, lastKnownState: operation.operationType === 'buddy-claim' ? 'claim-pending' : 'release-pending' });
      return changed.status === 'ok' ? ok({ operation: changed.value, method: execute ? 'execute' : 'reconcile' }) : changed;
    });
    if (prepared.status !== 'ok' || !prepared.value.operation) return prepared;
    const { operation, method } = prepared.value;
    let acknowledgement;
    try { acknowledgement = await this.#adapter[method](structuredClone(operation)); } catch { acknowledgement = null; }
    return this.#transaction(context, 'ack', async (tx) => {
      const current = await tx.get(ref(context, 'pending_operations', { operationId }));
      if (current.status !== 'ok') return current;
      if (!same(current.value, operation) || current.value.state !== 'pending') return retained();
      const rows = await this.#load(tx, context, operation);
      if (!rows || !this.#aligned(operation, rows)) return retained();
      const matched = ['confirmed', 'rejected', 'not-found'].includes(acknowledgement?.status)
        && acknowledgement.operationId === operationId && acknowledgement.runId === context.runId
        && acknowledgement.orderUuid === operation.payload.orderUuid;
      if (!matched || operation.operationType === 'buddy-release' && acknowledgement.status === 'rejected') {
        const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId }), operation.version,
          { lastKnownState: matched ? 'rejected' : 'unknown' });
        return changed.status === 'ok' ? pending(changed.value) : changed;
      }
      const valid = operation.operationType === 'buddy-release' || await this.#valid(tx, context, operation, rows);
      if (acknowledgement.status === 'not-found') {
        // Only an authoritative reconcile absence permits another execute.
        if (method !== 'reconcile') {
          const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId }), operation.version,
            { lastKnownState: 'unknown' });
          return changed.status === 'ok' ? pending(changed.value) : changed;
        }
        if (valid) {
          const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId }), operation.version,
            { lastKnownState: 'not-found' });
          return changed.status === 'ok' ? ok({ retry: true }) : changed;
        }
        return this.#finish(tx, context, operation, rows,
          Date.parse(rows.run.clockInstant) >= Date.parse(rows.hold.expiresAt) ? 'expired' : 'released', 'rejected');
      }
      if (operation.operationType === 'buddy-release') {
        if (rows.stock.version !== operation.payload.expectedStockVersion) return retained();
        return this.#finish(tx, context, operation, rows, operation.payload.target, 'confirmed');
      }
      if (acknowledgement.status === 'rejected') return this.#finish(tx, context, operation, rows, 'released', 'rejected');
      if (valid) return this.#offered(tx, context, operation, rows);
      const changed = await tx.compareAndSwap(ref(context, 'pending_operations', { operationId }), operation.version,
        { state: 'confirmed', lastKnownState: 'confirmed', outcome: { state: 'release-pending' } });
      return changed.status === 'ok' ? this.#release(tx, context, operation, rows,
        Date.parse(rows.run.clockInstant) >= Date.parse(rows.hold.expiresAt) ? 'buddy-expired' : 'prerequisites-changed') : changed;
    });
  }

  async drive(context, operationId) {
    if (this.#adapter?.mode !== 'remote' || typeof this.#adapter.execute !== 'function'
      || typeof this.#adapter.reconcile !== 'function') return unavailable();
    try {
      const outcome = await this.#attempt(context, operationId);
      return outcome.status === 'ok' && outcome.value.retry ? await this.#attempt(context, operationId) : outcome;
    } catch { return unavailable(); }
  }

  async reconcile({ context }) {
    const operations = await this.#repository.query(context, 'pending_operations', { state: 'pending' });
    if (operations.status !== 'ok') return operations;
    for (const operation of operations.value.filter(remoteType).sort((a, b) => a.operationId.localeCompare(b.operationId))) {
      const outcome = await this.drive(context, operation.operationId);
      if (!['ok', 'pending'].includes(outcome.status)) return outcome;
    }
    const remaining = await this.#repository.query(context, 'pending_operations', { state: 'pending' });
    if (remaining.status !== 'ok') return remaining;
    const operation = remaining.value.find(remoteType);
    return operation ? pending(operation) : ok({ state: 'reconciled' });
  }

  async expire({ context, now, clockVersion, transaction }) {
    return transaction(async (tx) => {
      const run = await tx.get(ref(context, 'runs')); if (run.status !== 'ok') return run;
      if (run.value.clockInstant !== now || run.value.clockVersion !== clockVersion) return retained();
      const holds = await tx.list('holds', { type: 'buddy-offer', state: 'active' });
      if (holds.status !== 'ok') return holds;
      const releases = [];
      for (const hold of holds.value) {
        if (!hold.operationId || Date.parse(now) < Date.parse(hold.expiresAt)) continue;
        const rule = await this.#policy.getAssumption('hold.deadline.inclusive', {
          runId: context.runId, asOf: now, policyVersion: hold.policyVersion });
        if (rule.status !== 'ok' || rule.policyVersion !== hold.policyVersion || rule.value.value !== true) return unavailable();
        const found = await tx.get(ref(context, 'pending_operations', { operationId: hold.operationId }));
        if (found.status !== 'ok') return found;
        const operation = found.value; const rows = await this.#load(tx, context, operation);
        if (!rows || operation.operationType !== 'buddy-claim' || operation.state !== 'confirmed'
          || !rows.offer || [rows.hold, rows.claim, rows.offer].some((row) => row.state !== 'active'
            || row.operationId !== operation.operationId)
          || rows.stock.state !== 'held' || rows.stock.available !== false || rows.stock.held !== true || rows.stock.allocated !== false
          || [...rows.holds, ...rows.claims].some((row) => row.holdId !== hold.holdId && row.orderUuid === hold.orderUuid && occupied(row))) continue;
        const release = await this.#release(tx, context, operation, rows, 'buddy-expired');
        if (release.status !== 'pending') return release;
        releases.push(release.operationId);
      }
      return ok({ releases });
    });
  }
}
