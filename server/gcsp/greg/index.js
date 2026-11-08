import { inputDigest, ok, result, OCCUPYING_STATES } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { projectRecommendationFacts } from '../manual-context/recommendation-facts.js';
import { readStockSourceStatus } from '../stock/source-status.js';

const THRESHOLD_KEY = 'greg.demand.smallCountThreshold';
const tables = ['briefs', 'employees', 'entitlement_slots', 'stock', 'holds', 'offers', 'decisions', 'quotes'];
const unavailable = (code) => result('unavailable', { code, reason: 'The saved-demand projection is unavailable.', retryable: true });
const factValue = (fact) => fact?.status === 'known' ? fact.value : null;
const modelLine = (row) => factValue(row.facts?.facts?.modelLine)
  ?? factValue(row.facts?.facts?.eligibilityModelKey)?.split('|')[0] ?? 'unconfirmed';
const requirementValue = (e) => e.operator === 'includes' && Array.isArray(e.value) ? [...new Set(e.value)].sort() : e.value;
const intent = (brief) => ({
  preferences: Object.fromEntries(Object.entries(brief.preferences ?? {}).map(([key, p]) => [key,
    { value: p.value, importance: p.importance, valueState: p.valueState, importanceState: p.importanceState }])),
  essentials: Object.fromEntries(Object.entries(brief.essentials ?? {}).map(([key, e]) => [key,
    { value: requirementValue(e), operator: e.operator, unit: e.unit, state: e.state }])),
});
const activeBriefs = (rows) => [...rows.reduce((byEmployee, row) => {
  if (row.status === 'confirmed' && (!byEmployee.has(row.employeeId) || byEmployee.get(row.employeeId).briefVersion < row.briefVersion)) byEmployee.set(row.employeeId, row);
  return byEmployee;
}, new Map()).values()];
const desired = (brief, field) => {
  const e = brief.essentials?.[field];
  if (e?.state === 'confirmed' && e.value !== null) return e.value;
  const p = brief.preferences?.[field];
  return p?.valueState === 'confirmed' && p.importanceState === 'confirmed' && p.importance > 0 ? p.value : 'unspecified';
};
const visible = (row, employee) => Array.isArray(row.visibility?.companyIds) && Array.isArray(row.visibility?.schemeIds)
  && row.visibility.companyIds.includes(employee.companyId) && row.visibility.schemeIds.includes(employee.schemeId)
  && (row.visibility.employeeIds === null || Array.isArray(row.visibility.employeeIds) && row.visibility.employeeIds.includes(employee.employeeId));
const candidate = (row) => ({ orderUuid: row.orderUuid, configurationId: row.configurationId, snapshot: row.facts,
  availability: { ...row.release?.availability, state: row.state === 'released' && row.available === true && row.held !== true && row.allocated !== true
    ? row.release?.availability?.state : 'unavailable' } });

// Pure projection over the authoritative repository. Reads never mutate a brief, offer, hold
// or expiry state, and no retail result limit is used to evaluate saved demand.
export function createGregDemandService({ repository, policy, clock, identity } = {}) {
  return {
    async readDemand(context) {
      if (!repository || !policy || !clock || !identity) return unavailable('not-configured');
      const allowed = await identity.requireRole(context, 'greg');
      if (allowed.status !== 'ok') return allowed;
      try {
        const time = await clock.now(context);
        if (time.status !== 'ok') return time;
        if (time.value?.runId !== context.runId || !validInstant(time.value.now)) return unavailable('clock-invalid');
        const read = { runId: context.runId, policyVersion: context.policyVersion, asOf: time.value.now };
        const threshold = await policy.getAssumption(THRESHOLD_KEY, read);
        const calibration = await policy.getAssumption('employee.recommendation.v1', read);
        const declinedPolicy = await policy.getAssumption('offer.declinedCar.exclusion', read);
        if (declinedPolicy.status !== 'ok' || declinedPolicy.policyVersion !== context.policyVersion
          || declinedPolicy.value.value !== 'untilRelevantConfirmedBriefChange' || threshold.status !== 'ok' || calibration.status !== 'ok' || threshold.policyVersion !== context.policyVersion
          || calibration.policyVersion !== context.policyVersion || !Number.isSafeInteger(threshold.value.value) || threshold.value.value < 1) return unavailable('privacy-policy-unavailable');
        const minimum = threshold.value.value;
        const load = async () => {
          const rows = await Promise.all(tables.map((table) => repository.query(context, table)));
          if (rows.some((r) => r.status !== 'ok')) return { error: rows.find((r) => r.status !== 'ok') };
          return Object.fromEntries(tables.map((table, i) => [table, rows[i].value]));
        };
        const rows = await load(); if (rows.error) return rows.error;
        const briefs = activeBriefs(rows.briefs);
        const provenance = (items = []) => ({ brief: [...new Set(items.flatMap((x) => [x.briefVersion, x.versions?.brief]).filter(Number.isSafeInteger))].sort((a, b) => a - b),
          policy: [...new Set([context.policyVersion, ...items.flatMap((x) => [x.policyVersion, x.versions?.policy]).filter((x) => typeof x === 'string')])].sort() });
        const count = (value) => value < minimum ? { kind: 'band', fewerThan: minimum, label: `fewer than ${minimum}` }
          : { kind: 'exact', value, label: String(value) };
        const aggregate = (items, versions = items) => ({ count: count(items.length), versions: provenance(versions) });
        const group = (items, key, versions = (item) => [item]) => {
          const groups = new Map();
          for (const item of items) { const k = key(item); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(item); }
          return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, matches]) => ({ key: k,
            ...aggregate(matches, matches.flatMap(versions)) }));
        };
        const unmet = [];
        for (const brief of briefs) {
          const employee = rows.employees.find((row) => row.employeeId === brief.employeeId);
          if (!employee || !employee.roles?.includes('employee')) return unavailable('brief-owner-unavailable');
          const employeeContext = { ...context, ...Object.fromEntries(['employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId'].map((key) => [key, employee[key]])), roles: ['employee'] };
          const facts = projectRecommendationFacts({ context: employeeContext, employee, brief,
            slots: rows.entitlement_slots, now: time.value.now });
          if (facts.status !== 'ok') return unavailable('source-invalid');
          const supplied = facts.value.employeeFacts;
          const released = rows.stock.filter((row) => ['released', 'held', 'allocated'].includes(row.state));
          const available = released.filter((row) => visible(row, employee));
          if (!available.length) { unmet.push({ brief, gates: [released.length ? 'stock-not-visible' : 'no-released-stock'] }); continue; }
          const charging = brief.essentials?.charging;
          if (charging) supplied.charging = { status: charging.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
            value: charging.value, unit: null, provenance: { sourceRef: 'saved-brief', version: String(brief.briefVersion),
              observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
          const evaluator = createEmployeeRecommendationService({ policy, time: { async now() { return time; } },
            provider: { async resolve() { return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: employee.employeeId,
              factsVersion: facts.value.factsVersion, stockVersion: inputDigest(available), employeeFacts: supplied, stock: available.map(candidate) }); } } });
          const evaluated = await evaluator.recommend(employeeContext, { schemaVersion: brief.schemaVersion, briefVersion: brief.briefVersion,
            preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) });
          if (evaluated.status !== 'ok') return unavailable('evaluation-unavailable');
          const evaluatedDecisions = structuredClone(evaluated.value.decisions);
          for (const decision of evaluatedDecisions) {
            const declined = rows.decisions.filter((d) => d.employeeId === brief.employeeId && d.decision === 'decline'
              && rows.offers.some((o) => o.offerId === d.offerId && o.orderUuid === decision.orderUuid));
            const blocked = declined.some((d) => {
              const previous = rows.briefs.find((b) => b.employeeId === brief.employeeId && b.briefVersion === d.versions?.brief);
              return !previous || inputDigest(intent(previous)) === inputDigest(intent(brief));
            });
            if (blocked) { decision.gateStatus = 'ineligible'; decision.blockers = [...decision.blockers, { code: 'declined-unchanged' }]; }
          }
          if (!evaluatedDecisions.some((decision) => decision.gateStatus === 'eligible')) {
            const gates = [...new Set(evaluatedDecisions.flatMap((decision) => [...decision.blockers, ...decision.unknowns]
              .map((gate) => `${gate.code}${gate.field ? `:${gate.field}` : ''}`)))].sort();
            unmet.push({ brief, gates });
          }
        }
        const essentialRows = briefs.flatMap((brief) => Object.entries(brief.essentials ?? {})
          .filter(([field]) => field === 'charging' || Object.hasOwn(calibration.value.value.essentials, field))
          .map(([field, requirement]) => ({ brief, field, operator: requirement.operator, unit: requirement.unit,
            value: requirement.state === 'confirmed' ? requirementValue(requirement) : null, state: requirement.state === 'confirmed' ? 'confirmed' : 'needs-confirmation' })));
        const essentials = group(essentialRows, (r) => JSON.stringify([r.field, r.operator, r.value, r.unit, r.state]), (r) => [r.brief])
          .map((g) => { const [field, operator, value, unit, state] = JSON.parse(g.key); const { key, ...rest } = g; return { field, operator, value, unit, state, ...rest }; });
        const offerVersions = (offer) => [offer, ...rows.decisions.filter((d) => d.offerId === offer.offerId)];
        const decisions = (offer, values) => rows.decisions.some((d) => d.offerId === offer.offerId && values.includes(d.decision));
        const declined = rows.offers.filter((o) => o.state === 'declined' || decisions(o, ['decline']));
        const accepted = rows.offers.filter((o) => o.state === 'accepted' || decisions(o, ['accept']));
        const selected = rows.offers.filter((o) => o.state === 'selected' || decisions(o, ['select', 'selected'])
          || rows.holds.some((h) => h.holdId === o.holdId && h.state === 'allocated'
            && rows.stock.some((s) => s.orderUuid === h.orderUuid && (s.state === 'allocated' || s.allocated === true))));
        const expired = rows.offers.filter((o) => o.state === 'expired' && !accepted.includes(o) && !selected.includes(o) && !declined.includes(o));
        const reasonTypes = new Set([...Object.keys(calibration.value.value.preferences), ...Object.keys(calibration.value.value.essentials),
          'other', 'timing', 'points', 'no-longer-needed', 'just-not-this-one']);
        const reason = (offer) => {
          const recorded = rows.decisions.find((d) => d.offerId === offer.offerId && d.decision === 'decline');
          const type = recorded?.reason?.type ?? recorded?.reason?.code;
          return reasonTypes.has(type) ? type : 'unclassified';
        };
        const holdVersions = (hold) => [hold, ...rows.quotes.filter((q) => q.quoteId === hold.quoteId), ...rows.offers.filter((o) => o.holdId === hold.holdId)];
        const stockModels = group(rows.stock.filter((s) => ['released', 'held', 'allocated'].includes(s.state)), modelLine);
        const stocks = stockModels.map(({ key }) => { const all = rows.stock.filter((s) => modelLine(s) === key);
          return { key, released: aggregate(all.filter((s) => s.state === 'released' && s.available === true && s.held !== true && s.allocated !== true)),
            held: aggregate(all.filter((s) => s.state === 'held' || s.held === true)),
            allocated: aggregate(all.filter((s) => s.state === 'allocated' || s.allocated === true)) }; });
        // The public repository has no snapshot read port. Monotonic row revisions and a
        // second complete read fence concurrent changes instead of publishing a mixed view.
        const after = await load(); if (after.error) return after.error;
        const end = await clock.now(context); if (end.status !== 'ok') return end;
        if (inputDigest(rows) !== inputDigest(after) || time.value.clockVersion !== end.value.clockVersion) return result('conflict', {
          reason: 'Demand inputs changed during the read. Refresh the projection.' });
        const authorized = await identity.requireRole(context, 'greg'); if (authorized.status !== 'ok') return authorized;
        return ok({ runId: context.runId, asOf: time.value.now, projectionVersion: inputDigest({ rows, policy: context.policyVersion, configuration: [threshold.value, calibration.value, declinedPolicy.value], clock: time.value.clockVersion }),
          basis: 'expressed-saved-demand', versions: { ...provenance(briefs), clock: time.value.clockVersion },
          privacy: { thresholdKey: THRESHOLD_KEY, threshold: minimum, policyVersion: threshold.policyVersion, status: threshold.value.status },
          demand: { activeBriefs: aggregate(briefs), byModelLine: group(briefs, (b) => String(desired(b, 'modelLine'))),
            byBody: group(briefs, (b) => String(desired(b, 'body'))), byFuel: group(briefs, (b) => String(desired(b, 'fuel'))), essentials,
            unmet: { total: aggregate(unmet, unmet.map((r) => r.brief)), byGate: group(unmet.flatMap((r) => r.gates.map((gate) => ({ gate, brief: r.brief }))), (r) => r.gate, (r) => [r.brief]) } },
          holds: { total: aggregate(rows.holds, rows.holds.flatMap(holdVersions)),
            active: aggregate(rows.holds.filter((h) => OCCUPYING_STATES.includes(h.state)), rows.holds.filter((h) => OCCUPYING_STATES.includes(h.state)).flatMap(holdVersions)),
            byState: group(rows.holds, (h) => h.state, holdVersions), byType: group(rows.holds, (h) => h.type ?? 'unconfirmed', holdVersions) },
          offers: { made: aggregate(rows.offers, rows.offers.flatMap(offerVersions)), accepted: aggregate(accepted, accepted.flatMap(offerVersions)),
            declined: aggregate(declined, declined.flatMap(offerVersions)), expired: aggregate(expired, expired.flatMap(offerVersions)),
            selected: aggregate(selected, selected.flatMap(offerVersions)), declinedByReason: group(declined, reason, offerVersions) },
          stock: { byModelLine: stocks, source: await readStockSourceStatus(repository, context) } });
      } catch { return unavailable('source-invalid'); }
    },
  };
}
