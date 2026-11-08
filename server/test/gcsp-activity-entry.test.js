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

test('an adapter assigned before custom element definition survives upgrade and reads the injected account',async () => {
  const node=document.createElement('gcsp-activity');let reads=0;
  node.adapter={loadAccount:async () => account,readActivity:async () => {reads++;return snapshot();}};
  document.body.append(node);assert.equal(reads,0);mod.defineGcspActivity(dom.window.customElements);
  await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Active');assert.equal(reads,1);node.remove();
});

test('custom element registration, adapter remount, refresh and disconnect are isolated and abort owned requests',async () => {
  assert.equal(typeof mod.defineGcspActivity,'function');const Type=mod.defineGcspActivity(dom.window.customElements);assert.equal(mod.defineGcspActivity(dom.window.customElements),Type);
  const node=document.createElement('gcsp-activity');let calls=0;const first=deferred();let signal;
  node.adapter={loadAccount:async () => account,readActivity:(input) => {signal=input.signal;return first.promise;}};document.body.append(node);await settle(node,() => !!signal);
  node.adapter={loadAccount:async () => account,readActivity:async () => {calls++;return snapshot('paused');}};assert.equal(signal.aborted,true);first.resolve(snapshot());await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Inactive');
  await node.refresh();assert.equal(calls,2);node.remove();assert.equal(node.childElementCount,0);
});

const helpAdapter=() => {const calls=[];return {calls,readHelp:async () => {calls.push('readHelp');return {status:'ok',value:{opensCase:false,automaticRecoveryPriority:false}};},
  readCases:async () => {calls.push('readCases');return {status:'ok',value:{cases:[],asOf:'2026-11-05T09:00:00.000Z',policyVersion:'p'}};},
  requestHelp:async () => {calls.push('requestHelp');return {status:'ok'};},changeAfterDecline:async () => {calls.push('changeAfterDecline');return {status:'ok'};}};};

test('help mounts once beside the activity, survives repaints, sends no write and tears down with the page',async () => {
  const help=helpAdapter();const writes=[];let current=snapshot();const node=root();
  const stop=mount(node,{helpAdapter:help,adapter:{loadAccount:async () => account,readActivity:async () => current,
    pause:async () => {writes.push('pause');current=snapshot('paused');return {status:'ok'};},resume:async () => {writes.push('resume');current=snapshot();return {status:'ok'};}}});
  await settle(node,(r) => r.querySelector('.gcsp-activity-help .gcsp-cases-body'));await settle(node,() => help.calls.includes('readCases'));
  const region=node.querySelector('.gcsp-activity-help'),helpBody=region.querySelector('.gcsp-cases-body');
  assert.equal(node.querySelectorAll('.gcsp-activity-help').length,1);assert.equal(region.getAttribute('aria-label'),'Renewal help');
  assert.equal(region.querySelector('h2').textContent,'Renewal help');assert.equal(help.calls.filter((c) => c==='readCases').length,1);
  await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Active');
  node.querySelector('.gcsp-action-trigger').click();node.querySelector('[role="menuitem"]').click();
  await settle(node,(r) => r.querySelector('.gcsp-activity-status')?.textContent==='Inactive');await stop.refresh();
  assert.equal(writes.length,1);assert.equal(node.querySelector('.gcsp-activity-help .gcsp-cases-body'),helpBody);
  assert.equal(help.calls.filter((c) => c==='readCases').length,1);assert.deepEqual(help.calls.filter((c) => /request|change/i.test(c)),[]);
  stop();assert.equal(node.childElementCount,0);
});

test('no help region renders without a help adapter or while the account is not ready',async () => {
  const help=helpAdapter();const plain=root();mount(plain,{adapter:{loadAccount:async () => account,readActivity:async () => snapshot()}});
  await settle(plain,(r) => r.querySelector('.gcsp-activity-status'));assert.equal(plain.querySelector('.gcsp-activity-help'),null);
  const refused=root();mount(refused,{helpAdapter:help,adapter:{loadAccount:async () => ({status:'unavailable'}),readActivity:async () => snapshot()}});
  await settle(refused,(r) => r.querySelector('.gcsp-activity'));assert.equal(refused.querySelector('.gcsp-activity-help'),null);assert.deepEqual(help.calls,[]);
});

test('the custom element passes an early help adapter through and tears it down on disconnect',async () => {
  const help=helpAdapter();const node=document.createElement('gcsp-activity');
  node.helpAdapter=help;node.adapter={loadAccount:async () => account,readActivity:async () => snapshot()};document.body.append(node);
  mod.defineGcspActivity(dom.window.customElements);
  await settle(node,(r) => r.querySelector('.gcsp-activity-help .gcsp-cases-body'));node.remove();assert.equal(node.childElementCount,0);
});

const assertRestarted=(node,reloads) => {
  const screen=node.querySelector('.gcsp-activity');assert.ok(screen.querySelector('[role="alert"]'));assert.match(screen.textContent,/Demo restarted/);assert.match(screen.textContent,/Reload the page to continue/);
  assert.doesNotMatch(node.textContent,/stale-run|—|unavailable|could not be updated/i);
  const buttons=screen.querySelectorAll('button');assert.equal(buttons.length,1);const [reload]=buttons;
  assert.equal(reload.type,'button');assert.equal(reload.disabled,false);assert.equal(document.activeElement===reload||reload.tabIndex>=0,true);
  const before=reloads.length;reload.click();assert.equal(reloads.length,before+1);
};

test('a stale-run read shows the restarted screen with a working Reload, not the generic failure',async () => {
  const node=root(),reloads=[];let reads=0;
  mount(node,{reload:() => reloads.push(1),adapter:{loadAccount:async () => account,readActivity:async () => {reads++;return {status:'stale-run',reason:'This request belongs to an earlier demonstration run.'};}}});
  await settle(node,(r) => r.textContent.includes('Demo restarted'));assertRestarted(node,reloads);assert.equal(reads,1);
});

test('a stale-run pause shows the restarted screen and neither resends nor rereads',async () => {
  const node=root(),reloads=[];let reads=0,pauses=0;
  mount(node,{reload:() => reloads.push(1),adapter:{loadAccount:async () => account,readActivity:async () => {reads++;return snapshot();},pause:async () => {pauses++;return {status:'stale-run'};}}});
  await settle(node,(r) => r.querySelector('.gcsp-action-trigger'));
  node.querySelector('.gcsp-action-trigger').click();node.querySelector('[role="menuitem"]').click();
  await settle(node,(r) => r.textContent.includes('Demo restarted'));assertRestarted(node,reloads);
  await new Promise((r) => setTimeout(r,20));assert.equal(pauses,1);assert.equal(reads,1);assert.equal(node.querySelector('.gcsp-action-trigger'),null);
});

test('a stale-run resume shows the restarted screen',async () => {
  const node=root(),reloads=[];let resumes=0;
  mount(node,{reload:() => reloads.push(1),adapter:{loadAccount:async () => account,readActivity:async () => snapshot('paused'),resume:async () => {resumes++;return {status:'stale-run'};}}});
  await settle(node,(r) => r.querySelector('.gcsp-action-trigger'));
  node.querySelector('.gcsp-action-trigger').click();node.querySelector('[role="menuitem"]').click();
  await settle(node,(r) => r.textContent.includes('Demo restarted'));assertRestarted(node,reloads);assert.equal(resumes,1);
});

test('FUCQ-219: Review your brief hands the brief destination to the host; without a host it stays disabled',async () => {
  const go=[];const node=root();
  mount(node,{onNavigate:(to) => go.push(to),adapter:{loadAccount:async () => account,readActivity:async () => snapshot('no-match-one')}});
  await settle(node,(r) => r.querySelector('.gcsp-activity-why'));
  [...node.querySelectorAll('button')].find((b) => b.textContent==='Review your brief').click();assert.deepEqual(go,['brief']);
  const bare=root();mount(bare,{adapter:{loadAccount:async () => account,readActivity:async () => snapshot('no-match-one')}});
  await settle(bare,(r) => r.querySelector('.gcsp-activity-why'));
  assert.equal([...bare.querySelectorAll('button')].find((b) => b.textContent==='Review your brief').disabled,true);
});
