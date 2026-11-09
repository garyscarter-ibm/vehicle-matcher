import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createCaseHttpAdapter } from '../../blocks/gcsp/cases/http-adapter.js';
import { fixtureAdapter, caseFixture, fixtureAccountAdapter } from '../../blocks/gcsp/cases/fixtures.js';
import { queueFixtureAdapter, queueOptionsFixture, queueCaseFixtures } from '../../blocks/gcsp/cases/queue-fixtures.js';
import { renderCaseContent } from '../../blocks/gcsp/cases/case-content.js';
let help; let queue; let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://case.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements'])
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  help = await import('../../blocks/gcsp/cases/gcsp-help.js');
  queue = await import('../../blocks/gcsp/cases/gcsp-case-queue.js');
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
    assert.match(root.textContent, /Dated case history/); assert.match(root.textContent, /Actor(You|Automatic check)/);
    assert.match(root.textContent, name === 'trigger' ? /Opened fromRenewal deadline approaching/ : /Opened fromHelp request/);
    assert.match(root.textContent, /OwnerScheme team/); assert.doesNotMatch(root.textContent, /Owner role/);
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


async function mountQueue(adapter = queueFixtureAdapter(), options = {}) {
  const root = host(); const destroy = queue.mountCaseQueue(root, { adapter, commandId: () => 'stable-update', ...options });
  await tick(); return { root, destroy };
}
function queueField(root, name, value, event = 'input') {
  const input = root.querySelector(`[id$="-${name}"]`);
  assert.ok(input, `queue field ${name}`); input.value = value; input.dispatchEvent(new window.Event(event, { bubbles: true })); return input;
}
async function openQueue(root, caseId = 'synthetic-case-0') {
  queueField(root, 'selection', caseId, 'change'); findButton(root, 'Open selected case').click(); await tick();
}
function reviewQueue(root, remedyKey = '') {
  queueField(root, 'status', 'remedy-proposed', 'change');
  queueField(root, 'reason', 'Discussed the available remedy.');
  queueField(root, 'nextAction', 'Contact the employee.'); queueField(root, 'dueAt', '2026-11-07T09:30:05');
  if (remedyKey) queueField(root, 'remedyKey', remedyKey, 'change');
}
test('queue renders all statuses and canonical facts with deadline/status sorting and an unchanged shared table', async () => {
  const { root, destroy } = await mountQueue();
  const table = root.querySelector('table'); assert.ok(table); assert.equal(table.querySelectorAll('tbody tr').length, 5);
  assert.match(root.textContent, /Renewal deadline \(calendar date\)/); assert.match(root.textContent, /Next action due, demo clock \(UTC\)/);
  assert.match(root.textContent, /Synthetic employee 1/); assert.match(root.textContent, /Help request/);
  assert.match(root.textContent, /My replacement may miss my contract end/); assert.match(root.textContent, /Scheme team/);
  assert.match(root.textContent, /2026-11-06 12:00:00 UTC/);
  assert.equal(table.querySelector('tbody th').textContent, 'Synthetic employee 3');
  queueField(root, 'sort', 'status', 'change');
  assert.deepEqual([...root.querySelectorAll('tbody tr')].map((r) => r.children[4].textContent), ['Open', 'In progress', 'Remedy proposed', 'Resolved', 'Closed']);
  const tie = queueCaseFixtures().slice(0, 2).map((c) => ({ ...c, renewalDeadline: null }));
  assert.equal(queue.sortCases([tie[0], { ...tie[1], renewalDeadline: '2026-11-06' }])[0].caseId, tie[1].caseId);
  assert.equal(root.querySelectorAll('h1').length, 1); destroy();
});
const sortRow = (id, status, renewalDeadline) => ({ ...queueCaseFixtures()[0], caseId: id, status, renewalDeadline });
test('sortCases ranks active cases first by deadline, missing deadlines last, and status order follows the workflow', () => {
  const mixed = [sortRow('closed-early', 'closed', '2026-11-01'), sortRow('resolved-early', 'resolved', '2026-11-02'), sortRow('open-late', 'open', '2026-12-01'),
    sortRow('proposed-mid', 'remedy-proposed', '2026-11-10'), sortRow('open-none', 'open', null), sortRow('progress-mid', 'in-progress', '2026-11-10'),
    sortRow('odd-status', 'mystery', '2026-11-10')];
  const ids = (order) => queue.sortCases(mixed, order).map((c) => c.caseId);
  assert.deepEqual(ids('deadline'), ['progress-mid', 'proposed-mid', 'odd-status', 'open-late', 'open-none', 'closed-early', 'resolved-early']);
  assert.deepEqual(ids('status'), ['open-late', 'open-none', 'progress-mid', 'proposed-mid', 'odd-status', 'resolved-early', 'closed-early']);
});
test('queue renders mixed statuses in workflow order for both sort choices with accurate labels', async () => {
  const rows = [sortRow('c-closed', 'closed', '2026-11-01'), sortRow('c-open-none', 'open', null), sortRow('c-resolved', 'resolved', '2026-11-02'),
    sortRow('c-proposed', 'remedy-proposed', '2026-11-12'), sortRow('c-open', 'open', '2026-11-09'), sortRow('c-progress', 'in-progress', '2026-11-12')]
    .map((c, i) => ({ ...c, employeeName: `Row ${c.caseId}`, employeeId: `e${i}` }));
  const f = await mountQueue({ ...queueFixtureAdapter(), async listCases() { return { status: 'ok', value: { cases: structuredClone(rows) } }; } });
  const shown = () => [...f.root.querySelectorAll('tbody tr')].map((r) => r.children[0].textContent.replace('Row ', ''));
  assert.deepEqual(shown(), ['c-open', 'c-progress', 'c-proposed', 'c-open-none', 'c-closed', 'c-resolved']);
  assert.deepEqual([...f.root.querySelector('[id$="-sort"]').options].map((o) => o.textContent), ['Deadline, active cases first', 'Status, then deadline']);
  queueField(f.root, 'sort', 'status', 'change');
  assert.deepEqual(shown(), ['c-open', 'c-open-none', 'c-progress', 'c-proposed', 'c-resolved', 'c-closed']);
  assert.match([...f.root.querySelectorAll('tbody tr')][1].textContent, /Needs confirmation/); f.destroy();
});
test('FUCQ-259: the queue and case show a missed return by its keyed label; an unlabelled no-show reads as before', async () => {
  const missed = { ...sortRow('c-missed', 'open', '2026-11-09'), trigger: { type: 'lifecycle-exception', eventType: 'return-missed', label: 'Missed return of current car' } };
  const noShow = { ...sortRow('c-no-show', 'open', '2026-11-10'), trigger: { type: 'lifecycle-exception', eventType: 'appointment-no-show' } };
  const f = await mountQueue({ ...queueFixtureAdapter(), async listCases() { return { status: 'ok', value: { cases: [missed, noShow] } }; } });
  assert.deepEqual([...f.root.querySelectorAll('tbody tr')].map((r) => r.children[2].textContent), ['Missed return of current car', 'lifecycle-exception']);
  f.destroy();
  const root = host(); root.append(renderCaseContent(missed, { audience: 'scheme-team' }), renderCaseContent(noShow, { audience: 'scheme-team' }));
  assert.match(root.textContent, /Opened fromMissed return of current car/); assert.match(root.textContent, /Opened fromMissed handover appointment/);
  assert.doesNotMatch(root.textContent, /—/);
});
test('FUCQ-261: the queue stacks at narrow widths with every column labelled, and the picker label is short', async () => {
  const { root, destroy } = await mountQueue();
  const region = root.querySelector('table').closest('.gcsp-table-wrap'); assert.ok(region.classList.contains('is-stack'));
  const cells = [...root.querySelector('tbody tr').querySelectorAll('td')].map((td) => td.dataset.label);
  assert.ok(cells.includes('Status') && cells.includes('Owner'), cells.join());
  const labels = [...root.querySelector('[id$="-selection"]').options].slice(1).map((o) => o.textContent);
  assert.ok(labels.every((label) => label.split(' · ').length === 2), labels.join()); destroy();
  const css = readFileSync(new URL('../../blocks/gcsp/cases/gcsp-case-queue.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 641px\) \{ \.gcsp \.gcsp-case-queue \.gcsp-table \{ min-width: 1050px; \} \}/);
  const kit = readFileSync(new URL('../../blocks/gcsp/kit/gcsp-kit.css', import.meta.url), 'utf8');
  assert.match(kit, /\.is-stack \.gcsp-table-td::before \{[^}]*min-width: min\(6em, 40%\)/, 'a stacked label cannot be squeezed by a long value');
});
test('FUCQ-261: a resolved case with a confirmed change promises no further review, for Paula or Greg', () => {
  const remedy = { type: 'preference-relaxation', path: 'preferences.body.value', value: 'hatchback', expectedBriefVersion: 1, confirmationState: 'employee-confirmed' };
  const base = { ...queueCaseFixtures()[0], remedy, relaxation: { applicable: false, confirmed: true, before: 'saloon', currentBriefVersion: 2 } };
  const text = (c, audience) => { const root = host(); root.append(renderCaseContent(c, { audience })); return root.textContent; };
  for (const status of ['resolved', 'closed']) {
    assert.match(text({ ...base, status }, 'employee'), /You confirmed this preference change\./);
    assert.doesNotMatch(text({ ...base, status }, 'employee'), /will review the case/);
    assert.doesNotMatch(text({ ...base, status }, 'scheme-team'), /before resolving it/);
  }
  assert.match(text({ ...base, status: 'remedy-proposed' }, 'employee'), /The scheme team will review the case\./);
  assert.match(text({ ...base, status: 'remedy-proposed' }, 'scheme-team'), /Review the case before resolving it\./);
});
test('FUCQ-263: a closed case with an unconfirmed change asks Paula for nothing and offers no review', () => {
  const remedy = { type: 'preference-relaxation', path: 'preferences.body.value', value: 'hatchback', expectedBriefVersion: 1, confirmationState: 'employee-confirmation-required' };
  const render = (status, applicable) => { const root = host(); root.append(renderCaseContent({ ...queueCaseFixtures()[0], status, remedy,
    relaxation: { applicable, confirmed: false, before: 'saloon', currentBriefVersion: applicable ? 1 : 2 } }, { onReviewRelaxation: () => {} })); return root; };
  for (const status of ['resolved', 'closed']) for (const applicable of [true, false]) {
    const root = render(status, applicable);
    assert.doesNotMatch(root.textContent, /Waiting for your confirmation|no longer matches your current brief/);
    assert.equal(findButton(root, 'Review body change'), undefined);
    assert.match(root.textContent, /Recorded remedy.*Proposed valuehatchback/s);
    assert.match(root.textContent, /This change was not confirmed before the case (closed|was resolved)\./);
  }
  const open = render('remedy-proposed', true);
  assert.match(open.textContent, /Waiting for your confirmation\. Only this preference value will change\./);
  assert.ok(findButton(open, 'Review body change')); assert.doesNotMatch(open.textContent, /was not confirmed before/);
});
test('FUCQ-264: Greg sees an unconfirmed change recorded as not confirmed on a closed or resolved case', () => {
  const remedy = { type: 'preference-relaxation', path: 'preferences.body.value', value: 'hatchback', expectedBriefVersion: 1, confirmationState: 'employee-confirmation-required' };
  const text = (status) => { const root = host(); root.append(renderCaseContent({ ...queueCaseFixtures()[0], status, remedy }, { audience: 'scheme-team' })); return root.textContent; };
  for (const [status, ended] of [['closed', 'closed'], ['resolved', 'was resolved']]) {
    assert.doesNotMatch(text(status), /confirms this preference through their brief|before this case can be resolved/);
    assert.match(text(status), new RegExp(`Recorded remedy.*The employee did not confirm this change before the case ${ended}\\.`, 's'));
  }
  assert.match(text('remedy-proposed'), /The employee confirms this preference through their brief\. Confirmation is checked before this case can be resolved\./);
  assert.doesNotMatch(text('remedy-proposed'), /did not confirm/);
});
test('embedded queue spans the Greg dashboard grid like the publish panel', () => {
  const css = readFileSync(new URL('../../blocks/gcsp/cases/gcsp-case-queue.css', import.meta.url), 'utf8');
  assert.match(css, /\.gcsp-greg-region:has\(\.gcsp-case-queue\.is-embedded\) \{[^}]*grid-column: 1 \/ -1/);
});
test('embedded queue drops the page shell height and grey ground, so the region ends at its content (FUCQ-238)', () => {
  const css = readFileSync(new URL('../../blocks/gcsp/cases/gcsp-case-queue.css', import.meta.url), 'utf8');
  assert.match(css, /\.gcsp:has\(> \.gcsp-case-queue\.is-embedded\) \{ min-height: 0; background: transparent; \}/);
});
test('alternative-car remedies show the car name, never a raw id, to the employee and a secondary reference to the scheme team', async () => {
  const named = { ...caseFixture('waiting'), remedy: { type: 'alternative-car', orderUuid: 'raw-order-uuid-123', carName: 'Synthetic BMW iX1' } };
  const unnamed = { ...named, remedy: { type: 'alternative-car', orderUuid: 'raw-order-uuid-123' } };
  for (const [c, name] of [[named, 'Synthetic BMW iX1'], [unnamed, 'Car details not supplied']]) {
    const f = await mount('waiting', { ...fixtureAdapter('waiting'), async readCases() { return { status: 'ok', value: { cases: [c] } }; } });
    assert.match(f.root.textContent, new RegExp(`Proposed car${name}`)); assert.doesNotMatch(f.root.textContent, /raw-order-uuid-123/);
    assert.match(f.root.textContent, /No specific next car or greater priority is guaranteed/); f.destroy();
  }
  const done = { ...named, status: 'resolved' };
  const g = await mount('waiting', { ...fixtureAdapter('waiting'), async readCases() { return { status: 'ok', value: { cases: [done] } }; } });
  assert.match(g.root.textContent, /Recorded carSynthetic BMW iX1/); g.destroy();
  const q = await mountQueue({ ...queueFixtureAdapter(), async readOptions({ caseId }) {
    const value = queueOptionsFixture({ ...queueCaseFixtures()[0], caseId }); value.case.remedy = named.remedy; return { status: 'ok', value }; } });
  await openQueue(q.root);
  assert.match(q.root.textContent, /Proposed carSynthetic BMW iX1/); assert.match(q.root.textContent, /Exact car referenceraw-order-uuid-123/); q.destroy();
});
test('queue editor and review show the selected car name before the reference', async () => {
  const f = await mountQueue(); await openQueue(f.root); reviewQueue(f.root, 'alternativeCars:0');
  assert.match(f.root.textContent, /Proposed carSynthetic BMW iX1/); assert.match(f.root.textContent, /Exact car referencesynthetic-exact-car/);
  findButton(f.root, 'Review case update').click();
  assert.match(f.root.querySelector('.gcsp-case-confirmation').textContent, /Proposed carSynthetic BMW iX1/); f.destroy();
});
test('queue opens read-only options, uses exactly server statuses and availability, and never promises priority', async () => {
  let writes = 0; const value = queueOptionsFixture(); value.nextStatuses = ['resolved'];
  value.options.contractExtension = { available: false, reason: 'The current contract is not eligible.' };
  const f = await mountQueue({ ...queueFixtureAdapter(), async readOptions() { return { status: 'ok', value }; }, async updateCase() { writes += 1; } });
  await openQueue(f.root);
  assert.deepEqual([...f.root.querySelector('[id$="-status"]').options].map((o) => o.value), ['', 'resolved']);
  assert.equal(f.root.querySelector('[id$="-remedyKey"] option[value="contractExtension"]'), null);
  assert.match(f.root.textContent, /The current contract is not eligible/); assert.match(f.root.textContent, /No specific next car or greater priority is guaranteed/);
  queueField(f.root, 'remedyKey', 'laterRelease:0', 'change');
  assert.match(f.root.textContent, /2026-11-10 09:15:00 UTC/); assert.match(f.root.textContent, /Synthetic reviewed release/);
  assert.equal(writes, 0); f.destroy();
  const waiting = await mountQueue(); await openQueue(waiting.root, 'synthetic-case-2');
  assert.match(waiting.root.textContent, /The employee confirms this preference through their brief/);
  assert.doesNotMatch(waiting.root.textContent, /no longer matches your current brief/); waiting.destroy();
});
test('queue handles empty/loading/source/access/stale-run distinctly and terminal cases have no editor', async () => {
  for (const [name, title] of [['empty', 'No renewal cases'], ['loading', 'Loading renewal cases'], ['unavailable', 'Renewal cases are unavailable'],
    ['forbidden', 'You cannot open these cases'], ['stale-run', 'The demo was restarted']]) {
    const f = await mountQueue(queueFixtureAdapter(name)); assert.match(f.root.textContent, new RegExp(title)); f.destroy();
  }
  const f = await mountQueue(); await openQueue(f.root, 'synthetic-case-4');
  assert.equal(findButton(f.root, 'Review case update'), undefined); assert.match(f.root.textContent, /no further permitted status changes/); f.destroy();
});
test('case adapter reads a bare 401 (lapsed access key) as access-required through the kit helper; a status keeps its refusal', async () => {
  const reply = (status, body, type = 'application/json') => async () => new Response(body, { status, headers: { 'Content-Type': type } });
  for (const [status, body, expected] of [[401, '{"error":"Unauthorized"}', 'access-required'], [401, 'Unauthorized', 'access-required'],
    [401, '{"status":"forbidden","reason":"Not the scheme team."}', 'forbidden'], [200, 'not json', 'unavailable']]) {
    const out = await createCaseHttpAdapter({ fetchImpl: reply(status, body) }).listCases();
    assert.equal(out.status, expected, `${status} ${body}`);
  }
});
test('queue shows the shared restart notice, not renewal-help copy, when access lapses or the run restarts', async () => {
  for (const status of ['access-required', 'stale-run', 'unknown-session']) for (const embedded of [true, false]) {
    const f = await mountQueue({ ...queueFixtureAdapter(), async listCases() { return { status }; } }, { embedded });
    assert.match(f.root.textContent, /The demo was restarted\. Reload the page to continue\./, `${status} ${embedded}`);
    assert.equal(f.root.querySelector('.gcsp-case-status').textContent, 'Demo restarted.');
    assert.doesNotMatch(f.root.textContent, /Renewal help is unavailable|Your demo run has changed|Reopen the current employee session/);
    assert.ok(findButton(f.root, 'Reload')); assert.equal(findButton(f.root, 'Retry queue'), undefined); assert.equal(findButton(f.root, 'Refresh queue'), undefined);
    f.destroy();
  }
  const adapter = queueFixtureAdapter();
  const detail = await mountQueue({ ...adapter, async readOptions() { return { status: 'access-required' }; } }, { embedded: true });
  await openQueue(detail.root); assert.ok(findButton(detail.root, 'Reload')); assert.equal(findButton(detail.root, 'Refresh case options'), undefined);
  assert.doesNotMatch(detail.root.textContent, /Renewal help is unavailable/); detail.destroy();
  const saving = await mountQueue({ ...adapter, async updateCase() { return { status: 'access-required' }; } }, { embedded: true });
  await openQueue(saving.root); reviewQueue(saving.root); findButton(saving.root, 'Review case update').click(); findButton(saving.root, 'Confirm case update').click(); await tick();
  assert.ok(findButton(saving.root, 'Reload')); assert.equal(findButton(saving.root, 'Confirm case update'), undefined);
  assert.doesNotMatch(saving.root.textContent, /Renewal help is unavailable|update was recorded/); saving.destroy();
});
test('queue update is explicitly reviewed/confirmed with version and reloaded from authoritative state', async () => {
  const calls = []; let c = queueCaseFixtures()[0]; let lists = 0; let reads = 0;
  const adapter = { async listCases() { lists += 1; return { status: 'ok', value: { cases: [structuredClone(c)] } }; },
    async readOptions() { reads += 1; return { status: 'ok', value: queueOptionsFixture(c) }; },
    async updateCase(input) { calls.push(input); c = { ...c, version: 3, reason: 'Authoritative saved reason', status: 'remedy-proposed' };
      return { status: 'ok', value: { case: { ...c, reason: 'Untrusted response-only reason' } } }; } };
  const f = await mountQueue(adapter); await openQueue(f.root); reviewQueue(f.root, 'alternativeCars:0');
  assert.match(f.root.textContent, /synthetic-exact-car/); findButton(f.root, 'Review case update').click(); assert.equal(calls.length, 0);
  assert.match(f.root.textContent, /Confirm case update/); assert.doesNotMatch(f.root.textContent, /"type":/);
  findButton(f.root, 'Confirm case update').click(); await tick(); await tick();
  assert.deepEqual(calls, [{ caseId: 'synthetic-case-0', expectedVersion: 2, status: 'remedy-proposed', reason: 'Discussed the available remedy.',
    nextAction: 'Contact the employee.', dueAt: '2026-11-07T09:30:05.000Z', remedy: { type: 'alternative-car', orderUuid: 'synthetic-exact-car' }, commandId: 'stable-update' }]);
  assert.equal(lists, 2); assert.equal(reads, 2); assert.match(f.root.textContent, /Authoritative saved reason/);
  assert.doesNotMatch(f.root.textContent, /Untrusted response-only reason/); assert.match(f.root.textContent, /case update was recorded/);
  assert.equal(document.activeElement, f.root.querySelector('.gcsp-case-status')); f.destroy();
});
test('queue records only exact projected remedy commands, with editable single preferences and persisted release source', async () => {
  const variants = [
    ['preferenceRelaxations:0', 'preferenceValue', '1', 'change', { type: 'preference-relaxation', decisionId: 'synthetic-decline', expectedBriefVersion: 3, path: 'preferences.body.value', value: 'suv' }],
    ['preferenceRelaxations:1', 'preferenceValue', '200', 'input', { type: 'preference-relaxation', decisionId: 'synthetic-decline', expectedBriefVersion: 3, path: 'preferences.range.value', value: 200 }],
    ['laterRelease:0', null, null, null, { type: 'later-release', releaseAt: '2026-11-10T09:15:00.000Z', source: 'Synthetic reviewed release' }],
    ['manualDecision', 'decision', 'Discussed with the ordering team.', 'input', { type: 'manual-decision', decision: 'Discussed with the ordering team.' }],
    ['contractExtension', 'until', '2026-12-01', 'input', { type: 'contract-extension', until: '2026-12-01' }],
  ];
  for (const [key, field, value, event, remedy] of variants) {
    const calls = []; const f = await mountQueue({ ...queueFixtureAdapter(), async updateCase(input) { calls.push(input); return { status: 'unavailable' }; } });
    await openQueue(f.root); reviewQueue(f.root, key); if (field) queueField(f.root, field, value, event);
    findButton(f.root, 'Review case update').click(); assert.equal(calls.length, 0); findButton(f.root, 'Confirm case update').click(); await tick();
    assert.deepEqual(calls[0].remedy, remedy); assert.equal(calls[0].expectedVersion, 2); f.destroy();
  }
});
test('queue validation focuses errors and cancel sends no write', async () => {
  let writes = 0; const f = await mountQueue({ ...queueFixtureAdapter(), async updateCase() { writes += 1; } }); await openQueue(f.root);
  findButton(f.root, 'Review case update').click(); assert.match(f.root.textContent, /Describe why this case is changing/);
  assert.equal(document.activeElement, f.root.querySelector('.gcsp-error-summary h2'));
  reviewQueue(f.root, 'preferenceRelaxations:1'); queueField(f.root, 'preferenceValue', '500');
  findButton(f.root, 'Review case update').click(); assert.match(f.root.textContent, /Choose a different preference value/);
  queueField(f.root, 'preferenceValue', '200'); findButton(f.root, 'Review case update').click(); findButton(f.root, 'Cancel update').click();
  assert.equal(writes, 0); assert.ok(findButton(f.root, 'Review case update')); f.destroy();
});
test('queue uncertain retry retains command id; conflict/access/stale outcomes require fresh server options', async () => {
  const calls = []; const f = await mountQueue({ ...queueFixtureAdapter(), async updateCase(input) { calls.push(input); throw Error('uncertain'); } });
  await openQueue(f.root); reviewQueue(f.root); findButton(f.root, 'Review case update').click(); findButton(f.root, 'Confirm case update').click(); await tick();
  assert.doesNotMatch(f.root.textContent, /update was recorded/); assert.ok(findButton(f.root, 'Confirm case update'));
  findButton(f.root, 'Confirm case update').click(); await tick(); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); f.destroy();
  for (const status of ['conflict', 'stale-version', 'forbidden']) {
    let reads = 0; const adapter = queueFixtureAdapter();
    const other = await mountQueue({ ...adapter, async readOptions(input) { reads += 1; return adapter.readOptions(input); },
      async updateCase() { return { status, reason: 'Refresh the current scheme-team session.' }; } });
    await openQueue(other.root); reviewQueue(other.root); findButton(other.root, 'Review case update').click(); findButton(other.root, 'Confirm case update').click(); await tick();
    assert.equal(findButton(other.root, 'Confirm case update'), undefined); assert.equal(findButton(other.root, 'Review case update'), undefined);
    assert.equal(document.activeElement, other.root.querySelector('.gcsp-case-status'));
    findButton(other.root, 'Refresh case options').click(); await tick(); assert.equal(reads, 2); assert.ok(findButton(other.root, 'Review case update')); other.destroy();
  }
});
test('queue cleanup and newer selections suppress late reads/saves and hidden reloads', async () => {
  const late = deferred(); let signal; const f = await mountQueue({ ...queueFixtureAdapter(), async readOptions(input, options) { signal = options.signal; return late.promise; } });
  queueField(f.root, 'selection', 'synthetic-case-0', 'change'); findButton(f.root, 'Open selected case').click(); f.destroy(); assert.equal(signal.aborted, true);
  late.resolve({ status: 'ok', value: queueOptionsFixture() }); await tick(); assert.equal(f.root.children.length, 0);
  const save = deferred(); let lists = 0; let writes = 0; const adapter = queueFixtureAdapter();
  const other = await mountQueue({ ...adapter, async listCases(options) { lists += 1; return adapter.listCases(options); }, async updateCase() { writes += 1; return save.promise; } });
  await openQueue(other.root); reviewQueue(other.root); findButton(other.root, 'Review case update').click(); const confirm = findButton(other.root, 'Confirm case update'); confirm.click();
  other.destroy(); save.resolve({ status: 'ok', value: { case: queueCaseFixtures()[0] } }); await tick(); confirm.click();
  assert.equal(lists, 1); assert.equal(writes, 1); assert.equal(other.root.children.length, 0);
  const first = deferred(); const third = await mountQueue({ ...adapter, async readOptions(input) { return input.caseId === 'synthetic-case-0' ? first.promise : adapter.readOptions(input); } });
  queueField(third.root, 'selection', 'synthetic-case-0', 'change'); findButton(third.root, 'Open selected case').click(); await openQueue(third.root, 'synthetic-case-1');
  first.resolve({ status: 'ok', value: queueOptionsFixture() }); await tick();
  assert.equal(third.root.querySelector('[data-case-id]').dataset.caseId, 'synthetic-case-1'); third.destroy();
});
test('queue HTTP routes include credentials, strip identity and reject malformed successful projections', async () => {
  const calls = []; const values = [{ cases: [] }, queueOptionsFixture(), { case: queueCaseFixtures()[0] }];
  const adapter = createCaseHttpAdapter({ fetchImpl: async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ status: 'ok', value: values[calls.length - 1] }) }; } });
  await adapter.listCases(); await adapter.readOptions({ caseId: 'case with/&' });
  await adapter.updateCase({ commandId: 'id', caseId: 'one', expectedVersion: 2, status: 'in-progress', reason: 'Review', nextAction: 'Call', dueAt: '2026-11-07T12:00:00.000Z',
    remedy: { type: 'manual-decision', decision: 'Reviewed' }, employeeId: 'forged', runId: 'forged', owner: 'forged' });
  assert.equal(calls[0][0], '/api/gcsp/scheme-team/cases'); assert.equal(calls[1][0], '/api/gcsp/scheme-team/cases/options?caseId=case+with%2F%26');
  assert.equal(calls[2][0], '/api/gcsp/scheme-team/cases/update'); assert.ok(calls.every(([, options]) => options.credentials === 'include'));
  assert.deepEqual(Object.keys(JSON.parse(calls[2][1].body)), ['commandId', 'caseId', 'expectedVersion', 'status', 'reason', 'nextAction', 'dueAt', 'remedy']);
  const bad = createCaseHttpAdapter({ fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'ok', value: { case: {}, nextStatuses: [null], options: {} } }) }) });
  assert.equal((await bad.listCases()).status, 'unavailable'); assert.equal((await bad.readOptions({ caseId: 'x' })).status, 'unavailable');
  assert.equal((await bad.updateCase({})).status, 'unavailable');
});
test('queue element pre-upgrade injection, embedding, heading override, refresh, register and actual default HTTP work', async () => {
  const element = document.createElement('gcsp-case-queue'); element.adapter = queueFixtureAdapter('empty'); element.setAttribute('embedded', ''); document.body.append(element);
  queue.defineGcspCaseQueue(); await tick(); assert.match(element.textContent, /No renewal cases/); assert.equal(element.querySelector('h1'), null);
  assert.equal(element.querySelector('h2').textContent, 'Renewal cases'); element.setAttribute('heading-level', '3'); await tick();
  assert.equal(element.querySelector('.vm-title').tagName, 'H3'); await element.refresh(); element.remove(); assert.equal(element.children.length, 0);
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true, json: async () => ({ status: 'ok', value: { cases: [] } }) }; };
  try { const actual = document.createElement('gcsp-case-queue'); document.body.append(actual); await tick(); assert.deepEqual(calls, ['/api/gcsp/scheme-team/cases']); actual.remove(); }
  finally { globalThis.fetch = original; }
  await import('../../blocks/gcsp/cases/register.js'); assert.equal(customElements.get('gcsp-case-queue'), queue.GcspCaseQueueElement);
  const html = readFileSync(new URL('../../gcsp-case-queue.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\son\w+\s*=|<script(?![^>]*\bsrc=)[^>]*>\s*\S/i); assert.match(html, /queue-harness.js/); assert.match(html, /gcsp-case-queue.css/);
  assert.equal((await queueFixtureAdapter().updateCase({})).status, 'unavailable');
});


test('malformed successful queue projections show source failure instead of exposing broken controls', async () => {
  const value = queueOptionsFixture(); value.options.preferenceRelaxations.items[0].values = null;
  const adapter = createCaseHttpAdapter({ fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'ok', value }) }) });
  assert.equal((await adapter.readOptions({ caseId: value.case.caseId })).status, 'unavailable');
  const f = await mountQueue({ ...queueFixtureAdapter(), async readOptions() { return { status: 'ok', value }; } });
  await openQueue(f.root); assert.match(f.root.textContent, /Case options are unavailable/); assert.equal(findButton(f.root, 'Review case update'), undefined); f.destroy();
});

test('FUCQ-170: cancelling a preference change returns focus; history and owner show readable names, not principal ids', async () => {
  const { root, destroy } = await mount('waiting');
  findButton(root, 'Review body change').click(); findButton(root, 'Cancel preference change').click();
  assert.equal(document.activeElement, findButton(root, 'Review body change'));
  const c = { ...caseFixture('resolved'), employeeId: 'employee-1', owner: { name: 'Greg', role: 'scheme-team' },
    history: [{ at: '2026-11-05T12:00:00.000Z', actorId: 'demo-paula', actorRole: 'employee', status: 'open', reason: 'Help' },
      { at: '2026-11-05T13:00:00.000Z', actorId: 'demo-greg', actorRole: 'scheme-team', status: 'resolved', reason: 'Done' }] };
  const { renderCaseContent } = await import('../../blocks/gcsp/cases/case-content.js');
  const text = renderCaseContent(c).textContent;
  assert.doesNotMatch(text, /demo-paula|demo-greg/); assert.match(text, /You/); assert.match(text, /Greg/);
  destroy();
  const q = host(); const stop = queue.mountCaseQueue(q, { adapter: queueFixtureAdapter('populated') }); await tick(); await tick();
  assert.doesNotMatch(q.querySelector('table').textContent, /scheme-team/); stop();
});

test('FUCQ-213: a lapsed access key reads as access needed, not unavailable', async () => {
  const { caseFailure } = await import('../../blocks/gcsp/cases/gcsp-help.js');
  const adapter = createCaseHttpAdapter({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }) });
  const lapsed = await adapter.readHelp();
  assert.equal(lapsed.status, 'access-required');
  const shown = caseFailure(lapsed);
  assert.equal(shown.title, 'Demo access needed'); assert.doesNotMatch(`${shown.title} ${shown.text}`, /unavailable/i);
});
test('FUCQ-208: owner role is shown only when it adds to the owner name', async () => {
  const { renderCaseContent } = await import('../../blocks/gcsp/cases/case-content.js');
  const owned = (owner) => renderCaseContent({ ...caseFixture('request'), owner }).querySelector('.gcsp-case-facts').textContent;
  const same = owned({ name: 'Scheme team', role: 'scheme-team' });
  assert.equal(same.match(/Scheme team/g).length, 1);
  const named = owned({ name: 'Greg', role: 'scheme-team' });
  assert.match(named, /OwnerGreg/); assert.match(named, /Owner roleScheme team/);
  assert.match(owned({ role: 'scheme-team' }), /OwnerScheme team/); assert.doesNotMatch(owned({ role: 'scheme-team' }), /Owner role/);
});
test('FUCQ-208: same-name alternative cars are told apart by supplied facts, never invented ones', async () => {
  const known = (value) => ({ status: 'known', value });
  const car = (orderUuid, name, facts = {}) => ({ type: 'alternative-car', orderUuid, configurationId: 'synthetic-configuration',
    snapshot: { display: { name }, facts } });
  const value = queueOptionsFixture();
  value.options.alternativeCars.items = [car('car-a', 'BMW i4 in Black', { confirmedDeliveryWeek: known('2026-11-23') }),
    car('car-b', 'BMW i4 in Black', { confirmedDeliveryWeek: known('2026-12-07') }), car('car-c', 'BMW iX1', { confirmedDeliveryWeek: known('2026-11-23') }),
    car('car-d', 'BMW iX3'), car('car-e', 'BMW iX3'), car('car-f', '')];
  const f = await mountQueue({ ...queueFixtureAdapter(), async readOptions() { return { status: 'ok', value }; } });
  await openQueue(f.root);
  const labels = [...f.root.querySelectorAll('[id$="-remedyKey"] option')].map((o) => o.textContent).filter((t) => t.startsWith('Alternative car'));
  assert.deepEqual(labels, ['Alternative car: BMW i4 in Black, delivery week of 2026-11-23', 'Alternative car: BMW i4 in Black, delivery week of 2026-12-07',
    'Alternative car: BMW iX1', 'Alternative car: BMW iX3, reference car-d', 'Alternative car: BMW iX3, reference car-e',
    'Alternative car: Car details not supplied, reference car-f']);
  reviewQueue(f.root, 'alternativeCars:1');
  assert.match(f.root.textContent, /Proposed carBMW i4 in Black, delivery week of 2026-12-07/);
  findButton(f.root, 'Review case update').click();
  assert.match(f.root.querySelector('.gcsp-case-confirmation').textContent, /Proposed carBMW i4 in Black, delivery week of 2026-12-07/); f.destroy();
});
test('FUCQ-258: cars needing confirmation are listed with their reasons and are never remedy choices', async () => {
  const value = queueOptionsFixture();
  value.options.alternativeCars.needsConfirmation = [{ type: 'alternative-car', orderUuid: 'car-phev', configurationId: 'synthetic-configuration',
    snapshot: { display: { name: 'BMW 330e Touring' }, facts: {} }, unknowns: ['charging-unconfirmed'] }];
  const f = await mountQueue({ ...queueFixtureAdapter(), async readOptions() { return { status: 'ok', value }; } });
  await openQueue(f.root);
  assert.match(f.root.textContent, /Cars that need confirmation before they can be proposed:/);
  assert.match(f.root.textContent, /BMW 330e TouringCharging access not confirmed/);
  const labels = [...f.root.querySelectorAll('[id$="-remedyKey"] option')].map((o) => o.textContent);
  assert.ok(labels.some((t) => t.startsWith('Alternative car')) && !labels.some((t) => t.includes('330e'))); f.destroy();
});
