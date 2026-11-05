import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createActivityFixtures } from './helpers/activity-fixtures.js';

let dom; let activityBody; let fixtures;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  ({ activityBody } = await import('../../blocks/gcsp/activity/activity-body.js'));
  fixtures = (await createActivityFixtures()).snapshots;
});
after(() => dom?.window.close());
beforeEach(() => document.body.replaceChildren());

test('never-checked state separates active permission from unavailable check evidence', () => {
  const node = activityBody({ result: fixtures['never-checked'] }); document.body.append(node);
  assert.match(node.textContent, /buddy is active/i);
  assert.match(node.textContent, /permission to search/i);
  assert.match(node.textContent, /Check information is unavailable/i);
  assert.doesNotMatch(node.textContent, /Still searching|Source delayed|No match|overnight|last checked today/i);
  assert.equal(node.querySelectorAll('h1').length, 1);
  const pause = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Pause search');
  assert.ok(pause.disabled);
  assert.match(document.getElementById(pause.getAttribute('aria-describedby')).textContent, /design preview.*saved search/i);
  assert.equal(node.querySelector('a[href]'), null);
});

test('paused state explains stopped permission and existing offers without cancelling them', () => {
  const node = activityBody({ result: fixtures.paused });
  assert.match(node.textContent, /buddy is paused/i);
  assert.match(node.textContent, /New searches and new holds are paused/i);
  assert.match(node.textContent, /does not cancel an existing offer/i);
  assert.ok([...node.querySelectorAll('button')].find((b) => b.textContent === 'Resume search').disabled);
  assert.equal(node.querySelectorAll('.gcsp-activity-timeline li').length, 2);
  assert.match(node.textContent, /Search paused/);
});

test('unavailable projection hides stale permission and offers and gives a keyboard-native retry', () => {
  let calls = 0;
  const node = activityBody({ result: fixtures.unavailable, onRetry: () => { calls += 1; } }); document.body.append(node);
  assert.match(node.textContent, /Activity is unavailable/);
  assert.equal(node.querySelectorAll('.gcsp-activity-state,.gcsp-activity-timeline,dl').length, 0);
  assert.doesNotMatch(node.textContent, /buddy is active|buddy is paused|No offer/i);
  const retry = node.querySelector('button'); assert.equal(retry.type, 'button'); retry.focus(); retry.click();
  assert.equal(document.activeElement, retry); assert.equal(calls, 1);
});

test('browser fixture snapshot remains derived from real commands and contains no successful check or offer link', async () => {
  const { activityFixtures } = await import('../../blocks/gcsp/activity/activity-fixtures.js');
  assert.deepEqual(activityFixtures, await createActivityFixtures());
  for (const name of ['never-checked', 'paused']) {
    const v = activityFixtures.snapshots[name].value;
    assert.equal(v.lastSuccessfulCheck, null); assert.equal(v.sourceStatus, 'evidence-unavailable');
    assert.deepEqual(v.offers, []); assert.equal(v.searchEvidence.status, 'not-recorded');
  }
  assert.equal(activityFixtures.snapshots.paused.value.permission.canSearch, false);
  assert.equal(activityFixtures.snapshots.paused.value.permission.canHold, false);
});
