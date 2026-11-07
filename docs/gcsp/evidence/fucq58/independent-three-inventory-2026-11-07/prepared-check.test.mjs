import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,copyFile,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async p=>JSON.parse(await readFile(p));const sha=b=>createHash('sha256').update(b).digest('hex');const execFile=promisify(execFileCallback);const series=await read(join(base,'series-plan.json'));
const env=()=>({PATH:'/opt/homebrew/bin:/usr/bin:/bin',...Object.fromEntries(['TMPDIR','TMP','TEMP','TEST_RESOURCE_PARENT_RESERVATION'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
const absent=async p=>assert.rejects(stat(p),{code:'ENOENT'});
async function owned(t,prefix){const d=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('exact unspent G20/G22/G23 inputs and three independent releases preserve actual consumed U06',async()=>{
  assert.deepEqual(series.contexts.map(e=>[e.id,e.registration.catalogueRangeKey,e.registration.pageModelCode]),[['g20','G20','S3MK'],['g22','G22','C4MA'],['g23','G23','A4MA']]);
  for(const e of series.contexts){const p=series.phases[e.id];assert.deepEqual(p.contexts,[e.id]);assert.equal(p.getCeiling,3);assert.equal(p.independent,true);assert.equal(p.requiresSuccessfulOtherContext,false);assert.equal(e.phase,e.id);}
  assert.equal(series.resources.GET,9);assert.equal(series.resources.settingsSharedBootstrapGET,3);assert.equal(series.sourceGrant,false);
  for(const [p,h]of Object.entries({...series.codePins,...series.sourcePins}))assert.equal(sha(await readFile(join(root,p))),h,p);
  for(const [p,h]of Object.entries({...series.externalPins,...series.runtimePins}))assert.equal(sha(await readFile(p)),h,p);
  const spent=await read(join(base,'spent-u06.json'));assert.equal(sha(await readFile(join(base,'spent-u06.json'))),series.spentU06ProofSha256);assert.equal(spent.sourceReceipt.reason,'diagnostic-alias-limit');assert.equal(spent.outerReceipt.actualGets,3);assert.deepEqual(spent.outerReceipt.completedContexts,[]);assert.equal(spent.actualDiscoverDecodedBytes,2);assert.equal(spent.retainedLogicalBytes,10508);
  const prior=new Set(spent.requestIdentities.filter(r=>r.operation!=='settings').map(r=>r.url));assert.ok(series.contexts.every(e=>Object.values(e.requests).every(url=>!prior.has(url))));assert.ok(!series.contexts.some(e=>e.id==='u06'));
});
test('live entrypoints without exact new grants/releases refuse before any allocation; prior prefix unchanged',async()=>{
  for(const [exe,args,pattern]of [[process.execPath,[join(base,'run-live.mjs'),'g20'],/exact-root-context-and-phase-grants-required/],['/usr/bin/python3',['-I','-B',join(base,'supervise.py'),'source','g20'],/exact-root-context-and-phase-grants-required/],...series.contexts.map(e=>['/usr/bin/python3',['-I','-B',join(base,'run-series.py'),e.id],/exact-root-phase-grant-required/])])await assert.rejects(execFile(exe,args,{env:env(),maxBuffer:65536}),e=>pattern.test(e.stderr));
  for(const e of series.contexts)await assert.rejects(execFile('/usr/bin/python3',['-I','-B',join(base,'run-series.py'),e.id],{env:{...env(),BMW_F58_INDEPENDENT_PHASE_GRANT:series.phases[e.id].grantId},maxBuffer:65536}),x=>/FileNotFoundError/.test(x.stderr)&&x.stderr.includes(series.phases[e.id].releaseFile));
  await absent(series.outputRoot);for(const e of series.contexts)await absent(join(series.supervisorRoot,'ownership','durable-'+e.id+'.json'));
  for(const [p,h]of Object.entries(series.externalPins))assert.equal(sha(await readFile(p)),h);
});
async function phaseFixture(t){
  const fakeRoot=await owned(t,'f58-independent-');const packet=join(fakeRoot,'docs/gcsp/evidence/fucq58/packet');await mkdir(packet,{recursive:true});await mkdir(join(fakeRoot,'_tools'));
  for(const n of ['run-series.py','release.py'])await copyFile(join(base,n),join(packet,n));await copyFile(join(root,'_tools/test_resources.py'),join(fakeRoot,'_tools/test_resources.py'));
  const stub=`import json,pathlib,sys,time\nb=pathlib.Path(__file__).parent;s=json.loads((b/'series-plan.json').read_text());stage,c=sys.argv[1:];d=pathlib.Path(s['outputRoot'])/c\ndef put(n,v):(d/n).write_text(json.dumps(v)+'\\n')\nif stage=='source':\n put('collector-checkpoint.json',{'content':{'counts':{'decodedBytes':4}}})\n (d/'request-identities.jsonl').write_text(''.join(json.dumps({'attempt':i+1,'syntheticOnly':True})+'\\n' for i in range(3)))\n (d/'source-events.jsonl').write_text(''.join(json.dumps({'phase':p,'attempt':i+1})+'\\n' for i in range(3) for p in ['started','headers-received']))\n put('receipt.json',{'reason':'source-contract-diagnostic-observed','actualAttempts':3})\n if c=='g20':\n  until=time.monotonic()+5\n  while not (b/'release-synthetic-g20').exists() and time.monotonic()<until:time.sleep(0.01)\n  assert (b/'release-synthetic-g20').exists(),'synthetic-gate-timeout'\n  sys.exit(1)\nelse:put('live-validation.json',{'checksPassed':7,'decodedBytes':4,'modelNodes':1,'relationships':1,'originalRefusal':'synthetic-only'})\n`;
  await writeFile(join(packet,'supervise.py'),stub);const external=join(fakeRoot,'preserved-spent-proof.json');await writeFile(external,'{"syntheticSpentProof":true}\n');
  const plan={...series,outputRoot:join(fakeRoot,'retained'),supervisorRoot:join(fakeRoot,'control'),qualificationDate:new Date().toISOString().slice(0,10),codePins:{},sourcePins:{},externalPins:{[external]:sha(await readFile(external))}};
  for(const p of ['docs/gcsp/evidence/fucq58/packet/run-series.py','docs/gcsp/evidence/fucq58/packet/release.py','docs/gcsp/evidence/fucq58/packet/supervise.py','_tools/test_resources.py'])plan.codePins[p]=sha(await readFile(join(fakeRoot,p)));
  await writeFile(join(packet,'series-plan.json'),JSON.stringify(plan));
  async function release(name,extra={}){await writeFile(join(packet,plan.phases[name].releaseFile),JSON.stringify({status:'released-once',phase:name,allocationId:plan.id,planSha256:sha(await readFile(join(packet,'series-plan.json'))),GET:3,contexts:[name],settingsBootstrapGET:1,spentU06ProofSha256:plan.spentU06ProofSha256,...extra}));}
  const run=name=>execFile('/usr/bin/python3',['-I','-B',join(packet,'run-series.py'),name],{env:{...env(),BMW_F58_INDEPENDENT_PHASE_GRANT:plan.phases[name].grantId},maxBuffer:262144,timeout:45000});
  return {fakeRoot,packet,plan,external,release,run};
}
test('synthetic failed G20 leaves preserved prefix; serial gate refuses overlap; G22/G23 proceed independently with no replay',async t=>{
  const f=await phaseFixture(t);for(const n of ['g20','g22','g23'])await f.release(n);
  const running=assert.rejects(f.run('g20'),e=>/owned-stage-failed-primary-preserved-no-replay/.test(e.stderr));
  let active=false;for(let i=0;i<100;i++){try{if((await read(join(f.plan.supervisorRoot,'ownership','durable-g20.json'))).state==='active'){active=true;break;}}catch{}await new Promise(r=>setTimeout(r,10));}assert.equal(active,true,'synthetic G20 reached active ownership');
  await assert.rejects(f.run('g22'),e=>/other-independent-phase-active/.test(e.stderr));await absent(join(f.plan.supervisorRoot,'ownership','durable-g22.json'));await writeFile(join(f.packet,'release-synthetic-g20'),'synthetic test only\n');await running;
  const failed=await read(join(f.plan.outputRoot,'g20-receipt.json'));assert.equal(failed.reason,'incomplete');assert.equal(failed.actualGets,3);assert.deepEqual(failed.completedContexts,[]);assert.equal(failed.attemptedContexts[0].primaryPreserved,true);
  for(const n of ['g22','g23']){await f.run(n);const r=await read(join(f.plan.outputRoot,n+'-receipt.json'));assert.equal(r.reason,'finite-'+n+'-exhausted');assert.equal(r.actualGets,3);assert.deepEqual(r.completedContexts.map(c=>c.context),[n]);}
  for(const n of ['g20','g22','g23']){const c=await read(join(f.plan.outputRoot,n+'-cleanup.json'));assert.equal(c.allChildrenJoined,true);assert.equal(c.allStageGroupsAbsent,true);assert.equal(c.reservationAbsent,true);assert.equal(c.scratchAbsent,true);assert.equal(c.identityUnchanged,true);assert.equal(c.phaseLockReleasedAfterReceipt,true);await assert.rejects(f.run(n),e=>/phase-consumed-no-replay/.test(e.stderr));}
  assert.equal((await read(join(f.plan.outputRoot,'g20-receipt.json'))).reason,'incomplete');await absent(join(f.plan.outputRoot,'u06'));
});
test('synthetic altered spent proof or wrong reviewed hash refuses before independent ownership/output',async t=>{
  const f=await phaseFixture(t);await f.release('g22',{spentU06ProofSha256:'wrong'});await assert.rejects(f.run('g22'),e=>/exact-reviewed-spent-u06-proof-required/.test(e.stderr));await absent(f.plan.outputRoot);
  await f.release('g22');await writeFile(f.external,'changed\n');await assert.rejects(f.run('g22'),e=>/frozen-external-spent-proof-mismatch/.test(e.stderr));await absent(f.plan.outputRoot);await absent(join(f.plan.supervisorRoot,'ownership','durable-g22.json'));
});
