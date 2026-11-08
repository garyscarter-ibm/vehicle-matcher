import { comparisonAssumption } from '../harness.js';
import { acceptable, carFit } from '../evaluation.js';
import { RANK, buildOutcomeRecord, byId, createManualReplay, iso, must, readRouteAssumptions, refuse } from './current.js';

const ROUTE_KEY = 'comparison.buddyRoute.v1';
const HOLD_KEY = 'hold.buddy.durationSeconds';
const REASONS_KEY = 'offer.declineReasons.v1';
const SLIDER_KEY = 'brief.slider.maximum';
const EXTRA_KEYS = [HOLD_KEY, REASONS_KEY, SLIDER_KEY, 'allocation.tieBreak.rule', 'offer.declinedCar.exclusion'];
// The route rules this replay implements; any other policy value is refused, never approximated.
const SUPPORTED = Object.freeze({ participation: 'generated-buddyParticipation',
  consent: 'search-and-hold-given-through-brief-service-with-stated-brief',
  allocation: 'at-each-release-through-allocation-service', orderingWindow: 'participant-pauses-when-manual-ordering-closes',
  response: 'offer-creation-plus-generated-responseSeconds', offerExpiry: 'buddy-hold-deadline',
  acceptance: 'underlying-gates-and-fit-at-or-above-threshold',
  declineReason: 'registered-reason-for-largest-importance-weighted-shortfall',
  afterDeclineOrExpiry: 'no-trigger-until-next-release-or-brief-change', nonParticipants: 'comparison.manualRoute.v1' });
const hours = (seconds) => Math.round(seconds / 3600 * 1e6) / 1e6;

/** Reads and validates the buddy route's values on top of the manual route's. */
export async function readBuddyAssumptions(run, manual) {
  const read = { runId: run.metadata.runId, asOf: run.inputs.manifest.startsAt, policyVersion: run.metadata.policyVersion };
  const rows = {};
  for (const key of [ROUTE_KEY, ...EXTRA_KEYS]) rows[key] = await comparisonAssumption(run.policy, key, read);
  const route = rows[ROUTE_KEY].value;
  const registry = rows[REASONS_KEY].value;
  const holdSeconds = rows[HOLD_KEY].value;
  const maximum = rows[SLIDER_KEY].value;
  if (!route || route.schemaVersion !== 1 || Object.entries(SUPPORTED).some(([key, expected]) => route[key] !== expected)
    || !registry || registry.schemaVersion !== 1 || !Array.isArray(registry.reasons)
    || !registry.reasons.some((reason) => reason.code === route.declineReasonFallback)) refuse('invalid-input', ROUTE_KEY);
  if (!Number.isSafeInteger(holdSeconds) || holdSeconds <= 0) refuse('invalid-input', HOLD_KEY);
  if (!Number.isFinite(maximum) || maximum <= 0) refuse('invalid-input', SLIDER_KEY);
  const hold = rows[HOLD_KEY];
  return Object.freeze({ reasons: registry.reasons, fallback: route.declineReasonFallback, sliderMaximum: maximum, holdSeconds,
    holdDuration: Object.freeze({ key: HOLD_KEY, holdDurationSeconds: holdSeconds, overlay: hold.overlay === true,
      baselineValue: hold.overlay === true ? hold.baselineValue : holdSeconds }),
    rows: Object.freeze([...manual.rows, ...Object.values(rows)].sort((a, b) => byId(a.key, b.key))) });
}

// The registered reason for the underlying component with the largest importance-weighted shortfall.
function declineReason(evaluation, employeeId, orderUuid, buddy) {
  let worst = null;
  for (const component of carFit(evaluation, employeeId, orderUuid).underlying.components ?? []) {
    const shortfall = (buddy.sliderMaximum - component.score) * component.importance;
    if (shortfall > 0 && (!worst || shortfall > worst.shortfall || shortfall === worst.shortfall && component.field < worst.component.field)) {
      worst = { component, shortfall };
    }
  }
  return buddy.reasons.find((reason) => worst?.component.facts.includes(reason.attribute))?.code ?? buddy.fallback;
}

/** Replays the buddy route: participants through FUCQ-96, FUCQ-100 and FUCQ-106, everyone else through today's route. */
export async function replayBuddyRoute(run) {
  if (run?.metadata?.route !== 'buddy' || !run.buddy) refuse('invalid-input', 'route');
  const { evaluation, inputs, buddy: services } = run;
  if (evaluation.inputHash !== inputs.manifest.inputHash || run.metadata.inputHash !== inputs.manifest.inputHash) refuse('invalid-input', 'evaluation');
  const manual = await readRouteAssumptions(run);
  const buddy = await readBuddyAssumptions(run, manual);
  const flagged = inputs.employees.filter((employee) => employee.buddyParticipation === true);
  const participants = new Map(flagged.map((employee) => [employee.employeeId, { employee, context: run.employeeContext(employee.employeeId),
    taken: null, claims: 0, retries: 0, expiries: 0, sessions: 0, orderingClosedAt: null, offers: 0, declines: 0, offerExpiries: 0, termsLapsed: 0,
    briefVersion: 0, active: null, closed: false }]));
  const entries = [];
  const extra = new Map(inputs.stock.map((car) => [car.orderUuid, { offers: 0, declines: 0, offerExpiries: 0, declinedSeconds: 0, expiredSeconds: 0 }]));
  const declinesByReason = Object.fromEntries(buddy.reasons.map((reason) => [reason.code, 0]));
  let ticks = 0;

  async function offerState(person, entry) {
    const row = must(await run.repository.read(person.context, { table: 'offers',
      key: { runId: person.context.runId, offerId: entry.offerId } }), 'offer-read');
    return row.state;
  }

  // The clock's buddy-expiry handler retires lapsed offers; this only triggers it and checks the result.
  async function expireDue(now) {
    const due = entries.filter((entry) => entry.status === 'active' && entry.deadline <= now);
    if (!due.length) return;
    const people = due.map((entry) => participants.get(entry.employeeId));
    let states = await Promise.all(due.map((entry, index) => offerState(people[index], entry)));
    if (states.includes('active')) {
      // A manual-route tick at this instant may already have run the handler.
      ticks += 1;
      if (must(await run.tick(`buddy:offer-tick:${ticks}`), 'tick').state !== 'completed') refuse('tick-incomplete', 'tick');
      states = await Promise.all(due.map((entry, index) => offerState(people[index], entry)));
    }
    due.forEach((entry, index) => {
      if (states[index] !== 'expired') refuse('expiry-not-applied', entry.offerId);
      const person = people[index];
      const car = replay.cars.get(entry.orderUuid);
      entry.status = 'expired'; person.active = null; person.offerExpiries += 1;
      car.holdsNotTaken += 1; car.heldSeconds += (entry.deadline - entry.createdAt) / 1000;
      Object.assign(extra.get(entry.orderUuid), { offerExpiries: extra.get(entry.orderUuid).offerExpiries + 1,
        expiredSeconds: extra.get(entry.orderUuid).expiredSeconds + (entry.deadline - entry.createdAt) / 1000 });
    });
  }

  // A participant whose manual ordering window has closed (or renewal has passed) stops searching.
  async function closeOrdering(at) {
    for (const person of participants.values()) {
      if (person.taken || person.active || person.closed) continue;
      const account = must(await run.claims.readAccount(person.context), 'account');
      if (account.state === 'ready') continue;
      if (account.state !== 'not-yet-eligible') refuse('account-state', account.state);
      must(await services.brief.pause(person.context, { commandId: `buddy:${person.employee.employeeId}:pause`,
        expectedBriefVersion: person.briefVersion }), 'brief-pause');
      person.briefVersion += 1; person.closed = true; person.orderingClosedAt = iso(at);
    }
  }

  async function respond(person, entry, at) {
    if (entry.status !== 'active') return;
    const id = person.employee.employeeId;
    const accept = acceptable(evaluation, id, entry.orderUuid);
    const reasonCode = accept ? null : declineReason(evaluation, id, entry.orderUuid, buddy);
    const opened = must(await services.access.fromAccount(person.context, { runId: person.context.runId, offerId: entry.offerId }), 'offer-access');
    const view = opened.offer;
    // The pinned terms can lapse before the hold does; the employee can then only decline, so a keen one lets it lapse.
    if (accept && Date.parse(view.serverNow) >= Date.parse(view.quote.validUntil)) { entry.termsLapsed = true; person.termsLapsed += 1; return; }
    const decided = must(await services.decisions.decide(opened.context, { commandId: `buddy:${id}:decision`,
      runId: person.context.runId, offerId: entry.offerId, decision: accept ? 'accept' : 'decline',
      ...(accept ? {} : { reasonCode }),
      expectedOfferVersion: view.offerVersion, expectedHoldVersion: view.holdVersion,
      expectedQuoteVersion: view.quote.revisions.quote }), 'offer-decision');
    if (decided.state !== (accept ? 'accepted' : 'declined')) refuse('decision-mismatch', entry.offerId);
    const car = replay.cars.get(entry.orderUuid);
    person.active = null;
    if (accept) {
      const fit = carFit(evaluation, id, entry.orderUuid);
      entry.status = 'accepted';
      person.taken = { orderUuid: entry.orderUuid, takenAt: iso(at), fit: { stated: fit.stated.score, underlying: fit.underlying.score } };
      Object.assign(car, { allocatedTo: id, allocatedAt: iso(at) });
      return;
    }
    entry.status = 'declined'; person.declines += 1;
    declinesByReason[reasonCode] += 1;
    extra.get(entry.orderUuid).declines += 1;
    extra.get(entry.orderUuid).declinedSeconds += (at - entry.createdAt) / 1000;
  }

  function offerMade(assignment, at) {
    const person = participants.get(assignment.employeeId);
    const { claim } = assignment;
    if (!person || claim.state !== 'offered' || Date.parse(claim.now) !== at || claim.hold.orderUuid !== assignment.orderUuid) {
      refuse('allocation-mismatch', assignment.orderUuid);
    }
    const entry = { offerId: claim.offer.offerId, employeeId: assignment.employeeId, orderUuid: assignment.orderUuid,
      createdAt: at, deadline: Date.parse(claim.hold.expiresAt), status: 'active' };
    entries.push(entry); person.active = entry; person.offers += 1;
    extra.get(entry.orderUuid).offers += 1; replay.cars.get(entry.orderUuid).everHeld = true;
    const respondAt = at + person.employee.responseSeconds * 1000;
    if (respondAt < entry.deadline) replay.schedule(respondAt, RANK.decision, entry.employeeId, (when) => respond(person, entry, when));
    replay.schedule(entry.deadline, RANK.expiry, entry.employeeId, (when) => expireDue(when));
  }

  // The same method the clock's buddy-allocation stage calls per trigger; the harness release writes no stock-release receipt.
  async function afterRelease(release, at) {
    await expireDue(at);
    await closeOrdering(at);
    const outcome = must(await services.allocation.allocate(run.presenter, { eventId: `allocation:${release.releaseId}`,
      eventType: 'stock-released', kind: 'stock-released', runId: run.presenter.runId, occurredAt: iso(at),
      sourceEventId: release.releaseId, trancheId: release.releaseId, orderUuids: [...release.orderUuids] }), 'allocation');
    for (const assignment of outcome.assignments) offerMade(assignment, at);
    // The offer emails go to the captured transport only; nothing is sent.
    if (outcome.assignments.length) must(await services.dispatcher.dispatchPending(run.presenter), 'notification-capture');
  }

  const replay = createManualReplay(run, manual, inputs.employees.filter((employee) => !flagged.includes(employee))
    .map((employee) => employee.employeeId), { afterRelease });
  for (const person of participants.values()) {
    const { preferences, essentials } = structuredClone(person.employee.statedBrief);
    const id = person.employee.employeeId;
    must(await services.brief.saveDraft(person.context, { commandId: `buddy:${id}:draft`, expectedBriefVersion: 0,
      expectedDraftVersion: 0, brief: { schemaVersion: 1, preferences, essentials } }), 'brief-draft');
    must(await services.brief.confirm(person.context, { commandId: `buddy:${id}:confirm`, expectedBriefVersion: 0,
      expectedDraftVersion: 1, consent: { search: true, hold: true } }), 'brief-confirm');
    person.briefVersion = 1;
  }
  replay.scheduleReleases();
  await replay.drain();
  if (entries.some((entry) => entry.status === 'active')) refuse('offer-unsettled', 'drain');

  const outbox = (await run.snapshot()).notification_outbox;
  if (outbox.length !== entries.length || outbox.some((job) => job.state !== 'sent' || job.transport !== 'captured')) refuse('notification-not-captured', 'outbox');
  const people = new Map([...replay.people, ...participants]);
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  return buildOutcomeRecord(run, { threshold: evaluation.threshold, rows: buddy.rows }, { people, cars: replay.cars }, 'buddy', (record) => {
    const cars = record.cars.map((row) => {
      const counts = extra.get(row.orderUuid);
      const seconds = counts.expiredSeconds + counts.declinedSeconds;
      return { ...row, offers: counts.offers, declines: counts.declines, offerExpiries: counts.offerExpiries,
        buddyHeldNotTakenSeconds: seconds, buddyHeldNotTakenHours: hours(seconds) };
    });
    const employees = record.employees.map((row) => ({ ...row, participant: participants.has(row.employeeId),
      offers: participants.get(row.employeeId)?.offers ?? 0, declines: participants.get(row.employeeId)?.declines ?? 0,
      offerExpiries: participants.get(row.employeeId)?.offerExpiries ?? 0, termsLapsed: participants.get(row.employeeId)?.termsLapsed ?? 0 }));
    const held = record.cars.reduce((total, row) => total + row.heldNotTakenSeconds, 0) + sum([...extra.values()], 'declinedSeconds');
    return { ...record, holdDuration: buddy.holdDuration, employees, cars,
      limitations: [...record.limitations, 'Acceptance is recorded as a local offer decision; the ordering handoff is not replayed.'],
      totals: { ...record.totals, participants: participants.size, offersMade: sum(employees, 'offers'),
        offersAccepted: entries.filter((entry) => entry.status === 'accepted').length, declines: sum(employees, 'declines'),
        declinesByReason, offerExpiries: sum(employees, 'offerExpiries'), termsLapsed: sum(employees, 'termsLapsed'), notificationsCaptured: outbox.length,
        buddyHeldNotTakenHours: hours(sum(cars, 'buddyHeldNotTakenSeconds')), heldNotTakenHours: hours(held) } };
  });
}
