import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
let kit; let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
  for (const name of ['window', 'document']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  kit = await import('../../blocks/gcsp/kit/run-restarted.js');
});
after(() => dom.window.close());
test('isRunRestarted is true for stale-run, unknown-session and access-required only', () => {
  for (const status of ['stale-run', 'unknown-session', 'access-required']) assert.equal(kit.isRunRestarted({ status }), true, status);
  for (const reply of [{ status: 'missing-session' }, { status: 'expired-session' }, { status: 'forbidden' }, { status: 'ok' },
    { status: 'unavailable' }, null, undefined]) assert.equal(kit.isRunRestarted(reply), false);
});
test('isAccessLapsed is true only for a 401 whose body has no string status', () => {
  for (const body of [null, undefined, {}, { error: 'Unauthorized' }, { status: 7 }, 'text', []]) assert.equal(kit.isAccessLapsed(401, body), true, JSON.stringify(body));
  for (const body of [{ status: 'forbidden' }, { status: 'stale-run' }, { status: 'ok' }]) assert.equal(kit.isAccessLapsed(401, body), false);
  for (const httpStatus of [200, 403, 409, 500, undefined]) assert.equal(kit.isAccessLapsed(httpStatus, { error: 'x' }), false);
});
test('screen is a page-level alert with the copy and one Reload button that calls reload', () => {
  let calls = 0; const screen = kit.runRestartedScreen({ reload: () => calls++ });
  assert.equal(screen.getAttribute('role'), 'alert'); assert.equal(screen.querySelector('h2').textContent, 'Restarted');
  assert.equal(screen.querySelector('p').textContent, 'This page was restarted. Reload to continue.');
  const buttons = screen.querySelectorAll('button'); assert.equal(buttons.length, 1); assert.equal(buttons[0].type, 'button');
  buttons[0].click(); assert.equal(calls, 1); assert.doesNotMatch(screen.textContent, /stale-run|\u2014/);
});
test('notice is a compact alert exposing its Reload button', () => {
  let calls = 0; const notice = kit.runRestartedNotice({ reload: () => calls++ });
  assert.equal(notice.root.getAttribute('role'), 'alert'); assert.equal(notice.root.querySelector('p').textContent, kit.RUN_RESTARTED_MESSAGE);
  assert.equal(notice.reload.textContent, 'Reload'); notice.reload.click(); assert.equal(calls, 1);
});
test('default reload follows an empty-href link, so the kit never reads the URL', () => {
  const clicked = []; const original = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function click() { clicked.push(this.getAttribute('href')); };
  try { kit.runRestartedNotice().reload.click(); assert.deepEqual(clicked, ['']); }
  finally { dom.window.HTMLAnchorElement.prototype.click = original; }
});

test('accessLapsedScreen is an alert whose one action links to the access form, returning to the account by default', () => {
  const screen = kit.accessLapsedScreen(); assert.equal(screen.getAttribute('role'), 'alert');
  assert.match(screen.textContent, new RegExp(kit.ACCESS_LAPSED_TITLE)); assert.equal(screen.querySelectorAll('button').length, 0);
  assert.equal(screen.querySelector('a').getAttribute('href'), '/gcsp/access?next=%2Fgcsp-account.html');
  assert.equal(kit.accessLapsedScreen({ next: '/gcsp-presenter.html' }).querySelector('a').getAttribute('href'), '/gcsp/access?next=%2Fgcsp-presenter.html');
});
