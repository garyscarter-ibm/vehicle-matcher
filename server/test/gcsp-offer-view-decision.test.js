// Consumer contract checks only. Injected HTTP responses are not actual106,
// canonical reason activation, deployed-cookie, remote or browser evidence.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createOfferHttpAdapter } from '../../blocks/gcsp/offer/http-adapter.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';

const handoff = { termsVersion: 'terms-v1', termsDigest: 'terms-digest-1', wording: 'Fictional terms.', fictional: true, mode: 'new', blocker: null,
  contact: { phone: '07700 900123', email: 'p@example.invalid' }, returnCar: null,
  declarations: [{ id: 'terms', label: 'Terms.' }, { id: 'driver', label: 'Driver.' }] };
const tickAll = (controller) => { controller.tickDeclaration('terms', true); controller.tickDeclaration('driver', true); };
const sample = { ...JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-access.json', import.meta.url))), handoff };
const declineSample = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-decline-access.json', import.meta.url)));
const registry = () => ({ schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'contract-input-v1',
  reasons: [{ code: 'test-body', label: 'Contract input body reason', attribute: 'body' }] });
const response = (value, ok = true) => ({ ok, headers: { get: () => 'application/json' }, json: async () => structuredClone(value) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
let dom;
before(() => { dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement, customElements: dom.window.customElements }); });
after(() => dom.window.close());
beforeEach(() => document.body.replaceChildren());

function setup(t, { initial = sample, reasonRead, command, read, href } = {}) {
  let dto = structuredClone(initial); let reasons = registry(); const calls = []; const changes = [];
  const adapter = createOfferHttpAdapter({ enableDecisions: true,
    location: { href: href || `https://example.test/gcsp/offer?offerId=${dto.offerId}&runId=${dto.runId}` },
    history: { replaceState: (...args) => changes.push(args) },
    fetch: async (url, options) => {
      const path = new URL(url).pathname; calls.push({ url, options });
      if (path.endsWith('/decision-reasons')) return reasonRead ? reasonRead({ url, options, reasons }) : response({ status: 'ok', value: reasons });
      if (path.endsWith('/decision')) return command ? command({ url, options, dto, setDTO: (value) => { dto = value; } }) : response({ status: 'ok', value: { state: 'declined' } });
      return read ? read({ url, options, dto }) : response({ status: 'ok', value: dto });
    } });
  const controller = createOfferController({ ...adapter, createCommandId: () => 'one-logical-command' });
  t.after(() => controller.destroy());
  return { adapter, controller, calls, changes, setDTO: (value) => { dto = structuredClone(value); },
    setReasons: (value) => { reasons = structuredClone(value); } };
}

test('accept sends only exact106 intent and all three server revisions, then trusts GET over POST', async (t) => {
  const f = setup(t); const before = await f.controller.refresh();
  await f.controller.decision('accept'); assert.equal(f.calls.find((call) => call.options.method === 'POST'), undefined); // Declarations unticked.
  tickAll(f.controller); await f.controller.decision('accept');
  const posted = f.calls.find((call) => call.options.method === 'POST');
  assert.equal(posted.url, `https://example.test/api/gcsp/offers/${encodeURIComponent(sample.offerId)}/decision`);
  assert.deepEqual(JSON.parse(posted.options.body), { commandId: 'one-logical-command', runId: sample.runId, decision: 'accept',
    expectedOfferVersion: sample.offerVersion, expectedHoldVersion: sample.holdVersion, expectedQuoteVersion: sample.quote.revisions.quote,
    termsDigest: 'terms-digest-1', declarations: { terms: true, driver: true } });
  assert.equal(f.controller.snapshot().state, 'pending'); // The POST spy cannot establish a declined or accepted outcome.
  assert.equal(f.controller.snapshot().expiresAt, before.expiresAt);
  assert.equal(f.controller.snapshot().card.members[0].terms[0].value, 1100);
  assert.equal(posted.options.credentials, 'same-origin'); assert.equal(posted.options.mode, 'same-origin');
  assert.equal(posted.options.cache, 'no-store'); assert.equal(posted.options.redirect, 'error'); assert.equal(posted.options.referrerPolicy, 'no-referrer');
});

test('unbound, changed or untrusted command fields fail before transport', async (t) => {
  const f = setup(t); const offer = (await f.controller.refresh()).reference;
  const valid = { kind: 'accept', offer, commandId: 'command', termsDigest: 'terms-digest-1', declarations: { terms: true } }; const before = f.calls.length;
  for (const input of [{ ...valid, employeeId: 'browser-claim' }, { ...valid, termsDigest: undefined }, { ...valid, declarations: {} },
    { ...valid, declarations: { terms: false } }, { ...valid, declarations: { terms: 'yes' } }, { ...valid, declarations: undefined },
    { kind: 'decline', offer, commandId: 'command', reasonCode: 'test-body', termsDigest: 'terms-digest-1' },
    { kind: 'decline', offer, commandId: 'command', reasonCode: 'test-body', declarations: { terms: true } }, { ...valid, token: 'browser-claim' },
    { ...valid, reasonCode: 'test-body' }, { ...valid, commandId: '' }, { ...valid, kind: 'select' },
    ...[{ ...offer, quoteVersion: undefined }, { ...offer, holdVersion: 0 }, { ...offer, quoteVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...offer, offerId: 'another' }, { ...offer, runId: 'another' }, { ...offer, policyVersion: 'browser-claim' }].map((value) => ({ ...valid, offer: value }))]) {
    assert.notEqual((await f.adapter.decide(input)).status, 'ok');
  }
  assert.equal(f.calls.length, before);
  for (const options of [null, false, 'test-body', []]) await f.controller.decision('decline', options);
  assert.equal(f.calls.length, before);
});

test('reason keyboard focus remains usable when the authoritative hold deadline is reached', async (t) => {
  const f = setup(t); const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root); t.after(() => view.destroy());
  f.controller.subscribe(view.update); await f.controller.refresh(); await f.controller.decision('decline');
  const select = root.querySelector('select'); select.focus();
  f.setDTO({ ...sample, serverNow: sample.expiresAt }); await f.controller.refresh();
  assert.equal(select.disabled, true);
  assert.equal(document.activeElement.dataset.offerAction, 'decline-cancel');
  assert.equal(f.calls.some((call) => call.options.method === 'POST'), false);
});

test('nested offer preview composes existing base and shell styles before offer styles', async () => {
  const preview = new URL('../../blocks/gcsp/offer/preview.html', import.meta.url);
  const html = await readFile(preview, 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(links, ['../../vehicle-matcher/vehicle-matcher.css', '../shell/gcsp-shell.css', './gcsp-offer.css']);
  for (const path of links) assert.ok((await readFile(new URL(path, preview), 'utf8')).length > 0);
  assert.match(await readFile(new URL('./gcsp-offer.css', preview), 'utf8'), /@import "\.\.\/kit\/form-controls\.css";/);
});

test('decline opens a server-listed reason prompt; loading, required, unknown and cancel never submit', async (t) => {
  const waiting = deferred(); const f = setup(t, { reasonRead: () => waiting.promise }); await f.controller.refresh(); tickAll(f.controller);
  const loading = f.controller.decision('decline');
  assert.equal(f.controller.snapshot().declineReason.status, 'loading'); assert.equal(f.controller.snapshot().canAccept, false);
  await f.controller.decision('decline', { reasonCode: 'test-body' });
  assert.equal(f.calls.filter((call) => call.options.method === 'POST').length, 0);
  waiting.resolve(response({ status: 'ok', value: registry() })); await loading;
  await f.controller.decision('decline', { reasonCode: '' }); assert.equal(f.controller.snapshot().declineReason.error, 'Choose a reason.');
  await f.controller.decision('decline', { reasonCode: 'invented' }); assert.match(f.controller.snapshot().declineReason.error, /current list/);
  f.controller.cancelDecline(); assert.equal(f.controller.snapshot().declineReason.open, false); assert.equal(f.controller.snapshot().canAccept, true);
  assert.equal(f.calls.filter((call) => call.options.method === 'POST').length, 0);
});

test('one fragment exchange precedes reasons and exact decline; no credential enters decision body or URL', async (t) => {
  const token = 'explicit-contract-credential'; const f = setup(t, {
    href: `https://example.test/gcsp/offer?offerId=${sample.offerId}&runId=${sample.runId}#token=${token}` });
  assert.equal(f.calls.length, 0); assert.equal(f.changes[0][2].includes('#'), false);
  await f.controller.refresh(); await f.controller.decision('decline');
  await f.controller.decision('decline', { reasonCode: 'test-body' });
  const posts = f.calls.filter((call) => call.options.method === 'POST'); assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[0].options.body).token === token, true);
  assert.equal(posts[1].options.body.includes(token), false); assert.ok(f.calls.every((call) => !call.url.includes(token)));
  assert.deepEqual(JSON.parse(posts[1].options.body), { commandId: 'one-logical-command', runId: sample.runId, decision: 'decline',
    reasonCode: 'test-body', expectedOfferVersion: sample.offerVersion, expectedHoldVersion: sample.holdVersion,
    expectedQuoteVersion: sample.quote.revisions.quote });
  assert.equal(f.controller.snapshot().state, 'pending');
});

test('malformed or unavailable registries expose no fallback reasons or decision', async (t) => {
  for (const value of [null, {}, { ...registry(), key: 'other' }, { ...registry(), reasons: [] },
    { ...registry(), reasons: [registry().reasons[0], registry().reasons[0]] },
    { ...registry(), reasons: [{ code: 'test', label: '', attribute: 'body' }] }]) {
    const f = setup(t, { reasonRead: async () => response({ status: 'ok', value }) });
    await f.controller.refresh(); await f.controller.decision('decline');
    assert.equal(f.controller.snapshot().declineReason.status, 'unavailable'); assert.deepEqual(f.controller.snapshot().declineReason.choices, []);
    await f.controller.decision('decline', { reasonCode: 'test-body' });
    assert.equal(f.calls.filter((call) => call.options.method === 'POST').length, 0);
  }
});

test('reason projection omits private extras and renders server text safely', async (t) => {
  const f = setup(t); const supplied = registry(); supplied.employeeId = 'private'; supplied.reasons[0].secret = 'private';
  supplied.reasons[0].label = '<img src=x onerror=alert(1)>'; f.setReasons(supplied);
  await f.controller.refresh(); await f.controller.decision('decline');
  assert.equal(JSON.stringify(f.controller.snapshot().declineReason).includes('private'), false);
  const root = document.createElement('main'); document.body.append(root); const view = createOfferView(root); t.after(view.destroy);
  view.update(f.controller.snapshot());
  assert.equal(root.querySelector('select option[value="test-body"]').textContent, supplied.reasons[0].label);
  assert.equal(root.querySelectorAll('[onerror], script').length, 0);
});

test('a new registry or offer revision refreshes choices while preserving card, deadline and mounted control', async (t) => {
  const f = setup(t); const root = document.createElement('main'); document.body.append(root);
  const view = createOfferView(root, { selectReason: f.controller.selectDeclineReason }); const unsubscribe = f.controller.subscribe(view.update);
  t.after(() => { unsubscribe(); view.destroy(); });
  await f.controller.refresh(); await f.controller.decision('decline'); f.controller.selectDeclineReason('test-body');
  const select = root.querySelector('select'); const card = root.querySelector('.vm-card'); select.focus();
  f.setReasons({ ...registry(), policyVersion: 'contract-input-v2', reasons: [{ code: 'changed', label: 'Changed reason', attribute: 'body' }] });
  const next = structuredClone(sample); next.offerVersion += 1; f.setDTO(next); await f.controller.refresh();
  assert.equal(root.querySelector('select'), select); assert.equal(root.querySelector('.vm-card'), card);
  assert.equal(document.activeElement, root.querySelector('.gcsp-error-summary h2'));
  assert.equal(f.controller.snapshot().declineReason.selectedCode, ''); assert.match(root.textContent, /current list/);
  assert.equal(f.controller.snapshot().reference.offerVersion, next.offerVersion); assert.equal(f.controller.snapshot().expiresAt, sample.expiresAt);
});

test('decline-only authority cannot accept and confirmed choice waits for authoritative terminal read', async (t) => {
  const f = setup(t, { initial: declineSample, command: async ({ dto, setDTO }) => {
    setDTO({ ...dto, state: 'declined', reason: 'declined', offerState: 'rejected', holdState: 'released', availableActions: [] });
    return response({ status: 'ok', value: { state: 'declined' } });
  } });
  const initial = await f.controller.refresh(); assert.equal(initial.canAccept, false); assert.equal(initial.canDecline, true);
  await f.controller.decision('accept'); assert.equal(f.calls.length, 1);
  await f.controller.decision('decline'); await f.controller.decision('decline', { reasonCode: 'test-body' });
  assert.equal(f.controller.snapshot().state, 'declined'); assert.equal(f.controller.snapshot().canDecline, false);
  assert.equal(f.controller.snapshot().expiresAt, sample.expiresAt);
});

test('lost response or failed readback never fabricates success; confirmed readback wins after a lost response', async (t) => {
  let unavailableRead = false;
  const f = setup(t, { command: async () => { unavailableRead = true; throw Error('contract transport loss'); },
    read: async ({ dto }) => unavailableRead ? response({ status: 'unavailable' }, false) : response({ status: 'ok', value: dto }) });
  await f.controller.refresh(); tickAll(f.controller); await f.controller.decision('accept'); assert.equal(f.controller.snapshot().state, 'uncertain');
  const confirmed = setup(t, { command: async ({ dto, setDTO }) => {
    setDTO({ ...dto, state: 'accepted', reason: 'accepted', offerState: 'accepted', holdState: 'allocated', availableActions: [], handoff: null });
    throw Error('contract transport loss after commit');
  } });
  await confirmed.controller.refresh(); tickAll(confirmed.controller); await confirmed.controller.decision('accept'); assert.equal(confirmed.controller.snapshot().state, 'accepted');
});

test('stale command refreshes actual server-listed reasons without claiming a decline', async (t) => {
  const f = setup(t, { command: async () => response({ status: 'stale-version', action: 'refresh' }, false) });
  await f.controller.refresh(); await f.controller.decision('decline'); await f.controller.decision('decline', { reasonCode: 'test-body' });
  assert.equal(f.controller.snapshot().state, 'pending'); assert.equal(f.controller.snapshot().declineReason.open, true);
  assert.match(f.controller.snapshot().declineReason.error, /offer changed/);
  assert.equal(f.calls.filter((call) => new URL(call.url).pathname.endsWith('/decision-reasons')).length, 2);
});

test('cancel, access failure and teardown ignore late reason responses', async (t) => {
  for (const action of ['cancel', 'unavailable', 'destroy']) {
    const waiting = deferred(); const f = setup(t, { reasonRead: () => waiting.promise }); await f.controller.refresh();
    const loading = f.controller.decision('decline');
    if (action === 'cancel') f.controller.cancelDecline();
    else if (action === 'destroy') f.controller.destroy();
    else { f.setDTO(null); await f.controller.refresh(); }
    waiting.resolve(response({ status: 'ok', value: registry() })); await loading;
    assert.notEqual(f.controller.snapshot().declineReason?.status, 'ready');
  }
});

test('mounted custom element wires reason validation, cancellation, confirmation and teardown', async (t) => {
  const f = setup(t); const { defineGcspOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js'); defineGcspOffer();
  const host = document.createElement('gcsp-offer'); host.adapter = { ...f.adapter, createCommandId: () => 'mounted-command' };
  document.body.append(host); t.after(() => host.remove()); await turn();
  host.querySelector('[data-offer-action="decline"]').click(); await turn();
  const select = host.querySelector('select'); assert.equal(document.activeElement, select);
  host.querySelector('[data-offer-action="decline-confirm"]').click(); await turn();
  assert.match(host.textContent, /Choose a reason\./); assert.equal(select.getAttribute('aria-invalid'), 'true');
  select.value = 'test-body'; select.dispatchEvent(new dom.window.Event('change')); assert.equal(select.getAttribute('aria-invalid'), 'false');
  host.querySelector('[data-offer-action="decline-cancel"]').click(); assert.equal(document.activeElement.dataset.offerAction, 'decline');
  host.querySelector('[data-offer-action="decline"]').click(); await turn();
  select.value = 'test-body'; select.dispatchEvent(new dom.window.Event('change'));
  host.querySelector('[data-offer-action="decline-confirm"]').click(); await turn();
  assert.equal(f.calls.filter((call) => call.options.method === 'POST').length, 1);
  host.remove(); assert.equal(host.querySelector('.gcsp-offer-body'), null);
});
