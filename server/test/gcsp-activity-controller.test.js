import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFixtures } from '../../blocks/gcsp/activity/activity-fixtures.js';
const mod = await import('../../blocks/gcsp/activity/activity-controller.js').catch(() => ({}));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const active = () => structuredClone(activityFixtures.snapshots['never-checked']);
const paused = () => structuredClone(activityFixtures.snapshots.paused);
const make = (options) => { assert.equal(typeof mod.createActivityController, 'function'); return mod.createActivityController(options); };

test('controller loads supplied server facts and owns immutable snapshots', async () => {
  const input = active(); const published=[];
  const c=make({adapter:{readActivity:async () => input},onChange:(state) => published.push(state)});
  await c.refresh(); assert.equal(c.getState().phase,'ready'); assert.equal(c.getState().result.value.briefVersion,1);
  input.value.permission.paused=true; published.at(-1).result.value.briefVersion=900;
  assert.equal(c.getState().result.value.permission.paused,false); assert.equal(c.getState().result.value.briefVersion,1); c.destroy();
});

test('new reads abort predecessors and late results cannot repaint after newer reads or destroy', async () => {
  const first=deferred(),second=deferred();const signals=[];let calls=0;const changes=[];
  const c=make({adapter:{readActivity:({signal}) => { signals.push(signal);return ++calls===1?first.promise:second.promise; }},onChange:(s) => changes.push(s)});
  const a=c.refresh(),b=c.refresh();assert.equal(signals[0].aborted,true);second.resolve(paused());await b;first.resolve(active());await a;
  assert.equal(c.getState().result.value.permission.paused,true);
  const late=deferred();const d=make({adapter:{readActivity:({signal}) => { signals.push(signal);return late.promise;}},onChange:(s) => changes.push(s)});
  const pending=d.refresh();d.destroy();const count=changes.length;late.resolve(active());await pending;assert.equal(changes.length,count);assert.equal(signals.at(-1).aborted,true);c.destroy();
});

test('pause sends exact current version once, stays pending without optimistic flip, then reloads real outcome', async () => {
  const command=deferred();let reads=0,calls=0,payload;
  const c=make({adapter:{readActivity:async () => ++reads===1?active():paused(),pause:(body) => { calls++;payload=body;return command.promise;}},createCommandId:() => 'pause-command'});
  await c.refresh();const p=c.pause();await c.pause();assert.equal(calls,1);assert.equal(payload.commandId,'pause-command');assert.equal(payload.expectedBriefVersion,1);
  assert.equal(c.getState().pending,true);assert.equal(c.getState().result.value.permission.paused,false);
  command.resolve({status:'ok',value:{}});await p;assert.equal(reads,2);assert.equal(c.getState().pending,false);assert.equal(c.getState().result.value.permission.paused,true);assert.match(c.getState().message,/paused/i);c.destroy();
});

test('stale version reloads server state; failed refresh clears old facts and retry recovers', async () => {
  let reads=0;const c=make({adapter:{readActivity:async () => ++reads===1?active():reads===2?paused():reads===3?{status:'unavailable'}:active(),pause:async () => ({status:'stale-version'})},createCommandId:() => 'stale'});
  await c.refresh();await c.pause();assert.equal(c.getState().result.value.permission.paused,true);assert.match(c.getState().message,/changed/i);
  await c.refresh();assert.equal(c.getState().phase,'unavailable');assert.equal(c.getState().result,null);await c.refresh();assert.equal(c.getState().phase,'ready');c.destroy();
});

test('no confirmed current permission, malformed reads and failed commands never leave a stale enabled state', async () => {
  let commands=0;const noBrief=active();noBrief.value.permission=null;noBrief.value.briefVersion=null;
  const c=make({adapter:{readActivity:async () => noBrief,pause:async () => {commands++;return {status:'ok'};}}});await c.refresh();await c.pause();assert.equal(commands,0);c.destroy();
  let reads=0;const d=make({adapter:{readActivity:async () => ++reads===1?active():{status:'ok'},pause:async () => {throw new Error('offline');}},createCommandId:() => 'failure'});await d.refresh();await d.pause();assert.equal(d.getState().phase,'unavailable');assert.equal(d.getState().result,null);d.destroy();
});

test('uncloneable adapter data fails closed instead of rejecting refresh or leaving loading stuck', async () => {
  const input=active();input.value.offers.push({unexpected:() => {}});
  const c=make({adapter:{readActivity:async () => input}});await c.refresh();
  assert.equal(c.getState().phase,'unavailable');assert.equal(c.getState().result,null);c.destroy();
});

const shown = () => { const s = structuredClone(activityFixtures.snapshots.offer); s.value.runId = 'run-1'; return s; };
test('ready state carries the adapter offer display once; failures and absent readers give null', async () => {
  const seen = []; const display = { offerRef: { offerId: 'layout-offer' }, title: 'T', images: [] }; let call;
  const adapter = { readActivity: async () => shown(), readOfferDisplay: async (input) => { call = input; return display; } };
  const c = make({ adapter, onChange: (s) => seen.push(s.phase) }); await c.refresh();
  assert.equal(c.getState().phase, 'ready'); assert.deepEqual(c.getState().offerDisplay, display);
  assert.deepEqual([call.offerId, call.runId, call.signal instanceof AbortSignal], ['layout-offer', 'run-1', true]);
  assert.deepEqual(seen, ['loading', 'ready']);
  for (const readOfferDisplay of [async () => { throw new Error('x'); }, undefined]) {
    const d = make({ adapter: { readActivity: async () => shown(), readOfferDisplay } }); await d.refresh();
    assert.equal(d.getState().phase, 'ready'); assert.equal(d.getState().offerDisplay, null); d.destroy();
  }
  const none = make({ adapter: { readActivity: async () => active(), readOfferDisplay: async () => { throw new Error('no call'); } } });
  await none.refresh(); assert.equal(none.getState().offerDisplay, null); c.destroy();
});
test('a stale generation discards a late offer display', async () => {
  const slow = deferred(); let calls = 0; const changes = [];
  const c = make({ adapter: { readActivity: async () => shown(), readOfferDisplay: () => ++calls === 1 ? slow.promise : Promise.resolve(null) }, onChange: (s) => changes.push(s) });
  const a = c.refresh(); await Promise.resolve(); await Promise.resolve(); const b = c.refresh(); await b;
  slow.resolve({ offerRef: { offerId: 'layout-offer' }, images: [] }); await a;
  assert.equal(c.getState().offerDisplay, null); assert.equal(changes.filter((s) => s.phase === 'ready').length, 1); c.destroy();
});
