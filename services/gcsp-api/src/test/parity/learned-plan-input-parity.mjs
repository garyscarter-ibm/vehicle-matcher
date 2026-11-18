// Offline Node oracle for Java planner input replay; no runtime Java/Node bridge or scratch files.
import { readFile, writeFile } from 'node:fs/promises';
import { PolicyService } from '../../../../../server/gcsp/policy/index.js';
import { createPolicyOrderPlanCatalog, createPolicyFutureTermsProvider } from '../../../../../server/gcsp/predict/plan/index.js';
import { createPredictionInput } from '../../../../../server/gcsp/predict/forecast/input.js';

const seed = JSON.parse(await readFile(new URL('../../../../../server/gcsp/policy/seed-v1.json', import.meta.url)));
const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
const context = { runId: 'plan-input-parity', policyVersion: seed.policyVersion };
const read = { runId: context.runId, policyVersion: seed.policyVersion, asOf: '2026-11-06T00:00:00.000Z', horizonEnd: '2027-03-06T00:00:00.000Z' };
const catalog = (await createPolicyOrderPlanCatalog({ policy }).readCatalog(context, read)).value;
const entitlement = (n, ids) => ({ entitlementId: `ent-${n}`, employeeId: `emp-${n}`, renewalAt: '2027-01-20T00:00:00.000Z', acceptableDerivativeIds: ids });
const expressed = { cohortVersion: 'cohort-v1', forecast: { entitlements: [
  entitlement(1, ['g21-touring-320i', 'g20-saloon-320i']), entitlement(2, ['g61-i5-40']),
] }, predictionContext: { entitlements: [1, 2].map((n) => ({ entitlementId: `ent-${n}`,
  employee: { employeeId: `emp-${n}`, companyId: 'demo-bmw-fs-uk', schemeId: 'choices-fs-uk', gradeId: 'G1-6' },
  brief: { preferences: {}, essentials: {} } })) } };
const cases = [];
async function add(name, edit = () => {}) {
  const source = structuredClone({ expressed, catalog, read });
  edit(source);
  const expected = await createPredictionInput(context, { ...source, terms: createPolicyFutureTermsProvider({ policy }) });
  cases.push({ name, ...source, expected });
}
await add('valid-sorted-choices');
await add('required-month-in-UTC', (c) => { c.expressed.forecast.entitlements[0].requiredBy = '2027-02-01T00:30:00+01:00'; });
await add('explicit-null-requiredBy-is-invalid', (c) => { c.expressed.forecast.entitlements[0].requiredBy = null; });
await add('empty-choice-set', (c) => { c.expressed.forecast.entitlements.forEach((e) => { e.acceptableDerivativeIds = []; }); });
await add('missing-context-sources', (c) => { delete c.expressed.predictionContext; });
await add('missing-entitlement-context', (c) => { c.expressed.predictionContext.entitlements.shift(); });
await add('missing-catalog-configuration', (c) => { c.catalog.configurations = []; });
await add('invalid-brief', (c) => { c.expressed.predictionContext.entitlements[0].brief.preferences = 'invalid'; });
await add('terms-unavailable', (c) => { c.expressed.predictionContext.entitlements[0].employee.schemeId = 'unavailable'; });
await add('unknown-facts', (c) => { for (const v of c.catalog.configurations) for (const key of ['body', 'fuel', 'boot', 'seats']) v.facts[key] = { status: 'unknown', value: null }; });
await add('duplicate-choice-is-invalid', (c) => { c.expressed.forecast.entitlements[0].acceptableDerivativeIds.push('g20-saloon-320i'); });
await add('missing-derivative', (c) => { c.expressed.forecast.entitlements[0].acceptableDerivativeIds.push('missing'); });
await add('invalid-read-instant', (c) => { c.read.asOf = 'invalid'; });
const path = new URL('../resources/learning-parity/plan-input-cases.json', import.meta.url);
await writeFile(path, JSON.stringify({ source: 'server/gcsp/predict/forecast/input.js', cases }) + '\n');
console.log(`LEARNED-PLAN-INPUT-PARITY generated ${cases.length} cases`);
