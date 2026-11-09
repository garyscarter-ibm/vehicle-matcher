import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createActivityFixtures } from './helpers/activity-fixtures.js';

let dom; let activityBody; let fixtures;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
  ({ activityBody } = await import('../../blocks/gcsp/activity/activity-body.js'));
  fixtures = (await createActivityFixtures()).snapshots;
});
after(() => dom?.window.close());
beforeEach(() => document.body.replaceChildren());

test('never-checked state separates active permission from unavailable check evidence', () => {
  const node = activityBody({ result: fixtures['never-checked'] }); document.body.append(node);
  assert.equal(node.querySelector('.gcsp-activity-status').textContent.trim(), 'Active');
  assert.match(node.textContent, /Not searched yet/); assert.doesNotMatch(node.textContent, /Last check/);
  assert.doesNotMatch(node.textContent, /Still searching|Source delayed|No match|overnight|last checked today/i);
  assert.equal(node.querySelectorAll('h1').length, 1);
  const trigger = node.querySelector('[aria-haspopup="menu"]'); trigger.click();
  const pause = node.querySelector('[role="menuitem"]'); assert.equal(pause.textContent, 'Pause Search');
  assert.equal(pause.getAttribute('aria-disabled'), 'true');
  assert.match(document.getElementById(pause.getAttribute('aria-describedby')).textContent, /Preview only/);
  assert.equal(node.querySelectorAll('h2').length, 2);
  assert.equal(node.querySelector('.gcsp-activity-status svg').getAttribute('aria-hidden'), 'true');
  assert.equal(node.querySelector('a[href]'), null); assert.match(node.textContent, /No current offer/);
  node.destroy();
});

test('paused state says new searches and holds stopped, without an offer line when no offer exists', () => {
  const node = activityBody({ result: fixtures.paused });
  assert.equal(node.querySelector('.gcsp-activity-status').textContent.trim(), 'Inactive');
  assert.match(node.textContent, /New searches and holds have stopped\./); assert.doesNotMatch(node.textContent, /offer is still open/);
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

test('real command callbacks enable the shared menu; pending state blocks repeat effects with a concise reason', () => {
  let calls = 0;
  const node = activityBody({ result: fixtures['never-checked'], onPause: () => { calls += 1; } }); document.body.append(node);
  node.querySelector('.gcsp-action-trigger').click(); const action = node.querySelector('[role="menuitem"]');
  assert.equal(action.getAttribute('aria-disabled'), null); action.click(); assert.equal(calls, 1);
  const pending = activityBody({ result: fixtures['never-checked'], pending: true, onPause: () => { calls += 1; } }); document.body.append(pending);
  pending.querySelector('.gcsp-action-trigger').click(); const waiting = pending.querySelector('[role="menuitem"]');
  assert.equal(waiting.getAttribute('aria-disabled'), 'true'); assert.match(document.getElementById(waiting.getAttribute('aria-describedby')).textContent, /Updating search/);
  waiting.click(); assert.equal(calls, 1); node.destroy(); pending.destroy();
});

test('browser fixture snapshot remains derived from real commands; the plain states hold no check or offer', async () => {
  const { activityFixtures } = await import('../../blocks/gcsp/activity/activity-fixtures.js');
  assert.deepEqual(activityFixtures, await createActivityFixtures());
  for (const name of ['never-checked', 'paused']) {
    const v = activityFixtures.snapshots[name].value;
    assert.equal(v.lastSuccessfulCheck, null); assert.equal(v.sourceStatus, 'not-checked');
    assert.deepEqual(v.offers, []); assert.equal(v.currentOffer, null); assert.equal(v.searchEvidence.status, 'not-recorded');
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
  assert.equal((node.textContent.match(/Not searched yet/g) || []).length, 1);
  node.destroy();
});

const view = (name, extra = {}) => { const node = activityBody({ result: structuredClone(fixtures[name]), ...extra }); document.body.append(node); return node; };
const lines = (node) => [...node.querySelectorAll('.gcsp-activity-check-status p')].map((p) => p.textContent);
const clean = (node) => assert.doesNotMatch(node.textContent, /\u2014|\u2013|overnight|unattended/i);

test('FUCQ-212: an accepted offer never reads still searching, while a declined one still does', () => {
  const accepted = structuredClone(fixtures['offer-declined']); accepted.value.currentOffer.state = 'accepted';
  const node = activityBody({ result: accepted }); document.body.append(node);
  assert.doesNotMatch(node.textContent, /Still searching/); assert.match(node.textContent, /Accepted/); assert.match(lines(node)[0], /^Last check /);
  node.destroy?.(); node.remove();
  const declined = view('offer-declined'); assert.equal(lines(declined)[0], 'Still searching. No match yet.'); declined.destroy?.(); declined.remove();
});

test('FUCQ-215: after an accept the search reads finished and offers no pause or resume', () => {
  const accepted = structuredClone(fixtures['offer-declined']); accepted.value.currentOffer.state = 'accepted';
  const node = activityBody({ result: accepted, onPause: () => {}, onResume: () => {} }); document.body.append(node);
  const status = node.querySelector('.gcsp-activity-status');
  assert.equal(status.textContent.trim(), 'Finished. You accepted a car.'); assert.equal(status.getAttribute('role'), 'status');
  assert.equal(node.querySelector('[aria-haspopup="menu"]'), null); assert.doesNotMatch(node.textContent, /Pause Search|Resume Search|\bActive\b|\u2014/);
  node.destroy?.(); node.remove();
});

test('searching with no offer and a healthy source says still searching, with the last check counts', () => {
  const node = view('searching');
  assert.deepEqual(lines(node), ['Still searching. No match yet.', 'Last check 4 Nov 2026, 23:30: 12 cars checked, 0 suitable.']);
  assert.match(node.textContent, /No current offer/); assert.equal(node.querySelector('a[href]'), null);
  assert.doesNotMatch(node.textContent, /Source delayed|Couldn't check|Not searched yet/); clean(node); node.destroy();
});

test('source delayed and source unavailable are distinct from searching and from each other', () => {
  const delayed = view('source-delayed'); const down = view('source-unavailable');
  assert.equal(lines(delayed)[0], 'Source delayed. Waiting for stock data.'); assert.equal(lines(down)[0], "Couldn't check for new cars. Stock source unavailable.");
  for (const node of [delayed, down]) { assert.doesNotMatch(node.textContent, /Still searching/); assert.match(lines(node)[1], /^Last check /); clean(node); }
  assert.notEqual(lines(delayed)[0], 'Still searching. No match yet.'); delayed.destroy(); down.destroy();
});

test('offer waiting shows its real state, respond-by time and a real View offer link, with the held-car check', () => {
  const { currentOffer } = fixtures.offer.value;
  const node = view('offer'); const link = node.querySelector('a[href]');
  assert.equal(link.textContent, 'View offer'); assert.equal(link.getAttribute('href'), currentOffer.href);
  assert.match(link.getAttribute('href'), /^\/gcsp\/offer\?offerId=layout-offer&runId=/);
  assert.match(node.textContent, /Waiting for you/); assert.match(node.textContent, /Respond by 6 Nov 2026, 09:00/);
  assert.deepEqual(lines(node), ['Last check 4 Nov 2026, 23:30: 12 cars checked, 3 suitable. Found a car for you.']);
  assert.doesNotMatch(node.textContent, /Offer access unavailable|No current offer|Still searching/); assert.equal(node.querySelector('.gcsp-activity-consequence'), null);
  clean(node); node.destroy();
});

test('declined and expired offers show the closed state, no respond-by, and the search status', () => {
  for (const [name, label] of [['offer-declined', 'Declined'], ['offer-expired', 'Expired']]) {
    const node = view(name);
    assert.equal(node.querySelector('.gcsp-activity-offer-state').textContent, label); assert.doesNotMatch(node.textContent, /Respond by|Waiting for you/);
    assert.equal(node.querySelector('a[href]').textContent, 'View offer'); assert.equal(lines(node)[0], 'Still searching. No match yet.'); clean(node); node.destroy();
  }
});

test('paused with an open offer says so once, keeps View offer and the Resume Search menu', () => {
  const node = view('paused-offer');
  assert.equal(node.querySelector('.gcsp-activity-status').textContent.trim(), 'Inactive');
  assert.equal(node.querySelector('.gcsp-activity-consequence').textContent,
    'New searches and holds have stopped. Your offer is still open. View it to accept or decline.');
  assert.equal(node.querySelector('a[href]').textContent, 'View offer'); assert.match(node.textContent, /Waiting for you/);
  node.querySelector('.gcsp-action-trigger').click(); assert.equal(node.querySelector('[role="menuitem"]').textContent, 'Resume Search');
  assert.doesNotMatch(node.textContent, /Still searching|Source delayed/); clean(node); node.destroy();
});

test('every offer state has its own label and statuses never invent an overnight or unattended check', async () => {
  const { offerStateLabel } = await import('../../blocks/gcsp/activity/activity-copy.js');
  const labels = ['active', 'decision-pending', 'release-pending', 'accepted', 'rejected', 'declined', 'expired'].map(offerStateLabel);
  assert.deepEqual(labels, ['Waiting for you', 'Being processed', 'Being processed', 'Accepted', 'Declined', 'Declined', 'Expired']);
  assert.equal(offerStateLabel('mystery'), 'Status unavailable');
  const processing = structuredClone(fixtures.offer); processing.value.currentOffer.state = 'decision-pending';
  const node = activityBody({ result: processing }); assert.match(node.textContent, /Being processed/); assert.doesNotMatch(node.textContent, /Respond by/); node.destroy();
});

test('missing evidence falls back without inventing a check or a search line', () => {
  const result = structuredClone(fixtures.searching); Object.assign(result.value, { sourceStatus: 'evidence-unavailable' });
  const node = activityBody({ result }); assert.deepEqual(lines(node), ['Last check 4 Nov 2026, 23:30: 12 cars checked, 0 suitable.']); node.destroy();
  const none = structuredClone(fixtures.searching); Object.assign(none.value, { sourceStatus: 'not-checked', lastSuccessfulCheck: null, state: 'never-searched' });
  const bare = activityBody({ result: none }); assert.deepEqual(lines(bare), ['Not searched yet']); bare.destroy();
});

test('design display data applies only to the offer it references; the link and state come from the current offer', async () => {
  const { activityFixtures } = await import('../../blocks/gcsp/activity/activity-fixtures.js');
  const node = view('offer', { offerDisplay: activityFixtures.offerExample });
  assert.match(node.textContent, /Your BMW offer/); assert.equal(node.querySelector('img').getAttribute('src'), '/assets/brand-hero/bmw.jpg');
  assert.match(node.textContent, /Representative BMW brand image/); assert.equal(node.querySelector('a[href]').textContent, 'View offer');
  const foreign = view('offer', { offerDisplay: { offerRef: { offerId: 'foreign' }, title: 'Other car', images: activityFixtures.offerExample.images } });
  assert.equal(foreign.querySelector('img'), null); assert.doesNotMatch(foreign.textContent, /Other car/);
  assert.match(foreign.textContent, /Waiting for you/); assert.equal(foreign.querySelector('a[href]').textContent, 'View offer');
  node.destroy(); foreign.destroy();
});

const why = (node) => [...node.querySelectorAll('.gcsp-activity-why > p')].map((p) => p.textContent);
const withExclusions = (exclusions, change = {}) => {
  const result = structuredClone(fixtures['no-match-one']); Object.assign(result.value.lastSuccessfulCheck, { exclusions }); Object.assign(result.value, change); return result;
};
const need = (essential, value, cars = 12, operator = 'equals') => ({ essential, requirement: { operator, value }, cars });
const step = (node, label) => [...node.querySelectorAll('button')].find((b) => b.textContent === label);

test('FUCQ-219: every car excluded by one essential reads "No released car has ..."', () => {
  const node = view('no-match-one'); assert.deepEqual(why(node), ['No released car has 5 seats.']);
  assert.equal(node.querySelector('.gcsp-activity-why').getAttribute('aria-live'), 'polite'); clean(node);
  assert.equal(lines(node)[0], 'Still searching. No match yet.'); node.destroy();
});

test('FUCQ-219: two essentials with partial counts read as counts of the cars checked', () => {
  const node = view('no-match-two');
  assert.deepEqual(why(node), ['9 of 12 cars do not have 5 seats.', '6 of 12 cars do not have 430 litres of boot space.']); clean(node); node.destroy();
});

test('FUCQ-219: each essential has plain wording, and unknown fields never show a raw key or value', () => {
  const cases = [[need('equipment', ['towbar']), 'a towbar'], [need('equipment', ['sunroof']), 'the equipment you need'],
    [need('body', 'estate'), 'an estate body'], [need('body', 'suv'), 'an SUV body'], [need('fuel', 'phev'), 'plug-in hybrid power'],
    [need('fuel', 'diesel'), 'a diesel engine'], [need('fuel', 'ev'), 'electric power'], [need('frontIsofix', true), 'front ISOFIX points'],
    [need('rearIsofix', true), 'rear ISOFIX points'], [need('modelLine', 'X5'), 'the model you asked for'], [need('seats', 1), '1 seat']];
  for (const [row, phrase] of cases) {
    const node = activityBody({ result: withExclusions([row]) }); assert.deepEqual(why(node), [`No released car has ${phrase}.`]); node.destroy();
  }
  for (const row of [need('rearCamera', 'zzz-secret'), need('body', 'zzz-secret'), need('seats', 'many'), need('frontIsofix', false)]) {
    const node = activityBody({ result: withExclusions([row]) });
    assert.deepEqual(why(node), ['No released car meets one of your essentials.']); assert.doesNotMatch(node.textContent, /zzz|rearCamera|frontIsofix|seats/);
    node.destroy();
  }
  const partial = activityBody({ result: withExclusions([need('rearCamera', 'x', 3)]) });
  assert.deepEqual(why(partial), ['3 of 12 cars do not meet one of your essentials.']); partial.destroy();
});

test('FUCQ-219: Review your brief calls the host and Keep searching only acknowledges, as keyboard buttons', () => {
  let reviews = 0;
  const node = view('no-match-one', { onReviewBrief: () => { reviews += 1; } });
  const keep = step(node, 'Keep searching'); const review = step(node, 'Review your brief');
  assert.ok(keep && review); assert.deepEqual([keep.type, review.type, review.disabled], ['button', 'button', false]);
  review.focus(); review.click(); assert.equal(reviews, 1); assert.ok(step(node, 'Keep searching'));
  keep.focus(); keep.click();
  const note = node.querySelector('.gcsp-activity-next [role="status"]');
  assert.equal(note.textContent, 'Buddy will keep searching with your brief as it is.');
  assert.equal(step(node, 'Keep searching'), undefined); assert.equal(reviews, 1);
  assert.equal(document.activeElement, step(node, 'Review your brief')); assert.deepEqual(why(node), ['No released car has 5 seats.']);
  clean(node); node.destroy();
});

test('FUCQ-219: without a host callback Review your brief is disabled with a Preview only reason', () => {
  const node = view('no-match-one');
  const review = step(node, 'Review your brief'); assert.equal(review.disabled, true);
  assert.equal(document.getElementById(review.getAttribute('aria-describedby')).textContent, 'Preview only');
  step(node, 'Keep searching').click(); const note = node.querySelector('.gcsp-activity-next [role="status"]');
  assert.equal(document.activeElement, note); node.destroy();
});

test('FUCQ-219: no explanation while paused, finished, holding an offer, with a suitable car or without reasons', () => {
  const none = (result) => { const node = activityBody({ result, onReviewBrief: () => {} }); const found = [why(node).length, !!step(node, 'Keep searching')]; node.destroy(); return found; };
  assert.deepEqual(none(withExclusions([need('seats', 5, 12, 'gte')], { permission: { ...fixtures['no-match-one'].value.permission, paused: true, canSearch: false } })), [0, false]);
  const accepted = withExclusions([need('seats', 5, 12, 'gte')]);
  accepted.value.currentOffer = { ...fixtures['offer-declined'].value.currentOffer, state: 'accepted' }; assert.deepEqual(none(accepted), [0, false]);
  const open = withExclusions([need('seats', 5, 12, 'gte')]); open.value.currentOffer = structuredClone(fixtures.offer.value.currentOffer);
  assert.deepEqual(none(open), [0, false]);
  const suitable = withExclusions([need('seats', 5, 12, 'gte')]); suitable.value.lastSuccessfulCheck.suitableCars = 2; assert.deepEqual(none(suitable), [0, false]);
  assert.deepEqual(none(withExclusions([])), [0, false]); assert.deepEqual(none(fixtures.searching), [0, false]);
  const declined = withExclusions([need('seats', 5, 12, 'gte')]); declined.value.currentOffer = structuredClone(fixtures['offer-declined'].value.currentOffer);
  assert.deepEqual(none(declined), [1, true]);
});

test('FUCQ-240: a check that left the employee out for want of a renewal date says so, unless paused', () => {
  const left = structuredClone(fixtures.searching); left.value.lastSuccessfulCheck.limitation = 'renewal-deadline-unknown';
  const line = 'Buddy cannot hold a car for you yet. There is no renewal date on your record to set your place in the queue, so you are left out of allocation until one is recorded.';
  const node = activityBody({ result: left });
  assert.deepEqual(lines(node), ['Still searching. No match yet.', 'Last check 4 Nov 2026, 23:30: 12 cars checked, 0 suitable.', line]);
  assert.doesNotMatch(node.textContent, /\u2014/); node.destroy();
  assert.ok(!lines(view('searching')).includes(line), 'no limitation key, no line');
  const paused = structuredClone(fixtures.paused); paused.value.lastSuccessfulCheck = { ...structuredClone(fixtures.searching.value.lastSuccessfulCheck), limitation: 'renewal-deadline-unknown' };
  const quiet = activityBody({ result: paused }); assert.ok(!lines(quiet).includes(line)); quiet.destroy();
});
