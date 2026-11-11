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
  assert.equal(example.querySelectorAll('.gcsp-buddy-status.is-prominent').length, 3, 'a prominent row');
});

import { readFileSync } from 'node:fs';

test('FUCQ-370: the prominent variant carries the engagement state in words, with an aria-hidden lamp and no live region', () => {
  const cases = [['engaged', 'Buddy engaged'], ['disengaged', 'Buddy disengaged'], ['unknown', 'Buddy status unavailable'], ['nonsense', 'Buddy status unavailable']];
  for (const [state, text] of cases) {
    const node = buddyStatus({ prominent: true, id: `b-${state}`, state });
    assert.equal(node.tagName, 'P'); assert.equal(node.id, `b-${state}`); assert.equal(node.textContent, text);
    assert.equal(node.querySelector('.gcsp-buddy-lamp').getAttribute('aria-hidden'), 'true');
    assert.equal(node.hasAttribute('role'), false); assert.equal(node.hasAttribute('aria-live'), false);
  }
  assert.throws(() => buddyStatus({ prominent: true }), TypeError);
});

test('FUCQ-370: update repaints the element in place and unknown never reads as engaged', () => {
  const node = buddyStatus({ prominent: true, id: 'b' });
  assert.equal(node.dataset.state, 'unknown'); assert.ok(!node.classList.contains('is-engaged'));
  node.update('engaged'); assert.equal(node.textContent, 'Buddy engaged'); assert.ok(node.classList.contains('is-engaged')); assert.ok(node.classList.contains('is-prominent'));
  node.update('disengaged'); assert.equal(node.textContent, 'Buddy disengaged'); assert.ok(!node.classList.contains('is-engaged'));
  assert.equal(buddyStatus({ state: 'active' }).textContent, 'Active', 'the default output is unchanged');
});

test('FUCQ-370: the prominent lamp is static, 18px, green only when engaged and neutral when unknown', () => {
  const css = readFileSync(new URL('../../blocks/gcsp/kit/buddy-status.css', import.meta.url), 'utf8');
  assert.match(css, /width: 18px; height: 18px/); assert.doesNotMatch(css, /animation|transition|@keyframes/);
  assert.match(css, /is-unknown \.gcsp-buddy-lamp \{ background: var\(--gcsp-text-muted\)/);
  assert.match(css, /is-engaged \.gcsp-buddy-lamp \{ background: var\(--gcsp-success\)/);
  assert.match(css, /is-prominent \{[^}]*font-size: var\(--gcsp-font-size-title\)/);
});
