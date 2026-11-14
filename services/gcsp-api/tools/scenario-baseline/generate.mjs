// Writes the synthetic demo preparation file (FUCQ-479) from the Node fixtures. Offline only: switchPrincipal is
// never used at runtime. Run: see services/gcsp-api/README.md. Needs no node_modules (pg is stubbed).
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../node-baseline/pg-stub.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const m = (p) => import(root + p);
const { createMemoryRepository, createMemoryStore } = await m('server/gcsp/repository/index.js');
const { createPolicyService } = await m('server/gcsp/policy/index.js');
const { createDemoRuntime } = await m('server/gcsp/clock/index.js');
const { seedManualDemoContext } = await m('server/gcsp/manual-context/fixtures.js');
const { loadDemoPrincipalSeed } = await m('server/gcsp/fixtures/principals.js');
const { loadScenarioCatalogue } = await m('server/gcsp/fixtures/scenarios/index.js');
const out = process.argv[2];
const instant = '2026-11-05T09:00:00.000Z';
const policy = createPolicyService();
const repository = createMemoryRepository({ store: createMemoryStore(), now: () => instant }); await repository.open();
const runtime = await createDemoRuntime({ repository, policy, environmentId: 'scenario-baseline', environmentKind: 'synthetic',
  policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
const { identity } = runtime.value; const clock = runtime.value.clock;
const presenter = (await identity.createPresenterSession('presenter')).value.context;
const run = (await repository.currentRun('scenario-baseline')).value;
const read = { runId: run.runId, asOf: instant, policyVersion: run.policyVersion };
const seed = await loadDemoPrincipalSeed(policy, read);
const principals = [];
for (const p of seed.value.principals.filter((x) => x.roles.includes('employee'))) {
  const context = (await identity.switchPrincipal(presenter, p.principalId, `switch-${p.principalId}`)).value.context;
  await seedManualDemoContext({ repository, policy, clock, identity, context });
  const employee = (await repository.read(context, { table: 'employees', key: { runId: run.runId, employeeId: p.employeeId } })).value;
  const slots = (await repository.query(context, 'entitlement_slots', { employeeId: p.employeeId })).value;
  const attributes = ({ employeeId, entitlementSlotId, capacity, runId, version, createdAt, updatedAt, ...rest }) => rest;
  principals.push({ employeeId: p.employeeId, name: p.name, roles: p.roles, companyId: p.companyId, schemeId: p.schemeId,
    gradeId: p.gradeId, entitlementSlotId: p.entitlementSlotId, record: employee.contract.manualContext, recordVersion: employee.version,
    slots: slots.map((s) => ({ slotId: s.entitlementSlotId, capacity: s.capacity, attributes: attributes(s), version: s.version })) });
}
const catalogue = (await loadScenarioCatalogue({ policy, read })).value;
const keep = ['scenarioId', 'name', 'kind', 'ownerStory', 'epics', 'stories', 'scenarioVersion', 'fixtureVersion', 'principalIds', 'requiredCapabilities', 'steps', 'variants', 'inputs'];
const everyone = seed.value.principals.map(({ principalId, employeeId, name, roles }) => ({ principalId, employeeId, name, roles }));
writeFileSync(out, JSON.stringify({ schemaVersion: 1, preparationVersion: 'demo-preparation-v1',
  label: 'Synthetic demo preparation, fictional people',
  generatedFrom: { generator: 'services/gcsp-api/tools/scenario-baseline/generate.mjs', policyVersion: run.policyVersion,
    sourceCommit: execSync('git rev-parse HEAD', { cwd: root }).toString().trim() },
  capacity: seed.value.capacity, principals,
  catalogue: { catalogueVersion: catalogue.catalogueVersion, directory: everyone,
    scenarios: catalogue.scenarios.map((s) => Object.fromEntries(keep.map((k) => [k, s[k]]))) } }, null, 1) + '\n');
console.log('principals', principals.length, 'scenarios', catalogue.scenarios.length);
