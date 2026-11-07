import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, open, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { consumeOnceMarker, inspectCheckpoint, retainDiagnosticReceipt } from '../run-live.mjs';
import { createPublicBmwQualificationDiagnostic } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032/scripts/gcsp/collect-fleet.mjs';
import { inputDigest } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032/server/gcsp/repository/core.js';
const scratch = process.env.TMPDIR;
assert.ok(scratch && scratch === process.env.TMP && scratch === process.env.TEMP);
const plan = JSON.parse(await readFile(new URL('../diagnostic-plan.json', import.meta.url)));
const sha = b => createHash('sha256').update(b).digest('hex');
const names = ['page','settings','discover','options'];
const counts = { sourceCalls:0, operations:Object.fromEntries(names.map(n=>[n,0])), cacheHits:Object.fromEntries(names.map(n=>[n,0])), failures:0,timeouts:0,substitutions:0,cacheEvictions:0,httpAttempts:2,decodedBytes:123,operationBytes:Object.fromEntries(names.map(n=>[n,0])) };
function artifact(operation) {
 const document = { observation:{operation}, requestScope:{role:'request-input-only'}, safe:'synthetic' };
 const bytes = Buffer.from(JSON.stringify(document)+'\n');
 return {document, bytes:bytes.length,sha256:sha(bytes)};
}
async function owned(label) { const p=join(scratch,label);await mkdir(p);return p; }
function envelope(content) { return JSON.stringify({schemaVersion:'1',content,contentDigest:inputDigest(content)})+'\n'; }
let fetches=0;
async function fixture(label) {
 const root=await owned(label);const statePath=join(root,'synthetic-checkpoint.json');
 const diagnostic=await createPublicBmwQualificationDiagnostic({plan,statePath,mode:'source-fixture',http:{kind:'fixture',fetch:async()=>{fetches++;throw new Error('forbidden synthetic fetch');}}});
 await diagnostic.session.withCheckpoint(async({state,commit})=>{
  Object.assign(state.counts,structuredClone(counts));
  state.cache=[{operation:'discover',cacheKey:'a'.repeat(64),expiresAt:Date.now()+1000,payload:artifact('discover'),payloadDigest:inputDigest(artifact('discover'))}];
  await commit();
 },{stage:{id:'source-qualification-diagnostic',version:'1',inputDigest:inputDigest(plan)}});
 return {root,statePath,diagnostic};
}
test('marker closes file and syncs parent before transport gate',async()=>{
 const root=await owned('marker-ok'); const events=[];
 const openFile=async(path,...args)=>{const handle=await open(path,...args);const kind=path===root?'directory':'file';events.push('open-'+kind);return {writeFile:async b=>handle.writeFile(b),sync:async()=>{events.push('sync-'+kind);await handle.sync();},close:async()=>{events.push('close-'+kind);await handle.close();}};};
 await consumeOnceMarker(join(root,'synthetic-once.json'),{synthetic:true},{openFile});events.push('transport');
 assert.deepEqual(events,['open-file','sync-file','close-file','open-directory','sync-directory','close-directory','transport']);
});
test('directory sync failure preserves spent marker and prevents transport',async()=>{
 const root=await owned('marker-fail');let transported=false;const marker=join(root,'synthetic-once.json');
 const openFile=async(path,...args)=>{const h=await open(path,...args);return path===root?{sync:async()=>{throw new Error('synthetic directory error');},close:()=>h.close()}:h;};
 await assert.rejects(async()=>{await consumeOnceMarker(marker,{synthetic:true},{openFile});transported=true;});
 assert.equal(transported,false);assert.equal(JSON.parse(await readFile(marker)).synthetic,true);
 await assert.rejects(consumeOnceMarker(marker,{synthetic:true}),{code:'EEXIST'});
});
test('existing producer validates checkpoint without execute or rewriting it',async()=>{
 const f=await fixture('checkpoint-valid'); const before=await readFile(f.statePath);const inspection=await inspectCheckpoint({...f,planDigest:inputDigest(plan)});
 assert.equal(inspection.status,'valid');assert.deepEqual(inspection.counts,counts);assert.deepEqual(inspection.artifacts.tree,artifact('discover'));
 assert.deepEqual(await readFile(f.statePath),before);assert.deepEqual(await readdir(f.root),['synthetic-checkpoint.json']);assert.equal(fetches,0);
});
const invalidCases={
 schema:e=>{e.schemaVersion='wrong';},digest:e=>{e.contentDigest='0'.repeat(64);},
 plan:e=>{e.content.identity.stage.planDigest='b'.repeat(64);},source:e=>{e.content.identity.sources.options.sourceVersion='wrong';},run:e=>{e.content.identity.transport.kind='live';},
 counters:e=>{e.content.counts.httpAttempts=5;},negative:e=>{e.content.counts.decodedBytes=-1;},payload:e=>{e.content.cache[0].payload.document.safe='tampered';},
 stage:e=>{e.content.stages['source-qualification-diagnostic'].inputDigest='c'.repeat(64);},missingStage:e=>{delete e.content.stages['source-qualification-diagnostic'];}
};
for(const [label,mutate] of Object.entries(invalidCases)) test('invalid checkpoint '+label+' contributes no counts or artifacts',async()=>{
 const f=await fixture('checkpoint-'+label);const e=JSON.parse(await readFile(f.statePath));mutate(e);if(!['schema','digest'].includes(label))e.contentDigest=inputDigest(e.content);await writeFile(f.statePath,JSON.stringify(e)+'\n');const before=await readFile(f.statePath);
 const inspection=await inspectCheckpoint({...f,planDigest:inputDigest(plan)});assert.equal(inspection.status,'invalid');assert.equal(inspection.counts,undefined);assert.equal(inspection.artifacts,undefined);assert.deepEqual(await readFile(f.statePath),before);assert.equal(fetches,0);
 const outputRoot=await owned('invalid-output-'+label);const receipt=await retainDiagnosticReceipt({outputRoot,checkpoint:inspection,provenance:{synthetic:true}});
 assert.equal(receipt.counts,null);assert.equal(receipt.countBasis,'unknown; no verified accounting available');assert.deepEqual(receipt.artifacts,[]);assert.equal(receipt.checkpoint.status,'invalid');
});
test('missing checkpoint stays missing without creating lock or fresh state',async()=>{
 const root=await owned('checkpoint-missing');const inspection=await inspectCheckpoint({statePath:join(root,'none.json'),diagnostic:{session:{withCheckpoint:()=>{throw new Error('must not enter');}}},planDigest:inputDigest(plan)});
 assert.equal(inspection.status,'missing');assert.deepEqual(await readdir(root),[]);
});
const result=()=>({reason:'raw-schema-review-required',counts:structuredClone(counts),diagnostic:{tree:artifact('discover'),options:artifact('options'),bootstrapObservations:[]}});
test('artifact validation failure writes safe receipt with verified accounting and another export',async()=>{
 const outputRoot=await owned('bad-artifact');const r=result();r.diagnostic.tree.sha256='invalid';
 const receipt=await retainDiagnosticReceipt({outputRoot,result:r,checkpoint:{status:'invalid'},provenance:{synthetic:true}});
 assert.equal(receipt.reason,'diagnostic-artifact-validation-failed');assert.deepEqual(receipt.counts,counts);assert.deepEqual(receipt.artifacts.map(a=>a.file),['options.json']);assert.equal(receipt.exportFailures[0].file,'tree.json');
 assert.deepEqual(JSON.parse(await readFile(join(outputRoot,'receipt.json'))),receipt);
});
test('second export write failure still records first verified export without raw error',async()=>{
 const outputRoot=await owned('write-failure');const write=async(path,bytes,options)=>{if(path.endsWith('/options.json'))throw new Error('RAW SECRET synthetic transport detail');return writeFile(path,bytes,options);};
 const receipt=await retainDiagnosticReceipt({outputRoot,result:result(),checkpoint:{status:'missing'},provenance:{synthetic:true}},{write});
 assert.equal(receipt.reason,'diagnostic-artifact-export-failed');assert.deepEqual(receipt.counts,counts);assert.deepEqual(receipt.artifacts.map(a=>a.file),['tree.json']);assert.equal(JSON.stringify(receipt).includes('RAW SECRET'),false);assert.equal(receipt.admission,false);assert.deepEqual(receipt.accepted,[]);
 assert.deepEqual(JSON.parse(await readFile(join(outputRoot,'receipt.json'))),receipt);
});
test('validated checkpoint provides lower-bound accounting and cached safe projection after failure',async()=>{
 const f=await fixture('fallback-valid');const checkpoint=await inspectCheckpoint({...f,planDigest:inputDigest(plan)});const outputRoot=await owned('fallback-output');
 const receipt=await retainDiagnosticReceipt({outputRoot,checkpoint,failure:'diagnostic-runner-failure',provenance:{synthetic:true}});
 assert.deepEqual(receipt.counts,counts);assert.match(receipt.countBasis,/lower bound/);assert.deepEqual(receipt.artifacts.map(a=>a.file),['tree.json']);assert.equal(fetches,0);
});
test('only known numeric accounting fields reach receipt',async()=>{
 const outputRoot=await owned('safe-counts');const r=result();r.counts.extra='DO NOT RETAIN';
 const receipt=await retainDiagnosticReceipt({outputRoot,result:r,checkpoint:{status:'missing'},provenance:{synthetic:true}});assert.deepEqual(receipt.counts,counts);assert.equal(JSON.stringify(receipt).includes('DO NOT RETAIN'),false);
});
