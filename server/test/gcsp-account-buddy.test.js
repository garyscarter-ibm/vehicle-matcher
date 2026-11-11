import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityFixtures } from '../../blocks/gcsp/activity/activity-fixtures.js';
import { accountFixture } from '../../blocks/gcsp/account/fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://account.test/', pretendToBeVisual: true });
for (const name of ['document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) globalThis[name] = dom.window[name];
const { buddyTile } = await import('../../blocks/gcsp/kit/buddy-tile.js');
const { mountAccountBuddy, buddyEvents } = await import('../../blocks/gcsp/account/account-buddy.js');
const { mountAccount } = await import('../../blocks/gcsp/account/gcsp-account.js');
after(() => dom.window.close());
const snapshot = (name) => structuredClone(activityFixtures.snapshots[name]);
const tick = () => new Promise((done) => setTimeout(done, 0));
const place = () => { const root = document.createElement('div'); root.className = 'gcsp'; document.body.append(root); return root; };
const find = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label);

test('the tile distinguishes loading, setup, inactive, paused, held, finished and failed reads', () => {
  const tile = buddyTile();
  assert.equal(tile.root.dataset.state, 'loading');
  for (const [permission, offer, expected] of [
    [null, null, 'unset'], [{ searchConsent: false, holdConsent: false, paused: false, canSearch: false }, null, 'inactive'],
    [{ searchConsent: true, holdConsent: true, paused: true, canSearch: false }, null, 'paused'], [{ searchConsent: true, holdConsent: true, paused: false, canSearch: true }, null, 'active'],
    [{ searchConsent: true, holdConsent: true, paused: true, canSearch: false }, { state: 'accepted' }, 'finished'],
  ]) {
    tile.update({ phase: 'ready', result: { status: 'ok', value: { permission, currentOffer: offer } } });
    assert.equal(tile.root.dataset.state, expected);
    if (expected === 'paused') assert.equal(tile.root.querySelector('.gcsp-buddy-status').textContent, 'Paused');
    if (expected === 'finished') assert.equal(tile.root.querySelector('[data-focus-key="buddy-search-action"]'), null);
  }
  tile.update({ phase: 'ready', result: snapshot('offer'), deadline: 'Respond by 6 Nov 2026, 09:00' });
  assert.match(tile.root.textContent, /A car is held for you/); assert.match(tile.root.textContent, /Respond by/);
  tile.update({ phase: 'unavailable' }); assert.match(tile.root.textContent, /Search status is unavailable/);
  assert.equal(tile.root.querySelector('.gcsp-timeline-list'), null);
});

test('events use actual projected changes, offers and latest check, deduplicate identities and sort newest first', () => {
  const result = snapshot('paused'); const value = result.value;
  value.lastSuccessfulCheck = { checkedAt: '2026-11-05T09:30:00Z', carsChecked: 4, suitableCars: 1 };
  value.currentOffer = { offerRef: { offerId: 'one' }, state: 'accepted', createdAt: '2026-11-05T09:31:00Z' };
  value.offers = [value.currentOffer]; value.stateChanges.push(value.stateChanges[0]);
  const events = buddyEvents(value);
  assert.deepEqual(events.map((event) => event.label), ['Car offered', 'Cars checked', 'Search paused', 'Preferences confirmed']);
  assert.equal(events[0].detail, 'Current offer status: Accepted.');
  assert.equal(events[0].occurredAt, '2026-11-05T09:31:00Z', 'does not invent an acceptance time');
  const tile = buddyTile(); tile.update({ phase: 'ready', result, events });
  assert.equal(tile.root.querySelectorAll('.gcsp-timeline-event').length, 2);
});

test('Pause sends the authoritative version, reads back, keeps the held offer and restores focus for Resume', async () => {
  const root = place(); let value = snapshot('offer'); const calls = [];
  const adapter = { readActivity: async () => structuredClone(value),
    pause: async (input) => { calls.push(input); value.value.permission = { ...value.value.permission, paused: true, canSearch: false }; value.value.briefVersion += 1; return { status: 'ok' }; },
    resume: async (input) => { calls.push(input); value.value.permission = { ...value.value.permission, paused: false, canSearch: true }; value.value.briefVersion += 1; return { status: 'ok' }; } };
  const stop = mountAccountBuddy(root, { adapter }); await stop.ready;
  const held = structuredClone(value.value.currentOffer);
  find(root, 'Pause search').focus(); find(root, 'Pause search').click(); await tick(); await tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].expectedBriefVersion, 1); assert.equal(typeof calls[0].commandId, 'string');
  assert.deepEqual(value.value.currentOffer, held); assert.match(root.textContent, /Pausing keeps this offer open/);
  assert.equal(document.activeElement, find(root, 'Resume search'));
  find(root, 'Resume search').click(); await tick(); await tick();
  assert.equal(calls[1].expectedBriefVersion, 2); assert.equal(document.activeElement, find(root, 'Pause search'));
  stop(); root.remove();
});

test('history contains search readback and offers use the modal drawer, Escape returns focus and read failure can retry', async () => {
  const root = place(); let result = snapshot('paused');
  const stop = mountAccountBuddy(root, { adapter: { readActivity: async () => result } }); await stop.ready;
  const history = find(root, 'Buddy history'); history.focus(); history.click();
  assert.equal(root.querySelector('[role=dialog]').getAttribute('aria-modal'), 'true');
  assert.equal(root.querySelectorAll('[role=dialog] .gcsp-timeline-event').length, 2);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(root.querySelector('[role=dialog]'), null); assert.equal(document.activeElement, history);
  assert.equal(find(root, 'Search details'), undefined);
  find(root, 'Buddy history').click(); assert.match(root.querySelector('[role=dialog]').textContent, /Any held offer stays open/);
  find(root, 'Close').click(); result = snapshot('offer'); await stop.sync(); find(root, 'View held offer').click();
  assert.equal(root.querySelector('[role=dialog] a').getAttribute('href'), result.value.currentOffer.href);
  find(root, 'Close').click(); result = { status: 'unavailable' }; await stop.sync();
  assert.equal(root.querySelector('.gcsp-buddy-tile').dataset.state, 'unavailable');
  result = snapshot('never-checked'); find(root, 'Try again').click(); await tick(); await tick();
  assert.equal(root.querySelector('.gcsp-buddy-tile').dataset.state, 'active');
  stop(); assert.equal(document.body.style.overflow, ''); root.remove();
});

test('Account composes one persistent Buddy tile beside preferences and keeps account refresh independent', async () => {
  const root = place(); let reads = 0; const preference = document.createElement('div'); preference.textContent = 'Preference controls';
  const stop = mountAccount(root, { adapter: { readOnly: true, readAccount: async () => accountFixture('ready'), readDraft: async () => ({ status: 'not-found' }),
    readOffers: async () => ({ status: 'ok', value: { offers: [{ offerId: 'held', state: 'pending' }] } }) },
    preferences: (region) => { region.append(preference); return () => {}; }, activityAdapter: { readActivity: async () => { reads += 1; return snapshot('searching'); } } });
  await tick(); await tick();
  const tile = root.querySelector('.gcsp-buddy-tile'); assert.ok(tile);
  const choices = root.querySelector('.gcsp-account-buddy-preferences'); assert.ok(choices.contains(preference)); assert.ok(choices.contains(tile));
  assert.equal(find(root.querySelector('.gcsp-feature'), 'View your offer'), undefined);
  assert.equal(find(root.querySelector('.gcsp-feature'), 'Choose a replacement'), undefined);
  assert.ok(find(root.querySelector('.gcsp-feature'), 'View car record'));
  assert.equal(root.querySelector('.gcsp-account-head .gcsp-buddy-status'), null); assert.equal(root.querySelector('nav [data-key=activity]'), null);
  await stop.sync(); await tick(); assert.ok(reads >= 2); assert.equal(root.querySelector('.gcsp-buddy-tile'), tile); assert.ok(preference.isConnected);
  stop(); root.remove();
});


test('the shared gallery includes all eight Buddy tile outcomes without issuing commands', async () => {
  const { buddyTileExamples } = await import('../../blocks/gcsp/kit/buddy-tile-gallery.js');
  const gallery = buddyTileExamples();
  assert.deepEqual([...gallery.querySelectorAll('[data-buddy-tile-example]')].map((node) => node.dataset.buddyTileExample),
    ['active', 'paused', 'unset', 'held', 'unavailable', 'finished', 'inactive', 'loading']);
  assert.equal(gallery.querySelectorAll('.gcsp-buddy-tile').length, 8);
  assert.equal(find(gallery.querySelector('[data-buddy-tile-example=paused]'), 'Resume search').disabled, true);
});
