import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buddyState, buddyStatus } from '../../blocks/gcsp/kit/buddy-status.js';
import { buddyStatusExample } from '../../blocks/gcsp/kit/form-controls-gallery.js';

let dom;
before(() => { dom = new JSDOM('<!doctype html>'); globalThis.document = dom.window.document; });
after(() => dom.window.close());
const activity = (permission, currentOffer = null) => ({ status: 'ok', value: { permission, currentOffer } });

test('Buddy status distinguishes saved pause, missing setup, finished, withdrawn permission and failed reads', () => {
  const active = { paused: false, canSearch: true }; const paused = { paused: true, canSearch: false };
  for (const [input, expected] of [
    [activity(active), 'active'], [activity(paused), 'paused'], [activity(null), 'unset'],
    [activity(active, { state: 'accepted' }), 'finished'],
    [activity(paused, { state: 'accepted' }), 'finished'],
    [activity({ paused: false, canSearch: false }), 'inactive'],
    [{ status: 'unavailable' }, 'unavailable'], [{ status: 'ok', value: {} }, 'unavailable'],
    [activity({}), 'unavailable'], [activity(undefined), 'unavailable'],
  ]) assert.equal(buddyState(input), expected);
});

test('each outlined status is one native link with the original chevron and readable state', () => {
  for (const [state, text] of [['active', 'Active'], ['paused', 'Paused'], ['unset', 'Set up your buddy'], ['unavailable', 'Status unavailable']]) {
    const link = buddyStatus({ state, href: '/gcsp-activity-live.html' });
    assert.equal(link.tagName, 'A'); assert.equal(link.getAttribute('href'), '/gcsp-activity-live.html');
    assert.equal(link.querySelectorAll('a,button').length, 0);
    assert.equal(link.textContent, `Buddy${text}›`);
    assert.equal(link.querySelector('.gcsp-buddy-chevron').getAttribute('aria-hidden'), 'true');
    assert.equal(link.dataset.focusKey, 'buddy-status');
  }
  assert.equal(buddyStatus({ state: 'paused' }).querySelector('.gcsp-buddy-dot').getAttribute('aria-hidden'), 'true');
});

test('shared gallery includes navigation and plain status for every supported state', () => {
  const example = buddyStatusExample();
  assert.equal(example.querySelectorAll('.gcsp-buddy-link').length, 6);
  assert.equal(example.querySelectorAll('p > .gcsp-buddy-status').length, 6);
});
