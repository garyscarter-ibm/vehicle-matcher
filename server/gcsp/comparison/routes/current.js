import { freezeVehicleData } from '../../../vehicles/index.js';
import { ComparisonRunError, comparisonAssumption } from '../harness.js';
import { acceptable, carFit, statedCandidates } from '../evaluation.js';

const ROUTE_KEY = 'comparison.manualRoute.v1';
const THRESHOLD_KEY = 'comparison.acceptableFitThreshold';
const HOLD_KEY = 'hold.cart.durationSeconds';
const REVIEW_KEY = 'hold.cart.orderReview.durationSeconds';
const RANK = Object.freeze({ release: 0, expiry: 1, access: 2, claim: 3, decision: 4 });
// The route rules this replay implements; any other policy value is refused, never approximated.
const SUPPORTED = Object.freeze({ accessEvent: 'once-per-release-at-generated-accessSeconds-until-taken-or-renewal',
  accessTies: 'employeeId-ascending', candidateGate: 'stated-brief-eligible-and-fit-at-or-above-threshold',
  candidateOrder: 'stated-fit-descending-then-orderUuid', conflict: 'refresh-listing-and-claim-next-candidate',
  acceptance: 'underlying-gates-and-fit-at-or-above-threshold', acceptedHold: 'order-review-then-allocate',
  unacceptableHold: 'expire-without-taking', abandonedCar: 'not-claimed-again-by-that-employee',
  expiryReentry: 'next-modelled-access-event', renewalDeadline: 'inclusive' });
const EVENT_ORDER = Object.freeze(['release', 'expiry', 'access', 'claim', 'decision']);

const refuse = (code, boundary) => { throw new ComparisonRunError(code, boundary); };
const must = (outcome, boundary) => {
  if (outcome?.status !== 'ok') refuse(outcome?.status ?? 'unavailable', boundary);
  return outcome.value;
};
const posInt = (value) => Number.isSafeInteger(value) && value > 0;
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const iso = (ms) => new Date(ms).toISOString();

/** Reads and validates every policy value the manual route and acceptance consume. */
export async function readRouteAssumptions(run) {
  const read = { runId: run.metadata.runId, asOf: run.inputs.manifest.startsAt, policyVersion: run.metadata.policyVersion };
  const rows = {};
  for (const key of [HOLD_KEY, REVIEW_KEY, ROUTE_KEY, THRESHOLD_KEY]) rows[key] = await comparisonAssumption(run.policy, key, read);
  const route = rows[ROUTE_KEY].value;
  const cartHoldSeconds = rows[HOLD_KEY].value;
  const threshold = rows[THRESHOLD_KEY].value;
  if (!route || route.schemaVersion !== 1 || !posInt(route.listingToClaimSeconds) || !posInt(route.decisionSeconds)
    || !posInt(cartHoldSeconds) || route.decisionSeconds >= cartHoldSeconds
    || JSON.stringify(route.eventOrder) !== JSON.stringify(EVENT_ORDER)
    || Object.entries(SUPPORTED).some(([key, expected]) => route[key] !== expected)) refuse('invalid-input', ROUTE_KEY);
  if (!posInt(rows[REVIEW_KEY].value)) refuse('invalid-input', REVIEW_KEY);
  if (!Number.isFinite(threshold) || threshold !== run.evaluation.threshold) refuse('invalid-input', THRESHOLD_KEY);
  return Object.freeze({ listingToClaimSeconds: route.listingToClaimSeconds, decisionSeconds: route.decisionSeconds,
    cartHoldSeconds, threshold, rows: Object.freeze(Object.values(rows).sort((a, b) => byId(a.key, b.key))) });
}

/**
 * Manual-employee event loop over one run. `actors` are the employee ids who act through the portal;
 * other routes may schedule their own events on the same loop with `schedule`.
 */
export function createManualReplay(run, assumptions, actors) {
  const { evaluation, inputs } = run;
  const route = run.metadata.route;
  const people = new Map(inputs.employees.filter((e) => actors.includes(e.employeeId)).map((employee) => [employee.employeeId, {
    employee, context: run.employeeContext(employee.employeeId), taken: null, claims: 0, retries: 0, expiries: 0, sessions: 0,
    claimSeq: 0, abandoned: new Set(), session: null, hold: null, stated: null, orderingClosedAt: null }]));
  const cars = new Map(inputs.stock.map((car) => [car.orderUuid, { releaseId: inputs.releaseSchedule
    .find((release) => release.orderUuids.includes(car.orderUuid)).releaseId, released: false, allocatedTo: null,
    allocatedAt: null, holdsNotTaken: 0, heldSeconds: 0, everHeld: false }]));
  const holds = new Map();
  const queue = [];
  const state = { now: 0, seq: 0, ticks: 0 };

  function schedule(at, rank, employeeId, apply) {
    const event = { at, rank, employeeId, seq: state.seq += 1, apply };
    const before = (other) => other.at !== at ? other.at > at : other.rank !== rank ? other.rank > rank
      : other.employeeId !== employeeId ? other.employeeId > employeeId : false;
    let low = 0; let high = queue.length;
    while (low < high) { const mid = (low + high) >> 1; if (before(queue[mid])) high = mid; else low = mid + 1; }
    queue.splice(low, 0, event);
  }

  async function settle() {
    const due = [...holds.values()].filter((hold) => hold.status === 'active' && Date.parse(hold.expiresAt) <= state.now);
    if (!due.length) return;
    state.ticks += 1;
    if (must(await run.tick(`${route}:tick:${state.ticks}`), 'tick').state !== 'completed') refuse('tick-incomplete', 'tick');
    for (const hold of due) {
      const person = people.get(hold.employeeId);
      const row = must(await run.repository.read(person.context, { table: 'holds', key: { runId: person.context.runId, holdId: hold.holdId } }), 'hold-read');
      if (row.state !== 'expired') refuse('expiry-not-applied', hold.holdId);
      hold.status = 'expired'; person.hold = null; person.expiries += 1;
      const car = cars.get(hold.orderUuid);
      car.holdsNotTaken += 1; car.heldSeconds += (Date.parse(hold.expiresAt) - Date.parse(hold.claimedAt)) / 1000;
    }
  }

  async function advance(at) {
    if (at < state.now) refuse('invalid-input', 'event-order');
    if (at > state.now) { must(await run.advanceTo(iso(at)), 'advance'); state.now = at; }
  }

  async function listing(person, session) {
    person.stated ??= statedCandidates(evaluation, person.employee.employeeId);
    const open = person.stated.filter((id) => !person.abandoned.has(id) && !session.attempted.has(id)
      && cars.get(id).released && cars.get(id).allocatedTo === null);
    if (!open.length) return [];
    const outcome = await run.claims.browseStock(person.context);
    // FUCQ-66 refuses ordering once no collection date fits its lead time before the contract end.
    if (outcome.status === 'conflict' && outcome.reason === 'not-yet-eligible') { person.orderingClosedAt ??= iso(state.now); return []; }
    const browsed = must(outcome, 'browse-stock');
    session.listing = new Map(browsed.cars.map((car) => [car.orderUuid, car.claimInput]));
    return open.filter((id) => session.listing.has(id));
  }

  async function access(person, at) {
    if (person.taken || person.session || person.hold || person.orderingClosedAt) return;
    person.sessions += 1;
    const session = person.session = { attempted: new Set(), listing: new Map() };
    const [first] = await listing(person, session);
    if (first) schedule(at + assumptions.listingToClaimSeconds * 1000, RANK.claim, person.employee.employeeId, (when) => claim(person, first, when));
    else person.session = null;
  }

  async function claim(person, orderUuid, at) {
    const { session } = person;
    session.attempted.add(orderUuid);
    person.claimSeq += 1;
    const id = person.employee.employeeId;
    const outcome = await run.claims.claim(person.context, { commandId: `${route}:${id}:claim:${person.claimSeq}`, ...session.listing.get(orderUuid) });
    if (outcome.status === 'ok') {
      const held = outcome.value.hold;
      if (Date.parse(outcome.value.now) !== at || held.orderUuid !== orderUuid) refuse('claim-mismatch', orderUuid);
      person.claims += 1;
      const hold = { holdId: held.holdId, employeeId: id, orderUuid, claimedAt: outcome.value.now, expiresAt: held.expiresAt, status: 'active' };
      holds.set(hold.holdId, hold); person.hold = hold; cars.get(orderUuid).everHeld = true;
      schedule(Date.parse(hold.expiresAt), RANK.expiry, '', settle);
      schedule(at + assumptions.decisionSeconds * 1000, RANK.decision, id, (when) => decide(person, hold, when));
      return;
    }
    if (!['conflict', 'stale-version'].includes(outcome.status)) refuse(outcome.status ?? 'unavailable', 'claim');
    person.retries += 1;
    const [next] = await listing(person, session);
    if (next) schedule(at + assumptions.listingToClaimSeconds * 1000, RANK.claim, id, (when) => claim(person, next, when));
    else person.session = null;
  }

  async function step(person, commandId) {
    const current = must(await run.claims.readClaim(person.context), 'read-claim');
    return { commandId, holdId: current.hold.holdId, expectedHoldVersion: current.hold.version,
      expectedDraftVersion: current.quote.draftVersion };
  }

  async function decide(person, hold, at) {
    const id = person.employee.employeeId;
    person.session = null;
    if (!acceptable(evaluation, id, hold.orderUuid)) { person.abandoned.add(hold.orderUuid); return; }
    must(await run.claims.beginReview(person.context, await step(person, `${route}:${id}:review:${person.claimSeq}`)), 'begin-review');
    must(await run.claims.allocate(person.context, await step(person, `${route}:${id}:allocate:${person.claimSeq}`)), 'allocate');
    hold.status = 'taken'; person.hold = null;
    const fit = carFit(evaluation, id, hold.orderUuid);
    person.taken = { orderUuid: hold.orderUuid, takenAt: iso(at), fit: { stated: fit.stated.score, underlying: fit.underlying.score } };
    Object.assign(cars.get(hold.orderUuid), { allocatedTo: id, allocatedAt: iso(at) });
  }

  function scheduleReleases() {
    for (const release of inputs.releaseSchedule) {
      schedule(Date.parse(release.at), RANK.release, '', async (at) => {
        must(await run.release(release.releaseId), 'release');
        for (const orderUuid of release.orderUuids) cars.get(orderUuid).released = true;
        for (const person of [...people.values()].sort((a, b) => byId(a.employee.employeeId, b.employee.employeeId))) {
          const when = at + person.employee.accessSeconds * 1000;
          if (!person.taken && when <= Date.parse(person.employee.renewalAt)) {
            schedule(when, RANK.access, person.employee.employeeId, (now) => access(person, now));
          }
        }
      });
    }
  }

  async function drain() {
    state.now = Date.parse(must(await run.clock.readState(run.presenter), 'clock-state').now);
    while (queue.length) {
      const event = queue.shift();
      await advance(event.at);
      if (event.rank > RANK.release) await settle();
      await event.apply(event.at);
    }
    const last = Math.max(state.now, ...[...holds.values()].filter((hold) => hold.status === 'active').map((hold) => Date.parse(hold.expiresAt)));
    await advance(last);
    await settle();
  }

  return { people, cars, holds, state, schedule, scheduleReleases, drain };
}

/** Builds the frozen outcome record and checks it against the run's persisted stock and holds. */
export async function buildOutcomeRecord(run, assumptions, replay, route = run.metadata.route) {
  const { manifest } = run.inputs;
  const common = { seed: manifest.seed, policyVersion: manifest.policyVersion, route };
  const persisted = await run.snapshot();
  const employees = [...replay.people.values()].sort((a, b) => byId(a.employee.employeeId, b.employee.employeeId)).map((person) => ({
    ...common, employeeId: person.employee.employeeId, accessGroup: person.employee.accessGroup,
    outcome: person.taken ? 'taken' : 'none-by-renewal', orderUuid: person.taken?.orderUuid ?? null,
    takenAt: person.taken?.takenAt ?? null, takenDate: person.taken?.takenAt.slice(0, 10) ?? null,
    renewalAt: person.employee.renewalAt, fit: person.taken ? { ...person.taken.fit } : null,
    orderingClosedAt: person.orderingClosedAt, claims: person.claims, retries: person.retries, expiries: person.expiries, sessions: person.sessions }));
  const cars = run.inputs.stock.map((car) => car.orderUuid).sort(byId).map((orderUuid) => {
    const car = replay.cars.get(orderUuid);
    const row = persisted.stock.find((entry) => entry.orderUuid === orderUuid);
    const expired = persisted.holds.filter((hold) => hold.orderUuid === orderUuid && hold.state === 'expired').length;
    if ((row.state === 'allocated') !== (car.allocatedTo !== null) || expired !== car.holdsNotTaken) refuse('outcome-mismatch', orderUuid);
    return { ...common, orderUuid, releaseId: car.releaseId,
      outcome: car.allocatedTo ? 'allocated' : car.everHeld ? 'held-not-taken' : 'unused',
      allocatedTo: car.allocatedTo, allocatedAt: car.allocatedAt, holdsNotTaken: car.holdsNotTaken,
      heldNotTakenSeconds: car.heldSeconds, heldNotTakenDays: Math.round(car.heldSeconds / 86400 * 1e6) / 1e6 };
  });
  const sum = (key) => employees.reduce((total, row) => total + row[key], 0);
  const count = (rows, outcome) => rows.filter((row) => row.outcome === outcome).length;
  return freezeVehicleData({ schemaVersion: 1, route, seed: manifest.seed, policyVersion: manifest.policyVersion,
    inputHash: run.metadata.inputHash, generatorVersion: manifest.generatorVersion, policyHash: manifest.policyHash,
    codeRevision: run.metadata.codeRevision, threshold: assumptions.threshold, thresholdKey: THRESHOLD_KEY,
    assumptions: assumptions.rows.map((row) => ({ key: row.key, value: structuredClone(row.value), unit: row.unit,
      status: row.status, basis: row.basis, source: row.source, policyVersion: row.policyVersion })),
    limitations: ['Calculated fit is not observed satisfaction.',
      'People, cars and behaviour are fictional and assumed; not BMW employee data or observed BMW operations.',
      ...run.metadata.limitations],
    employees, cars,
    totals: { employees: employees.length, taken: count(employees, 'taken'), noneByRenewal: count(employees, 'none-by-renewal'),
      claims: sum('claims'), retries: sum('retries'), expiries: sum('expiries'), carsAllocated: count(cars, 'allocated'),
      carsHeldNotTaken: count(cars, 'held-not-taken'), carsUnused: count(cars, 'unused') } });
}

/** Replays today's first-come-first-served release for the whole cohort and returns the outcome record. */
export async function replayCurrentRoute(run) {
  if (run?.metadata?.route !== 'current') refuse('invalid-input', 'route');
  const assumptions = await readRouteAssumptions(run);
  const replay = createManualReplay(run, assumptions, run.inputs.employees.map((employee) => employee.employeeId));
  replay.scheduleReleases();
  await replay.drain();
  return buildOutcomeRecord(run, assumptions, replay);
}
