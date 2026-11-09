// Authored consumer contract checks only. Samples/ports do not prove live 102/106/107 composition or identity.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';
import { createOfferHttpTransport } from '../../blocks/gcsp/offer/http-adapter.js';

const sample = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url)));
const handle = { decisionId: `offer-decision:${'a'.repeat(64)}` };
const otherHandle = { decisionId: `offer-decision:${'b'.repeat(64)}` };
const dto = (followup = handle) => ({ ...structuredClone(sample), state: 'declined', reason: 'declined',
  offerState: 'rejected', holdState: 'released', availableActions: [], followup: structuredClone(followup) });
const project = (value) => toOfferPresentation({ status: 'ok', value });
const presentation = (followup = handle) => project(dto(followup));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let dom;
before(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  Object.assign(globalThis, { document: dom.window.document, window: dom.window,
    HTMLElement: dom.window.HTMLElement, customElements: dom.window.customElements });
});
after(() => dom.window.close());
beforeEach(() => document.body.replaceChildren());
const root = () => { const value = document.createElement('div'); document.body.append(value); return value; };

test('only the exact opaque handle crosses a consistent terminal declined DTO; legacy/malformed sources stay declined', () => {
  const original = dto(); const outcome = project(original);
  assert.equal(outcome.status, 'ok'); assert.deepEqual(outcome.value.followup, handle);
  outcome.value.followup.decisionId = otherHandle.decisionId; assert.deepEqual(original.followup, handle);
  const invalid = [null, {}, [], handle.decisionId, { decisionId: 'offer-decision:short' },
    { decisionId: `offer-decision:${'A'.repeat(64)}` }, { decisionId: handle.decisionId + '\n' },
    { ...handle, employeeId: 'must-not-cross' }, { ...handle, [Symbol('extra')]: true }];
  for (const followup of invalid) {
    const input = dto(null); input.followup = followup;
    const result = project(input); assert.equal(result.value.state, 'declined'); assert.equal(result.value.followup, null);
    assert.equal(JSON.stringify(result).includes('must-not-cross'), false);
  }
  const legacy = dto(); delete legacy.followup; assert.equal(project(legacy).value.followup, null);
  for (const state of ['pending', 'accepted', 'expired', 'superseded']) {
    assert.equal(project({ ...dto(), state }).value.followup, null);
  }
  for (const inconsistent of [{ offerState: 'offered' }, { holdState: 'allocated' }]) {
    const result = project({ ...dto(), ...inconsistent });
    assert.equal(result.value.state, 'declined'); assert.equal(result.value.followup, null);
  }
});

test('controller clones only the strict handle and clears it on nonterminal or unavailable reads', async (t) => {
  let next = presentation(); const c = createOfferController({ read: async () => next }); t.after(c.destroy);
  const first = await c.refresh(); assert.deepEqual(first.followup, handle);
  first.followup.decisionId = otherHandle.decisionId; assert.deepEqual(c.snapshot().followup, handle);
  next = { status: 'ok', value: { ...presentation().value, followup: { ...handle, private: 'hidden' } } };
  assert.equal((await c.refresh()).followup, null);
  next = { status: 'ok', value: { ...presentation().value, state: 'uncertain' } };
  assert.equal((await c.refresh()).followup, null);
  next = { status: 'unavailable' }; const failed = await c.refresh();
  assert.equal(failed.state, 'error'); assert.equal(failed.followup, undefined);
});

test('decision response cannot supply an entry; authoritative decline readback and later reload do', async (t) => {
  for (const lost of [false, true]) {
    let next = project(structuredClone(sample)); let posts = 0;
    const c = createOfferController({ read: async () => next, createCommandId: () => 'consumer-contract-command',
      readReasons: async () => ({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'contract',
        reasons: [{ code: 'reason', label: 'A server reason', attribute: 'body' }] } }),
      decide: async () => {
        posts++; next = presentation(null);
        if (lost) throw Error('Response deliberately lost by contract port.');
        return { status: 'ok', value: { decisionId: otherHandle.decisionId } };
      } });
    t.after(c.destroy); await c.refresh(); await c.decision('decline');
    await c.decision('decline', { reasonCode: 'reason' });
    assert.equal(c.snapshot().state, 'declined'); assert.equal(c.snapshot().followup, null); assert.equal(posts, 1);
    next = presentation(); await c.refresh(); assert.deepEqual(c.snapshot().followup, handle); assert.equal(posts, 1);
    // A reload begins only with the read projection; no successful POST payload is available.
    const reloaded = createOfferController({ read: async () => next }); t.after(reloaded.destroy);
    assert.deepEqual((await reloaded.refresh()).followup, handle);
  }
});

test('email/account URL parser still refuses any decisionId selector', async () => {
  let calls = 0;
  const transport = createOfferHttpTransport({
    location: { href: `https://example.test/gcsp/offer?offerId=one&runId=run&decisionId=${handle.decisionId}` },
    fetch: async () => { calls++; throw Error('Invalid entry must not request.'); } });
  assert.equal(transport.reference, null); assert.equal((await transport.read()).status, 'not-found'); assert.equal(calls, 0);
});

test('declined unavailable view retains outcome, explicit refresh and zero decline commands', (t) => {
  const element = root(); let reads = 0; let mounts = 0; let posts = 0;
  const view = createOfferView(element, { refresh: () => { reads++; }, decide: () => { posts++; },
    mountFollowup: () => { mounts++; return () => {}; } }); t.after(view.destroy);
  view.update(presentation(null).value);
  assert.match(element.textContent, /Offer declined.*Your decline is recorded.*Follow-up unavailable/s);
  assert.equal(element.querySelectorAll('[data-offer-action="decline"], [data-offer-action="accept"]').length, 0);
  element.querySelector('[data-offer-action="refresh"]').click();
  assert.equal(reads, 1); assert.equal(posts, 0); assert.equal(mounts, 0);
});

test('unchanged reads preserve the mounted question and focus; changed entry tears it down', (t) => {
  const element = root(); let mounts = 0; let stops = 0; let latest = presentation().value;
  const view = createOfferView(element, { refresh: () => view.update(latest), mountFollowup: (target, input) => {
    assert.deepEqual(input, latest.followup); mounts++;
    const control = document.createElement('input'); control.setAttribute('aria-label', 'Contract question'); target.replaceChildren(control);
    return () => { stops++; target.replaceChildren(); };
  } }); t.after(view.destroy);
  view.update(latest); const input = element.querySelector('input'); const card = element.querySelector('.vm-card'); input.focus();
  view.update({ ...latest, now: '2026-11-06T01:01:00Z' });
  assert.equal(mounts, 1); assert.equal(stops, 0); assert.equal(document.activeElement, input);
  assert.equal(element.querySelector('.vm-card'), card);
  latest = presentation(null).value; view.update(latest);
  assert.equal(stops, 1); assert.equal(document.activeElement.dataset.offerAction, 'refresh');
  latest = presentation().value; view.update(latest); assert.equal(mounts, 2);
  element.querySelector('[data-offer-action="refresh"]').click(); assert.equal(stops, 2); assert.equal(mounts, 3);
});

test('host requires fresh trusted account readiness; displayed account and offer handle do not grant it', async (t) => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const element = root(); let accountReads = 0; let mounts = 0;
  const stop = mountOffer(element, { account: { status: 'ready', name: 'Display only' }, read: async () => presentation(),
    followup: { loadAccount: async () => { accountReads++; return { status: 'unavailable' }; },
      mount: () => { mounts++; return () => {}; } } }); t.after(stop);
  await settle(); assert.equal(accountReads, 1); assert.equal(mounts, 0);
  assert.match(element.textContent, /Offer declined.*Follow-up unavailable.*account/s);
  await stop.refresh(); await settle(); assert.equal(accountReads, 1); // Polls do not loop authentication.
  element.querySelector('[data-offer-action="refresh"]').click(); await settle(); assert.equal(accountReads, 2);
});

test('host forwards only the selector and abort signal after readiness and tears down on a changed authoritative entry', async (t) => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const element = root(); let next = presentation(); let input; let stops = 0;
  const stop = mountOffer(element, { read: async () => next, followup: {
    loadAccount: async () => ({ status: 'ready' }), mount: (target, context) => {
      input = context; target.textContent = 'Contract follow-up mounted'; return () => { stops++; };
    } } }); t.after(stop);
  await settle(); assert.deepEqual(Object.keys(input).sort(), ['decisionId', 'signal']);
  assert.equal(input.decisionId, handle.decisionId); assert.equal(input.signal.aborted, false);
  next = presentation(null); await stop.refresh();
  assert.equal(stops, 1); assert.equal(input.signal.aborted, true); assert.match(element.textContent, /Follow-up unavailable/);
});

test('late account reply after disconnect never mounts a follow-up', async () => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const account = deferred(); let signal; let mounts = 0;
  const stop = mountOffer(root(), { read: async () => presentation(), followup: {
    loadAccount: ({ signal: supplied }) => { signal = supplied; return account.promise; },
    mount: () => { mounts++; return () => {}; } } });
  await settle(); stop(); assert.equal(signal.aborted, true);
  account.resolve({ status: 'ready' }); await settle(); assert.equal(mounts, 0);
});

test('throwing follow-up mount stays unavailable until explicit refresh; decline is never retried', async (t) => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  let mounts = 0; let posts = 0; const element = root();
  const stop = mountOffer(element, { read: async () => presentation(), decide: async () => { posts++; }, followup: {
    loadAccount: async () => ({ status: 'ready' }), mount: () => { mounts++; throw Error('Private detail must not render'); } } }); t.after(stop);
  await settle(); assert.equal(mounts, 1); assert.match(element.textContent, /Follow-up unavailable/);
  assert.equal(element.textContent.includes('Private detail'), false);
  await stop.refresh(); await settle(); assert.equal(mounts, 1);
  element.querySelector('[data-offer-action="refresh"]').click(); await settle(); assert.equal(mounts, 2); assert.equal(posts, 0);
});

// GC-042: the declined page is one h1, one summary line, then the change question; focus follows Decline to that question.
const questionTransport = (decisionId) => ({ confirm: async () => ({ status: 'unavailable' }), read: async () => ({ status: 'ok', value: {
  schemaVersion: 1, state: 'question', decisionId, briefVersion: 2, question: { schemaVersion: 1, questionVersion: 'q1', policyVersion: 'p1',
    reasonCode: 'body-style', path: 'preferences.body.value', prompt: 'Which body style would you prefer?', currentValue: 'estate',
    control: { kind: 'options', options: ['hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv'].map((value) => ({ value, label: value === 'coupe' ? 'Coupe' : value === 'mpv' ? 'MPV' : value })) } } } }) });
async function declinedPage(t, { before } = {}) {
  const { mountFollowupBody } = await import('../../blocks/gcsp/offer-followup/gcsp-offer-followup.js');
  const element = root(); let latest = presentation().value;
  const view = createOfferView(element, { refresh: () => view.update(latest),
    mountFollowup: (target, input) => mountFollowupBody(target, { ...input, hostRefresh: true, headingLevel: 2, transport: questionTransport(input.decisionId) }) });
  t.after(view.destroy);
  if (before) { view.update({ ...latest, state: 'uncertain', canAccept: false, canDecline: false }); before(element); }
  view.update(latest); await settle();
  return { element, view, latest };
}

test('GC-042: declined page is one h1, a one-line summary and then the change question as an h2', async (t) => {
  const { element } = await declinedPage(t);
  assert.equal(element.querySelectorAll('h1').length, 1); assert.equal(element.querySelector('h1').textContent, 'Offer declined');
  assert.equal(element.querySelector('.vm-card'), null); assert.equal(element.querySelector('.gcsp-offer-current'), null);
  assert.doesNotMatch(element.textContent, /Your current car|Your next offer/);
  const summary = element.querySelector('[data-offer-declined-summary]');
  assert.match(summary.textContent, /^You declined the .+, [\d,]+ points a month\.$/); assert.doesNotMatch(summary.textContent, /\u2014/);
  assert.equal(summary.previousElementSibling.textContent, 'Your decline is recorded.');
  const next = summary.nextElementSibling; assert.equal(next.getAttribute('aria-label'), 'Your next offer');
  assert.equal(next.querySelector('h1, h2, h3').tagName, 'H2'); assert.equal(next.querySelector('h2').textContent, 'One change to your brief');
  assert.deepEqual([...next.querySelectorAll('[role=radio]')].map((node) => node.textContent).slice(-3), ['Coupé', 'Convertible', 'Family carrier']);
});

test('GC-042: after Decline focus moves to the change question; later polls and unfocused opens do not steal it', async (t) => {
  const { element, view, latest } = await declinedPage(t, { before: (page) => page.querySelector('[data-offer-action="refresh"]').focus() });
  assert.equal(document.activeElement.tagName, 'H2'); assert.equal(document.activeElement.textContent, 'One change to your brief');
  view.update({ ...latest, now: '2026-11-06T01:01:00Z' }); await settle();
  assert.equal(document.activeElement.textContent, 'One change to your brief');
  element.querySelector('[data-offer-action="refresh"]').focus(); view.update({ ...latest, now: '2026-11-06T01:02:00Z' }); await settle();
  assert.equal(document.activeElement.dataset.offerAction, 'refresh');
  document.body.replaceChildren(); const fresh = await declinedPage(t);
  assert.notEqual(document.activeElement.tagName, 'H2'); assert.ok(fresh.element.querySelector('h2'));
});
