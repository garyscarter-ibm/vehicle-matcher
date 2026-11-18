// FUCQ-97: the kept presenter message list, safe-error copy, link safety and embedding rules.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = join(ROOT, 'blocks/gcsp/presenter');
let list;
let fixtures;
let copy;

function installDom() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name] ?? globalThis[name], configurable: true, writable: true });
  }
}
before(async () => {
  installDom();
  list = await import('../../blocks/gcsp/presenter/message-list.js');
  fixtures = await import('../../blocks/gcsp/presenter/fixtures.js');
  copy = await import('../../blocks/gcsp/presenter/outbox-copy.js');
});
beforeEach(() => document.body.replaceChildren());

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };
async function mountFixture(name) {
  const root = host();
  const { messages } = await fixtures.fixtureAdapter(name).loadMessages();
  const handle = list.messageList({ messages, selectedId: messages[0].jobId });
  root.append(handle.root);
  return { root, teardown: () => handle.destroy() };
}
const rows = (root) => [...root.querySelectorAll('.gcsp-mail-row')];
const enter = (node) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

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
  assert.equal(root.querySelectorAll('.gcsp-mail-row[aria-current]').length, 1, 'the newest email opens by default');
  assert.equal(root.querySelector('.gcsp-mail-row[aria-current]').dataset.id, 'job-004');
  assert.equal(root.querySelector('.gcsp-mail-prompt'), null);
});

test('the open email puts its facts on one line and folds the plain text and delivery attempts away', async () => {
  const { root } = await mountFixture('messages');
  const detail = root.querySelector('.gcsp-mail-detail');
  assert.equal(detail.querySelectorAll('.gcsp-mail-line').length, 1);
  assert.match(detail.querySelector('.gcsp-mail-line').textContent, /^To Paula.*Captured, not sent, 5 Nov 2026, 09:20 GMT\.$/);
  const folds = [...detail.querySelectorAll('details.gcsp-mail-fold')];
  assert.deepEqual(folds.map((n) => n.querySelector('summary').textContent), ['Plain-text version', 'Delivery attempts']);
  assert.ok(folds.every((n) => n.open === false));
  assert.match(folds[1].textContent, /Attempts/); assert.equal(detail.querySelector('.gcsp-mail-offer .vm-btn-primary'), null);
});
test('with no email to show the detail box is hidden, not an empty box', async () => {
  const handle = list.messageList({ messages: [] });
  assert.equal(handle.root.querySelector('.gcsp-mail-detail').hidden, true);
  handle.update(fixtures.fixtureMessages()); assert.equal(handle.root.querySelector('.gcsp-mail-detail').hidden, false);
  handle.destroy();
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
  assert.equal(root.querySelectorAll('iframe').length, 1);
  const text = root.querySelector('pre.gcsp-mail-text');
  assert.match(text.textContent, /Review your offer: https:\/\/offers\.bmwgroup\.test\/gcsp\/offer/);
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

test('every documented safe error code has a plain sentence and unknown codes are handled', () => {
  for (const code of ['transport-unavailable', 'message-invalid', 'message-facts-unavailable', 'fictional-recipient-required', 'recipient-mismatch', 'message-version-unsupported', 'offer-inactive', 'offer-expired']) {
    assert.ok(copy.ERROR_COPY[code].endsWith('.'), code);
  }
  assert.match(copy.errorSentence('something-new'), /reason that is not listed/);
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
  for (const f of files()) {
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
  const css = read('blocks/gcsp/presenter/gcsp-presenter.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /border-(left|right)(-width)?\s*:\s*[^;]*\b([2-9]|\d\d)\d*px/);
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(selectors.filter((s) => !s.startsWith('.gcsp')), []);
  assert.match(css, /prefers-reduced-motion: reduce/);
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


test('provider uncertainty has truthful fixed copy alongside captured real message bodies', () => {
  for (const error of ['provider-timeout', 'provider-unconfirmed', 'provider-window-expired']) {
    const base = fixtures.fixtureMessages()[0];
    const message = { ...base, state: error === 'provider-window-expired' ? 'failed' : 'retrying', error, attempts: 1,
      textBody: 'Demonstration message. Provider acceptance does not confirm inbox delivery.',
      htmlBody: '<p>Demonstration message. Provider acceptance does not confirm inbox delivery.</p>' };
    const handle = list.messageList({ messages: [message], selectedId: message.jobId }); document.body.append(handle.root);
    assert.match(handle.root.querySelector('.gcsp-mail-detail').textContent, /not confirmed|not confirm/);
    assert.doesNotMatch(handle.root.querySelector('.gcsp-mail-detail').textContent, /Delivery failed|Delivery did not work|could not be delivered/);
    assert.match(handle.root.querySelector('pre').textContent, /Provider acceptance does not confirm inbox delivery/);
    assert.equal(handle.root.querySelector('iframe').getAttribute('sandbox'), ''); handle.destroy();
  }
});

test('safe provider error copy does not assert a new retry or deny an earlier ambiguous send', () => {
  assert.doesNotMatch(copy.errorSentence('provider-rate-limited'), /scheduled|another attempt/i);
  for (const code of ['mail-configuration-invalid', 'recipient-not-allowed', 'recipient-email-invalid', 'offer-link-invalid']) {
    assert.doesNotMatch(copy.errorSentence(code), /nothing was sent|no email was sent/i);
  }
});

test('a captured message reads "Captured, not sent" in the row and the detail Status; a configured send reads "Sent"', () => {
  const base = fixtures.fixtureMessages()[0];
  assert.equal(base.transport, 'captured');
  const status = (message) => {
    const handle = list.messageList({ messages: [message], selectedId: message.jobId });
    const chip = handle.root.querySelector('.gcsp-mail-status').textContent;
    const fact = handle.root.querySelector('.gcsp-mail-line').textContent;
    return { chip, fact };
  };
  const captured = status(base);
  assert.equal(captured.chip, 'Captured, not sent');
  assert.match(captured.fact, /^To .*\. Captured, not sent, 5 Nov 2026/);
  const configured = status({ ...base, transport: 'configured' });
  assert.equal(configured.chip, 'Sent');
  assert.match(configured.fact, /^To .*\. Sent, /);
});

test('the email preview frame has a visible focus outline in the presenter stylesheet', () => {
  const css = readFileSync(join(DIR, 'gcsp-presenter.css'), 'utf8');
  assert.match(css, /\.gcsp-mail-frame:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gcsp-focus\)/);
  assert.match(css, /\.gcsp-mail-frame:focus,/);
});
