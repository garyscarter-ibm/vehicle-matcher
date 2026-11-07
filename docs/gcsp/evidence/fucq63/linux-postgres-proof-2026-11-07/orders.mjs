// One Linux CI current run, three retained source configurations, unchanged production ports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createPostgresRepository} from '../../../../../server/gcsp/repository/postgres.js';
import {inputDigest} from '../../../../../server/gcsp/repository/core.js';
import {loadMigrations} from '../../../../../server/gcsp/migrations/index.js';
import {createSyntheticRegistry} from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import {PolicyService,FilePolicyProvider} from '../../../../../server/gcsp/policy/index.js';
import {APPROVED_CORPUS_IMAGES} from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import {releaseLimits} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import {createVehicleEvidenceLookup} from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import {emptyAllocationInventory,allocateSyntheticIdentities,publishStockOrders} from '../../../../../server/gcsp/vehicle-evidence/vin-allocation.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {proveCurrentOrderReferences} from '../order-reference-2026-11-07/prove-orders.mjs';
const require=createRequire(new URL('../../../../../server/package.json',import.meta.url));
const pg=require('pg');
const hash=value=>createHash('sha256').update(value).digest('hex');
const diagnosticEnums=new Set(['ok','not-found','passed','failed','blocked','complete','partial','unavailable','postgresql']);
function assertionValue(prefix,value) {
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 const summary={[`${prefix}Type`]:type};
 if(value===null||value===undefined||typeof value==='boolean')summary[`${prefix}Enum`]=String(value);
 else if(typeof value==='number') {
  if(Number.isSafeInteger(value)&&value>=0)summary[`${prefix}Count`]=value;
  else summary[`${prefix}Enum`]=Number.isFinite(value)?'finite-number':'non-finite-number';
 } else if(typeof value==='string') {
  summary[`${prefix}Count`]=Buffer.byteLength(value);
  if(diagnosticEnums.has(value))summary[`${prefix}Enum`]=value;
 } else if(Array.isArray(value))summary[`${prefix}Count`]=value.length;
 return summary;
}
function summarizeAssertion(error,stage,check) {
 if(error?.name!=='AssertionError')return null;
 const operators=new Set(['strictEqual','deepStrictEqual','match','==','fail']);
 return {stage,check:check||'stage-assertion',operator:operators.has(error.operator)?error.operator:'other',
  ...assertionValue('expected',error.expected),...assertionValue('actual',error.actual)};
}
const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));
const selectionBytes=await readFile(new URL('./selection.json',import.meta.url));
assert.equal(hash(selectionBytes),plan.selectionSha256);
const selection=JSON.parse(selectionBytes).selection;
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
assert.match(process.env.GITHUB_RUN_ID||'',/^\d+$/);assert.match(process.env.GITHUB_RUN_ATTEMPT||'',/^\d+$/);
const owned=resolve(process.env.TMPDIR||'');assert.match(owned,/\/test-stamp-shard-[a-f0-9]+$/);
const output=resolve(process.env.PROOF_OUTPUT||'');assert.ok(output.startsWith(owned+'/'));
const connection=new URL(process.env.GCSP_DATABASE_URL);
assert.equal(connection.protocol,'postgresql:');assert.equal(connection.hostname,'127.0.0.1');
assert.equal(connection.port,'5432');assert.equal(connection.username,'gcsp_ci_fixture');
assert.equal(connection.password,'');assert.equal(connection.pathname,'/gcsp_ci_fixture');assert.equal(connection.search,'');
const suffix=`${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`;
const schema=`f63_ci_${suffix}`;assert.match(schema,/^[a-z_][a-z0-9_]{0,62}$/);
const context={runId:`f63-ci-${suffix}`,environmentId:`f63-ci-environment-${suffix}`,principalId:'ci-proof-presenter',roles:['presenter']};
const pool=new pg.Pool({connectionString:process.env.GCSP_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
let repository;let seedGuard;let schemaOwned=false;let schemaAbsent=true;let stage='initializing';let failure;let result;
let returnedProof;let proofBytes=0;let assertionCheck=null;
const proofEqual=(check,actual,expected)=>{assertionCheck=check;assert.equal(actual,expected);assertionCheck=null;};
try {
 stage='seed-offline-guard';seedGuard=installFleetOfflineGuard();assert.equal(seedGuard.control(),'blocked');
 stage='postgres16-identity';
 const identity=await pool.query("SELECT current_setting('server_version') AS version, current_database() AS database, current_user AS principal");
 assert.match(identity.rows[0].version,/^16\./);assert.equal(identity.rows[0].database,'gcsp_ci_fixture');assert.equal(identity.rows[0].principal,'gcsp_ci_fixture');
 stage='create-owned-schema';await pool.query(`CREATE SCHEMA "${schema}"`);schemaOwned=true;schemaAbsent=false;
 repository=createPostgresRepository({schema});assert.equal((await repository.open()).status,'ok');
 stage='production-three-migration-ledger';
 const migrations=await repository.migrationStatus();assert.equal(migrations.status,'ok');assert.equal(migrations.value.current,true);
 assert.deepEqual(migrations.value.appliedVersions,['0001','0002','0003']);
 const known=(await loadMigrations()).map(({version,filename,checksum})=>({version,filename,checksum}));
 const ledger=await pool.query(`SELECT version, filename, checksum FROM "${schema}".schema_migrations ORDER BY version`);assert.deepEqual(ledger.rows,known);
 assert.equal((await repository.currentRun(context.environmentId)).status,'not-found');
 stage='load-exact-public-dot12';
 const registry=createSyntheticRegistry({root:join(owned,'store'),policyService:new PolicyService({provider:new FilePolicyProvider()}),
  policyRead:{runId:context.runId,asOf:plan.asOf},jsonlLimitsForManifest:releaseLimits,approvedImages:APPROVED_CORPUS_IMAGES,
  sourceArtifactDirectory:join(owned,'cache',plan.releaseId)});
 const loaded=await registry.load();assert.equal(loaded.status,'ok');assert.equal(loaded.active.manifestDigest,plan.releaseId);
 const manifestBytes=await readFile(join(owned,'store','versions',plan.releaseId,'manifest.json'));assert.equal(hash(manifestBytes),plan.releaseId);
 const manifest=JSON.parse(manifestBytes);assert.equal(manifest.datasetId,plan.datasetId);assert.equal(manifest.version,plan.corpusVersion);
 assert.equal(manifest.counts.configurations,10001);assert.equal(manifest.counts.sourceConfigurations,10000);assert.equal(manifest.counts.vinMappings,1);
 const lookup=createVehicleEvidenceLookup({registry});
 const vehicles=[];
 for(const [index,selected] of selection.entries()) {
  const id=selected.configurationId;const prior=selected.actualDot12Observation;
  const found=await registry.getConfiguration(id);assert.ok(found.record);assert.equal(found.active.manifestDigest,plan.releaseId);
  assert.equal(found.record.configurationId,id);assert.equal(hash(id),prior.configurationIdSha256);
  const direct=await lookup.resolve({kind:'configuration',id});assert.equal(hash(JSON.stringify(direct)),prior.dtoSha256);
  assert.equal(direct.status,prior.directStatus);assert.equal(prior.consumerPassed,true);
  vehicles.push({vehicleId:`f63-linux-vehicle-${index+1}`,configurationId:id,snapshotVersion:found.record.snapshotVersion,configuration:found.record.configuration,usage:'stock'});
 }
 assert.equal(vehicles.length,3);
 stage='create-one-current-run';
 const run={runId:context.runId,environmentId:context.environmentId,status:'active',current:true,corpusVersion:plan.corpusVersion,
  scenarioVersion:'f63-linux-minimal-v1',fixtureVersion:'f63-linux-minimal-v1',policyVersion:'gcsp-policy-v1',clockInstant:plan.asOf,clockVersion:1,versions:{}};
 const created=await repository.transaction(context,{commandId:'f63-linux-create-run',inputDigest:inputDigest(run)},tx=>tx.insert('runs',run));assert.equal(created.status,'ok');
 stage='production-allocator-and-publication';
 const allocated=await allocateSyntheticIdentities(emptyAllocationInventory(),{runId:context.runId,seed:'f63-linux-retained-dot12-three-orders-v1',corpusVersion:plan.corpusVersion,datasetId:plan.datasetId,vehicles},{expectedRevision:0});
 assert.equal(allocated.status,'ok');assert.equal(allocated.inventory.records.length,3);
 const imported=await publishStockOrders({repository,context,inventory:allocated.inventory,expectedRunVersion:created.value.version,commandId:'f63-linux-publish-orders'});
 assert.equal(imported.status,'ok');assert.equal(imported.value.imported,3);
 stage='publish-authoritative-inventory-snapshot';
 // Stock import publishes projection metadata; the separate offline publication retains routing authority.
 const retainedInventory={revision:allocated.inventory.revision,contentDigest:allocated.inventory.contentDigest,snapshot:allocated.inventory};
 const inventoryPublished=await repository.transaction(context,{commandId:'f63-linux-publish-inventory',
  inputDigest:inputDigest({inventory:allocated.inventory,expectedRunVersion:imported.value.runVersion})},async tx=>{
  const runKey={table:'runs',key:{runId:context.runId}};const current=await tx.get(runKey);
  if(current.status!=='ok')return current;
  return tx.compareAndSwap(runKey,imported.value.runVersion,{versions:{...current.value.versions,syntheticIdentityInventory:retainedInventory}});
 });
 assert.equal(inventoryPublished.status,'ok');
 assert.deepEqual(inventoryPublished.value.versions.syntheticIdentityInventory,retainedInventory);
 const rows=[];
 for(const allocation of allocated.inventory.records) {
  const found=await repository.read(context,{table:'stock',key:{runId:context.runId,orderUuid:allocation.orderUuid}});assert.equal(found.status,'ok');
  assert.equal(found.value.configurationId,allocation.configurationId);assert.equal(found.value.orderNumber,allocation.orderNumber);
  assert.equal(found.value.facts.syntheticIdentity.configurationHash,allocation.configurationHash);
  assert.equal(found.value.facts.syntheticIdentity.snapshotVersion,allocation.snapshotVersion);
  rows.push({orderUuid:allocation.orderUuid,orderNumber:allocation.orderNumber,configurationId:allocation.configurationId,configurationHash:allocation.configurationHash,snapshotVersion:allocation.snapshotVersion});
 }
 stage='close-seed-repository';assert.equal((await repository.close()).status,'ok');repository=null;
 const seedExternalCalls=seedGuard.calls.length;assert.equal(seedExternalCalls,0);seedGuard.restore();seedGuard=null;
 stage='reopen-production-postgresql';repository=createPostgresRepository({schema,migrate:false});assert.equal((await repository.open()).status,'ok');
 const reopenedRun=await repository.currentRun(context.environmentId);assert.equal(reopenedRun.status,'ok');assert.equal(reopenedRun.value.runId,context.runId);
 assert.equal(reopenedRun.value.version,inventoryPublished.value.version);assert.deepEqual(reopenedRun.value.versions.syntheticIdentityInventory,retainedInventory);
 const nativeCounts=await pool.query(`SELECT (SELECT count(*)::int FROM "${schema}".runs) AS runs, (SELECT count(*)::int FROM "${schema}".stock) AS stock`);assert.deepEqual(nativeCounts.rows,[{runs:1,stock:3}]);
 stage='unchanged-order-reference-proof';
 assertionCheck='proof-call';
 returnedProof=await proveCurrentOrderReferences({repository,registry,context,stockReferences:rows.map(row=>row.orderUuid),repositoryProvider:'postgresql'});
 const proof=returnedProof;proofBytes=Buffer.byteLength(JSON.stringify(proof));
 assertionCheck='proof-receipt-byte-budget';assert.ok(proofBytes<=plan.diagnostics.maximumReturnedProofBytes);assertionCheck=null;
 proofEqual('proof-status',proof.status,'passed');proofEqual('proof-native',proof.nativeProof,true);proofEqual('proof-checked-count',proof.checked,3);proofEqual('proof-current-run-unchanged',proof.currentRunUnchanged,true);
 proofEqual('proof-total-error-count',proof.directErrors+proof.httpErrors+proof.consumerErrors+proof.sourceCalls+proof.externalConnectAttempts,0);
 result={schemaVersion:'f63-linux-postgres-orders-result.v1',status:'passed',scope:'three exact current-run stock references over actual retained .12 corpus; SQL close/reopen and direct/consumer/loopback HTTP',
  manifestDigest:plan.releaseId,postgresVersion:identity.rows[0].version,migrationLedger:ledger.rows,runId:context.runId,schema,
  stockImported:3,nativeCounts:nativeCounts.rows[0],seedRepositoryClosed:true,freshRepositoryOpened:true,allocationRevision:allocated.inventory.revision,
  allocationContentDigest:allocated.inventory.contentDigest,inventorySnapshotRetained:true,inventoryPublishedRunVersion:inventoryPublished.value.version,
  rows,seedExternalCalls,proof,fullCorpusConsumerReplay:false,deferredConsumerFailures:2707,acceptance:false};
} catch(error) {
 failure={status:'failed',stage,errorType:error?.name||'Error',errorCode:/^[A-Z0-9_]{1,40}$/.test(error?.code||'')?error.code:null,
  assertionSummary:summarizeAssertion(error,stage,assertionCheck),acceptance:false};
} finally {
 try{if(repository)assert.equal((await repository.close()).status,'ok');}catch{failure={...(failure||{status:'failed',stage:'repository-cleanup',acceptance:false}),repositoryCleanupFailed:true};}seedGuard?.restore();
 try {
  if(schemaOwned){await pool.query(`DROP SCHEMA "${schema}" CASCADE`);const absent=await pool.query('SELECT to_regnamespace($1) IS NULL AS absent',[schema]);assert.equal(absent.rows[0].absent,true);schemaAbsent=true;}
 } catch {failure={...(failure||{status:'failed',stage:'owned-schema-cleanup',acceptance:false}),schemaCleanupFailed:true};}
 await pool.end().catch(()=>{failure={...(failure||{status:'failed',stage:'pool-cleanup',acceptance:false}),poolCleanupFailed:true};});
}
const proofReturned=returnedProof!==undefined;
const proofRetained=proofReturned&&proofBytes<=plan.diagnostics.maximumReturnedProofBytes;
const report={...(failure||result),proofReturned,proofRetention:{status:proofRetained?'retained':proofReturned?'over-budget':'not-returned',bytes:proofBytes},
 ...(proofRetained?{proof:returnedProof}:{}),ownedSchemaAbsent:schemaAbsent};
const reportBytes=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(reportBytes)<=plan.resource.retainedReceiptLimitBytes);
await writeFile(join(output,'orders.json'),reportBytes,{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:report.status,stage:report.stage||'completed',proofReturned,checked:report.proof?.checked??null,nativeProof:report.proof?.nativeProof??null,
 assertionSummary:report.assertionSummary||null,acceptance:false}));
if(failure)process.exitCode=1;
