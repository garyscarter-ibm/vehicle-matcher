import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createCaseHttpAdapter } from '../../blocks/gcsp/cases/http-adapter.js';
import { fixtureAdapter, caseFixture, fixtureAccountAdapter } from '../../blocks/gcsp/cases/fixtures.js';
let help; let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://case.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements'])
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  help = await import('../../blocks/gcsp/cases/gcsp-help.js');
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };
const findButton = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function mount(name = 'none', adapter = fixtureAdapter(name)) {
  const root = host(); const destroy = help.mountHelpBody(root, { adapter, commandId: () => 'stable-command' });
  await tick(); return { root, destroy };
}
async function prepare(root, text = 'My replacement may miss the contract end.') {
  const disclosure = root.querySelector('details.gcsp-case-entry'); disclosure.open = true;
  findButton(root, 'Ask for help').click();
  const input = root.querySelector('textarea'); input.value = text; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  findButton(root, 'Review help request').click(); await tick();
}
test('opening help and review/cancel never writes; no-case entry explains its effect before confirmation', async () => {
  let writes = 0;
  const f = await mount('none', { ...fixtureAdapter('none'), requestHelp: async () => { writes += 1; } });
  assert.match(f.root.textContent, /No renewal case/);
  assert.equal(f.root.querySelector('details').open, false);
  await prepare(f.root);
  assert.match(f.root.textContent, /opens a scheme-team case or adds to your existing case/);
  assert.match(f.root.textContent, /No specific next car or greater priority is guaranteed/);
  assert.equal(writes, 0);
  findButton(f.root, 'Cancel').click(); assert.equal(writes, 0); f.destroy();
});
test('each employee state renders owner, reasons, dates, next action, remedy and dated actors using the shared kit', async () => {
  for (const name of ['request', 'trigger', 'in-progress', 'waiting', 'resolved', 'closed']) {
    const { root, destroy } = await mount(name);
    const c = caseFixture(name);
    assert.match(root.textContent, /Scheme team/); assert.match(root.textContent, new RegExp(c.reason));
    assert.match(root.textContent, /Review the renewal options with Paula/);
    assert.match(root.textContent, /Due, demo clock \(UTC\)/); assert.match(root.textContent, /2026-11-06 12:00:00 UTC/);
    assert.match(root.textContent, /Renewal deadline \(calendar date\)/); assert.match(root.textContent, /2026-11-20/);
    assert.match(root.textContent, /Dated case history/); assert.match(root.textContent, /synthetic-paula/);
    assert.ok(root.querySelector('.vm-facts')); assert.equal(root.querySelectorAll('h1').length, 1);
    if (name === 'waiting') { assert.match(root.textContent, /estate/); assert.match(root.textContent, /suv/); assert.match(root.textContent, /Waiting for your confirmation/); }
    assert.equal(root.textContent.includes('—'), false);
    destroy();
  }
});
test('loading, unavailable, forbidden and stale-run remain distinct and request failures never imply success', async () => {
  for (const [name, title] of [['loading', 'Loading your cases'], ['unavailable', 'Renewal help is unavailable'],
    ['forbidden', 'You cannot open these cases'], ['stale-run', 'Your demo run has changed']]) {
    const { root, destroy } = await mount(name); assert.match(root.textContent, new RegExp(title)); destroy();
  }
  const { root, destroy } = await mount('none', { ...fixtureAdapter('none'), requestHelp: async () => { throw Error('network'); } });
  await prepare(root); findButton(root, 'Confirm help request').click(); await tick();
  assert.match(root.textContent, /Renewal help is unavailable/); assert.doesNotMatch(root.textContent, /request was recorded/); destroy();
});
test('explicit request sends one payload, retains stable id after uncertain retry, and reloads actual cases', async () => {
  const calls = []; let saved = false; let reads = 0;
  const adapter = { ...fixtureAdapter('none'),
    async readCases() { reads += 1; return { status: 'ok', value: { cases: saved ? [caseFixture('request')] : [] } }; },
    async requestHelp(input) { calls.push(input); if (calls.length === 1) throw Error('uncertain'); saved = true;
      return { status: 'ok', value: { case: caseFixture('request') } }; } };
  const { root, destroy } = await mount('none', adapter);
  await prepare(root); findButton(root, 'Confirm help request').click(); await tick();
  assert.equal(calls.length, 1); assert.match(root.textContent, /unavailable/);
  assert.equal(document.activeElement, root.querySelector('.gcsp-case-status'));
  findButton(root, 'Confirm help request').click(); await tick(); await tick();
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], { commandId: 'stable-command', reason: 'My replacement may miss the contract end.' });
  assert.ok(reads >= 2); assert.match(root.textContent, /request was recorded/);
  assert.equal(document.activeElement, root.querySelector('.gcsp-case-status')); assert.ok(root.querySelector('[data-case-id]')); destroy();
});
test('preference change requires explicit review/confirm and passes server-projected version/path/value only', async () => {
  const calls = []; let c = caseFixture('waiting'); let reads = 0;
  const adapter = { ...fixtureAdapter('waiting'), async readCases() { reads += 1; return { status: 'ok', value: { cases: [structuredClone(c)] } }; },
    async changeAfterDecline(input) { calls.push(input); c.relaxation = { currentBriefVersion: 4, before: 'suv', applicable: false, confirmed: true }; return { status: 'ok', value: { brief: { briefVersion: 4 } } }; } };
  const { root, destroy } = await mount('waiting', adapter);
  findButton(root, 'Review body change').click(); assert.equal(calls.length, 0);
  assert.match(root.textContent, /estate → suv/); assert.match(root.textContent, /All other preferences, essentials and importance weights stay the same/);
  findButton(root, 'Confirm preference change').click(); await tick(); await tick();
  assert.deepEqual(calls, [{ decisionId: 'synthetic-decline', expectedBriefVersion: 3,
    change: { path: 'preferences.body.value', value: 'suv' }, commandId: 'stable-command' }]);
  assert.ok(reads >= 2); assert.match(root.textContent, /preference change was confirmed/); assert.match(root.textContent, /Remedy proposed/);
  assert.match(root.textContent, /You confirmed this preference change/); assert.doesNotMatch(root.textContent, /no longer matches/);
  assert.equal(findButton(root, 'Review body change'), undefined);
  assert.equal(document.activeElement, root.querySelector('.gcsp-case-status'));
  destroy();
});
test('stale preference proposals cannot be confirmed and stale write results require review', async () => {
  const c = caseFixture('waiting'); c.relaxation = { currentBriefVersion: 4, before: 'saloon', applicable: false };
  const { root, destroy } = await mount('waiting', { ...fixtureAdapter('waiting'), async readCases() { return { status: 'ok', value: { cases: [c] } }; } });
  assert.equal(findButton(root, 'Review body change').disabled, true); assert.equal(findButton(root, 'Confirm preference change'), undefined);
  assert.match(root.textContent, /no longer matches your current brief/); destroy();
  const other = await mount('none', { ...fixtureAdapter('none'), requestHelp: async () => ({ status: 'stale-version', reason: 'Refresh the current case.' }) });
  await prepare(other.root); findButton(other.root, 'Confirm help request').click(); await tick();
  assert.match(other.root.textContent, /The case or brief has changed/); assert.match(other.root.textContent, /Refresh the current case/); other.destroy();
});
test('unmount cancels owned work, late reads and replies cannot render or trigger a hidden write/readback', async () => {
  const late = deferred(); const root = host(); let signal;
  const destroy = help.mountHelpBody(root, { adapter: { ...fixtureAdapter('none'), async readCases(options) { signal = options.signal; return late.promise; } } });
  destroy(); assert.equal(signal.aborted, true); late.resolve({ status: 'ok', value: { cases: [caseFixture()] } }); await tick(); assert.equal(root.children.length, 0);
  const save = deferred(); let reads = 0; let writes = 0;
  const f = await mount('none', { ...fixtureAdapter('none'), async readCases() { reads += 1; return { status: 'ok', value: { cases: [] } }; },
    async requestHelp() { writes += 1; return save.promise; } });
  await prepare(f.root); const confirm = findButton(f.root, 'Confirm help request'); confirm.click(); await tick(); f.destroy();
  save.resolve({ status: 'ok', value: { case: caseFixture() } }); await tick(); confirm.click();
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(f.root.children.length, 0);
});
test('HTTP adapter includes credentials, sends no browser identity, rejects false success and preserves exact refusal', async () => {
  const calls = [];
  const adapter = createCaseHttpAdapter({ fetchImpl: async (url, options) => { calls.push([url, options]);
    return { ok: true, async json() { return { status: 'ok', value: { case: caseFixture() } }; } }; } });
  await adapter.requestHelp({ commandId: 'one', reason: 'Help', employeeId: 'forged', runId: 'forged' });
  assert.equal(calls[0][0], '/api/gcsp/cases'); assert.equal(calls[0][1].credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0][1].body), { commandId: 'one', reason: 'Help' });
  const invalid = createCaseHttpAdapter({ fetchImpl: async () => ({ ok: false, json: async () => ({ status: 'ok', value: { cases: [] } }) }) });
  assert.equal((await invalid.readCases()).status, 'unavailable');
  const refused = { status: 'forbidden', reason: 'Current employee session required.' };
  assert.deepEqual(await createCaseHttpAdapter({ fetchImpl: async () => ({ ok: false, json: async () => refused }) }).readCases(), refused);
});
test('element upgrades injected adapters, has body-only embedding, remount cleanup and actual account header', async () => {
  const element = document.createElement('gcsp-help'); element.setAttribute('embedded', ''); element.adapter = fixtureAdapter('none');
  document.body.append(element); help.defineGcspHelp(); await tick();
  assert.equal(element.adapter.readCases instanceof Function, true); assert.match(element.textContent, /No renewal case/); assert.equal(element.querySelector('main'), null); assert.equal(element.querySelector('h1'), null);
  assert.equal(element.querySelector('h2').textContent, 'Renewal help');
  element.remove(); assert.equal(element.children.length, 0);
  const actual = document.createElement('gcsp-help'); actual.adapter = fixtureAdapter('request');
  actual.accountAdapter = { async loadAccount() { return { status: 'ready', name: 'Canonical employee name', context: 'Canonical account context' }; } };
  document.body.append(actual); await tick(); await tick();
  assert.match(actual.querySelector('.gcsp-account-name').textContent, /Canonical employee name/);
  assert.equal(actual.querySelectorAll('main h1').length, 1); assert.match(actual.textContent, /Renewal help/);
  actual.remove();
});
test('new surfaces are embeddable, external-module-only, no inline handlers/unsafe execution or em-dash copy', () => {
  const folder = new URL('../../blocks/gcsp/cases/', import.meta.url);
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, folder), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(|new Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/, file);
    assert.doesNotMatch(source, /setAttribute\(\s*['"]on\w+/i, file); assert.equal(source.includes('—'), false, file);
  }
  const html = readFileSync(new URL('../../gcsp-help.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\son\w+\s*=|<script(?![^>]*\bsrc=)[^>]*>\s*\S/i);
  assert.match(html, /<gcsp-help/); assert.match(html, /cases\/harness.js/);
});

test('authoritative access failures disable new requests, and direct host heading overrides preserve nesting', async () => {
  for (const status of ['forbidden', 'stale-run']) {
    const f = await mount('request', { ...fixtureAdapter('request'), requestHelp: async () => ({ status, reason: 'Reopen the current employee session.' }) });
    await prepare(f.root); findButton(f.root, 'Confirm help request').click();
    assert.equal(document.activeElement, f.root.querySelector('.gcsp-case-status'));
    await tick();
    assert.equal(findButton(f.root, 'Ask for help').disabled, true);
    assert.equal(findButton(f.root, 'Confirm help request'), undefined);
    assert.equal(document.activeElement, f.root.querySelector('.gcsp-case-status')); f.destroy();
  }
  const root = host(); const destroy = help.mountHelpBody(root, { adapter: fixtureAdapter('waiting'), headingLevel: 3 }); await tick();
  assert.equal(root.querySelector('h1,h2'), null); assert.equal(root.querySelector('h3').textContent, 'Renewal help');
  assert.equal(root.querySelector('article h4').textContent, 'Remedy proposed'); destroy();
});
