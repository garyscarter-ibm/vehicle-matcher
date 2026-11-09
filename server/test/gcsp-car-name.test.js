// FUCQ-279: one car display-name rule, read from policy.displayLabels.v1, used at every source an employee screen reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService } from '../gcsp/policy/index.js';
import { carDisplayName, readCarNamer } from '../gcsp/policy/car-name.js';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';

const MODELS = { 'G21 Touring': '3 Series Touring {engine}', 'F70 Sports Hatch': '1 Series Sports Hatch {engine}', 'G61 i5': '{engine} Touring' };
const read = { runId: 'car-name', asOf: '2026-11-06T12:00:00.000Z', policyVersion: 'gcsp-policy-v1' };

test('the template fills {engine} from the model key and takes the BMW prefix', () => {
  assert.equal(carDisplayName(MODELS, 'G21 Touring|320i'), 'BMW 3 Series Touring 320i');
  assert.equal(carDisplayName(MODELS, 'F70 Sports Hatch|120', 'ignored'), 'BMW 1 Series Sports Hatch 120');
  assert.equal(carDisplayName(MODELS, 'G61 i5|i5 40'), 'BMW i5 40 Touring');
});

test('an unknown engine trims the template; an engine-led template needs its engine', () => {
  assert.equal(carDisplayName(MODELS, 'G21 Touring'), 'BMW 3 Series Touring');
  assert.equal(carDisplayName(MODELS, 'G21 Touring|  '), 'BMW 3 Series Touring');
  assert.equal(carDisplayName(MODELS, 'G61 i5', 'i5 Touring'), 'BMW i5 Touring');
  assert.equal(carDisplayName(MODELS, 'G61 i5'), null);
});

test('a model key with no template falls back to the plain model-line name, then to nothing', () => {
  assert.equal(carDisplayName(MODELS, 'G99 Unknown|x', '1 Series Sports Hatch'), 'BMW 1 Series Sports Hatch');
  assert.equal(carDisplayName(MODELS, 'G99 Unknown|x', 'BMW Plain'), 'BMW Plain');
  assert.equal(carDisplayName(MODELS, 'G99 Unknown|x'), null);
  assert.equal(carDisplayName(undefined, undefined, 'Plain'), 'BMW Plain');
  assert.equal(carDisplayName({}, 'constructor|1'), null);
});

test('the namer reads templates through PolicyService; an unavailable policy leaves only fallbacks', async () => {
  const name = await readCarNamer(createPolicyService(), read);
  assert.equal(name('G21 Touring|320i'), 'BMW 3 Series Touring 320i');
  assert.equal(name('F70 Sports Hatch|120'), 'BMW 1 Series Sports Hatch 120');
  const none = await readCarNamer({ getAssumption: async () => { throw new Error('down'); } }, read);
  assert.equal(none('G21 Touring|320i'), null); assert.equal(none('G21 Touring|320i', '3 Series Touring 320i'), 'BMW 3 Series Touring 320i');
});

async function demoCars(policy = createPolicyService()) {
  const out = await createDemoStockProvider({ policy }).pull({ runId: 'car-name', asOf: read.asOf, policyVersion: read.policyVersion,
    released: [], releaseSize: 10, queuedSupply: [] });
  assert.equal(out.status, 'ok'); return out.value.stock;
}

test('demo stock names follow the rule with no Synthetic wording or chassis codes', async () => {
  const name = await readCarNamer(createPolicyService(), read);
  const cars = await demoCars(); assert.ok(cars.length >= 4);
  for (const car of cars) {
    const { display, facts } = car.facts; const key = facts.eligibilityModelKey.value;
    assert.equal(display.name, name(key === 'G61 i5|i5 40' ? 'G61 i5|i5 eDrive40' : key), key); // the i5 names its engine in full
    assert.doesNotMatch(display.name, /Synthetic|Fictional|\b[FGUI]\d{2}\b/);
    if (display.images) assert.equal(display.images[0].alt, `${display.name}: representative image`);
  }
  assert.deepEqual(cars.map((car) => car.facts.display.name).filter((n, i, all) => all.indexOf(n) === i).sort(),
    ['BMW 1 Series Sports Hatch 120', 'BMW 3 Series Saloon 320i', 'BMW 3 Series Touring 320i', 'BMW i5 eDrive40 Touring']);
});

test('without a policy the demo cars fall back to their plain model and derivative', async () => {
  const cars = await demoCars({ getAssumption: async (key, r) => (key === 'policy.displayLabels.v1' ? { status: 'unavailable' } : createPolicyService().getAssumption(key, r)) });
  const touring = cars.find((car) => car.facts.facts.eligibilityModelKey.value === 'G21 Touring|320i');
  assert.equal(touring.facts.display.name, 'BMW 3 Series Touring 320i');
});

test('the current car on the account and offer comparison reads as the rule names it', async () => {
  const policy = createPolicyService(); const instant = '2026-11-05T09:00:00.000Z';
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => instant }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'car-name', environmentKind: 'synthetic', policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const context = (await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula')).value.context;
  const f = { repository, policy, clock, identity, context };
  assert.equal((await seedManualDemoContext(f)).status, 'ok');
  const account = await new ManualContextService({ ...f, ports: createRepositoryManualPorts(f) }).readAccount(context);
  assert.equal(account.status, 'ok');
  const expected = (await readCarNamer(policy, { runId: context.runId, asOf: instant, policyVersion: 'gcsp-policy-v1' }))('G21 Touring|320i');
  assert.equal(expected, 'BMW 3 Series Touring 320i');
  assert.equal(account.value.contracts[0].model, expected);
  assert.doesNotMatch(JSON.stringify(account.value.contracts), /Fictional BMW|Synthetic 3/);
});
