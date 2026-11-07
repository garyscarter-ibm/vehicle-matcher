// Extract only the two exact production functions; do not evaluate application/module startup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,open,rm} from 'node:fs/promises';
import vm from 'node:vm';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export async function project(plan,{setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,AbortControllerImpl=AbortController}={}){
 const text=await readFile(plan.productionSource.path,'utf8');assert.equal(hash(text),plan.productionSource.sha256);
 const begin=text.indexOf(plan.exactExtraction.start),end=text.indexOf(plan.exactExtraction.endBefore,begin);assert.ok(begin>=0&&end>begin);const download=text.slice(begin,end);assert.equal(hash(download),plan.functionSha256);
 const approvalText=await readFile(plan.approvalSource.path,'utf8');assert.equal(hash(approvalText),plan.approvalSource.sha256);const a=approvalText.indexOf('export function approvedAssetUrl('),z=approvalText.indexOf('\nexport function validateRelease(',a);assert.ok(a>=0&&z>a);const approved=approvalText.slice(a,z);assert.equal(hash(approved),plan.approvalFunctionSha256);const empty=approvalText.match(/^export const EMPTY_SHA256 = '[a-f0-9]{64}';$/m)?.[0];assert.ok(empty);assert.equal(hash(empty),plan.emptyConstantSha256);
 const context=vm.createContext({URL,Buffer,createHash,open,rm,AbortController:AbortControllerImpl,setTimeout:setTimeoutImpl,clearTimeout:clearTimeoutImpl,fetch:()=>{throw Error('Uninjected network forbidden');}});
 return vm.runInContext([empty,approved,download].map(s=>s.replace(/^export /,'')).join('\n')+'\ndownloadAsset;',context,{filename:'exact-production-downloadAsset-projection.js',timeout:1000});
}
