import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createAccountHttpAdapter } from '../../blocks/gcsp/shell/account-runtime.js';
import { createActivityHttpAdapter } from '../../blocks/gcsp/activity/activity-http.js';
import { createActivityController } from '../../blocks/gcsp/activity/activity-controller.js';
import { preference, essential } from './helpers/employee-recommendation.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';

test('actual live entry bootstraps the shared canonical account and current activity commands on one origin',async (t) => {
  const https=await createLocalHttpsFixture(t);const fetch=https.fetch;
  const opened=await startGcspDemo({runtime:{mode:'memory',environmentId:'activity-live-http',policyAsOf:'2026-11-05T14:00:00.000Z',commandId:'live-http-bootstrap'},port:0,tls:https.configuration});
  assert.equal(opened.status,'ok');const app=opened.value;let controller;
  try{
    const page=await fetch(app.origin+'/gcsp-activity-live.html');assert.equal(page.status,200);assert.match(await page.text(),/gcsp-activity[^>]+data-live/);
    assert.match(page.headers.get('cache-control'),/no-store/);
    const cookie=page.headers.getSetCookie().map((value)=>value.split(';')[0]).join('; ');assert.ok(cookie);
    const request=(path,options={})=>fetch(new URL(path,app.origin),{...options,headers:{...options.headers,Origin:app.origin,Cookie:cookie}});
    const account=createAccountHttpAdapter({fetch:request});const current=await account.loadAccount();assert.equal(current.status,'ready');assert.match(current.name,/fictional/i);
    const adapter=createActivityHttpAdapter({fetch:request,loadAccount:account.loadAccount});controller=createActivityController({adapter});
    await controller.refresh();assert.equal(controller.getState().result.value.permission,null);assert.equal(controller.getState().result.value.state,'no-brief');
    const post=async(path,body)=>(await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    assert.equal((await post('/api/gcsp/brief/draft',{commandId:randomUUID(),expectedBriefVersion:0,expectedDraftVersion:0,
      brief:{schemaVersion:1,preferences:{body:preference('estate')},essentials:{seats:essential(5)}}})).status,'ok');
    assert.equal((await post('/api/gcsp/brief/confirm',{commandId:randomUUID(),expectedBriefVersion:0,expectedDraftVersion:1,consent:{search:true,hold:true}})).status,'ok');
    await controller.refresh();assert.equal(controller.getState().result.value.briefVersion,1);assert.equal(controller.getState().result.value.permission.canSearch,true);
    await controller.pause();assert.equal(controller.getState().result.value.briefVersion,2);assert.equal(controller.getState().result.value.permission.canHold,false);
    await controller.resume();assert.equal(controller.getState().result.value.briefVersion,3);assert.equal(controller.getState().result.value.permission.canSearch,true);
    const fresh=await adapter.readActivity();assert.equal(fresh.value.briefVersion,3);assert.equal(fresh.value.lastSuccessfulCheck,null);assert.deepEqual(fresh.value.offers,[]);
    assert.equal((await fetch(app.origin+'/docs/gcsp/demo-brief.md')).status,404);
  }finally{controller?.destroy();await app.close();}
});
