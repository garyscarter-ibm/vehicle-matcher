import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../../../../../',import.meta.url));export const base=fileURLToPath(new URL('./',import.meta.url));
export const hash=b=>createHash('sha256').update(b).digest('hex');
export async function sha(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
export const read=async p=>JSON.parse(await readFile(p));export const save=(output,name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export async function check(pin){assert.equal((await stat(pin.path)).size,pin.bytes);assert.equal(await sha(pin.path),pin.sha256,pin.path);}
export async function context(phase){
 const planPath=join(base,'plan.json');const plan=await read(planPath);assert.equal(await sha(planPath),process.env.REVIEWED_PLAN_SHA256);assert.ok(isAbsolute(process.env.PHASE_OUTPUT||''));assert.match(process.env.TMPDIR||'',/\/test-stamp-shard-[a-f0-9]+$/);const grant=await read(process.env.ROOT_RELEASE_PATH);assert.equal(grant.authorized,true);assert.equal(grant.phase,phase);assert.equal(grant.planSha256,process.env.REVIEWED_PLAN_SHA256);assert.equal(grant.releaseId,plan.releaseId);for(const [path,digest] of Object.entries(plan.codePins))assert.equal(await sha(join(root,path)),digest,path);
 await check(plan.offlineSummary);await check(plan.candidateReceipt);await check(plan.descriptorReceipt);const offline=await read(plan.offlineSummary.path);assert.equal(offline.manifestDigest,plan.releaseId);assert.equal(offline.exactRequestUnion,true);assert.equal(offline.consumerErrors,1313);assert.equal(offline.directErrors+offline.httpErrors,0);assert.equal(offline.acceptance,false);
 const descriptorPath=join(base,'descriptor-proposal.json');assert.equal(await sha(descriptorPath),plan.descriptor.sha256);const descriptor=await read(descriptorPath);assert.equal(descriptor.assets.length,26);assert.equal(descriptor.sources.length,15);assert.equal(descriptor.assets.reduce((n,a)=>n+a.bytes,0),plan.expected.bytes);assert.ok(plan.expected.bytes<=plan.network.maxPayloadBytes);return {plan,grant,descriptor,output:process.env.PHASE_OUTPUT};
}
