import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<main></main>', { url: 'http://localhost/' });
globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
const { mountBriefBody } = await import('../../blocks/gcsp/brief/brief-view.js');
const fixture = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq94/representative-snapshot.json', import.meta.url)));
const settle = () => new Promise((resolve) => setTimeout(resolve, 340));
test('distilled body keeps draft provenance and complete checks in its disclosure, with human facts and scale ends', async (t) => {
  const main = document.createElement('main'); document.body.append(main); const requests = [];
  const teardown = mountBriefBody(main, { editor: fixture.edited.value, transport: {
    preview: async (request) => { requests.push(request); return fixture.preview; }, saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }),
  } }); t.after(() => { teardown(); main.remove(); });
  await settle();
  assert.equal(main.querySelector('.gcsp-brief-draft').textContent, 'Unsaved draft');
  const disclosure = main.querySelector('.gcsp-brief-known');
  assert.equal(disclosure.open, false); assert.match(disclosure.textContent, /Scheme account/); assert.match(disclosure.textContent, /Your answers/);
  assert.match(disclosure.textContent, /Driver eligible/); assert.match(disclosure.textContent, /Included in your scheme/);
  assert.doesNotMatch(main.querySelector('form').textContent, /Source for both axes|Unconfirmed draft starting position|Not confirmed \(/);
  assert.match(main.querySelector('form').textContent, /Less comfortMore comfort/);
  assert.match(main.querySelector('form').textContent, /Not importantVery important/);
  const cards = main.querySelector('.gcsp-brief-cards');
  assert.match(cards.textContent, /Plug-in hybrid/); assert.match(cards.textContent, /45 mpg/);
  assert.doesNotMatch(cards.textContent, /\bphev\b|mpg-imperial|ordinal-1-5|5 count|Driver eligible|Included in your scheme/);
  assert.match(cards.textContent, /Sportiness: 23% fit/); assert.match(cards.textContent, /Charging access is unknown/);
  assert.deepEqual(requests[0].brief, fixture.edited.value.initial.brief);
});
test('representative keeps independent axes, typed practical answers, unknown charging and independent consent', async (t) => {
  const main = document.createElement('main'); document.body.append(main);
  const previews = []; const saves = [];
  const teardown = mountBriefBody(main, { editor: fixture.edited.value, transport: { preview: async (v) => { previews.push(v); return fixture.preview; }, saveDraft: async (v) => { saves.push(v); return { status: 'unavailable' }; }, confirm: async () => ({ status: 'unavailable' }) }, createCommandId: (kind) => kind });
  t.after(() => { teardown(); main.remove(); });
  assert.equal(main.querySelectorAll('input[type=range]').length, 10);
  const comfort = main.querySelector('[aria-label="Comfort: what you prefer"]'); comfort.focus(); comfort.value = '92'; comfort.dispatchEvent(new dom.window.Event('input'));
  main.querySelector('[data-indifference="sportiness"]').click();
  await settle(); assert.equal(document.activeElement, comfort); assert.equal(comfort.value, '92');
  assert.equal(previews.at(-1).brief.preferences.comfort.value, 92); assert.equal(previews.at(-1).brief.preferences.sportiness.value, 90); assert.equal(previews.at(-1).brief.preferences.sportiness.importance, 0);
  const charging = main.querySelector('[aria-label="Can you charge at home or work?"]');
  charging.querySelector('button').click(); assert.equal(main.querySelector('[data-charging-choices]').hidden, false);
  main.querySelector('[data-save-brief]').click(); await settle();
  assert.equal(saves[0].brief.essentials.charging.value, null);
  assert.match(main.textContent, /Technology Plus and Comfort Pack/); assert.match(main.textContent, /Needs confirmation/);
});
test('an accepted selection shows the saved brief read-only with labelled values and an order progress link', async (t) => {
  const main = document.createElement('main'); document.body.append(main);
  const editor = { ...structuredClone(fixture.edited.value), selection: { state: 'accepted', briefVersion: 1 } };
  const teardown = mountBriefBody(main, { editor, transport: {} }); t.after(() => { teardown(); main.remove(); });
  assert.equal(main.querySelector('h1').textContent, 'Your buddy found your car');
  assert.equal(main.querySelectorAll('input, button, form, select, textarea').length, 0);
  const text = main.textContent;
  assert.match(text, /Comfort/); assert.match(text, /Do you need a towbar\?/); assert.match(text, /Not confirmed|Needs confirmation|Yes|No/);
  assert.doesNotMatch(text, /\bseats\b|\bboot\b|could not be loaded|\u2014/);
  assert.equal(main.querySelector('a').getAttribute('href'), '/gcsp-order-progress-live.html');
  assert.ok(main.querySelector('[role=status]'));
});
test('teardown cancels late load and missing adapter gives unavailable body', async () => {
  const main = document.createElement('main'); let resolve;
  const teardown = mountBriefBody(main, { loadEditor: () => new Promise((r) => { resolve = r; }) }); await Promise.resolve(); teardown();
  resolve(fixture.edited); await Promise.resolve(); assert.equal(main.childElementCount, 0);
  const cleanup = mountBriefBody(main, {}); await Promise.resolve(); assert.match(main.textContent, /could not be loaded/); cleanup();
});
test('typed No answers and consent save independently; failed preview preserves the focused native input', async (t) => {
  const main = document.createElement('main'); document.body.append(main); const drafts = []; const confirmations = [];
  const teardown = mountBriefBody(main, { editor: fixture.editor.value, transport: {
    preview: async () => ({ status: 'unavailable' }),
    saveDraft: async (v) => { drafts.push(v); return { status: 'ok', value: { draftVersion: 1, baseBriefVersion: 0 } }; },
    confirm: async (v) => { confirmations.push(v); return { status: 'ok', value: { brief: { briefVersion: 1 } } }; },
  }, createCommandId: (kind) => `${kind}:test` }); t.after(() => { teardown(); main.remove(); });
  for (const label of ['Do you need to carry five people?', 'Do you need at least 430 litres of carrying space?', 'Do you need a towbar?']) {
    main.querySelector(`[aria-label="${label}"]`).querySelectorAll('button')[1].click();
  }
  const hold = main.querySelector('[aria-label="Buddy permissions"]').querySelectorAll('button')[1]; hold.click();
  const input = main.querySelector('[aria-label="Comfort: what you prefer"]'); input.focus(); input.value = '89'; input.dispatchEvent(new dom.window.Event('input'));
  await settle(); assert.equal(document.activeElement, input); assert.equal(main.querySelector('[aria-label="Comfort: what you prefer"]'), input);
  assert.match(main.textContent, /Preview unavailable/);
  main.querySelector('[data-save-brief]').click(); await settle();
  assert.deepEqual(confirmations[0].consent, { search: false, hold: true });
  assert.deepEqual(['seats', 'boot', 'equipment'].map((key) => drafts[0].brief.essentials[key].value), [0, 0, []]);
  assert.equal(drafts[0].brief.essentials.charging.value, null); assert.match(main.textContent, /Your buddy is off/);
});
test('retry stays under the original teardown and suppresses its late response', async () => {
  const main = document.createElement('main'); let attempts = 0; let resolve;
  const teardown = mountBriefBody(main, { loadEditor: async () => { attempts += 1; return attempts === 1 ? { status: 'unavailable' } : new Promise((r) => { resolve = r; }); } });
  await new Promise((r) => setTimeout(r, 0));
  main.querySelector('button').click(); await Promise.resolve(); teardown(); resolve(fixture.edited);
  await Promise.resolve(); assert.equal(main.childElementCount, 0);
});
test('an adapter assigned before custom-element definition survives upgrade', async () => {
  const { defineGcspBrief } = await import('../../blocks/gcsp/brief/gcsp-brief.js');
  const element = document.createElement('gcsp-brief');
  element.adapter = { loadAccount: async () => ({ status: 'ready', name: 'Synthetic employee' }), editor: fixture.edited.value,
    transport: { preview: async () => fixture.preview, saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }) } };
  document.body.append(element); defineGcspBrief(dom.window.customElements);
  await new Promise((r) => setTimeout(r, 0));
  try { assert.match(element.textContent, /What matters to you/); assert.equal(Object.hasOwn(element, 'adapter'), false); }
  finally { element.remove(); }
});
test('standard element adapter mounts the shell and disconnect cleanup cancels pending editor work', async () => {
  const { defineGcspBrief, mountBrief } = await import('../../blocks/gcsp/brief/gcsp-brief.js');
  defineGcspBrief(dom.window.customElements);
  const element = document.createElement('gcsp-brief'); let resolve; let loads = 0;
  element.adapter = { loadAccount: async () => ({ status: 'ready', name: 'Synthetic employee', context: 'Choices' }), loadEditor: () => { loads += 1; return new Promise((r) => { resolve = r; }); } };
  document.body.append(element); await new Promise((r) => setTimeout(r, 0));
  assert.equal(loads, 1); element.remove(); resolve(fixture.edited); await Promise.resolve(); assert.equal(element.childElementCount, 0);
  const abort = new AbortController(); abort.abort(); const main = document.createElement('div');
  mountBrief(main, { signal: abort.signal, loadAccount: async () => { throw Error('Must not load'); } }); assert.equal(main.childElementCount, 0);
});

test('exact card projection preserves service evidence, identity and sourced image caption', async () => {
  const { decisionView } = await import('../../blocks/gcsp/brief/brief-view-model.js');
  const decision = fixture.preview.value.decisions[0]; const view = decisionView(decision); const member = view.members[0];
  assert.equal(view.schemaVersion, 1); assert.equal(member.identity.orderUuid, decision.orderUuid);
  assert.equal(member.identity.configurationId, decision.configurationId); assert.deepEqual(member.evidence, decision);
  assert.deepEqual(member.checks.find((entry) => entry.code === 'driver-eligible').fact, decision.reasons[0].fact);
  assert.ok(member.decision.reasons.every((entry) => !member.checks.some((check) => check.code === entry.code)));
  assert.equal(member.media.caption, decision.snapshot.display.images[0].caption); assert.equal(member.actions.length, 0);
  assert.equal(member.terms[0].value, decision.terms.points.value); assert.equal(member.terms[0].allowance, decision.terms.allowanceInputs.allowance.value);
  assert.equal(member.decision.tradeOffs[0].score, decision.tradeOffs[0].score); assert.match(member.decision.tradeOffs[0].text, /Sportiness: 23%/);
});
const stale = { status: 'stale-run', reason: 'This request belongs to an earlier demonstration run.' };
function assertRestarted(main, reloads) {
  assert.match(main.textContent, /Demo restarted/); assert.match(main.textContent, /Reload the page to continue/);
  assert.doesNotMatch(main.textContent, /stale-run|—|could not be loaded|Save failed|Preview unavailable/);
  const buttons = main.querySelectorAll('button'); assert.equal(buttons.length, 1);
  const [reload] = buttons; assert.equal(reload.type, 'button'); assert.equal(reload.disabled, false); assert.ok(reload.tabIndex >= 0);
  reload.focus(); assert.equal(document.activeElement, reload); reload.click(); assert.equal(reloads.length, 1);
}
test('a stale-run editor load shows the restarted screen, not the load failure', async (t) => {
  const main = document.createElement('main'); document.body.append(main); const reloads = []; let loads = 0;
  const teardown = mountBriefBody(main, { reload: () => reloads.push(1), loadEditor: async () => { loads += 1; return stale; } });
  t.after(() => { teardown(); main.remove(); }); await new Promise((r) => setTimeout(r, 0));
  assertRestarted(main, reloads); assert.equal(loads, 1);
});
test('a stale-run preview shows the restarted screen and schedules no more previews', async (t) => {
  const main = document.createElement('main'); document.body.append(main); const reloads = []; let previews = 0;
  const teardown = mountBriefBody(main, { reload: () => reloads.push(1), editor: fixture.edited.value, transport: {
    preview: async () => { previews += 1; return stale; }, saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }) } });
  t.after(() => { teardown(); main.remove(); }); await settle();
  assertRestarted(main, reloads); await settle(); assert.equal(previews, 1);
});
test('a stale-run save shows the restarted screen and never sends the confirmation', async (t) => {
  const main = document.createElement('main'); document.body.append(main); const reloads = []; const drafts = []; let confirms = 0;
  const teardown = mountBriefBody(main, { reload: () => reloads.push(1), editor: fixture.editor.value, transport: {
    preview: async () => ({ status: 'unavailable' }), saveDraft: async (v) => { drafts.push(v); return stale; }, confirm: async () => { confirms += 1; return stale; } },
    createCommandId: (kind) => `${kind}:test` });
  t.after(() => { teardown(); main.remove(); }); await settle();
  main.querySelector('[data-save-brief]').click(); await settle();
  assertRestarted(main, reloads); await settle(); assert.equal(drafts.length, 1); assert.equal(confirms, 0);
});
test('a stale-run confirmation shows the restarted screen after one draft and one confirm', async (t) => {
  const main = document.createElement('main'); document.body.append(main); const reloads = []; let drafts = 0; let confirms = 0;
  const teardown = mountBriefBody(main, { reload: () => reloads.push(1), editor: fixture.editor.value, transport: {
    preview: async () => ({ status: 'unavailable' }), saveDraft: async () => { drafts += 1; return { status: 'ok', value: { draftVersion: 1, baseBriefVersion: 0 } }; },
    confirm: async () => { confirms += 1; return stale; } }, createCommandId: (kind) => `${kind}:test` });
  t.after(() => { teardown(); main.remove(); }); await settle();
  main.querySelector('[data-save-brief]').click(); await settle();
  assertRestarted(main, reloads); await settle(); assert.deepEqual([drafts, confirms], [1, 1]);
});
