// Offline proof preparation. This module confers no execution/publication authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile,stat,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PolicyService,FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import {sourceRegistrations} from '../fleet-dot11-8051-external-plan/source-registrations.mjs';
import { releaseLimits } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const requestKey=r=>hash(JSON.stringify([r.kind,r.id]));
export async function sha(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
export async function check(pin){assert.equal((await stat(pin.path)).size,pin.bytes);assert.equal(await sha(pin.path),pin.sha256);}
export async function packet(){
 assert.match(process.env.TMPDIR||'',/\/test-stamp-shard-[a-f0-9]+$/);
 const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));await check(plan.candidatePlan);await check(plan.candidateReceipt);for(const pin of plan.codePins)await check(pin);
 const candidate=JSON.parse(await readFile(plan.candidatePlan.path));const receiptPath=join(candidate.outputRoot,'candidate-receipt.json');assert.match(process.env.CANDIDATE_RECEIPT_SHA256||'',/^[a-f0-9]{64}$/);assert.equal(await sha(receiptPath),process.env.CANDIDATE_RECEIPT_SHA256);
 const receipt=JSON.parse(await readFile(receiptPath));assert.equal(receipt.status,'offline-candidate-validated');assert.equal(receipt.candidateManifestDigest,plan.expectedManifestDigest);assert.equal(receipt.previousManifestDigest,candidate.baseline.manifestDigest);assert.equal(receipt.counts.configurations,8052);assert.equal(receipt.counts.sourceConfigurations,8051);for(const pin of receipt.files)await check(pin);
 assert.equal(receipt.candidateManifestDigest,receipt.files.find(p=>p.name==='manifest.json').sha256);
 const jsonlLimits=Object.freeze({maxBytes:268435456,maxRowBytes:1048576,maxRows:100000});
 const manifest=JSON.parse(await readFile(receipt.files.find(p=>p.name==='manifest.json').path));const registrations=await sourceRegistrations([...candidate.priorSources,...candidate.reusedSourceShards],manifest.signaturePolicy);assert.equal(registrations.length,8050);
 const options={sourceRegistrations:registrations,indexed:true,jsonlLimits,approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:digest=>digest===plan.expectedManifestDigest?jsonlLimits:releaseLimits(digest),policyService:new PolicyService({provider:new FilePolicyProvider()}),policyRead:{runId:'dot11-owned-offline-proof',asOf:'2026-11-07T00:00:00.000Z'}};
 return {plan,candidate,receipt,output:candidate.outputRoot,store:join(candidate.outputRoot,'isolated-store'),artifacts:join(candidate.outputRoot,'candidate'),options};
}
export async function save(output,name,value){await writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
export function requests(rows){const all=[...rows.configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of rows.vins.metadataEntries())all.push({kind:'vin',id:e.vin17});assert.equal(all.length,8053);assert.equal(new Set(all.map(requestKey)).size,8053);return all;}
