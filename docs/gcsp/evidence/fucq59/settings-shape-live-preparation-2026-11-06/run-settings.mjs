// OFFLINE PREPARATION. main requires a separate reviewed, published parent allocation.
import { readFile, open, mkdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const producerRoot='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032';
const names=['page','settings','discover','options'];
const statuses=['settings-refused','strict-settings-inconclusive','source-stopped','runner-stopped','cancelled','settings-export-failed','checkpoint-invalid','once-marker-failed'];
const stopCodes=['settings-header-shape','settings-traversal-limit','source-attempt-budget','source-byte-budget','response-byte-budget','source-redirect-refused','source-json-utf8','source-json-shape','source-json-duplicate-key','source-content-type','source-endpoint-refused','settings-discovery-shape','source-observation-date','source-failure','source-http-401','source-http-403','source-http-429','operation-timeout','deadline'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const number=v=>Number.isSafeInteger(v)&&v>=0;
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const gate=ok=>{if(!ok){const e=new Error('settings-observation-invalid');e.code='settings-observation-invalid';throw e;}};
export async function boundedBytes(path,limit=1048576){const s=await lstat(path);gate(s.isFile()&&!s.isSymbolicLink()&&s.size<=limit);const b=await readFile(path);gate(b.length<=limit);return b;}
export async function consumeOnceMarker(path,content,{openFile=open}={}){
 const file=await openFile(path,'wx',0o600);try{await file.writeFile(JSON.stringify(content)+'\n');await file.sync();}finally{await file.close();}
 const parent=await openFile(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
}
async function durableWrite(path,bytes){const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}}
const loadProducer=async()=>{
 const collector=await import(pathToFileURL(join(producerRoot,'scripts/gcsp/collect-fleet.mjs')));
 const source=await import(pathToFileURL(join(producerRoot,'scripts/gcsp/public-bmw-source.mjs')));
 const report=await import(pathToFileURL(join(producerRoot,'scripts/gcsp/settings-shape-report.mjs')));
 const core=await import(pathToFileURL(join(producerRoot,'server/gcsp/repository/core.js')));
 return {...collector,...source,...report,...core};
};
export async function validateObservationPlan(input){const p=(await loadProducer()).validatePublicBmwDiagnosticPlan(input);gate(p.planId==='f59-settings-shape-observation-20261106.v1'&&p.limits.sourceAttempts===2&&p.limits.deadlineMs<=30000);return p;}
function safeCounts(c){
 const scalars=['sourceCalls','failures','timeouts','substitutions','cacheEvictions','httpAttempts','decodedBytes'];
 gate(object(c)&&scalars.every(k=>number(c[k]))&&c.httpAttempts<=2&&c.sourceCalls<=c.httpAttempts);
 const out=Object.fromEntries(scalars.map(k=>[k,c[k]]));
 for(const key of ['operations','cacheHits','operationBytes']){gate(object(c[key])&&names.every(n=>number(c[key][n]))&&c[key].discover===0&&c[key].options===0);out[key]=Object.fromEntries(names.map(n=>[n,c[key][n]]));}
 gate(names.every(n=>out.operations[n]<=1)&&out.operations.page+out.operations.settings===out.httpAttempts&&out.operationBytes.page+out.operationBytes.settings===out.decodedBytes);
 return out;
}
export async function inspectCheckpoint({statePath,diagnostic,planDigest}){
 let bytes;try{bytes=await boundedBytes(statePath);}catch(e){return{status:e.code==='ENOENT'?'missing':'invalid'};}
 const metadata={bytes:bytes.length,sha256:sha(bytes)};
 try{
  const safe=await diagnostic.session.withCheckpoint(async({state})=>{const stage=state.stages['source-qualification-diagnostic'];gate(stage?.version==='1'&&stage.inputDigest===planDigest&&object(stage.data));return{counts:safeCounts(state.counts),settingsRefusalPresent:!!state.diagnostic?.settingsShapeRefusal,halted:stopCodes.includes(state.halted)?state.halted:null};});
  gate(sha(await boundedBytes(statePath))===metadata.sha256);return{status:'valid',...metadata,...safe};
 }catch{return{status:'invalid',...metadata};}
}
const constraintValues={maxGetAttempts:2,downstreamRequests:0,retries:0,solver:0,sourceWrites:0,imageRequests:0,browser:0,sql:0,credentialLookups:0,rawRetention:0};
export function validateTypedReceipt(receipt,{provenance,mode,qualificationDate}){
 gate(exact(receipt,['schemaVersion','runnerVersion','qualification','admission','accepted','distinctConfigurations','provenance','status','stopCode','cancelled','counts','countBasis','checkpoint','settingsExport','constraints','reviewRequired'])
  &&receipt.schemaVersion==='f59-settings-observation-receipt.v1'&&receipt.runnerVersion==='f59-settings-shape-runner.v1'&&receipt.qualification==='unqualified-structural-observation'&&receipt.admission===false&&Array.isArray(receipt.accepted)&&receipt.accepted.length===0&&receipt.distinctConfigurations===0&&statuses.includes(receipt.status)&&typeof receipt.cancelled==='boolean'&&(receipt.stopCode===null||stopCodes.includes(receipt.stopCode)));
 const p=receipt.provenance;gate(exact(p,['allocation','producerCommit','codeTestIdentity','planSha256','planDigest','runnerSha256','transportKind','qualificationDate'])&&p.allocation==='f59-settings-shape-observation-20261106.v1'&&hex(p.producerCommit,40)&&['codeTestIdentity','planSha256','planDigest','runnerSha256'].every(k=>hex(p[k],64))&&['live','source-fixture'].includes(mode)&&p.transportKind===(mode==='live'?'live':'fixture')&&p.qualificationDate===qualificationDate&&Object.keys(provenance).every(k=>p[k]===provenance[k]));
 gate(['validated-final-checkpoint','validated-checkpoint-lower-bound','unknown'].includes(receipt.countBasis));
 if(receipt.counts!==null){const c=safeCounts(receipt.counts);gate(JSON.stringify(c)===JSON.stringify(receipt.counts));}else gate(receipt.countBasis==='unknown');
 gate(exact(receipt.checkpoint,['status','bytes','sha256'])&&['valid','invalid','missing'].includes(receipt.checkpoint.status)&&((receipt.checkpoint.bytes===null&&receipt.checkpoint.sha256===null)||(number(receipt.checkpoint.bytes)&&receipt.checkpoint.bytes<=1048576&&hex(receipt.checkpoint.sha256,64))));
 gate(receipt.counts===null||(receipt.checkpoint.status==='valid'&&['validated-final-checkpoint','validated-checkpoint-lower-bound'].includes(receipt.countBasis)&&(mode==='live'?receipt.counts.sourceCalls===receipt.counts.httpAttempts:receipt.counts.sourceCalls===0)));
 gate(exact(receipt.settingsExport,['status','bytes','sha256'])&&['not-available','exported','failed'].includes(receipt.settingsExport.status)&&
  (receipt.settingsExport.status==='exported'?number(receipt.settingsExport.bytes)&&receipt.settingsExport.bytes<=16384&&hex(receipt.settingsExport.sha256,64):receipt.settingsExport.bytes===null&&receipt.settingsExport.sha256===null));
 gate(exact(receipt.constraints,Object.keys(constraintValues))&&Object.entries(constraintValues).every(([k,v])=>receipt.constraints[k]===v)&&receipt.reviewRequired==='source-layout-and-qualification-before-admission-or-new-date-publication');
 gate(receipt.settingsExport.status!=='exported'||receipt.checkpoint.status==='valid');
 return receipt;
}
export async function retainDiagnosticReceipt({outputRoot,result,diagnostic,statePath,plan,mode,provenance,cancelled=false,failure=null}){
 const producer=await loadProducer();const checkpoint=await inspectCheckpoint({statePath,diagnostic,planDigest:producer.inputDigest(plan)});
 let settingsExport={status:'not-available',bytes:null,sha256:null};
 if(checkpoint.status==='valid'&&checkpoint.settingsRefusalPresent){
  try{const path=join(outputRoot,'settings-shape.json');const exported=await diagnostic.exportSettingsShapeReceipt(path);const bytes=await boundedBytes(path,16384);gate(exported.bytes===bytes.length&&exported.sha256===sha(bytes));const typed=JSON.parse(bytes);gate(exact(typed,['schemaVersion','qualification','admission','accepted','distinctConfigurations','settingsShapeRefusal'])&&typed.schemaVersion==='bmw-settings-shape-refusal-receipt.v1'&&typed.qualification==='unqualified-structural-observation'&&typed.admission===false&&Array.isArray(typed.accepted)&&typed.accepted.length===0&&typed.distinctConfigurations===0);producer.validateSettingsShapeRefusal(typed.settingsShapeRefusal,{plan,mode});settingsExport={status:'exported',bytes:bytes.length,sha256:sha(bytes)};
  }catch{settingsExport={status:'failed',bytes:null,sha256:null};}
 }
 const counts=checkpoint.status==='valid'?checkpoint.counts:null;
 let status=failure==='once-marker-failed'?'once-marker-failed':cancelled?'cancelled':settingsExport.status==='failed'?'settings-export-failed':checkpoint.status==='invalid'?'checkpoint-invalid':failure?'runner-stopped':settingsExport.status==='exported'?'settings-refused':checkpoint.halted==='source-attempt-budget'&&counts?.httpAttempts===2&&counts.operations.page===1&&counts.operations.settings===1&&counts.failures===0?'strict-settings-inconclusive':'source-stopped';
 const receipt={schemaVersion:'f59-settings-observation-receipt.v1',runnerVersion:'f59-settings-shape-runner.v1',qualification:'unqualified-structural-observation',admission:false,accepted:[],distinctConfigurations:0,
  provenance:Object.fromEntries(['allocation','producerCommit','codeTestIdentity','planSha256','planDigest','runnerSha256'].map(k=>[k,provenance[k]])),status,stopCode:checkpoint.halted??null,cancelled,counts,countBasis:counts?(result?'validated-final-checkpoint':'validated-checkpoint-lower-bound'):'unknown',checkpoint:{status:checkpoint.status,bytes:checkpoint.bytes??null,sha256:checkpoint.sha256??null},settingsExport,constraints:{...constraintValues},reviewRequired:'source-layout-and-qualification-before-admission-or-new-date-publication'};
 Object.assign(receipt.provenance,{transportKind:mode==='live'?'live':'fixture',qualificationDate:plan.qualificationDate});
 validateTypedReceipt(receipt,{provenance,mode,qualificationDate:plan.qualificationDate});const bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');gate(bytes.length<=16384);
 try{await durableWrite(join(outputRoot,'receipt.json'),bytes);}catch{const e=new Error('settings-receipt-write-failed');e.code='settings-receipt-write-failed';throw e;}return receipt;
}
export async function observeSettings({plan:input,statePath,outputRoot,oncePath,http,mode,provenance,now=Date.now,onPhase,cancelled=()=>false}){
 const plan=await validateObservationPlan(input);gate(['source-fixture','live'].includes(mode)&&http?.kind===(mode==='live'?'live':'fixture')&&[statePath,outputRoot,oncePath].every(isAbsolute));
 await mkdir(outputRoot,{mode:0o700});let diagnostic,result,failure=null;
 try{
  try{await consumeOnceMarker(oncePath,{schemaVersion:'f59-settings-once.v1',allocation:plan.planId,state:'reserved-and-consumed',planDigest:provenance.planDigest,producerCommit:provenance.producerCommit,reservedAt:new Date(now()).toISOString()});}catch{failure='once-marker-failed';throw new Error('once-marker-failed');}
  diagnostic=await(await loadProducer()).createPublicBmwQualificationDiagnostic({plan,statePath,http,mode,now,onPhase:async phase=>{if(cancelled())throw new Error('settings-cancelled');await onPhase?.(phase);}});
  result=await diagnostic.run();gate(result.admission===false&&result.accepted.length===0&&result.coverage.distinctConfigurations===0);
 }catch{failure??='runner-stopped';}
 return retainDiagnosticReceipt({outputRoot,result,diagnostic,statePath,plan,mode,provenance,cancelled:cancelled(),failure});
}
export function validateAllocation(a,{plan,planSha256,handoff,handoffSha256,runnerSha256,supervisorSha256,today}){
 gate(object(a)&&a.executable===true&&a.id===plan.planId&&a.sourceVersion===plan.source.version&&a.attempts===2&&a.bytes===2097152&&a.planSha256===planSha256&&a.planSha256===handoff.plan.sha256&&a.planDigest===handoff.plan.inputDigest&&a.handoffSha256===handoffSha256&&a.runnerSha256===runnerSha256&&a.runnerSha256===handoff.runner.sha256&&a.supervisorSha256===supervisorSha256&&a.supervisorSha256===handoff.supervisor.sha256&&a.reviewedCodeTestIdentity===handoff.producer.reviewedCodeTestIdentity&&a.reviewVerdicts?.code==='passed'&&a.reviewVerdicts?.security==='passed'&&hex(a.producerCommit,40)&&a.remoteVerifiedCommit===a.producerCommit&&a.producerRoot===producerRoot&&a.supervisorFinalizerRegistered===true&&today===plan.qualificationDate);
 return a;
}
async function main(){
 gate(process.argv.length===3&&isAbsolute(process.argv[2]));const a=JSON.parse(await boundedBytes(process.argv[2],131072));const planBytes=await boundedBytes(join(directory,'diagnostic-plan.json'),131072),handoffBytes=await boundedBytes(join(directory,'execution-handoff.json'),131072);const plan=await validateObservationPlan(JSON.parse(planBytes)),handoff=JSON.parse(handoffBytes);
 validateAllocation(a,{plan,planSha256:sha(planBytes),handoff,handoffSha256:sha(handoffBytes),runnerSha256:sha(await boundedBytes(fileURLToPath(import.meta.url),131072)),supervisorSha256:sha(await boundedBytes(join(directory,'supervise-settings.py'),131072)),today:new Date().toISOString().slice(0,10)});
 const producer=await loadProducer();gate(producer.inputDigest(plan)===a.planDigest&&await realpath(producerRoot)===producerRoot&&isAbsolute(a.scratchRoot||'')&&await realpath(a.scratchRoot)===a.scratchRoot&&(await lstat(a.scratchRoot)).isDirectory()&&['TMPDIR','TMP','TEMP'].every(k=>process.env[k]===a.scratchRoot)&&isAbsolute(a.ownershipManifest||'')&&relative(a.scratchRoot,a.ownershipManifest).startsWith('../')&&a.outputRoot===handoff.resources.retainedOutputRoot&&a.oncePath===handoff.onceMarker.path);
 const ownership=JSON.parse(await boundedBytes(a.ownershipManifest,131072));gate(ownership.root===a.scratchRoot&&typeof ownership.token==='string');
 for(const [path,digest] of Object.entries({...handoff.producer.moduleHashes,...handoff.producer.reviewedCodeTestHashes,...handoff.producer.frozenContractHashes}))gate(sha(await boundedBytes(join(producerRoot,path),2097152))===digest);
 gate(a.runtimeSha256===sha(await readFile(process.execPath)));
 let cancelled=false;const cancel=()=>{cancelled=true;};process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
 try{const receipt=await observeSettings({plan,statePath:join(a.scratchRoot,'settings-session.json'),outputRoot:a.outputRoot,oncePath:a.oncePath,mode:'live',http:{kind:'live',allocation:{id:a.id,sourceVersion:a.sourceVersion,attempts:2,bytes:a.bytes,planDigest:a.planDigest},fetch:globalThis.fetch.bind(globalThis)},provenance:{allocation:a.id,producerCommit:a.producerCommit,codeTestIdentity:a.reviewedCodeTestIdentity,planSha256:a.planSha256,planDigest:a.planDigest,runnerSha256:a.runnerSha256},cancelled:()=>cancelled});
  // stdout carries no source material; supervisor retains typed files only and removes this log.
  console.log(JSON.stringify({status:receipt.status,accepted:0,admission:false}));if(['runner-stopped','cancelled','settings-export-failed','checkpoint-invalid','once-marker-failed'].includes(receipt.status))process.exitCode=1;
 }finally{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('settings-observation-stopped; inspect bounded supervisor receipt; never reset marker');process.exitCode=1;});
