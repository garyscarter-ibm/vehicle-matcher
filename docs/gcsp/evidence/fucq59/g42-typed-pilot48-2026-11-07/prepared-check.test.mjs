/** Offline exact finite pools and synthetic source protocol. No public transport. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { PolicyService,FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { validateBmwBatchPlan,bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async p=>JSON.parse(await readFile(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const allocation=await read(join(base,'execution-plan.json'));
const plans=await Promise.all(allocation.contextIds.map(id=>read(join(base,id,'collection-plan.json'))));
test('48 pilot and 2768 remaining exact requests partition all actual typed pools and avoid every spent request',async()=>{
  const remaining=await read(join(base,'remaining-candidates.json')),basis=await read(join(base,'candidate-provenance.json'));
  const spent=await read(allocation.indexPins.spent.path),used=new Set(spent.entries.map(r=>r.requestDigest)),all=new Set();
  assert.equal(inputDigest(plans),allocation.planDigest);assert.equal(remaining.remainingCandidates,2768);assert.equal(remaining.shards.length,346);assert.equal(remaining.publicGetCeiling,4152);
  let total=0;for(const plan of plans){
    validateBmwBatchPlan(plan);const id=plan.models[0].toLowerCase(),row=basis.contexts.find(r=>r.id===id),later=remaining.contexts.find(r=>r.id===id);
    assert.deepEqual(plan.modelRegistration,row.modelRegistration);assert.deepEqual(plan.lineRegistration,row.lineRegistration);
    const actual=await read(join(root,row.optionsPath)),definitions=actual.report.candidates[0].definitions;
    assert.equal(sha(await readFile(join(root,row.optionsPath))),row.optionsSha256);assert.equal(plan.candidates.length,8);
    for(const candidate of [...plan.candidates,...later.candidates]){
      const request=candidate.request,digest=inputDigest({modelRegistration:plan.modelRegistration,request});
      assert.equal(used.has(digest),false);assert.equal(all.has(digest),false);all.add(digest);total++;
      assert.deepEqual(request.mandatoryElements,[plan.lineRegistration.optionsQuery.code]);assert.equal(request.includedElements.length,4);
      for(const type of ['paint','fabric','rim'])assert.equal(request.includedElements.filter(code=>definitions.some(d=>d.code===code&&d.option===code&&d.optionType===type&&d.issues.length===0)).length,1);
      assert.equal(candidate.candidateId,'candidate-'+inputDigest({model:plan.models[0],request}).slice(0,24));
    }
    assert.equal(row.allTypedRequests,plan.candidates.length+later.candidates.length);
  }
  assert.equal(total,2816);assert.equal(remaining.sourceGrant,false);assert.equal(allocation.baseRefreshRequired,(await read(join(base,'base-index-selection.json'))).requiresRefreshBeforeRelease);
});
test('offline runner verifies all exact source, index, code, runtime and URL pins',()=>{
  const result=spawnSync(process.execPath,[join(base,'run-live.mjs'),'--check'],{cwd:root,encoding:'utf8',env:process.env});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).sourceTraffic,false);
});
test('both live entry points refuse absent grants and the stale cumulative base before mutation or source',async()=>{
  for(const grant of allocation.baseRefreshRequired?[false,true]:[false])for(const kind of ['runner','supervisor']){
    const env={...process.env};delete env.BMW_G42_TYPED_PILOT_SOURCE_GRANT;if(grant)env.BMW_G42_TYPED_PILOT_SOURCE_GRANT=allocation.id;
    const result=spawnSync(kind==='runner'?process.execPath:'/usr/bin/python3',kind==='runner'?[join(base,'run-live.mjs'),'2pma']:['-I','-B',join(base,'supervise.py'),'live'],{cwd:root,encoding:'utf8',env});
    assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp(grant?'fresh-root-audited-cumulative-base-required':'explicit-root-traffic-grant-required'));
  }
  await assert.rejects(stat(join(base,'execution-once.json')),{code:'ENOENT'});await assert.rejects(stat(allocation.supervisorOutput),{code:'ENOENT'});
});
for(const plan of plans)test(`${plan.models[0]}: all eight exact candidates use twelve synthetic GETs and retain strict source records`,async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'g42-pilot-fixture-'));const id=plan.models[0].toLowerCase();
  try{
    const context=await read(join(base,'candidate-provenance.json'));const row=context.contexts.find(r=>r.id===id);
    const oldBase=join(root,'docs/gcsp/evidence/fucq59/g42-six-model-options-qualification-2026-11-07',id);
    const sourceTree=await read(join(oldBase,'tree.json')),sourceOptions=await read(join(root,row.optionsPath));
    const model=sourceTree.report.nodes[0].facts,r=plan.modelRegistration,l=plan.lineRegistration;
    const line={option:l.optionsQuery.code,defaultModel:l.defaultModel,includedTransmissionVariants:Array.from({length:l.includedIndex+1},(_,i)=>({configuration:{modelCode:i===l.includedIndex?r.modelCode:'OTHER',elements:i===l.includedIndex?{[l.optionsQuery.code]:{}}:{}}}))};
    const tree=Object.fromEntries(r.aliases.map(alias=>[alias,{modelRanges:{[r.catalogueRangeKey]:{models:{[r.modelCode]:model},lines:{[l.lineKey]:line}}}}]));
    const definitions=Object.fromEntries(sourceOptions.report.candidates[0].definitions.map(d=>[d.code,{option:d.option,optionType:d.optionType}]));
    const calls=[];const fetch=async input=>{
      const url=new URL(input);calls.push(url.href);
      if(url.pathname.includes('/configure/'))return new Response('<script src="settings.fixture.json"></script>',{headers:{'content-type':'text/html'}});
      if(url.pathname.includes('/settings.'))return Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'private-g42-tree'},settingsLocalisation:{'x-api-key':'private-g42-options'},settingsRuleSolver:{'x-api-key':'private-g42-solver'}}}});
      if(url.pathname.includes('/vehicle-trees/'))return Response.json(tree);
      if(url.pathname.includes('/options/'))return Response.json(definitions);
      assert.equal(plan.candidates.some(c=>bmwBatchPlanRequestUrls(plan,c.request).solve===url.href),true);
      const elements=Object.fromEntries([...url.searchParams.get('included-elements').split(','),'S0230'].sort().map(code=>[code,{code,type:'option'}]));
      return Response.json({constructible:true,configuration:{modelCode:r.modelCode,elements},configurationChanges:{addedElements:{S0230:elements.S0230},removedElements:{},ignoredElements:{}}});
    };
    const input={plan,source:plan.source,mode:'source-fixture',statePath:join(temporary,'checkpoint.json'),policyService:new PolicyService({provider:new FilePolicyProvider()}),now:()=>Date.parse('2026-11-07T04:00:00Z'),batchBinding:{producerPins:allocation.producerPins,snapshotVersion:allocation.snapshotVersion,existingConfigurationIds:[]},http:{kind:'fixture',fetch}};
    const result=await(await createFleetCollector(input)).run();assert.equal(result.reason,'queue-exhausted');assert.equal(result.records.length,8);assert.equal(result.accepted.length,0);assert.equal(result.rejected.length,0);assert.equal(calls.length,12);
    assert.equal(result.records.every(record=>record.canonicalIdentity.vgModelCode===r.modelCode&&record.canonicalIdentity.agModelCode===r.agModelCode),true);
    assert.deepEqual((await(await createFleetCollector(input)).run()).records,result.records);assert.equal(calls.length,12);
    assert.equal((await readFile(input.statePath,'utf8')).includes('private-g42-'),false);
  }finally{await rm(temporary,{recursive:true,force:true});}
});
test('actual supervisor rejects a falsely successful child and removes its owned fixture resources',async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'g42-pilot-false-success-'));
  try{
    const relative=base.slice(root.length),target=join(temporary,relative);await mkdir(target,{recursive:true});await mkdir(join(temporary,'server'),{recursive:true});await mkdir(join(temporary,'_tools'),{recursive:true});
    await copyFile(join(root,'_tools/test_resources.py'),join(temporary,'_tools/test_resources.py'));
    const exporter='docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py';await mkdir(dirname(join(temporary,exporter)),{recursive:true});await copyFile(join(root,exporter),join(temporary,exporter));
    const output=join(temporary,'retained');let source=await readFile(join(base,'supervise.py'),'utf8');source=source.replaceAll(allocation.supervisorOutput,output);await writeFile(join(target,'supervise.py'),source);
    await writeFile(join(target,'run-live.mjs'),'process.exit(0);\n');
    const fixture={...allocation,baseRefreshRequired:false,codePins:{},sourcePins:{},runtimePins:{},indexPins:{}};
    await writeFile(join(target,'execution-plan.json'),JSON.stringify(fixture));for(const id of allocation.contextIds)await mkdir(join(target,id));
    const result=spawnSync('/usr/bin/python3',['-I','-B',join(target,'supervise.py'),'live'],{cwd:temporary,encoding:'utf8',env:{...process.env,BMW_G42_TYPED_PILOT_SOURCE_GRANT:allocation.id}});
    assert.notEqual(result.status,0);const proof=await read(join(output,'series-receipt.json'));assert.equal(proof.stop,'context-failed-or-incomplete');assert.equal(proof.publicGetAttempts,0);assert.equal(proof.contexts.length,1);assert.equal(proof.dependencyLinkRemoved,true);
    const cleanup=proof.contexts[0].cleanup;assert.equal(cleanup.scratchAbsent,true);assert.equal(cleanup.groupsAbsent,true);assert.equal(cleanup.reservationAbsent,true);await assert.rejects(stat(cleanup.scratchRoot),{code:'ENOENT'});
    console.log(JSON.stringify({fixtureSupervisorCleanup:cleanup,sourceAttempts:proof.publicGetAttempts,fixtureStop:proof.stop,dependencyLinkRemoved:proof.dependencyLinkRemoved}));
  }finally{await rm(temporary,{recursive:true,force:true});}
});
