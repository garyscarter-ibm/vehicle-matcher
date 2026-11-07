import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createLocalVehicleEvidenceLookup} from '../../../server/gcsp/vehicle-evidence/local-vehicle-lookup.js';
const out=dirname(fileURLToPath(import.meta.url));
const root=resolve(out,'../../..');
const store=join(root,'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const pointer=JSON.parse(await readFile(join(store,'active.json')));
const selected=join(store,'versions',pointer.selected.directory);
const rows=async(name)=>(await readFile(join(selected,name),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const configs=await rows('configurations.jsonl');const vins=await rows('vins.jsonl');
const requests=[...configs.map(r=>({kind:'configuration',id:r.configurationId})),...vins.map(r=>({kind:'vin',id:r.vin17}))];
const lookup=createLocalVehicleEvidenceLookup({root:store,asOf:'2026-11-07T00:00:00.000Z'});
const began=Date.now();let count=0,bytes=0;const results=[];
const limits={GET:32,decodedBytes:8388608,requestMs:10000,wallMs:90000,workers:1,retries:0};
async function get(path){
 if(++count>limits.GET||Date.now()-began>limits.wallMs)throw Error('live-probe-budget');
 const start=performance.now();const r=await fetch('https://gcsp-api.onrender.com'+path,{signal:AbortSignal.timeout(limits.requestMs),redirect:'error'});
 const body=await r.text();bytes+=Buffer.byteLength(body);if(bytes>limits.decodedBytes)throw Error('live-probe-byte-bound');
 return {status:r.status,body:r.status===200?JSON.parse(body):null,elapsedMs:performance.now()-start};
}
let failure=null;
try{
 const health=await get('/health');if(health.status!==200||health.body?.ok!==true)throw Error('live-health-unavailable');
 for(const request of requests){
  const group=request.kind==='configuration'?'configurations':'vins';const expected=await lookup.resolve(request);
  const actual=await get('/api/gcsp/vehicle-evidence/'+group+'/'+encodeURIComponent(request.id));
  const match=actual.status===200&&isDeepStrictEqual(actual.body,expected)&&actual.body?.versions?.manifestDigest===pointer.selected.manifestDigest;
  results.push({kind:request.kind,id:request.id,status:actual.status,match,elapsedMs:actual.elapsedMs});
  if(actual.status===401){failure='access-key-required';break;}
  if(!match){failure='deployed-dto-mismatch';break;}
 }
}catch(e){failure=/^[a-z-]{1,96}$/.test(e.message)?e.message:'live-probe-failed';}
const report={status:failure?'incomplete':'verified-live-partial-corpus',startedAt:new Date(began).toISOString(),finishedAt:new Date().toISOString(),code:'e60c70e6de6a2636750fdf99943e138b89b63932',deployment:7614329116,manifestDigest:pointer.selected.manifestDigest,requests:count,decodedBytes:bytes,limits,compared:results.length,expected:requests.length,errors:results.filter(r=>!r.match).length,failure,results,sourceQualifiedDistinct:29,target10000Met:false,scope:'all30publishedconfigurations and1previousVIN; exactJSON equality to local retained loader; no production mutation, no stock/native coverage claim'};
await writeFile(join(out,'live-probe-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,compared:report.compared,errors:report.errors,requests:count,decodedBytes:bytes,failure}));
if(failure)process.exitCode=1;
