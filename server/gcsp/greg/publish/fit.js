import { createEmployeeRecommendationService } from '../../recommendation/index.js';
import { inputDigest, ok, result } from '../../repository/index.js';

const visible = (stock, employee) => stock.visibility?.companyIds?.includes(employee.companyId)
  && stock.visibility?.schemeIds?.includes(employee.schemeId)
  && (stock.visibility.employeeIds === null || stock.visibility.employeeIds?.includes(employee.employeeId));
const intent = (brief) => ({
  preferences: Object.fromEntries(Object.entries(brief.preferences ?? {}).map(([key, p]) => [key,
    { value: p.value, importance: p.importance, valueState: p.valueState, importanceState: p.importanceState }])),
  essentials: Object.fromEntries(Object.entries(brief.essentials ?? {}).map(([key, e]) => [key,
    { value: e.operator === 'includes' && Array.isArray(e.value) ? [...new Set(e.value)].sort() : e.value,
      operator: e.operator, unit: e.unit, state: e.state }])),
});

// This operational projection retains only cohort aggregates, never individual scores or identities.
export async function evaluateFit({ rows, context, policy, time, threshold }) {
  const latest = new Map();
  for (const brief of rows.briefs) if (brief.status === 'confirmed'
    && (!latest.has(brief.employeeId) || latest.get(brief.employeeId).briefVersion < brief.briefVersion)) latest.set(brief.employeeId, brief);
  const scores = []; let eligible = 0;
  for (const brief of latest.values()) {
    const employee = rows.employees.find((row) => row.employeeId === brief.employeeId);
    if (!employee?.roles?.includes('employee')) return result('unavailable', { code: 'brief-owner-unavailable', retryable: true });
    const stock = rows.stock.filter((row) => ['released', 'held', 'allocated'].includes(row.state) && visible(row, employee));
    const facts = structuredClone(employee.contract?.manualContext?.employeeFacts ?? {});
    const charging = brief.essentials?.charging;
    if (charging) facts.charging = { status: charging.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown',
      value: charging.value, unit: null, provenance: { sourceRef: 'saved-brief', version: String(brief.briefVersion),
        observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
    const employeeContext = { ...context, ...Object.fromEntries(['employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId']
      .map((key) => [key, employee[key]])), roles: ['employee'] };
    const evaluator = createEmployeeRecommendationService({ policy, time: { async now() { return time; } },
      provider: { async resolve() { return ok({ runId: context.runId, environmentId: context.environmentId,
        employeeId: employee.employeeId, factsVersion: `employee:${employee.version}`, stockVersion: inputDigest(stock), employeeFacts: facts,
        stock: stock.map((row) => ({ orderUuid: row.orderUuid, configurationId: row.configurationId, snapshot: row.facts,
          availability: { ...row.release?.availability, state: row.state === 'released' && row.available === true
            && row.held !== true && row.allocated !== true ? row.release?.availability?.state : 'unavailable' } })) }); } } });
    const evaluated = await evaluator.recommend(employeeContext, { schemaVersion: brief.schemaVersion, briefVersion: brief.briefVersion,
      preferences: brief.preferences, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) });
    if (evaluated.status !== 'ok') return evaluated;
    const suitable = evaluated.value.decisions.filter((decision) => decision.gateStatus === 'eligible'
      && !rows.decisions.some((d) => d.employeeId === brief.employeeId && d.decision === 'decline'
        && rows.offers.some((o) => o.offerId === d.offerId && o.orderUuid === decision.orderUuid)
        && (() => { const previous = rows.briefs.find((b) => b.employeeId === brief.employeeId && b.briefVersion === d.versions?.brief);
          return !previous || inputDigest(intent(previous)) === inputDigest(intent(brief)); })()));
    if (suitable.length) eligible += 1;
    const scored = suitable.map((decision) => decision.score).filter(Number.isFinite);
    if (scored.length) scores.push(Math.max(...scored));
  }
  const count = (value) => value < threshold ? { kind: 'band', fewerThan: threshold, label: `fewer than ${threshold}` }
    : { kind: 'exact', value, label: String(value) };
  return ok({ basis: 'saved-brief-recommendation-fit', label: 'Recommendation fit, not predicted acceptance',
    employeesWithEligibleStock: count(eligible), scoredBriefs: count(scores.length),
    meanBestScore: scores.length >= threshold ? { status: 'available', value: scores.reduce((a, b) => a + b, 0) / scores.length, unit: 'score/100' }
      : { status: 'suppressed', fewerThan: threshold, unit: 'score/100' } });
}
