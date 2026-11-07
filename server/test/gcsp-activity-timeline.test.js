import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let activityTimeline;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  ({ activityTimeline } = await import('../../blocks/gcsp/kit/activity-timeline.js'));
});
after(() => dom?.window.close());
beforeEach(() => document.body.replaceChildren());

test('timeline preserves supplied order and exposes dates as demo time without inventing events', () => {
  const node = activityTimeline({ events: [
    { id: 'b', occurredAt: '2026-11-05T11:30:00.000Z', label: 'Search paused', detail: 'Brief version 2' },
    { id: 'a', occurredAt: '2026-11-05T10:00:00.000Z', label: 'Search brief confirmed' },
  ] });
  document.body.append(node);
  assert.equal(node.tagName, 'SECTION');
  assert.equal(node.querySelector('ol').children.length, 2);
  assert.match(node.querySelector('li').textContent, /Search paused/);
  assert.equal(node.querySelector('time').dateTime, '2026-11-05T11:30:00.000Z');
  assert.match(node.querySelector('time').textContent, /5 Nov 2026.*11:30/);
  assert.match(node.textContent, /demo time.*UTC/i);
  assert.doesNotMatch(node.textContent, /ago|successful check/i);
});

test('timeline empty and invalid dates remain explicit without a false datetime', () => {
  const empty = activityTimeline({ events: [] });
  assert.equal(empty.querySelectorAll('li').length, 0);
  assert.match(empty.textContent, /No activity is recorded/);
  const node = activityTimeline({ events: [{ id: 'bad', occurredAt: 'not-a-date', label: 'Saved change' }] });
  assert.equal(node.querySelector('time'), null);
  assert.match(node.textContent, /Time not available/);
  assert.doesNotMatch(node.textContent, /Invalid Date/);
});

test('timeline treats supplied labels as text and gives each heading an independent accessible name', () => {
  const a = activityTimeline({ events: [{ id: 'x', occurredAt: null, label: '<img src=x onerror=bad>', detail: '<script>bad()</script>' }] });
  const b = activityTimeline({ events: [] }); document.body.append(a, b);
  assert.equal(a.querySelector('img,script'), null);
  assert.match(a.textContent, /<img src=x onerror=bad>/);
  assert.notEqual(a.getAttribute('aria-labelledby'), b.getAttribute('aria-labelledby'));
  assert.equal(document.getElementById(a.getAttribute('aria-labelledby')).textContent, 'Activity history');
});
