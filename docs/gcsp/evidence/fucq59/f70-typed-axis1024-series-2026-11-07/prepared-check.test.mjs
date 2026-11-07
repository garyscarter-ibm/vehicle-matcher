/** Exact finite preparation and retained-path fixtures. Zero HTTP or source grants. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {mkdtemp, mkdir, writeFile, rm, symlink, readdir, unlink} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {inputDigest} from '../../../../../server/gcsp/repository/core.js';
import {validateBmwBatchPlan} from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
const base=dirname(fileURLToPath(import.meta.url));
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest=read(join(base,'candidate-manifest.json'));
const series=read(join(base,'series-plan.json'));
const encode=v=>JSON.stringify(v)+'\n';

test('1024 exact unspent requests use130 actual admitted core selections and seven directly typed optional codes',()=>{
  assert.equal(manifest.actualCoreSelections.length,130);assert.equal(manifest.candidateProvenance.length,1024);
  const definitions=new Map(read(join(root,manifest.actualTypedBasis.optionsPath)).report.candidates[0].definitions.map(r=>[r.code,r]));
  const cores=new Map(manifest.actualCoreSelections.map(r=>[r.configurationId,r]));
  const basis=new Map(manifest.candidateProvenance.map(r=>[r.candidateId,r]));
  const spent=new Set(read(join(manifest.baselineDirectory,'final-spent-request-index.json')).entries.map(r=>r.requestDigest));
  const seen=new Set();const added=new Set();
  for(const core of cores.values()){
    assert.equal(sha(join(root,core.sourcePrimary)),core.sourcePrimarySha256);
    const state=read(join(root,core.sourcePrimary)).content;
    assert.ok(state.accepted.some(r=>r.configurationId===core.configurationId));
    assert.ok(state.sourceCaptures.some(r=>r.candidateId===core.candidate.candidateId&&r.solver.sha256===core.solverSha256));
  }
  for(const entry of manifest.chunks){
    const plan=read(join(root,entry.templatePath));validateBmwBatchPlan(plan);
    assert.equal(sha(join(root,entry.templatePath)),entry.templateSha256);assert.equal(inputDigest(plan),entry.planDigest);
    assert.equal(plan.candidates.length,32);assert.equal(plan.limits.sourceAttempts,36);
    for(const candidate of plan.candidates){
      const provenance=basis.get(candidate.candidateId);const core=cores.get(provenance.actualCoreConfigurationId);
      const requestDigest=inputDigest({modelRegistration:plan.modelRegistration,request:candidate.request});
      assert.equal(requestDigest,provenance.requestDigest);assert.equal(seen.has(requestDigest),false);seen.add(requestDigest);
      assert.equal(spent.has(requestDigest),false);assert.equal(entry.requestDigests.includes(requestDigest),true);
      assert.deepEqual(candidate.request.includedElements,[...new Set([...core.candidate.request.includedElements,...provenance.addedTypedCodes])].sort());
      assert.deepEqual(candidate.request.mandatoryElements,['S033B']);assert.equal(candidate.request.includedElements.includes('S01H0'),false);
      for(const code of candidate.request.includedElements)assert.deepEqual(definitions.get(code)?.issues,[]);
      for(const code of provenance.addedTypedCodes){added.add(code);assert.ok(['trim','transmission','package'].includes(definitions.get(code).optionType));}
    }
  }
  assert.equal(seen.size,1024);assert.deepEqual([...added].sort(),['S02TE','S02TF','S043T','S043U','S043Z','S07EV','S07EW']);
});

test('one sequential reviewed budget uses direct OneDrive output and all scripts parse',()=>{
  assert.equal(series.candidateAllowance,1024);assert.equal(series.attemptAllowance,1152);assert.equal(series.chunks.length,32);
  assert.equal(series.maximumWallSeconds,1800);assert.equal(series.resources.workers,1);assert.equal(series.resources.parallelChunks,false);
  assert.equal(series.resources.perChunkHostRamBytes,536870912);assert.equal(series.resources.perChunkChildRamBytes,469762048);
  assert.equal(series.resources.perChunkRetainedShardBytes,33554432);assert.ok(series.resources.expectedRetainedBytes>=268435456);
  assert.match(series.outputRoot,/^\/Users\/usget\/Library\/CloudStorage\/OneDrive-IBM\/Claude\/vehicle-matcher\//);
  assert.equal(existsSync(series.outputRoot),false);assert.equal(existsSync(series.outputOwnershipManifest),false);
  for(const [path,hash]of Object.entries(series.codePins))assert.equal(sha(join(root,path)),hash,path);
  const python=['prepare-chunk.py','prepare-series.py','run-series.py','supervise.py','reconcile-retained.py','verify-retained.py'].map(n=>join(base,n));
  const result=spawnSync('/usr/bin/python3',['-I','-B','-c','import ast,pathlib,sys;[ast.parse(pathlib.Path(p).read_text(),filename=p) for p in sys.argv[1:]]',...python],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  for(const name of ['run-live.mjs','live-check.test.mjs']){const result=spawnSync(process.execPath,['--check',join(base,name)],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);}
});

test('missing parent release refuses series before marker, output ownership or source allocation',()=>{
  const environment={...process.env};delete environment.F70_TYPED_AXIS_SERIES_SOURCE_GRANT;
  const result=spawnSync('/usr/bin/python3',['-I','-B',join(base,'run-series.py')],{encoding:'utf8',env:environment,timeout:10000,maxBuffer:65536});
  assert.notEqual(result.status,0);assert.match(result.stderr,/explicit-parent-series-traffic-grant-required/);
  for(const path of [join(base,'series-once.json'),series.outputRoot,series.outputOwnershipManifest])assert.equal(existsSync(path),false,path);
});

test('incomplete predecessor checks or unresolved retained cleanup refuse next chunk before output writes',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'axis1024-gate-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const code=join(scratch,'repo/docs/gcsp/evidence/fucq59/code');const previous=join(scratch,'previous');const target=join(scratch,'output/chunks/chunk01');
  await mkdir(code,{recursive:true});await mkdir(previous,{recursive:true});await writeFile(join(code,'prepare-chunk.py'),readFileSync(join(base,'prepare-chunk.py')));
  const entry={outputDirectory:target};const fixtureManifest={chunks:[entry],baselineDirectory:previous};
  await writeFile(join(code,'candidate-manifest.json'),encode(fixtureManifest));
  const fixtureSeries={id:'fixture-only-no-source',chunks:[entry],codePins:{},candidateManifestSha256:sha(join(code,'candidate-manifest.json'))};
  await writeFile(join(code,'series-plan.json'),encode(fixtureSeries));
  for(const name of ['collector-checkpoint.json','final-canonical-index.json','final-spent-request-index.json'])await writeFile(join(previous,name),'{}');
  const primary=sha(join(previous,'collector-checkpoint.json'));await writeFile(join(previous,'receipt.json'),encode({reason:'queue-exhausted',checkpointSha256:primary}));
  await writeFile(join(previous,'checkpoint-export.json'),encode({checkpointSha256:primary}));
  for(const cause of ['checks','retained-cleanup']){
    const cleanup={scratch_absent:true,dependency_link_absent:true,groups_absent:true,reservation_absent:true,code_identity_unchanged:true};
    const proof={retainedChecks:{summary:{tests:5,pass:cause==='checks'?4:5,fail:cause==='checks'?1:0,skipped:0}},primarySha256:primary,finalCanonicalIndexSha256:primary,finalSpentRequestIndexSha256:primary,cleanup,retainedCleanup:{...cleanup,groups_absent:cause!=='retained-cleanup'}};
    await writeFile(join(previous,'live-validation.json'),encode(proof));
    const result=spawnSync('/usr/bin/python3',['-I','-B',join(code,'prepare-chunk.py'),'1'],{encoding:'utf8',env:{...process.env,F70_TYPED_AXIS_SERIES_STAGE:fixtureSeries.id},timeout:10000});
    assert.notEqual(result.status,0);assert.match(result.stderr,/AssertionError/);assert.equal(existsSync(target),false);
  }
});

test('verified predecessor freezes exact external inputs once and preserves them on a repeated freeze',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'axis1024-freeze-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const fixtureRoot=join(scratch,'repo');const code=join(fixtureRoot,'docs/gcsp/evidence/fucq59/code');
  const output=join(scratch,'output');const target=join(output,'chunks/chunk01');
  await mkdir(code,{recursive:true});await mkdir(output,{recursive:true});
  await writeFile(join(code,'prepare-chunk.py'),readFileSync(join(base,'prepare-chunk.py')));
  const actualEntry=series.chunks[0];const entry={...actualEntry,templatePath:'template.json',outputDirectory:target};
  await writeFile(join(fixtureRoot,'template.json'),readFileSync(join(root,actualEntry.templatePath)));
  await symlink(join(root,manifest.actualTypedBasis.optionsPath),join(fixtureRoot,'options.json'));
  const fixtureManifest={...manifest,chunks:[entry],actualTypedBasis:{...manifest.actualTypedBasis,optionsPath:'options.json'}};
  await writeFile(join(code,'candidate-manifest.json'),encode(fixtureManifest));
  const fixtureSeries={id:'fixture-only-no-source',chunks:[entry],codePins:{},candidateManifestSha256:sha(join(code,'candidate-manifest.json')),outputRoot:output};
  await writeFile(join(code,'series-plan.json'),encode(fixtureSeries));await writeFile(join(output,'output-ownership.json'),encode({allocationId:fixtureSeries.id}));
  const freeze=()=>spawnSync('/usr/bin/python3',['-I','-B',join(code,'prepare-chunk.py'),'1'],{encoding:'utf8',env:{...process.env,F70_TYPED_AXIS_SERIES_STAGE:fixtureSeries.id},timeout:10000});
  const result=freeze();assert.equal(result.status,0,result.stderr);
  const allocation=read(join(target,'execution-plan.json'));assert.equal(allocation.id,fixtureSeries.id+'-chunk01');
  for(const [path,hash]of Object.entries(allocation.inputPins))assert.equal(sha(path),hash,path);
  assert.deepEqual(read(join(target,'collection-plan.json')),read(join(root,actualEntry.templatePath)));
  assert.equal(read(join(target,'prior-canonical-index.json')).entries.length,482);assert.equal(read(join(target,'spent-request-index.json')).entries.length,558);
  assert.equal(read(join(target,'execution-reservation.json')).executionPlanSha256,sha(join(target,'execution-plan.json')));
  const original=sha(join(target,'execution-plan.json'));const repeated=freeze();assert.notEqual(repeated.status,0);assert.equal(sha(join(target,'execution-plan.json')),original);
  assert.equal(existsSync(join(target,'execution-once.json')),false);assert.equal(existsSync(join(target,'collector-checkpoint.json')),false);
});
