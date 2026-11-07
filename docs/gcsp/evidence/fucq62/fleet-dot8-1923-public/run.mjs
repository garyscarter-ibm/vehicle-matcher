// Exact .8 plan; existing release, artifact CLI and registry APIs remain unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetReleases, releaseLimits } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { createSyntheticRegistry } from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';

const run = promisify(execFile); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const base = fileURLToPath(new URL('./', import.meta.url));
const planFile = join(base, 'plan.json'); const plan = JSON.parse(await readFile(planFile));
const [mode, output] = process.argv.slice(2); assert.ok(['--check-local', '--check', 'publish', 'download'].includes(mode)); assert.ok(isAbsolute(output));
const scratch = process.env.TMPDIR; assert.ok(isAbsolute(scratch) && /\/test-stamp-shard-[a-f0-9]+$/.test(scratch));
const release = fleetReleases.find(r => r.releaseId === plan.releaseId); assert.ok(release);
const pack = join(plan.packageRoot, 'pack', plan.releaseId);
const gh = '/Users/usget/.claude-tools/bin/gh'; const repo = plan.repository;
const fields = '{id,tag_name,target_commitish,prerelease,draft,html_url,assets:[.assets[]|{id,name,size,state,digest,browser_download_url}]}';
async function sha(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const read = async path => JSON.parse(await readFile(path));
let apiCalls=0;const api=async args=>{apiCalls++;assert.ok(apiCalls<=(mode==='--check'?plan.network.metadataCheckMaxApiCalls:plan.network.publishMaxApiCalls),'reviewed GitHub API operation limit');return JSON.parse((await run(gh,args,{cwd:root,maxBuffer:262144,timeout:60000})).stdout);};
async function optional(args) { try { return await api(args); } catch (error) { if (String(error.stderr).includes('404')) return null; throw error; } }
const releaseReadback = tag => api(['api', `repos/${repo}/releases/tags/${tag}`, '--jq', fields]);
const tagReadback = tag => api(['api', `repos/${repo}/git/ref/tags/${tag}`, '--jq', '{ref,object}']);
function identity(value) { return hash(JSON.stringify({ ...value, ...(value.assets ? { assets: [...value.assets].sort((a, b) => a.name.localeCompare(b.name)) } : {}) })); }
function exactRemote(remote) {
  const asset = release.assets.find(a => a.name === remote.name); assert.ok(asset);
  assert.equal(remote.size, asset.bytes); assert.equal(remote.state, 'uploaded'); assert.equal(remote.digest, 'sha256:' + asset.sha256); assert.equal(remote.browser_download_url, asset.url);
}
async function localInputs() {
  for(const [path,pin] of Object.entries(plan.offlineEvidence))assert.equal(await sha(join(root,path)),pin,path);
  assert.equal(await sha(join(plan.packageRoot, 'descriptor.json')), plan.descriptorSha256);
  assert.deepEqual(await read(join(plan.packageRoot, 'descriptor.json')), release);
  assert.equal(release.assets.length, plan.expected.files); assert.equal(release.sources.length, plan.expected.sourceShards);
  assert.equal(release.assets.reduce((n, a) => n + a.bytes, 0), plan.expected.bytes); assert.ok(release.assets.every(a => a.bytes > 0));
  for (const asset of release.assets) { const path = join(pack, asset.path); assert.equal((await stat(path)).size, asset.bytes); assert.equal(await sha(path), asset.sha256); }
  const committed = JSON.parse((await run('/usr/bin/git', ['show', `${plan.target}:server/gcsp/vehicle-evidence/fleet-releases.json`], { cwd: root, maxBuffer: 262144 })).stdout);
  assert.deepEqual(committed.find(r => r.releaseId === plan.releaseId), release);
}
const supportPins={};for(const name of ['prove-restored.mjs','supervise.py'])supportPins[name]=await sha(join(base,name));
const localGuard=mode==='--check-local'?installFleetOfflineGuard():null;
try{if(localGuard)assert.equal(localGuard.control(),'blocked');await localInputs();if(localGuard)assert.equal(localGuard.calls.length,0);}finally{localGuard?.restore();}
if(mode==='--check-local'){await save('local-check.json',{status:'offline-local-inputs-exact-public-boundary-unrun',target:plan.target,releaseId:plan.releaseId,descriptorSha256:plan.descriptorSha256,files:release.assets.length,bytes:plan.expected.bytes,planSha256:await sha(planFile),runnerSha256:await sha(fileURLToPath(import.meta.url)),externalCalls:0,publicMetadataRequests:0,publicMutationExecuted:false,ordinaryPublicationExecuted:false,acceptance:false});console.log(JSON.stringify({status:'offline-local-inputs-exact',files:release.assets.length}));}
else if (mode === '--check') {
  assert.equal((await api(['api', `repos/${repo}/commits/${plan.target}`, '--jq', '{sha}'])).sha, plan.target);
  const previous = await releaseReadback(plan.previousTag); const previousTag = await tagReadback(plan.previousTag);
  assert.equal(previous.tag_name, plan.previousTag); assert.equal(previous.draft, false); assert.equal(previous.prerelease, true);
  const old = fleetReleases.find(r => r.releaseId === plan.previousManifestDigest); assert.ok(old);
  assert.equal(previous.assets.length, old.assets.filter(a => a.bytes > 0).length);
  for (const asset of old.assets.filter(a => a.bytes > 0)) { const remote = previous.assets.find(a => a.name === asset.name); assert.ok(remote); assert.equal(remote.size, asset.bytes); assert.equal(remote.digest, 'sha256:' + asset.sha256); assert.equal(remote.browser_download_url, asset.url); }
  const present = await optional(['api', `repos/${repo}/releases/tags/${plan.tag}`, '--jq', fields]);
  const tag = await optional(['api', `repos/${repo}/git/ref/tags/${plan.tag}`, '--jq', '{ref,object}']);
  assert.equal(present, null, 'new immutable release only'); assert.equal(tag, null, 'new immutable tag only');
  await save('check.json', { status: 'ready-for-root-release', target: plan.target, releaseId: plan.releaseId, tag: plan.tag,
    planSha256: await sha(planFile), runnerSha256: await sha(fileURLToPath(import.meta.url)), descriptorSha256: plan.descriptorSha256,
    supportPins, checkedAssets: release.assets.length, checkedBytes: plan.expected.bytes, previousRelease: previous, previousTag,
    previousReleaseIdentity: identity(previous), previousTagIdentity: identity(previousTag), newReleaseAbsent: true, newTagAbsent: true,
    apiCalls,publicMutationExecuted: false, ordinaryPublicationExecuted: false, yamlChanged: false, acceptance: false });
  console.log(JSON.stringify({ status: 'ready-for-root-release', planSha256: await sha(planFile), runnerSha256: await sha(fileURLToPath(import.meta.url)), checkSha256: await sha(join(output, 'check.json')) }));
} else {
  const checkedPath = join(plan.outputRoot, plan.checkPhase, 'check.json'); const checked = await read(checkedPath);
  assert.equal(checked.planSha256, await sha(planFile)); assert.equal(checked.runnerSha256, await sha(fileURLToPath(import.meta.url)));assert.deepEqual(checked.supportPins,supportPins);
  const grant = await read(join(plan.outputRoot, 'root-release.json'));
  assert.equal(grant.authorized, true); assert.equal(grant.planSha256, checked.planSha256); assert.equal(grant.runnerSha256, checked.runnerSha256);
  assert.deepEqual(grant.supportPins,supportPins);assert.equal(grant.checkSha256, await sha(checkedPath)); assert.equal(grant.target, plan.target); assert.equal(grant.releaseId, plan.releaseId);
  if (mode === 'publish') {
    assert.equal(identity(await releaseReadback(plan.previousTag)), checked.previousReleaseIdentity);
    assert.equal(identity(await tagReadback(plan.previousTag)), checked.previousTagIdentity);
    let created = await optional(['api', `repos/${repo}/releases/tags/${plan.tag}`, '--jq', fields]);
    if (!created) {
      assert.equal(await optional(['api', `repos/${repo}/git/ref/tags/${plan.tag}`, '--jq', '{ref,object}']), null);
      const body = { tag_name: plan.tag, target_commitish: plan.target, name: `GCSP configuration corpus ${plan.version || '2026-11-07.8'}`, prerelease: true, draft: false,
        body: `Checksum-pinned partial demonstration corpus: ${plan.expected.sourceConfigurations} admitted sources, ${plan.expected.configurations} configurations, ${plan.expected.vinMappings} retained synthetic VIN and ${plan.expected.images} existing representative image associations; exact vehicle fidelity unknown. Configured consumer: ${plan.expected.configuredConsumerPassed} pass, ${plan.expected.configuredConsumerFailed} known empty-mandatory citation failures; raw invalid-active retained, no AC waiver. DTO and unique HTTP parity: ${plan.expected.direct}. Source/model/profile/year/plant/five-WMI breadth and whole Story acceptance remain incomplete. Exact raw assets preserve .8/.7 selections and complete durable identity history across ${plan.expected.sourceShards} source shards. Exact WebPs come from the matching checkout; lookup stays offline. Manifest ${release.releaseId}. Runbook: docs/gcsp/evidence/fucq62/fleet-dot8-1923-offline/README.md at target commit.` };
      await save('release-request.json', body);
      created = await api(['api', '--method', 'POST', `repos/${repo}/releases`, '--input', join(output, 'release-request.json'), '--jq', fields]);
    }
    assert.equal(created.target_commitish, plan.target); assert.equal(created.prerelease, true); assert.equal(created.draft, false);
    const tag = await tagReadback(plan.tag); assert.equal(tag.object.type, 'commit'); assert.equal(tag.object.sha, plan.target);
    await save('release-created.json', { ...created, verifiedTag: tag });
    for (const remote of created.assets) exactRemote(remote);
    const uploaded = [];
    for (const asset of release.assets) {
      const existing = created.assets.find(a => a.name === asset.name);
      const remote = existing ?? await api(['api', '--method', 'POST', `https://uploads.github.com/repos/${repo}/releases/${created.id}/assets?name=${encodeURIComponent(asset.name)}`,
        '-H', 'Content-Type: application/octet-stream', '--input', join(pack, asset.path), '--jq', '{id,name,size,state,digest,browser_download_url}']);
      exactRemote(remote); uploaded.push(remote);
      await save('upload-checkpoint.json', { releaseId: release.releaseId, target: plan.target, githubReleaseId: created.id, uploaded });
      console.log(JSON.stringify({ uploaded: uploaded.length, total: release.assets.length, name: remote.name, bytes: remote.size }));
    }
    const final = await releaseReadback(plan.tag); assert.equal(final.assets.length, release.assets.length); for (const remote of final.assets) exactRemote(remote);
    assert.equal(identity(await releaseReadback(plan.previousTag)), checked.previousReleaseIdentity);
    assert.equal(identity(await tagReadback(plan.previousTag)), checked.previousTagIdentity);
    await save('receipt.json', { status: 'immutable-prerelease-published', releaseId: plan.releaseId, target: plan.target, tag: plan.tag,
      verifiedTag: tag, githubRelease: final, files: release.assets.length, bytes: plan.expected.bytes, previousReleaseAndTagUnchanged: true,
      apiCalls,sourceTraffic: 0, ordinaryPublicationExecuted: false, yamlChanged: false, acceptance: false });
  } else {
    const cacheRoot = join(scratch, 'cache'); const store = join(scratch, 'restored'); const cache = join(cacheRoot, release.releaseId);
    const capture = join(output, 'public-network-receipt.json'); const preload = join(scratch, 'public-download-preload.mjs');
    await writeFile(preload, `import {writeFileSync} from 'node:fs';
import {approvedAssetUrl} from ${JSON.stringify(pathToFileURL(join(root, 'server/gcsp/vehicle-evidence/fleet-release.js')).href)};
const original=globalThis.fetch;const requests=[];let denied=0;let attempts=0;const limit=${plan.network.anonymousMaxRequests};const initial=new Set(${JSON.stringify(release.assets.map(a=>a.url))});
globalThis.fetch=async(url,options)=>{attempts++;try{if(attempts>limit)throw Error('Reviewed anonymous request bound');approvedAssetUrl(String(url));if(new URL(url).hostname==='github.com'&&!initial.has(String(url)))throw Error('Unreviewed asset URL');const headers=new Headers(options?.headers);if(headers.has('authorization')||headers.has('cookie'))throw Error('anonymous transport required');}catch(e){denied++;throw e;}
const response=await original(url,options);requests.push({host:new URL(url).hostname,status:response.status});return response;};
process.on('exit',()=>writeFileSync(${JSON.stringify(capture)},JSON.stringify({requests,attempts,limit,denied,authorization:false,cookie:false})));`);
    const env = { PATH: process.env.PATH, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
    const restoreArgs = ['--release', release.releaseId, '--store', store, '--cache', cacheRoot];
    let downloadChildren=0;
    async function cli(extra, preloadPath) {
      if(extra==='download'){downloadChildren++;assert.equal(downloadChildren,plan.network.anonymousDownloadChildren);}
      let child;try{child=await run(process.execPath, ['--max-old-space-size=256', ...(preloadPath ? ['--import', preloadPath] : []),
        join(root, 'server/scripts/fleet-artifacts.mjs'), 'restore', ...restoreArgs, '--network', extra], { cwd: root, env, maxBuffer: 1048576, timeout: 180000 });}catch(error){await save('cli-failed.json',{status:'failed',networkMode:extra,code:error.code,stdout:String(error.stdout||'').slice(0,65536),stderr:String(error.stderr||'').slice(0,65536),noAutomaticRetry:true});throw error;}return JSON.parse(child.stdout);
    }
    const restored = await cli('download', preload); assert.equal(restored.status, 'ok'); assert.equal(restored.mode, 'cold-restore'); assert.equal(restored.active.manifestDigest, release.releaseId);
    const network = await read(capture); assert.equal(network.denied, 0);assert.ok(network.attempts<=plan.network.anonymousMaxRequests);assert.equal(network.authorization,false);assert.equal(network.cookie,false); assert.equal(network.requests.filter(r => r.status === 200).length, plan.expected.files); assert.equal(restored.externalCalls, network.requests.length);
    const files = [];
    for (const asset of release.assets) { const path = join(cache, asset.path); assert.equal((await stat(path)).size, asset.bytes); assert.equal(await sha(path), asset.sha256); files.push({ name: asset.name, path: asset.path, bytes: asset.bytes, sha256: asset.sha256 }); }
    for (const file of ['active.json', 'last-good.json', 'identity-inventory.json']) assert.deepEqual(await readFile(join(store, file)), await readFile(join(cache, 'store', file)));
    const history = await read(join(store, 'identity-inventory.json')); assert.equal(history.configurations.length, plan.expected.configurations); assert.equal(history.identities.length, plan.expected.vinMappings); assert.equal(history.datasets.length, plan.expected.datasets);
    await save('download-receipt.json', { status: 'real-cli-anonymous-public-restore-passed', releaseId: plan.releaseId, runtime: process.version, files, bytes: plan.expected.bytes,
      network, restore: restored, inventory: { configurations: plan.expected.configurations, identities: plan.expected.vinMappings, datasets: plan.expected.datasets, sha256: await sha(join(store, 'identity-inventory.json')) }, ordinaryPublicationExecuted: false });
    const offlinePreload = join(scratch, 'offline-preload.mjs'); const offlineCapture = join(output, 'offline-network-receipt.json');
    await writeFile(offlinePreload, `import {writeFileSync} from 'node:fs';import {installFleetOfflineGuard} from ${JSON.stringify(pathToFileURL(join(root, 'scripts/gcsp/fleet-offline-guard.mjs')).href)};const g=installFleetOfflineGuard();const control=g.control();process.on('exit',()=>writeFileSync(${JSON.stringify(offlineCapture)},JSON.stringify({control,calls:g.calls.length})));`);
    const offline = await cli('offline', offlinePreload); assert.equal(offline.status, 'ok'); assert.equal(offline.idempotent, true); assert.equal(offline.externalCalls, 0);
    assert.deepEqual(await read(offlineCapture), { control: 'blocked', calls: 0 });
    const proved=JSON.parse((await run(process.execPath,['--max-old-space-size=256','--expose-gc',join(base,'prove-restored.mjs'),store,output,cache],{cwd:root,env,maxBuffer:1048576,timeout:240000})).stdout);
    assert.equal(proved.status,'dto-http-passed-known-consumer-limitation');assert.equal(proved.httpUnique,plan.expected.httpUnique);
    await save('offline-restart-receipt.json',{status:'fresh-offline-cli-dto-http-passed-known-consumer-limitation',releaseId:plan.releaseId,restore:offline,proof:proved,requiredDistinctForThisCheck:plan.expected.sourceConfigurations,full10000TargetMet:false,ordinaryPublicationExecuted:false,acceptance:false});
    const guard = installFleetOfflineGuard(); assert.equal(guard.control(), 'blocked');
    const pointers = await readFile(join(store, 'active.json')); const inventory = await readFile(join(store, 'identity-inventory.json'));
    const newOnly = release.sources.filter(s => s.manifestDigests.length === 1); assert.equal(newOnly.length, 1);
    const changedPath = join(cache, newOnly[0].path); const exact = await readFile(changedPath); const bad = Buffer.from(exact); bad[0] ^= 1;
    const options = { policyService: createPolicyService(), policyRead: { runId: 'dot8-changed-source-rollback', asOf: '2026-11-07T00:00:00.000Z' },
      approvedImages: APPROVED_CORPUS_IMAGES, jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: cache };
    let recovered;
    try {
      await writeFile(changedPath, bad); recovered = await createSyntheticRegistry({ root: store, ...options }).load();
      assert.equal(recovered.recovered, true); assert.equal(recovered.active.manifestDigest, release.previousManifestDigest);
      assert.equal(recovered.active.counts.sourceConfigurations, plan.previousExpected.sourceConfigurations); assert.equal(recovered.active.counts.images, plan.previousExpected.images);
      assert.deepEqual(await readFile(join(store, 'active.json')), pointers); assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), inventory);
    } finally { await writeFile(changedPath, exact); }
    const currentImages=join(store,'versions',release.releaseId,'images.jsonl');const imageExact=await readFile(currentImages);const badImages=Buffer.from(imageExact);badImages[0]^=1;
    let imageRecovery;
    try{await writeFile(currentImages,badImages);imageRecovery=await createSyntheticRegistry({root:store,...options}).load();assert.equal(imageRecovery.recovered,true);assert.equal(imageRecovery.active.manifestDigest,release.previousManifestDigest);assert.equal(imageRecovery.active.counts.images,plan.previousExpected.images);assert.deepEqual(await readFile(join(store,'active.json')),pointers);assert.deepEqual(await readFile(join(store,'identity-inventory.json')),inventory);}finally{await writeFile(currentImages,imageExact);}
    const freshRegistry=createSyntheticRegistry({root:store,...options});const recoveredCurrent=await freshRegistry.load();assert.equal(recoveredCurrent.active.manifestDigest,release.releaseId);
    for(const image of APPROVED_CORPUS_IMAGES){const row=freshRegistry.getConfiguration(image.configurationId);assert.deepEqual(row.images,[image]);assert.deepEqual(row.record.imageIds,[]);}
    assert.equal(await sha(changedPath),newOnly[0].sha256);assert.deepEqual(await readFile(join(store,'identity-inventory.json')),inventory);assert.equal(guard.calls.length,0);guard.restore();
    await save('changed-edge-receipt.json',{status:'dot8-source-and-image-rollback-passed',releaseId:plan.releaseId,corruptNewOnlySource:{previousRecovered:true,previousManifestDigest:recovered.active.manifestDigest,sourceConfigurations:plan.previousExpected.sourceConfigurations,images:plan.previousExpected.images,selectionAndCompleteHistoryBytesUnchanged:true},corruptCurrentImage:{previousRecovered:true,previousManifestDigest:imageRecovery.active.manifestDigest,images:plan.previousExpected.images,selectionAndCompleteHistoryBytesUnchanged:true},exactOwnedBytesRestored:true,freshCurrentLoad:recoveredCurrent.active.manifestDigest,providerEgress:0,unchangedRecoveryMatrixReused:true});
    const staticImages=[];for(const image of plan.staticImages){const path=join(root,image.asset);assert.equal((await stat(path)).size,image.bytes);assert.equal(await sha(path),image.sha256);staticImages.push({imageId:image.imageId,bytes:image.bytes,sha256:image.sha256,deployedGet:'unrun; root live boundary pending'});}
    await save('receipt.json',{status:'anonymous-public-restore-dto-http-and-changed-rollback-passed-known-consumer-limitation',releaseId:plan.releaseId,publicFiles:plan.expected.files,bytes:plan.expected.bytes,anonymousRequests:network.requests.length,anonymousDownloadChildren:downloadChildren,directLookupParity:plan.expected.direct,httpUnique:plan.expected.httpUnique,httpSample:plan.expected.httpSample,httpComplement:plan.expected.httpComplement,configuredConsumer:{passed:proved.configuredConsumerPassed,failed:proved.configuredConsumerFailed,knownDefect:plan.knownConsumerDefect,severity:'Medium',acceptanceWaiver:false},sourceProviderEgress:0,evidencePins:Object.fromEntries(await Promise.all(['download-receipt.json','raw-active-audit.json','dto-http-proof.json','offline-restart-receipt.json','changed-edge-receipt.json'].map(async name=>[name,await sha(join(output,name))]))),exactHistorySha256:hash(inventory),staticImages,ordinaryPublicationExecuted:false,yamlChanged:false,acceptance:false});
    console.log(JSON.stringify({status:'public-dot8-passed-known-consumer-limitation',publicFiles:plan.expected.files,directLookupParity:plan.expected.direct,httpUnique:plan.expected.httpUnique,configuredConsumerFailed:proved.configuredConsumerFailed,sourceProviderEgress:0}));
  }
}
