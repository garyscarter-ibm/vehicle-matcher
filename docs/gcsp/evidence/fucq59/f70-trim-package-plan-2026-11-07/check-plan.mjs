// Pure plan checks. No source session, HTTP implementation or source grant.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { validateBmwBatchPlan, bmwPublicRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));const base=fileURLToPath(new URL('./',import.meta.url));
const read=p=>JSON.parse(readFileSync(p));const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const plan=read(join(base,'plan.json'));const manifest=read(join(base,'candidate-manifest.json'));
assert.equal(sha(join(base,'candidate-manifest.json')),plan.candidateManifestSha256);assert.equal(existsSync(plan.outputRoot),false);
for(const [p,h]of Object.entries(manifest.sourceCodePins))assert.equal(sha(join(root,p)),h);
const known=read(manifest.priorCanonicalIndex.path);const spent=read(manifest.spentRequestIndex.path);
assert.equal(sha(manifest.priorCanonicalIndex.path),manifest.priorCanonicalIndex.sha256);
assert.equal(sha(manifest.spentRequestIndex.path),manifest.spentRequestIndex.sha256);
assert.equal(known.entries.length,872);assert.equal(spent.entries.length,1582);
const prior=new Set(spent.entries.map(e=>e.requestDigest));const seen=new Set();let candidates=0,gets=0;
for(const chunk of plan.chunks){
 const path=join(root,chunk.templatePath);assert.equal(sha(path),chunk.templateSha256);const template=read(path);
 assert.equal(inputDigest(template),chunk.planDigest);validateBmwBatchPlan(template);candidates+=template.candidateCount;gets+=chunk.maximumGets;
 assert.equal(template.limits.sourceAttempts,template.candidateCount+4);
 for(const candidate of template.candidates){
  const digest=inputDigest({modelRegistration:template.modelRegistration,request:candidate.request});assert.equal(prior.has(digest),false);assert.equal(seen.has(digest),false);seen.add(digest);
  assert.equal(candidate.candidateId,'candidate-'+digest.slice(0,24));
  const claim=manifest.candidates.find(c=>c.candidateId===candidate.candidateId);assert.ok(claim);assert.equal(claim.requestDigest,digest);assert.equal(inputDigest(claim.request),inputDigest(candidate.request));
  assert.equal(candidate.request.includedElements.includes('S043U'),true);assert.equal(candidate.request.includedElements.filter(c=>['S07EV','S07EW'].includes(c)).length,1);
  assert.deepEqual(candidate.request.mandatoryElements,['S033B']);
  const url=new URL(bmwPublicRequestUrls(template.modelRegistration,candidate.request).solve);
  assert.equal(url.searchParams.get('mandatory-elements'),'S033B');assert.equal(url.searchParams.get('included-elements'),candidate.request.includedElements.join(','));
  assert.equal(claim.unverifiedSetDeltaForecast.alreadyCanonical,false);
 }
}
assert.equal(candidates,260);assert.equal(gets,296);assert.equal(plan.chunks[0].candidates,8);assert.equal(plan.chunks.slice(1).reduce((n,c)=>n+c.candidates,0),252);
assert.equal(manifest.forecast.guaranteedNewAdmissions,0);assert.equal(plan.capacityCreditBeforeSource,0);
assert.equal(manifest.observedAxisOutcomes.S07EV.accepted,130);assert.equal(manifest.observedAxisOutcomes.S07EW.accepted,130);assert.equal(manifest.observedAxisOutcomes.S043U.accepted,130);
console.log(JSON.stringify({status:'scoped-plan-checks-passed',exactUnspentRequests:260,pilotRequests:8,pilotMaximumGets:12,continuationRequests:252,maximumSeriesGets:296,sourceTraffic:0,capacityCredit:0,sourceGrant:false}));
