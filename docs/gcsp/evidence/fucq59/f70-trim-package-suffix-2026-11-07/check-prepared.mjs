/** Exact frozen suffix, actual pilot novelty and current runtime; zero source traffic. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inputDigest} from '../../../../../server/gcsp/repository/core.js';
import {validatePublicBmwPlan} from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import {bmwPublicRequestUrls,bmwBatchPlanRequestUrls} from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
globalThis.fetch=async()=>{throw new Error('forbidden-suffix-preparation-traffic')};
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(p));const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const series=read(join(base,'series-plan.json'));
for(const[p,h]of Object.entries(series.codePins))assert.equal(sha(join(root,p)),h,p);
assert.equal(sha(join(base,'candidate-manifest.json')),series.candidateManifestSha256);
const prior=series.baselineDirectory,proof=read(join(prior,'live-validation.json')),state=read(join(prior,'collector-checkpoint.json')).content;
assert.equal(sha(join(prior,'live-validation.json')),series.baselineProofSha256);assert.equal(proof.retainedChecks.summary.pass,5);
assert.equal(proof.retainedChecks.summary.fail,0);assert.equal(proof.retainedChecks.summary.skipped,0);
assert.equal(state.accepted.length,8);assert.equal(state.duplicates.length,0);assert.equal(state.rejected.length,0);
const axis={S07EV:0,S07EW:0};
for(const row of state.accepted){assert.ok(row.resolvedOptions.includes('S043U'));const pack=row.resolvedOptions.filter(c=>['S07EV','S07EW'].includes(c));assert.equal(pack.length,1);axis[pack[0]]++;}
assert.deepEqual(axis,{S07EV:4,S07EW:4});
const canonical=read(join(prior,'final-canonical-index.json')),spent=read(join(prior,'final-spent-request-index.json'));
assert.equal(canonical.entries.length,884);assert.equal(canonical.entries.filter(r=>r.origins.some(o=>o.kind==='admitted-source')).length,881);assert.equal(spent.entries.length,1594);
const used=new Set(spent.entries.map(r=>r.requestDigest)),seen=new Set();let candidates=0,gets=0;
for(const entry of series.chunks){
 const path=join(root,entry.templatePath);assert.equal(sha(path),entry.templateSha256);const plan=read(path);validatePublicBmwPlan(plan);assert.equal(inputDigest(plan),entry.planDigest);
 assert.equal(plan.qualificationDate,new Date().toISOString().slice(0,10));assert.equal(plan.source.version,'f59-batch-20261107.v1');assert.equal(plan.lineRegistration,undefined);
 assert.equal(existsSync(entry.outputDirectory),false);assert.equal(plan.candidateCount,entry.candidates);assert.equal(plan.limits.sourceAttempts,entry.maximumGets);assert.equal(plan.limits.maxAttempts,1);
 assert.deepEqual(plan.candidates.map(c=>inputDigest({modelRegistration:plan.modelRegistration,request:c.request})),entry.requestDigests);
 for(const c of plan.candidates){const d=inputDigest({modelRegistration:plan.modelRegistration,request:c.request});assert.equal(used.has(d)||seen.has(d),false);seen.add(d);
  assert.ok(c.request.includedElements.includes('S043U'));assert.equal(c.request.includedElements.filter(c=>['S07EV','S07EW'].includes(c)).length,1);assert.deepEqual(c.request.mandatoryElements,['S033B']);
  assert.deepEqual(bmwBatchPlanRequestUrls(plan,c.request),bmwPublicRequestUrls(plan.modelRegistration,c.request));}
 candidates+=plan.candidateCount;gets+=entry.maximumGets;
}
assert.equal(candidates,252);assert.equal(gets,284);assert.equal(series.sameOriginal900SecondClock,true);assert.equal(existsSync(join(series.outputRoot,'suffix-once.json')),false);
console.log(JSON.stringify({status:'prepared-only',sourceTraffic:0,unspentSuffixRequests:candidates,suffixMaximumGets:gets,wholeSeriesMaximumGets:296,baseline:{canonical:884,admitted:881,spent:1594},pilotActualNovelty:axis,originalClockPreserved:true,sourceGrant:false,capacityCredit:0}));
