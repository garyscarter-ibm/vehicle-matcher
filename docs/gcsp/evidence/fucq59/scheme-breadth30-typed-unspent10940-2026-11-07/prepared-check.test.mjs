/** Offline production registration/URL checks only. No collector, transport or dependency-link mutation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateBmwBatchPlan, bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async p=>JSON.parse(await readFile(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const pool=await read(join(base,'pool.json'));
const plans=[];for(const chunk of pool.chunks)plans.push(await read(join(root,chunk.templatePath)));
const spent=await read(pool.knownSpentBasis.parentGlobal4666Spent.path),used=new Set(spent.entries.map(r=>r.requestDigest));

test('actual source copies, primary content and all194 source pins remain exact',async()=>{
  assert.equal(Object.keys(pool.sourcePins).length,194);
  for(const [path,hash]of Object.entries(pool.sourcePins))assert.equal(sha(await readFile(join(root,path))),hash,path);
  for(const name of ['scheme-breadth-six-model-options-actual-2026-11-07','scheme-breadth-remaining24-model-options-actual-2026-11-07']){
    const source=join(base,'..',name),origin=await read(join(source,'origin-manifest.json'));
    for(const copy of origin.copies){assert.equal(sha(await readFile(copy.source)),copy.sha256);assert.equal(sha(await readFile(copy.destination)),copy.sha256);}
    const axes=await read(join(source,'typed-axes-index.json'));
    for(const row of axes.contexts){const primary=await read(join(source,row.id,'collector-checkpoint.json'));assert.equal(inputDigest(primary.content),primary.contentDigest);}
    const proof=await read(join(source,'actual-proof-result.json'));assert.equal(proof.rc,0);assert.equal(proof.issue,null);assert.equal(proof.identityUnchanged,true);assert.equal(proof.testCounts.fail,0);assert.equal(proof.testCounts.skipped,0);
  }
});
test('audited4666 spent base already contains exact actual48 including all16 rejects',async()=>{
  const pin=pool.knownSpentBasis.parentGlobal4666Spent;assert.equal(sha(await readFile(pin.path)),pin.sha256);assert.equal(used.size,pin.entries);assert.equal(pin.entries,6140);
  const audit=pool.knownSpentBasis.parentAudit;assert.equal(sha(await readFile(audit.path)),audit.sha256);
  const pilot=await read(pool.knownSpentBasis.actualPilot48Spent.path),delta=pilot.entries.slice(pool.knownSpentBasis.actualPilot48Spent.baseEntries),byDigest=new Map(spent.entries.map(r=>[r.requestDigest,r]));
  assert.equal(delta.length,48);assert.deepEqual(delta.reduce((a,r)=>(a[r.outcome]=(a[r.outcome]||0)+1,a),{}),{accepted:32,rejected:16});
  for(const row of delta)assert.deepEqual(byDigest.get(row.requestDigest),row);
  assert.equal(pool.knownSpentBasis.knownUnionSpentEntries,6140);
});
test('30 literal typed Cartesian pools partition10988 requests into exact48 spent and10940 unspent',async()=>{
  const all=new Set(),remaining=new Set(),excluded=new Set();let total=0;
  assert.equal(pool.contexts.length,30);assert.equal(new Set(pool.contexts.map(r=>r.id)).size,30);
  for(const context of pool.contexts){
    const options=await read(join(root,context.typedBasisPath)),defs=options.report.candidates[0].definitions,types={};
    for(const type of ['paint','fabric','rim'])types[type]=defs.filter(d=>d.optionType===type&&d.option===d.code&&d.issues.length===0).map(d=>d.code).sort();
    assert.deepEqual(context.actualTypedPools,types);
    const mandatory=context.lineRegistration.optionsQuery.code;assert.equal(context.lineRegistration.optionsQuery.kind,'trim');
    const actual=defs.find(d=>d.code===mandatory);assert.ok(actual);assert.equal(actual.option,mandatory);assert.equal(actual.issues.length,0);assert.deepEqual(context.mandatoryActualDefinition,{code:mandatory,optionType:actual.optionType,pointer:'/report/candidates/0/definitions/'+defs.indexOf(actual)});
    const local=new Set();
    for(const paint of types.paint)for(const fabric of types.fabric)for(const rim of types.rim){
      const request={includedElements:[paint,fabric,rim,mandatory].sort(),mandatoryElements:[mandatory]},digest=inputDigest({modelRegistration:context.modelRegistration,request});
      assert.equal(all.has(digest),false);all.add(digest);local.add(digest);total++;
      (used.has(digest)?excluded:remaining).add(digest);
    }
    assert.equal(local.size,context.allTypedRequests);assert.equal(context.candidates.length,context.unspentRequests);
    for(const candidate of context.candidates){const digest=inputDigest({modelRegistration:context.modelRegistration,request:candidate.request});assert.equal(local.has(digest),true);assert.equal(used.has(digest),false);assert.equal(candidate.candidateId,'candidate-'+inputDigest({model:context.modelRegistration.modelCode,request:candidate.request}).slice(0,24));}
  }
  assert.equal(total,10988);assert.equal(excluded.size,48);assert.equal(remaining.size,10940);assert.deepEqual(new Set(pool.requestDigests),remaining);assert.equal(pool.requestDigests.length,10940);
});
test('all1371 exact templates pass production registration and every10940 solver URL preserves model/line/request',async()=>{
  const seen=new Set();assert.equal(plans.length,1371);assert.equal((await readdir(join(base,'templates'))).length,1371);
  for(let i=0;i<plans.length;i++){
    const plan=plans[i],chunk=pool.chunks[i],context=pool.contexts.find(c=>c.id===chunk.contextId);validateBmwBatchPlan(plan);
    assert.equal(sha(await readFile(join(root,chunk.templatePath))),chunk.templateSha256);assert.equal(inputDigest(plan),chunk.planDigest);assert.deepEqual(plan.modelRegistration,context.modelRegistration);assert.deepEqual(plan.lineRegistration,context.lineRegistration);
    assert.equal(plan.candidates.length,chunk.candidates);assert.ok(chunk.candidates>=1&&chunk.candidates<=8);assert.equal(chunk.maximumGets,4+chunk.candidates);
    for(const candidate of plan.candidates){
      const digest=inputDigest({modelRegistration:plan.modelRegistration,request:candidate.request});assert.equal(seen.has(digest),false);seen.add(digest);assert.equal(used.has(digest),false);
      const urls=bmwBatchPlanRequestUrls(plan,candidate.request),solver=new URL(urls.solve),options=new URL(urls.options);
      assert.equal(solver.hostname,'prod.ucp.bmw.cloud');assert.equal(solver.pathname.endsWith('/models/'+plan.modelRegistration.modelCode),true);assert.equal(options.searchParams.get('trim'),plan.lineRegistration.optionsQuery.code);
      assert.equal(solver.searchParams.get('included-elements'),candidate.request.includedElements.join(','));assert.equal(solver.searchParams.get('mandatory-elements'),candidate.request.mandatoryElements.join(','));assert.equal(solver.searchParams.get('add-rules-for-mandatory-element-classes'),'fabric,paint,rim');
      assert.equal(solver.searchParams.get('application'),'connext');assert.equal([...solver.searchParams.keys()].length,4);
    }
    assert.deepEqual(chunk.requestDigests,plan.candidates.map(c=>inputDigest({modelRegistration:plan.modelRegistration,request:c.request})));
  }
  assert.deepEqual(seen,new Set(pool.requestDigests));
});
test('proposed phases partition exact chunks and bound one-worker traffic without any source grant',()=>{
  const numbers=[];let solver=0,gets=0;assert.equal(pool.proposedPhases.length,12);
  for(const phase of pool.proposedPhases){const chunks=pool.chunks.filter(c=>c.phase===phase.id);assert.deepEqual(phase.sessions,chunks.map(c=>c.number));assert.ok(chunks.length<=120);assert.equal(phase.solverCeiling,chunks.reduce((a,c)=>a+c.candidates,0));assert.equal(phase.publicGETCeiling,chunks.reduce((a,c)=>a+c.maximumGets,0));assert.equal(phase.freshBootstrapGET,4*chunks.length);assert.ok(phase.solverCeiling<=960);assert.ok(phase.publicGETCeiling<=1440);assert.equal(phase.sourceGrant,false);assert.equal(phase.freshParentCanonicalSpentAuditRequired,true);assert.equal(phase.exactExecutablesAndSeparateReleaseRequired,true);numbers.push(...phase.sessions);solver+=phase.solverCeiling;gets+=phase.publicGETCeiling;}
  assert.deepEqual(numbers,Array.from({length:1371},(_,i)=>i+1));assert.equal(solver,10940);assert.equal(gets,16424);
  const initial=pool.chunks.slice(0,24);assert.equal(new Set(initial.map(c=>c.contextId)).size,24);for(const c of initial){assert.equal(c.candidates,8);assert.equal(pool.contexts.find(r=>r.id===c.contextId).alreadySpentRequests.length,0);}
  assert.equal(pool.resourcesProposed.workers,1);assert.equal(pool.sourceGrant,false);assert.equal(pool.sourceTrafficDuringPreparation,0);assert.equal(pool.admissionCreditFromPool,0);assert.equal(pool.capacityCredit,0);assert.equal(pool.acceptance,false);
});
test('production registration refuses altered mandatory line, borrowed trim and ninth candidate',()=>{
  for(const mutate of [p=>p.candidates[0].request.mandatoryElements=[],p=>p.modelRegistration.optionsTrim='S0337',p=>{p.candidateCount=9;p.candidates.push({...p.candidates[0],candidateId:'ninth'});}]){const plan=structuredClone(plans[0]);mutate(plan);assert.throws(()=>validateBmwBatchPlan(plan));}
});
test('preparation has no executable source campaign, release or spent marker',async()=>{
  for(const name of ['run-live.mjs','supervise.py','run-series.py','execution-plan.json','execution-once.json','parent-release.json','series-receipt.json'])await assert.rejects(stat(join(base,name)),{code:'ENOENT'});
});
