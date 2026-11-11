import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let activityTimeline; let demoTime;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  ({ activityTimeline, demoTime } = await import('../../blocks/gcsp/kit/activity-timeline.js'));
});
after(() => dom?.window.close());
beforeEach(() => document.body.replaceChildren());

test('timeline preserves supplied order and shows UK times with no UTC note, without inventing events', () => {
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
  assert.equal(node.querySelector('.gcsp-timeline-note'), null); assert.doesNotMatch(node.textContent, /UTC/);
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

test('timeline formatTime words the time, a falsy note drops the paragraph and an action node sits in the detail', () => {
  const action = document.createElement('button'); action.textContent = 'View email';
  const node = activityTimeline({ events: [{ id: 'a', occurredAt: '2026-11-10T11:30:00.000Z', label: 'Offer email sent', detail: 'Queued', action }],
    formatTime: () => 'Tue 10 Nov, 11:30am', note: null });
  assert.equal(node.querySelector('time').textContent, 'Tue 10 Nov, 11:30am');
  assert.equal(node.querySelector('time').dateTime, '2026-11-10T11:30:00.000Z');
  assert.equal(node.querySelector('.gcsp-timeline-note'), null);
  assert.doesNotMatch(node.textContent, /UTC/);
  const kids = [...node.querySelector('.gcsp-timeline-detail').children];
  assert.deepEqual(kids.map((n) => n.className || n.tagName), ['gcsp-timeline-label', 'gcsp-timeline-description', 'BUTTON']);
  assert.equal(kids[2], action);
  const plain = activityTimeline({ events: [{ id: 'b', occurredAt: '2026-11-10T11:30:00.000Z', label: 'Plain' }] });
  assert.equal(plain.querySelector('.gcsp-timeline-note'), null); assert.equal(plain.querySelector('.gcsp-timeline-detail').children.length, 1);
});

// FUCQ-354: Paula's times are the UK wall clock, so BST shifts summer instants and GMT leaves winter ones alone.
test('demoTime reads Europe/London: an hour ahead of UTC in July (BST), equal to UTC in January (GMT)', () => {
  assert.equal(demoTime('2026-07-15T09:30:00.000Z'), '15 Jul 2026, 10:30');
  assert.equal(demoTime('2026-01-15T09:30:00.000Z'), '15 Jan 2026, 09:30');
  assert.equal(demoTime('2026-07-15T23:30:00.000Z'), '16 Jul 2026, 00:30');
  assert.equal(demoTime('2026-03-29T00:59:00.000Z'), '29 Mar 2026, 00:59');
  assert.equal(demoTime('2026-03-29T01:00:00.000Z'), '29 Mar 2026, 02:00');
  const node = activityTimeline({ events: [{ id: 's', occurredAt: '2026-07-15T09:30:00.000Z', label: 'Summer' }] });
  assert.equal(node.querySelector('time').textContent, '15 Jul 2026, 10:30');
  assert.equal(node.querySelector('time').dateTime, '2026-07-15T09:30:00.000Z');
});
