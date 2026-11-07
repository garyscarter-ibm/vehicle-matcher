// Recreate exact local bytes after public proof; no repeated public/source traffic.
import assert from 'node:assert/strict';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packFleetRelease } from '../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import { rebuildFleetDot5 } from './rebuild-fleet-dot5.mjs';
const output=process.argv[2];const scratch=process.env.TMPDIR;
const rebuilt=await rebuildFleetDot5(scratch);await mkdir(join(scratch,'cache'));
const packed=await packFleetRelease({releaseId:rebuilt.manifestDigest,store:rebuilt.isolatedStore,output:join(scratch,'cache')});
assert.equal(packed.files,20);assert.equal(packed.bytes,26096498);
await rename(rebuilt.isolatedStore,join(scratch,'restored'));
await rm(rebuilt.candidate,{recursive:true});await rm(join(scratch,'new-configurations.jsonl'));
await writeFile(join(output,'local-recovery-inputs.json'),JSON.stringify({status:'exact-local-cache-ready-public-evidence-reused',releaseId:rebuilt.manifestDigest,
 files:packed.files,bytes:packed.bytes,sourceStoreUnchanged:rebuilt.sourceStoreUnchanged,providerEgress:rebuilt.egress.externalCalls,
 publicNetworkRepeated:false,previousPublicReceipts:'../download/download-receipt.json and offline-restart-receipt.json'},null,2)+'\n');
console.log(JSON.stringify({status:'exact-local-recovery-cache-ready',files:20,bytes:26096498}));
