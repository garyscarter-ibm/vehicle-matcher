// Existing strict verifier retains real consumer errors; this receipt never waives them.
import assert from 'node:assert/strict';
import { verifyActiveFleet } from '../../../../../scripts/gcsp/verify-fleet.mjs';
import { packet,save } from './common.mjs';
const p=await packet();const report=await verifyActiveFleet({root:p.store,requiredDistinct:2424,offline:true,http:false,concurrency:1,sampleSize:1,...p.options});
await save(p.output,'strict-direct-audit-report.json',report);
assert.ok(['verified-active','invalid-active'].includes(report.status));assert.equal(report.audit?.checked,2426,JSON.stringify(report));assert.equal(report.egress?.externalCalls,0);assert.equal(report.egress?.sourceCalls,0);assert.equal(report.manifest?.sha256,p.receipt.candidateManifestDigest);
await save(p.output,'strict-direct-audit-receipt.json',{status:report.status,manifestDigest:p.receipt.candidateManifestDigest,checked:report.audit.checked,errors:report.audit.errors,report,stockScope:'not-supplied; native exact-current-run proof unrun',resultMeaning:report.audit.errors?'Strict direct/consumer acceptance remains failed; exact failures are reconciled by bounded HTTP/consumer chunks.':'Existing strict direct/consumer audit passes for supplied configuration/VIN scope only.',ordinaryPublicationExecuted:false,acceptance:false});
