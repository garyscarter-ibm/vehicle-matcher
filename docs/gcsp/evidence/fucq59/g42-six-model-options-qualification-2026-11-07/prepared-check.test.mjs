/** Preparation protocol fixtures and actual-basis checks. Zero public traffic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { validatePublicBmwOptionsPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { createPublicBmwOptionsQualification } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { bmwModelOptionsRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async path=>JSON.parse(await readFile(path,'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const allocation=await read(join(base,'execution-plan.json'));
const env={PATH:'/opt/homebrew/bin:/usr/bin:/bin',TZ:'UTC',TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP,TEST_RESOURCE_PARENT_RESERVATION:process.env.TEST_RESOURCE_PARENT_RESERVATION};
const expected=[['2PMA','12CM','S0337','2PMA','12CM',1],['2PMB','22CM','S0337','2PMA','12CM',0],['2PPA','12CM','S033B','2PPA','12CM',3],['2PPB','22CM','S033B','2PPA','12CM',1],['2PBC','52FA','S033B','2PPA','12CM',2],['2PMC','52FA','S033B','2PPA','12CM',0]];
test('all six exact model/default/index/trim inputs derive from the same sealed actual response',async()=>{
  const basis=await read(join(base,'source-basis.json')),bytes=await readFile(join(root,basis.diagnostic)),diagnostic=JSON.parse(bytes),report=diagnostic.report;
  assert.equal(sha(bytes),basis.diagnosticSha256);assert.equal(diagnostic.observation.responseSha256,basis.rawTreeResponseSha256);assert.equal(sha(await readFile(join(base,'source-basis.json'))),allocation.sourceBasisSha256);
  const plans=[];
  for(const [model,ag,line,defaultCode,defaultAg,index]of expected){
    const id=model.toLowerCase(),p=validatePublicBmwOptionsPlan(await read(join(base,id,'qualification-plan.json')));plans.push(p);
    const actual=report.modelNodes.find(n=>n.modelKey===model),b=basis.contexts.find(c=>c.id===id);
    assert.deepEqual([p.modelRegistration.modelCode,p.modelRegistration.agModelCode,p.lineRegistration.lineKey,p.lineRegistration.defaultModel.modelCode,p.lineRegistration.defaultModel.agModelCode,p.lineRegistration.includedIndex],[model,ag,line,defaultCode,defaultAg,index]);
    assert.deepEqual(p.modelRegistration.aliases,['2']);assert.equal(p.modelRegistration.rawModelRange,actual.facts.modelRange);
    for(const field of ['modelCode','agModelCode','steering','orderDate','effectDate'])assert.equal(p.modelRegistration[field],actual.facts[field]);
    assert.equal(p.modelRegistration.catalogueDate,report.requestScope.treeEffectDate);assert.deepEqual(b.completeAliases,['2']);
    for(const [path,value]of Object.entries(b.sameResponseRelationshipValues))assert.equal(report.relationships.find(r=>r.path===path).value,value);
    assert.equal(report.relationships.find(r=>r.path===b.literalTrimPresence.path).type,'object');
    assert.deepEqual(p.lineRegistration.optionsQuery,{kind:'trim',code:line});assert.equal(inputDigest(p),allocation.contextPlanDigests[id]);
    assert.deepEqual(bmwModelOptionsRequestUrls({model:p.modelRegistration,line:p.lineRegistration}),allocation.contextUrls[id]);
    assert.equal(new URL(allocation.contextUrls[id].options).search,'?trim='+line);
  }
  assert.equal(inputDigest(plans),allocation.planDigest);assert.equal(allocation.publicGetCeiling,24);assert.equal(allocation.seriesDecodedBytes,6*4194304);
});
test('runner offline check verifies every frozen code/input/runtime pin without source',()=>{
  const r=spawnSync(process.execPath,[join(base,'run-live.mjs'),'--check'],{env,encoding:'utf8',timeout:15000,maxBuffer:65536});
  assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.sourceTraffic,false);assert.equal(report.publicGetCeiling,24);assert.equal(report.planDigest,allocation.planDigest);
});
test('both live entry points refuse no-grant before marker, primary, resource or fetch',async()=>{
  for(const [program,args]of [[process.execPath,[join(base,'run-live.mjs'),'2pma']],['/usr/bin/python3',['-I','-B',join(base,'supervise.py'),'live']]]){
    const r=spawnSync(program,args,{env,encoding:'utf8',timeout:10000,maxBuffer:65536});assert.notEqual(r.status,0);assert.match(r.stderr,/explicit-root-traffic-grant-required/);
  }
  await assert.rejects(stat(join(base,'execution-once.json')),{code:'ENOENT'});
  for(const id of allocation.contextIds)for(const name of ['execution-once.json','collector-checkpoint.json','source-events.jsonl'])await assert.rejects(stat(join(base,id,name)),{code:'ENOENT'});
});
for(const context of expected)test(context[0]+' synthetic protocol keeps target distinct from compact default and exports safe evidence',async t=>{
  const [model,ag,line,defaultCode,defaultAg,index]=context,p=await read(join(base,model.toLowerCase(),'qualification-plan.json'));
  const directory=await mkdtemp(join(tmpdir(),'g42-options-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));const primary=join(directory,'collector-checkpoint.json');
  const facts={modelCode:model,agModelCode:ag,modelRange:'G42',steering:'RL',orderDate:'2026-11-01',effectDate:'2027-01-05'};
  const tree={2:{modelRanges:{G42:{models:{[model]:facts},lines:{[line]:{option:line,defaultModel:{modelCode:defaultCode,agModelCode:defaultAg},includedTransmissionVariants:Array.from({length:index+1},(_,i)=>({configuration:{modelCode:i===index?model:'ZZZZ',elements:{[line]:{}}}}))}}}}}};
  const definitions=Object.fromEntries([['P0300','paint'],['FKTNL','fabric'],['S01H5','rim'],[line,'option']].map(([code,optionType])=>[code,{option:code,optionType}]));let calls=0;
  const args={plan:p,statePath:primary,mode:'source-fixture',now:()=>Date.parse('2026-11-07T05:00:00Z'),http:{kind:'fixture',fetch:async url=>{
    calls++;if(url.includes('/configure/'))return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});
    if(url.includes('/settings.'))return Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'private-tree-fixture'},settingsLocalisation:{'x-api-key':'private-options-fixture'}}}});
    if(url.includes('/vehicle-trees/'))return Response.json(tree);if(url.includes('/options/'))return Response.json(definitions);throw new Error('forbidden-route');
  }}};
  const result=await(await createPublicBmwOptionsQualification(args)).run();assert.equal(result.reason,'source-options-qualified');assert.equal(calls,4);assert.deepEqual(result.accepted,[]);assert.equal(result.admission,false);
  assert.equal(result.trimRelationships[0].defaultModel.modelCode,defaultCode);assert.equal(result.trimRelationships[0].included.modelCode,model);
  assert.deepEqual(await(await createPublicBmwOptionsQualification(args)).run(),result);assert.equal(calls,4);
  assert.doesNotMatch(await readFile(primary,'utf8'),/private-(tree|options)-fixture/);
  const exported=spawnSync('/usr/bin/python3',['-I','-B',join(base,'export-retained.py'),directory],{env,encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(exported.status,0,exported.stderr);
  assert.equal((await read(join(directory,'tree.json'))).report.nodes[0].facts.agModelCode,ag);assert.equal((await read(join(directory,'options.json'))).report.status,'typed-definitions-observed');
});
test('supervisor rejects child success without actual evidence and cleans its owned first chunk',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'g42-false-success-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const prefix='docs/gcsp/evidence/fucq59/g42-six-model-options-qualification-2026-11-07',fakeBase=join(scratch,prefix);
  for(const path of Object.keys(allocation.codePins)){await mkdir(dirname(join(scratch,path)),{recursive:true});await writeFile(join(scratch,path),await readFile(join(root,path)));}
  const supervisor=await readFile(join(base,'supervise.py'),'utf8');const old="OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-six-model-options/live')";
  assert.equal(supervisor.split(old).length,2);await writeFile(join(fakeBase,'supervise.py'),supervisor.replace(old,`OUT=pathlib.Path(${JSON.stringify(join(scratch,'retained'))})`));
  await writeFile(join(fakeBase,'run-live.mjs'),"console.log('synthetic success; zero source and no retained primary');\n");
  const fake=structuredClone(allocation);for(const path of Object.keys(fake.codePins))fake.codePins[path]=sha(await readFile(join(scratch,path)));
  await writeFile(join(fakeBase,'execution-plan.json'),JSON.stringify(fake));
  const r=spawnSync('/usr/bin/python3',['-I','-B',join(fakeBase,'supervise.py'),'live'],{env:{...env,BMW_G42_OPTIONS_SERIES_SOURCE_GRANT:allocation.id},encoding:'utf8',timeout:20000,maxBuffer:131072});
  const receipt=await read(join(scratch,'retained/series-receipt.json'));assert.notEqual(r.status,0);assert.equal(receipt.stop,'context-failed-or-incomplete',r.stderr);assert.equal(receipt.contexts.length,1);assert.equal(receipt.publicGetAttempts,0);
  const row=receipt.contexts[0];assert.equal(row.evidenceIssue,'matching-complete-source-receipt-required');assert.equal(row.cleanup.scratchAbsent,true);assert.equal(row.cleanup.groupsAbsent,true);assert.equal(row.cleanup.reservationAbsent,true);
  console.log(JSON.stringify({fixtureSupervisorCleanup:row.cleanup,sourceAttempts:receipt.publicGetAttempts,fixtureStop:receipt.stop}));
});
