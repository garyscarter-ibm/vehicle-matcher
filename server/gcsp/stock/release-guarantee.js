import { loadDemoPrincipals } from '../fixtures/principals.js';
import { briefContent } from '../scenarios/brief-start.js';
import { evaluateEssentials, chargingGates } from '../../scenarios/employee/index.js';

/** Per-configuration check for a release guarantee: does a car of this configuration pass the named principal's
 * car-only gates (eligibility, allowance, brief essentials, charging)? Timing and driver gates depend on the person. */
export async function createReleaseGuarantee({ policy, read, scenario, guarantee }) {
  const { principalId } = guarantee ?? {};
  const [principals, assumptions] = await Promise.all([loadDemoPrincipals(policy, read),
    Promise.all(['employee.recommendation.v1', 'eligibility.homeCharging.requiredForPlugIn'].map((key) => policy.getAssumption(key, read)))]);
  const person = principals.status === 'ok' ? principals.value.find((row) => row.principalId === principalId) : null;
  const input = scenario?.inputs?.briefs?.find((row) => row.principalId === principalId);
  if (!person || !input || assumptions.some((row) => row.status !== 'ok')) return null;
  const context = { companyId: person.companyId, schemeId: person.schemeId, gradeId: person.gradeId };
  const content = await briefContent(policy, read, input, `scenario:${scenario.scenarioId}`);
  const allowance = await policy.getAllowance(context, read);
  if (!content || allowance.status !== 'ok') return null;
  const [{ value: { value: config } }, { value: { value: requiredForPlugIn } }] = assumptions;
  const { charging, ...essentials } = content.essentials;
  const employeeFacts = { charging: { status: charging?.value == null ? 'unknown' : 'known', value: charging?.value ?? null, unit: null,
    provenance: { sourceRef: charging?.source ?? 'brief:unresolved', version: 'release-guarantee', observedAt: read.asOf, assurance: 'synthetic-scenario' } } };
  const cache = new Map();
  async function evaluate(binding, extraFacts) {
    const snapshot = { facts: extraFacts };
    const known = Object.fromEntries(Object.entries(extraFacts).filter(([, fact]) => fact.status === 'known').map(([key, fact]) => [key, fact.value]));
    const car = { ...known, configurationId: binding.configurationId };
    const [eligibility, points] = await Promise.all([policy.getEligibility(context, car, read), policy.getPointsCost(context, car, read)]);
    if (eligibility.status !== 'ok' || eligibility.value.state !== 'eligible' || points.status !== 'ok'
      || points.value.monthlyPoints > allowance.value.monthlyPoints) return false;
    return [evaluateEssentials(snapshot, { essentials }, config, { optionalDefaults: true }), chargingGates(snapshot, employeeFacts, config, requiredForPlugIn)]
      .every((gate) => !gate.blockers.length && !gate.unknowns.length);
  }
  return { qualifies: async (binding, _record, extraFacts) => {
    const id = binding.configurationId;
    if (!cache.has(id)) cache.set(id, evaluate(binding, extraFacts ?? {}));
    return cache.get(id);
  } };
}
