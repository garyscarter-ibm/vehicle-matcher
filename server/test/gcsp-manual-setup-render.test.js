import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { inputDigest, result } from '../gcsp/repository/index.js';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://setup.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { mountManualSetup, defineGcspManualSetup } = await import('../../blocks/gcsp/manual-setup/gcsp-manual-setup.js');
const { mountManualJourney } = await import('../../blocks/gcsp/manual-setup/journey.js');
const { labelledField, errorSummary } = await import('../../blocks/gcsp/kit/form-controls.js');
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise((done) => setImmediate(done)); }
  assert.ok(check(), 'Expected DOM state was not reached.');
};
async function setup(t, { beforeMount, journey = false } = {}) {
  const runtime = (await createGcspRuntime({ mode: 'memory', environmentId: 'manual-setup-render',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'bootstrap-render', sessionNow: () => '2026-11-05T09:00:00.000Z' })).value;
  assert.ok(runtime); const session = await runtime.createLocalSession(); const context = session.value.context;
  let count = 0;
  const adapter = { readAccount: () => runtime.account.readAccount(context), readDraft: () => runtime.account.readDraft(context),
    saveDraft: (input) => runtime.account.saveDraft(context, input), browseStock: () => runtime.account.browseStock(context),
    startJourney: ({ account, action, draft, commandId }) => runtime.account.saveDraft(context, { commandId,
      expectedContextVersion: account.value.contextVersion, expectedDraftVersion: draft.value?.draftVersion ?? 0,
      choices: { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
        slotId: action.slotId, schemeId: action.schemeId } }) };
  const f = { runtime, context, adapter }; await beforeMount?.(f);
  const root = document.createElement('div'); document.body.append(root); f.root = root;
  const options = { adapter, commandId: () => `render-${++count}`, onBack: () => { f.back = true; } };
  f.destroy = journey ? mountManualJourney(root, { ...options,
    galleryAdapter: { ...adapter, readClaim: () => runtime.manualClaims.readClaim(context) } }) : mountManualSetup(root, options);
  t.after(async () => { f.destroy(); root.remove(); await runtime.close(); });
  await waitFor(() => root.querySelector('h1'));
  return f;
}
const control = (f, name) => f.root.querySelector(`[name="${name}"]`);
function input(f, name, value) {
  const node = control(f, name); node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function fill(f, { mode = 'replacement', driver = 'employee' } = {}) {
  input(f, 'driverId', `${driver === 'employee' ? 'driver' : 'nominated'}:${f.context.employeeId}`);
  input(f, 'contractOptionId', 'six-month-8000'); input(f, 'requestedCollectionDate', '2026-11-20');
  input(f, 'collectionLocationId', 'demo-collection-centre'); if (mode === 'replacement') input(f, 'expectedReturnMileage', '6700');
}
const click = (f, label) => [...f.root.querySelectorAll('button')].find((b) => b.textContent === label)?.click();
async function mutate(f, change, id = 'source-change') {
  const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
  return f.runtime.repository.transaction(f.context, { commandId: id, inputDigest: inputDigest({ id }) }, async (tx) => {
    const found = await tx.get(ref); const value = structuredClone(found.value.contract.manualContext); change(value);
    return tx.compareAndSwap(ref, found.value.version, { contract: { manualContext: value } });
  });
}
test('shared native fields link errors and summary focus to the original control', () => {
  const node = document.createElement('input'); const field = labelledField({ id: 'isolated-field', label: 'Contact', control: node, hint: 'Editable contact' });
  const summary = errorSummary({ id: 'isolated-summary', errors: [{ id: node.id, message: 'Required' }] });
  document.body.append(field.root, summary.root); field.setError('Required');
  assert.equal(field.root.querySelector('label').htmlFor, node.id);
  assert.equal(node.getAttribute('aria-describedby'), 'isolated-field-hint isolated-field-error');
  summary.focus(); assert.equal(document.activeElement.tagName, 'H2'); summary.root.querySelector('a').click();
  assert.equal(document.activeElement, node); field.setError(''); assert.equal(node.getAttribute('aria-invalid'), 'false');
  assert.equal(node.getAttribute('aria-describedby'), 'isolated-field-hint'); field.root.remove(); summary.root.remove();
});
test('grouped setup preserves native controls and focus through edits and displays trusted read-only facts', async (t) => {
  const f = await setup(t); assert.equal(f.root.querySelectorAll('main').length, 1);
  assert.equal(f.root.querySelector('h1').textContent, 'Your order choices');
  assert.equal(control(f, 'driverId').value, ''); assert.equal(control(f, 'phone').value, '01632 960000');
  const phone = control(f, 'phone'); phone.focus(); input(f, 'phone', '01632 960005');
  assert.equal(control(f, 'phone'), phone); assert.equal(document.activeElement, phone);
  assert.match(f.root.textContent, /Employee facts are read-only/);
  // FUCQ-277: before a driver is chosen the licence facts, their hint and every "Not supplied" are absent, with the synthetic footer.
  assert.doesNotMatch(f.root.textContent, /Not supplied|Driver and licence facts are read-only|Synthetic monthly demo|Not a verified/);
  assert.equal(f.root.querySelector('.gcsp-setup-source').childNodes.length, 0); assert.equal(f.root.querySelector('.gcsp-synthetic').textContent, 'Synthetic example data.');
  assert.match(f.root.textContent, /1,300 points a month/); assert.equal(control(f, 'schemeId'), null);
  input(f, 'driverId', `nominated:${f.context.employeeId}`);
  assert.match(f.root.textContent, /Driver and licence facts are read-only/); assert.match(f.root.textContent, /spouse/); assert.match(f.root.textContent, /FICTIONAL-NOMINEE/);
  assert.ok(control(f, 'contractOptionId').querySelector('[value="twelve-month-12000"]').disabled);
  const reasons = f.root.querySelector('.gcsp-setup-reasons').textContent; // FUCQ-197: a choice is named, not its id
  assert.match(reasons, /12 months, 12000 mi\/year: /); assert.equal(reasons.includes('twelve-month-12000'), false);
  click(f, 'Get help with drivers and licences'); assert.match(f.root.textContent, /Contact driver support.*No request has been sent/);
});
test('invalid Continue focuses error summary and links a field without discarding edits', async (t) => {
  const f = await setup(t); const phone = control(f, 'phone'); input(f, 'phone', '01632 960009'); click(f, 'Continue');
  await waitFor(() => document.activeElement.textContent === 'Check your choices');
  const summary = f.root.querySelector('.gcsp-error-summary'); assert.equal(summary.hidden, false);
  summary.querySelector('a').click(); assert.equal(document.activeElement, control(f, 'driverId'));
  assert.equal(control(f, 'phone'), phone); assert.equal(phone.value, '01632 960009');
  assert.equal(control(f, 'driverId').getAttribute('aria-invalid'), 'true');
});
test('complete save emits one current setup hint on duplicate clicks and Back retains real saved choices', async (t) => {
  const f = await setup(t); const events = []; f.root.addEventListener('gcsp:setup-ready', (event) => events.push(event.detail)); fill(f);
  click(f, 'Continue'); click(f, 'Continue'); await waitFor(() => events.length === 1);
  assert.equal(events[0].draftVersion, 1); assert.equal(events[0].oldContractId, 'current:employee-paula');
  assert.match(f.root.textContent, /Availability refreshed/); input(f, 'requestedCollectionDate', '2026-11-21');
  assert.match(f.root.textContent, /choices changed/i); assert.doesNotMatch(f.root.querySelector('.gcsp-setup-availability').textContent, /Availability refreshed/);
  click(f, 'Back to account'); await waitFor(() => f.back);
  const saved = await f.adapter.readDraft(); assert.equal(saved.value.choices.requestedCollectionDate, '2026-11-21');
  assert.equal(saved.value.currentContract.contractId, 'current:employee-paula');
});
test('stock outage retains saved setup and refuses ready event until retry has current availability', async (t) => {
  const f = await setup(t); const events = []; f.root.addEventListener('gcsp:setup-ready', (event) => events.push(event.detail));
  const browse = f.adapter.browseStock; f.adapter.browseStock = async () => result('unavailable', {}); fill(f); click(f, 'Continue');
  await waitFor(() => f.root.textContent.includes('Availability could not be refreshed'));
  assert.equal(events.length, 0); assert.equal((await f.adapter.readDraft()).value.draftVersion, 1);
  f.adapter.browseStock = browse; click(f, 'Retry availability'); await waitFor(() => f.root.textContent.includes('Availability refreshed'));
});
test('unknown eligibility is explained, and newer draft conflict preserves edits until explicit discard', async (t) => {
  const unknown = await setup(t, { beforeMount: (f) => mutate(f, (r) => { r.drivers[1].eligible.value = null; }) });
  assert.match(unknown.root.textContent, /Driver eligibility needs confirmation/);
  assert.ok(control(unknown, 'driverId').querySelector(`[value="nominated:${unknown.context.employeeId}"]`).disabled);
  const f = await setup(t); fill(f); click(f, 'Save choices'); await waitFor(() => f.destroy.controller.getState().draft?.draftVersion === 1);
  await waitFor(() => ![...f.root.querySelectorAll('button')].find((b) => b.textContent === 'Save choices').disabled);
  const saved = await f.adapter.readDraft();
  const other = await f.adapter.saveDraft({ commandId: 'other-tab', expectedDraftVersion: 1,
    expectedContextVersion: saved.value.contextVersion, choices: { ...saved.value.choices, specialRequirements: 'Other browser' } }); assert.equal(other.status, 'ok');
  input(f, 'specialRequirements', 'Local edits'); click(f, 'Save choices');
  await waitFor(() => f.destroy.controller.getState().reviewRequired); click(f, 'Review fresh context');
  await waitFor(() => f.root.textContent.includes('A newer saved draft exists'));
  assert.equal(control(f, 'specialRequirements').value, 'Local edits'); click(f, 'Discard local edits and load newer draft');
  await waitFor(() => control(f, 'specialRequirements').value === 'Other browser');
});
test('account journey event enters trusted setup and Back returns to the account with current car unchanged', async (t) => {
  const f = await setup(t, { journey: true }); click(f, 'Choose a replacement');
  await waitFor(() => f.root.querySelector('h1')?.textContent === 'Your order choices'); fill(f); click(f, 'Back to account');
  await waitFor(() => f.root.querySelector('h1')?.textContent === 'Your cars');
  assert.equal(f.root.querySelectorAll('main').length, 1); assert.match(f.root.textContent, /BMW 3 Series Touring 320i/);
  click(f, 'Resume saved journey'); await waitFor(() => f.root.querySelector('h1')?.textContent === 'Your order choices');
  assert.equal(control(f, 'requestedCollectionDate').value, '2026-11-20');
});
test('custom element registration is repeatable and disconnect tears down its shell', async (t) => {
  const f = await setup(t); assert.equal(defineGcspManualSetup(), defineGcspManualSetup());
  const element = document.createElement('gcsp-manual-setup'); element.adapter = f.adapter; document.body.append(element);
  await waitFor(() => element.querySelector('form')); element.remove(); assert.equal(element.childNodes.length, 0);
});

test('setup facts show no raw scheme, slot, contract or company ids (FUCQ-197)', async (t) => {
  const f = await setup(t); const shown = f.root.textContent;
  for (const id of [f.context.schemeId, f.context.entitlementSlotId, f.context.companyId, 'current:']) assert.equal(shown.includes(id), false, id);
});

test('an unlabelled collection location never shows its raw id (FUCQ-197)', async (t) => {
  const f = await setup(t, { beforeMount: (fx) => { const read = fx.adapter.readAccount;
    fx.adapter.readAccount = async () => { const r = structuredClone(await read());
      for (const l of r.value?.choices?.collectionLocations ?? []) { fx.locationId = l.locationId; delete l.label; } return r; }; } });
  await waitFor(() => control(f, 'collectionLocationId')?.options.length);
  assert.ok(f.locationId); const text = [...control(f, 'collectionLocationId').options].map((o) => o.textContent).join('|');
  assert.equal(text.includes(f.locationId), false); assert.match(text, /Not supplied/);
});

test('FUCQ-237: a site that cannot apply to the chosen contract and driver is neither offered nor listed as a reason', async (t) => {
  const f = await setup(t); fill(f);
  await waitFor(() => control(f, 'collectionLocationId')?.options.length === 2);
  const offered = [...control(f, 'collectionLocationId').options].map((o) => o.textContent).join('|');
  assert.match(offered, /Fictional collection centre/); assert.equal(offered.includes('Fictional company site'), false);
  assert.equal(f.root.querySelector('.gcsp-setup-reasons').textContent.includes('Fictional company site'), false);
});

// FUCQ-285: setup speaks through one region; its notice and invalidation are plain.
const LIVE = '[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log],output';
const liveRegions = (scope) => [...scope.querySelectorAll(LIVE)].filter((node) => !node.closest('.gcsp-presenter-controls, header'));
test('FUCQ-285: setup has one live region that speaks a changed notice', async (t) => {
  const f = await setup(t); await waitFor(() => f.root.querySelector('form') && f.root.querySelector('.gcsp-setup-notice'));
  assert.ok(liveRegions(f.root).length <= 1, liveRegions(f.root).map((n) => n.className).join(', '));
  for (const node of f.root.querySelectorAll('.gcsp-setup-notice, .gcsp-setup-invalidation, .gcsp-setup-availability')) assert.equal(node.hasAttribute('role') || node.hasAttribute('aria-live'), false, node.className);
  input(f, 'phone', '01632 960999'); await waitFor(() => /unsaved/.test(f.root.querySelector('.gcsp-setup-notice').textContent));
  assert.equal(liveRegions(f.root).length, 1); assert.match(liveRegions(f.root)[0].textContent, /unsaved choices/);
});
