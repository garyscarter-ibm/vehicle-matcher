/** Exact refreshed release inputs only. Zero HTTP, grant or mutations. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateBmwBatchPlan,bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async p=>JSON.parse(await readFile(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const series=await read(join(base,'series-plan.json'));assert.equal(series.baseRefreshRequired,false,'fresh-parent-audited-base-required');
const manifest=await read(join(base,'candidate-manifest.json'));assert.equal(sha(await readFile(join(base,'candidate-manifest.json'))),series.candidateManifestSha256);assert.deepEqual(series.chunks,manifest.chunks);
for(const [p,h]of Object.entries({...series.codePins,...series.sourcePins}))assert.equal(sha(await readFile(join(root,p))),h,p);
for(const [p,h]of Object.entries(series.runtimePins))assert.equal(sha(await readFile(p)),h);
for(const pin of Object.values(series.indexPins))assert.equal(sha(await readFile(pin.path)),pin.sha256);
assert.equal(sha(await readFile(series.parentPilotAudit.path)),series.parentPilotAudit.sha256);
const canonical=await read(series.indexPins.canonical.path),spent=await read(series.indexPins.spent.path),used=new Set(spent.entries.map(r=>r.requestDigest));
assert.equal(canonical.entries.length,series.baseline.canonical);assert.equal(canonical.entries.filter(r=>r.origins.some(o=>o.kind==='admitted-source')).length,series.baseline.admittedSource);assert.equal(spent.entries.length,series.baseline.spent);assert.equal(used.size,spent.entries.length);
const requests=[];let gets=0;
for(const chunk of series.chunks){const plan=await read(join(root,chunk.templatePath));validateBmwBatchPlan(plan);assert.equal(sha(await readFile(join(root,chunk.templatePath))),chunk.templateSha256);assert.equal(inputDigest(plan),chunk.planDigest);assert.equal(plan.candidateCount,8);gets+=chunk.maximumGets;for(const c of plan.candidates){const digest=inputDigest({modelRegistration:plan.modelRegistration,request:c.request});assert.equal(used.has(digest),false);assert.ok(bmwBatchPlanRequestUrls(plan,c.request).solve);requests.push(digest);}}
assert.equal(series.chunks.length,120);assert.equal(requests.length,960);assert.equal(new Set(requests).size,960);assert.deepEqual(requests,manifest.requestDigests);assert.equal(gets,1440);assert.equal(series.sourceGrant,false);assert.equal(series.acceptance,false);
console.log(JSON.stringify({scope:'scoped exact refreshed release metadata; no source traffic',seriesPlanSha256:sha(await readFile(join(base,'series-plan.json'))),candidateManifestSha256:series.candidateManifestSha256,baseline:series.baseline,indexPins:series.indexPins,codePins:Object.keys(series.codePins).length,sourcePins:Object.keys(series.sourcePins).length,solver:960,GET:1440,sourceTraffic:0,sourceGrant:false,requiresSeparateExactParentRelease:true}));
