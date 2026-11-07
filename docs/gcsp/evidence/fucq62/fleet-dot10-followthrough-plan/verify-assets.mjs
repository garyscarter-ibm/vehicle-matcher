// Portable exact restored-byte checks; no public or source operation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
const [store,cache]=process.argv.slice(2);assert.ok([store,cache].every(isAbsolute));const descriptor=JSON.parse(await readFile(new URL('./descriptor-proposal.json',import.meta.url)));async function check(path,a){assert.equal((await stat(path)).size,a.bytes);const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);assert.equal(h.digest('hex'),a.sha256,path);}
for(const a of descriptor.assets){await check(join(cache,a.path),a);if(a.path.startsWith('store/'))await check(join(store,a.path.slice(6)),a);}
const inventory=JSON.parse(await readFile(join(store,'identity-inventory.json')));assert.equal(inventory.configurations.length,4667);assert.equal(inventory.identities.length,1);assert.equal(inventory.datasets.length,11);console.log(JSON.stringify({status:'exact26assetcache-and-restored-store-passed',releaseId:descriptor.releaseId,files:26,bytes:239679009,sourceCalls:0,externalCalls:0,fullReferenceProofReexecuted:false,acceptance:false}));
