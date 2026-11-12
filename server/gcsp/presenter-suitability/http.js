import { OCCUPYING_STATES, ok, result } from '../repository/core.js';
import { isBuddyEngaged } from '../brief/permission.js';
import { ALLOCATION_EVALUATION_CONSUMER, allocationEvaluationEventId, expandEvaluation } from '../allocation/evaluation-rows.js';

const CAR_PAGE = 8; const BUDDY_PAGE = 4;
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const broken = () => result('unavailable', { code: 'suitability-unavailable', reason: 'Car suitability could not be read. Try again.', retryable: true });
const rules = ['renewalDueThenFitThenSeededLottery', 'fitThenRenewalDueThenSeededLottery'];

function selectors(searchParams, body) {
  const keys = [...searchParams.keys()];
  if (Object.keys(body).length || keys.some((key) => !['page', 'buddyPage', 'release'].includes(key))
    || new Set(keys).size !== keys.length) return null;
  const page = (key) => {
    const value = searchParams.get(key) ?? '1';
    return /^[1-9]\d{0,6}$/.test(value) ? Number(value) : null;
  };
  const release = searchParams.get('release') ?? 'all';
  return page('page') && page('buddyPage') && ['all', 'latest'].includes(release)
    ? { page: page('page'), buddyPage: page('buddyPage'), release } : null;
}

const paged = (rows, requested, size) => {
  const pages = Math.max(1, Math.ceil(rows.length / size)); const page = Math.min(requested, pages);
  return { rows: rows.slice((page - 1) * size, page * size), page, pages, total: rows.length, size };
};
const paging = ({ rows, ...rest }) => rest;
const nameOf = (row) => text(row?.name) ?? ([text(row?.firstName), text(row?.lastName)].filter(Boolean).join(' ') || row.employeeId);

// Only fields used by plain explanation copy leave the server; never quote inputs or provider/employee facts.
function evidence(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => text(entry?.code)).map((entry) => {
    const out = { code: entry.code };
    for (const key of ['field', 'desired', 'observed', 'score', 'allowance', 'monthlyPoints', 'availableFrom', 'requiredBy', 'maximum', 'actual']) {
      if (['string', 'number', 'boolean'].includes(typeof entry[key])) out[key] = entry[key];
    }
    if (entry.requirement && typeof entry.requirement === 'object') out.requirement = Object.fromEntries(
      ['operator', 'value', 'unit'].filter((key) => ['string', 'number', 'boolean'].includes(typeof entry.requirement[key])
        || key === 'value' && Array.isArray(entry.requirement.value) && entry.requirement.value.every((v) => typeof v === 'string'))
        .map((key) => [key, entry.requirement[key]]));
    return out;
  });
}

function projectDecision(decision, evaluation, receipt, buddy, policyVersion) {
  const value = receipt.outcome.value;
  const briefVersion = decision.versions?.brief ?? evaluation.versions?.brief ?? null;
  const recordedPolicy = decision.versions?.policy ?? evaluation.versions?.policy ?? value.policyVersion ?? null;
  const assignment = value.assignments?.find((row) => row.orderUuid === decision.orderUuid);
  const other = value.assignments?.find((row) => row.employeeId === buddy.employeeId);
  const allocationRule = value.assumptions?.find((row) => row.key === 'allocation.tieBreak.rule')?.value;
  const input = value.inputVersions?.briefs?.find((row) => row.employeeId === buddy.employeeId);
  return { state: 'evaluated', gateStatus: decision.gateStatus,
    score: typeof decision.score === 'number' && Number.isFinite(decision.score) && decision.score >= 0 && decision.score <= 100 ? decision.score : null,
    blockers: evidence(decision.blockers), unknowns: evidence(decision.unknowns), reasons: evidence(decision.reasons),
    recorded: { evaluatedAt: value.evaluatedAt, briefVersion, policyVersion: recordedPolicy,
      allocationRule: rules.includes(allocationRule) ? allocationRule : null },
    outdated: briefVersion !== buddy.briefVersion || recordedPolicy !== policyVersion
      || input?.permission !== buddy.buddy?.permissionVersion || input?.employee !== buddy.employeeVersion,
    outcome: assignment ? { state: 'assigned', employeeId: assignment.employeeId }
      : other ? { state: 'assigned-other-car' } : { state: 'not-assigned' } };
}

async function recordedCells(repository, context, receipts, buddies, cars, policyVersion) {
  const ids = new Set(cars.map((row) => row.orderUuid)); const cells = new Map();
  for (const buddy of buddies) {
    const remaining = new Set(ids);
    for (const receipt of receipts) {
      if (!remaining.size) break;
      const value = receipt.outcome.value; let evaluation;
      if (Array.isArray(value.evaluations)) evaluation = value.evaluations.find((row) => row.employeeId === buddy.employeeId);
      else if (value.evaluationRefs?.consumerId === ALLOCATION_EVALUATION_CONSUMER
        && value.evaluationRefs.employeeIds?.includes(buddy.employeeId)) {
        const reply = await repository.read(context, { table: 'event_receipts', key: { runId: context.runId,
          consumerId: ALLOCATION_EVALUATION_CONSUMER, eventId: allocationEvaluationEventId(receipt.eventId, buddy.employeeId) } });
        if (reply.status !== 'ok') return reply;
        if (reply.value.state !== 'completed' || reply.value.outcome?.status !== 'ok') return broken();
        evaluation = reply.value.outcome.value?.evaluation;
        if (evaluation?.employeeId !== buddy.employeeId) return broken();
      }
      if (!evaluation) continue;
      // Expand only visible cars: a packed evaluation may cover thousands of released vehicles.
      evaluation = expandEvaluation(Array.isArray(evaluation.cars)
        ? { ...evaluation, cars: evaluation.cars.filter(([id]) => remaining.has(id)) } : evaluation);
      for (const decision of evaluation.decisions ?? []) {
        if (!remaining.has(decision.orderUuid)) continue;
        if (!['eligible', 'ineligible', 'needs-confirmation'].includes(decision.gateStatus)) return broken();
        cells.set(`${decision.orderUuid}:${buddy.employeeId}`, projectDecision(decision, evaluation, receipt, buddy, policyVersion));
        remaining.delete(decision.orderUuid);
      }
    }
  }
  return ok(cells);
}

async function readView(deps, context, selected) {
  const { repository } = deps;
  const read = await Promise.all([
    repository.query(context, 'event_receipts', { consumerId: 'stock-release', state: 'completed' }),
    repository.query(context, 'event_receipts', { consumerId: 'buddy-allocation', state: 'completed' }),
    repository.query(context, 'stock'), repository.query(context, 'employees'),
    repository.query(context, 'briefs', { status: 'confirmed' }), repository.query(context, 'holds'),
  ]);
  const failure = read.find((reply) => reply.status !== 'ok'); if (failure) return failure;
  const [releaseRows, allocationRows, stock, employees, briefs, holds] = read.map((reply) => reply.value);
  const releases = releaseRows.filter((row) => row.eventType === 'stock-released' && row.outcome?.status === 'ok'
    && row.outcome.value?.kind === 'stock-released' && validTime(row.outcome.value.releasedAt) && Array.isArray(row.outcome.value.orderUuids))
    .sort((a, b) => Date.parse(b.outcome.value.releasedAt) - Date.parse(a.outcome.value.releasedAt) || b.eventId.localeCompare(a.eventId));
  const ids = [...new Set((selected.release === 'latest' ? releases.slice(0, 1) : releases).flatMap((row) => row.outcome.value.orderUuids))];
  const stockById = new Map(stock.map((row) => [row.orderUuid, row]));
  if (ids.some((id) => !stockById.has(id))) return broken();
  const latest = new Map();
  for (const brief of briefs) if (!latest.has(brief.employeeId) || latest.get(brief.employeeId).briefVersion < brief.briefVersion) latest.set(brief.employeeId, brief);
  const people = new Map(employees.map((row) => [row.employeeId, row]));
  const engaged = [...latest.values()].filter((row) => isBuddyEngaged(row.buddy) && people.has(row.employeeId))
    .map((row) => ({ ...row, name: nameOf(people.get(row.employeeId)), employeeVersion: people.get(row.employeeId).version }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId));
  const carsPage = paged(ids.map((id) => stockById.get(id)), selected.page, CAR_PAGE);
  const buddyPage = paged(engaged, selected.buddyPage, BUDDY_PAGE);
  const receipts = allocationRows.filter((row) => row.outcome?.status === 'ok' && validTime(row.outcome.value?.evaluatedAt))
    .sort((a, b) => Date.parse(b.outcome.value.evaluatedAt) - Date.parse(a.outcome.value.evaluatedAt)
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.eventId.localeCompare(a.eventId));
  const cells = await recordedCells(repository, context, receipts, buddyPage.rows, carsPage.rows, context.policyVersion);
  if (cells.status !== 'ok') return cells;
  const rule = await deps.policy?.getAssumption('allocation.tieBreak.rule', { runId: context.runId,
    policyVersion: context.policyVersion, asOf: selected.now });
  const current = new Map(holds.filter((hold) => OCCUPYING_STATES.includes(hold.state) || hold.state === 'allocated')
    .map((hold) => [hold.orderUuid, hold]));
  const cars = carsPage.rows.map((row) => {
    const hold = current.get(row.orderUuid);
    const recordedName = text(row.facts?.display?.name) ?? text(row.facts?.facts?.modelLine?.value) ?? 'Released car';
    const colour = text(row.facts?.facts?.colour?.value); const suffix = colour ? ` in ${colour}` : null;
    const name = suffix && recordedName.endsWith(suffix) ? recordedName.slice(0, -suffix.length) : recordedName;
    return { id: row.orderUuid, name, orderNumber: text(row.orderNumber), colour,
      availability: hold ? { state: hold.state === 'allocated' ? 'allocated' : 'reserved',
        employeeId: hold.employeeId, employeeName: nameOf(people.get(hold.employeeId) ?? { employeeId: hold.employeeId }), route: hold.type === 'buddy-offer' ? 'buddy' : 'manual' }
        : { state: row.available === true && row.held !== true && row.allocated !== true ? 'available' : 'unavailable' },
      cells: buddyPage.rows.map((buddy) => ({ employeeId: buddy.employeeId,
        ...(cells.value.get(`${row.orderUuid}:${buddy.employeeId}`) ?? { state: 'not-evaluated' }) })) };
  });
  return ok({ runId: context.runId, asOf: selected.now, release: selected.release,
    policy: { version: context.policyVersion, minimumFit: null, allocationRule: rules.includes(rule?.value?.value) ? rule.value.value : null },
    paging: { cars: paging(carsPage), buddies: paging(buddyPage) },
    buddies: buddyPage.rows.map((row) => ({ id: row.employeeId, name: row.name, briefVersion: row.briefVersion })), cars,
    people: [...new Set(cars.flatMap((car) => car.cells.map((cell) => cell.outcome?.employeeId).filter(Boolean)))].map((id) => ({ id, name: nameOf(people.get(id) ?? { employeeId: id }) })) });
}

// Presenter-only, read-only projection of recorded decisions. Opening this view never evaluates or claims a car.
export function createPresenterSuitabilityRoutes(deps) {
  return [{ method: 'GET', path: '/api/gcsp/presenter/suitability', role: 'presenter', purpose: 'presenter-control',
    async handle({ context, searchParams, body = {} }) {
      const selected = selectors(searchParams, body);
      if (!selected) return result('invalid', { code: 'unsupported-query', reasons: [{ field: 'query', reason: 'Choose a release and positive page numbers only.' }] });
      if (!deps?.repository || !deps.clock) return broken();
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const before = await deps.clock.now(context); if (before.status !== 'ok') return before;
          const reply = await readView(deps, context, { ...selected, now: before.value.now });
          if (reply.status !== 'ok') return reply;
          const after = await deps.clock.now(context); if (after.status !== 'ok') return after;
          if (before.value.clockVersion === after.value.clockVersion && before.value.now === after.value.now) return reply;
        }
      } catch { return broken(); }
      return broken();
    } }];
}
