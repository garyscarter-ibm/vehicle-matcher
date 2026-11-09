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

const lapsed=(status=401,body={error:'Unauthorized'}) => async () => ({ok:false,status,json:async () => {if(body===undefined)throw new SyntaxError('not json');return body;}});
test('a 401 with no status (lapsed access key) reads access-required; a status keeps its own result',async () => {
  for(const body of [{error:'Unauthorized'},undefined]){const a=make({fetch:lapsed(401,body)});
    assert.deepEqual(await a.readActivity(),{status:'access-required'});assert.deepEqual(await a.pause({commandId:'p',expectedBriefVersion:2}),{status:'access-required'});}
  for(const status of [401,403])assert.deepEqual(await make({fetch:lapsed(status,{status:'forbidden'})}).readActivity(),{status:'forbidden'});
  assert.deepEqual(await make({fetch:lapsed(500,undefined)}).readActivity(),{status:'unavailable'});
});

import {readFileSync} from 'node:fs';
const offerEnvelope=(images=[{src:'/assets/gcsp-vehicle-evidence/x.webp',alt:'Car',fidelity:'representative-configuration',sourceRef:'ref-1'}]) => {
  const value=JSON.parse(readFileSync(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json',import.meta.url),'utf8'));
  value.availableActions=[];value.quote.facts.display={...value.quote.facts.display,images,photo:images[0]?.src??null};
  return {status:'ok',value,contractVersion:'1.0.0'};
};
test('readOfferDisplay reads the exact offer URL and returns only the validated display',async () => {
  const calls=[];const signal=new AbortController().signal;let answer=offerEnvelope();
  const a=make({fetch:async (path,options) => {calls.push({path,options});return {ok:true,json:async () => answer};}});
  const display=await a.readOfferDisplay({offerId:'offer-one',runId:'demo-4c7d45fb1cefd387adf500299f0b119f',signal});
  assert.equal(calls[0].path,'/api/gcsp/offers/offer-one?runId=demo-4c7d45fb1cefd387adf500299f0b119f');
  assert.deepEqual([calls[0].options.method,calls[0].options.credentials,calls[0].options.cache,calls[0].options.redirect,calls[0].options.signal],['GET','same-origin','no-store','error',signal]);
  assert.equal(display.offerRef.offerId,'offer-one');assert.equal(display.title,'Synthetic exact car 987');
  assert.deepEqual(display.images.map((i) => [i.src,i.alt,i.fidelity]),[['/assets/gcsp-vehicle-evidence/x.webp','Car','representative-configuration']]);
  const ids={offerId:'offer-one',runId:'demo-4c7d45fb1cefd387adf500299f0b119f'};
  assert.equal(await a.readOfferDisplay({...ids,offerId:'other'}),null);assert.equal(await a.readOfferDisplay({...ids,runId:'foreign'}),null);
  assert.equal(await a.readOfferDisplay({offerId:'',runId:'r'}),null);
  answer={status:'not-found'};assert.equal(await a.readOfferDisplay(ids),null);
  answer={...offerEnvelope(),value:{...offerEnvelope().value,schemaVersion:2}};assert.equal(await a.readOfferDisplay(ids),null);
  assert.equal(await make({fetch:async () => {throw new Error('offline');}}).readOfferDisplay(ids),null);
});
