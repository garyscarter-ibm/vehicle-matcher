import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { retainDiagnosticReceipt, inspectCheckpoint } from '../run-settings.mjs';
import { createPublicBmwQualificationDiagnostic } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032/scripts/gcsp/collect-fleet.mjs';
import { inputDigest } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032/server/gcsp/repository/core.js';
const plan=JSON.parse(await readFile(new URL('../diagnostic-plan.json',import.meta.url)));
const producerRoot='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032';
const root=()=>mkdtemp(join(process.env.TMPDIR,'settings-test-'));
const provenance={allocation:plan.planId,producerCommit:'a'.repeat(40),codeTestIdentity:'b'.repeat(64),planSha256:'c'.repeat(64),planDigest:inputDigest(plan),runnerSha256:'d'.repeat(64)};
test('actual settings refusal must retain typed closure-exported structural receipt',async()=>{
 const owned=await root(),statePath=join(owned,'state.json'),outputRoot=join(owned,'output');await mkdir(outputRoot);let calls=0;
 const diagnostic=await createPublicBmwQualificationDiagnostic({plan,statePath,mode:'source-fixture',now:()=>Date.parse('2026-11-06T13:00:00.000Z'),http:{kind:'fixture',fetch:async()=>{calls++;return calls===1?new Response('settings.fixture.json',{headers:{'content-type':'text/html'}}):Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'SYNTHETIC-PRIVATE'}}}});}}});
 const result=await diagnostic.run();assert.equal(result.reason,'settings-header-shape');
 const checkpoint=await inspectCheckpoint({statePath,diagnostic,planDigest:inputDigest(plan)});
 const receipt=await retainDiagnosticReceipt({outputRoot,result,checkpoint,diagnostic,statePath,plan,mode:'source-fixture',provenance});
 assert.equal(receipt.settingsExport?.status,'exported','refusal must use the owning closure exporter');
 const bytes=await readFile(join(outputRoot,'settings-shape.json'));assert.equal(JSON.parse(bytes).settingsShapeRefusal.failedRole,'localisation');assert.equal(bytes.includes(Buffer.from('SYNTHETIC-PRIVATE')),false);assert.equal(calls,2);
});
import { observeSettings, consumeOnceMarker, validateTypedReceipt, validateAllocation, validateObservationPlan } from '../run-settings.mjs';
import { writeFile, open, stat } from 'node:fs/promises';
import { after } from 'node:test';
const numeric=[];
after(async()=>writeFile(new URL('../proof-observations.json',import.meta.url),JSON.stringify(numeric,null,2)+'\n'));
async function setup({strict=false,changePlan,fetchResponse,now,onPhase,cancelled}={}){
 const owned=await root(),p=structuredClone(plan);changePlan?.(p);const calls=[];const contexts=[];
 const fetch=async(url,options)=>{calls.push(url);contexts.push({method:options.method,credentials:options.credentials,redirect:options.redirect,headers:options.headers});assert.ok(calls.length<=2,'third fetch forbidden');if(fetchResponse)return fetchResponse({url,options,index:calls.length});return calls.length===1?new Response('settings.fixture.json',{headers:{'content-type':'text/html'}}):Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'SYNTHETIC-TREE'},...(strict?{settingsLocalisation:{'x-api-key':'SYNTHETIC-LOCAL'}}:{})}}});};
 const opts={plan:p,statePath:join(owned,'state.json'),outputRoot:join(owned,'output'),oncePath:join(owned,'synthetic-once.json'),http:{kind:'fixture',fetch},mode:'source-fixture',provenance:{...provenance,planDigest:inputDigest(p)},now:now||(()=>Date.parse('2026-11-06T13:00:00.000Z')),onPhase,cancelled};
 return{owned,p,calls,contexts,opts,run:()=>observeSettings(opts)};
}
test('one-shot refusal uses exactly pinned page/settings GETs and retains no source strings',async()=>{
 const f=await setup();const receipt=await f.run();assert.equal(receipt.status,'settings-refused');assert.deepEqual(f.calls,['https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ','https://configure.bmw.co.uk/en_GB/settings.fixture.json']);assert.ok(f.contexts.every(c=>c.method==='GET'&&c.credentials==='omit'&&c.redirect==='manual'&&Object.keys(c.headers).length===0));assert.equal(receipt.counts.operations.discover,0);assert.equal(receipt.counts.operations.options,0);assert.equal(receipt.provenance.transportKind,'fixture');assert.equal((await stat(f.opts.oncePath)).mode&0o777,0o600);
 const retained=(await readFile(join(f.opts.outputRoot,'settings-shape.json'),'utf8'))+(await readFile(join(f.opts.outputRoot,'receipt.json'),'utf8'));assert.equal(retained.includes('SYNTHETIC-TREE'),false);assert.equal(retained.includes('SYNTHETIC-LOCAL'),false);
 validateTypedReceipt(receipt,{provenance:f.opts.provenance,mode:'source-fixture',qualificationDate:plan.qualificationDate});
});
test('unexpected strict settings success is explicitly inconclusive with no downstream transport',async()=>{
 const f=await setup({strict:true});const receipt=await f.run();assert.equal(receipt.status,'strict-settings-inconclusive');assert.equal(receipt.stopCode,'source-attempt-budget');assert.equal(receipt.settingsExport.status,'not-available');assert.equal(receipt.counts.httpAttempts,2);assert.deepEqual(receipt.counts.operations,{page:1,settings:1,discover:0,options:0});assert.equal(f.calls.length,2);assert.equal(receipt.admission,false);assert.deepEqual(receipt.accepted,[]);
});
test('spent marker blocks a second allocation after source failure without another fixture call',async()=>{
 const f=await setup({fetchResponse:()=>{throw new Error('SYNTHETIC PRIVATE failure');}});const first=await f.run();assert.equal(first.status,'source-stopped');assert.equal(f.calls.length,1);const before=await readFile(f.opts.oncePath);
 const second=await observeSettings({...f.opts,outputRoot:join(f.owned,'second-output')});assert.equal(second.status,'once-marker-failed');assert.equal(second.counts,null);assert.equal(f.calls.length,1);assert.deepEqual(await readFile(f.opts.oncePath),before);assert.equal(JSON.stringify(second).includes('SYNTHETIC PRIVATE'),false);
});
test('once marker syncs file then directory before any transport and stays spent after directory failure',async()=>{
 const owned=await root(),path=join(owned,'marker.json'),events=[];const openFile=async(p,...args)=>{const h=await open(p,...args),kind=p===owned?'directory':'file';return{writeFile:b=>h.writeFile(b),sync:async()=>{events.push(kind);await h.sync();},close:()=>h.close()};};await consumeOnceMarker(path,{state:'reserved-and-consumed'},{openFile});events.push('transport');assert.deepEqual(events,['file','directory','transport']);await assert.rejects(consumeOnceMarker(path,{state:'reserved-and-consumed'}),{code:'EEXIST'});
 const failed=join(owned,'sync-failed.json');let transported=false;const badOpen=async(p,...args)=>{const h=await open(p,...args);return p===owned?{sync:()=>{throw new Error('SYNTHETIC PRIVATE directory');},close:()=>h.close()}:h;};await assert.rejects(async()=>{await consumeOnceMarker(failed,{state:'reserved-and-consumed'},{openFile:badOpen});transported=true;});assert.equal(transported,false);assert.equal(JSON.parse(await readFile(failed)).state,'reserved-and-consumed');
});
test('redirect is refused after one manual GET with no fallback or settings attempt',async()=>{
 const f=await setup({fetchResponse:()=>new Response('',{status:302,headers:{location:'https://unretained.invalid/private'}})});const receipt=await f.run();assert.equal(receipt.status,'source-stopped');assert.equal(receipt.stopCode,'source-redirect-refused');assert.equal(f.calls.length,1);assert.equal(receipt.counts.operations.settings,0);assert.equal(JSON.stringify(receipt).includes('unretained.invalid'),false);
});
test('ambiguous discovered settings path stops before settings GET',async()=>{
 const f=await setup({fetchResponse:()=>new Response('settings.one.json settings.two.json',{headers:{'content-type':'text/html'}})});const receipt=await f.run();assert.equal(receipt.stopCode,'settings-discovery-shape');assert.equal(f.calls.length,1);assert.equal(receipt.counts.operations.settings,0);
});
for(const bound of ['response','aggregate'])test(bound+' threshold preserves truthful chunk overrun and stops without retry',async()=>{
 const settings=JSON.stringify({APP:{padding:'x'.repeat(200)}});const f=await setup({changePlan:p=>{p.limits.responseBytes=bound==='response'?128:1024;p.limits.sourceBytes=bound==='aggregate'?100:2048;},fetchResponse:({index})=>index===1?new Response('settings.fixture.json',{headers:{'content-type':'text/html'}}):new Response(settings,{headers:{'content-type':'application/json'}})});const receipt=await f.run();assert.equal(receipt.stopCode,bound==='response'?'response-byte-budget':'source-byte-budget');assert.equal(receipt.counts.decodedBytes,Buffer.byteLength('settings.fixture.json')+Buffer.byteLength(settings));assert.equal(f.calls.length,2);assert.equal(receipt.settingsExport.status,'not-available');numeric.push({case:bound+'-overrun',thresholdBytes:bound==='response'?f.p.limits.responseBytes:f.p.limits.sourceBytes,accountedBytes:bound==='response'?receipt.counts.operationBytes.settings:receipt.counts.decodedBytes,overrunBytes:(bound==='response'?receipt.counts.operationBytes.settings:receipt.counts.decodedBytes)-(bound==='response'?f.p.limits.responseBytes:f.p.limits.sourceBytes),httpAttempts:receipt.counts.httpAttempts,downstreamAttempts:receipt.counts.operations.discover+receipt.counts.operations.options});
});
test('complete-request timeout cancels and joins an unfinished settings stream',async()=>{
 let cancelled=0;const f=await setup({changePlan:p=>{p.limits.operationTimeoutMs=25;p.limits.deadlineMs=1000;},fetchResponse:({index})=>index===1?new Response('settings.fixture.json',{headers:{'content-type':'text/html'}}):new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})});const receipt=await f.run();assert.equal(receipt.stopCode,'operation-timeout');assert.equal(receipt.counts.timeouts,1);assert.ok(cancelled>=1);assert.equal(f.calls.length,2);
});
test('persisted deadline stops before another operation with a spent marker',async()=>{
 let clock=Date.parse('2026-11-06T13:00:00.000Z');const f=await setup({now:()=>clock,fetchResponse:()=>{clock+=30001;return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});}});const receipt=await f.run();assert.equal(receipt.stopCode,'deadline');assert.equal(f.calls.length,1);assert.equal(JSON.parse(await readFile(f.opts.oncePath)).state,'reserved-and-consumed');
});
test('closure export failure retains only fixed status and verified checkpoint accounting',async()=>{
 const owned=await root(),statePath=join(owned,'state.json'),outputRoot=join(owned,'output');await mkdir(outputRoot);let calls=0;const diagnostic=await createPublicBmwQualificationDiagnostic({plan,statePath,mode:'source-fixture',now:()=>Date.parse('2026-11-06T13:00:00.000Z'),http:{kind:'fixture',fetch:async()=>++calls===1?new Response('settings.fixture.json',{headers:{'content-type':'text/html'}}):Response.json({})}});const result=await diagnostic.run();await writeFile(join(outputRoot,'settings-shape.json'),'SYNTHETIC PRIVATE collision');const receipt=await retainDiagnosticReceipt({outputRoot,result,diagnostic,statePath,plan,mode:'source-fixture',provenance});assert.equal(receipt.status,'settings-export-failed');assert.equal(receipt.settingsExport.status,'failed');assert.equal(receipt.counts.httpAttempts,2);assert.equal(JSON.stringify(receipt).includes('SYNTHETIC PRIVATE'),false);assert.equal(calls,2);
});
test('invalid resealed checkpoint yields unknown counts and no unsafe export',async()=>{
 const f=await setup();await f.run();const envelope=JSON.parse(await readFile(f.opts.statePath));envelope.content.diagnostic.settingsShapeRefusal.failedRole=['localisation'];envelope.contentDigest=inputDigest(envelope.content);await writeFile(f.opts.statePath,JSON.stringify(envelope));const outputRoot=join(f.owned,'invalid-output');await mkdir(outputRoot);const diagnostic=await createPublicBmwQualificationDiagnostic({...f.opts});const receipt=await retainDiagnosticReceipt({outputRoot,diagnostic,statePath:f.opts.statePath,plan,mode:'source-fixture',provenance});assert.equal(receipt.status,'checkpoint-invalid');assert.equal(receipt.counts,null);assert.equal(receipt.settingsExport.status,'not-available');assert.equal(f.calls.length,2);
});
test('cancelled observation consumes its marker and retains no invented accounting',async()=>{
 const f=await setup({cancelled:()=>true});const receipt=await f.run();assert.equal(receipt.status,'cancelled');assert.equal(f.calls.length,0);assert.equal(receipt.counts,null);assert.equal(JSON.parse(await readFile(f.opts.oncePath)).state,'reserved-and-consumed');
});
test('receipt I/O failure leaves spent marker and requires supervisor fallback',async()=>{
 const f=await setup();const receipt=await f.run();await assert.rejects(retainDiagnosticReceipt({outputRoot:f.opts.outputRoot,diagnostic:await createPublicBmwQualificationDiagnostic(f.opts),statePath:f.opts.statePath,plan,mode:'source-fixture',provenance}),{code:'settings-receipt-write-failed'});assert.equal(JSON.parse(await readFile(f.opts.oncePath)).state,'reserved-and-consumed');assert.equal(f.calls.length,2);assert.equal(receipt.admission,false);
});
test('fixed receipt refuses extra text, forged admission, array status and fixture-to-live relabelling',async()=>{
 const f=await setup(),receipt=await f.run();for(const change of [r=>r.extra='SYNTHETIC PRIVATE',r=>r.admission=true,r=>r.status=['settings-refused'],r=>r.provenance.transportKind='live',r=>r.counts.sourceCalls=1]){const candidate=structuredClone(receipt);change(candidate);assert.throws(()=>validateTypedReceipt(candidate,{provenance:f.opts.provenance,mode:'source-fixture',qualificationDate:plan.qualificationDate}),{code:'settings-observation-invalid'});}
});
test('observation plan rejects a third attempt or longer deadline before marker or source',async()=>{
 for(const change of [p=>p.limits.sourceAttempts=3,p=>p.limits.deadlineMs=30001,p=>p.context.modelCode='OTHER']){const p=structuredClone(plan);change(p);await assert.rejects(validateObservationPlan(p));}
});
test('executable allocation pins two attempts, date, identities and both preparation reviews',()=>{
 const handoff={plan:{sha256:'c'.repeat(64),inputDigest:inputDigest(plan)},runner:{sha256:'d'.repeat(64)},supervisor:{sha256:'e'.repeat(64)},producer:{reviewedCodeTestIdentity:'b'.repeat(64)}};const a={executable:true,id:plan.planId,sourceVersion:plan.source.version,attempts:2,bytes:2097152,planSha256:handoff.plan.sha256,planDigest:handoff.plan.inputDigest,handoffSha256:'f'.repeat(64),runnerSha256:handoff.runner.sha256,supervisorSha256:handoff.supervisor.sha256,reviewedCodeTestIdentity:'b'.repeat(64),reviewVerdicts:{code:'passed',security:'passed'},producerCommit:'a'.repeat(40),remoteVerifiedCommit:'a'.repeat(40),producerRoot,supervisorFinalizerRegistered:true};const context={plan,planSha256:a.planSha256,handoff,handoffSha256:a.handoffSha256,runnerSha256:a.runnerSha256,supervisorSha256:a.supervisorSha256,today:'2026-11-06'};assert.equal(validateAllocation(a,context),a);
 for(const change of [v=>v.executable=false,v=>v.attempts=3,v=>v.bytes++,v=>v.reviewVerdicts.security='pending',v=>v.runnerSha256='0'.repeat(64),v=>v.producerRoot='/unapproved',v=>v.supervisorFinalizerRegistered=false]){const candidate=structuredClone(a);change(candidate);assert.throws(()=>validateAllocation(candidate,context));}assert.throws(()=>validateAllocation(a,{...context,today:'2026-11-07'}));
});
