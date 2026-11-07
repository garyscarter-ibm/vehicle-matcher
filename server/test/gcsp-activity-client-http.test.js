import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createActivityClientRuntime } from './helpers/activity-client-runtime.js';
import { createActivityController } from '../../blocks/gcsp/activity/activity-controller.js';
import { createActivityHttpAdapter } from '../../blocks/gcsp/activity/activity-http.js';

test('real client transport/controller follow BriefService pause/resume, stale versions and reset through HTTP',async () => {
  const runtime=await createActivityClientRuntime(); const prior=process.env.DEMO_ACCESS_KEY;process.env.DEMO_ACCESS_KEY='';
  const server=runtime.server();let controller;
  try {
    await runtime.confirm();server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;const calls=[];
    const adapter=createActivityHttpAdapter({fetch:async (path,options) => {calls.push({path,method:options.method,body:options.body});return fetch(base+path,{...options,headers:{...options.headers,Origin:'https://activity-client.test',Cookie:runtime.cookie}});}});
    let command=0;controller=createActivityController({adapter,createCommandId:() => `client-${++command}`});
    await controller.refresh();assert.equal(controller.getState().result.value.briefVersion,1);
    await controller.pause();assert.equal(controller.getState().result.value.briefVersion,2);assert.equal(controller.getState().result.value.permission.canSearch,false);assert.equal(controller.getState().result.value.permission.canHold,false);
    await controller.resume();assert.equal(controller.getState().result.value.briefVersion,3);assert.equal(controller.getState().result.value.permission.canSearch,true);assert.equal(controller.getState().result.value.permission.canHold,true);
    const outside=await runtime.brief.pause(runtime.context,{commandId:'outside-client',expectedBriefVersion:3});assert.equal(outside.status,'ok');
    await controller.pause();assert.equal(controller.getState().result.value.briefVersion,4);assert.equal(controller.getState().result.value.permission.paused,true);assert.match(controller.getState().message,/changed/i);
    assert.deepEqual(calls.map((c) => c.method),['GET','POST','GET','POST','GET','POST','GET']);
    const before=JSON.stringify(runtime.store.state);await controller.refresh();assert.equal(JSON.stringify(runtime.store.state),before);
    const state=(await runtime.clock.readState(runtime.presenter.context)).value;
    const reset=await runtime.clock.reset(runtime.presenter.context,{commandId:'reset-client-proof',expectedRunId:state.runId,
      expectedRunVersion:state.runVersion,scenarioVersion:state.versions.scenario,fixtureVersion:state.versions.fixture});assert.equal(reset.status,'ok');
    await controller.refresh();assert.equal(controller.getState().phase,'unavailable');assert.equal(controller.getState().result,null);
    assert.equal(calls.some((c) => c.path.includes('?')),false);
  } finally {controller?.destroy();server.closeAllConnections();await new Promise((done) => server.close(done));await runtime.close();if(prior===undefined)delete process.env.DEMO_ACCESS_KEY;else process.env.DEMO_ACCESS_KEY=prior;}
});
