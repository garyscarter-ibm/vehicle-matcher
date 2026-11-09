// FUCQ-97: presenter outbox viewer states, message view, link safety, adapter mapping and embedding rules.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = join(ROOT, 'blocks/gcsp/presenter');
let out;
let list;
let fixtures;
let adapterMod;
let copy;

function installDom() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name] ?? globalThis[name], configurable: true, writable: true });
  }
}
before(async () => {
  installDom();
  out = await import('../../blocks/gcsp/presenter/gcsp-outbox.js');
  list = await import('../../blocks/gcsp/presenter/message-list.js');
  fixtures = await import('../../blocks/gcsp/presenter/fixtures.js');
  adapterMod = await import('../../blocks/gcsp/presenter/http-adapter.js');
  copy = await import('../../blocks/gcsp/presenter/outbox-copy.js');
});
beforeEach(() => document.body.replaceChildren());

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };
async function mountFixture(name) {
  const root = host();
  const adapter = fixtures.fixtureAdapter(name);
  const teardown = out.mountOutbox(root, { loadMessages: adapter.loadMessages });
  await tick();
  return { root, teardown };
}
const rows = (root) => [...root.querySelectorAll('.gcsp-mail-row')];
const enter = (node) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

test('the shell shows a presenter account, the Captured emails destination and honest unavailable items', async () => {
  const { root } = await mountFixture('messages');
  assert.equal(root.querySelector('.gcsp-account-name').textContent, 'Presenter');
  assert.equal(root.querySelector('.gcsp-nav-btn[aria-current="page"]').dataset.key, 'outbox');
  assert.ok(root.querySelectorAll('.gcsp-nav-btn[aria-disabled="true"]').length >= 2);
  assert.match(root.querySelector('main').textContent, /Captured messages and delivery status\./);
  assert.equal(root.querySelectorAll('main h1').length, 1);
});

test('the messages fixture lists rows newest first with recipient, subject, demo-clock time and status', async () => {
  const { root } = await mountFixture('messages');
  const items = rows(root);
  assert.deepEqual(items.map((b) => b.dataset.id), ['job-004', 'job-003', 'job-002', 'job-001']);
  assert.ok(items.every((b) => b.tagName === 'BUTTON' && b.parentElement.tagName === 'LI'));
  const first = items[0];
  assert.match(first.querySelector('.gcsp-mail-to').textContent, /Paula/);
  assert.match(first.querySelector('.gcsp-mail-subject').textContent, /vehicle offer is ready/);
  assert.match(first.querySelector('.gcsp-mail-time').textContent, /5 Nov 2026, 09:20 GMT/);
  assert.equal(first.querySelector('.gcsp-mail-status').textContent, 'Captured, not sent');
  assert.equal(items[1].querySelector('.gcsp-mail-status').textContent, 'Retrying');
  assert.equal(items[2].querySelector('.gcsp-mail-status').textContent, 'Failed');
  assert.ok(items.every((b) => b.querySelector('.gcsp-mail-status svg')), 'status has an icon as well as text');
  assert.match(items[3].textContent, /Bartholomew Featherstonehaugh/);
  assert.equal(root.querySelectorAll('.gcsp-mail-row[aria-current]').length, 0);
});

test('Enter on a row button opens the message and moves focus to its heading', async () => {
  const { root } = await mountFixture('messages');
  const row = rows(root)[0];
  row.focus();
  assert.equal(document.activeElement, row);
  // A real browser turns Enter on a focused button into click; jsdom needs the click.
  enter(row);
  row.click();
  assert.equal(row.getAttribute('aria-current'), 'true');
  const heading = root.querySelector('.gcsp-mail-heading');
  assert.equal(heading.tagName, 'H2');
  assert.equal(heading.tabIndex, -1);
  assert.equal(document.activeElement, heading);
  assert.match(heading.textContent, /vehicle offer is ready/);
  rows(root)[1].click();
  assert.equal(root.querySelectorAll('.gcsp-mail-row[aria-current]').length, 1);
});

test('an opened sent message shows a script-less sandboxed frame via srcdoc, the plain text and the offer link', async () => {
  const { root } = await mountFixture('messages');
  rows(root)[0].click();
  const frame = root.querySelector('iframe.gcsp-mail-frame');
  assert.equal(frame.getAttribute('sandbox'), '');
  assert.equal(frame.hasAttribute('sandbox'), true);
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.ok(frame.title.length > 5);
  assert.ok(!frame.hasAttribute('src'));
  assert.match(frame.srcdoc, /<h1[^>]*>Your vehicle offer is ready to review<\/h1>/);
  assert.doesNotMatch(frame.getAttribute('sandbox'), /allow-/);
  assert.equal(root.querySelectorAll('main iframe').length, 1);
  assert.equal(root.querySelector('main h1').textContent, 'Captured emails', 'email markup is not injected into the page');
  const text = root.querySelector('pre.gcsp-mail-text');
  assert.match(text.textContent, /Review your offer: https:\/\/demo\.example\.test\/gcsp\/offer/);
  assert.match(text.textContent, /No email has been sent/);
  const link = root.querySelector('.gcsp-mail-offer a');
  assert.equal(link.getAttribute('href'), '/gcsp/offer');
  assert.equal(link.target, '_blank');
  assert.ok(link.rel.split(/\s+/).includes('noopener'));
});

test('unsafe offer links are never rendered as links', () => {
  for (const bad of ['javascript:alert(1)', '//evil.example/x', 'http://plain.example', 'https://user:pw@evil.example/', 'data:text/html,x', '/ok path', null, '']) {
    const base = fixtures.fixtureMessages()[0];
    const handle = list.messageList({ messages: [{ ...base, offerLink: bad }], selectedId: base.jobId });
    document.body.append(handle.root);
    assert.equal(handle.root.querySelectorAll('a').length, 0, String(bad));
    assert.match(handle.root.textContent, /Offer link not available/);
    handle.destroy();
  }
  assert.equal(copy.isSafeOfferLink('https://offers.example/o/1'), true);
  assert.equal(copy.isSafeOfferLink('/gcsp/offer?token=x'), true);
});

test('retrying and failed rows explain the problem in words with attempt count and next attempt time', async () => {
  const retrying = await mountFixture('retrying');
  rows(retrying.root)[0].click();
  const text = retrying.root.querySelector('.gcsp-mail-detail').textContent;
  assert.match(text, /could not be reached/);
  assert.match(text, /attempt 2/);
  assert.match(text, /next attempt is due at 5 Nov 2026, 09:17 GMT/);
  assert.equal(retrying.root.querySelectorAll('iframe, pre, .gcsp-mail-offer').length, 0);
  assert.match(rows(retrying.root)[0].textContent, /2 attempts/);
  document.body.replaceChildren();
  const failed = await mountFixture('failed');
  rows(failed.root)[0].click();
  const failedText = failed.root.querySelector('.gcsp-mail-detail').textContent;
  assert.match(failedText, /3 attempts/);
  assert.match(failedText, /expired before the email could be created/);
  assert.match(failedText, /No further attempts/);
  assert.doesNotMatch(failedText, /offer-expired/);
});

test('empty, unavailable, refused and loading render their own states', async () => {
  const empty = await mountFixture('empty');
  assert.match(empty.root.querySelector('.vm-status').textContent, /No emails yet/);
  document.body.replaceChildren();
  const unavailable = await mountFixture('unavailable');
  assert.equal(unavailable.root.querySelector('.vm-status').getAttribute('role'), 'alert');
  assert.match(unavailable.root.querySelector('.vm-status').textContent, /unavailable/);
  assert.equal(unavailable.root.querySelector('.vm-status .vm-btn').textContent, 'Retry');
  document.body.replaceChildren();
  const refused = await mountFixture('refused');
  assert.match(refused.root.querySelector('.vm-status').textContent, /Only the presenter/);
  assert.equal(refused.root.querySelector('.vm-status .vm-btn'), null);
  document.body.replaceChildren();
  const loading = await mountFixture('loading');
  assert.match(loading.root.querySelector('main').textContent, /Loading captured emails/);
  loading.teardown();
  assert.equal(loading.root.children.length, 0);
});

test('Retry and Refresh run loadMessages again, with no timers', async () => {
  let calls = 0;
  const root = host();
  const teardown = out.mountOutbox(root, { loadMessages: async () => (++calls === 1 ? { status: 'unavailable' } : { status: 'ready', messages: fixtures.fixtureMessages() }) });
  await tick();
  root.querySelector('.vm-status .vm-btn').click();
  await tick();
  assert.equal(calls, 2);
  assert.equal(rows(root).length, 4);
  rows(root)[1].click();
  [...root.querySelectorAll('.gcsp-presenter-bar .vm-btn')].find((b) => b.textContent === 'Refresh').click();
  await tick();
  assert.equal(calls, 3);
  assert.equal(root.querySelector('.gcsp-mail-row[aria-current]').dataset.id, 'job-003', 'selection survives a refresh');
  teardown();
});

test('the custom element reads fixture and adapter, is idempotent to define and tears down', async () => {
  const first = out.defineGcspOutbox(customElements);
  assert.equal(out.defineGcspOutbox(customElements), first);
  const node = document.createElement('gcsp-outbox');
  node.setAttribute('fixture', 'messages');
  const events = [];
  node.addEventListener('gcsp:ready', (e) => events.push(e.detail.view));
  document.body.append(node);
  await tick();
  assert.deepEqual(events, ['outbox']);
  assert.equal(rows(node).length, 4);
  node.adapter = { loadMessages: async () => ({ status: 'empty' }) };
  await tick();
  assert.match(node.textContent, /No emails yet/);
  node.remove();
  assert.equal(node.children.length, 0);
  const unknown = document.createElement('gcsp-outbox');
  unknown.setAttribute('fixture', 'nope');
  const reasons = [];
  unknown.addEventListener('gcsp:unavailable', (e) => reasons.push(e.detail.reason));
  document.body.append(unknown);
  await tick();
  assert.deepEqual(reasons, ['unknown-fixture']);
  assert.match(unknown.textContent, /unavailable/);
});

test('outcomeToState maps replies to view states', () => {
  const { outcomeToState } = adapterMod;
  const messages = fixtures.fixtureMessages();
  assert.deepEqual(outcomeToState(200, { status: 'ok', value: { runId: 'r', messages } }), { status: 'ready', messages });
  assert.equal(outcomeToState(200, { status: 'ok', value: { runId: 'r', messages: [] } }).status, 'empty');
  assert.equal(outcomeToState(403, { status: 'forbidden' }).status, 'refused');
  assert.equal(outcomeToState(401, { status: 'missing-session' }).status, 'refused');
  const stale = outcomeToState(409, { status: 'stale-run' });
  assert.equal(stale.status, 'refused');
  assert.match(stale.message, /reset/);
  for (const [code, body] of [[503, { status: 'unavailable' }], [500, {}], [200, { status: 'ok', value: {} }], [400, { status: 'invalid' }], [502, null]]) {
    assert.equal(outcomeToState(code, body).status, 'unavailable', String(code));
  }
});

test('the HTTP adapter calls the presenter route with credentials and maps network failure', async () => {
  const calls = [];
  const ok = adapterMod.createOutboxHttpAdapter({ base: 'https://api.test', fetchImpl: async (url, init) => { calls.push([url, init]); return { status: 200, json: async () => ({ status: 'ok', value: { messages: [] } }) }; } });
  assert.equal((await ok.loadMessages({})).status, 'empty');
  assert.equal(calls[0][0], 'https://api.test/api/gcsp/presenter/outbox');
  assert.equal(calls[0][1].credentials, 'include');
  const down = adapterMod.createOutboxHttpAdapter({ fetchImpl: async () => { throw new TypeError('network'); } });
  assert.equal((await down.loadMessages({})).status, 'unavailable');
  const garbled = adapterMod.createOutboxHttpAdapter({ fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) });
  assert.equal((await garbled.loadMessages({})).status, 'unavailable');
});

test('every documented safe error code has a plain sentence and unknown codes are handled', () => {
  for (const code of ['transport-unavailable', 'message-invalid', 'message-facts-unavailable', 'fictional-recipient-required', 'recipient-mismatch', 'message-version-unsupported', 'offer-inactive', 'offer-expired']) {
    assert.ok(copy.ERROR_COPY[code].endsWith('.'), code);
  }
  assert.match(copy.errorSentence('something-new'), /reason the demo does not list/);
  assert.equal(copy.errorSentence(null), null);
  assert.equal(copy.statusOf('pending').label, 'Sending');
  assert.equal(copy.statusOf('sent', 'captured').label, 'Captured, not sent');
  assert.equal(copy.statusOf('sent', 'configured').label, 'Sent');
  assert.equal(copy.statusOf('sent', null).label, 'Sent');
  assert.equal(copy.statusOf('failed', 'captured').label, 'Failed');
  assert.equal(copy.formatDemoTime('nonsense'), null);
});

// ---------- source scans ----------
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const files = () => readdirSync(DIR).map((n) => join(DIR, n)).filter((p) => statSync(p).isFile());

test('CSP: no inline scripts, handler attributes, eval, new Function, string timers or HTML injection', () => {
  const offenders = [];
  for (const f of [...files(), join(ROOT, 'gcsp-outbox.html')]) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('.html')) {
      for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (m[2].trim()) offenders.push('inline script body');
        if (!/\bsrc=/.test(m[1])) offenders.push('script without src');
      }
      if (/\son[a-z]+\s*=/i.test(src)) offenders.push('inline handler attribute');
      if (/javascript:/i.test(src)) offenders.push('javascript: URL');
    } else if (f.endsWith('.js')) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
      if (/\beval\s*\(/.test(code)) offenders.push(`${f}: eval`);
      if (/new\s+Function\b/.test(code)) offenders.push(`${f}: new Function`);
      if (/\bset(Timeout|Interval)\s*\(/.test(code)) offenders.push(`${f}: timer`);
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(code)) offenders.push(`${f}: HTML string injection`);
      if (/\.setAttribute\(\s*['"]on[a-z]+['"]/.test(code)) offenders.push(`${f}: handler attribute`);
      if (/\blocation\b|\bhistory\./.test(code) && !f.endsWith('harness.js')) offenders.push(`${f}: reads location`);
      if (/allow-/.test(code.replace(/[^\n]*\/\/[^\n]*/g, ''))) offenders.push(`${f}: allow- token`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no em dash in presenter strings or the page, and no side stripe or unscoped selector in the stylesheet', () => {
  for (const f of files().filter((p) => p.endsWith('.js'))) {
    read(f.slice(ROOT.length)).split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const s of line.match(/([`'"])(?:\\.|(?!\1).)*\1/g) || []) assert.ok(!s.includes('—'), `${f}:${i + 1}`);
    });
  }
  assert.ok(!read('gcsp-outbox.html').includes('—'));
  const css = read('blocks/gcsp/presenter/gcsp-presenter.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /border-(left|right)(-width)?\s*:\s*[^;]*\b([2-9]|\d\d)\d*px/);
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(selectors.filter((s) => !s.startsWith('.gcsp')), []);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('harness page loads the harness module and stylesheet; only listed fixtures are accepted', () => {
  const html = read('gcsp-outbox.html');
  assert.match(html, /blocks\/gcsp\/presenter\/harness\.js/);
  assert.match(html, /blocks\/gcsp\/presenter\/gcsp-presenter\.css/);
  assert.equal([...html.matchAll(/<script\b/g)].length, 1);
  assert.match(read('blocks/gcsp/presenter/harness.js'), /FIXTURE_NAMES\.includes/);
  assert.deepEqual([...fixtures.FIXTURE_NAMES], ['messages', 'empty', 'retrying', 'failed', 'unavailable', 'refused', 'loading']);
  assert.equal(fixtures.fixtureAdapter('nope'), null);
});

test('the gallery shows messageList and the catalogue and ratchet record the new component', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = host();
  mountComponentGallery(root);
  const section = root.querySelector('.vm-gallery-gcsp-section');
  assert.ok(section.querySelector('.gcsp-mail-list'));
  assert.ok(section.querySelector('.gcsp-mail-row'));
  assert.match(read('COMPONENTS.md'), /messageList/);
  assert.ok(read('components.html').includes('blocks/gcsp/presenter/gcsp-presenter.css'));
  const ratchet = JSON.parse(read('server/test/ui-ratchet.json'));
  const entry = ratchet.stylesheets.find((s) => s.path === 'blocks/gcsp/presenter/gcsp-presenter.css');
  assert.ok(entry);
  assert.equal(entry.max_lines, read('blocks/gcsp/presenter/gcsp-presenter.css').split('\n').length);
});


test('provider uncertainty has truthful fixed copy alongside captured real message bodies', async () => {
  for (const error of ['provider-timeout', 'provider-unconfirmed', 'provider-window-expired']) {
    const base = fixtures.fixtureMessages()[0];
    const root = host();
    const message = { ...base, state: error === 'provider-window-expired' ? 'failed' : 'retrying', error, attempts: 1,
      textBody: 'Demonstration message. Provider acceptance does not confirm inbox delivery.',
      htmlBody: '<p>Demonstration message. Provider acceptance does not confirm inbox delivery.</p>' };
    const teardown = out.mountOutbox(root, { loadMessages: async () => ({ status: 'ready', messages: [message] }) });
    await tick(); rows(root)[0].click();
    assert.match(root.querySelector('.gcsp-mail-detail').textContent, /not confirmed|not confirm/);
    assert.doesNotMatch(root.querySelector('.gcsp-mail-detail').textContent, /Delivery failed|Delivery did not work|could not be delivered/);
    assert.match(root.querySelector('pre').textContent, /Provider acceptance does not confirm inbox delivery/);
    assert.equal(root.querySelector('iframe').getAttribute('sandbox'), ''); teardown();
  }
});


test('safe provider error copy does not assert a new retry or deny an earlier ambiguous send', () => {
  assert.doesNotMatch(copy.errorSentence('provider-rate-limited'), /scheduled|another attempt/i);
  for (const code of ['mail-configuration-invalid', 'recipient-not-allowed', 'offer-link-invalid']) {
    assert.doesNotMatch(copy.errorSentence(code), /nothing was sent|no email was sent/i);
  }
});

test('a 401 with no status (lapsed access key) reads access-required; a status keeps its refusal', async () => {
  const { outcomeToState } = adapterMod;
  for (const body of [{ error: 'Unauthorized' }, undefined, null]) assert.deepEqual(outcomeToState(401, body), { status: 'access-required' });
  assert.equal(outcomeToState(403, { error: 'Forbidden' }).status, 'refused');
  for (const body of [{ error: 'Unauthorized' }, undefined]) {
    const adapter = adapterMod.createOutboxHttpAdapter({ fetchImpl: async () => ({ status: 401, json: async () => { if (body === undefined) throw new Error('bad json'); return body; } }) });
    assert.deepEqual(await adapter.loadMessages(), { status: 'access-required' });
  }
});

test('a lapsed access key shows the restart screen with Reload and no Retry', async () => {
  const root = host(); const teardown = out.mountOutbox(root, { loadMessages: async () => ({ status: 'access-required' }) }); await tick();
  const screen = root.querySelector('.gcsp-presenter-body .vm-status, .vm-status');
  assert.equal(screen.getAttribute('role'), 'alert'); assert.match(screen.textContent, /Demo restarted/);
  assert.deepEqual([...screen.querySelectorAll('.vm-btn')].map((b) => b.textContent), ['Reload']);
  assert.doesNotMatch(root.textContent, /Captured emails are unavailable/); teardown();
});

test('a captured message reads "Captured, not sent" in the row and the detail Status; a configured send reads "Sent"', () => {
  const base = fixtures.fixtureMessages()[0];
  assert.equal(base.transport, 'captured');
  const status = (message) => {
    const handle = list.messageList({ messages: [message], selectedId: message.jobId });
    const chip = handle.root.querySelector('.gcsp-mail-status').textContent;
    const fact = [...handle.root.querySelectorAll('.gcsp-mail-facts > *')].find((node) => /^Status/.test(node.textContent)).textContent;
    return { chip, fact };
  };
  const captured = status(base);
  assert.equal(captured.chip, 'Captured, not sent');
  assert.match(captured.fact, /Captured, not sent/);
  const configured = status({ ...base, transport: 'configured' });
  assert.equal(configured.chip, 'Sent');
  assert.match(configured.fact, /^StatusSent$/);
});

test('the email preview frame has a visible focus outline in the presenter stylesheet', () => {
  const css = readFileSync(join(DIR, 'gcsp-presenter.css'), 'utf8');
  assert.match(css, /\.gcsp-mail-frame:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gcsp-focus\)/);
  assert.match(css, /\.gcsp-mail-frame:focus,/);
});
