import test from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, add, assumption, controls, good, launch, offerPath, openLink, postReset, query, readOffer, resetRun, rows, tickTo,
  actAs, saveBrief, walkPaulasPath } from './helpers/gcsp-journey.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/shell/account-runtime.js';

test('a reset keeps the launcher usable: presenter session, adopted offer journey policy and pin', async (t) => {
  const f = await launch(t);
  const before = await controls(f);
  const { reply } = await postReset(f, 'regression');
  assert.notEqual(reply.json.value.presenterSession?.status, 'unavailable', 'the reset renews the presenter session');
  await f.reopenPresenter();
  const after = await controls(f);
  assert.equal(after.runId, reply.json.value.runId);
  assert.equal(after.versions.policy, before.versions.policy, 'the new run pins the adopted version its own store holds');
  assert.match(after.versions.policy, /\+offer-journey-v1$/);
  for (const key of ['offer.declineReasons.v1', 'offer.followupQuestions.v1']) assert.ok(await assumption(f, key), key);
});

test('Paula critical path: reset, brief, release, offer, decline, one change, second offer, accept, hand-off', async (t) => {
  const f = await launch(t);
  const run = await walkPaulasPath(t, f, 'path');
  assert.ok(run.runId);
  // FUCQ-212: the accepted car allocates the slot, and the shell header must still name Paula.
  const reply = await f.api('/api/gcsp/manual/account', { session: run.sessions.paula });
  assert.deepEqual([reply.status, reply.json.value?.state], [200, 'no-entitlement']);
  const account = await createAccountHttpAdapter({ fetch: async () => ({ ok: true, status: reply.status, json: async () => reply.json }) }).loadAccount();
  assert.equal(account.status, 'ready'); assert.match(account.name, /Paula/);
});

/** Every identifier a walk saw, so a repeat can be shown to share none of them. */
const identifiersOf = (seen) => [seen.runId, ...seen.released, ...seen.released2, seen.first.orderUuid, seen.second.orderUuid, seen.operationId,
  ...['first', 'second', 'alex'].flatMap((name) => ['offerId', 'holdId', 'quoteId', 'jobId', 'decisionId'].map((key) => seen[name][key])),
].filter(Boolean);

test('repeat after a second reset: the same outcome with new identifiers, and the first run offer link is stale', async (t) => {
  const f = await launch(t);
  const one = await walkPaulasPath(t, f, 'one');
  const two = await walkPaulasPath(t, f, 'two');
  assert.deepEqual(two.outline, one.outline, 'the same states, steps and car lines');
  const first = new Set(identifiersOf(one));
  assert.ok(first.size >= 20, 'the first run recorded its identifiers');
  assert.deepEqual(identifiersOf(two).filter((id) => first.has(id)), [], 'run, offer, hold, outbox job, order and decision ids are all new');
  assert.equal(two.previousRunId, one.runId);
  // The first run's link and cookie reach a refusal, not the old offer.
  const stale = await openLink(f, one.first.link);
  assert.deepEqual([stale.reply.status, stale.reply.json.status], [409, 'stale-run']);
  const read = await f.api(`${offerPath(one.first.selector)}${query(one.first.selector)}`, { session: one.first.session });
  assert.deepEqual([read.status, read.json.status], [409, 'stale-run'], 'the old offer cookie cannot read the offer');
  const decide = await f.api(`${offerPath(one.first.selector)}/decision`, { session: one.first.session, body: { commandId: 'stale-decline',
    runId: one.runId, decision: 'decline', reasonCode: one.first.reasonCode, expectedOfferVersion: 1, expectedHoldVersion: 1, expectedQuoteVersion: 1 } });
  assert.deepEqual([decide.status, decide.json.status], [409, 'stale-run'], 'the old offer cookie cannot decide');
});

/** Reset, brief and the first release for Paula and Alex; returns every place the first hold deadline is shown. */
async function firstDeadlines(t, label, edit) {
  const f = await launch(t, { edit, environmentId: label });
  await resetRun(f, label);
  const sessions = { paula: await actAs(f, label, 'paula'), alex: await actAs(f, label, 'alex') };
  await saveBrief(f, label, 'paula', sessions.paula, 'estate'); await saveBrief(f, label, 'alex', sessions.alex, 'estate');
  const cue = (await assumption(f, 'clock.scenario.v1')).namedTimes.release;
  await tickTo(f, label, { mode: 'next-release' });
  const hold = (await rows(f, 'holds')).find((row) => row.employeeId === 'employee-paula');
  const offer = (await rows(f, 'offers')).find((row) => row.holdId === hold.holdId);
  const messages = good((await f.api('/api/gcsp/presenter/outbox')).json, 'outbox viewer').messages;
  const message = messages.find((row) => row.recipient.employeeId === 'employee-paula');
  const opened = await openLink(f, message.offerLink);
  const view = await readOffer(f, opened.session, opened.selector);
  const activity = await activityOf(f, sessions.paula);
  const alexHold = (await rows(f, 'holds')).find((row) => row.employeeId === 'employee-alex');
  const windows = (await assumption(f, 'supply.release.windows')).windows;
  return { f, cue, duration: await assumption(f, 'hold.buddy.durationSeconds'), alexHold, windows,
    shown: { hold: hold.expiresAt, offer: offer.expiresAt, view: view.expiresAt, activity: activity.currentOffer.expiresAt,
      message: /available until (\S+?)\./.exec(message.textBody)?.[1] } };
}
const lapsesAtSecondRelease = async (run) => {
  const at = add(run.cue, run.windows[1].offsetMinutes);
  const tick = await tickTo(run.f, 'central', { mode: 'to', to: at });
  return tick.outcome('buddy-expiry').expired.some((row) => row.holdId === run.alexHold.holdId);
};

test('one central change: the buddy hold duration moves the stored deadline, every display and the lapse', async (t) => {
  const base = await firstDeadlines(t, 'central-base');
  // The edit is the one assumption: lengthen the hold by the gap between the two release windows.
  const longer = await firstDeadlines(t, 'central-longer', (seed, entry) => {
    entry('hold.buddy.durationSeconds').value += entry('supply.release.windows').value.windows[1].offsetMinutes * 60;
  });
  const gap = longer.duration - base.duration;
  assert.equal(gap, longer.windows[1].offsetMinutes * 60, 'PolicyService returns the changed duration');
  for (const run of [base, longer]) {
    const deadline = add(run.cue, run.duration / 60);
    // The message prints the deadline without milliseconds or zone.
    assert.deepEqual(run.shown, { hold: deadline, offer: deadline, view: deadline, activity: deadline, message: deadline.slice(0, 19) },
      'hold, offer, offer view, activity and message all show cue plus the policy duration');
  }
  assert.equal(Date.parse(longer.shown.view) - Date.parse(base.shown.view), gap * 1000, 'the page deadline moves by the change');
  assert.equal(Date.parse(longer.shown.hold) - Date.parse(base.shown.hold), gap * 1000, 'the stored deadline moves by the change');
  assert.equal(await lapsesAtSecondRelease(base), true, 'with the canonical duration Alex\'s offer lapses by the second release');
  assert.equal(await lapsesAtSecondRelease(longer), false, 'with the longer duration it does not');
});
