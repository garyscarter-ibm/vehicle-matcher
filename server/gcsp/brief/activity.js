import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';

const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const unavailable = (code) => result('unavailable', { code, reason: 'The activity projection is unavailable.', retryable: true });
const owned = (row, context) => row?.runId === context.runId && row.employeeId === context.employeeId;
const occurred = (instant, now) => validInstant(instant) && Date.parse(instant) <= Date.parse(now);
const operations = ['confirmed', 'paused', 'resumed', 'changed-after-decline'];

function projectOffer(row) {
  if (!text(row.offerId) || !text(row.state) || !positive(row.version)
    || row.briefVersion != null && !positive(row.briefVersion)
    || row.expiresAt != null && !validInstant(row.expiresAt)
    || ['holdId', 'orderUuid', 'policyVersion', 'quoteId'].some((key) => row[key] != null && !text(row[key]))) return null;
  return { offerRef: { offerId: row.offerId }, state: row.state, version: row.version,
    briefVersion: row.briefVersion ?? null, ...(validInstant(row.createdAt) ? { createdAt: row.createdAt } : {}),
    ...Object.fromEntries(['holdId', 'orderUuid', 'policyVersion', 'quoteId', 'expiresAt']
      .filter((key) => row[key] !== undefined).map((key) => [key, row[key]])) };
}

function projectChange(receipt, history, context, now) {
  const event = receipt.outcome?.value;
  const brief = history.find((row) => row.briefVersion === event?.briefVersion);
  if (receipt.runId !== context.runId || receipt.consumerId !== 'brief:changes' || receipt.eventType !== 'brief-changed'
    || receipt.state !== 'completed' || receipt.outcome?.status !== 'ok' || !owned(event, context)
    || event.eventType !== 'brief-changed' || !operations.includes(event.operation) || !brief
    || receipt.eventId !== `brief:${context.employeeId}:${event.briefVersion}` || event.eventId !== receipt.eventId
    || receipt.inputVersions?.brief !== event.briefVersion || receipt.inputVersions?.policy !== brief.policyVersion
    || !occurred(event.occurredAt, now) || event.occurredAt !== brief.confirmedAt
    || event.previousBriefVersion !== brief.previousBriefVersion
    || event.operation === 'paused' && brief.buddy?.paused !== true
    || event.operation === 'resumed' && brief.buddy?.paused !== false) return null;
  return { eventId: event.eventId, eventType: event.eventType, operation: event.operation,
    briefVersion: event.briefVersion, previousBriefVersion: event.previousBriefVersion, occurredAt: event.occurredAt };
}

const sourceStages = ['release-pull', 'buddy-allocation'];
const offerLink = (offer, runId) => `/gcsp/offer?offerId=${encodeURIComponent(offer.offerRef.offerId)}&runId=${encodeURIComponent(runId)}`;
const closedOffer = ['accepted', 'rejected', 'declined', 'expired'];

// Latest tick of the run, or null when it cannot be read (reported as evidence-unavailable).
async function readTick(repository, context) {
  try {
    const run = await repository.read(context, { table: 'runs', key: { runId: context.runId } });
    if (run.status !== 'ok') return null;
    const tickId = run.value.versions?.lastTickId; if (!tickId) return { none: true };
    const tick = await repository.read(context, { table: 'tick_runs', key: { runId: context.runId, tickId } });
    return tick.status === 'ok' && tick.value.runId === context.runId
      ? { state: tick.value.state, handlerOrder: tick.value.handlerOrder, outcomes: tick.value.outcomes } : null;
  } catch { return null; }
}

function sourceStatusOf(tick) {
  if (tick?.none) return 'not-checked';
  if (!tick || !Array.isArray(tick.handlerOrder) || !Array.isArray(tick.outcomes)) return 'evidence-unavailable';
  const outcomes = tick.handlerOrder.filter((entry) => sourceStages.includes(entry.stage))
    .map((entry) => tick.outcomes.find((row) => row.handlerId === entry.handlerId)?.outcome);
  if (tick.state === 'interrupted' || outcomes.some((outcome) => outcome && !['ok', 'pending'].includes(outcome.status))) return 'unavailable';
  if (['pending', 'running'].includes(tick.state) || outcomes.some((outcome) => outcome?.status === 'pending')) return 'delayed';
  if (tick.state !== 'completed') return 'evidence-unavailable';
  return !outcomes.length ? 'not-checked' : outcomes.every(Boolean) ? 'ok' : 'unavailable';
}

// Only this employee's slice of a completed allocation receipt; nothing about other employees leaves here.
function projectCheck(receipt, context) {
  const value = receipt.outcome?.value;
  if (receipt.runId !== context.runId || receipt.consumerId !== 'buddy-allocation' || receipt.state !== 'completed'
    || receipt.outcome?.status !== 'ok' || !text(receipt.eventId) || !validInstant(value?.evaluatedAt)
    || !Array.isArray(value.evaluations)) return null;
  const mine = value.evaluations.find((row) => row?.employeeId === context.employeeId);
  if (!Array.isArray(mine?.decisions)) return null;
  return { eventId: receipt.eventId, checkedAt: value.evaluatedAt,
    ...(text(value.inputVersions?.clock) ? { clockVersion: value.inputVersions.clock } : {}),
    carsChecked: mine.decisions.length, suitableCars: mine.decisions.filter((row) => row?.gateStatus === 'eligible').length,
    outcome: Array.isArray(value.assignments) && value.assignments.some((row) => row?.employeeId === context.employeeId) ? 'offer-held' : 'no-match' };
}

// This read consumes stored receipts only. A clock tick or completed handler never
// stands in for a search check, and other employees' evaluations are never disclosed.
export function createActivityService({ repository, identity, clock } = {}) {
  return {
    async readActivity(context) {
      if (!repository?.query || !identity?.requireRole || !clock?.now) return unavailable('not-configured');
      try {
        const allowed = await identity.requireRole(context, 'employee'); if (allowed.status !== 'ok') return allowed;
        const time = await clock.now(context); if (time.status !== 'ok') return time;
        const validTime = (value) => value?.runId === context.runId && validInstant(value.now) && text(value.clockVersion);
        if (!validTime(time.value)) return unavailable('clock-invalid');
        const load = async () => {
          const values = await Promise.all([
            repository.query(context, 'briefs', { employeeId: context.employeeId }),
            repository.query(context, 'offers', { employeeId: context.employeeId }),
            repository.query(context, 'event_receipts', { consumerId: 'brief:changes' }),
            repository.query(context, 'event_receipts', { consumerId: 'buddy-allocation' }),
          ]);
          const failed = values.find((value) => value.status !== 'ok'); if (failed) return { error: failed };
          if (values.some((value) => !Array.isArray(value.value))) return { error: unavailable('source-invalid') };
          const [briefs, offers, receipts, searches] = values.map((value) => value.value);
          if ([...briefs, ...offers].some((row) => !owned(row, context))) return { error: unavailable('scope-invalid') };
          return { briefs, offers, receipts: receipts.filter((row) => row.outcome?.value?.employeeId === context.employeeId),
            checks: searches.map((row) => projectCheck(row, context)).filter(Boolean), tick: await readTick(repository, context) };
        };
        const rows = await load(); if (rows.error) return rows.error;
        const history = rows.briefs.filter((row) => row.status === 'confirmed').sort((a, b) => a.briefVersion - b.briefVersion);
        if (history.some((row) => !positive(row.briefVersion))) return unavailable('brief-invalid');
        const brief = history.at(-1) ?? null;
        if (brief && (!occurred(brief.confirmedAt, time.value.now) || !text(brief.policyVersion)
          || !positive(brief.buddy?.permissionVersion) || brief.buddy.permissionVersion > brief.briefVersion
          || ['searchConsent', 'holdConsent', 'paused'].some((key) => typeof brief.buddy[key] !== 'boolean'))) return unavailable('brief-invalid');
        const permission = brief ? { searchConsent: brief.buddy.searchConsent, holdConsent: brief.buddy.holdConsent,
          paused: brief.buddy.paused, permissionVersion: brief.buddy.permissionVersion,
          canSearch: brief.buddy.searchConsent && !brief.buddy.paused,
          canHold: brief.buddy.searchConsent && brief.buddy.holdConsent && !brief.buddy.paused } : null;
        const offers = rows.offers.map(projectOffer); if (offers.some((offer) => !offer)) return unavailable('offer-invalid');
        offers.sort((a, b) => a.offerRef.offerId.localeCompare(b.offerRef.offerId));
        const newest = [...offers].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
          || b.offerRef.offerId.localeCompare(a.offerRef.offerId))[0];
        const currentOffer = newest ? { ...newest, href: offerLink(newest, context.runId) } : null;
        const checks = rows.checks.filter((row) => occurred(row.checkedAt, time.value.now))
          .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt) || a.eventId.localeCompare(b.eventId));
        const latestCheck = checks.at(-1);
        const { eventId: _eventId, ...lastSuccessfulCheck } = latestCheck ?? {};
        const stateChanges = rows.receipts.map((row) => projectChange(row, history, context, time.value.now)).filter(Boolean)
          .sort((a, b) => a.briefVersion - b.briefVersion);
        const rejectedReceipts = rows.receipts.length - stateChanges.length;
        // Repeat scoped reads and recheck time/identity to refuse mixed concurrent views.
        // No command transaction or receipt is created by opening activity.
        const after = await load(); if (after.error) return after.error;
        const end = await clock.now(context); if (end.status !== 'ok') return end;
        if (!validTime(end.value)) return unavailable('clock-invalid');
        const authorized = await identity.requireRole(context, 'employee'); if (authorized.status !== 'ok') return authorized;
        if (inputDigest(rows) !== inputDigest(after) || time.value.now !== end.value.now
          || time.value.clockVersion !== end.value.clockVersion) return result('conflict', {
          reason: 'Activity inputs changed during the read. Refresh the projection.' });
        return ok({ runId: context.runId, employeeId: context.employeeId, asOf: time.value.now, clockVersion: time.value.clockVersion,
          briefVersion: brief?.briefVersion ?? null, permission,
          state: !brief ? 'no-brief' : permission.paused ? 'paused' : currentOffer ? (closedOffer.includes(currentOffer.state) ? 'offer-closed' : 'offer')
            : checks.length ? 'searching' : 'never-searched',
          lastSuccessfulCheck: latestCheck ? lastSuccessfulCheck : null,
          searchEvidence: checks.length ? { status: 'recorded', checks: checks.length } : { status: 'not-recorded', reason: 'no-search-check-yet' },
          sourceStatus: sourceStatusOf(rows.tick), currentOffer, offers, stateChanges,
          stateChangesEvidence: { status: rejectedReceipts ? 'incomplete' : stateChanges.length ? 'recorded' : 'not-recorded', rejectedReceipts } });
      } catch { return unavailable('source-invalid'); }
    },
  };
}
