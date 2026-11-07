/** Pure finite continuation checks. No HTTP, source grant or claimed capacity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const base = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const manifest = read(join(base, 'continuation-plan.json'));

test('finite core chunks cover exactly the163 remaining actual typed requests with no first32 overlap', () => {
  const first = read(join(manifest.first32Directory, 'collection-plan.json'));
  const options = read(join(root, manifest.actualTypedBasis.actualOptionsPath));
  const definitions = new Map(options.report.candidates[0].definitions.map(row => [row.code, row]));
  assert.equal(sha(join(root, manifest.actualTypedBasis.actualOptionsPath)), manifest.actualTypedBasis.actualOptionsSha256);
  assert.equal(sha(join(manifest.first32Directory, 'execution-plan.json')), manifest.first32ExecutionPlanSha256);
  const seen = new Set(first.candidates.map(row => digest({modelRegistration:first.modelRegistration, request:row.request})));
  assert.equal(seen.size, 32);
  assert.deepEqual(manifest.chunks.map(row => row.candidates), [32,32,32,15,32,20]);
  assert.equal(manifest.chunks.reduce((sum,row) => sum + row.attempts, 0),187);
  for (const chunk of manifest.chunks) {
    const template = read(join(root, chunk.planTemplatePath));
    assert.equal(sha(join(root, chunk.planTemplatePath)),chunk.planTemplateSha256);
    assert.equal(digest(template),chunk.planDigest);
    assert.deepEqual(template.modelRegistration,manifest.modelRegistration);
    assert.equal(template.candidateCount,chunk.candidates);
    assert.equal(template.limits.sourceAttempts,chunk.candidates + 4);
    for (const candidate of template.candidates) {
      const requestDigest = digest({modelRegistration:template.modelRegistration,request:candidate.request});
      assert.equal(seen.has(requestDigest),false);seen.add(requestDigest);
      assert.ok(chunk.requestDigests.includes(requestDigest));
      assert.deepEqual(candidate.request.mandatoryElements,['S033B']);
      assert.equal(candidate.request.includedElements.length,4);
      for (const kind of ['paint','fabric','rim'])
        assert.equal(candidate.request.includedElements.filter(code => definitions.get(code)?.optionType === kind).length,1);
    }
    for (const [path,hash] of Object.entries(chunk.runtimePins))assert.equal(sha(join(root,path)),hash,path);
    for (const name of ['execution-plan.json','execution-once.json','collector-checkpoint.json'])
      assert.equal(existsSync(join(chunk.directory,name)),false,name);
  }
  assert.equal(seen.size,195);
});

test('sequential bounds and durable proof gate are explicit and every script parses', () => {
  assert.equal(manifest.resources.workers,1);assert.equal(manifest.resources.parallelChunks,false);
  assert.equal(manifest.resources.perChunkSeconds,180);assert.equal(manifest.resources.maximumAggregateSeconds,720);
  assert.ok(manifest.resources.expectedRetainedBytes < manifest.resources.oneDriveThresholdBytes);
  for (const [path,hash] of Object.entries(manifest.sourceCodePins))assert.equal(sha(join(root,path)),hash,path);
  const paths=[...['prepare-core.py','verify-retained.py','run-series.py','prepare-series.py'].map(name=>join(base,name)),...manifest.chunks.flatMap(chunk => ['supervise.py','reconcile-retained.py'].map(name => join(chunk.directory,name)))];
  const py=spawnSync('/usr/bin/python3',['-I','-B','-c','import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(),filename=p) for p in sys.argv[1:]]',...paths],{encoding:'utf8',timeout:10000});
  assert.equal(py.status,0,py.stderr);
  for (const chunk of manifest.chunks) {
    for (const name of ['run-live.mjs', 'live-check.test.mjs']) {
      const js=spawnSync(process.execPath,['--check',join(chunk.directory,name)],{encoding:'utf8',timeout:10000});
      assert.equal(js.status,0,js.stderr);
    }
  }

});


test('an incomplete prior proof or unresolved cleanup refuses successor freezing before writes', async(t) => {
  const scratch=await mkdtemp(join(tmpdir(),'f70-core-proof-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const fixtureBase=join(scratch,'repo/docs/gcsp/evidence/fucq59/continuation');
  const target=join(fixtureBase,'../next');const previous=join(fixtureBase,'../first');
  await mkdir(fixtureBase,{recursive:true});await mkdir(target,{recursive:true});await mkdir(previous,{recursive:true});
  const save=(path,value)=>writeFile(path,JSON.stringify(value));
  await writeFile(join(fixtureBase,'prepare-core.py'),readFileSync(join(base,'prepare-core.py')));
  const template={modelRegistration:{}};await save(join(target,'template.json'),template);
  await save(join(previous,'execution-plan.json'),{});await save(join(previous,'receipt.json'),{reason:'queue-exhausted',checkpointSha256:createHash('sha256').update('{}').digest('hex')});
  for(const name of ['collector-checkpoint.json','final-canonical-index.json','final-spent-request-index.json'])await save(join(previous,name),{});
  await save(join(previous,'checkpoint-export.json'),{checkpointSha256:sha(join(previous,'collector-checkpoint.json'))});
  const fixtureManifest={modelRegistration:{},sourceCodePins:{},first32Directory:previous,first32ExecutionPlanSha256:sha(join(previous,'execution-plan.json')),chunks:[{directory:target,runtimePins:{},planTemplatePath:'docs/gcsp/evidence/fucq59/next/template.json',planTemplateSha256:sha(join(target,'template.json')),planDigest:digest(template)}]};
  await save(join(fixtureBase,'continuation-plan.json'),fixtureManifest);
  for(const cause of ['checks','cleanup']){
    const proof={retainedChecks:{summary:{tests:5,pass:cause==='checks'?4:5,fail:cause==='checks'?1:0,skipped:0}},primarySha256:sha(join(previous,'collector-checkpoint.json')),finalCanonicalIndexSha256:sha(join(previous,'final-canonical-index.json')),finalSpentRequestIndexSha256:sha(join(previous,'final-spent-request-index.json')),cleanup:{scratch_absent:true,dependency_link_absent:true,groups_absent:cause!=='cleanup',reservation_absent:true}};
    await save(join(previous,'live-validation.json'),proof);
    const child=spawnSync('/usr/bin/python3',['-I','-B',join(fixtureBase,'prepare-core.py'),'1'],{encoding:'utf8',timeout:10000});
    assert.notEqual(child.status,0);assert.match(child.stderr,/AssertionError/);
    for(const name of ['collection-plan.json','prior-canonical-index.json','spent-request-index.json','execution-plan.json','execution-once.json'])assert.equal(existsSync(join(target,name)),false,name);
  }
});


test('series runner refuses a missing parent grant before marker, source stage or output allocation',()=>{
  const allocation=read(join(base,'series-plan.json'));assert.equal(allocation.candidateAllowance,111);assert.equal(allocation.attemptAllowance,127);
  assert.deepEqual(allocation.chunks,[1,2,3,4]);assert.deepEqual(allocation.deferredChunks,[5,6]);
  for(const [path,hash]of Object.entries(allocation.codePins))assert.equal(sha(join(root,path)),hash,path);
  const environment={...process.env};delete environment.F70_CORE_SERIES_SOURCE_GRANT;
  const child=spawnSync('/usr/bin/python3',['-I','-B',join(base,'run-series.py')],{encoding:'utf8',env:environment,timeout:10000,maxBuffer:65536});
  assert.notEqual(child.status,0);assert.match(child.stderr,/explicit-parent-series-traffic-grant-required/);
  assert.equal(existsSync(join(base,'series-once.json')),false);assert.equal(existsSync(allocation.supervisorOutput),false);
});
