// Exact retained-source candidate and isolated application proof. Never ordinary publication.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { indexJsonl } from '../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { canonicalContent, validateCorpusDirectory, writeCorpusCandidate } from '../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const plan = JSON.parse(await readFile(new URL('./fleet-2026-11-07-5-plan.json', import.meta.url), 'utf8'));
assert.equal(process.argv[2], '--receipt'); const receiptPath = process.argv[3]; const scratch = process.env.TMPDIR;
assert.ok(isAbsolute(receiptPath) && isAbsolute(scratch) && /\/test-stamp-shard-[a-f0-9]+$/.test(scratch));
assert.ok(relative(scratch, receiptPath).startsWith('..'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function hashFile(path) { const h = createHash('sha256'); for await (const bytes of createReadStream(path)) h.update(bytes); return h.digest('hex'); }
async function tree(path) {
  const result = [];
  async function walk(dir) { for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name); if (entry.isDirectory()) await walk(p); else result.push({ path: relative(path,p), bytes:(await stat(p)).size, sha256:await hashFile(p) });
  } }
  await walk(path); return result;
}
const store = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const beforeTree = await tree(store); const pointerBytes = await readFile(join(store, 'active.json'));
const pointer = JSON.parse(pointerBytes); assert.equal(pointer.selected.manifestDigest, plan.baseline.manifestDigest);
const baseline = join(store, 'versions', plan.baseline.manifestDigest);
assert.equal(await hashFile(join(baseline, 'configurations.jsonl')), plan.baseline.configurationSha256);
assert.equal(await hashFile(join(baseline, 'vins.jsonl')), plan.baseline.vinSha256);
const oldRows = new Map((await readFile(join(baseline, 'configurations.jsonl'), 'utf8')).trimEnd().split('\n').map((line) => [JSON.parse(line).configurationId, line]));
assert.equal(oldRows.size,350);
const originalHistory = JSON.parse(await readFile(join(store,'identity-inventory.json')));
const options = { indexed:true, approvedImages:APPROVED_CORPUS_IMAGES, jsonlLimitsForManifest:releaseLimits,
  policyService:createPolicyService(), policyRead:{runId:'f62-fleet-20261107-5',asOf:'2026-11-07T00:00:00.000Z'} };
const guard = installFleetOfflineGuard(); const control = guard.control(); assert.equal(control,'blocked');
const candidate = join(scratch,'candidate'); const isolatedStore = join(scratch,'isolated-store');
let prepared, manifestDigest, history, audit; const inputs=[]; const novelIds=new Set();
try {
  const file = join(scratch,'new-configurations.jsonl'); const output=await open(file,'wx',0o600);
  const fields=['model','derivative','generation','body','powertrain','drive','transmission','engineCode','agModelCode','vgModelCode','market','region','steering','modelYear','productionEra','productionDate','plant'];
  try {
    for (const input of plan.files) {
      const source=join(root,input.path);assert.equal((await stat(source)).size,input.bytes);assert.equal(await hashFile(source),input.sha256);
      const registered=join(root,'server/data/gcsp/vehicle-evidence/registered-sources',input.registeredOrigin);
      assert.equal((await stat(registered)).size,input.bytes);assert.equal(await hashFile(registered),input.sha256);
      const rows=await indexJsonl(source,{key:(row)=>row.configurationId});assert.equal(rows.length,input.records);
      for (const row of rows) {
        assert.equal(row.admission,true);assert.equal(row.sourceKind,'dated-snapshot');assert.equal(row.catalogue.schemaVersion,'2');
        assert.equal(oldRows.has(row.configurationId),false);assert.equal(novelIds.has(row.configurationId),false);novelIds.add(row.configurationId);
        const c=row.catalogue;const b=c.sourceBinding;const configuration=Object.fromEntries(fields.map((field)=>[field,null]));
        Object.assign(configuration,{model:b.optionalFacts.modelName.value,generation:b.confirmedContext.rawModelRange.value,
          agModelCode:b.canonicalIdentity.agModelCode,vgModelCode:b.canonicalIdentity.vgModelCode,market:b.requestScope.market});
        await output.writeFile(canonicalContent({configurationId:row.configurationId,snapshotVersion:c.snapshotVersion,
          canonicalIdentity:{...b.canonicalIdentity,provenance:c.identityProvenance},configuration,
          sourceContext:{sourceRefs:[...new Set(b.evidence.map((e)=>e.request.url))].sort(),observedDate:c.observedDate,
            catalogueDate:c.observedDate,confidence:'Complete source factory selection; physical build unknown',
            unresolvedFacts:fields.filter((field)=>configuration[field]===null),sourceKind:'dated-snapshot',selectedOptionCompleteness:c.completeness.factorySelection},
          catalogue:c,imageIds:[]}));
      }
      inputs.push({...input,registeredSha256:await hashFile(registered)});
    }
    await output.sync();
  } finally {await output.close();}
  assert.equal(novelIds.size,130);assert.equal(hash([...novelIds].sort().join('\n')+'\n'),plan.novelConfigurationIds.sha256);
  for (const input of plan.reconciliationInputs) {assert.equal(await hashFile(join(root,input.path)),input.sha256);assert.equal((await stat(join(root,input.path))).size,input.bytes);}
  const finalIndex=JSON.parse(await readFile(join(root,plan.reconciliationInputs[0].path)));
  const union=new Set([...oldRows.keys(),...novelIds]);const extras=finalIndex.entries.filter((e)=>!union.has(e.configurationId));
  assert.equal(finalIndex.entries.length,482);assert.equal(union.size,480);assert.equal(extras.length,2);
  assert.deepEqual(extras.map((e)=>hash(e.configurationId)).sort(),[...plan.canonicalIndex.excludedRetainedPriorObservationIdsSha256].sort());
  for (const entry of extras) assert.ok(entry.origins.every((o)=>o.kind==='retained-prior-observation'));
  const metadata=JSON.parse(await readFile(join(baseline,'manifest.json')));
  for (const key of ['signaturePolicy','qualification','counts','coverage','completeness','checksums'])delete metadata[key];
  metadata.version=plan.version;
  for (const context of metadata.sourceContexts) if(context.observedDate==='2026-11-07'&&context.market==='GB')context.note='478 actual admitted v2 factory selections; physical build, technical measurements and scheme model breadth remain unknown; one representative image belongs only to the retained v1 configuration';
  prepared=await writeCorpusCandidate(candidate,{metadata,retainedCorpusDirectory:baseline,configurationsFile:file,images:APPROVED_CORPUS_IMAGES},options);
  assert.equal(prepared.status,'ok',JSON.stringify(prepared));assert.deepEqual(prepared.manifest.counts,plan.expected);
  const checked=await validateCorpusDirectory(candidate,options);assert.equal(checked.status,'ok',JSON.stringify(checked));manifestDigest=checked.manifestDigest;
  const candidateRows=new Map((await readFile(join(candidate,'configurations.jsonl'),'utf8')).trimEnd().split('\n').map((line)=>[JSON.parse(line).configurationId,line]));
  for(const [id,line]of oldRows)assert.equal(candidateRows.get(id),line);
  assert.deepEqual(await readFile(join(candidate,'vins.jsonl')),await readFile(join(baseline,'vins.jsonl')));
  assert.deepEqual([...checked.corpus.images],APPROVED_CORPUS_IMAGES);
  assert.equal(hash(APPROVED_CORPUS_IMAGES[0].configurationId),plan.image.configurationIdSha256);
  const staticAsset=join(root,plan.image.asset);assert.equal((await stat(staticAsset)).size,plan.image.bytes);assert.equal(await hashFile(staticAsset),plan.image.sha256);
  await cp(store,isolatedStore,{recursive:true,force:false,errorOnExist:true});
  const registry=createSyntheticRegistry({root:isolatedStore,...options});assert.equal((await registry.load()).status,'ok');
  const published=await registry.publish(candidate);assert.equal(published.status,'ok',JSON.stringify(published));assert.equal(published.active.manifestDigest,manifestDigest);
  assert.equal((await registry.publish(candidate)).idempotent,true);
  const cold=createSyntheticRegistry({root:isolatedStore,...options});assert.equal((await cold.load()).status,'ok');
  const imaged=cold.getConfiguration(APPROVED_CORPUS_IMAGES[0].configurationId);assert.deepEqual(imaged.record.imageIds,[]);assert.deepEqual(imaged.images,APPROVED_CORPUS_IMAGES);assert.equal(imaged.imageState,'representative');
  history=JSON.parse(await readFile(join(isolatedStore,'identity-inventory.json')));
  assert.equal(history.configurations.length,originalHistory.configurations.length+130);assert.deepEqual(history.identities,originalHistory.identities);
  for(const entry of originalHistory.configurations)assert.deepEqual(history.configurations.find((r)=>r.configurationId===entry.configurationId),entry);
  for(const entry of originalHistory.datasets)assert.deepEqual(history.datasets.find((r)=>r.datasetId===entry.datasetId&&r.version===entry.version),entry);
  assert.equal(history.datasets.length,originalHistory.datasets.length+1);
  for(const entry of beforeTree.filter((entry)=>entry.path.startsWith('versions/')))assert.equal(await hashFile(join(isolatedStore,entry.path)),entry.sha256);
  // active/inventory are expected to change only in this isolated copy; prior version bytes are immutable.
  assert.equal(guard.calls.length,0);
} finally {guard.restore();}
await writeFile(receiptPath+'.progress.json',JSON.stringify({status:'candidate-and-isolated-history-validated',candidateManifestDigest:manifestDigest,counts:prepared.manifest.counts,ordinaryPublicationExecuted:false})+'\n');
if(globalThis.gc)globalThis.gc();
const child=await run(process.execPath,['--max-old-space-size=256',join(root,'scripts/gcsp/verify-fleet.mjs'),'--active','--store',isolatedStore,
  '--require-distinct','479','--offline','--http','--endpoint','http://127.0.0.1:0','--concurrency','1','--sample-size','481','--run-id','f62-fleet-20261107-5','--as-of','2026-11-07T00:00:00.000Z'],
  {cwd:root,env:{PATH:process.env.PATH,TMPDIR:scratch,TMP:scratch,TEMP:scratch},maxBuffer:1048576});
audit=JSON.parse(child.stdout);assert.equal(audit.status,'verified-active',JSON.stringify(audit));assert.deepEqual(audit.actual.sourceConfigurations,479);
assert.equal(audit.actual.images,1);assert.equal(audit.audit.checked,481);assert.equal(audit.audit.errors,0);assert.equal(audit.http.requests,481);assert.equal(audit.http.errors,0);assert.equal(audit.http.serverClosed,true);assert.equal(audit.egress.externalCalls,0);assert.equal(audit.egress.sourceCalls,0);
assert.deepEqual(await tree(store),beforeTree);assert.deepEqual(await readFile(join(store,'active.json')),pointerBytes);
await writeFile(join(receiptPath,'..','candidate-manifest.json'),await readFile(join(candidate,'manifest.json')));
await writeFile(receiptPath,JSON.stringify({status:'prepared-isolated-proved-ordinary-unchanged',version:plan.version,candidateManifestDigest:manifestDigest,counts:prepared.manifest.counts,
  inputs,novelConfigurationIds:plan.novelConfigurationIds,canonicalIndex:{entries:482,publishedUnion:480,excludedPriorObservations:2},
  immutable:{priorConfigurationRowsByteIdentical:350,vinBytesIdentical:true,priorHistoryConfigurationsUnchanged:originalHistory.configurations.length,
    priorHistoryIdentitiesUnchanged:originalHistory.identities.length,priorHistoryDatasetsUnchanged:originalHistory.datasets.length,isolatedAddedConfigurations:130,isolatedAddedDatasets:1,ordinaryStoreTreeUnchanged:true,ordinaryStoreFiles:beforeTree.length},
  image:plan.image,audit,egress:{preparationExternalCalls:guard.calls.length,control},ordinaryPublicationExecuted:false,publicUploadExecuted:false,renderChanged:false,
  candidateRetained:false,reprepareRequiresSameInputCodeEnvironmentIdentity:true,acceptance:'not-established'},null,2)+'\n');
process.stdout.write(JSON.stringify({status:'prepared-isolated-proved-ordinary-unchanged',candidateManifestDigest:manifestDigest,counts:prepared.manifest.counts})+'\n');
