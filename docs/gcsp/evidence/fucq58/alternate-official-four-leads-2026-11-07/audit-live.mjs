import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {auditRetained} from '../../fucq59/scheme-line-breadth15-2026-11-07/audit-retained.mjs';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
export async function auditRetainedRequests({plan,directory,id,mode,entry}){
  const proof=await auditRetained({plan,directory,id,mode});
  const requests=(await readFile(join(directory,'request-identities.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.length,3);assert.deepEqual(requests.map(r=>r.operation),['page','settings','discover']);
  for(const [i,r]of requests.entries()){
    assert.deepEqual(Object.keys(r).sort(),['attempt','method','operation','requestIdentitySha256','url']);
    assert.equal(r.attempt,i+1);assert.equal(r.method,'GET');
    assert.equal(r.requestIdentitySha256,createHash('sha256').update('GET '+r.url).digest('hex'));
    if(r.operation==='settings'){assert.match(r.url,/^https:\/\/configure\.bmw\.co\.uk\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/);assert.equal(r.url,r.url.trim());}
    else assert.equal(r.url,entry.requests[r.operation]);
  }
  const state=JSON.parse(await readFile(join(directory,'collector-checkpoint.json'))).content;
  assert.deepEqual(state.counts.operations,{discover:1,page:1,settings:1});
  const page=state.cache.find(r=>r.operation==='page');assert.equal('https://configure.bmw.co.uk'+page.payload.settingsPath,requests[1].url);
  return {...proof,checksPassed:proof.checksPassed+2,checks:[...proof.checks,'exact-public-request-identities-and-operation-counts','actual-single-settings-path-matches-safe-primary'],requests,operations:state.counts.operations,qualifiedSchemeJoins:0,qualifiedPhysicalFacts:0};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const series=JSON.parse(await readFile(join(base,'series-plan.json')));const entry=series.contexts.find(e=>e.id===process.argv[2]);
  if(!entry)throw new Error('exact-declared-context-required');
  const directory=join(series.outputRoot,entry.id);const plan=JSON.parse(await readFile(join(root,entry.qualificationPlanPath)));
  const result=await auditRetainedRequests({plan,directory,id:entry.allocationId,mode:'live',entry});
  const file=await open(join(directory,'live-validation.json'),'wx',0o600);try{await file.writeFile(JSON.stringify(result)+'\n');await file.sync();}finally{await file.close();}
  console.log(JSON.stringify({context:entry.id,...result}));
}
