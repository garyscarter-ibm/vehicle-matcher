// Adapts the .5 public runners; production release/restore/audit APIs remain unchanged.
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
const [mode, output] = process.argv.slice(2); assert.ok(['--check', 'publish', 'download'].includes(mode)); assert.ok(isAbsolute(output));
const scratch = process.env.TMPDIR; assert.ok(isAbsolute(scratch) && /\/test-stamp-shard-[a-f0-9]+$/.test(scratch));
const release = fleetReleases.find(r => r.releaseId === plan.releaseId); assert.ok(release);
const pack = join(plan.packageRoot, 'pack', plan.releaseId);
const gh = '/Users/usget/.claude-tools/bin/gh'; const repo = plan.repository;
const fields = '{id,tag_name,target_commitish,prerelease,draft,html_url,assets:[.assets[]|{id,name,size,state,digest,browser_download_url}]}';
async function sha(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const read = async path => JSON.parse(await readFile(path));
const api = async args => JSON.parse((await run(gh, args, { cwd: root, maxBuffer: 262144, timeout: 60000 })).stdout);
async function optional(args) { try { return await api(args); } catch (error) { if (String(error.stderr).includes('404')) return null; throw error; } }
const releaseReadback = tag => api(['api', `repos/${repo}/releases/tags/${tag}`, '--jq', fields]);
const tagReadback = tag => api(['api', `repos/${repo}/git/ref/tags/${tag}`, '--jq', '{ref,object}']);
function identity(value) { return hash(JSON.stringify({ ...value, ...(value.assets ? { assets: [...value.assets].sort((a, b) => a.name.localeCompare(b.name)) } : {}) })); }
function exactRemote(remote) {
  const asset = release.assets.find(a => a.name === remote.name); assert.ok(asset);
  assert.equal(remote.size, asset.bytes); assert.equal(remote.state, 'uploaded'); assert.equal(remote.digest, 'sha256:' + asset.sha256); assert.equal(remote.browser_download_url, asset.url);
}
async function localInputs() {
  assert.equal(await sha(join(plan.packageRoot, 'descriptor.json')), plan.descriptorSha256);
  assert.deepEqual(await read(join(plan.packageRoot, 'descriptor.json')), release);
  assert.equal(release.assets.length, plan.expected.files); assert.equal(release.sources.length, plan.expected.sourceShards);
  assert.equal(release.assets.reduce((n, a) => n + a.bytes, 0), plan.expected.bytes); assert.ok(release.assets.every(a => a.bytes > 0));
  for (const asset of release.assets) { const path = join(pack, asset.path); assert.equal((await stat(path)).size, asset.bytes); assert.equal(await sha(path), asset.sha256); }
  const committed = JSON.parse((await run('/usr/bin/git', ['show', `${plan.target}:server/gcsp/vehicle-evidence/fleet-releases.json`], { cwd: root, maxBuffer: 262144 })).stdout);
  assert.deepEqual(committed.find(r => r.releaseId === plan.releaseId), release);
}
await localInputs();
if (mode === '--check') {
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
    checkedAssets: release.assets.length, checkedBytes: plan.expected.bytes, previousRelease: previous, previousTag,
    previousReleaseIdentity: identity(previous), previousTagIdentity: identity(previousTag), newReleaseAbsent: true, newTagAbsent: true,
    publicMutationExecuted: false, ordinaryPublicationExecuted: false, yamlChanged: false, acceptance: false });
  console.log(JSON.stringify({ status: 'ready-for-root-release', planSha256: await sha(planFile), runnerSha256: await sha(fileURLToPath(import.meta.url)), checkSha256: await sha(join(output, 'check.json')) }));
} else {
  const checkedPath = join(plan.outputRoot, plan.checkPhase, 'check.json'); const checked = await read(checkedPath);
  assert.equal(checked.planSha256, await sha(planFile)); assert.equal(checked.runnerSha256, await sha(fileURLToPath(import.meta.url)));
  const grant = await read(join(plan.outputRoot, 'root-release.json'));
  assert.equal(grant.authorized, true); assert.equal(grant.planSha256, checked.planSha256); assert.equal(grant.runnerSha256, checked.runnerSha256);
  assert.equal(grant.checkSha256, await sha(checkedPath)); assert.equal(grant.target, plan.target); assert.equal(grant.releaseId, plan.releaseId);
  if (mode === 'publish') {
    assert.equal(identity(await releaseReadback(plan.previousTag)), checked.previousReleaseIdentity);
    assert.equal(identity(await tagReadback(plan.previousTag)), checked.previousTagIdentity);
    let created = await optional(['api', `repos/${repo}/releases/tags/${plan.tag}`, '--jq', fields]);
    if (!created) {
      assert.equal(await optional(['api', `repos/${repo}/git/ref/tags/${plan.tag}`, '--jq', '{ref,object}']), null);
      const body = { tag_name: plan.tag, target_commitish: plan.target, name: 'GCSP configuration corpus 2026-11-07.6', prerelease: true, draft: false,
        body: 'Checksum-pinned partial demonstration corpus: 869 retained complete distinct source configurations, 870 configurations total, one retained synthetic VIN and one approved representative configuration image. Source/model/profile/year/plant/five-WMI breadth and whole Story acceptance remain incomplete. Raw assets preserve .6/.5 selections, complete durable identity history and ten admitted source shards; the exact WebP is supplied by the matching application checkout. Runtime lookup stays offline. Manifest ' + release.releaseId + '. Runbook: docs/gcsp/evidence/fucq62/fleet-dot6-package/README.md at the target commit.' };
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
      sourceTraffic: 0, ordinaryPublicationExecuted: false, yamlChanged: false, acceptance: false });
  } else {
    const cacheRoot = join(scratch, 'cache'); const store = join(scratch, 'restored'); const cache = join(cacheRoot, release.releaseId);
    const capture = join(output, 'public-network-receipt.json'); const preload = join(scratch, 'public-download-preload.mjs');
    await writeFile(preload, `import {writeFileSync} from 'node:fs';
import {approvedAssetUrl} from ${JSON.stringify(pathToFileURL(join(root, 'server/gcsp/vehicle-evidence/fleet-release.js')).href)};
const original=globalThis.fetch;const requests=[];let denied=0;
globalThis.fetch=async(url,options)=>{try{approvedAssetUrl(String(url));const headers=new Headers(options?.headers);if(headers.has('authorization')||headers.has('cookie'))throw Error('anonymous transport required');}catch(e){denied++;throw e;}
const response=await original(url,options);requests.push({host:new URL(url).hostname,status:response.status});return response;};
process.on('exit',()=>writeFileSync(${JSON.stringify(capture)},JSON.stringify({requests,denied,authorization:false,cookie:false})));`);
    const env = { PATH: process.env.PATH, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
    const restoreArgs = ['--release', release.releaseId, '--store', store, '--cache', cacheRoot];
    async function cli(extra, preloadPath) {
      return JSON.parse((await run(process.execPath, ['--max-old-space-size=256', ...(preloadPath ? ['--import', preloadPath] : []),
        join(root, 'server/scripts/fleet-artifacts.mjs'), 'restore', ...restoreArgs, '--network', extra], { cwd: root, env, maxBuffer: 1048576, timeout: 110000 })).stdout);
    }
    const restored = await cli('download', preload); assert.equal(restored.status, 'ok'); assert.equal(restored.mode, 'cold-restore'); assert.equal(restored.active.manifestDigest, release.releaseId);
    const network = await read(capture); assert.equal(network.denied, 0); assert.equal(network.requests.filter(r => r.status === 200).length, 21); assert.equal(restored.externalCalls, network.requests.length);
    const files = [];
    for (const asset of release.assets) { const path = join(cache, asset.path); assert.equal((await stat(path)).size, asset.bytes); assert.equal(await sha(path), asset.sha256); files.push({ name: asset.name, path: asset.path, bytes: asset.bytes, sha256: asset.sha256 }); }
    for (const file of ['active.json', 'last-good.json', 'identity-inventory.json']) assert.deepEqual(await readFile(join(store, file)), await readFile(join(cache, 'store', file)));
    const history = await read(join(store, 'identity-inventory.json')); assert.equal(history.configurations.length, 870); assert.equal(history.identities.length, 1); assert.equal(history.datasets.length, 7);
    await save('download-receipt.json', { status: 'real-cli-anonymous-public-restore-passed', releaseId: plan.releaseId, runtime: process.version, files, bytes: plan.expected.bytes,
      network, restore: restored, inventory: { configurations: 870, identities: 1, datasets: 7, sha256: await sha(join(store, 'identity-inventory.json')) }, ordinaryPublicationExecuted: false });
    const offlinePreload = join(scratch, 'offline-preload.mjs'); const offlineCapture = join(output, 'offline-network-receipt.json');
    await writeFile(offlinePreload, `import {writeFileSync} from 'node:fs';import {installFleetOfflineGuard} from ${JSON.stringify(pathToFileURL(join(root, 'scripts/gcsp/fleet-offline-guard.mjs')).href)};const g=installFleetOfflineGuard();const control=g.control();process.on('exit',()=>writeFileSync(${JSON.stringify(offlineCapture)},JSON.stringify({control,calls:g.calls.length})));`);
    const offline = await cli('offline', offlinePreload); assert.equal(offline.status, 'ok'); assert.equal(offline.idempotent, true); assert.equal(offline.externalCalls, 0);
    assert.deepEqual(await read(offlineCapture), { control: 'blocked', calls: 0 });
    const audited = await run(process.execPath, ['--max-old-space-size=256', join(root, 'scripts/gcsp/verify-fleet.mjs'), '--active', '--store', store,
      '--require-distinct', '869', '--offline', '--http', '--endpoint', 'http://127.0.0.1:0', '--concurrency', '1', '--sample-size', '871',
      '--run-id', 'public-dot6-cold-restart', '--as-of', '2026-11-07T00:00:00.000Z'], { cwd: root, env, maxBuffer: 1048576, timeout: 110000 });
    const audit = JSON.parse(audited.stdout); assert.equal(audit.status, 'verified-active'); assert.equal(audit.actual.sourceConfigurations, 869); assert.equal(audit.actual.configurations, 870);
    assert.equal(audit.actual.images, 1); assert.equal(audit.audit.checked, 871); assert.equal(audit.audit.errors, 0); assert.equal(audit.http.requests, 871);
    assert.equal(audit.http.errors, 0); assert.equal(audit.http.scope, 'all-records'); assert.equal(audit.http.serverClosed, true); assert.equal(audit.egress.externalCalls, 0); assert.equal(audit.egress.sourceCalls, 0);
    await save('offline-restart-receipt.json', { status: 'fresh-offline-cli-and-full-parity-passed', releaseId: plan.releaseId, restore: offline, audit,
      requiredDistinctForThisCheck: 869, full10000TargetMet: false, ordinaryPublicationExecuted: false, acceptance: false });
    const guard = installFleetOfflineGuard(); assert.equal(guard.control(), 'blocked');
    const pointers = await readFile(join(store, 'active.json')); const inventory = await readFile(join(store, 'identity-inventory.json'));
    const newOnly = release.sources.filter(s => s.manifestDigests.length === 1); assert.equal(newOnly.length, 1);
    const changedPath = join(cache, newOnly[0].path); const exact = await readFile(changedPath); const bad = Buffer.from(exact); bad[0] ^= 1;
    const options = { policyService: createPolicyService(), policyRead: { runId: 'dot6-changed-source-rollback', asOf: '2026-11-07T00:00:00.000Z' },
      approvedImages: APPROVED_CORPUS_IMAGES, jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: cache };
    let recovered;
    try {
      await writeFile(changedPath, bad); recovered = await createSyntheticRegistry({ root: store, ...options }).load();
      assert.equal(recovered.recovered, true); assert.equal(recovered.active.manifestDigest, release.previousManifestDigest);
      assert.equal(recovered.active.counts.sourceConfigurations, 479); assert.equal(recovered.active.counts.images, 1);
      assert.deepEqual(await readFile(join(store, 'active.json')), pointers); assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), inventory);
    } finally { await writeFile(changedPath, exact); }
    const recoveredCurrent = await createSyntheticRegistry({ root: store, ...options }).load(); assert.equal(recoveredCurrent.active.manifestDigest, release.releaseId);
    assert.equal(await sha(changedPath), newOnly[0].sha256); assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), inventory); assert.equal(guard.calls.length, 0); guard.restore();
    await save('changed-edge-receipt.json', { status: 'dot6-only-source-rollback-passed', releaseId: plan.releaseId,
      corruptNewOnlySource: { previousRecovered: true, previousManifestDigest: recovered.active.manifestDigest, sourceConfigurations: 479, images: 1, selectionAndCompleteHistoryBytesUnchanged: true },
      exactSourceRestored: true, freshCurrentLoad: recoveredCurrent.active.manifestDigest, providerEgress: 0, unchangedRecoveryMatrixReused: true });
    const image = join(root, 'assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp');
    assert.equal((await stat(image)).size, 82798); assert.equal(await sha(image), 'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe');
    await save('receipt.json', { status: 'anonymous-public-restore-full-offline-parity-and-changed-rollback-passed', releaseId: plan.releaseId, publicFiles: 21, bytes: plan.expected.bytes,
      anonymousRequests: network.requests.length, direct: 871, http: 871, errors: 0, sourceProviderEgress: 0, exactHistorySha256: hash(inventory),
      staticImage: { bytes: 82798, sha256: await sha(image), deployedGet: 'not repeated; root live boundary pending' }, ordinaryPublicationExecuted: false, yamlChanged: false, acceptance: false });
    console.log(JSON.stringify({ status: 'public-dot6-passed', publicFiles: 21, direct: 871, http: 871, errors: 0, sourceProviderEgress: 0 }));
  }
}
