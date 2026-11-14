// Writes Node readAccount goldens for FUCQ-458 Java parity. Run: see services/gcsp-api/README.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const m = (p) => import(root + p);
const { createMemoryRepository, createMemoryStore, inputDigest } = await m('server/gcsp/repository/index.js');
const { createPolicyService } = await m('server/gcsp/policy/index.js');
const { createDemoRuntime } = await m('server/gcsp/clock/index.js');
const { ManualContextService, createRepositoryManualPorts } = await m('server/gcsp/manual-context/index.js');
const { seedManualDemoContext } = await m('server/gcsp/manual-context/fixtures.js');
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const instant = '2026-11-05T09:00:00.000Z';
const policy = createPolicyService();
const repository = createMemoryRepository({ store: createMemoryStore(), now: () => instant }); await repository.open();
const runtime = await createDemoRuntime({ repository, policy, environmentId: 'manual-test', environmentKind: 'synthetic',
  policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
const { clock, identity } = runtime.value;
const presenter = await identity.createPresenterSession('presenter');
const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
const slotRef = (c) => ({ table: 'entitlement_slots', key: { runId: c.runId, entitlementSlotId: c.entitlementSlotId } });
async function changeSlot(c, patch, id) {
  return repository.transaction(c, { commandId: id, inputDigest: inputDigest(patch) }, async (tx) => {
    const found = await tx.get(slotRef(c)); const r = await tx.compareAndSwap(slotRef(c), found.value.version, patch);
    if (r.status !== 'ok') throw new Error(`${id}: ${JSON.stringify(r)}`); return r;
  });
}
async function write(name, context, note) {
  const f = { repository, policy, clock, identity, context };
  const svc = new ManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  const expected = await svc.readAccount(context);
  const emp = await repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
  const slots = await repository.query(context, 'entitlement_slots', { employeeId: context.employeeId });
  const read = { runId: context.runId, asOf: instant, policyVersion: context.policyVersion };
  const [rules, names, allowance] = await Promise.all([policy.getAssumption('manual.context.v1', read),
    policy.getAssumption('scheme.displayNames.v1', read), policy.getAllowance(context, read)]);
  writeFileSync(`${out}/${name}.json`, JSON.stringify({ note, now: instant,
    context: pick(context, ['environmentId', 'runId', 'employeeId', 'name', 'roles', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId', 'policyVersion']),
    input: { employeeVersion: emp.value?.version ?? null, manualContext: emp.value?.contract?.manualContext ?? null, slots: slots.value },
    policy: { manualContext: rules, schemeDisplayNames: names, allowance },
    expected }, null, 2) + '\n');
  console.log(name, expected.status, expected.value?.state ?? expected.code);
}
let switches = 0;
const as = async (who) => (await identity.switchPrincipal(presenter.value.context, `demo-${who}`, `switch-${switches += 1}`)).value.context;
const jordan = await as('jordan');
await write('jordan-absent', jordan, 'No HR record yet: absent-hr-account.');
for (const [who, note] of [['paula', 'Current contract: replace.'], ['jordan', 'No current car: order.'],
  ['alex', 'Different grade, current contract.'], ['sam', 'Scheme not enabled for manual ordering.']]) {
  const c = await as(who); await seedManualDemoContext({ repository, policy, clock, identity, context: c });
  await write(who, c, note);
}
const paula = await as('paula');
await changeSlot(paula, { contractId: 'current:missing' }, 'slot-missing-contract');
await write('paula-no-contract', paula, 'Slot names a contract the HR record lacks: no-contract.');
await changeSlot(paula, { contractId: `current:${paula.employeeId}`, state: 'disabled' }, 'slot-disabled');
await write('paula-slot-disabled', paula, 'Disabled entitlement slot: no-entitlement.');
async function changeRecords(c, change, id) {
  const ref = { table: 'employees', key: { runId: c.runId, employeeId: c.employeeId } };
  return repository.transaction(c, { commandId: id, inputDigest: inputDigest(id) }, async (tx) => {
    const found = await tx.get(ref); const next = structuredClone(found.value.contract.manualContext); change(next);
    const r = await tx.compareAndSwap(ref, found.value.version, { contract: { ...found.value.contract, manualContext: next } });
    if (r.status !== 'ok') throw new Error(`${id}: ${JSON.stringify(r)}`); return r;
  });
}
const alex = await as('alex');
await changeRecords(alex, (r) => { r.contracts[0].earliestCollectionDate = '2027-06-01'; r.contracts[0].latestCollectionDate = '2027-06-15'; }, 'window-future');
await write('alex-not-yet-eligible', alex, 'Contract window opens after the maximum lead: not-yet-eligible.');
await changeRecords(alex, (r) => { r.contracts[0].earliestCollectionDate = '2026-11-01'; r.contracts[0].latestCollectionDate = '2026-11-11'; }, 'window-closed');
await write('alex-ordering-closed', alex, 'Contract window ends before the minimum lead: ordering-closed.');
const sam = await as('sam');
await changeRecords(sam, (r) => { r.drivers.push(structuredClone(r.drivers[0])); }, 'driver-duplicate');
await write('sam-driver-invalid', sam, 'Duplicate driver ids: source failure, unavailable driver.');
await changeRecords(sam, (r) => { r.drivers.pop(); r.account.employeeId = 'employee-paula'; }, 'account-foreign');
await write('sam-account-foreign', sam, 'Record names another employee: source failure, never shown.');
