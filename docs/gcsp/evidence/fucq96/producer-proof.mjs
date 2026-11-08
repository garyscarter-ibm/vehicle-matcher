import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const own = '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-059/';
const { allocationFixture } = await import(pathToFileURL(own+'server/test/helpers/gcsp-allocation.js'));
const { DemoClock } = await import(pathToFileURL(own+'server/gcsp/clock/index.js'));
const { ok, inputDigest } = await import(pathToFileURL(own+'server/gcsp/repository/index.js'));
const { BriefService } = await import(pathToFileURL(own+'server/gcsp/brief/index.js'));
const { createRepositoryManualPorts } = await import(pathToFileURL(own+'server/gcsp/manual-context/ports.js'));
const { createStockReleaseService, createSyntheticStockProvider } = await import(pathToFileURL(process.env.GCSP_FUCQ96_PROOF_ROOT+'/gcsp/stock/index.js'));
const { BuddyHoldService } = await import(pathToFileURL(process.env.GCSP_FUCQ96_PROOF_ROOT+'/gcsp/offers/buddy-hold.js'));
const instant='2026-11-05T12:00:00.000Z';
async function setup({ realClaim=false, expiry=true, pause=false }={}) {
  const f=await allocationFixture({cars:0});
  await f.write(async tx=>{
    const run=await tx.get({table:'runs',key:{runId:f.context.runId}});
    const changed=await tx.compareAndSwap({table:'runs',key:{runId:f.context.runId}},run.value.version,{clockVersion:'1'});
    if(changed.status!=='ok')return changed;
    for(const employee of f.employees){
      const ref={table:'employees',key:{runId:f.context.runId,employeeId:employee.employeeId}};
      const row=(await tx.get(ref)).value;const contract=structuredClone(row.contract);
      contract.manualContext.drivers=[{kind:'employee',employeeId:employee.employeeId,eligible:contract.manualContext.employeeFacts.driverEligible}];
      const saved=await tx.compareAndSwap(ref,row.version,{contract});if(saved.status!=='ok')return saved;
    } return ok({prepared:true});
  });
  const clock=new DemoClock({repository:f.repository,policy:f.policy,identity:f.identity,environmentId:f.context.environmentId,environmentKind:'synthetic'});
  const candidate=f.stock();
  const provider=createSyntheticStockProvider({runId:f.context.runId,version:'fucq96-integration-test-v1',label:'TEST synthetic source interval; not F77/78',windows:[{windowId:'window',availableAt:instant,supplyId:null,stock:[{
    orderUuid:candidate.orderUuid,orderNumber:'0000001',configurationId:candidate.configurationId,facts:candidate.snapshot,
    visibility:{companyIds:[f.employees[0].companyId],schemeIds:[f.employees[0].schemeId],employeeIds:null},
    ...(expiry?{availability:{availableUntil:candidate.availability.availableUntil}}:{})
  }]}]});
  const release=createStockReleaseService({repository:f.repository,policy:f.policy,clock,identity:f.identity,provider});
  const claim=realClaim?new BuddyHoldService({repository:f.repository,policy:f.policy,clock,identity:f.identity,adapter:{mode:'local-synthetic'}}):undefined;
  const allocation=f.create({clock,...(claim?{claim}:{})});
  assert.equal((await release.register()).status,'ok');assert.equal((await allocation.register()).status,'ok');
  if(pause){const briefs=new BriefService({repository:f.repository,policy:f.policy,clock,identity:f.identity});
    assert.equal((await briefs.pause(f.employees[0],{commandId:'pause-before-tick',expectedBriefVersion:1})).status,'ok');}
  const command={eventId:'actual-producer-tick',expectedClockVersion:'1',inputDigest:inputDigest('actual-producer-tick')};
  const tick=await clock.tick(f.context,command);
  assert.equal(tick.status,'ok',JSON.stringify(tick));
  const out=tick.value.outcomes.find(x=>x.handlerId==='buddy-allocation').outcome;
  assert.equal(out.status,'ok',JSON.stringify(out));
  return {...f,clock,allocation,tick,out,command};
}
test('actual F92 release commits before allocation stage and actual F91 pause is consumed',async()=>{
  const f=await setup({pause:true});
  assert.deepEqual(f.tick.value.handlerOrder.map(x=>x.handlerId),['stock-release','buddy-allocation']);
  assert.equal(f.out.value.allocations.length,2);
  assert.equal(f.out.value.allocations[0].assignments[0].employeeId,f.employees[1].employeeId);
  const release=f.out.value.allocations.find(x=>x.event.eventType==='stock-released');
  assert.equal(release.event.sourceReceipt.consumerId,'stock-release');
  assert.equal(release.event.tickId,'actual-producer-tick');assert.equal(release.evaluations.length,2);
  const calls=f.calls.length;assert.deepEqual(await f.clock.tick(f.context,f.command),f.tick);assert.equal(f.calls.length,calls);
});
test('actual F92 unknown availability stays unsuitable through the allocation handler',async()=>{
  const f=await setup({expiry:false});
  assert.equal(f.out.value.allocations[0].state,'no-assignment');assert.equal(f.calls.length,0);
  assert.ok(f.out.value.allocations[0].evaluations.every(x=>x.decisions[0].gateStatus==='needs-confirmation'));
});
test('actual F92 to F96 to F100 secures one atomic hold offer and outbox',async()=>{
  const f=await setup({realClaim:true});const allocation=f.out.value.allocations[0];
  const pool=(await f.repository.query(f.context,'stock')).value;
  const manual=await createRepositoryManualPorts({repository:f.repository,policy:f.policy}).releasedStock.read(f.employees[0]);
  console.log(JSON.stringify({diagnosis:{stockState:pool[0].state,manualVisible:manual.value?.stock.length,allocationState:allocation.state,
    attempts:allocation.attempts.map(x=>({employeeId:x.employeeId,status:x.outcome.status,reason:x.outcome.reason})),
    holds:(await f.repository.query(f.context,'holds')).value.length,offers:(await f.repository.query(f.context,'offers')).value.length,
    outbox:(await f.repository.query(f.context,'notification_outbox')).value.length}}));
  assert.equal(allocation.assignments.length,1,'actual produced stock must secure a claim through the real hold port');
  for(const table of ['holds','offers','notification_outbox'])assert.equal((await f.repository.query(f.context,table)).value.length,1);
});
