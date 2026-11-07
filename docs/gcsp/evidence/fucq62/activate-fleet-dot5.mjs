// Root-owned coherent checkpoint only. Run under an external resource supervisor.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { validateCorpusDirectory } from '../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { rebuildFleetDot5 } from './rebuild-fleet-dot5.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
assert.equal(process.argv[2],'--receipt');const receipt=process.argv[3];const scratch=process.env.TMPDIR;
assert.ok(isAbsolute(receipt)&&isAbsolute(scratch)&&/\/test-stamp-shard-[a-f0-9]+$/.test(scratch));
assert.ok(relative(scratch,receipt).startsWith('..'));
const digest='7f4396b8fcddf14eb0d7386a47cbc41f58e1385d8ee30a0bda95f292c016e431';
const previous='8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9';
// Local YAML is staged by root before this command; no push/deploy occurs here.
assert.ok((await readFile(join(root,'render.gcsp.yaml'),'utf8')).includes('--release '+digest),'Stage the matching .5 build anchor in this same checkpoint first.');
const store=join(root,'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const initial=JSON.parse(await readFile(join(store,'active.json')));assert.equal(initial.selected.manifestDigest,previous);
const oldHistory=JSON.parse(await readFile(join(store,'identity-inventory.json')));
async function sha(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
const oldVersionPins=[];
for(const dir of await readdir(join(store,'versions')))for(const file of await readdir(join(store,'versions',dir))){const path=join('versions',dir,file);if((await stat(join(store,path))).isFile())oldVersionPins.push({path,sha256:await sha(join(store,path))});}
const rebuilt=await rebuildFleetDot5(scratch);assert.equal(rebuilt.manifestDigest,digest);
if(globalThis.gc)globalThis.gc();
const options={approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,policyService:createPolicyService(),policyRead:{runId:'f62-dot5-coherent-ordinary-publication',asOf:'2026-11-07T00:00:00.000Z'}};
const guard=installFleetOfflineGuard();const control=guard.control();let published,history;
try{
 const registry=createSyntheticRegistry({root:store,...options});assert.equal((await registry.load()).active.manifestDigest,previous);
 published=await registry.publish(rebuilt.candidate);assert.equal(published.status,'ok',JSON.stringify(published));assert.equal(published.active.manifestDigest,digest);
 assert.equal((await registry.publish(rebuilt.candidate)).idempotent,true);
 const cold=createSyntheticRegistry({root:store,...options});assert.equal((await cold.load()).active.manifestDigest,digest);
 const active=join(store,'versions',digest);const checked=await validateCorpusDirectory(active,{...options,indexed:true});assert.equal(checked.status,'ok');assert.deepEqual(checked.manifest.counts,rebuilt.counts);
 assert.deepEqual(await readFile(join(active,'manifest.json')),await readFile(new URL('./fleet-dot5-candidate-results/candidate-manifest.json',import.meta.url)));
 assert.deepEqual(await readFile(join(active,'vins.jsonl')),await readFile(join(store,'versions',previous,'vins.jsonl')));
 for(const pin of oldVersionPins)assert.equal(await sha(join(store,pin.path)),pin.sha256);
 history=JSON.parse(await readFile(join(store,'identity-inventory.json')));assert.equal(history.configurations.length,oldHistory.configurations.length+130);assert.deepEqual(history.identities,oldHistory.identities);
 for(const old of oldHistory.configurations)assert.deepEqual(history.configurations.find((r)=>r.configurationId===old.configurationId),old);
 for(const old of oldHistory.datasets)assert.deepEqual(history.datasets.find((r)=>r.datasetId===old.datasetId&&r.version===old.version),old);
 assert.equal(history.datasets.length,oldHistory.datasets.length+1);
 const image=cold.getConfiguration(APPROVED_CORPUS_IMAGES[0].configurationId);assert.deepEqual(image.record.imageIds,[]);assert.deepEqual(image.images,APPROVED_CORPUS_IMAGES);assert.equal(image.imageState,'representative');
 assert.equal(guard.calls.length,0);assert.deepEqual((await readdir(store)).filter((n)=>n.startsWith('.stage-')||n.startsWith('.publisher-')||n.startsWith('.write-')),[]);
}finally{guard.restore();}
await writeFile(receipt,JSON.stringify({status:'ordinary-dot5-published-coherent-anchor-staged',releaseId:digest,previousManifestDigest:previous,counts:rebuilt.counts,
 ordinaryStore:store,published:{status:published.status,idempotentRepeat:true},coldImageState:'representative',oldConfigurationLinesByteIdentical:350,vinBytesIdentical:true,
 oldVersionFilesRehashed:oldVersionPins.length,oldHistoryConfigurationsUnchanged:oldHistory.configurations.length,oldHistoryIdentitiesUnchanged:oldHistory.identities.length,
 oldHistoryDatasetsUnchanged:oldHistory.datasets.length,addedConfigurations:130,addedDatasets:1,egress:{control,calls:guard.calls.length},
 activePointerSha256:await sha(join(store,'active.json')),inventorySha256:await sha(join(store,'identity-inventory.json')),
 previousAll481AuditReused:true,publicAndLinuxNode20ProofOwnedByRoot:true,pushOrDeployExecuted:false,scope:'Actual existing publisher; root stages .5 store and matching YAML as one coherent commit; wholeStory acceptance remains open.'},null,2)+'\n');
console.log(JSON.stringify({status:'ordinary-dot5-published-coherent-anchor-staged',releaseId:digest,counts:rebuilt.counts,pushOrDeployExecuted:false}));
