import { createHash, randomUUID } from 'node:crypto';
import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { validInstant } from '../policy/file-provider.js';
import { ALLOCATION_EVALUATION_CONSUMER, allocationEvaluationEventId, expandEvaluation, packEvaluation } from './evaluation-rows.js';

export { ALLOCATION_EVALUATION_CONSUMER, allocationEvaluationEventId };

export const ALLOCATION_CONSUMER = 'buddy-allocation';
// FUCQ-205: claim progress lives in its own small receipt so the plan is written once.
export const ALLOCATION_CURSOR_CONSUMER = 'buddy-allocation-cursor';
// FUCQ-217: each claim attempt is its own row, so the cursor stays one small record.
export const ALLOCATION_ATTEMPT_CONSUMER = 'buddy-allocation-attempt';
const keys = ['allocation.tieBreak.rule', 'allocation.tieBreak.seed', 'offer.declinedCar.exclusion'];
// FUCQ-227: read only for a hold-expiry trigger, so other allocations keep their recorded assumptions.
const EXPIRY_KEY = 'offer.expiredHold.reallocation'; const EXPIRY_RULE = 'lapsedHoldersSitOutAndNobodyGetsBackACarTheyLetLapse';
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
const entryOf = (r) => ({ orderUuid: r.orderUuid, configurationId: r.configurationId, snapshot: r.facts,
  availability: { ...r.release?.availability, state: 'available', availableFrom: r.release?.availability?.availableFrom ?? r.release?.releasedAt,
    version: String(r.version) } });
const quoteOf = (decision) => ({ orderUuid: decision.orderUuid, configurationId: decision.configurationId, snapshot: decision.snapshot, terms: decision.terms,
  employeeFacts: decision.employeeFacts, versions: decision.versions, reasons: decision.reasons, tradeOffs: decision.tradeOffs });
function compare(rule) {
  const renewal = (a, b) => ordinal(a.renewalDue, b.renewalDue);
  const fit = (a, b) => (b.score ?? -1) - (a.score ?? -1);
  const seeded = (a, b) => ordinal(a.lottery, b.lottery) || byStableId(a, b);
  if (rule === 'renewalDueThenFitThenSeededLottery') return (a, b) => renewal(a, b) || fit(a, b) || seeded(a, b);
  if (rule === 'fitThenRenewalDueThenSeededLottery') return (a, b) => fit(a, b) || renewal(a, b) || seeded(a, b);
  return null;
}

// FUCQ-227: holds lapsing at one instant return their cars in one allocation, keyed by the lapsed holds.
// Shared with the comparison's buddy route, which calls allocate itself; null means a malformed receipt.
export function buddyExpiryEvents(runId, receipts) {
  const lapses = new Map();
  for (const row of receipts.filter((r) => r.consumerId === 'buddy-expiry' && r.state === 'completed' && r.outcome?.status === 'ok')) {
    const value = row.outcome.value;
    if (row.eventType !== 'buddy-expired' || !text(row.eventId) || !text(row.inputDigest) || value?.holdId !== row.eventId
      || !text(value.orderUuid) || !validInstant(value.expiredAt)) return null;
    lapses.set(value.expiredAt, [...(lapses.get(value.expiredAt) ?? []), row]);
  }
  return [...lapses].map(([occurredAt, group]) => {
    group.sort((a, b) => ordinal(a.eventId, b.eventId));
    const holdIds = group.map((r) => r.eventId); const sourceEventId = `buddy-expiry:${inputDigest([occurredAt, holdIds])}`;
    return { eventId: `allocation:${inputDigest(['buddy-expiry', sourceEventId])}`, eventType: 'buddy-expired', runId,
      occurredAt, holdIds, orderUuids: group.map((r) => r.outcome.value.orderUuid), sourceEventId,
      sourceReceipt: { consumerId: 'buddy-expiry', eventId: sourceEventId, inputDigest: inputDigest(group.map((r) => r.inputDigest)),
        inputVersions: { holds: group.map((r) => ({ holdId: r.eventId, ...structuredClone(r.inputVersions ?? {}) })) } } };
  });
}

// Allocation proposes claims; the injected FUCQ-100 port alone owns stock/hold transactions.
export function createAllocationService({ repository, policy, clock, identity, claim } = {}) {
  let registration;
  const ref = (context, eventId, consumerId = ALLOCATION_CONSUMER) => ({ table: 'event_receipts', key: { runId: context.runId, consumerId, eventId } });
  const command = (id, payload) => ({ commandId: id, inputDigest: inputDigest(payload) });
  const sliceRef = (context, eventId, employeeId) => ref(context, allocationEvaluationEventId(eventId, employeeId), ALLOCATION_EVALUATION_CONSUMER);
  const attemptRef = (context, eventId, n) => ref(context, `${eventId}:${n}`, ALLOCATION_ATTEMPT_CONSUMER);
  // Decisions are per car, so a quote rebuilt from the frozen inputs and one pool entry equals the prepare-time quote.
  const evaluate = (context, employeeContext, instant, inputs, stock) => createEmployeeRecommendationService({ policy,
    time: { async now() { return ok(instant); } },
    provider: { async resolve() { return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: employeeContext.employeeId,
      factsVersion: inputs.factsVersion, stockVersion: inputs.stockVersion, employeeFacts: inputs.employeeFacts, stock }); } } })
    .recommend(employeeContext, inputs.request);
  // Callers still receive every evaluation; only the stored receipt holds references.
  async function hydrate(context, eventId, outcome) {
    const refs = outcome?.value?.evaluationRefs; if (outcome?.status !== 'ok' || !refs) return outcome;
    const evaluations = [];
    for (const employeeId of refs.employeeIds) {
      const slice = await repository.read(context, sliceRef(context, eventId, employeeId)); if (slice.status !== 'ok') return slice;
      evaluations.push(expandEvaluation(slice.value.outcome.value.evaluation));
    }
    const { evaluationRefs, ...value } = outcome.value;
    return ok({ ...value, evaluations });
  }
  async function prepare(context, event, instant, assumptions) {
    // A rejected pre-plan attempt reads repaired rows on retry; the accepted prepare receipt freezes replay.
    // Transaction results are kept as command receipts, so this one returns a marker, not the rows.
    let rows;
    const loaded = await repository.transaction(context, command(`allocation:snapshot:${event.eventId}:${randomUUID()}`, event), async (tx) => {
      rows = {};
      for (const table of tables) {
        const found = await tx.list(table); if (found.status !== 'ok') return found;
        rows[table] = found.value;
      }
      return ok({ tables: tables.length });
    });
    if (loaded.status !== 'ok') return loaded;
    const occupying = [...rows.holds, ...rows.claims].filter((r) => OCCUPYING_STATES.includes(r.state));
    const selected = [...rows.holds, ...rows.claims].filter((r) => r.state === 'allocated');
    const pool = rows.stock.filter((r) => ['available', 'released'].includes(r.state) && r.available === true
      && r.held !== true && r.allocated !== true && ![...occupying, ...selected].some((h) => h.orderUuid === r.orderUuid))
      .sort((a, b) => ordinal(a.orderUuid, b.orderUuid));
    // FUCQ-227: an expiry allocation skips this lapse's holders, and never hands anyone a car they already let lapse.
    const expiry = event.eventType === 'buddy-expired';
    const lapsed = new Set(expiry ? rows.holds.filter((h) => event.holdIds.includes(h.holdId)).map((h) => h.employeeId) : []);
    const letLapse = new Set(expiry ? rows.holds.filter((h) => h.state === 'expired' && h.releaseReason === 'buddy-expired').map((h) => `${h.employeeId}|${h.orderUuid}`) : []);
    const briefs = latest(rows.briefs).filter((b) => b.buddy?.searchConsent === true && b.buddy.paused === false)
      .sort((a, b) => ordinal(a.employeeId, b.employeeId));
    const entries = new Map(pool.map((r) => [r.orderUuid, entryOf(r)])); const stockVersions = new Map();
    const plan = { trigger: event, evaluatedAt: instant.now, clockVersion: instant.clockVersion,
      policyVersion: context.policyVersion, assumptions, contenders: [], evaluatedEmployees: [], pool: [...entries.values()],
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
      if (lapsed.has(employee.employeeId) || occupying.some((h) => h.employeeId === employee.employeeId || h.entitlementSlotId === slot.entitlementSlotId)
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
      // Employees seeing the same cars share one stock digest.
      const visibleKey = available.map((r) => r.orderUuid).join(',');
      if (!stockVersions.has(visibleKey)) stockVersions.set(visibleKey, inputDigest(available));
      // FUCQ-225: gates take charging from the brief only, as the hold service does; the quote keeps the stored facts it compares.
      const gateFacts = { ...facts, charging: { status: charging?.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown', value: charging?.value ?? null,
        unit: null, provenance: { sourceRef: charging?.source ?? 'brief:unresolved', version: String(brief.briefVersion), observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } } };
      const inputs = { factsVersion: `employee:${employee.version}`, stockVersion: stockVersions.get(visibleKey), employeeFacts: gateFacts, quoteFacts: facts,
        request: { schemaVersion: brief.schemaVersion, briefVersion: brief.briefVersion,
          preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([k]) => k !== 'charging')) } };
      const evaluated = await evaluate(context, employeeContext, instant, inputs, available.map((r) => entries.get(r.orderUuid)));
      if (evaluated.status !== 'ok') return unavailable('employee-evaluation-unavailable');
      // Decisions arrive frozen; copy only what the decline check below changes.
      const decisions = evaluated.value.decisions.map((d) => ({ ...d, blockers: [...d.blockers] }));
      let contending = false;
      for (const decision of decisions) {
        const declined = rows.decisions.filter((d) => d.employeeId === employee.employeeId && d.decision === 'decline'
          && rows.offers.some((o) => o.offerId === d.offerId && o.orderUuid === decision.orderUuid));
        if (declined.some((d) => { const previous = rows.briefs.find((b) => b.employeeId === employee.employeeId && b.briefVersion === d.versions?.brief);
          return !previous || inputDigest(intent(previous)) === inputDigest(intent(brief)); })) {
          decision.gateStatus = 'ineligible'; decision.suitable = false; decision.blockers.push({ code: 'declined-unchanged' });
        }
        if (decision.gateStatus !== 'eligible' || brief.buddy.holdConsent !== true || letLapse.has(`${employee.employeeId}|${decision.orderUuid}`)) continue;
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
        contending = true;
      }
      plan.evaluatedEmployees.push(employee.employeeId);
      // FUCQ-217: quotes are rebuilt for attempted contenders only, from these frozen inputs.
      slices.push({ employeeId: employee.employeeId, quoteInputs: contending ? inputs : null, evaluation: packEvaluation({ employeeId: employee.employeeId,
        versions: evaluated.value.versions, decisions: decisions.map((d) => ({ orderUuid: d.orderUuid, gateStatus: d.gateStatus, score: d.score,
          reasons: d.reasons, blockers: d.blockers, unknowns: d.unknowns, versions: d.versions })) }) });
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
        const lapses = buddyExpiryEvents(context.runId, loaded.value); if (!lapses) return unavailable('allocation-trigger-invalid');
        events.push(...lapses);
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
      if (!event || !text(event.eventId) || !['stock-released', 'brief-changed', 'buddy-expired'].includes(event.eventType)
        || event.runId !== context.runId || event.eventType === 'buddy-expired'
          && (!Array.isArray(event.holdIds) || !event.holdIds.length || !event.holdIds.every(text))) return result('invalid', { code: 'invalid-allocation-event' });
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
          const values = await Promise.all([...keys, ...(event.eventType === 'buddy-expired' ? [EXPIRY_KEY] : [])].map((key) => policy.getAssumption(key, read)));
          if (values.some((v) => v.status !== 'ok' || v.policyVersion !== context.policyVersion)) return unavailable('policy-unavailable');
          const assumptions = values.map((v) => v.value);
          if (!compare(assumptions[0].value) || !text(assumptions[1].value)
            || assumptions[2].value !== 'untilRelevantConfirmedBriefChange'
            || event.eventType === 'buddy-expired' && assumptions[3]?.value !== EXPIRY_RULE) return unavailable('policy-invalid');
          const planned = await prepare(context, event, time.value, assumptions); if (planned.status !== 'ok') return planned;
          const { plan: prepared, slices } = planned.value;
          const recorded = await repository.transaction(context, command(`allocation:prepare:${event.eventId}`, event), async (tx) => {
            const cursor = await tx.recordReceipt({ consumerId: ALLOCATION_CURSOR_CONSUMER, eventId: event.eventId, eventType: event.eventType,
              inputDigest: digest, inputVersions: prepared.inputVersions, state: 'pending', outcome: ok({ next: 0, count: 0 }) });
            if (cursor.status !== 'ok') return cursor;
            for (const slice of slices) {
              const saved = await tx.recordReceipt({ consumerId: ALLOCATION_EVALUATION_CONSUMER, eventId: allocationEvaluationEventId(event.eventId, slice.employeeId),
                eventType: event.eventType, inputDigest: digest, inputVersions: { allocationEventId: event.eventId }, state: 'completed',
                outcome: ok({ runId: context.runId, eventId: event.eventId, employeeId: slice.employeeId, evaluation: slice.evaluation, quoteInputs: slice.quoteInputs }) });
              if (saved.status !== 'ok') return saved;
            }
            const saved = await tx.recordReceipt({ consumerId: ALLOCATION_CONSUMER, eventId: event.eventId, eventType: event.eventType, inputDigest: digest,
              inputVersions: prepared.inputVersions, state: 'pending', outcome: ok({ plan: prepared, next: 0, assignments: [], attempts: [] }) });
            return saved.status === 'ok' ? ok({ prepared: event.eventId }) : saved;
          });
          if (recorded.status !== 'ok') return recorded;
          receipt = await repository.read(context, ref(context, event.eventId));
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
        const progress = cursor.value.outcome.value; let version = cursor.value.version; let next = progress.next;
        // A cursor written before FUCQ-217 carries every attempt inline and keeps doing so.
        const legacy = Array.isArray(progress.assignments);
        const assignments = legacy ? progress.assignments : []; const attempts = legacy ? progress.attempts : [];
        // Quotes: inline before FUCQ-209, stored per employee by FUCQ-209, rebuilt from frozen inputs after FUCQ-217.
        const sliceRows = new Map(); const pool = new Map((plan.pool ?? []).map((entry) => [entry.orderUuid, entry]));
        const instant = { runId: context.runId, now: plan.evaluatedAt, clockVersion: plan.clockVersion };
        const quoteFor = async (contender, employeeContext) => {
          if (contender.quote) return ok(contender.quote);
          if (!sliceRows.has(contender.employeeId)) {
            const slice = await repository.read(context, sliceRef(context, event.eventId, contender.employeeId)); if (slice.status !== 'ok') return slice;
            sliceRows.set(contender.employeeId, slice.value.outcome.value);
          }
          const { quotes, quoteInputs } = sliceRows.get(contender.employeeId);
          if (quotes) return quotes[contender.orderUuid] ? ok(quotes[contender.orderUuid]) : unavailable('allocation-quote-unavailable');
          const entry = pool.get(contender.orderUuid); if (!quoteInputs || !entry) return unavailable('allocation-quote-unavailable');
          const evaluated = await evaluate(context, employeeContext, instant, quoteInputs, [entry]);
          const decision = evaluated.status === 'ok' ? evaluated.value.decisions[0] : null;
          return decision?.orderUuid === contender.orderUuid && decision.gateStatus === 'eligible' ? ok({ ...quoteOf(decision), employeeFacts: quoteInputs.quoteFacts ?? decision.employeeFacts }) : unavailable('allocation-quote-unavailable');
        };
        for (let n = 0; !legacy && n < progress.count; n += 1) {
          const saved = await repository.read(context, attemptRef(context, event.eventId, n)); if (saved.status !== 'ok') return saved;
          const { index, attempt } = saved.value.outcome.value; attempts.push(attempt);
          if (attempt.outcome.status !== 'ok') continue;
          const contender = plan.contenders[index];
          const resolved = await identity.resolveEmployeeContext(context, contender.employeeId); if (resolved.status !== 'ok') return resolved;
          const quote = await quoteFor(contender, resolved.value); if (quote.status !== 'ok') return quote;
          assignments.push({ ...contender, quote: quote.value, operationId: attempt.operationId, claim: attempt.outcome.value });
        }
        // Skipped contenders need no write: on retry they are skipped again from the same assignments.
        while (next < plan.contenders.length) {
          const contender = plan.contenders[next]; next += 1;
          const assigned = assignments.some((a) => a.employeeId === contender.employeeId || a.entitlementSlotId === contender.entitlementSlotId
            || contender.renewalId && a.renewalId === contender.renewalId || a.orderUuid === contender.orderUuid);
          if (!assigned) {
            const resolved = await identity.resolveEmployeeContext(context, contender.employeeId); if (resolved.status !== 'ok') return resolved;
            const quote = await quoteFor(contender, resolved.value); if (quote.status !== 'ok') return quote;
            const candidate = { ...contender, quote: quote.value };
            const operationId = `allocation:${inputDigest([context.runId, event.eventId, candidate.employeeId, candidate.orderUuid])}`;
            const outcome = await claim.tryClaim(resolved.value, { ...candidate, operationId, eventId: event.eventId, runId: context.runId });
            if (!['ok', 'conflict', 'stale-version'].includes(outcome?.status)) return unavailable('claim-pending');
            const attempt = { employeeId: candidate.employeeId, orderUuid: candidate.orderUuid, operationId, outcome };
            attempts.push(attempt); if (outcome.status === 'ok') assignments.push({ ...candidate, operationId, claim: outcome.value });
            const saved = legacy ? { next, attempts, assignments } : { next, count: attempts.length };
            const advanced = await repository.transaction(context, command(`allocation:advance:${event.eventId}:${version}`, legacy ? saved : { ...saved, attempt }),
              async (tx) => {
                if (!legacy) {
                  const stored = await tx.recordReceipt({ consumerId: ALLOCATION_ATTEMPT_CONSUMER, eventId: `${event.eventId}:${attempts.length - 1}`, eventType: event.eventType,
                    inputDigest: digest, inputVersions: { allocationEventId: event.eventId }, state: 'completed', outcome: ok({ index: next - 1, attempt }) });
                  if (stored.status !== 'ok') return stored;
                }
                const swapped = await tx.compareAndSwap(cursorRef, version, { outcome: ok(saved) });
                return swapped.status === 'ok' ? ok({ version: swapped.value.version }) : swapped;
              });
            if (advanced.status !== 'ok') return advanced;
            version = advanced.value.version;
          }
        }
        const evaluated = Array.isArray(plan.evaluations) ? { evaluations: plan.evaluations }
          : { evaluationRefs: { consumerId: ALLOCATION_EVALUATION_CONSUMER, employeeIds: plan.evaluatedEmployees } };
        const outcome = ok({ state: assignments.length ? 'allocated' : 'no-assignment', runId: context.runId, event: plan.trigger,
          evaluatedAt: plan.evaluatedAt, policyVersion: plan.policyVersion, assumptions: plan.assumptions,
          inputVersions: plan.inputVersions, assignments, attempts, ...evaluated });
        const finished = await repository.transaction(context, command(`allocation:complete:${event.eventId}`, outcome), async (tx) => {
          const closed = await tx.compareAndSwap(cursorRef, version, { state: 'completed' }); if (closed.status !== 'ok') return closed;
          const done = await tx.compareAndSwap(ref(context, event.eventId), row.version, { state: 'completed', outcome });
          return done.status === 'ok' ? ok({ completed: event.eventId }) : done;
        });
        if (finished.status !== 'ok') return finished;
        const completed = await repository.read(context, ref(context, event.eventId));
        return completed.status === 'ok' ? hydrate(context, event.eventId, completed.value.outcome) : completed;
      } catch { return unavailable('allocation-source-invalid'); }
    },
  };
  return service;
}
