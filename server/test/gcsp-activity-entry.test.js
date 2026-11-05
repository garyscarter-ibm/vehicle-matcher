import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, settle } from './dom-harness.js';
import { activityFixtures } from '../../blocks/gcsp/activity/activity-fixtures.js';
let dom,mod; const cleanups=[];
const deferred=() => {let resolve;const promise=new Promise((r) => {resolve=r;});return {promise,resolve};};
const snapshot=(name='never-checked') => structuredClone(activityFixtures.snapshots[name]);
const account={status:'ready',name:'Paula (synthetic)',context:'Synthetic activity fixture'};
const mount=(root,ctx) => {assert.equal(typeof mod.mountActivity,'function');const stop=mod.mountActivity(root,ctx);cleanups.push(stop);return stop;};
const root=() => {const node=document.createElement('div');document.body.append(node);return node;};
before(async () => {dom=installDom();mod=await import('../../blocks/gcsp/activity/gcsp-activity.js').catch(() => ({}));});
after(() => {cleanups.forEach((c) => c());dom.window.close();});
beforeEach(() => {cleanups.splice(0).forEach((c) => c());resetDom();});

test('mount waits for account, reads real adapter state and enables callback-owned pause/resume with retained focus',async () => {
  const loading=deferred();let reads=0,pauses=0;let current=snapshot();const node=root();
  const stop=mount(node,{adapter:{loadAccount:() => loading.promise,readActivity:async () => {reads++;return current;},pause:async () => {pauses++;current=snapshot('paused');return {status:'ok'};},resume:async () => {current=snapshot();return {status:'ok'};}}});
  assert.equal(reads,0);loading.resolve(account);await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Active');
  const trigger=node.querySelector('.gcsp-action-trigger');trigger.focus();trigger.click();node.querySelector('[role="menuitem"]').click();
  await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Inactive');assert.equal(pauses,1);assert.equal(reads,2);
  assert.equal(document.activeElement,node.querySelector('.gcsp-action-trigger'));assert.match(node.querySelector('.gcsp-activity-announcement[aria-live="polite"]').textContent,/paused/i);
  node.querySelector('.gcsp-action-trigger').click();node.querySelector('[role="menuitem"]').click();await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Active');
  await stop.refresh();assert.equal(reads,4);stop();assert.equal(node.childElementCount,0);
});

test('failed refresh removes stale offers; Retry loads current server state with focus retained',async () => {
  let current=snapshot('offer');const node=root();const stop=mount(node,{offerDisplay:activityFixtures.offerExample,adapter:{loadAccount:async () => account,readActivity:async () => current}});
  await settle(node,(r) => r.querySelector('.gcsp-activity img'));current={status:'unavailable'};await stop.refresh();assert.equal(node.querySelector('.gcsp-activity img'),null);assert.match(node.textContent,/Activity unavailable/);
  const retry=node.querySelector('.gcsp-activity button');retry.focus();current=snapshot();retry.click();await settle(node,(r) => r.querySelector('.gcsp-activity-status'));
  assert.equal(document.activeElement,node.querySelector('.gcsp-action-trigger'));
});

test('external abort and brand/account refusal leave no active read or late painting',async () => {
  const later=deferred();let signal,reads=0;const node=root(),abort=new AbortController();
  const stop=mount(node,{signal:abort.signal,adapter:{loadAccount:async () => account,readActivity:(input) => {reads++;signal=input.signal;return later.promise;}}});
  await settle(node,() => reads===1);abort.abort();assert.equal(signal.aborted,true);later.resolve(snapshot());await Promise.resolve();assert.equal(node.childElementCount,0);stop();
  const bad=root();mount(bad,{brand:'mini',adapter:{loadAccount:async () => account,readActivity:async () => {reads++;return snapshot();}}});assert.match(bad.textContent,/Not available for this brand/);assert.equal(reads,1);
  const missing=root();mount(missing,{adapter:{loadAccount:async () => ({status:'unavailable'}),readActivity:async () => {reads++;return snapshot();}}});await settle(missing,(r) => r.textContent.includes('Activity unavailable'));assert.equal(reads,1);
});

test('a refresh preserves focus moved outside the body and account retry owns account failure',async () => {
  const read=deferred();let reads=0;const node=root();const outside=document.createElement('button');outside.textContent='Outside';document.body.append(outside);
  const stop=mount(node,{adapter:{loadAccount:async () => account,readActivity:async () => ++reads===1?snapshot():read.promise}});
  await settle(node,(r) => r.querySelector('.gcsp-action-trigger'));node.querySelector('.gcsp-action-trigger').focus();
  const pending=stop.refresh();assert.equal(document.activeElement,node.querySelector('main'));outside.focus();read.resolve(snapshot('paused'));await pending;
  assert.equal(document.activeElement,outside);
  const refused=root();mount(refused,{adapter:{loadAccount:async () => ({status:'unavailable'}),readActivity:async () => snapshot()}});
  await settle(refused,(r) => r.querySelector('.gcsp-activity'));assert.equal(refused.querySelector('.gcsp-activity button').disabled,true);
});

test('custom element registration, adapter remount, refresh and disconnect are isolated and abort owned requests',async () => {
  assert.equal(typeof mod.defineGcspActivity,'function');const Type=mod.defineGcspActivity(dom.window.customElements);assert.equal(mod.defineGcspActivity(dom.window.customElements),Type);
  const node=document.createElement('gcsp-activity');let calls=0;const first=deferred();let signal;
  node.adapter={loadAccount:async () => account,readActivity:(input) => {signal=input.signal;return first.promise;}};document.body.append(node);await settle(node,() => !!signal);
  node.adapter={loadAccount:async () => account,readActivity:async () => {calls++;return snapshot('paused');}};assert.equal(signal.aborted,true);first.resolve(snapshot());await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Inactive');
  await node.refresh();assert.equal(calls,2);node.remove();assert.equal(node.childElementCount,0);
});
