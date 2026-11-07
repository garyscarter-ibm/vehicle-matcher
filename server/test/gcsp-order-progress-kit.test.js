import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let stageTracker; let taskList;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  ({ stageTracker } = await import('../../blocks/gcsp/kit/stage-tracker.js'));
  ({ taskList } = await import('../../blocks/gcsp/kit/task-list.js'));
});
after(() => dom?.window.close());

const stages = [
  { id: 'a', label: 'Selection received', state: 'done', at: '2026-11-05T09:00:00.000Z' },
  { id: 'b', label: 'Sales-manager approval', state: 'current', owner: 'With the sales manager', next: 'Sales-manager decision' },
  { id: 'c', label: 'Sent to ordering', state: 'upcoming' },
];

test('stageTracker is a named ordered list with state in text and one current step', () => {
  const node = stageTracker({ heading: 'Steps', stages, level: 3 });
  assert.equal(node.querySelector('h3').textContent, 'Steps');
  assert.equal(node.getAttribute('aria-labelledby'), node.querySelector('h3').id);
  const rows = [...node.querySelectorAll('ol > li')];
  assert.deepEqual(rows.map((row) => row.querySelector('.gcsp-stage-state').textContent), ['Done', 'Current step', 'Not started']);
  assert.deepEqual(rows.map((row) => row.getAttribute('aria-current')), [null, 'step', null]);
  assert.match(rows[1].textContent, /With the sales manager/); assert.match(rows[1].textContent, /Next: Sales-manager decision/);
  assert.equal(rows[0].querySelector('time').dateTime, '2026-11-05T09:00:00.000Z');
  assert.match(rows[0].textContent, /5 Nov 2026.*09:00/);
  assert.equal(rows[2].querySelector('.gcsp-stage-owner'), null);
});

test('stageTracker names declined and blocked in text, treats unknown states as not started and sets text safely', () => {
  const node = stageTracker({ stages: [
    { id: 'd', label: 'HR approval', state: 'declined' }, { id: 'e', label: 'Next', state: 'blocked', note: 'Reason shown' },
    { id: 'f', label: '<img src=x onerror=bad>', state: 'mystery', at: 'not-a-date' }] });
  const rows = [...node.querySelectorAll('li')];
  assert.match(rows[0].textContent, /Declined/); assert.equal(rows[0].getAttribute('aria-current'), null);
  assert.match(rows[1].textContent, /Not updated/); assert.match(rows[1].textContent, /Reason shown/); assert.equal(rows[1].getAttribute('aria-current'), 'step');
  assert.match(rows[2].textContent, /Not started/); assert.equal(rows[2].querySelector('img'), null); assert.equal(rows[2].querySelector('time'), null);
  assert.doesNotMatch(node.textContent, /Invalid Date/);
  assert.notEqual(stageTracker({ stages }).querySelector('h2').id, stageTracker({ stages }).querySelector('h2').id);
});

test('taskList groups items, keeps supplied order and shows due times in demo time', () => {
  const node = taskList({ heading: 'Checklist', level: 2, groups: [
    { heading: 'Your tasks', items: [{ id: 'one', label: 'Vehicle agreement', owner: 'You', status: 'Waiting for you', tone: 'todo', due: '2026-11-07T15:00:00.000Z' }] },
    { heading: 'Empty group', items: [] },
    { heading: 'Others', items: [{ id: 'two', label: 'Licence check', owner: 'Scheme team', status: 'In progress', tone: 'in-progress' }] }] });
  assert.deepEqual([...node.querySelectorAll('h3')].map((h) => h.textContent), ['Your tasks', 'Others']);
  const items = [...node.querySelectorAll('li')];
  assert.match(items[0].textContent, /You\. Waiting for you\. Due 7 Nov 2026, 15:00\./);
  assert.match(items[1].textContent, /Scheme team\. In progress\./); assert.doesNotMatch(items[1].textContent, /Due/);
});

test('taskList overdue and failed are distinct in text, and failed shows its reason', () => {
  const node = taskList({ groups: [{ items: [
    { id: 'o', label: 'Late', owner: 'You', status: 'Waiting for you', tone: 'overdue' },
    { id: 'f', label: 'Broken', owner: 'Retailer', status: 'Failed', tone: 'failed', reason: 'Provider said no' }] }] });
  const [late, broken] = [...node.querySelectorAll('li')];
  assert.match(late.textContent, /Overdue/); assert.doesNotMatch(late.textContent, /Failed/);
  assert.match(broken.textContent, /Failed: Provider said no/); assert.doesNotMatch(broken.textContent, /Overdue/);
  assert.ok(late.classList.contains('is-overdue')); assert.ok(broken.classList.contains('is-failed'));
});

test('taskList action uses the kit button, passes the item id, and a disabled reason is linked', () => {
  const seen = [];
  const node = taskList({ groups: [{ items: [
    { id: 'go', label: 'Sign', status: 'Waiting', tone: 'todo', action: { label: 'Acknowledge', onSelect: (id) => seen.push(id) } },
    { id: 'no', label: 'Locked', status: 'Waiting', tone: 'todo', action: { label: 'Wait', disabled: true, reason: 'Not open yet', onSelect: () => seen.push('bad') } },
    { id: 'bare', label: 'No handler', status: 'Waiting', tone: 'todo', action: { label: 'Nothing' } }] }] });
  document.body.append(node);
  const [go, locked, bare] = node.querySelectorAll('button');
  assert.ok(go.classList.contains('vm-btn')); go.click(); assert.deepEqual(seen, ['go']);
  assert.equal(locked.disabled, true); locked.click(); assert.deepEqual(seen, ['go']);
  assert.match(document.getElementById(locked.getAttribute('aria-describedby')).textContent, /Not open yet/);
  assert.equal(bare.disabled, true);
  node.remove();
});

test('taskList empty state is explicit', () => {
  assert.match(taskList({ groups: [{ heading: 'None', items: [] }], emptyText: 'Nothing to do.' }).textContent, /Nothing to do\./);
  assert.match(taskList({}).textContent, /No tasks\./);
});
