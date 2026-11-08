import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../../blocks/gcsp/activity/activity-http.js').catch(() => ({}));
const make=(args) => {assert.equal(typeof mod.createActivityHttpAdapter,'function');return mod.createActivityHttpAdapter(args);};
test('transport uses fixed same-origin no-store credentialed paths and whitelists command fields',async () => {
  const calls=[];const signal=new AbortController().signal;
  const a=make({fetch:async (path,options) => {calls.push({path,options});return {ok:true,json:async () => ({status:'ok',value:{}})};}});
  await a.readActivity({signal});await a.pause({commandId:'p',expectedBriefVersion:2,employeeId:'forged',runId:'foreign',signal});await a.resume({commandId:'r',expectedBriefVersion:3,signal});
  assert.deepEqual(calls.map((c) => c.path),['/api/gcsp/activity','/api/gcsp/brief/pause','/api/gcsp/brief/resume']);
  for(const c of calls){assert.equal(c.options.credentials,'same-origin');assert.equal(c.options.cache,'no-store');assert.equal(c.options.redirect,'error');assert.equal(c.options.signal,signal);}
  assert.deepEqual(JSON.parse(calls[1].options.body),{commandId:'p',expectedBriefVersion:2});assert.equal(calls[0].options.body,undefined);
});
test('transport retains real stale/session outcomes and maps network, malformed and false-success responses to unavailable',async () => {
  const answers=[{ok:false,json:async () => ({status:'stale-version'})},{ok:false,json:async () => ({status:'missing-session'})},{ok:false,json:async () => ({status:'ok'})},{ok:true,json:async () => ({unexpected:true})}];
  const a=make({fetch:async () => {if(!answers.length)throw new Error('offline');return answers.shift();}});
  assert.equal((await a.pause({commandId:'p',expectedBriefVersion:1})).status,'stale-version');assert.equal((await a.readActivity()).status,'missing-session');
  for(let i=0;i<3;i++)assert.equal((await a.readActivity()).status,'unavailable');
});
