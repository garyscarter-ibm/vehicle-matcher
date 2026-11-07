/** Offline preparation checks. No root grant and no source transport are provided. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildCandidateQueue } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url));
const allocation=JSON.parse(await readFile(join(base,'execution-plan.json')));
const env={ PATH:'/opt/homebrew/bin:/usr/bin:/bin', TZ:'UTC', TMPDIR:process.env.TMPDIR, TMP:process.env.TMP, TEMP:process.env.TEMP, TEST_RESOURCE_PARENT_RESERVATION:process.env.TEST_RESOURCE_PARENT_RESERVATION };
test('four exact model/line registrations allocate twenty GETs and preserve explicit query absence',async()=>{
  const plans=[];
  for (const id of allocation.contextIds){
    const p=JSON.parse(await readFile(join(base,id,'collection-plan.json'))); validatePublicBmwPlan(p);plans.push(p);
    assert.equal(inputDigest(p),allocation.contextPlanDigests[id]);
    assert.deepEqual(bmwBatchPlanRequestUrls(p,p.candidates[0].request),allocation.contextUrls[id]);
    const search=new URL(allocation.contextUrls[id].options).search;
    assert.equal(search,['1f7a','1f7c'].includes(id)?'':id==='1f7d'?'?trim=S0337':'?trim=S033B');
    assert.deepEqual(p.limits.requestBudgets,{page:1,settings:1,discover:1,options:1,solve:1});
    assert.equal(new URL(allocation.contextUrls[id].solve).searchParams.has('mandatory-elements'),true);
    assert.equal(new URL(allocation.contextUrls[id].solve).searchParams.get('mandatory-elements'),['1f7a','1f7c'].includes(id)?'':id==='1f7d'?'S0337':'S033B');
    const provenance=JSON.parse(await readFile(join(base,'candidate-provenance.json'))).contexts.find(row=>row.id===id);
    const options=JSON.parse(await readFile(join(base,'../../', 'fucq59/f70-remaining-options-qualification-2026-11-07',id,'options.json')));
    const generated=buildCandidateQueue({...p,candidates:undefined},{definitions:options.report.candidates[0].definitions});
    assert.deepEqual(generated,p.candidates);assert.deepEqual(provenance.candidate,p.candidates[0]);
  }
  assert.equal(inputDigest(plans),allocation.planDigest); assert.equal(allocation.publicGetCeiling,20);
});
test('prepared runner validates all pins without a grant or source requests',()=>{
  const result=spawnSync(process.execPath,[join(base,'run-live.mjs'),'--check'],{env,encoding:'utf8',timeout:10000,maxBuffer:65536});
  assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.sourceTraffic,false);assert.equal(report.planDigest,allocation.planDigest);
});
test('both live entry points refuse a missing root grant before writing a once marker',async()=>{
  for (const [program,args] of [[process.execPath,[join(base,'run-live.mjs'),'1f7a']],['/usr/bin/python3',['-I','-B',join(base,'supervise.py'),'live']]]){
    const result=spawnSync(program,args,{env,encoding:'utf8',timeout:10000,maxBuffer:65536});
    assert.notEqual(result.status,0);assert.match(result.stderr,/explicit-root-traffic-grant-required/);
  }
  await assert.rejects(stat(join(base,'execution-once.json')),{code:'ENOENT'});
  for (const id of allocation.contextIds) await assert.rejects(stat(join(base,id,'execution-once.json')),{code:'ENOENT'});
});

test('supervisor stops on child success without retained source evidence and removes its owned scratch',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'f70-supervisor-fixture-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const prefix='docs/gcsp/evidence/fucq59/f70-model-breadth-pilot-plan-2026-11-07';const fakeBase=join(scratch,prefix);
  await mkdir(fakeBase,{recursive:true});
  const sourceRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
  const copied=['_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py'];
  for (const path of copied){await mkdir(dirname(join(scratch,path)),{recursive:true});await writeFile(join(scratch,path),await readFile(join(sourceRoot,path)));}
  const supervisor=await readFile(join(base,'supervise.py'),'utf8');
  const old="OUT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-model-breadth/live')";
  assert.equal(supervisor.split(old).length,2,'only relocate the fixture output; use the actual supervisor behavior');
  await writeFile(join(fakeBase,'supervise.py'),supervisor.replace(old,`OUT = pathlib.Path(${JSON.stringify(join(scratch,'retained'))})`));
  await writeFile(join(fakeBase,'run-live.mjs'),"console.log('synthetic child success without source requests or retained evidence');\n");
  const codePins={};for(const path of [...copied,`${prefix}/supervise.py`,`${prefix}/run-live.mjs`])codePins[path]=createHash('sha256').update(await readFile(join(scratch,path))).digest('hex');
  const fake={id:'offline-missing-evidence-fixture',planDigest:'fixture',contextIds:['1f7a','1f7c','1f7d','1f7f'],publicGetCeiling:20,codePins,resources:{hostRamMiB:64,childRamMiB:48,scratchMiB:8,chunkSeconds:30}};
  await mkdir(join(scratch,'server'));
  for(const id of fake.contextIds)await mkdir(join(fakeBase,id));
  await writeFile(join(fakeBase,'execution-plan.json'),JSON.stringify(fake));
  const result=spawnSync('/usr/bin/python3',['-I','-B',join(fakeBase,'supervise.py'),'live'],{env:{...env,F70_MODEL_BREADTH_SOURCE_GRANT:fake.id},encoding:'utf8',timeout:15000,maxBuffer:65536});
  const receipt=JSON.parse(await readFile(join(scratch,'retained/series-receipt.json')));
  console.log(JSON.stringify({fixtureSupervisorCleanup:receipt.contexts.map(row=>row.cleanup),publicGetAttempts:receipt.publicGetAttempts}));
  assert.notEqual(result.status,0,'zero exit alone must not establish source observation');
  assert.equal(receipt.stop,'context-failed-or-incomplete',result.stderr+JSON.stringify(receipt));assert.equal(receipt.contexts.length,1);
  assert.equal(receipt.contexts[0].cleanup.scratchAbsent,true);assert.equal(receipt.contexts[0].cleanup.reservationAbsent,true);
  assert.equal(receipt.publicGetAttempts,0);assert.equal(receipt.dependencyLinkRemoved,true);
});
