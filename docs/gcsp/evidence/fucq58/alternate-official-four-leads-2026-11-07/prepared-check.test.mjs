import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,copyFile,stat,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {runContext} from '../../fucq59/scheme-line-breadth15-2026-11-07/contract-runner.mjs';
import {auditRetainedRequests} from './audit-live.mjs';
import {guardedRequests} from './request-guard.mjs';
import {bmwInventoryRequestUrls} from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async p=>JSON.parse(await readFile(p));const sha=b=>createHash('sha256').update(b).digest('hex');const execFile=promisify(execFileCallback);
const series=await read(join(base,'series-plan.json'));const frozenNow=()=>Date.parse('2026-11-07T12:00:00Z');
const env=()=>({PATH:'/opt/homebrew/bin:/usr/bin:/bin',...Object.fromEntries(['TMPDIR','TMP','TEMP','TEST_RESOURCE_PARENT_RESERVATION'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
const absent=async p=>assert.rejects(stat(p),{code:'ENOENT'});
async function owned(t,prefix){const d=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('four exact dated seeds, immutable pins and independent 3/9 GET phases',async()=>{
  assert.deepEqual(series.contexts.map(e=>[e.id,e.registration.catalogueRangeKey,e.registration.pageModelCode,e.originalRow]),[['u06','U06','2DSA','/coverage/schemeModelLines/3'],['g20','G20','S3MK','/coverage/schemeModelLines/4'],['g22','G22','C4MA','/coverage/schemeModelLines/6'],['g23','G23','A4MA','/coverage/schemeModelLines/7']]);
  assert.deepEqual(series.phases.first.contexts,['u06']);assert.deepEqual(series.phases.remaining.contexts,['g20','g22','g23']);assert.equal(series.phases.first.getCeiling,3);assert.equal(series.phases.remaining.getCeiling,9);assert.equal(series.sourceGrant,false);
  for(const [p,h]of Object.entries({...series.codePins,...series.sourcePins}))assert.equal(sha(await readFile(join(root,p))),h,p);
  for(const [p,h]of Object.entries(series.runtimePins))assert.equal(sha(await readFile(p)),h,p);
  for(const e of series.contexts){assert.deepEqual(bmwInventoryRequestUrls(e.registration),e.requests);assert.equal(e.registration.treeEffectDate,'2026-11-07');}
  assert.equal(series.resources.workers,1);assert.equal(series.resources.retainedBudgetBytes,8*1048576);assert.equal(series.resources.phaseHostRAMBytes,576*1048576);
});
test('request guard rejects wrong order, method, origin, whitespace and fourth request before downstream fetch',async t=>{
  const directory=await owned(t,'f58-guard-');const entry=series.contexts[0];let calls=0;
  const options={method:'GET',redirect:'manual',credentials:'omit',cache:'no-store'};
  const f=guardedRequests({entry,directory,fetch:async()=>{calls++;return new Response('fixture');}});
  for(const [url,o]of [[entry.requests.discover,options],[entry.requests.page,{...options,method:'POST'}],['https://evil.invalid/page',options]])await assert.rejects(f(url,o),/exact-finite-public-request-required/);
  assert.equal(calls,0);await f(entry.requests.page,options);
  for(const url of ['https://evil.invalid/en_GB/settings.fixture.json','https://configure.bmw.co.uk/en_GB/settings.fixture.json\n',entry.requests.page])await assert.rejects(f(url,options),/exact-finite-public-request-required/);
  assert.equal(calls,1);await f('https://configure.bmw.co.uk/en_GB/settings.fixture.json',options);await f(entry.requests.discover,options);
  await assert.rejects(f(entry.requests.discover,options),/exact-finite-public-request-required/);assert.equal(calls,3);
  const rows=(await readFile(join(directory,'request-identities.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.operation),['page','settings','discover']);
});
async function fixture(t,treeOverride){
  const directory=await owned(t,'f58-pipeline-');const entry=series.contexts[0];const plan=await read(join(root,entry.qualificationPlanPath));const r=plan.inventoryRegistration;
  const model={modelCode:r.pageModelCode,agModelCode:'12CM',modelRange:r.catalogueRangeKey,steering:'RL',effectDate:'2027-01-05',orderDate:r.treeOrderDate};
  const range={models:{[r.pageModelCode]:model},lines:{BASE_LINE:{option:'S0337',defaultModel:{modelCode:r.pageModelCode,agModelCode:'12CM'},includedTransmissionVariants:{0:{modelCode:r.pageModelCode,configuration:{modelCode:r.pageModelCode,elements:{BASE_LINE:{ignored:'RAW_NOT_RETAINED'}}}}}}}};
  const tree=treeOverride??{2:{modelRanges:{[r.catalogueRangeKey]:range}},7:{modelRanges:{[r.catalogueRangeKey]:range}}};const requested=[];
  const fetch=guardedRequests({entry,directory,fetch:async(url,options)=>{requested.push({url,method:options.method});if(url===entry.requests.page)return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});if(url==='https://configure.bmw.co.uk/en_GB/settings.fixture.json')return Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'PRIVATE_FIXTURE_HEADER'}}}});assert.equal(url,entry.requests.discover);return Response.json(tree);}});
  return {directory,entry,plan,id:entry.allocationId,mode:'source-fixture',now:frozenNow,fetch,requested};
}
test('synthetic U06 pipeline makes exactly three guarded requests, exports, independently audits and refuses replay',async t=>{
  const f=await fixture(t);const receipt=await runContext(f);assert.equal(receipt.reason,'source-contract-diagnostic-observed');assert.equal(f.requested.length,3);assert.equal(receipt.originalRefusal,'source-inventory-line-key');
  await execFile('/usr/bin/python3',['-I','-B',join(base,'../../fucq59/scheme-line-breadth15-2026-11-07/export-retained.py'),f.directory],{env:env(),maxBuffer:65536});
  const proof=await auditRetainedRequests(f);assert.equal(proof.checksPassed,7);assert.deepEqual(proof.observedAliases,['2','7']);assert.equal(proof.admitted,0);assert.equal(proof.qualifiedSchemeJoins,0);
  assert.doesNotMatch(await readFile(join(f.directory,'collector-checkpoint.json'),'utf8'),/PRIVATE_FIXTURE_HEADER|RAW_NOT_RETAINED/);
  await assert.rejects(runContext(f),/existing-primary-preserved/);assert.equal(f.requested.length,3);
});
test('empty synthetic tree retains failed primary and refuses replay without extra fetches',async t=>{
  const f=await fixture(t,{});const r=await runContext(f);assert.equal(r.reason,'diagnostic-alias-limit');assert.equal(r.actualAttempts,3);assert.equal(r.admitted,0);await stat(join(f.directory,'collector-checkpoint.json'));await assert.rejects(runContext(f),/existing-primary-preserved/);assert.equal(f.requested.length,3);
});
test('live entrypoints refuse missing grants and exact grants without releases before any allocation',async()=>{
  const paths=[[process.execPath,[join(base,'run-live.mjs'),'u06'],/exact-root-context-and-phase-grants-required/],['/usr/bin/python3',['-I','-B',join(base,'supervise.py'),'source','u06'],/exact-root-context-and-phase-grants-required/],...['first','remaining'].map(n=>['/usr/bin/python3',['-I','-B',join(base,'run-series.py'),n],/exact-root-phase-grant-required/])];
  for(const [exe,args,pattern]of paths)await assert.rejects(execFile(exe,args,{env:env(),maxBuffer:65536}),e=>pattern.test(e.stderr));
  for(const name of ['first','remaining'])await assert.rejects(execFile('/usr/bin/python3',['-I','-B',join(base,'run-series.py'),name],{env:{...env(),BMW_F58_FOUR_MODEL_PHASE_GRANT:series.phases[name].grantId},maxBuffer:65536}),e=>/FileNotFoundError/.test(e.stderr)&&e.stderr.includes(series.phases[name].releaseFile));
  await absent(series.outputRoot);for(const n of ['first','remaining'])await absent(join(series.supervisorRoot,'ownership','durable-'+n+'.json'));for(const e of series.contexts)await absent(join(series.supervisorRoot,e.id+'-source'));
});
// Run copied phase orchestration only with an explicit synthetic stage stub. No BMW code or fetch is invoked.
async function phaseFixture(t,fail=false){
  const fakeRoot=await owned(t,'f58-phases-');const packet=join(fakeRoot,'docs/gcsp/evidence/fucq58/packet');await mkdir(packet,{recursive:true});await mkdir(join(fakeRoot,'_tools'));
  for(const n of ['run-series.py','release.py'])await copyFile(join(base,n),join(packet,n));await copyFile(join(root,'_tools/test_resources.py'),join(fakeRoot,'_tools/test_resources.py'));
  const stub=`import json,pathlib,sys\nb=pathlib.Path(__file__).parent;s=json.loads((b/'series-plan.json').read_text());stage,c=sys.argv[1:];d=pathlib.Path(s['outputRoot'])/c\ndef put(n,v):(d/n).write_text(json.dumps(v)+'\\n')\nif stage=='source':\n put('collector-checkpoint.json',{'content':{'counts':{'decodedBytes':4}}})\n n=${fail?'1':'3'}\n (d/'request-identities.jsonl').write_text(''.join(json.dumps({'attempt':i+1,'syntheticOnly':True})+'\\n' for i in range(n)))\n (d/'source-events.jsonl').write_text(''.join(json.dumps({'phase':p,'attempt':i+1})+'\\n' for i in range(n) for p in ['started','headers-received']))\n put('receipt.json',{'reason':'source-contract-diagnostic-observed','actualAttempts':n})\n sys.exit(${fail?'1':'0'})\nelse:put('live-validation.json',{'checksPassed':7,'decodedBytes':4,'modelNodes':1,'relationships':1,'originalRefusal':'synthetic-only'})\n`;
  await writeFile(join(packet,'supervise.py'),stub);
  const plan={...series,outputRoot:join(fakeRoot,'retained'),supervisorRoot:join(fakeRoot,'control'),qualificationDate:new Date().toISOString().slice(0,10),codePins:{},sourcePins:{}};
  for(const p of ['docs/gcsp/evidence/fucq58/packet/run-series.py','docs/gcsp/evidence/fucq58/packet/release.py','docs/gcsp/evidence/fucq58/packet/supervise.py','_tools/test_resources.py'])plan.codePins[p]=sha(await readFile(join(fakeRoot,p)));
  await writeFile(join(packet,'series-plan.json'),JSON.stringify(plan));
  async function release(name,extra={}){await writeFile(join(packet,plan.phases[name].releaseFile),JSON.stringify({status:'released-once',phase:name,allocationId:plan.id,planSha256:sha(await readFile(join(packet,'series-plan.json'))),GET:plan.phases[name].getCeiling,contexts:plan.phases[name].contexts,settingsBootstrapGET:plan.phases[name].contexts.length,...extra}));}
  const run=name=>execFile('/usr/bin/python3',['-I','-B',join(packet,'run-series.py'),name],{env:{...env(),BMW_F58_FOUR_MODEL_PHASE_GRANT:plan.phases[name].grantId},maxBuffer:262144,timeout:45000});
  return {fakeRoot,packet,plan,release,run};
}
test('synthetic first phase cleans up, remaining requires both actual reviewed hashes, then consumes nine once',async t=>{
  const f=await phaseFixture(t);await f.release('first');await f.run('first');const out=f.plan.outputRoot;
  const first=await read(join(out,'first-receipt.json'));assert.equal(first.reason,'finite-first-exhausted');assert.equal(first.actualGets,3);assert.deepEqual(first.completedContexts.map(r=>r.context),['u06']);
  await f.release('remaining',{reviewedFirstProofSha256:'wrong',reviewedFirstReceiptSha256:'wrong'});await assert.rejects(f.run('remaining'),e=>/actual-reviewed-first-proof-required/.test(e.stderr));await absent(join(out,'remaining-once.json'));
  const reviewedFirstProofSha256=sha(await readFile(join(out,'u06/live-validation.json')));await f.release('remaining',{reviewedFirstProofSha256,reviewedFirstReceiptSha256:'wrong'});await assert.rejects(f.run('remaining'),e=>/actual-reviewed-first-receipt-required/.test(e.stderr));await absent(join(out,'remaining-once.json'));
  await f.release('remaining',{reviewedFirstProofSha256,reviewedFirstReceiptSha256:sha(await readFile(join(out,'first-receipt.json')))});await f.run('remaining');assert.equal((await read(join(out,'remaining-receipt.json'))).actualGets,9);
  for(const name of ['first','remaining']){const c=await read(join(out,name+'-cleanup.json'));assert.equal(c.allChildrenJoined,true);assert.equal(c.allStageGroupsAbsent,true);assert.equal(c.scratchAbsent,true);assert.equal(c.reservationAbsent,true);assert.equal(c.identityUnchanged,true);assert.deepEqual(c.leftovers,[]);await assert.rejects(f.run(name),e=>/phase-consumed-no-replay/.test(e.stderr));}
  const total=async p=>(await Promise.all((await readdir(p,{withFileTypes:true})).map(async e=>e.isDirectory()?total(join(p,e.name)):(await stat(join(p,e.name))).size))).reduce((a,b)=>a+b,0);assert.equal((await read(join(out,'remaining-cleanup.json'))).retainedBytes,await total(out));
});
test('synthetic failed first prefix retains consumed evidence, joins children and cannot release remaining',async t=>{
  const f=await phaseFixture(t,true);await f.release('first');await assert.rejects(f.run('first'),e=>/owned-stage-failed-primary-preserved-no-replay/.test(e.stderr));const out=f.plan.outputRoot;
  const r=await read(join(out,'first-receipt.json'));assert.equal(r.reason,'incomplete');assert.equal(r.actualGets,1);assert.equal(r.attemptedContexts[0].primaryPreserved,true);await absent(join(out,'g20'));
  const c=await read(join(out,'first-cleanup.json'));assert.equal(c.reservationAbsent,true);assert.equal(c.allStageGroupsAbsent,true);assert.equal(c.allChildrenJoined,true);await assert.rejects(f.run('first'),e=>/phase-consumed-no-replay/.test(e.stderr));
});
