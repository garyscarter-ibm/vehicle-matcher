import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
let panel; let transport; let gallery; let element; let dashboard; let fixtures; let demandTransport;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
before(async () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) globalThis[key] = key === 'window' ? window : window[key];
  panel = await import('../../blocks/gcsp/greg/publish/panel.js');
  transport = await import('../../blocks/gcsp/greg/publish/http-adapter.js');
  gallery = await import('../../blocks/gcsp/greg/publish/gallery.js');
  element = await import('../../blocks/gcsp/greg/publish/element.js');
  dashboard = await import('../../blocks/gcsp/greg/gcsp-greg.js');
  fixtures = await import('../../blocks/gcsp/greg/fixtures.js');
  demandTransport = await import('../../blocks/gcsp/greg/http-adapter.js');
});
beforeEach(() => document.body.replaceChildren());
const host = () => { const node = document.createElement('div'); document.body.append(node); return node; };
const action = (root, text) => [...root.querySelectorAll('button')].find((node) => node.textContent === text);
const state = (root) => root.querySelector('.gcsp-publish').dataset.state;
const edit = (input, value) => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
function published(input, extra = {}) {
  return { accepted: true, policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom, publisher: 'greg',
    activationRequired: false, activation: { status: 'active', policyVersion: input.policyVersion, publishedVersionActive: true },
    heldOffers: { count: 2, message: '2 held offers keep their earlier terms.' }, ...extra };
}
async function setup(overrides = {}, policy = gallery.galleryPolicy()) {
  const calls = { read: 0, preview: [], publish: [] };
  const adapter = {
    async readPolicy() { calls.read += 1; return { status: 'ready', value: structuredClone(policy) }; },
    async preview(input) { calls.preview.push(structuredClone(input)); return { status: 'ready', value: gallery.galleryPreview(input, policy) }; },
    async publish(input) { calls.publish.push(structuredClone(input)); return { status: 'ready', value: published(input) }; }, ...overrides,
  };
  const root = host(); const teardown = panel.mountGregPublish(root, { adapter, commandId: () => 'stable-command' });
  await tick(); return { root, teardown, calls, adapter, policy };
}
async function preview(root) {
  edit(root.querySelector('.gcsp-publish input'), '1200'); action(root, 'Preview changes').click(); await tick();
}

test('draft uses projected fields, native integer constraints, units/provenance, and a disabled publish gate', async () => {
  const { root, calls } = await setup();
  assert.equal(state(root), 'draft'); assert.equal(root.querySelectorAll('input[type=number]').length, 7);
  for (const input of root.querySelectorAll('input')) { assert.equal(input.min, '0'); assert.equal(input.step, '1'); assert.ok(input.labels.length); }
  assert.match(root.textContent, /points\/month/); assert.match(root.textContent, /Synthetic component gallery/);
  assert.equal(action(root, 'Publish this preview').disabled, true); assert.equal(calls.publish.length, 0);
});

test('switching the native price selector preserves every pending edit with one points input', async () => {
  const policy = gallery.galleryPolicy(); policy.fields.unshift({ ...policy.fields[0], id: 'price:second', key: 'second', configurationId: 'Second car', value: 900 });
  const { root, calls } = await setup({}, policy); const points = root.querySelector('input'); const select = root.querySelector('select');
  edit(points, '950'); select.value = 'price:gallery-cost'; select.dispatchEvent(new window.Event('change')); edit(points, '1250');
  select.value = 'price:second'; select.dispatchEvent(new window.Event('change'));
  assert.equal(points.value, '950'); assert.equal(root.querySelector('input'), points);
  action(root, 'Preview changes').click(); await tick();
  assert.deepEqual(calls.preview[0].changes, [{ id: 'price:second', value: 950 }, { id: 'price:gallery-cost', value: 1250 }]);
});

test('explicit current preview shows differences and privacy bands, and editing invalidates it', async () => {
  const { root, calls } = await setup(); const input = root.querySelector('input'); input.focus();
  await preview(root);
  assert.equal(state(root), 'preview-ready'); assert.equal(document.activeElement, input); assert.equal(root.querySelector('input'), input);
  assert.match(root.textContent, /Preview only/); assert.match(root.textContent, /Changed values in this preview/);
  assert.match(root.textContent, /Unknown \(privacy bands\)/); assert.match(root.textContent, /Suppressed for privacy/);
  assert.equal(action(root, 'Publish this preview').disabled, false);
  edit(input, '1300'); assert.equal(action(root, 'Publish this preview').disabled, true);
  assert.equal(root.querySelectorAll('table').length, 0); assert.equal(calls.publish.length, 0);
});

test('preview-loading and publishing keep mounted inputs and only publish the exact reviewed changes', async () => {
  const request = deferred(); const save = deferred(); let publication;
  const { root, policy } = await setup({ preview: () => request.promise, publish: (input) => { publication = input; return save.promise; } });
  const input = root.querySelector('input'); edit(input, '1200'); action(root, 'Preview changes').click();
  assert.equal(state(root), 'preview-loading'); assert.equal(root.querySelector('input'), input);
  request.resolve({ status: 'ready', value: gallery.galleryPreview({ changes: [{ id: policy.fields[0].id, value: 1200 }] }, policy) }); await tick();
  action(root, 'Publish this preview').click(); assert.equal(state(root), 'publishing'); assert.equal(root.querySelector('input'), input);
  assert.deepEqual(publication.changes, [{ id: 'price:gallery-cost', value: 1200 }]); assert.equal(publication.effectiveFrom, policy.asOf);
  save.resolve({ status: 'ready', value: published(publication) }); await tick(); assert.equal(state(root), 'published');
});

for (const invalid of ['', '-1', '1.5', '9007199254740992']) test(`invalid integer ${JSON.stringify(invalid)} links its field and focuses summary`, async () => {
  const { root, calls } = await setup(); const input = root.querySelector('input'); edit(input, invalid); action(root, 'Preview changes').click();
  assert.equal(calls.preview.length, 0); assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.match(input.getAttribute('aria-describedby'), /error/); assert.equal(document.activeElement, root.querySelector('.gcsp-error-summary h2'));
  root.querySelector('.gcsp-error-summary a').click(); assert.equal(document.activeElement, input);
});

test('an invalid hidden price row is selected and focused from the error summary', async () => {
  const policy = gallery.galleryPolicy(); policy.fields.unshift({ ...policy.fields[0], id: 'price:second', key: 'second', configurationId: 'Second car' });
  const { root } = await setup({}, policy); const input = root.querySelector('input'); edit(input, '-1');
  const select = root.querySelector('select'); select.value = 'price:gallery-cost'; select.dispatchEvent(new window.Event('change'));
  action(root, 'Preview changes').click(); root.querySelector('.gcsp-error-summary a').click();
  assert.equal(select.value, 'price:second'); assert.equal(input.value, '-1'); assert.equal(document.activeElement, input);
});

test('each invalid price summary link selects its own row while retaining the real native focus target', async () => {
  const policy = gallery.galleryPolicy(); policy.fields.unshift({ ...policy.fields[0], id: 'price:second', key: 'second', configurationId: 'Second car' });
  const { root, calls } = await setup({}, policy); const input = root.querySelector('input'); const select = root.querySelector('select');
  edit(input, '-1'); select.value = 'price:gallery-cost'; select.dispatchEvent(new window.Event('change')); edit(input, '1.5');
  action(root, 'Preview changes').click(); const links = root.querySelectorAll('.gcsp-error-summary a');
  assert.equal(links.length, 2); assert.equal(calls.preview.length, 0);
  for (const [index, id, value] of [[1, 'price:gallery-cost', '1.5'], [0, 'price:second', '-1']]) {
    assert.equal(links[index].getAttribute('href'), `#${input.id}`); links[index].click();
    assert.equal(select.value, id); assert.equal(input.value, value); assert.equal(document.activeElement, input);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
  }
});

test('shared error summary passes field and row identity while one-argument and default consumers still work', async () => {
  const { errorSummary } = await import('../../blocks/gcsp/kit/form-controls.js');
  const input = document.createElement('input'); input.id = 'kit-field'; document.body.append(input); const seen = [];
  const rows = errorSummary({ id: 'kit-rows', errors: [{ id: input.id, selectionId: 'price:second', message: 'Bad' }], onSelect: (...args) => seen.push(args) });
  const single = errorSummary({ id: 'kit-single', errors: [{ id: input.id, message: 'Bad' }], onSelect: (id) => seen.push([id]) });
  const fallback = errorSummary({ id: 'kit-default', errors: [{ id: input.id, message: 'Bad' }] });
  document.body.append(rows.root, single.root, fallback.root);
  rows.root.querySelector('a').click(); single.root.querySelector('a').click();
  assert.deepEqual(seen, [[input.id, 'price:second'], [input.id]]);
  fallback.root.querySelector('a').click(); assert.equal(document.activeElement, input);
});

test('price switching updates visible and accessible slider row, units, bounds and provenance without replacing inputs', async () => {
  const policy = gallery.galleryPolicy({ ranges: true });
  policy.fields.unshift({ ...structuredClone(policy.fields[0]), id: 'price:second', key: 'second', configurationId: 'Second car',
    unit: 'second-points/month', presentationRange: { ...policy.fields[0].presentationRange, maximum: 5000, source: 'synthetic:second-range' } });
  const { root } = await setup({}, policy); const input = root.querySelector('input[type=number]'); const slider = root.querySelector('input[type=range]');
  const label = slider.labels[0]; assert.match(label.textContent, /Second car/); assert.match(slider.getAttribute('aria-valuetext'), /second-points\/month/);
  const select = root.querySelector('select'); select.value = 'price:gallery-cost'; select.dispatchEvent(new window.Event('change'));
  assert.equal(root.querySelector('input[type=number]'), input); assert.equal(root.querySelector('input[type=range]'), slider);
  assert.match(label.textContent, /Gallery car/); assert.doesNotMatch(label.textContent, /Second car/);
  assert.equal(slider.getAttribute('aria-label'), label.textContent); assert.equal(slider.max, '4000');
  assert.doesNotMatch(slider.getAttribute('aria-valuetext'), /second-points/);
  assert.match(slider.closest('.gcsp-publish-control').textContent, /4,000 points\/month/);
  assert.doesNotMatch(slider.closest('.gcsp-publish-control').textContent, /synthetic:second-range/);
});

test('unchanged values do not request a preview', async () => {
  const { root, calls } = await setup(); action(root, 'Preview changes').click();
  assert.equal(calls.preview.length, 0); assert.match(root.textContent, /Change at least one/);
});

test('network uncertainty retains the original command/version/effective date and locks fresh actions', async () => {
  const inputs = []; let attempts = 0;
  const { root } = await setup({ async publish(input) { inputs.push(structuredClone(input)); attempts += 1;
    return attempts === 1 ? { status: 'unavailable' } : { status: 'ready', value: published(input) }; } });
  await preview(root); const input = root.querySelector('input'); action(root, 'Publish this preview').click(); await tick();
  assert.equal(state(root), 'unavailable'); assert.equal(input.disabled, true); assert.equal(action(root, 'Refresh policy').disabled, true);
  action(root, 'Retry original publication').click(); await tick(); assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(inputs[0].commandId, 'stable-command'); assert.equal(state(root), 'published');
  assert.match(root.textContent, /greg-stable-command/); assert.match(root.textContent, /2 held offers keep their earlier terms/);
});

test('saved pending activation is accurately shown and retries the original publication', async () => {
  const inputs = []; let attempts = 0; const events = [];
  const { root } = await setup({ async publish(input) { inputs.push(structuredClone(input)); attempts += 1;
    return { status: 'ready', value: published(input, attempts === 1 ? { activationRequired: true, activation: { status: 'pending', policyVersion: input.policyVersion } } : {}) }; } });
  root.addEventListener('gcsp:policy-published', (e) => events.push({ ...e.detail, bubbles: e.bubbles, composed: e.composed }));
  await preview(root); action(root, 'Publish this preview').click(); await tick();
  assert.match(root.textContent, /Saved, waiting for activation/); assert.equal(action(root, 'Retry original publication').hidden, false);
  action(root, 'Retry original publication').click(); await tick(); assert.deepEqual(inputs[0], inputs[1]);
  assert.deepEqual(events.map((e) => e.activation), ['pending', 'active']); assert.ok(events.every((e) => e.bubbles && e.composed));
});

test('known rejection gives reasons, disables publish and permits a fresh read', async () => {
  const { root, calls } = await setup({ async publish() { return { status: 'rejected', message: 'Stale active version. Refresh policy and preview again.' }; } });
  await preview(root); action(root, 'Publish this preview').click(); await tick();
  assert.equal(state(root), 'rejected'); assert.match(root.textContent, /Stale active version/);
  assert.equal(action(root, 'Publish this preview').disabled, true); action(root, 'Refresh policy').click(); await tick(); assert.equal(calls.read, 2);
});

test('non-Greg refusal hides controls and initial unavailable has a useful working retry', async () => {
  let reads = 0;
  const { root } = await setup({ async readPolicy() { reads += 1; return reads === 1 ? { status: 'unavailable', message: 'Try again' }
    : { status: 'refused', message: 'Only Greg can publish.' }; } });
  assert.equal(state(root), 'unavailable'); action(root, 'Refresh policy').click(); await tick();
  assert.equal(state(root), 'refused'); assert.match(root.textContent, /Only Greg/); assert.equal(root.querySelectorAll('input').length, 0);
});

test('malformed projected policy, privacy response and mismatched preview never enable publishing', async () => {
  const malformed = gallery.galleryPolicy(); malformed.fields[0].value = -2;
  const bad = await setup({}, malformed); assert.equal(state(bad.root), 'unavailable');
  const policy = gallery.galleryPolicy(); const value = gallery.galleryPreview({ changes: [{ id: policy.fields[0].id, value: 1200 }] }, policy);
  value.active.fit.meanBestScore.value = 88;
  const hidden = await setup({ async preview() { return { status: 'ready', value }; } }); await preview(hidden.root);
  assert.equal(action(hidden.root, 'Publish this preview').disabled, true); assert.doesNotMatch(hidden.root.textContent, /88/);
  const mismatch = await setup({ async preview(input) { return { status: 'ready', value: { ...gallery.galleryPreview(input), activeVersion: 'wrong-version' } }; } });
  await preview(mismatch.root); assert.equal(action(mismatch.root, 'Publish this preview').disabled, true);
});

test('a stale preview response and a response after teardown cannot overwrite newer edits', async () => {
  const request = deferred(); const { root, teardown, policy } = await setup({ preview: () => request.promise });
  const input = root.querySelector('input'); edit(input, '1200'); action(root, 'Preview changes').click();
  edit(input, '1300'); request.resolve({ status: 'ready', value: gallery.galleryPreview({ changes: [{ id: policy.fields[0].id, value: 1200 }] }, policy) }); await tick();
  assert.equal(state(root), 'draft'); assert.equal(input.value, '1300'); assert.equal(action(root, 'Publish this preview').disabled, true);
  const next = deferred(); const other = await setup({ readPolicy: () => next.promise }); other.teardown();
  next.resolve({ status: 'ready', value: policy }); await tick(); assert.equal(other.root.children.length, 0); teardown();
});

test('standalone custom element disconnect/reconnect aborts the old mount and supports two independent embeddings', async () => {
  element.defineGcspGregPublish(); const pending = deferred(); let calls = 0;
  const adapter = { async readPolicy() { calls += 1; return calls === 1 ? pending.promise : { status: 'ready', value: gallery.galleryPolicy() }; } };
  const node = document.createElement('gcsp-greg-publish'); node.adapter = adapter; document.body.append(node); node.remove(); document.body.append(node); await tick();
  pending.resolve({ status: 'refused' }); await tick(); assert.equal(state(node), 'draft'); assert.equal(calls, 2);
  const second = document.createElement('gcsp-greg-publish'); second.adapter = adapter; document.body.append(second); await tick();
  const ids = [...document.querySelectorAll('input')].map((n) => n.id); assert.equal(new Set(ids).size, ids.length);
});

test('HTTP adapter uses actual bounded routes, cookies, no-store and exact bodies without identity selectors', async () => {
  const requests = []; const policy = gallery.galleryPolicy(); const input = { expectedActiveVersion: policy.activeVersion, changes: [{ id: policy.fields[0].id, value: 1200 }] };
  const publishedInput = { ...input, commandId: 'command', policyVersion: 'next', effectiveFrom: policy.asOf };
  const adapter = transport.createGregPublishHttpAdapter({ base: '/demo', async fetchImpl(url, options) {
    requests.push({ url, options }); return { status: 200, async json() { return { status: 'ok', value: url.endsWith('/policy') ? policy
      : url.endsWith('/preview') ? gallery.galleryPreview(input) : published(publishedInput) }; } }; } });
  assert.equal((await adapter.readPolicy()).status, 'ready'); assert.equal((await adapter.preview(input)).status, 'ready'); assert.equal((await adapter.publish(publishedInput)).status, 'ready');
  assert.deepEqual(requests.map((r) => r.url), ['/demo/api/gcsp/greg/policy', '/demo/api/gcsp/greg/policy/preview', '/demo/api/gcsp/greg/policy/publish']);
  assert.ok(requests.every((r) => r.options.credentials === 'include' && r.options.cache === 'no-store'));
  assert.equal(requests[0].options.body, undefined); assert.deepEqual(JSON.parse(requests[1].options.body), input); assert.deepEqual(JSON.parse(requests[2].options.body), publishedInput);
});

test('HTTP failure mapping preserves meaningful rejection/refusal and treats malformed success as uncertain', async () => {
  assert.equal(transport.policyOutcome(403, {}, 'publish').status, 'refused');
  assert.match(transport.policyOutcome(409, { status: 'stale-version', reason: 'Policy changed' }, 'preview').message, /Policy changed.*Refresh/);
  assert.equal(transport.policyOutcome(200, { status: 'ok', value: {} }, 'publish').status, 'unavailable');
  assert.equal(transport.policyOutcome(400, { status: 'invalid', reasons: {} }, 'preview').status, 'rejected');
  const adapter = transport.createGregPublishHttpAdapter({ fetchImpl: async () => { throw Error('offline'); } }); assert.equal((await adapter.publish({})).status, 'unavailable');
});

test('actual Greg HTTP host composition mounts policy, preserves caseQueue and refreshes demand without remounting the panel', async () => {
  const demand = await fixtures.fixtureAdapter('populated').loadDemand(); const policy = gallery.galleryPolicy(); let demands = 0;
  const adapter = demandTransport.createGregHttpAdapter({ async fetchImpl(url, options) {
    if (url.endsWith('/demand')) demands += 1;
    const input = options.body ? JSON.parse(options.body) : null;
    return { status: 200, async json() { return { status: 'ok', value: url.endsWith('/demand') ? demand.projection
      : url.endsWith('/policy') ? policy : url.endsWith('/preview') ? gallery.galleryPreview(input) : published(input) }; } };
  } });
  dashboard.defineGcspGregDashboard(); const node = document.createElement('gcsp-greg-dashboard'); node.adapter = adapter;
  const caseQueue = document.createElement('div'); caseQueue.textContent = 'Existing case queue';
  node.addEventListener('gcsp:ready', () => node.regions.caseQueue.replaceChildren(caseQueue)); document.body.append(node); await tick();
  const panelRoot = node.querySelector('.gcsp-publish'); const points = panelRoot.querySelector('input');
  assert.ok(panelRoot); await preview(node); action(node, 'Publish this preview').click(); await tick(); await tick();
  assert.equal(demands, 2); assert.equal(node.querySelector('.gcsp-publish'), panelRoot); assert.equal(panelRoot.querySelector('input'), points);
  assert.equal(node.regions.caseQueue.firstChild, caseQueue);
  node.adapter = adapter; await tick(); assert.equal(node.regions.caseQueue.firstChild, caseQueue);
  const programmatic = host(); const destroy = dashboard.mountGregDashboard(programmatic, { ...adapter }); await tick();
  assert.ok(programmatic.querySelector('.gcsp-publish'), 'presenter workspace adapter spread composes policy'); destroy();
});

test('named demand fixtures do not silently call live policy', async () => {
  dashboard.defineGcspGregDashboard(); const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url) => { if (/greg\/policy/.test(url)) calls += 1; throw Error('offline presenter controls'); };
  try { const node = document.createElement('gcsp-greg-dashboard'); node.setAttribute('fixture', 'populated'); document.body.append(node); await tick();
    assert.equal(node.querySelector('.gcsp-publish'), null); assert.equal(calls, 0); node.remove(); } finally { globalThis.fetch = old; }
});

test('panel and registration have no inline handlers, HTML injection, eval or external endpoints', () => {
  for (const file of ['panel.js', 'element.js', 'http-adapter.js', 'register.js', 'gallery.js']) {
    const source = readFileSync(new URL(`../../blocks/gcsp/greg/publish/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function|setAttribute\(['"]on|https?:\/\//);
  }
});

test('actual delivered memory runtime and registered HTTP routes drive the browser adapter through preview and publish', async (t) => {
  const { createGcspRuntime } = await import('../gcsp/runtime.js');
  const { startHttpServer } = await import('./helpers/employee-recommendation-http.js');
  const now = '2026-11-05T09:00:00.000Z';
  // Greg's demand read needs the reviewed decline registry; seed it rather than adopt, so publish at `now` stays valid.
  const { PolicyService, MemoryPolicyProvider } = await import('../gcsp/policy/index.js');
  const { getReviewedDefinitionSet } = await import('../gcsp/policy/reviewed-definitions.js');
  const source = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
  const reasons = getReviewedDefinitionSet('offer-decline-reasons-v1').definitions.find((d) => d.key === 'offer.declineReasons.v1');
  source.assumptions.push({ ...source.assumptions[0], key: reasons.key, value: reasons.value, unit: reasons.unit, status: reasons.status, basis: reasons.basis });
  const runtimeResult = await createGcspRuntime({ mode: 'memory', environmentId: 'publish-panel-http', policyAsOf: now,
    commandId: 'panel-bootstrap', sessionNow: () => now, policy: new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [source]; } } }) }) });
  assert.equal(runtimeResult.status, 'ok'); const runtime = runtimeResult.value;
  t.after(() => runtime.close());
  const session = await runtime.createLocalSession(); assert.equal(session.status, 'ok');
  const http = await startHttpServer(runtime.dependencies); t.after(() => http.close());
  const switched = await http.request('/api/gcsp/session/switch', { session, body: { principalId: 'demo-greg', commandId: 'panel-greg' } });
  assert.equal(switched.status, 200); const greg = { value: { setCookie: switched.headers.get('set-cookie') } };
  const requests = [];
  const adapter = transport.createGregPublishHttpAdapter({ async fetchImpl(path, options) {
    requests.push(path); const response = await http.request(path, { session: greg, method: options.method,
      ...(options.body ? { body: JSON.parse(options.body) } : {}) });
    return { status: response.status, json: async () => response.json };
  } });
  const projection = await adapter.readPolicy(); assert.equal(projection.status, 'ready', JSON.stringify(projection));
  const field = projection.value.fields.find((f) => f.kind === 'weight');
  const input = { expectedActiveVersion: projection.value.activeVersion, changes: [{ id: field.id, value: field.value + 1 }] };
  const projected = await adapter.preview(input); assert.equal(projected.status, 'ready', JSON.stringify(projected));
  const result = await adapter.publish({ ...input, commandId: 'actual-panel-command', policyVersion: 'actual-panel-v2', effectiveFrom: projected.value.asOf });
  assert.equal(result.status, 'ready', JSON.stringify(result)); assert.equal(result.value.activation.status, 'active');
  assert.equal((await adapter.readPolicy()).value.activeVersion, 'actual-panel-v2');
  assert.deepEqual(requests.slice(0, 3), ['/api/gcsp/greg/policy', '/api/gcsp/greg/policy/preview', '/api/gcsp/greg/policy/publish']);
});

test('shared single sliders use projected bounds and synchronize exact edits without replacing either input', async () => {
  const policy = gallery.galleryPolicy({ ranges: true }); const { root, calls } = await setup({}, policy);
  const exact = root.querySelector('input[type=number]'); const slider = root.querySelector('input[type=range]');
  assert.equal(root.querySelectorAll('input[type=range]').length, 7); assert.equal(slider.max, '4000');
  edit(slider, '1250'); assert.equal(exact.value, '1250');
  edit(exact, '1500'); assert.equal(slider.value, '1500');
  exact.focus(); assert.equal(root.querySelector('input[type=number]'), exact); assert.equal(root.querySelector('input[type=range]'), slider);
  action(root, 'Preview changes').click(); await tick(); assert.equal(calls.preview[0].changes[0].value, 1500);
  assert.match(root.textContent, /one changed value/);
});

test('exact legal values outside the presentation range remain truthful and are never clamped by slider rendering', async () => {
  const policy = gallery.galleryPolicy({ ranges: true }); policy.fields[0].value = 5000;
  const { root, calls } = await setup({}, policy); const exact = root.querySelector('input[type=number]'); const slider = root.querySelector('input[type=range]');
  assert.equal(exact.value, '5000'); assert.equal(slider.closest('.gcsp-publish-slider').hidden, true);
  assert.match(root.textContent, /Exact value 5000 is outside/);
  edit(exact, String(Number.MAX_SAFE_INTEGER)); action(root, 'Preview changes').click(); await tick();
  assert.equal(calls.preview[0].changes[0].value, Number.MAX_SAFE_INTEGER); assert.equal(exact.value, String(Number.MAX_SAFE_INTEGER));
  edit(exact, '1000'); assert.equal(slider.closest('.gcsp-publish-slider').hidden, false); assert.equal(slider.value, '1000');
});

test('canonical projected slider-range changes update all controls while missing ranges truthfully fall back to exact inputs', async () => {
  const policy = gallery.galleryPolicy({ ranges: true });
  for (const field of policy.fields) field.presentationRange.maximum = field.kind === 'price' ? 4500 : 12;
  const { root } = await setup({}, policy);
  assert.deepEqual([...root.querySelectorAll('input[type=range]')].map((i) => i.max), ['4500', ...Array(6).fill('12')]);
  const fallback = await setup(); assert.equal(fallback.root.querySelector('input[type=range]'), null);
  assert.match(fallback.root.textContent, /Slider ranges are not supplied by this policy/);
});


test('a refusal after an uncertain publication retains the unchanged command for recovery', async () => {
  const commands = []; let attempt = 0;
  const { root } = await setup({ async publish(input) { commands.push(structuredClone(input)); attempt += 1;
    return attempt === 1 ? { status: 'unavailable' } : attempt === 2 ? { status: 'refused', message: 'Reopen Greg session.' }
      : { status: 'ready', value: published(input) }; } });
  await preview(root); action(root, 'Publish this preview').click(); await tick();
  action(root, 'Retry original publication').click(); await tick();
  assert.equal(state(root), 'refused'); assert.equal(action(root, 'Retry original publication').hidden, false);
  action(root, 'Retry original publication').click(); await tick();
  assert.deepEqual(commands[0], commands[1]); assert.deepEqual(commands[1], commands[2]); assert.equal(state(root), 'published');
});

test('new scoped CSS keeps shared tokens and scoped selectors with no raw palette or motion', () => {
  const css = readFileSync(new URL('../../blocks/gcsp/greg/publish/publish.css', import.meta.url), 'utf8');
  const stripped = css.replace(/@import[^;]+;/g, '').replace(/@media[^{]*\{/g, '');
  const selectors = [...stripped.matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
  assert.ok(selectors.every((s) => s.startsWith('.gcsp')));
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(|animation:|transition:/i);
});

test('a 401 with no status (lapsed access key) reads access-required; a status keeps its refusal', async () => {
  const respond = (status, body) => async () => ({ status, async json() { if (body === undefined) throw new SyntaxError('bad'); return body; } });
  for (const action of ['readPolicy', 'preview', 'publish']) for (const body of [{ error: 'Unauthorized' }, undefined, null]) assert.deepEqual(transport.policyOutcome(401, body, action), { status: 'access-required' });
  for (const body of [{ error: 'Unauthorized' }, undefined]) {
    const adapter = transport.createGregPublishHttpAdapter({ fetchImpl: respond(401, body) });
    assert.deepEqual(await adapter.readPolicy(), { status: 'access-required' }); assert.deepEqual(await adapter.publish({}), { status: 'access-required' });
  }
  assert.equal(transport.policyOutcome(403, { error: 'Forbidden' }, 'publish').status, 'refused');
  assert.equal(transport.policyOutcome(401, { status: 'missing-session' }, 'publish').status, 'refused');
  assert.equal((await transport.createGregPublishHttpAdapter({ fetchImpl: respond(403, undefined) }).readPolicy()).status, 'unavailable');
});

test('a lapsed access key shows the compact restart notice with Reload instead of the policy form', async () => {
  const first = await setup({ readPolicy: async () => ({ status: 'access-required' }) });
  assert.equal(state(first.root), 'restarted'); assert.match(first.root.querySelector('[role="alert"]').textContent, /Reload the page to continue/);
  assert.equal(first.root.querySelectorAll('input').length, 0); assert.doesNotMatch(first.root.textContent, /Policy unavailable/); first.teardown();
  const later = await setup({ preview: async () => ({ status: 'access-required' }) }); await preview(later.root);
  assert.equal(state(later.root), 'restarted'); assert.equal(later.root.querySelector('.gcsp-publish-form').hidden, true);
  const reload = action(later.root, 'Reload'); assert.ok(reload); assert.equal(action(later.root, 'Retry'), undefined); later.teardown();
});

test('policy and published facts show readable dates, never raw ISO timestamps', async () => {
  const { root, calls } = await setup();
  assert.match(root.textContent, /Effective from.*5 Nov 2026, 09:00 GMT/); assert.match(root.textContent, /Demo time.*5 Nov 2026, 10:00 GMT/);
  await preview(root); action(root, 'Publish this preview').click(); await tick();
  assert.equal(calls.publish.length, 1); assert.match(root.textContent, /Effective from.*5 Nov 2026, 10:00 GMT/);
  assert.doesNotMatch(root.textContent, /\d{4}-\d{2}-\d{2}T\d{2}:/);
});
