import { inputDigest } from '../repository/core.js';
import { createStoredSubjectRecommendationEvaluator } from '../recommendation/index.js';
import { freezeVehicleData } from '../../vehicles/index.js';
import { ComparisonRunError, comparisonAssumption, comparisonDriverFact, comparisonEmployeeFacts, comparisonStockRows } from './harness.js';

const fail = (boundary, code = 'invalid-input') => { throw new ComparisonRunError(code, boundary); };

// The latent needs use the same brief schema as the stated brief, so both pass through one evaluator.
function underlyingBrief(employee) {
  return { schemaVersion: 1, briefVersion: 1, requiredBy: employee.renewalAt,
    essentials: Object.fromEntries(Object.entries(employee.underlyingNeeds.essentials).map(([key, value]) => [key,
      { ...structuredClone(value), state: 'confirmed', source: 'synthetic-underlying-needs' }])),
    preferences: Object.fromEntries(Object.entries(employee.underlyingNeeds.preferences).map(([key, value]) => [key,
      { ...structuredClone(value), valueState: 'confirmed', importanceState: 'confirmed', source: 'synthetic-underlying-needs' }])) };
}
const summary = (decision) => Object.freeze({ gateStatus: decision.gateStatus, score: decision.score,
  blockers: Object.freeze(decision.blockers.map((entry) => entry.code)), unknowns: Object.freeze(decision.unknowns.map((entry) => entry.code)) });

/**
 * Evaluates every employee against every car once per seed through FUCQ-29's evaluator.
 * Cars sharing configuration and facts form one group, so the result projects exactly to each exact car.
 */
export async function evaluateComparisonSeed({ inputs, policy } = {}) {
  if (!inputs?.manifest || !Array.isArray(inputs.employees) || !Array.isArray(inputs.stock)) fail('inputs');
  const { manifest } = inputs;
  const read = { runId: `comparison-evaluation-${manifest.inputHash.slice(0, 24)}`, asOf: manifest.startsAt, policyVersion: manifest.policyVersion };
  const [adapterRow, thresholdRow] = await Promise.all([comparisonAssumption(policy, 'comparison.recordAdapter.v1', read),
    comparisonAssumption(policy, 'comparison.acceptableFitThreshold', read)]);
  const threshold = thresholdRow.value;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) fail('comparison.acceptableFitThreshold');
  const rows = comparisonStockRows(inputs, adapterRow);
  const groups = new Map();
  for (const row of rows) {
    const key = inputDigest({ configurationId: row.configurationId, facts: row.facts.facts });
    if (!groups.has(key)) groups.set(key, { groupId: `group-${groups.size + 1}`, representative: row, orderUuids: [] });
    groups.get(key).orderUuids.push(row.orderUuid);
  }
  const until = rows[0]?.release.availability.availableUntil ?? manifest.startsAt;
  const stock = [...groups.values()].map(({ representative: row }) => ({ orderUuid: row.orderUuid, configurationId: row.configurationId,
    snapshot: row.facts, availability: { state: 'available', availableFrom: manifest.startsAt, availableUntil: until,
      version: `comparison-static:${manifest.inputHash}` } }));
  const groupOf = new Map([...groups.values()].flatMap((group) => group.orderUuids.map((orderUuid) => [orderUuid, group.groupId])));
  const environmentId = `comparison-evaluation-${manifest.inputHash.slice(0, 24)}`;
  let subjectFacts = null;
  const evaluator = createStoredSubjectRecommendationEvaluator({ policy,
    provider: { resolve: async (subject) => ({ status: 'ok', value: { runId: subject.runId, environmentId, employeeId: subject.employeeId,
      factsVersion: `${adapterRow.policyVersion}:${adapterRow.value.fixtureVersion}`, stockVersion: `comparison-static:${manifest.inputHash}`,
      employeeFacts: subjectFacts, stock } }) },
    time: { now: async (subject) => ({ status: 'ok', value: { runId: subject.runId, now: manifest.startsAt, clockVersion: 'comparison-static-evaluation' } }) } });
  let evaluatorCalls = 0;
  const employees = {};
  for (const employee of inputs.employees) {
    const subject = { runId: read.runId, environmentId, employeeId: employee.employeeId, companyId: employee.companyId,
      schemeId: employee.schemeId, gradeId: employee.gradeId, policyVersion: manifest.policyVersion };
    subjectFacts = { ...comparisonEmployeeFacts(employee, adapterRow, manifest.startsAt),
      driverEligible: comparisonDriverFact(adapterRow, manifest.startsAt) };
    const fits = {};
    for (const [route, brief] of [['stated', employee.statedBrief], ['underlying', underlyingBrief(employee)]]) {
      evaluatorCalls += 1;
      const outcome = await evaluator.evaluate(subject, brief);
      if (outcome.status !== 'ok') fail(`evaluation:${route}:${outcome.code ?? outcome.status}`, outcome.status);
      for (const decision of outcome.value.decisions) (fits[groupOf.get(decision.orderUuid)] ??= {})[route] = summary(decision);
    }
    employees[employee.employeeId] = Object.freeze(fits);
  }
  return freezeVehicleData({ seed: manifest.seed, inputHash: manifest.inputHash, policyVersion: manifest.policyVersion,
    threshold, thresholdKey: 'comparison.acceptableFitThreshold', evaluatorCalls, evaluatedAt: manifest.startsAt,
    groups: [...groups.values()].map((group) => ({ groupId: group.groupId, configurationId: group.representative.configurationId,
      orderUuids: [...group.orderUuids].sort() })),
    groupOf: Object.fromEntries(groupOf), employees });
}

export function carFit(evaluation, employeeId, orderUuid) {
  const fits = evaluation.employees[employeeId]; const groupId = evaluation.groupOf[orderUuid];
  if (!fits || !groupId) fail('evaluation-member');
  return fits[groupId];
}
const passes = (fit, threshold) => fit?.gateStatus === 'eligible' && Number.isFinite(fit.score) && fit.score >= threshold;

// Acceptance uses only the underlying needs; the stated brief never decides it.
export const acceptable = (evaluation, employeeId, orderUuid) => passes(carFit(evaluation, employeeId, orderUuid).underlying, evaluation.threshold);

// Cars the employee would claim from the listing: stated gates and fit, best first, then orderUuid.
export function statedCandidates(evaluation, employeeId) {
  const fits = evaluation.employees[employeeId]; if (!fits) fail('evaluation-member');
  return evaluation.groups.filter((group) => passes(fits[group.groupId]?.stated, evaluation.threshold))
    .flatMap((group) => group.orderUuids.map((orderUuid) => ({ orderUuid, score: fits[group.groupId].stated.score })))
    .sort((a, b) => b.score - a.score || a.orderUuid.localeCompare(b.orderUuid)).map((entry) => entry.orderUuid);
}
