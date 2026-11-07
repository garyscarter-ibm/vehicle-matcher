/** Exact representative capture through existing imagery transport/provider; one separately released run. */
import { readFile, writeFile, open, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url'; import { createHash } from 'node:crypto';
import { createBoundedTransport, credentialFromSettings } from '../../../../../scripts/gcsp/verify-live-imagery.mjs';
import { createBmwLiveImageryProvider } from '../../../../../server/vehicle-evidence/bmw-live-imagery.js';
import { createCollectionSession } from '../../../../../scripts/gcsp/collection-session.mjs';
import { enrichFleet } from '../../../../../scripts/gcsp/enrich-fleet.mjs';
import { BMW_OTD_MAPPING_AUTHORITY, qualifyBmwTechnicalObservation } from '../../../../../scripts/gcsp/bmw-technical-qualification.mjs';
import { bmwEnrichmentObservationRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex'); const encode = (v) => JSON.stringify(v) + '\n';
const allocation = JSON.parse(await readFile(join(base, 'execution-plan.json')));
if (process.env.F60_V2_IMAGE_SOURCE_GRANT !== allocation.id) throw new Error('explicit-root-traffic-grant-required');
const plan = JSON.parse(await readFile(join(base, 'image-plan.json')));
if (inputDigest(plan) !== allocation.planDigest || new Date().toISOString().slice(0, 10) !== plan.qualificationDate) throw new Error('source-plan-date-mismatch');
for (const [p, h] of Object.entries(allocation.codePins)) if (sha(await readFile(join(root, p))) !== h) throw new Error('source-code-pin-mismatch');
const source = await readFile(join(root, allocation.acceptedSource.path)); const line = source.subarray(0, source.indexOf(10) + 1);
if (sha(source) !== allocation.acceptedSource.fileSha256 || sha(line) !== allocation.acceptedSource.lineSha256) throw new Error('accepted-source-pin');
const accepted = JSON.parse(line); const registration = plan.registration;
const raw = await readFile(join(root, allocation.technical.path)); if (sha(raw) !== allocation.technical.retainedSha256) throw new Error('technical-source-pin');
const document = JSON.parse(raw); const artifact = { document, sha256: sha(raw), bytes: raw.length };
const technicalOptions = { registration, pins: { retainedSha256: artifact.sha256, responseSha256: allocation.technical.responseSha256,
  acceptedLineSha256: sha(line), mappingDigest: BMW_OTD_MAPPING_AUTHORITY.digest } };
qualifyBmwTechnicalObservation({ artifact, accepted, ...technicalOptions });
if (allocation.primary !== join(base, 'image-checkpoint.json') || plan.limits.attempts !== 4 || plan.limits.totalBytes !== 4194304
  || plan.limits.assetBytes !== 2097152 || plan.limits.responseBytes !== 1048576 || plan.limits.sourceMs !== 90000) throw new Error('allocation-mismatch');
for (const name of ['image-checkpoint.json', 'captured.webp', 'enrichment-checkpoint.json']) try { await stat(join(base, name)); throw new Error('existing-output-preserved'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const marker = await open(join(base, 'execution-once.json'), 'wx', 0o600);
try { await marker.writeFile(encode({ allocationId: allocation.id, planDigest: allocation.planDigest, state: 'reserved-and-consumed', at: new Date().toISOString() })); await marker.sync(); } finally { await marker.close(); }
const syncDirectory = async () => { const parent = await open(base, 'r'); try { await parent.sync(); } finally { await parent.close(); } };
await syncDirectory();
const state = { schemaVersion: 'f60-v2-image-capture.v1', allocationId: allocation.id, planDigest: allocation.planDigest, status: 'pending',
  startedAt: new Date().toISOString(), primary: allocation.primary, ledger: null, selectedVariant: null, image: null, failure: null };
const persist = async () => {
  const tmp = join(base, 'image-checkpoint.writing'); const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(encode(state)); await file.sync(); } finally { await file.close(); }
  await rename(tmp, allocation.primary); await syncDirectory();
};
await persist(); let budget; let provider; let output;
try {
  budget = createBoundedTransport({ sourceRegistration: registration, fetchImpl: globalThis.fetch,
    onProgress: async (ledger) => { state.ledger = ledger; await persist(); } });
  const get = (url) => budget.get({ method: 'GET', url, headers: {}, credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0, maxResponseBytes: 1048576 });
  const page = await get(bmwEnrichmentObservationRequestUrls(registration).page);
  const paths = [...new Set([...page.body.toString('utf8').matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)].map((x) => x[0].startsWith('/en_GB/') ? x[0] : '/en_GB/' + x[0]))];
  if (paths.length !== 1 || !/^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/.test(paths[0])) throw new Error('settings-invalid');
  const settings = await get('https://configure.bmw.co.uk' + paths[0]); const key = credentialFromSettings(settings.body);
  provider = createBmwLiveImageryProvider({ environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator', sourceRegistration: registration,
    timeoutMs: 10000, transport: budget.get, getCredential: async () => key,
    onSelectedVariant: async (selected) => { state.selectedVariant = selected; await persist(); },
    resolveConfiguration: async () => ({ basis: 'independent-source-proof', identity: accepted.catalogueRequest,
      observedDate: accepted.catalogue.observedDate, registrationDigest: inputDigest(registration), acceptedLineSha256: sha(line), fidelity: {} }) });
  const result = await provider.resolve(plan.request);
  if (result.status !== 'ok') throw new Error(result.failure?.code || 'image-unavailable');
  const asset = await provider.readAsset(result.image.assetId); if (asset.status !== 'ok' || sha(asset.bytes) !== result.image.sha256) throw new Error('asset-unavailable');
  const file = await open(join(base, 'captured.webp'), 'wx', 0o600); try { await file.writeFile(asset.bytes); await file.sync(); } finally { await file.close(); }
  await syncDirectory(); state.image = result; state.status = 'captured'; await persist();
  await writeFile(join(base, 'image.json'), encode(result), { flag: 'wx', mode: 0o600 });
  const operations = { catalogue: { kind: 'offline', sourceId: 'retained-catalogue', sourceVersion: '2', execute: async () => accepted.catalogue },
    technical: { kind: 'offline', sourceId: 'retained-otd', sourceVersion: '1', execute: async () => artifact },
    image: { kind: 'offline', sourceId: 'retained-cosy', sourceVersion: '2', execute: async () => result } };
  const session = await createCollectionSession({ identity: { stage: 'v2-image-and-technical-enrichment', version: '1', planDigest: allocation.planDigest },
    operations, limits: { maxAttempts: 1, retryDelayMs: 0, operationTimeoutMs: 10000, deadlineMs: 90000, concurrency: 1, imageRequests: 0,
      cacheEntries: 4, cacheRetentionMs: 86400000, checkpointBytes: 1048576, requestBudgets: { catalogue: 1, technical: 1, image: 1 } },
    statePath: join(base, 'enrichment-checkpoint.json'), initialState: { accepted: [accepted] } });
  const catalogueOptions = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((k) => [k, accepted.lookupIdentity[k]]));
  output = await enrichFleet({ session, accepted: [accepted], catalogueOptions, technicalOperation: 'technical', technicalOptions,
    imageOperation: 'image', imageRequest: { viewpoint: plan.request.viewpoint, size: plan.request.size }, asOf: plan.qualificationDate,
    retention: { status: 'allowed', decision: 'f60-authorized-source-retention' } });
  if (!output.records[0]?.image || output.records[0].facts.seats.value !== 5) throw new Error('enrichment-output-invalid');
  await writeFile(join(base, 'enrichment.json'), encode(output), { flag: 'wx', mode: 0o600 });
} catch (error) { state.status = 'incomplete'; state.failure = /^[a-z0-9-]{1,96}$/.test(error.message || '') ? error.message : 'capture-failed'; }
finally { provider?.dispose(); state.completedAt = new Date().toISOString(); await persist(); }
const receipt = { allocationId: allocation.id, planDigest: allocation.planDigest, status: state.status, reason: state.failure, ledger: state.ledger,
  selectedVariant: state.selectedVariant, primarySha256: sha(await readFile(allocation.primary)), image: state.image?.image || null,
  physicalBuildDate: 'unknown', runtimePublication: false, fidelity: state.image?.image.fidelity || null,
  rawSettingsRetained: false, credentialsRetained: false, opaqueAssetUrlRetained: false, retries: 0, originalF60Acceptance: false };
await writeFile(join(base, 'receipt.json'), encode(receipt), { flag: 'wx', mode: 0o600 });
console.log(encode({ status: receipt.status, reason: receipt.reason, ledger: receipt.ledger, imageSha256: receipt.image?.sha256 || null }).trim());
if (state.status !== 'captured') process.exitCode = 1;
