// FUCQ-138: Greg's stored route comparison, adapter mapping, view model, panel states, element and dashboard mounting (jsdom, no port).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

let panel; let fixtures; let adapterMod; let view; let element; let dash; let stored;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 4; i += 1) await tick(); };
before(async () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException', 'MutationObserver']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key] ?? globalThis[key], configurable: true, writable: true });
  }
  panel = await import('../../blocks/gcsp/greg/comparison/panel.js');
  fixtures = await import('../../blocks/gcsp/greg/comparison/fixtures.js');
  adapterMod = await import('../../blocks/gcsp/greg/comparison/http-adapter.js');
  view = await import('../../blocks/gcsp/greg/comparison/comparison-view.js');
  element = await import('../../blocks/gcsp/greg/comparison/element.js');
  dash = await import('../../blocks/gcsp/greg/gcsp-greg.js');
  stored = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-process-result.json', import.meta.url), 'utf8')).storedResult;
});
beforeEach(() => document.body.replaceChildren());

const host = () => { const node = document.createElement('div'); node.className = 'gcsp'; document.body.append(node); return node; };
const text = (root) => root.textContent.replace(/\s+/g, ' ');
const state = (root) => root.querySelector('.gcsp-comparison').dataset.state;
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const spy = (name, overrides = {}) => {
  const inner = fixtures.comparisonFixtureAdapter(name); const calls = { load: 0 };
  return { calls, adapter: { load: (o) => { calls.load += 1; return inner.load(o); }, ...overrides } };
};
async function mount(name, options = {}, overrides = {}) {
  const { adapter, calls } = spy(name, overrides); const root = host();
  const teardown = panel.mountGregComparison(root, { adapter, ...options });
  await settle(); return { root, teardown, calls };
}
const measure = (root, label) => [...root.querySelectorAll('.gcsp-comparison-measure')].find((m) => m.querySelector('h3').textContent === label);

test('outcomeToState maps ready, empty, refused, lapsed access, server failure and malformed bodies', () => {
  const ok = { status: 'ok', value: { result: { kind: 'process-comparison' }, policyVersion: 'v1' } };
  assert.deepEqual(adapterMod.outcomeToState(200, ok), { status: 'ready', stored: ok.value });
  assert.deepEqual(adapterMod.outcomeToState(404, { status: 'not-found' }), { status: 'empty' });
  assert.deepEqual(adapterMod.outcomeToState(403, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.outcomeToState(401, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.outcomeToState(401, {}), { status: 'access-required' });
  assert.deepEqual(adapterMod.outcomeToState(401, null), { status: 'access-required' });
  for (const [code, body] of [[500, { status: 'error' }], [503, { status: 'unavailable' }], [200, null], [200, { status: 'ok' }], [200, { status: 'ok', value: { result: { kind: 'other' } } }],
    [200, { status: 'ok', value: [] }], [404, { status: 'other' }]]) assert.deepEqual(adapterMod.outcomeToState(code, body), { status: 'unavailable' }, `${code}`);
});

test('the HTTP adapter reads the latest route with credentials and maps network failure to unavailable', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { status: 404, json: async () => ({ status: 'not-found' }) }; };
  const adapter = adapterMod.createComparisonHttpAdapter({ base: 'https://x.test', fetchImpl });
  assert.deepEqual(await adapter.load({}), { status: 'empty' });
  assert.equal(seen.url, 'https://x.test/api/gcsp/comparison/process/latest'); assert.equal(seen.init.credentials, 'include'); assert.equal(seen.init.method, 'GET');
  const down = adapterMod.createComparisonHttpAdapter({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await down.load({}), { status: 'unavailable' });
  const { createGregHttpAdapter } = await import('../../blocks/gcsp/greg/http-adapter.js');
  assert.equal(typeof createGregHttpAdapter({ fetchImpl }).comparison.load, 'function');
});

test('toComparisonView gives one formatted row per stored difference and throws on malformed input', () => {
  const v = view.toComparisonView(stored);
  assert.deepEqual(v.measures.map((m) => m.key), stored.result.differences.map((d) => d.measure));
  assert.deepEqual(v.measures.map((m) => m.label), ['Covered before renewal', 'Cars never allocated', 'Car time held but not taken', 'Offers declined', 'Offers expired',
    'Holds that expired untaken', 'Retries after a lost claim', 'Calculated fit of accepted cars', 'Covered before renewal: mechanics access']);
  const coverage = v.measures[0];
  assert.deepEqual(coverage.rows.map((r) => r.label), ["Today's release route", 'Buddy route']);
  assert.equal(coverage.format(0.083333), '8.3%'); assert.equal(coverage.format(0), '0%'); assert.equal(coverage.format(0.25), '25%');
  assert.equal(coverage.verdictText, 'No clear difference'); assert.equal(coverage.hint, 'Higher is better');
  assert.equal(coverage.differenceText, 'Difference (buddy minus today): +8.3 pts (0 pts to +25 pts)');
  assert.deepEqual(coverage.scale, { min: 0, max: 1 });
  assert.equal(v.measures[1].differenceText, 'Difference (buddy minus today): -0.3 (-1 to 0)'); assert.equal(v.measures[1].format(4), '4');
  assert.equal(v.measures[1].hint, 'Lower is better');
  assert.equal(v.measures[7].verdictText, 'Too few seeds to compare'); assert.equal(v.measures[7].differenceText, 'Difference (buddy minus today): Not observed');
  assert.equal(v.measures[7].format(null), 'Not observed'); assert.equal(v.measures[7].format(100), '100.0');
  assert.equal(v.measures[2].kind, 'hours'); assert.equal(v.measures[2].format(0.003704), '0.1 h'); assert.equal(v.measures[2].format(0.5), '12 h');
  assert.deepEqual(v.meta, { seeds: 3, policyVersion: 'gcsp-policy-v1', made: v.meta.made, employees: 4, codeRevision: 'fucq136-test' });
  assert.match(v.meta.made, /^8 Nov 2026, 12:00/); assert.equal(v.oldPolicy, null);
  assert.equal(v.assumptions.length, stored.result.assumptions.length); assert.equal(v.assumptions[0].status, 'Assumed');
  assert.equal(v.assumptions.find((a) => a.key === 'hold.buddy.durationSeconds').value, '7200');
  assert.match(v.assumptions.find((a) => a.key === 'comparison.noClearDifferenceRule').value, /^\{"schemaVersion":1/);
  assert.equal(v.provenance.policyHash, '90da819d8ae5');
  assert.equal(v.limitations.includes(v.caveat), false); assert.ok(v.limitations.some((l) => /re-offers its car at once/.test(l)));
  for (const bad of [null, {}, { ...stored, result: { ...stored.result, kind: 'other' } }, { ...stored, result: { ...stored.result, differences: 'x' } }, { ...stored, policyVersion: '' },
    { ...stored, result: { ...stored.result, differences: [{ ...stored.result.differences[0], verdict: 'winner' }] } },
    { ...stored, result: { ...stored.result, differences: [{ ...stored.result.differences[0], current: null }] } },
    { ...stored, result: { ...stored.result, manifest: null } }]) assert.throws(() => view.toComparisonView(bad), TypeError);
});

test('the no-clear-difference fixture is the stored result file, and the other fixtures are fixtures of the same shape', () => {
  assert.deepEqual(fixtures.FIXTURE_VALUES['no-clear-difference'](), stored);
  for (const name of ['buddy-better', 'today-better', 'old-policy']) {
    const v = view.toComparisonView(fixtures.FIXTURE_VALUES[name]()); assert.equal(v.measures.length, stored.result.differences.length);
    assert.match(fixtures.FIXTURE_VALUES[name]().resultId, /fixture/);
  }
  assert.equal(fixtures.comparisonFixtureAdapter('nope'), null);
});

test('ready shows the title, meta, the caveat outside the details, the measures and what the replay leaves out', async () => {
  const { root } = await mount('no-clear-difference');
  assert.equal(state(root), 'ready');
  assert.equal(root.querySelector('h2').textContent, 'Route comparison');
  assert.match(text(root.querySelector('.gcsp-comparison-head')), /Stored result of the process comparison\. Both routes get the same employees, cars and releases\./);
  const facts = text(root.querySelector('.gcsp-comparison-facts'));
  assert.match(facts, /Seeds\s*3/); assert.match(facts, /Policy version\s*gcsp-policy-v1/); assert.match(facts, /Made\s*8 Nov 2026/); assert.match(facts, /Employees\s*4/);
  const caveat = root.querySelector('.gcsp-comparison-caveat');
  assert.equal(caveat.textContent, 'Calculated fit is not observed satisfaction.'); assert.equal(caveat.closest('details'), null);
  assert.equal(caveat.previousElementSibling, root.querySelector('.gcsp-comparison-facts'));
  const blocks = root.querySelectorAll('.gcsp-comparison-measure'); assert.equal(blocks.length, 9);
  assert.equal(root.querySelectorAll('figure.gcsp-range-bar').length, 9);
  const coverage = measure(root, 'Covered before renewal');
  assert.equal(coverage.querySelectorAll('.gcsp-range-bar-row').length, 2); assert.equal(coverage.querySelector('.gcsp-range-bar-heading').tagName, 'H4');
  assert.match(text(coverage), /Today's release route0%/); assert.match(text(coverage), /Buddy route8\.3% \(0% to 25%\)/);
  assert.match(text(coverage), /Difference \(buddy minus today\): \+8\.3 pts \(0 pts to \+25 pts\)/); assert.match(text(coverage), /No clear difference/); assert.match(text(coverage), /Higher is better/);
  assert.match(text(measure(root, 'Offers declined')), /Lower is better/);
  assert.match(text(measure(root, 'Calculated fit of accepted cars')), /Too few seeds to compare/);
  assert.match(text(measure(root, 'Calculated fit of accepted cars')), /Today's release routeNot observed/);
  assert.ok(measure(root, 'Covered before renewal: mechanics access'));
  const leaves = [...root.querySelectorAll('h3')].find((h) => h.textContent === 'What this replay leaves out').parentElement;
  assert.ok([...leaves.querySelectorAll('li')].some((li) => /After an offer expires the live service re-offers its car at once/.test(li.textContent)));
  assert.equal(leaves.closest('details'), null);
  assert.equal(root.querySelector('.gcsp-comparison-notice'), null);
  assert.equal(root.querySelector('.gcsp-comparison').getAttribute('aria-busy'), null);
});

test('assumptions, seeds and provenance sit in a closed native details with one table row per assumption', async () => {
  const { root } = await mount('no-clear-difference');
  const details = root.querySelector('details'); assert.ok(details); assert.equal(details.open, false);
  assert.equal(details.querySelector('summary').textContent, 'Assumptions, seeds and provenance');
  const table = details.querySelector('table'); assert.equal(table.caption.textContent, 'Assumptions used');
  assert.deepEqual([...table.tHead.rows[0].cells].map((c) => c.textContent), ['Setting', 'Key', 'Value', 'Unit', 'Status', 'Basis']);
  assert.equal(table.tBodies[0].rows.length, stored.result.assumptions.length);
  assert.ok([...table.tBodies[0].rows].every((r) => r.cells[4].textContent === 'Assumed'));
  const facts = text(details.querySelector('.vm-facts'));
  for (const label of ['Seeds', 'Policy version', 'Policy hash', 'Generator version', 'Code revision', 'Result id', 'Made', 'Stored']) assert.match(facts, new RegExp(label));
  assert.match(facts, /comparison-a, comparison-b, comparison-c/); assert.match(facts, /90da819d8ae5(?![0-9a-f])/);
  const value = fixtures.FIXTURE_VALUES['no-clear-difference'](); value.result.assumptions[0].status = 'verified';
  const verified = host(); panel.mountGregComparison(verified, { adapter: { load: async () => adapterMod.outcomeToState(200, { status: 'ok', value }) } }); await settle();
  assert.equal(verified.querySelector('tbody tr').cells[4].textContent, 'Verified');
  details.open = true; details.dispatchEvent(new window.Event('toggle')); await button(root, 'Reload').click(); await settle();
  assert.equal(root.querySelector('details').open, true);
});

test('a buddy win, no clear difference and a baseline win use identical classes and the same plain verdict text', async () => {
  const buddy = (await mount('buddy-better')).root; const today = (await mount('today-better')).root; const none = (await mount('no-clear-difference')).root;
  assert.match(text(measure(buddy, 'Covered before renewal')), /Buddy route better/);
  assert.match(text(measure(buddy, 'Cars never allocated')), /Buddy route better/);
  assert.match(text(measure(today, 'Covered before renewal')), /Today's release route better/);
  assert.match(text(measure(today, 'Offers declined')), /Today's release route better/);
  assert.match(text(measure(today, 'Offers declined')), /Difference \(buddy minus today\): \+2\.3 \(\+2 to \+3\)/);
  assert.match(text(measure(none, 'Covered before renewal')), /No clear difference/);
  const classes = (root) => [...root.querySelectorAll('.gcsp-comparison-measure *')].map((n) => `${n.tagName}.${n.className}`).join('|');
  assert.equal(classes(buddy), classes(today)); assert.equal(classes(buddy), classes(none));
  assert.ok(![...buddy.querySelectorAll('[class]')].some((n) => /buddy|better|win/i.test(n.className)));
});

test('an older policy version is labelled with both versions and what to do', async () => {
  const { root } = await mount('old-policy');
  const notice = root.querySelector('.gcsp-comparison-notice');
  assert.match(notice.textContent, /Older policy version/);
  assert.match(notice.textContent, /Made under policy gcsp-policy-v1\. The active policy is gcsp-policy-v2\. Prepare a new comparison to use it\./);
  assert.equal((await mount('no-clear-difference')).root.querySelector('.gcsp-comparison-notice'), null);
});

test('no stored comparison says it is prepared offline, shows no command, and Reload reads again', async () => {
  const { root, calls } = await mount('empty');
  assert.equal(state(root), 'empty'); assert.equal(root.querySelector('h2').textContent, 'No stored comparison yet');
  assert.equal(root.querySelector('code'), null); assert.doesNotMatch(text(root), /node scripts|gcsp-comparison\.mjs/);
  assert.match(text(root), /prepared offline and has not been run here\. Reload to check again\./);
  assert.equal(root.querySelector('table'), null); assert.equal(calls.load, 1);
  button(root, 'Reload').click(); await settle(); assert.equal(calls.load, 2);
});

test('unavailable offers Retry, refused offers nothing, a lapsed key sends to the access form, and a malformed payload is unavailable', async () => {
  let fail = true; const { root, calls } = await mount('no-clear-difference', {}, { load: async () => (fail ? { status: 'unavailable' } : adapterMod.outcomeToState(200, { status: 'ok', value: fixtures.FIXTURE_VALUES['no-clear-difference']() })) });
  assert.equal(state(root), 'unavailable'); assert.match(text(root), /The stored comparison could not be loaded\. Try again in a moment\./); assert.equal(calls.load, 0);
  fail = false; button(root, 'Retry').click(); await settle(); assert.equal(state(root), 'ready'); assert.equal(button(root, 'Retry'), undefined);
  const refused = (await mount('refused')).root;
  assert.equal(state(refused), 'refused'); assert.match(text(refused), /Only the scheme ordering lead or the presenter can see the route comparison\./);
  assert.equal(refused.querySelectorAll('button').length, 0); assert.equal(refused.querySelector('table'), null);
  const lapsed = (await mount('refused', {}, { load: async () => ({ status: 'access-required' }) })).root;
  assert.equal(state(lapsed), 'access-required'); assert.match(lapsed.querySelector('[role="alert"]').textContent, /Demo access needed/);
  assert.ok(lapsed.querySelector('a[href^="/gcsp/access"]'));
  const bad = (await mount('refused', {}, { load: async () => ({ status: 'ready', stored: { result: { kind: 'process-comparison' } } }) })).root;
  assert.equal(state(bad), 'unavailable'); assert.equal(bad.querySelector('.gcsp-comparison-measure'), null);
  const none = (await mount('refused', {}, { load: async () => { throw new Error('boom'); } })).root; assert.equal(state(none), 'unavailable');
});

test('loading is busy until aborted, then the late answer is ignored; Reload keeps focus on the button', async () => {
  const loading = await mount('loading'); assert.equal(state(loading.root), 'loading'); assert.equal(loading.root.querySelector('.gcsp-comparison').getAttribute('aria-busy'), 'true');
  loading.teardown(); assert.equal(loading.root.children.length, 0);
  const { root, teardown, calls } = await mount('no-clear-difference');
  const reload = button(root, 'Reload'); reload.focus(); assert.equal(document.activeElement, reload);
  reload.click(); assert.equal(root.querySelector('.gcsp-comparison').getAttribute('aria-busy'), 'true'); await settle();
  assert.equal(calls.load, 2); assert.equal(document.activeElement, button(root, 'Reload')); assert.equal(root.querySelector('.gcsp-comparison').getAttribute('aria-busy'), null);
  const empty = await mount('empty'); const again = button(empty.root, 'Reload'); again.focus(); again.click(); await settle();
  assert.equal(document.activeElement, button(empty.root, 'Reload'));
  await teardown.refresh(); await settle(); assert.equal(calls.load, 3);
  const abort = new AbortController(); const aborted = host(); const t = panel.mountGregComparison(aborted, { adapter: fixtures.comparisonFixtureAdapter('loading'), signal: abort.signal });
  abort.abort(); await settle(); assert.equal(aborted.querySelector('.gcsp-comparison').dataset.state, 'loading'); t();
});

test('every fixture state has no em dashes, inline handlers or scripts', async () => {
  for (const name of fixtures.FIXTURE_NAMES) {
    const { root } = await mount(name); const html = root.innerHTML;
    assert.ok(!html.includes('—'), `${name} has an em dash`); assert.ok(!/\son[a-z]+\s*=/i.test(html), `${name} has an inline handler`); assert.ok(!/<script/i.test(html), `${name} has a script`);
    assert.ok(!text(root).includes('—'));
  }
});

test('the custom element mounts from a fixture or an adapter and tears down', async () => {
  assert.equal(element.defineGcspGregComparison(window.customElements), element.defineGcspGregComparison(window.customElements));
  const node = document.createElement('gcsp-greg-comparison'); node.setAttribute('fixture', 'buddy-better'); document.body.append(node); await settle();
  assert.ok(node.classList.contains('gcsp')); assert.equal(node.querySelector('.gcsp-comparison').dataset.state, 'ready');
  const bad = document.createElement('gcsp-greg-comparison'); bad.setAttribute('fixture', 'nope'); document.body.append(bad); await settle();
  assert.equal(bad.querySelector('.gcsp-comparison').dataset.state, 'unavailable');
  const direct = document.createElement('gcsp-greg-comparison'); direct.adapter = fixtures.comparisonFixtureAdapter('empty'); document.body.append(direct); await settle();
  assert.equal(direct.querySelector('.gcsp-comparison').dataset.state, 'empty'); direct.remove(); assert.equal(direct.children.length, 0);
});

test('the dashboard mounts the comparison into its route-comparison region, and leaves the reserved note without an adapter', async () => {
  const { adapter, calls } = spy('buddy-better'); const root = host();
  const demand = (await import('../../blocks/gcsp/greg/fixtures.js')).fixtureAdapter('populated');
  const teardown = dash.mountGregDashboard(root, { loadDemand: demand.loadDemand, comparisonAdapter: adapter }); await settle();
  const region = teardown.regions.routeComparison;
  assert.equal(region.getAttribute('aria-label'), 'Route comparison'); assert.equal(region.hasAttribute('aria-labelledby'), false);
  assert.ok(region.querySelector('.gcsp-comparison')); assert.equal(region.textContent.includes('not built'), false);
  assert.equal(typeof teardown.comparison.refresh, 'function'); assert.equal(calls.load, 1);
  assert.match(teardown.regions.prediction.textContent, /not built in this demo yet/);
  teardown(); assert.equal(root.children.length, 0);
  const bare = host(); const plain = dash.mountGregDashboard(bare, { loadDemand: demand.loadDemand }); await settle();
  assert.equal(plain.comparison, null); assert.match(plain.regions.routeComparison.textContent, /not built in this demo yet/); plain();
  dash.defineGcspGregDashboard(window.customElements); const node = document.createElement('gcsp-greg-dashboard');
  node.adapter = { comparison: fixtures.comparisonFixtureAdapter('today-better'), loadDemand: demand.loadDemand };
  document.body.append(node); await settle();
  assert.ok(node.regions.routeComparison.querySelector('.gcsp-comparison-measure')); node.remove();
});

const headline = (root) => root.querySelector('.gcsp-comparison-headline');
const withAdapter = async (value) => {
  const root = host(); panel.mountGregComparison(root, { adapter: { load: async () => ({ status: 'ready', stored: value }) } }); await settle(); return root;
};

test('FUCQ-295: a headline sentence leads the body and says which route did better, from the stored coverage', async () => {
  for (const [name, sentence] of [
    ['buddy-better', "Buddy route did better: it covered 50% before renewal, against 12.5% on today's release route, across 3 seeds."],
    ['today-better', "Today's release route did better: it covered 75% before renewal, against 25% on the buddy route, across 3 seeds."],
    ['no-clear-difference', "No clear difference: the buddy route covered 8.3% before renewal and today's release route 0%, across 3 seeds."]]) {
    const { root } = await mount(name);
    assert.equal(headline(root).textContent, sentence, name);
    assert.equal(headline(root).nextElementSibling, root.querySelector('.gcsp-comparison-facts'), name);
    assert.doesNotMatch(headline(root).tagName, /^H/);
  }
});

test('FUCQ-295: the committed process-only result says today\'s release route did better, with its figures and seeds', async () => {
  const file = JSON.parse(await readFile(new URL('../data/gcsp/comparison/process-only.json', import.meta.url), 'utf8'));
  const value = { result: file.result, policyVersion: file.result.manifest.policyVersion };
  const sentence = "Today's release route did better: it covered 14.8% before renewal, against 11.8% on the buddy route, across 3 seeds.";
  assert.equal(view.toComparisonView(value).headline, sentence);
  assert.equal(headline(await withAdapter(value)).textContent, sentence);
});

test('FUCQ-295: headline wording for too few seeds, one seed and a missing coverage measure', () => {
  const base = fixtures.FIXTURE_VALUES['buddy-better']();
  const few = structuredClone(base); few.result.differences.find((d) => d.measure === 'acceptableCoverage').verdict = 'insufficient-seeds';
  assert.equal(view.toComparisonView(few).headline, "Too few seeds to say which route did better: the buddy route covered 50% before renewal and today's release route 12.5%, across 3 seeds.");
  const one = structuredClone(base); one.result.manifest.seeds = ['comparison-a'];
  assert.match(view.toComparisonView(one).headline, /across 1 seed\.$/);
  const missing = structuredClone(base); missing.result.differences = missing.result.differences.filter((d) => d.measure !== 'acceptableCoverage');
  assert.match(view.toComparisonView(missing).headline, /^Buddy route better on \d+ of 8 measures, today's release route on \d+, across 3 seeds\.$/);
  const unseen = structuredClone(base); unseen.result.differences.find((d) => d.measure === 'acceptableCoverage').current.mean = null;
  assert.match(view.toComparisonView(unseen).headline, /^Buddy route better on 3 of 9 measures/);
});

test('FUCQ-295: both rows of a range bar share the grid columns, and a track never shrinks below 6rem', async () => {
  const css = await readFile(new URL('../../blocks/gcsp/kit/range-bar.css', import.meta.url), 'utf8');
  const rule = (selector) => css.split('\n').find((line) => line.startsWith(`.gcsp ${selector} {`)) ?? '';
  assert.match(rule('.gcsp-range-bar-rows'), /display: grid;.*grid-template-columns: minmax\(6rem, 1fr\) auto/);
  assert.match(rule('.gcsp-range-bar-row'), /grid-template-columns: subgrid/);
  assert.doesNotMatch(css, /minmax\(0, 2fr\)/);
});

test('FUCQ-295: small car time reads in hours and large car time in days, never as 0.004', async () => {
  const { root } = await mount('no-clear-difference');
  const small = text(measure(root, 'Car time held but not taken'));
  assert.match(small, /Today's release route0\.1 h/); assert.match(small, /Difference \(buddy minus today\): \+0\.2 h/);
  assert.doesNotMatch(small, /0\.00|days/);
  const file = JSON.parse(await readFile(new URL('../data/gcsp/comparison/process-only.json', import.meta.url), 'utf8'));
  const big = await withAdapter({ result: file.result, policyVersion: file.result.manifest.policyVersion });
  assert.match(text(measure(big, 'Car time held but not taken')), /Buddy route64\.4 days/);
  assert.doesNotMatch(text(measure(big, 'Car time held but not taken')), / h[ )]/);
});
