import { createHash, randomUUID } from 'node:crypto';
import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { validInstant } from '../policy/file-provider.js';
import { ALLOCATION_EVALUATION_CONSUMER, allocationEvaluationEventId } from './evaluation-rows.js';

export { ALLOCATION_EVALUATION_CONSUMER, allocationEvaluationEventId };

export const ALLOCATION_CONSUMER = 'buddy-allocation';
// FUCQ-205: claim progress lives in its own small receipt so the plan is written once.
export const ALLOCATION_CURSOR_CONSUMER = 'buddy-allocation-cursor';
const keys = ['allocation.tieBreak.rule', 'allocation.tieBreak.seed', 'offer.declinedCar.exclusion'];
const tables = ['briefs', 'employees', 'entitlement_slots', 'stock', 'holds', 'claims', 'offers', 'decisions'];
const unavailable = (code) => result('unavailable', { code, reason: 'Allocation is unavailable.', retryable: true });
const text = (v) => typeof v === 'string' && v.length > 0;
const latest = (rows) => [...rows.reduce((map, row) => {
  if (row.status === 'confirmed' && (!map.has(row.employeeId) || map.get(row.employeeId).briefVersion < row.briefVersion)) map.set(row.employeeId, row);
  return map;
}, new Map()).values()];
const intent = (brief) => ({
  preferences: Object.fromEntries(Object.entries(brief.preferences).map(([k, p]) => [k,
    { value: p.value, importance: p.importance, valueState: p.valueState, importanceState: p.importanceState }])),
  essentials: Object.fromEntries(Object.entries(brief.essentials).map(([k, e]) => [k,
    { value: e.operator === 'includes' && Array.isArray(e.value) ? [...new Set(e.value)].sort() : e.value,
      operator: e.operator, unit: e.unit, state: e.state }])),
});
const visible = (row, employee) => Array.isArray(row.visibility?.companyIds) && Array.isArray(row.visibility?.schemeIds)
  && row.visibility.companyIds.includes(employee.companyId) && row.visibility.schemeIds.includes(employee.schemeId)
  && (row.visibility.employeeIds === null || Array.isArray(row.visibility.employeeIds) && row.visibility.employeeIds.includes(employee.employeeId));
const lottery = (seed, runId, employeeId, orderUuid) => createHash('sha256').update(JSON.stringify([seed, runId, employeeId, orderUuid])).digest('hex');
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byStableId = (a, b) => ordinal(a.employeeId, b.employeeId) || ordinal(a.orderUuid, b.orderUuid);
function compare(rule) {
  const renewal = (a, b) => ordinal(a.renewalDue, b.renewalDue);
  const fit = (a, b) => (b.score ?? -1) - (a.score ?? -1);
  const seeded = (a, b) => ordinal(a.lottery, b.lottery) || byStableId(a, b);
  if (rule === 'renewalDueThenFitThenSeededLottery') return (a, b) => renewal(a, b) || fit(a, b) || seeded(a, b);
  if (rule === 'fitThenRenewalDueThenSeededLottery') return (a, b) => fit(a, b) || renewal(a, b) || seeded(a, b);
  return null;
}

// Allocation proposes claims; the injected FUCQ-100 port alone owns stock/hold transactions.
export function createAllocationService({ repository, policy, clock, identity, claim } = {}) {
  let registration;
  const ref = (context, eventId, consumerId = ALLOCATION_CONSUMER) => ({ table: 'event_receipts', key: { runId: context.runId, consumerId, eventId } });
  const command = (id, payload) => ({ commandId: id, inputDigest: inputDigest(payload) });
  const sliceRef = (context, eventId, employeeId) => ref(context, allocationEvaluationEventId(eventId, employeeId), ALLOCATION_EVALUATION_CONSUMER);
  // Callers still receive every evaluation; only the stored receipt holds references.
  async function hydrate(context, eventId, outcome) {
    const refs = outcome?.value?.evaluationRefs; if (outcome?.status !== 'ok' || !refs) return outcome;
    const evaluations = [];
    for (const employeeId of refs.employeeIds) {
      const slice = await repository.read(context, sliceRef(context, eventId, employeeId)); if (slice.status !== 'ok') return slice;
      evaluations.push(slice.value.outcome.value.evaluation);
    }
    const { evaluationRefs, ...value } = outcome.value;
    return ok({ ...value, evaluations });
  }
  async function prepare(context, event, instant, assumptions) {
    // A rejected pre-plan attempt must read repaired source rows on its next try.
    // The accepted prepare receipt, rather than this read, freezes event replay.
    const loaded = await repository.transaction(context, command(`allocation:snapshot:${event.eventId}:${randomUUID()}`, event), async (tx) => {
      const rows = {};
      for (const table of tables) {
        const found = await tx.list(table); if (found.status !== 'ok') return found;
        rows[table] = found.value;
      }
      return ok(rows);
    });
    if (loaded.status !== 'ok') return loaded;
    const rows = loaded.value;
    const occupying = [...rows.holds, ...rows.claims].filter((r) => OCCUPYING_STATES.includes(r.state));
    const selected = [...rows.holds, ...rows.claims].filter((r) => r.state === 'allocated');
    const pool = rows.stock.filter((r) => ['available', 'released'].includes(r.state) && r.available === true
      && r.held !== true && r.allocated !== true && ![...occupying, ...selected].some((h) => h.orderUuid === r.orderUuid))
      .sort((a, b) => ordinal(a.orderUuid, b.orderUuid));
    const briefs = latest(rows.briefs).filter((b) => b.buddy?.searchConsent === true && b.buddy.paused === false)
      .sort((a, b) => ordinal(a.employeeId, b.employeeId));
    const plan = { trigger: event, evaluatedAt: instant.now, clockVersion: instant.clockVersion,
      policyVersion: context.policyVersion, assumptions, contenders: [], evaluatedEmployees: [],
      inputVersions: { policy: context.policyVersion, clock: instant.clockVersion,
        stock: rows.stock.map((r) => ({ orderUuid: r.orderUuid, version: r.version, revision: r.revision ?? null })).sort((a, b) => ordinal(a.orderUuid, b.orderUuid)), briefs: [] } };
    const slices = [];
    for (const brief of briefs) {
      const employee = rows.employees.find((e) => e.employeeId === brief.employeeId);
      const slot = rows.entitlement_slots.find((s) => s.entitlementSlotId === brief.entitlementSlotId && s.employeeId === brief.employeeId);
      if (!employee || !slot) return unavailable('brief-owner-unavailable');
      plan.inputVersions.briefs.push({ employeeId: brief.employeeId, brief: brief.briefVersion,
        permission: brief.buddy.permissionVersion, employee: employee.version, slot: slot.version });
      const renewalId = brief.renewalId ?? slot.renewalId ?? employee.renewalId ?? null;
      if (occupying.some((h) => h.employeeId === employee.employeeId || h.entitlementSlotId === slot.entitlementSlotId)
        || selected.some((h) => h.entitlementSlotId === slot.entitlementSlotId || renewalId && h.renewalId === renewalId)) continue;
      const resolved = await identity.resolveEmployeeContext(context, employee.employeeId);
      if (resolved.status !== 'ok') return resolved;
      const employeeContext = resolved.value;
      if (employeeContext.runId !== context.runId || employeeContext.employeeId !== employee.employeeId
        || employeeContext.policyVersion !== context.policyVersion) return unavailable('employee-context-invalid');
      const available = pool.filter((r) => visible(r, employee));
      const facts = structuredClone(employee.contract?.manualContext?.employeeFacts ?? {});
      const driver = employee.contract?.manualContext?.drivers?.find((d) => d.employeeId === employee.employeeId && d.kind === 'employee');
      if (facts.driverEligible === undefined && driver?.eligible) facts.driverEligible = structuredClone(driver.eligible);
      const charging = brief.essentials.charging;
      if (charging) facts.charging = { status: charging.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
        value: charging.value, unit: null, provenance: { sourceRef: charging.source, version: String(brief.briefVersion),
          observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
      const evaluator = createEmployeeRecommendationService({ policy, time: { async now() { return ok(instant); } }, provider: {
        async resolve() { return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: employee.employeeId,
          factsVersion: `employee:${employee.version}`, stockVersion: inputDigest(available), employeeFacts: facts,
          stock: available.map((r) => ({ orderUuid: r.orderUuid, configurationId: r.configurationId, snapshot: r.facts,
            availability: { ...r.release?.availability, state: 'available', availableFrom: r.release?.availability?.availableFrom ?? r.release?.releasedAt,
              version: String(r.version) } })) }); },
      } });
      const evaluated = await evaluator.recommend(employeeContext, { schemaVersion: brief.schemaVersion, briefVersion: brief.briefVersion,
        preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([k]) => k !== 'charging')) });
      if (evaluated.status !== 'ok') return unavailable('employee-evaluation-unavailable');
      const decisions = structuredClone(evaluated.value.decisions);
      const quotes = {};
      for (const decision of decisions) {
        const declined = rows.decisions.filter((d) => d.employeeId === employee.employeeId && d.decision === 'decline'
          && rows.offers.some((o) => o.offerId === d.offerId && o.orderUuid === decision.orderUuid));
        if (declined.some((d) => { const previous = rows.briefs.find((b) => b.employeeId === employee.employeeId && b.briefVersion === d.versions?.brief);
          return !previous || inputDigest(intent(previous)) === inputDigest(intent(brief)); })) {
          decision.gateStatus = 'ineligible'; decision.suitable = false; decision.blockers.push({ code: 'declined-unchanged' });
        }
        if (decision.gateStatus !== 'eligible' || brief.buddy.holdConsent !== true) continue;
        const stock = available.find((s) => s.orderUuid === decision.orderUuid);
        const currentContracts = employee.contract?.manualContext?.contracts?.filter((c) => c.status === 'current'
          && c.employeeId === employee.employeeId && c.schemeId === employee.schemeId && c.slotId === slot.entitlementSlotId);
        const currentContract = currentContracts?.length === 1 ? currentContracts[0] : null;
        const end = currentContract?.contractEndDate;
        const due = typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) ? `${end}T00:00:00.000Z` : null;
        if (!validInstant(due)) return unavailable('renewal-deadline-unavailable');
        plan.contenders.push({ employeeId: employee.employeeId, entitlementSlotId: slot.entitlementSlotId, renewalId,
          orderUuid: decision.orderUuid, renewalDue: due, score: decision.score,
          lottery: lottery(assumptions[1].value, context.runId, employee.employeeId, decision.orderUuid),
          expectedVersions: { stock: stock.version, slot: slot.version, brief: brief.briefVersion, permission: brief.buddy.permissionVersion,
            employee: employee.version, policy: context.policyVersion, clock: instant.clockVersion },
          reasons: [{ code: 'allocation-policy', rule: assumptions[0].value, policyVersion: context.policyVersion },
            { code: 'renewal-due', value: due }, { code: 'eligible-fit', score: decision.score }] });
        quotes[decision.orderUuid] = { orderUuid: decision.orderUuid, configurationId: decision.configurationId, snapshot: decision.snapshot, terms: decision.terms,
          employeeFacts: decision.employeeFacts, versions: decision.versions, reasons: decision.reasons, tradeOffs: decision.tradeOffs };
      }
      plan.evaluatedEmployees.push(employee.employeeId);
      slices.push({ employeeId: employee.employeeId, quotes, evaluation: { employeeId: employee.employeeId, versions: evaluated.value.versions,
        decisions: decisions.map((d) => ({ orderUuid: d.orderUuid, gateStatus: d.gateStatus, score: d.score, reasons: d.reasons, blockers: d.blockers, unknowns: d.unknowns, versions: d.versions })) } });
    }
    plan.contenders.sort(compare(assumptions[0].value));
    return ok({ plan, slices });
  }

  const service = {
    register() {
      if (typeof clock?.registerHandler !== 'function') return Promise.resolve(unavailable('not-configured'));
      registration ??= clock.registerHandler({ handlerId: ALLOCATION_CONSUMER, stage: 'buddy-allocation',
        handle: ({ context }) => service.consumeTriggers(context) });
      return registration;
    },
    async consumeTriggers(context) {
      if (!repository || typeof identity?.requireRole !== 'function') return unavailable('not-configured');
      const allowed = await identity.requireRole(context, 'presenter'); if (allowed.status !== 'ok') return allowed;
      try {
        // DemoClock awaits each handler outside a repository transaction. Release/brief
        // producers have committed before this read; never nest under its transaction helper.
        const loaded = await repository.query(context, 'event_receipts'); if (loaded.status !== 'ok') return loaded;
        const sources = loaded.value.filter((row) => ['stock-release', 'brief:changes'].includes(row.consumerId)
          && row.state === 'completed' && row.outcome?.status === 'ok');
        const events = [];
        for (const source of sources) {
          const value = source.outcome.value;
          const stock = source.consumerId === 'stock-release';
          const eventType = stock ? 'stock-released' : 'brief-changed';
          const occurredAt = stock ? value?.releasedAt : value?.occurredAt;
          if (source.eventType !== eventType || !text(source.eventId) || !text(source.inputDigest)
            || !source.inputVersions || typeof source.inputVersions !== 'object'
            || value?.runId !== context.runId || !validInstant(occurredAt)
            || (stock ? value.kind !== eventType || value.trancheId !== source.eventId
              : value.eventType !== eventType || value.eventId !== source.eventId)) return unavailable('allocation-trigger-invalid');
          events.push({ ...structuredClone(value),
            eventId: `allocation:${inputDigest([source.consumerId, source.eventId])}`, eventType,
            sourceEventId: source.eventId, sourceReceipt: { consumerId: source.consumerId, eventId: source.eventId,
              inputDigest: source.inputDigest, inputVersions: structuredClone(source.inputVersions) }, occurredAt });
        }
        events.sort((a, b) => ordinal(a.occurredAt, b.occurredAt)
          || ordinal(a.sourceReceipt.consumerId, b.sourceReceipt.consumerId) || ordinal(a.sourceEventId, b.sourceEventId));
        const allocations = [];
        for (const event of events) {
          const outcome = await service.allocate(context, event); if (outcome.status !== 'ok') return outcome;
          allocations.push(outcome.value);
        }
        return ok({ runId: context.runId, allocations });
      } catch { return unavailable('allocation-source-invalid'); }
    },
    async allocate(context, event) {
      if (!repository || !policy || !clock || typeof identity?.resolveEmployeeContext !== 'function' || typeof claim?.tryClaim !== 'function') return unavailable('not-configured');
      const allowed = await identity.requireRole(context, 'presenter'); if (allowed.status !== 'ok') return allowed;
      if (!event || !text(event.eventId) || !['stock-released', 'brief-changed'].includes(event.eventType)
        || event.runId !== context.runId) return result('invalid', { code: 'invalid-allocation-event' });
      const digest = inputDigest(event);
      try {
        let receipt = await repository.read(context, ref(context, event.eventId));
        if (receipt.status === 'ok' && receipt.value.inputDigest !== digest) return result('conflict', { reason: 'idempotency-input-changed' });
        if (receipt.status === 'ok' && receipt.value.state === 'completed') return hydrate(context, event.eventId, receipt.value.outcome);
        if (receipt.status !== 'ok' && receipt.status !== 'not-found') return receipt;
        if (receipt.status === 'not-found') {
          const time = await clock.now(context); if (time.status !== 'ok') return time;
          if (time.value?.runId !== context.runId || !validInstant(time.value.now)) return unavailable('clock-invalid');
          const read = { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion };
          const values = await Promise.all(keys.map((key) => policy.getAssumption(key, read)));
          if (values.some((v) => v.status !== 'ok' || v.policyVersion !== context.policyVersion)) return unavailable('policy-unavailable');
          const assumptions = values.map((v) => v.value);
          if (!compare(assumptions[0].value) || !text(assumptions[1].value)
            || assumptions[2].value !== 'untilRelevantConfirmedBriefChange') return unavailable('policy-invalid');
          const planned = await prepare(context, event, time.value, assumptions); if (planned.status !== 'ok') return planned;
          const { plan: prepared, slices } = planned.value;
          receipt = await repository.transaction(context, command(`allocation:prepare:${event.eventId}`, event), async (tx) => {
            const cursor = await tx.recordReceipt({ consumerId: ALLOCATION_CURSOR_CONSUMER, eventId: event.eventId, eventType: event.eventType,
              inputDigest: digest, inputVersions: prepared.inputVersions, state: 'pending', outcome: ok({ next: 0, assignments: [], attempts: [] }) });
            if (cursor.status !== 'ok') return cursor;
            for (const slice of slices) {
              const saved = await tx.recordReceipt({ consumerId: ALLOCATION_EVALUATION_CONSUMER, eventId: allocationEvaluationEventId(event.eventId, slice.employeeId),
                eventType: event.eventType, inputDigest: digest, inputVersions: { allocationEventId: event.eventId }, state: 'completed',
                outcome: ok({ runId: context.runId, eventId: event.eventId, employeeId: slice.employeeId, evaluation: slice.evaluation, quotes: slice.quotes }) });
              if (saved.status !== 'ok') return saved;
            }
            return tx.recordReceipt({ consumerId: ALLOCATION_CONSUMER, eventId: event.eventId, eventType: event.eventType, inputDigest: digest,
              inputVersions: prepared.inputVersions, state: 'pending', outcome: ok({ plan: prepared, next: 0, assignments: [], attempts: [] }) });
          });
          if (receipt.status !== 'ok') return receipt;
        }
        const row = receipt.value; const { plan } = row.outcome.value;
        const cursorRef = ref(context, event.eventId, ALLOCATION_CURSOR_CONSUMER);
        let cursor = await repository.read(context, cursorRef);
        // A plan prepared before FUCQ-205 carries its own progress; move it to a cursor once.
        if (cursor.status === 'not-found') cursor = await repository.transaction(context, command(`allocation:cursor:${event.eventId}`, event),
          (tx) => tx.recordReceipt({ consumerId: ALLOCATION_CURSOR_CONSUMER, eventId: event.eventId, eventType: event.eventType, inputDigest: digest,
            inputVersions: row.inputVersions, state: 'pending', outcome: ok({ next: row.outcome.value.next,
              assignments: row.outcome.value.assignments, attempts: row.outcome.value.attempts }) }));
        if (cursor.status !== 'ok') return cursor;
        let progress = cursor.value.outcome.value; let version = cursor.value.version; let next = progress.next;
        // A plan prepared before FUCQ-209 carries quotes and evaluations inline; a newer one reads each employee's row.
        const quotes = new Map();
        const quoteOf = async (candidate) => {
          if (candidate.quote) return ok(candidate.quote);
          if (!quotes.has(candidate.employeeId)) {
            const slice = await repository.read(context, sliceRef(context, event.eventId, candidate.employeeId)); if (slice.status !== 'ok') return slice;
            quotes.set(candidate.employeeId, slice.value.outcome.value.quotes);
          }
          const quote = quotes.get(candidate.employeeId)[candidate.orderUuid];
          return quote ? ok(quote) : unavailable('allocation-quote-unavailable');
        };
        // Skipped contenders need no write: on retry they are skipped again from the same assignments.
        while (next < plan.contenders.length) {
          const contender = plan.contenders[next]; next += 1;
          const assigned = progress.assignments.some((a) => a.employeeId === contender.employeeId || a.entitlementSlotId === contender.entitlementSlotId
            || contender.renewalId && a.renewalId === contender.renewalId || a.orderUuid === contender.orderUuid);
          if (!assigned) {
            const quote = await quoteOf(contender); if (quote.status !== 'ok') return quote;
            const candidate = { ...contender, quote: quote.value };
            const resolved = await identity.resolveEmployeeContext(context, candidate.employeeId); if (resolved.status !== 'ok') return resolved;
            const operationId = `allocation:${inputDigest([context.runId, event.eventId, candidate.employeeId, candidate.orderUuid])}`;
            const outcome = await claim.tryClaim(resolved.value, { ...candidate, operationId, eventId: event.eventId, runId: context.runId });
            if (!['ok', 'conflict', 'stale-version'].includes(outcome?.status)) return unavailable('claim-pending');
            progress = { next, attempts: [...progress.attempts, { employeeId: candidate.employeeId, orderUuid: candidate.orderUuid, operationId, outcome }],
              assignments: outcome.status === 'ok' ? [...progress.assignments, { ...candidate, operationId, claim: outcome.value }] : progress.assignments };
            const advanced = await repository.transaction(context, command(`allocation:advance:${event.eventId}:${version}`, progress),
              (tx) => tx.compareAndSwap(cursorRef, version, { outcome: ok(progress) }));
            if (advanced.status !== 'ok') return advanced;
            version = advanced.value.version;
          }
        }
        const { assignments, attempts } = progress;
        const evaluated = Array.isArray(plan.evaluations) ? { evaluations: plan.evaluations }
          : { evaluationRefs: { consumerId: ALLOCATION_EVALUATION_CONSUMER, employeeIds: plan.evaluatedEmployees } };
        const outcome = ok({ state: assignments.length ? 'allocated' : 'no-assignment', runId: context.runId, event: plan.trigger,
          evaluatedAt: plan.evaluatedAt, policyVersion: plan.policyVersion, assumptions: plan.assumptions,
          inputVersions: plan.inputVersions, assignments, attempts, ...evaluated });
        const finished = await repository.transaction(context, command(`allocation:complete:${event.eventId}`, outcome), async (tx) => {
          const closed = await tx.compareAndSwap(cursorRef, version, { state: 'completed' }); if (closed.status !== 'ok') return closed;
          return tx.compareAndSwap(ref(context, event.eventId), row.version, { state: 'completed', outcome });
        });
        return finished.status === 'ok' ? hydrate(context, event.eventId, finished.value.outcome) : finished;
      } catch { return unavailable('allocation-source-invalid'); }
    },
  };
  return service;
}
