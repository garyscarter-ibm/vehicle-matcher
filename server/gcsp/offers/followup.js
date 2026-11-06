import { createHash } from 'node:crypto';
import { inputDigest, ok, result } from '../repository/core.js';
import { validInstant } from '../policy/file-provider.js';
import { readFollowupQuestion, followupChange } from './followup-policy.js';
import { buildFollowupComparison } from './followup-comparison.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const only = (v, keys) => plain(v) && Reflect.ownKeys(v).every((key) => keys.includes(key));
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const revision = (v) => Number.isSafeInteger(v) && v > 0;
const unavailable = (code = 'offer-followup-unavailable', savedChange) => result('unavailable', {
  code, reason: 'The offer follow-up is temporarily unavailable.', retryable: true,
  ...(savedChange ? { savedChange } : {}),
});
const invalid = (field = 'command') => result('invalid', { code: 'invalid-offer-followup',
  reasons: [{ field, reason: 'Use the current follow-up question and confirm one different value.' }] });
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
const same = (a, b) => inputDigest(a) === inputDigest(b);

// Keep failures at this employee-facing boundary free of provider text and internal rows.
function failure(outcome) {
  const status = outcome?.status;
  if (['missing-session', 'unknown-session', 'expired-session', 'unknown-principal', 'forbidden', 'stale-run'].includes(status)) {
    return result(status, { reason: 'Use a current authorised employee session.' });
  }
  if (status === 'stale-version') return result(status, {
    ...(Number.isSafeInteger(outcome.expectedVersion) ? { expectedVersion: outcome.expectedVersion } : {}),
    ...(Number.isSafeInteger(outcome.currentVersion) ? { currentVersion: outcome.currentVersion } : {}), action: 'refresh',
  });
  if (status === 'conflict') return result(status, { reason: ['idempotency-input-changed', 'decline-change-already-recorded']
    .includes(outcome.reason) ? outcome.reason : 'followup-conflict', action: 'refresh' });
  if (status === 'invalid') return invalid();
  return unavailable();
}

function savedProjection(decisionId, brief, event) {
  const change = brief.postDeclineChange;
  return { schemaVersion: 1, state: 'change-saved', decisionId, briefVersion: brief.briefVersion,
    policyVersion: brief.policyVersion,
    event: { receiptReference: `brief-change:${inputDigest({ consumerId: 'brief:changes', runId: event.runId, eventId: event.eventId })}`,
      eventType: event.eventType, briefVersion: event.briefVersion, occurredAt: event.occurredAt },
    change: { path: change.path, before: structuredClone(change.before), after: structuredClone(change.after) } };
}

export class OfferFollowupService {
  #repository; #policy; #clock; #identity; #brief; #offers;
  constructor({ repository, policy, clock, identity, brief, offers } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock;
    this.#identity = identity; this.#brief = brief; this.#offers = offers;
  }

  async #prepare(context, decisionId) {
    if (!this.#repository || !this.#policy || !this.#clock || !this.#identity || !this.#brief) return { error: unavailable() };
    const allowed = await this.#identity.requireRole(context, 'employee');
    if (allowed.status !== 'ok') return { error: failure(allowed) };
    const clock = await this.#clock.now(context);
    if (clock.status !== 'ok') return { error: failure(clock) };
    if (!validInstant(clock.value?.now) || clock.value.runId !== context.runId) return { error: unavailable() };
    const found = await this.#repository.read(context, ref(context, 'decisions', { decisionId }));
    if (found.status === 'not-found') return { error: result('not-found', { resourceType: 'offer-followup' }) };
    if (found.status !== 'ok') return { error: unavailable() };
    const decision = found.value;
    // Ownership precedes every linked resource read, even though repository scope is run-wide.
    if (decision.employeeId !== context.employeeId) return { error: failure({ status: 'forbidden' }) };
    if (decision.decision !== 'decline' || !revision(decision.version) || !revision(decision.versions?.brief)
      || !text(decision.reason?.code) || decision.reason.policyVersion !== context.policyVersion
      || decision.outcome?.status !== 'ok' || decision.outcome.value?.state !== 'declined'
      || decision.outcome.value.decisionId !== decisionId) return { error: unavailable('decline-source-unavailable') };
    const receipts = await this.#repository.query(context, 'event_receipts', { consumerId: 'offer-decisions:events:v1', eventType: 'offer-declined' });
    if (receipts.status !== 'ok') return { error: unavailable() };
    const matching = receipts.value.filter((row) => row.outcome?.value?.event?.decisionId === decisionId);
    if (matching.length !== 1) return { error: unavailable('decline-event-unavailable') };
    const receipt = matching[0]; const event = receipt.outcome.value.event;
    if (receipt.state !== 'completed' || receipt.outcome.status !== 'ok' || event.schemaVersion !== 1
      || event.type !== 'offer-declined' || !text(event.eventId) || receipt.eventId !== event.eventId
      || receipt.inputDigest !== inputDigest(event) || !same(receipt.inputVersions, decision.versions)
      || event.runId !== context.runId || event.employeeId !== context.employeeId
      || event.entitlementSlotId !== context.entitlementSlotId || event.renewalId !== (context.renewalId ?? null)
      || event.offerId !== decision.offerId || event.holdId !== decision.holdId
      || event.reasonCode !== decision.reason.code || event.briefVersion !== decision.versions.brief
      || event.policyVersion !== context.policyVersion || !validInstant(event.occurredAt)
      || Date.parse(event.occurredAt) > Date.parse(clock.value.now)) return { error: unavailable('decline-event-unavailable') };
    const loaded = await Promise.all([
      this.#repository.read(context, ref(context, 'offers', { offerId: event.offerId })),
      this.#repository.read(context, ref(context, 'holds', { holdId: event.holdId })),
      this.#repository.read(context, ref(context, 'quotes', { quoteId: event.quoteId })),
      this.#brief.readHistory(context),
    ]);
    if (loaded.some((row) => row.status !== 'ok')) return { error: unavailable('decline-source-unavailable') };
    const [offer, hold, quote] = loaded.slice(0, 3).map((row) => row.value);
    const history = loaded[3].value.versions;
    if (!Array.isArray(history) || ['employeeId', 'orderUuid', 'quoteId', 'policyVersion'].some((key) => offer[key] !== hold[key])
      || offer.runId !== context.runId || offer.environmentId !== context.environmentId
      || offer.employeeId !== context.employeeId || offer.holdId !== event.holdId || offer.quoteId !== event.quoteId
      || !['rejected', 'declined'].includes(offer.state) || hold.state !== 'released' || hold.releaseReason !== 'offer-declined'
      || hold.type !== 'buddy-offer' || hold.entitlementSlotId !== event.entitlementSlotId || (hold.renewalId ?? null) !== event.renewalId
      || hold.orderUuid !== event.orderUuid || quote.orderUuid !== event.orderUuid || quote.employeeId !== context.employeeId
      || quote.entitlementSlotId !== event.entitlementSlotId || quote.policyVersion !== offer.policyVersion
      || quote.policyVersion !== decision.versions.quotePolicy
      || quote.briefVersion !== offer.briefVersion || quote.briefVersion !== decision.versions.pinnedBrief
      || !history.some((row) => row.status === 'confirmed' && row.briefVersion === event.briefVersion)) {
      return { error: unavailable('decline-source-unavailable') };
    }
    return { decision, event, history: [...history].sort((a, b) => a.briefVersion - b.briefVersion),
      read: { runId: context.runId, asOf: clock.value.now, policyVersion: context.policyVersion } };
  }

  async #question(state, brief) {
    const question = await readFollowupQuestion({ policy: this.#policy, read: state.read, reasonCode: state.decision.reason.code, brief });
    if (question.status !== 'ok') return question;
    return ok({ helper: question.value, public: { ...question.value,
      questionVersion: inputDigest({ questionVersion: question.value.questionVersion, decisionId: state.decision.decisionId,
        decisionVersion: state.decision.version, eventId: state.event.eventId }) } });
  }

  async #afterSave(context, state, savedChange) {
    if (typeof this.#offers?.fromAccount !== 'function') return unavailable('followup-evaluation-unavailable', savedChange);
    const current = state.history.at(-1);
    const found = await this.#repository.query(context, 'offers', { employeeId: context.employeeId });
    if (found.status !== 'ok') return unavailable('followup-evaluation-unavailable', savedChange);
    const candidates = found.value.filter((row) => row.offerId !== state.decision.offerId
      && row.briefVersion === current.briefVersion && row.briefVersion >= savedChange.briefVersion && row.state === 'active');
    // Absence supplies no evidence of a successful search, waiting or a completed no-match evaluation.
    if (candidates.length !== 1) return unavailable('followup-evaluation-unavailable', savedChange);
    const offer = candidates[0];
    const hold = await this.#repository.read(context, ref(context, 'holds', { holdId: offer.holdId }));
    const quote = await this.#repository.read(context, ref(context, 'quotes', { quoteId: offer.quoteId }));
    if (hold.status !== 'ok' || quote.status !== 'ok' || hold.value.state !== 'active' || hold.value.type !== 'buddy-offer'
      || hold.value.employeeId !== context.employeeId || hold.value.entitlementSlotId !== context.entitlementSlotId
      || (hold.value.renewalId ?? null) !== (context.renewalId ?? null) || hold.value.quoteId !== offer.quoteId
      || quote.value.briefVersion !== current.briefVersion || quote.value.employeeId !== context.employeeId
      || !validInstant(quote.value.quotedAt) || Date.parse(quote.value.quotedAt) < Date.parse(current.confirmedAt)
      || Date.parse(quote.value.quotedAt) > Date.parse(state.read.asOf)) return unavailable('followup-comparison-unavailable', savedChange);
    const accessed = await Promise.all([state.decision.offerId, offer.offerId].map((offerId) =>
      this.#offers.fromAccount(context, { runId: context.runId, offerId })));
    if (accessed.some((row) => row.status !== 'ok' || !plain(row.value?.offer))) return unavailable('followup-comparison-unavailable', savedChange);
    // Keep the safe102 DTO; its private branded context never crosses this boundary.
    const [previousOffer, nextOffer] = accessed.map((row) => row.value.offer);
    if (previousOffer.offerId !== state.decision.offerId || previousOffer.state !== 'declined'
      || nextOffer.offerId !== offer.offerId || nextOffer.state !== 'pending'
      || nextOffer.runId !== context.runId || previousOffer.runId !== context.runId
      || nextOffer.quote?.quoteId !== offer.quoteId || previousOffer.quote?.quoteId !== state.event.quoteId) {
      return unavailable('followup-comparison-unavailable', savedChange);
    }
    const configured = await this.#policy.getAssumption('employee.recommendation.v1', state.read);
    if (configured.status !== 'ok' || configured.policyVersion !== context.policyVersion) return unavailable('followup-comparison-unavailable', savedChange);
    const comparison = buildFollowupComparison({ previousOffer, nextOffer, brief: current, config: configured.value?.value });
    if (comparison.status !== 'ok') return unavailable('followup-comparison-unavailable', savedChange);
    const final = await this.#brief.readCurrent(context);
    if (final.status !== 'ok' || final.value.brief.briefVersion !== current.briefVersion) return unavailable('followup-comparison-unavailable', savedChange);
    return ok({ schemaVersion: 1, state: 'ready', decisionId: state.decision.decisionId, savedChange, comparison: comparison.value });
  }

  async read(context, input) {
    if (!only(input, ['decisionId']) || !text(input.decisionId)) return invalid('decisionId');
    try {
      const state = await this.#prepare(context, input.decisionId); if (state.error) return state.error;
      const saved = state.history.filter((row) => row.postDeclineChange?.decisionId === input.decisionId);
      if (saved.length) {
        if (saved.length !== 1) return unavailable();
        const brief = saved[0];
        const receipt = await this.#repository.read(context, ref(context, 'event_receipts', {
          consumerId: 'brief:changes', eventId: `brief:${context.employeeId}:${brief.briefVersion}`,
        }));
        const event = receipt.value?.outcome?.value;
        if (receipt.status !== 'ok' || receipt.value.state !== 'completed' || receipt.value.outcome.status !== 'ok'
          || event?.eventType !== 'brief-changed' || event.operation !== 'changed-after-decline'
          || event.eventId !== receipt.value.eventId || event.runId !== context.runId || event.employeeId !== context.employeeId
          || event.briefVersion !== brief.briefVersion || receipt.value.inputVersions?.brief !== brief.briefVersion
          || !validInstant(event.occurredAt) || event.occurredAt !== brief.confirmedAt
          || Date.parse(event.occurredAt) > Date.parse(state.read.asOf)) return unavailable();
        // A committed save remains visible when no agreed allocation/evaluation read port is available.
        const savedChange = savedProjection(input.decisionId, brief, event);
        try { return await this.#afterSave(context, state, savedChange); }
        catch { return unavailable('followup-evaluation-unavailable', savedChange); }
      }
      const brief = state.history.at(-1);
      const question = await this.#question(state, brief); if (question.status !== 'ok') return question;
      return ok({ schemaVersion: 1, state: 'question', decisionId: input.decisionId,
        briefVersion: brief.briefVersion, question: question.value.public });
    } catch { return unavailable(); }
  }

  async confirm(context, input) {
    if (!only(input, ['commandId', 'decisionId', 'expectedBriefVersion', 'questionVersion', 'value'])
      || !text(input.commandId) || !text(input.decisionId) || !revision(input.expectedBriefVersion)
      || !text(input.questionVersion) || !Object.hasOwn(input, 'value')) return invalid();
    try {
      const state = await this.#prepare(context, input.decisionId); if (state.error) return state.error;
      // Reconstruct against the submitted historical version so the underlying command receipt can replay.
      const brief = state.history.find((row) => row.briefVersion === input.expectedBriefVersion);
      if (!brief) return result('stale-version', { expectedVersion: input.expectedBriefVersion,
        currentVersion: state.history.at(-1)?.briefVersion, action: 'refresh' });
      const question = await this.#question(state, brief); if (question.status !== 'ok') return question;
      if (question.value.public.questionVersion !== input.questionVersion) return result('stale-version', {
        expectedVersion: input.expectedBriefVersion, currentVersion: state.history.at(-1).briefVersion, action: 'refresh',
      });
      const change = followupChange(question.value.helper, input.value, brief); if (change.status !== 'ok') return change;
      const commandId = `followup:${createHash('sha256').update(input.commandId).digest('hex')}`;
      const changed = await this.#brief.changeAfterDecline(context, { commandId, decisionId: input.decisionId,
        expectedBriefVersion: input.expectedBriefVersion, change: change.value });
      if (changed?.status !== 'ok') return failure(changed);
      const saved = changed.value?.brief; const event = changed.value?.event;
      if (saved?.postDeclineChange?.decisionId !== input.decisionId || !revision(saved.briefVersion)
        || event?.operation !== 'changed-after-decline' || event.eventType !== 'brief-changed'
        || event.briefVersion !== saved.briefVersion || !validInstant(event.occurredAt)) return unavailable();
      return ok(savedProjection(input.decisionId, saved, event));
    } catch { return unavailable(); }
  }
}

export const createOfferFollowupService = (options) => new OfferFollowupService(options);
