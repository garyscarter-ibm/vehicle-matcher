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

test('external output routing runs all five strict checks on actual32 data and a zero-admission synthetic projection',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'axis1024-retained-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const fixtureRoot=join(scratch,'repo');const code=join(fixtureRoot,'docs/gcsp/evidence/fucq59/code');const output=join(scratch,'external/chunk01');
  await mkdir(code,{recursive:true});await mkdir(output,{recursive:true});
  for(const name of ['server','scripts'])await symlink(join(root,name),join(fixtureRoot,name),'dir');
  await writeFile(join(code,'live-check.test.mjs'),readFileSync(join(base,'live-check.test.mjs')));
  await writeFile(join(code,'series-plan.json'),encode({chunks:[{outputDirectory:output}]}));
  const actual=join(root,'docs/gcsp/evidence/fucq59/f70-1f7e-core01-solver-2026-11-07');
  for(const name of await readdir(actual))await symlink(join(actual,name),join(output,name));
  await unlink(join(output,'execution-plan.json'));const allocation=read(join(actual,'execution-plan.json'));allocation.codePins={};allocation.inputPins={};await writeFile(join(output,'execution-plan.json'),encode(allocation));
  const check=()=>{
    const environment={...process.env,F70_TYPED_AXIS_CHECK_CHUNK:'1'};delete environment.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',join(code,'live-check.test.mjs')],{encoding:'utf8',env:environment,timeout:15000,maxBuffer:131072});
  };
  const actualResult=check();assert.equal(actualResult.status,0,actualResult.stdout+actualResult.stderr);assert.match(actualResult.stdout,/# pass 5/);
  const envelope=read(join(actual,'collector-checkpoint.json'));const plan=read(join(actual,'collection-plan.json'));const state=envelope.content;
  state.accepted=[];state.records=[];state.sourceCaptures=[];state.duplicates=[];state.rejected=plan.candidates.map(r=>({candidateId:r.candidateId,code:'synthetic-not-constructible'}));
  envelope.contentDigest=inputDigest(state);const bytes=encode(envelope);const checkpoint=createHash('sha256').update(bytes).digest('hex');
  const receipt=read(join(actual,'receipt.json'));Object.assign(receipt,{checkpointSha256:checkpoint,newlyAccepted:0,rejected:32,status:'incomplete'});
  const exported=read(join(actual,'checkpoint-export.json'));Object.assign(exported,{checkpointSha256:checkpoint,accepted:0,sourceCaptures:0});
  for(const [name,bytes]of Object.entries({'collector-checkpoint.json':encode(envelope),'collector-state.json':encode(envelope),'accepted.jsonl':'','receipt.json':encode(receipt),'checkpoint-export.json':encode(exported),'final-canonical-index.json':readFileSync(join(actual,'prior-canonical-index.json'))})){
    await unlink(join(output,name));await writeFile(join(output,name),bytes);
  }
  const rejectedResult=check();assert.equal(rejectedResult.status,0,rejectedResult.stdout+rejectedResult.stderr);assert.match(rejectedResult.stdout,/# pass 5/);
});
