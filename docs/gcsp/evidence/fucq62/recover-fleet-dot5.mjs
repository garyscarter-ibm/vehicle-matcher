import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetReleases, releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { restoreFleetRelease } from '../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
const run=promisify(execFile);const root=fileURLToPath(new URL('../../../../',import.meta.url));const output=process.argv[2];const scratch=process.env.TMPDIR;
const release=fleetReleases.find((r)=>r.version==='2026-11-07.5');const cacheRoot=join(scratch,'cache');const cache=join(cacheRoot,release.releaseId);const store=join(scratch,'restored');
const baseline=join(root,'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const before={active:await readFile(join(store,'active.json')),inventory:await readFile(join(store,'identity-inventory.json'))};
const options={policyService:createPolicyService(),policyRead:{runId:'fleet-dot5-recovery',asOf:'2026-11-07T00:00:00.000Z'},
 approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,sourceArtifactDirectory:cache};
const preload=join(scratch,'recovery-offline.mjs');
await writeFile(preload,`import {installFleetOfflineGuard} from ${JSON.stringify(pathToFileURL(join(root,'scripts/gcsp/fleet-offline-guard.mjs')).href)};const g=installFleetOfflineGuard();g.control();process.on('exit',()=>{if(g.calls.length)process.exitCode=3;});`);
async function cli(cache=cacheRoot,expected=0){if(globalThis.gc)globalThis.gc();let r;try{r=await run(process.execPath,['--max-old-space-size=192','--import',preload,join(root,'server/scripts/fleet-artifacts.mjs'),'restore','--release',release.releaseId,'--store',store,'--cache',cache,'--network','offline'],{cwd:root,env:{PATH:process.env.PATH,TMPDIR:scratch,TMP:scratch,TEMP:scratch},maxBuffer:1048576});r.code=0;}catch(e){r=e;}assert.equal(r.code,expected,`${r.stdout}\n${r.stderr}`);return JSON.parse(r.stdout);}
async function unchanged(){assert.deepEqual(await readFile(join(store,'active.json')),before.active);assert.deepEqual(await readFile(join(store,'identity-inventory.json')),before.inventory);}
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');const cases={};
const progress=async()=>writeFile(join(output,'recovery-progress.json'),JSON.stringify({completedCases:cases,providerEgress:guard.calls.length},null,2)+'\n');
try{
 const newOnly=release.sources.find((s)=>s.manifestDigests.length===1);const path=join(cache,newOnly.path);const exact=await readFile(path);const bad=Buffer.from(exact);bad[0]^=1;await writeFile(path,bad);
 assert.equal((await cli(cacheRoot,1)).status,'artifact-release-failed');await unchanged();
 const recovered=await createSyntheticRegistry({root:store,...options}).load();assert.equal(recovered.recovered,true);assert.equal(recovered.active.manifestDigest,release.previousManifestDigest);assert.equal(recovered.active.counts.images,0);assert.equal(recovered.active.counts.sourceConfigurations,349);
 cases.corruptNewOnlySource={cliRejected:true,selectionAndHistoryPreserved:true,previousRecovered:true,previousManifestDigest:recovered.active.manifestDigest,images:0,sourceConfigurations:349};
 await progress();
 await writeFile(path,exact);const restored=await createSyntheticRegistry({root:store,...options}).load();assert.equal(restored.active.manifestDigest,release.releaseId);
 assert.equal((await cli(join(scratch,'missing-cache'),1)).status,'artifact-release-failed');await unchanged();cases.missingOfflineCache={rejected:true,storePreserved:true,networkCalls:0};
 const cacheActive=join(cache,'store/active.json');const activeExact=await readFile(cacheActive);await writeFile(cacheActive,await readFile(join(baseline,'active.json')));
 assert.equal((await cli(cacheRoot,1)).status,'artifact-release-failed');await unchanged();await writeFile(cacheActive,activeExact);cases.staleCacheSelection={rejected:true,storePreserved:true};
 const images=join(cache,`store/versions/${release.releaseId}/images.jsonl`);const exactImages=await readFile(images);const row=JSON.parse(exactImages);await writeFile(images,JSON.stringify({...row,imageId:'unapproved'})+'\n');
 assert.equal((await cli(cacheRoot,1)).status,'artifact-release-failed');await unchanged();await writeFile(images,exactImages);cases.changedImageAssociation={rejected:true,storePreserved:true};
 let injected=0;const failedCache=join(scratch,'partial-cache');
 await assert.rejects(restoreFleetRelease({releaseId:release.releaseId,store,cacheRoot:failedCache,offline:false,fetchImpl:async()=>{injected++;return new Response('{}');}}));
 assert.equal(injected,1);assert.deepEqual(await readdir(failedCache),[]);await unchanged();cases.partialTransfer={rejected:true,temporaryCacheEmpty:true,storePreserved:true,injectedRequests:1,actualNetworkRequests:0};
 // Exercise interrupted activation of these image-bearing bytes against the real .4 history.
 const baselineActive=await readFile(join(baseline,'active.json'));const baselineInventory=await readFile(join(baseline,'identity-inventory.json'));
 await writeFile(join(store,'active.json'),baselineActive);await writeFile(join(store,'identity-inventory.json'),baselineInventory);
 let interrupt=createSyntheticRegistry({root:store,...options,onPhase:async(phase)=>{if(phase==='staged')throw new Error('owned interruption');}});
 const rejected=await interrupt.publish(join(cache,'store/versions',release.releaseId));assert.equal(rejected.failure.code,'publication-interrupted');
 assert.deepEqual(await readFile(join(store,'active.json')),baselineActive);assert.deepEqual(await readFile(join(store,'identity-inventory.json')),baselineInventory);
 const old=await createSyntheticRegistry({root:store,...options}).load();assert.equal(old.active.manifestDigest,release.previousManifestDigest);
 interrupt=null;if(globalThis.gc)globalThis.gc();
 cases.interruptedActivation={phase:'staged',status:rejected.status,previousSelectionAndHistoryPreserved:true};
 await progress();
 const published=await cli();assert.equal(published.mode,'publish-existing');assert.equal(published.idempotent,false);assert.equal(published.active.manifestDigest,release.releaseId);await unchanged();
 const repeated=await cli();assert.equal(repeated.idempotent,true);
 const fresh=createSyntheticRegistry({root:store,...options});const loaded=await fresh.load();assert.equal(loaded.active.manifestDigest,release.releaseId);
 const imaged=fresh.getConfiguration(APPROVED_CORPUS_IMAGES[0].configurationId);assert.deepEqual(imaged.record.imageIds,[]);assert.deepEqual(imaged.images,APPROVED_CORPUS_IMAGES);assert.equal(imaged.imageState,'representative');
 cases.actualExistingStoreCli={status:published.status,mode:published.mode,repeatIdempotent:repeated.idempotent,coldManifestDigest:loaded.active.manifestDigest,imageState:imaged.imageState};
 await progress();
 assert.equal(guard.calls.length,0);
}finally{guard.restore();}
await writeFile(join(output,'recovery-receipt.json'),JSON.stringify({status:'changed-edge-recovery-passed',releaseId:release.releaseId,cases,providerEgress:0,ordinaryStoreUnchanged:true,scope:'owned downloaded cache and isolated restored store only; existing unchanged transport/image unit evidence reused'},null,2)+'\n');
console.log(JSON.stringify({status:'changed-edge-recovery-passed',cases:Object.keys(cases).length,providerEgress:0}));
