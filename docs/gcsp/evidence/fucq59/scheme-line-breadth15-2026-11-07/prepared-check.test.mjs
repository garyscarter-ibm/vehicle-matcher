import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,copyFile,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {runContext} from './contract-runner.mjs';
import {auditRetained} from './audit-retained.mjs';
import {bmwInventoryRequestUrls} from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async p=>JSON.parse(await readFile(p));const sha=b=>createHash('sha256').update(b).digest('hex');const execFile=promisify(execFileCallback);
const series=await read(join(base,'series-plan.json'));const frozenNow=()=>Date.parse('2026-11-07T12:00:00Z');
test('pins five exact historical input leads, finite phases and unchanged code/runtime',async()=>{
  assert.deepEqual(series.contexts.map(e=>[e.id,e.registration.catalogueRangeKey,e.registration.pageModelCode]),[['g21','G21','T3PF'],['u11','U11','X1S0'],['u10','U10','IXS4'],['g26e','G26E','I4PC'],['i20','I20','IXSC']]);
  assert.deepEqual(series.phases.first.contexts,['g21']);assert.equal(series.phases.first.getCeiling,3);assert.equal(series.phases.remaining.getCeiling,12);assert.equal(series.sourceGrant,false);
  for(const [path,hash] of Object.entries({...series.codePins,...series.sourcePins}))assert.equal(sha(await readFile(join(root,path))),hash,path);
  for(const [path,hash] of Object.entries(series.runtimePins))assert.equal(sha(await readFile(path)),hash,path);
  assert.equal(series.resources.workers,1);assert.equal(series.resources.retainedBudgetBytes,16*1048576);
});
async function fixture(t,entry,treeOverride) {
  const directory=await mkdtemp(join(tmpdir(),'breadth15-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const plan=await read(join(root,entry.qualificationPlanPath));const r=plan.inventoryRegistration;
  const model={modelCode:r.pageModelCode,agModelCode:'12CM',modelRange:r.catalogueRangeKey,steering:'RL',effectDate:'2027-01-05',orderDate:r.treeOrderDate};
  const range={models:{[r.pageModelCode]:model},lines:{BASE_LINE:{option:'S0337',defaultModel:{modelCode:r.pageModelCode,agModelCode:'12CM'},includedTransmissionVariants:{0:{modelCode:r.pageModelCode,configuration:{modelCode:r.pageModelCode,elements:{BASE_LINE:{ignored:'RAW_NOT_RETAINED'}}}}}}}};
  const tree=treeOverride??{2:{modelRanges:{[r.catalogueRangeKey]:range}},7:{modelRanges:{[r.catalogueRangeKey]:range}}};
  const urls=bmwInventoryRequestUrls(r);const requested=[];
  return {directory,plan,id:entry.allocationId,mode:'source-fixture',now:frozenNow,requested,
    fetch:async(url,options)=>{requested.push({url,method:options.method});
      if(url===urls.page)return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});
      if(url==='https://configure.bmw.co.uk/en_GB/settings.fixture.json')return Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'PRIVATE_FIXTURE_HEADER'}}}});
      assert.equal(url,urls.discover);return Response.json(tree);
    }};
}
test('five synthetic contexts retain exact aliases/model relationships, export and zero-fetch resume',async t=>{
  let totalCalls=0;
  for(const entry of series.contexts){
    const f=await fixture(t,entry);const receipt=await runContext(f);assert.equal(receipt.reason,'source-contract-diagnostic-observed');assert.equal(f.requested.length,3);totalCalls+=f.requested.length;
    assert.equal(receipt.originalRefusal,'source-inventory-line-key');assert.equal(receipt.rejectedContract.key,'BASE_LINE');
    await execFile('/usr/bin/python3',['-I','-B',join(base,'export-retained.py'),f.directory],{env:{PATH:'/usr/bin:/bin'},maxBuffer:65536});
    const proof=await auditRetained(f);assert.equal(proof.checksPassed,5);assert.deepEqual(proof.observedAliases,['2','7']);assert.equal(proof.admitted,0);
    assert.doesNotMatch(await readFile(join(f.directory,'collector-checkpoint.json'),'utf8'),/PRIVATE_FIXTURE_HEADER|RAW_NOT_RETAINED/);
    await assert.rejects(runContext(f),/existing-primary-preserved/);assert.equal(f.requested.length,3);
  }
  assert.equal(totalCalls,15);
});
test('empty tree preserves actual failed primary without replay or admission',async t=>{
  const empty=await fixture(t,series.contexts[0],{});const receipt=await runContext(empty);assert.equal(receipt.status,'stopped');assert.equal(receipt.actualAttempts,3);assert.equal(receipt.admitted,0);
  assert.equal(receipt.reason,'diagnostic-alias-limit');await assert.rejects(runContext(empty),/existing-primary-preserved/);assert.equal(empty.requested.length,3);
});
test('copied actual G42 diagnostic independently passes new retained audit without source requests',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'breadth15-actual-copy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const actual=join(base,'../g42-safe-contract-diagnostic-2026-11-07');
  for(const name of ['collector-checkpoint.json','collector-state.json','diagnostic.json','source-events.jsonl','receipt.json'])await copyFile(join(actual,name),join(directory,name));
  const proof=await auditRetained({plan:await read(join(actual,'qualification-plan.json')),directory,id:'g42-safe-contract-diagnostic-20261107-once',mode:'live'});
  assert.equal(proof.checksPassed,5);assert.equal(proof.modelNodes,6);assert.equal(proof.originalRefusal,'source-inventory-line-key');
});
test('all live entry points refuse absent grants before output, ownership, markers or source',async()=>{
  for(const [exe,args,pattern] of [[process.execPath,[join(base,'run-live.mjs'),'g21'],/explicit-root-context-grant-required/],['/usr/bin/python3',['-I','-B',join(base,'supervise.py'),'source','g21'],/explicit-root-context-grant-required/],['/usr/bin/python3',['-I','-B',join(base,'run-series.py'),'first'],/explicit-root-phase-grant-required/],['/usr/bin/python3',['-I','-B',join(base,'run-series.py'),'remaining'],/explicit-root-phase-grant-required/]]){
    await assert.rejects(execFile(exe,args,{env:{PATH:'/opt/homebrew/bin:/usr/bin:/bin'},maxBuffer:65536}),e=>pattern.test(e.stderr));
  }
  await assert.rejects(stat(series.outputRoot),{code:'ENOENT'});
  for(const name of ['first','remaining'])await assert.rejects(stat(join(series.supervisorRoot,'ownership','durable-'+name+'.json')),{code:'ENOENT'});
});
