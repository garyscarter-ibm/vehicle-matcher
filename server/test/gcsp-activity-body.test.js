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
  assert.equal(node.querySelector('.gcsp-activity-status').textContent.trim(), 'Active');
  assert.match(node.textContent, /Last successful check: unavailable/i);
  assert.match(node.textContent, /Check and source information unavailable/i);
  assert.doesNotMatch(node.textContent, /Still searching|Source delayed|No match|overnight|last checked today/i);
  assert.equal(node.querySelectorAll('h1').length, 1);
  const trigger = node.querySelector('[aria-haspopup="menu"]'); trigger.click();
  const pause = node.querySelector('[role="menuitem"]'); assert.equal(pause.textContent, 'Pause Search');
  assert.equal(pause.getAttribute('aria-disabled'), 'true');
  assert.match(document.getElementById(pause.getAttribute('aria-describedby')).textContent, /Preview only/);
  assert.equal(node.querySelectorAll('h2').length, 2);
  assert.equal(node.querySelector('.gcsp-activity-status svg').getAttribute('aria-hidden'), 'true');
  assert.equal(node.querySelector('a[href]'), null);
  node.destroy();
});

test('paused state explains stopped permission and existing offers without cancelling them', () => {
  const node = activityBody({ result: fixtures.paused });
  assert.equal(node.querySelector('.gcsp-activity-status').textContent.trim(), 'Inactive');
  assert.match(node.textContent, /Searches and holds paused.*Existing offers remain/i);
  assert.equal(node.querySelector('[role="menuitem"]').textContent, 'Resume Search');
  const active = activityBody({ result: fixtures['never-checked'] });
  assert.notEqual(node.querySelector('.gcsp-activity-status svg').innerHTML, active.querySelector('.gcsp-activity-status svg').innerHTML);
  assert.equal(node.querySelectorAll('.gcsp-activity-timeline li').length, 2);
  assert.match(node.textContent, /Search paused/);
  active.destroy(); node.destroy();
});

test('unavailable projection hides stale permission and offers and gives a keyboard-native retry', () => {
  let calls = 0;
  const node = activityBody({ result: fixtures.unavailable, onRetry: () => { calls += 1; } }); document.body.append(node);
  assert.match(node.textContent, /Activity unavailable/);
  assert.equal(node.querySelectorAll('.gcsp-activity-state,.gcsp-activity-timeline,dl').length, 0);
  assert.doesNotMatch(node.textContent, /buddy is active|buddy is paused|No offer/i);
  const retry = node.querySelector('button'); assert.equal(retry.type, 'button'); retry.focus(); retry.click();
  assert.equal(document.activeElement, retry); assert.equal(calls, 1);
});

test('missing search permission never claims an active search or a saved pause', () => {
  const result = structuredClone(fixtures['never-checked']); result.value.permission.canSearch = false;
  const node = activityBody({ result });
  assert.equal(node.querySelector('.gcsp-activity-status').textContent.trim(), 'Inactive');
  assert.equal(node.querySelector('.gcsp-activity-consequence'), null); node.destroy();
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

test('unified Activity retains actual permission history once, with check absence outside dated events', () => {
  const duplicated = structuredClone(fixtures.paused); duplicated.value.stateChanges.push(duplicated.value.stateChanges[0]);
  const node = activityBody({ result: duplicated });
  assert.equal([...node.querySelectorAll('h2')].filter((n) => n.textContent === 'Activity').length, 1);
  assert.equal(node.querySelectorAll('.gcsp-timeline-event').length, fixtures.paused.value.stateChanges.length);
  assert.equal(node.querySelectorAll('.gcsp-activity-checks,.gcsp-activity-summaries').length, 0);
  assert.equal((node.textContent.match(/Last successful check:/g) || []).length, 1);
  node.destroy();
});

test('synthetic current-offer design fixture uses a real reader row and explicit selected reference, not collection order', async () => {
  const { activityFixtures } = await import('../../blocks/gcsp/activity/activity-fixtures.js');
  const node = activityBody({ result: fixtures.offer, offerDisplay: activityFixtures.offerExample });
  assert.match(node.textContent, /Your BMW offer/); assert.equal(node.querySelector('img').getAttribute('src'), '/assets/brand-hero/bmw.jpg');
  assert.match(node.textContent, /Representative BMW brand image/); assert.equal(node.querySelector('a'), null);
  const unresolved = activityBody({ result: fixtures.offer, offerDisplay: { offerRef: { offerId: 'foreign' } } });
  assert.match(unresolved.textContent, /Current offer unavailable/); assert.doesNotMatch(unresolved.textContent, /No current offer/);
  assert.equal(unresolved.querySelector('img'), null); node.destroy(); unresolved.destroy();
});
