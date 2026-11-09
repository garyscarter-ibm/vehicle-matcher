import { inputDigest, ok, result } from '../../repository/index.js';
import { validInstant } from '../../policy/file-provider.js';
import { DECLINE_TYPES, projectBriefIntent, unknown, validateLearningRecord } from './schema.js';

const tables = ['briefs', 'employees', 'entitlement_slots', 'offers', 'holds', 'decisions', 'quotes', 'stock'];
const unavailable = (code) => result('unavailable', { code, reason: 'Learning records are unavailable.', retryable: true });
const ref = (runId, kind, id) => id == null ? null : `${kind}:${inputDigest([runId, kind, id])}`;
const known = (value) => ({ status: 'known', value });
const event = (state = 'unknown', ...times) => {
  const captured = times.filter((at) => at != null);
  if (state === 'unknown' && captured.length || new Set(captured.map((at) => Date.parse(at))).size > 1) throw new Error('contradictory-event-time');
  return { state, at: captured[0] ?? null };
};
const validateTimes = (asOf, times) => {
  if (times.some((at) => at != null && (!validInstant(at) || Date.parse(at) > Date.parse(asOf)))) throw new Error('invalid-event-time');
};
const latest = (briefs) => [...briefs.reduce((out, b) => {
  if (!out.has(b.employeeId) || out.get(b.employeeId).briefVersion < b.briefVersion) out.set(b.employeeId, b);
  return out;
}, new Map()).values()];
const validClock = (time, context) => time?.status === 'ok' && time.value?.runId === context.runId
  && validInstant(time.value.now) && (typeof time.value.clockVersion === 'string' && time.value.clockVersion.length > 0
    || Number.isSafeInteger(time.value.clockVersion) && time.value.clockVersion > 0);

function project(rows, context, time) {
  const briefs = rows.briefs.filter((b) => b.status === 'confirmed');
  const covered = new Set();
  const entries = rows.offers.map((offer) => ({ offer, quoteId: offer.quoteId ?? rows.holds.find((h) => h.holdId === offer.holdId)?.quoteId }));
  const usedQuotes = new Set(entries.map((e) => e.quoteId));
  for (const quote of rows.quotes) if (!usedQuotes.has(quote.quoteId) && Number.isSafeInteger(quote.briefVersion) && quote.briefVersion > 0) entries.push({ quoteId: quote.quoteId });
  if (rows.decisions.some((d) => !rows.offers.some((o) => o.offerId === d.offerId))) throw new Error('orphan-decision');
  const records = [];
  const append = ({ offer, quoteId, brief: unmatched }) => {
    const decisions = rows.decisions.filter((d) => offer && d.offerId === offer.offerId);
    const quote = rows.quotes.find((q) => q.quoteId === quoteId);
    const employeeId = offer?.employeeId ?? quote?.employeeId ?? unmatched?.employeeId;
    const employee = rows.employees.find((e) => e.employeeId === employeeId);
    if (!employee?.roles?.includes('employee')) throw new Error('missing-employee');
    const holds = rows.holds.filter((h) => offer ? h.holdId === offer.holdId : quote && h.quoteId === quote.quoteId);
    if (holds.length > 1) throw new Error('ambiguous-hold');
    const hold = holds[0];
    if (quote && quote.employeeId !== employeeId || hold && hold.employeeId !== employeeId
      || decisions.some((d) => d.employeeId !== employeeId)) throw new Error('owner-mismatch');
    if (offer && hold && hold.quoteId !== quoteId || offer && quote && offer.orderUuid !== quote.orderUuid
      || hold && quote && hold.orderUuid !== quote.orderUuid) throw new Error('reference-mismatch');
    const versions = [offer?.briefVersion, quote?.briefVersion, ...decisions.map((d) => d.versions?.brief), unmatched?.briefVersion]
      .filter((v) => v !== undefined && v !== null);
    if (!versions.length || versions.some((v) => !Number.isSafeInteger(v) || v < 1 || v !== versions[0])) throw new Error('brief-version-mismatch');
    const brief = briefs.find((b) => b.employeeId === employeeId && b.briefVersion === versions[0]);
    if (!brief) throw new Error('missing-confirmed-brief');
    covered.add(`${employeeId}:${brief.briefVersion}`);
    const slotIds = [brief.entitlementSlotId, hold?.entitlementSlotId, quote?.entitlementSlotId].filter((v) => v != null);
    const renewals = [brief.renewalId, hold?.renewalId].filter((v) => v != null);
    if (new Set(slotIds).size > 1 || new Set(renewals).size > 1) throw new Error('entitlement-reference-mismatch');
    const slotId = slotIds[0];
    const slot = rows.entitlement_slots.find((s) => s.entitlementSlotId === slotId);
    if (slot && slot.employeeId !== employeeId) throw new Error('slot-owner-mismatch');
    const renewalId = renewals[0];
    const orderUuid = offer?.orderUuid ?? quote?.orderUuid ?? hold?.orderUuid;
    const complete = (d) => [d.outcome?.status, d.originalResponse?.status].every((s) => s === undefined || s === 'ok');
    const selected = offer?.state === 'selected' || decisions.some((d) => ['select', 'selected'].includes(d.decision) && complete(d))
      || hold?.state === 'allocated' && rows.stock.some((s) => s.orderUuid === orderUuid && (s.state === 'allocated' || s.allocated === true));
    const accepted = offer?.state === 'accepted' || decisions.some((d) => d.decision === 'accept' && complete(d));
    const declined = ['rejected', 'declined'].includes(offer?.state) || decisions.some((d) => d.decision === 'decline' && complete(d));
    const expired = offer?.state === 'expired';
    if (declined && (accepted || selected || expired) || expired && (accepted || selected)) throw new Error('contradictory-outcomes');
    const decline = decisions.find((d) => d.decision === 'decline' && complete(d));
    const declineType = decline?.reason?.type ?? decline?.reason?.code;
    const pending = ['decision-pending', 'selection-pending'].includes(offer?.state) || hold?.state === 'selection-pending'
      || decisions.some((d) => d.decision === 'accept' && [d.outcome?.status, d.originalResponse?.status].includes('pending'));
    if (pending && (accepted || selected || declined || expired)) throw new Error('contradictory-pending');
    const decisionTimes = (values, isComplete) => decisions.filter((d) => values.includes(d.decision) && isComplete(d)).map((d) => d.decidedAt);
    const pendingDecision = (d) => [d.outcome?.status, d.originalResponse?.status].includes('pending');
    validateTimes(time.now, [offer?.offeredAt, offer?.acceptedAt, offer?.rejectedAt, offer?.declinedAt, offer?.expiredAt,
      offer?.selectedAt, offer?.pendingAt, hold?.selectedAt, hold?.pendingAt, quote?.quotedAt, ...decisions.map((d) => d.decidedAt)]);
    const pendingTimes = pending ? [offer?.pendingAt, hold?.pendingAt, ...decisionTimes(['accept'], pendingDecision)] : [];
    const outcomes = {
      offered: event(offer ? 'offered' : 'unknown', offer?.offeredAt),
      selection: event(selected ? 'selected' : pending ? 'pending' : 'unknown', offer?.selectedAt, hold?.selectedAt,
        ...decisionTimes(['select', 'selected'], complete), ...pendingTimes),
      acceptance: event(accepted ? 'accepted' : pending ? 'pending' : 'unknown', offer?.acceptedAt,
        ...decisionTimes(['accept'], complete), ...pendingTimes),
      decline: { ...event(declined ? 'declined' : 'unknown', offer?.rejectedAt, offer?.declinedAt,
        ...decisionTimes(['decline'], complete)), reasonType: declined ? DECLINE_TYPES.includes(declineType) ? declineType : 'unclassified' : null },
      expiry: event(expired ? 'expired' : 'unknown', offer?.expiredAt), wait: { ...event(), reasonType: null }, satisfaction: event(),
    };
    if (outcomes.offered.at !== null && Object.entries(outcomes).some(([key, value]) => key !== 'offered'
      && value.at !== null && Date.parse(value.at) < Date.parse(outcomes.offered.at))) throw new Error('event-before-offer');
    let terms = unknown(quote ? 'not-captured' : 'missing-quote');
    // Only the dated saved quote can establish historical terms. Repository createdAt is
    // storage time, so it never substitutes for a missing DemoClock event timestamp.
    if (quote && Number.isFinite(quote.monthlyPoints) && Number.isFinite(quote.allowance?.monthlyPoints)
      && quote.allowance.unit === 'points/month' && validInstant(quote.quotedAt) && validInstant(quote.validUntil ?? quote.expiresAt)
      && typeof quote.configurationId === 'string' && typeof quote.policyVersion === 'string') {
      terms = known({ quoteRef: ref(context.runId, 'quote', quote.quoteId), configurationId: quote.configurationId,
        monthlyPoints: quote.monthlyPoints, allowance: quote.allowance.monthlyPoints, unit: 'points/month',
        quotedAt: quote.quotedAt, validUntil: quote.validUntil ?? quote.expiresAt, policyVersion: quote.policyVersion });
    }
    const record = { schemaVersion: 1, recordId: ref(context.runId, 'record', offer ? ['offer', offer.offerId] : quote ? ['quote', quote.quoteId] : ['brief', employeeId, brief.briefVersion]),
      runId: context.runId, subject: { employeeRef: ref(context.runId, 'employee', employeeId),
        entitlementSlotRef: ref(context.runId, 'slot', slotId), renewalRef: ref(context.runId, 'renewal', renewalId) },
      target: { offerRef: ref(context.runId, 'offer', offer?.offerId), holdRef: ref(context.runId, 'hold', hold?.holdId),
        quoteRef: ref(context.runId, 'quote', quoteId), orderRef: ref(context.runId, 'order', orderUuid),
        configurationId: quote?.configurationId ? known(quote.configurationId) : unknown() },
      renewal: { cohort: unknown(), period: unknown() },
      entitlement: { schemeId: terms.status === 'known' && quote.allowance.schemeId ? known(quote.allowance.schemeId) : unknown('missing-context'),
        gradeId: terms.status === 'known' && quote.allowance.gradeId ? known(quote.allowance.gradeId) : unknown('missing-context'), allowanceBand: unknown() },
      brief: { briefVersion: brief.briefVersion, policyVersion: brief.policyVersion, confirmedAt: brief.confirmedAt, ...projectBriefIntent(brief) },
      choiceSet: unknown(), terms,
      outcomes,
      timestamps: { projectedAt: time.now, clockVersion: time.clockVersion }, provenance: { kind: 'observed' } };
    const validated = validateLearningRecord(record);
    if (validated.status !== 'ok') throw new Error('invalid-record');
    records.push(validated.value);
  };
  entries.forEach(append);
  for (const brief of latest(briefs)) if (!covered.has(`${brief.employeeId}:${brief.briefVersion}`)) append({ brief });
  return records.sort((a, b) => a.recordId.localeCompare(b.recordId));
}

export function createObservedLearningRecordService({ repository, identity, clock } = {}) {
  return {
    async readRecords(context) {
      if (!repository || !identity || !clock) return unavailable('not-configured');
      try {
        const allowed = await identity.requireRole(context, 'greg');
        if (allowed.status !== 'ok') return allowed;
        const time = await clock.now(context);
        if (time.status !== 'ok') return time;
        if (!validClock(time, context)) return unavailable('clock-invalid');
        const load = async () => {
          const values = await Promise.all(tables.map((table) => repository.query(context, table)));
          const failure = values.find((v) => v.status !== 'ok');
          if (failure) return { failure };
          if (values.some((v) => !Array.isArray(v.value) || v.value.some((r) => r.runId !== context.runId))) return { failure: unavailable('source-invalid') };
          return Object.fromEntries(tables.map((table, i) => [table, values[i].value]));
        };
        const rows = await load(); if (rows.failure) return rows.failure;
        const records = project(rows, context, time.value);
        // Two complete reads fence concurrent revisions without a private repository snapshot.
        const after = await load(); if (after.failure) return after.failure;
        const end = await clock.now(context); if (end.status !== 'ok') return end;
        if (!validClock(end, context)) return unavailable('clock-invalid');
        if (inputDigest(rows) !== inputDigest(after) || inputDigest(time.value) !== inputDigest(end.value)) return result('conflict', {
          reason: 'Learning inputs changed during the read. Refresh the projection.' });
        const authorized = await identity.requireRole(context, 'greg'); if (authorized.status !== 'ok') return authorized;
        return ok({ runId: context.runId, asOf: time.value.now, projectionVersion: inputDigest({ rows, clock: time.value }), records });
      } catch { return unavailable('source-invalid'); }
    },
  };
}
