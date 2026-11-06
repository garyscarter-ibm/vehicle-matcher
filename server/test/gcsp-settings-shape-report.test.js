import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPublicBmwQualificationDiagnostic } from '../../scripts/gcsp/collect-fleet.mjs';
import { publicBmwQualificationOperations } from '../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../gcsp/repository/core.js';
const template = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq59/source-diagnostic-live-2026-11-06/diagnostic-plan.json', import.meta.url)));
const labels={tree:'settingsVehicleTree',localisation:'settingsLocalisation'};
const secrets={tree:'SYNTHETIC-TREE-HEADER-DO-NOT-RETAIN',localisation:'SYNTHETIC-LOCALISATION-HEADER-DO-NOT-RETAIN'};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(change, callback) {
 const root=await mkdtemp(join(tmpdir(),'f59-settings-report-'));const plan=structuredClone(template);plan.planId='synthetic-settings-shape';
 const profiles=Object.fromEntries(Object.entries(labels).map(([role,label])=>[label,{'x-api-key':secrets[role]}]));
 const settings={APP:{backend:profiles}};change?.(settings,profiles);
 const calls=[];const settingsBytes=Buffer.from(JSON.stringify(settings));const statePath=join(root,'state.json');
 const record={modelCode:'T5MJ',agModelCode:'72HH',modelRange:'G61',steering:'RL',orderDate:'2026-11-01',effectDate:'2027-01-05'};
 const options={plan,statePath,mode:'source-fixture',now:()=>Date.parse('2026-11-06T12:30:00.000Z'),http:{kind:'fixture',fetch:async(url,request)=>{
  calls.push(url);assert.equal(request.method,'GET');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'manual');
  if(url==='https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ')return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});
  if(url==='https://configure.bmw.co.uk/en_GB/settings.fixture.json')return new Response(settingsBytes,{headers:{'content-type':'application/json'}});
  if(url.includes('/model-matrices/'))return Response.json(Object.fromEntries(['5','I'].map(k=>[k,{modelRanges:{G61E:{models:{T5MJ:record}}}}])));
  if(url.includes('/localisations/'))return Response.json({options:{P0300:{option:'P0300',optionType:'paint'}}});
  throw new Error('Unexpected synthetic request');
 }}};
 try {const diagnostic=await createPublicBmwQualificationDiagnostic(options);await callback({root,plan,profiles,settings,settingsBytes,statePath,calls,options,diagnostic});}
 finally {await rm(root,{recursive:true,force:true});}
}
function safeReport(result,role) {
 assert.equal(result.reason,'settings-header-shape');assert.equal(result.admission,false);assert.equal(result.accepted.length,0);
 const report=result.diagnostic?.settingsShapeRefusal;assert.ok(report,'refusal must retain a safe structural report');
 assert.equal(report.schemaVersion,'bmw-settings-shape-refusal.v1');assert.equal(report.failedRole,role);assert.equal(report.admission,false);
 assert.equal(report.observation.transportKind,'fixture');assert.equal(report.qualification,'unqualified-structural-observation');return report;
}
test('settings shape refusal preserves structural evidence through checkpoint reopen and safe receipt export',async()=>{
 await fixture((_,profiles)=>delete profiles.settingsLocalisation,async f=>{
  const result=await f.diagnostic.run();const report=safeReport(result,'localisation');assert.equal(report.roles.localisation.profileMatches,0);assert.equal(report.roles.localisation.flags.missingProfile,true);
  assert.equal(report.roles.tree.strictVerdict,'accepted');assert.equal(report.observation.responseBytes,f.settingsBytes.length);assert.equal(report.observation.responseSha256,sha(f.settingsBytes));assert.equal(f.calls.length,2);
  assert.equal(report.layout.status,'unverified');const reopened=await createPublicBmwQualificationDiagnostic(f.options);assert.deepEqual(await reopened.run(),result);assert.equal(f.calls.length,2);
  const path=join(f.root,'safe-receipt.json');const exported=await reopened.exportSettingsShapeReceipt(path);const bytes=await readFile(path);const receipt=JSON.parse(bytes);
  assert.equal(exported.sha256,sha(bytes));assert.equal(exported.bytes,bytes.length);assert.deepEqual(receipt.settingsShapeRefusal,report);assert.equal(receipt.admission,false);assert.deepEqual(receipt.accepted,[]);assert.equal(receipt.distinctConfigurations,0);assert.equal(f.calls.length,2);
  const retained=(await readFile(f.statePath,'utf8'))+bytes;for(const secret of Object.values(secrets))assert.equal(retained.includes(secret),false);
  await assert.rejects(reopened.exportSettingsShapeReceipt(path),{code:'settings-shape-export-failed'});
 });
});
const variants={
 missing:(p,label)=>delete p[label],
 duplicate:(p,label,secret)=>{p.other={[label]:{'x-api-key':secret}};},
 repeated:(p,label,secret)=>{p[label]['X-API-KEY']=secret;},
 conflicting:(p,label)=>{p[label]['X-API-KEY']='SYNTHETIC-CONFLICT-DO-NOT-RETAIN';},
 empty:(p,label)=>{p[label]['x-api-key']='';},
 oversized:(p,label)=>{p[label]['x-api-key']='X'.repeat(4097);},
 wrongType:(p,label)=>{p[label]['x-api-key']={unknown:'SYNTHETIC-SECRET-TEXT'};},
 wrongNamedType:(p,label)=>{p[label]={name:'x-api-key',value:42};},
 scalarLabel:(p,label)=>{delete p[label];p.marker=label;}
};
for(const role of ['tree','localisation'])for(const [kind,mutate]of Object.entries(variants))test('settings shape '+role+' '+kind+' refuses before downstream requests without source text',async()=>{
 await fixture((_,p)=>mutate(p,labels[role],secrets[role]),async f=>{
  const report=safeReport(await f.diagnostic.run(),role);const row=report.roles[role];assert.equal(row.strictVerdict,'refused');assert.equal(f.calls.length,2);
  if(kind==='duplicate')assert.equal(row.profileMatches,2);
  if(kind==='repeated'){assert.equal(row.candidates.directProperty,2);assert.equal(row.candidates.distinctValues,1);}
  if(kind==='conflicting')assert.equal(row.candidates.distinctValues,2);
  if(kind==='wrongType'||kind==='wrongNamedType')assert.equal(row.flags.wrongType,true);
  if(kind==='empty')assert.equal(row.flags.empty,true);
  if(kind==='oversized')assert.equal(row.flags.oversized,true);
  if(kind==='scalarLabel')assert.equal(row.exactLabelScalarValues,1);
  const serialized=JSON.stringify(report);for(const secret of [...Object.values(secrets),'SYNTHETIC-CONFLICT-DO-NOT-RETAIN','SYNTHETIC-SECRET-TEXT'])assert.equal(serialized.includes(secret),false);
 });
});
for(const kind of ['depth','nodes'])test('settings shape '+kind+' traversal refusal remains bounded and persists useful fixed facts',async()=>{
 await fixture((s)=>{if(kind==='depth'){let node=s;for(let i=0;i<30;i++){node.next={};node=node.next;}}else s.extra=Array.from({length:30100},()=>({}));},async f=>{
  const result=await f.diagnostic.run();assert.equal(result.reason,'settings-traversal-limit');const report=result.diagnostic?.settingsShapeRefusal;assert.ok(report);assert.equal(report.failedRole,'tree');assert.equal(report.roles.tree.traversal.limited,true);assert.equal(report.roles.tree.strictVerdict,'unresolved-limit');assert.ok(report.roles.tree.traversal.visited<=30000);assert.ok(report.roles.tree.traversal.maxDepth<=24);assert.equal(f.calls.length,2);
  assert.deepEqual(await (await createPublicBmwQualificationDiagnostic(f.options)).run(),result);assert.equal(f.calls.length,2);
 });
});
test('settings shape candidate counts saturate without unbounded retained output',async()=>{
 await fixture((_,p)=>{
  const keys=Array.from({length:128},(_,mask)=>{let bit=0;return 'x-api-key'.replace(/[a-z]/g,c=>(mask&(1<<bit++))?c.toUpperCase():c);});
  p.settingsVehicleTree={headers:Array.from({length:250},()=>Object.fromEntries(keys.map(key=>[key,''])))};
 },async f=>{
  const report=safeReport(await f.diagnostic.run(),'tree');assert.equal(report.roles.tree.candidates.directProperty,30000);assert.equal(report.roles.tree.traversal.countsCapped,true);assert.equal(report.roles.tree.strictVerdict,'unresolved-limit');assert.equal(f.calls.length,2);assert.ok(Buffer.byteLength(JSON.stringify(report))<16384);
 });
});
test('settings shape hostile arbitrary keys and scalars never enter retained refusal or receipt',async()=>{
 await fixture((s,p)=>{delete p.settingsLocalisation;s['SYNTHETIC-SECRET-KEY']={value:'SYNTHETIC-SECRET-SCALAR',url:'https://unretained.invalid/private'};},async f=>{
  const report=safeReport(await f.diagnostic.run(),'localisation');const path=join(f.root,'safe.json');await f.diagnostic.exportSettingsShapeReceipt(path);const retained=JSON.stringify(report)+(await readFile(path,'utf8'))+(await readFile(f.statePath,'utf8'));
  for(const text of ['SYNTHETIC-SECRET-KEY','SYNTHETIC-SECRET-SCALAR','unretained.invalid'])assert.equal(retained.includes(text),false);assert.equal(f.calls.length,2);
 });
});
for(const representation of ['direct','name-value'])test('settings shape successful strict '+representation+' acceptance remains unchanged',async()=>{
 await fixture((_,p)=>{if(representation==='name-value')for(const role of ['tree','localisation'])p[labels[role]]={headers:[{name:'X-API-KEY',value:secrets[role]}]};},async f=>{
  const result=await f.diagnostic.run();assert.equal(result.reason,'raw-schema-review-required');assert.equal(f.calls.length,4);assert.ok(result.diagnostic.tree);assert.equal(result.diagnostic.settingsShapeRefusal,undefined);assert.equal(result.admission,false);
  await assert.rejects(f.diagnostic.exportSettingsShapeReceipt(join(f.root,'none.json')),{code:'settings-shape-report-unavailable'});assert.equal(f.calls.length,4);
 });
});
for(const kind of ['extra-key','counter','role','fixture-to-live','request','digest'])test('settings shape tampered '+kind+' report refuses checkpoint reopening and safe export',async()=>{
 await fixture((_,p)=>delete p.settingsLocalisation,async f=>{
  safeReport(await f.diagnostic.run(),'localisation');const envelope=JSON.parse(await readFile(f.statePath));const report=envelope.content.diagnostic.settingsShapeRefusal;
  if(kind==='extra-key')report.leaked='SYNTHETIC-RAW-ERROR';
  if(kind==='counter')report.roles.tree.profileMatches=30001;
  if(kind==='role')report.failedRole='caller-defined';
  if(kind==='fixture-to-live')report.observation.transportKind='live';
  if(kind==='request')report.observation.request.url='https://unretained.invalid';
  if(kind==='digest')report.observation.responseSha256='incorrect';
  envelope.contentDigest=inputDigest(envelope.content);await writeFile(f.statePath,JSON.stringify(envelope)+'\n');const reopened=await createPublicBmwQualificationDiagnostic(f.options);
  await assert.rejects(reopened.run(),{code:'settings-shape-report-invalid'});await assert.rejects(reopened.exportSettingsShapeReceipt(join(f.root,'refused.json')),{code:'settings-shape-report-invalid'});assert.equal(f.calls.length,2);
 });
});
test('settings shape copied and invented metadata cannot attest an executor observation',async()=>{
 await fixture((_,p)=>delete p.settingsLocalisation,async f=>{
  const report=safeReport(await f.diagnostic.run(),'localisation');const helper=await import('../../scripts/gcsp/settings-shape-report.mjs');
  for(const metadata of [structuredClone(report.observation),{...report.observation,transportKind:'live'}])assert.throws(()=>helper.createSettingsShapeRefusal({settings:f.settings,failedRole:'localisation',reason:'settings-header-shape',metadata,plan:f.plan}),{code:'source-observation-metadata'});
  const operation=publicBmwQualificationOperations(f.plan).settings;assert.throws(()=>operation.project(f.settings,{},structuredClone(report.observation)),{code:'source-observation-metadata'});assert.equal(f.calls.length,2);
 });
});
