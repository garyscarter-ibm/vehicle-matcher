#!/usr/bin/env node
// FUCQ-77 demo enrichment: exact registrations, a resumable live driver and the demo-enrichment.v1 sidecar composer.
// Only --execute touches the network (three BMW hosts, plain HTTPS GET); every other mode is offline.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { CollectionError } from './configuration-key.mjs';
import { createEnrichmentObserver } from './enrichment-observation.mjs';
import { validatePublicBmwEnrichmentObservationPlan } from './public-bmw-source.mjs';
import { BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION, bmwEnrichmentObservationRequestUrls,
  validateBmwEnrichmentObservationRegistration } from './bmw-public-registration.mjs';
import { BMW_OTD_MAPPING_AUTHORITY, qualifyBmwTechnicalObservation } from './bmw-technical-qualification.mjs';
import { ENRICHMENT_DIR, ENRICHMENT_FACTS, ENRICHMENT_SCHEMA, countEnrichmentEntries, typedCategories } from './demo-verifier.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEMO_STORE = 'server/data/gcsp/vehicle-evidence/demo-fleet.v1';
export const SOURCES_DIR = 'server/data/gcsp/vehicle-evidence/registered-sources';
export const ALLOWED_HOSTS = Object.freeze(['configure.bmw.co.uk', 'prod.ucp.bmw.cloud', 'prod.cosy.bmw.cloud']);
export const ROW_REQUESTS = 4;
export const STOP_AFTER_FAILURES = 3;
export const IMAGE_RULE = Object.freeze({ id: 'first-desktop-herofront.v1',
  text: 'Desktop views whose viewpoint is HEROFRONT, ordered by namedImages then images index; the first is the reference.' });
const DESKTOP_VIEW = /^\/stage-fullscreen-views-legacy-newnames\/desktop\/namedImages\/(\d+)\/images\/(\d+)$/;
const DESKTOP_META = '/stage-fullscreen-views-legacy-newnames/desktop/metaData';
const FIDELITY_UNKNOWN = Object.freeze({ model: 'unknown', paint: 'unknown', wheels: 'unknown', interior: 'unknown', equipment: 'unknown', exactVehicle: 'unknown' });
const PLAN_LIMITS = Object.freeze({ maxAttempts: 1, retryDelayMs: 0, concurrency: 1, imageRequests: 0, sourceAttempts: 4, sourceBytes: 4194304,
  responseBytes: 1048576, operationTimeoutMs: 10000, deadlineMs: 90000, checkpointBytes: 4194304, cacheEntries: 8, cacheRetentionMs: 86400000,
  requestBudgets: Object.freeze({ page: 1, settings: 1, technical: 1, 'image-manifest': 1 }) });
const CHALLENGE_PAGE = /challenge-platform|cf-chl-|cf_chl|px-captcha|captcha-delivery|g-recaptcha|h-captcha|just a moment\.\.\.|attention required! \| cloudflare|pardon our interruption|_incapsula_resource|datadome/i;
const SAFETY_STOPS = new Set(['http-401', 'http-403', 'http-429', 'challenge-suspected', 'host-refused', 'consecutive-failures']);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sorted = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const need = (condition, code) => { if (!condition) throw new CollectionError(code, code); };
const safeCode = (error) => (/^[a-z0-9:-]{1,96}$/.test(error?.code || '') ? error.code : 'source-execution-failed');
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const msToUtcMidnight = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms; };

/** The active published demo version: manifest digest plus its configuration rows, checksum-verified. */
export async function loadPublishedDemoRows({ root = REPO_ROOT } = {}) {
  const store = resolve(root, DEMO_STORE); const active = JSON.parse(await readFile(join(store, 'active.json'), 'utf8'));
  const digest = active.selected?.manifestDigest;
  need(/^[a-f0-9]{64}$/.test(digest || '') && active.selected.directory === digest, 'demo-store-selection-invalid');
  const directory = join(store, 'versions', digest);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const text = await readFile(join(directory, 'configurations.jsonl'), 'utf8');
  need(sha(text) === manifest.checksums?.['configurations.jsonl'], 'demo-store-checksum-mismatch');
  return { manifestDigest: digest, manifest, rows: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

/** Stream the accepted source lines (data only) for the wanted ids; a differing duplicate is a conflict. */
export async function readAcceptedLines(ids, directories) {
  const wanted = new Set(ids); const found = new Map(); const conflicts = new Set();
  for (const directory of directories) {
    for (const name of (await readdir(directory)).filter((file) => file.endsWith('.jsonl')).sort()) {
      const lines = createInterface({ input: createReadStream(join(directory, name)), crlfDelay: Infinity });
      for await (const line of lines) {
        const match = /^\{"configurationId":"([A-Za-z0-9+/=]+)"/.exec(line);
        if (!match || !wanted.has(match[1])) continue;
        const prior = found.get(match[1]);
        if (!prior) found.set(match[1], { line, file: name }); else if (prior.line !== line) conflicts.add(match[1]);
      }
    }
  }
  return { found, conflicts };
}

function registrationFor(row, accepted) {
  const id = row.configurationId; const binding = row.catalogue?.sourceBinding; const context = binding?.confirmedContext;
  need(object(binding) && object(context), 'no-source-binding');
  const hit = accepted.found.get(id); need(hit, 'no-accepted-source-line'); need(!accepted.conflicts.has(id), 'accepted-source-line-conflict');
  const line = JSON.parse(hit.line); need(JSON.stringify(line) === hit.line, 'accepted-line-not-canonical');
  need(line.admission === true && line.configurationId === id && inputDigest(line.catalogue?.sourceBinding) === inputDigest(binding), 'accepted-line-mismatch');
  const known = (name) => (context[name]?.state === 'known' ? context[name].value : undefined);
  const [modelCode, agModelCode, rawModelRange, orderDate, effectDate, steering] = ['modelCode', 'agModelCode', 'rawModelRange', 'orderDate', 'effectDate', 'steeringLiteral'].map(known);
  need([modelCode, agModelCode, rawModelRange, orderDate, effectDate, steering].every((value) => typeof value === 'string'), 'context-unknown');
  const tree = (binding.requestScope?.requests || []).find((request) => request.operation === 'discover');
  const evidence = (binding.evidence || []).find((item) => item.role === 'model-tree');
  const aliases = [...new Set((evidence?.locators || []).map((locator) => /^\/([A-Z0-9]{1,16})\/modelRanges\//.exec(locator.sourcePointer || '')?.[1]).filter(Boolean))].sort();
  need(typeof tree?.effectDate === 'string' && aliases.length > 0, 'tree-context-unknown');
  const categories = typedCategories(binding);
  need(categories.paint.length === 1 && categories.upholstery.length === 1, 'typed-paint-upholstery-missing');
  const registration = { schemaVersion: 'bmw-public-enrichment-observation-registration.v1', configurationId: id, bindingDigest: inputDigest(binding),
    sourceAcceptedSha256: sha(`${hit.line}\n`), factoryOptionCodes: [...row.canonicalIdentity.factoryOptionCodes], accessories: [],
    paintCode: categories.paint[0], upholsteryCode: categories.upholstery[0],
    model: { schemaVersion: 'bmw-public-model-registration.v1', modelCode, agModelCode, catalogueRangeKey: binding.requestScope.catalogueRangeKey, rawModelRange,
      aliases, market: binding.requestScope.market, locale: binding.requestScope.locale, steering, catalogueDate: tree.effectDate, orderDate, effectDate } };
  need(row.catalogue.lookupIdentity?.bindingDigest === registration.bindingDigest && line.catalogueRequest?.bindingDigest === registration.bindingDigest, 'binding-digest-mismatch');
  // The registration carries factory codes only, so flag accepted dealer accessories: the qualifier will refuse those rows' facts.
  const dealerAccessories = line.catalogue?.sourceBinding?.selection?.accessories?.length ?? 0;
  try { return { configurationId: id, registration: validateBmwEnrichmentObservationRegistration(registration), accepted: line, dealerAccessories }; }
  catch (error) { throw new CollectionError(`registration-invalid:${error.code ?? 'unknown'}`, 'registration-invalid'); }
}

/** One exact registration per row; a row that cannot be registered exactly is listed with its reason, never guessed. */
export function buildRegistrations({ rows, accepted }) {
  const registrations = []; const unregistered = [];
  for (const row of rows) {
    try { registrations.push(registrationFor(row, accepted)); }
    catch (error) { unregistered.push({ configurationId: row.configurationId, vgModelCode: row.canonicalIdentity?.vgModelCode ?? null, reason: error.code ?? 'registration-invalid' }); }
  }
  registrations.sort((a, b) => sorted(a.configurationId, b.configurationId));
  return { registrations, unregistered };
}

/** Everything the three modes need: published rows, their accepted lines and the exact registrations. */
export async function loadRegistrations({ root = REPO_ROOT, sourcesDirs } = {}) {
  const published = await loadPublishedDemoRows({ root });
  const accepted = await readAcceptedLines(published.rows.map((row) => row.configurationId), sourcesDirs ?? [resolve(root, SOURCES_DIR)]);
  return { ...published, ...buildRegistrations({ rows: published.rows, accepted }) };
}

/** A fresh exact plan for one row, dated by the UTC day the row starts. */
export function buildRowPlan(registration, qualificationDate) {
  return validatePublicBmwEnrichmentObservationPlan({ schemaVersion: 'bmw-enrichment-observation-plan.v1',
    planId: `fucq77-${qualificationDate}-${sha(registration.configurationId).slice(0, 12)}`, qualificationDate,
    source: { id: 'bmw-uk-public', version: BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION, kind: 'public-bmw-uk' },
    registration: structuredClone(registration), limits: structuredClone(PLAN_LIMITS) });
}

async function writeAtomic(path, text) {
  const staging = `${path}.writing-${process.pid}`; await writeFile(staging, text, { mode: 0o600 }); await rename(staging, path);
}

async function acquireLock(directory) {
  const path = join(directory, 'ledger.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const file = await open(path, 'wx', 0o600); await file.writeFile(String(process.pid)); await file.close(); return () => rm(path, { force: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path, 'utf8').catch(() => ''));
      let alive = false; try { process.kill(pid, 0); alive = Number.isSafeInteger(pid) && pid > 0; } catch (probe) { alive = probe.code === 'EPERM'; }
      if (alive) throw new CollectionError('ledger-locked', 'Another enrichment run owns this output directory.');
      await rm(path, { force: true });
    }
  }
  throw new CollectionError('ledger-locked', 'Could not take the ledger lock.');
}

/** The shared request ledger: every HTTP attempt is persisted before the request goes out. */
export async function openLedger(directory, { manifestDigest, now = Date.now } = {}) {
  const path = join(directory, 'ledger.json'); let data;
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (data) need(data.schemaVersion === 'demo-enrichment-ledger.v1' && data.demoManifestDigest === manifestDigest, 'ledger-incompatible');
  else data = { schemaVersion: 'demo-enrichment-ledger.v1', demoManifestDigest: manifestDigest, createdAt: new Date(now()).toISOString(),
    requests: { total: 0, perHost: Object.fromEntries(ALLOWED_HOSTS.map((host) => [host, 0])), perOperation: { page: 0, settings: 0, technical: 0, 'image-manifest': 0 } },
    rows: {}, consecutiveFailures: 0, stop: null, stopHistory: [], runs: [] };
  const save = () => writeAtomic(path, `${JSON.stringify(data, null, 1)}\n`);
  return { data, save, used: () => data.requests.total,
    async noteAttempt(host, operation) {
      data.requests.total++; data.requests.perHost[host] = (data.requests.perHost[host] || 0) + 1;
      data.requests.perOperation[operation] = (data.requests.perOperation[operation] || 0) + 1; await save();
    } };
}

// Wraps the transport: allow-listed hosts only, every attempt counted first, and 401/403/429 or a bot challenge flagged as fatal.
export function createGuardedFetch({ baseFetch, ledger, registration, context }) {
  const urls = bmwEnrichmentObservationRequestUrls(registration);
  return async (url, options) => {
    let parsed; try { parsed = new URL(url); } catch { /* refused below */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.port || !ALLOWED_HOSTS.includes(parsed.hostname)) {
      context.fatal ??= { reason: 'host-refused', detail: parsed?.hostname ?? 'unparseable-url' };
      throw new CollectionError('host-refused', 'Only the three registered BMW hosts may be contacted.');
    }
    const operation = url === urls.page ? 'page' : url === urls.technical ? 'technical' : url === urls['image-manifest'] ? 'image-manifest' : 'settings';
    await ledger.noteAttempt(parsed.hostname, operation); context.attempts++;
    let response;
    try { response = await baseFetch(url, options); } catch (error) { context.events.push({ operation, error: safeCode(error) }); throw error; }
    context.events.push({ operation, status: response.status });
    if ([401, 403, 429].includes(response.status)) context.fatal ??= { reason: `http-${response.status}`, detail: operation };
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const marker = ['cf-mitigated', 'x-datadome', 'x-datadome-cid'].some((name) => response.headers.has(name));
    if (marker || operation !== 'page' && type.includes('html')) context.fatal ??= { reason: 'challenge-suspected', detail: operation };
    if (operation === 'page' && type.includes('html') && !context.fatal) {
      const text = await response.clone().text().catch(() => '');
      if (CHALLENGE_PAGE.test(text) && !/settings\.[a-zA-Z0-9]+\.json/.test(text)) context.fatal = { reason: 'challenge-suspected', detail: operation };
    }
    return response;
  };
}

async function observeRow({ entry, ledger, baseFetch, now, out }) {
  const id = entry.configurationId; const qualificationDate = utcDate(now()); const plan = buildRowPlan(entry.registration, qualificationDate);
  const directory = sha(id).slice(0, 24); const statePath = join(out, 'rows', directory, 'observer-checkpoint.json');
  const row = { status: 'started', dir: directory, qualificationDate, startedAt: new Date(now()).toISOString(), attempts: 0, reason: null };
  ledger.data.rows[id] = row; await ledger.save();
  const context = { fatal: null, events: [], attempts: 0 }; let result; let failure = null;
  try {
    const observer = await createEnrichmentObserver({ plan, statePath, now, http: { kind: 'live',
      allocation: { id: plan.planId, sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: ROW_REQUESTS, bytes: PLAN_LIMITS.sourceBytes },
      fetch: createGuardedFetch({ baseFetch, ledger, registration: entry.registration, context }) } });
    result = await observer.run();
  } catch (error) { failure = safeCode(error); }
  const observed = failure === null && result?.status === 'observed';
  const statusStop = /^source-http-(401|403|429)$/.exec(result?.reason || failure || '');
  Object.assign(row, { status: observed ? 'observed' : 'incomplete', attempts: context.attempts, completedAt: new Date(now()).toISOString(),
    reason: observed ? null : failure || result?.reason || 'incomplete', events: context.events });
  const fatal = context.fatal ?? (statusStop ? { reason: `http-${statusStop[1]}`, detail: 'session' } : null);
  return { observed, fatal };
}

/** Sequential live driver: one observer per row, a fresh dated plan each, one shared ledger and the stop rules. */
export async function runLiveObservation({ registrations, manifestDigest, out, cap, limit = Infinity, fetch = globalThis.fetch,
  now = Date.now, sleep = delay, log = () => {}, resumeAfterStop = false } = {}) {
  need(isAbsolute(out || '') && Number.isSafeInteger(cap) && cap >= ROW_REQUESTS && typeof fetch === 'function', 'invalid-run');
  await mkdir(out, { recursive: true }); const release = await acquireLock(out);
  try {
    const ledger = await openLedger(out, { manifestDigest, now }); const { data } = ledger;
    const accessoryRows = registrations.filter((entry) => entry.dealerAccessories > 0).length;
    const run = { startedAt: new Date(now()).toISOString(), cap, rowsStarted: 0, observed: 0, incomplete: 0, haltedBy: null, accessoryRows };
    if (accessoryRows) log(`warning: ${accessoryRows} rows select dealer accessories; their OTD facts will be rejected (dealer-accessory-selected)`);
    if (data.stop && !resumeAfterStop) return { ...run, haltedBy: data.stop.reason, refusedToStart: true, used: ledger.used(), requests: data.requests };
    if (data.stop) { data.stopHistory.push(data.stop); data.stop = null; data.consecutiveFailures = 0; }
    for (const entry of registrations) {
      const prior = data.rows[entry.configurationId];
      if (['observed', 'incomplete'].includes(prior?.status)) continue;
      if (prior?.status === 'started') { Object.assign(prior, { status: 'incomplete', reason: 'interrupted' }); await ledger.save(); continue; }
      if (run.rowsStarted >= limit) { run.haltedBy = 'limit'; break; }
      if (ledger.used() + ROW_REQUESTS > cap) { run.haltedBy = 'cap'; break; }
      if (run.rowsStarted > 0) await sleep(1000);
      // A row never straddles UTC midnight: wait it out so the plan date matches the observation date.
      const toMidnight = msToUtcMidnight(now());
      if (toMidnight < PLAN_LIMITS.deadlineMs + 10000) await sleep(toMidnight + 1000);
      const { observed, fatal } = await observeRow({ entry, ledger, baseFetch: fetch, now, out });
      run.rowsStarted++; run[observed ? 'observed' : 'incomplete']++;
      data.consecutiveFailures = observed ? 0 : data.consecutiveFailures + 1;
      const stop = fatal ?? (data.consecutiveFailures >= STOP_AFTER_FAILURES ? { reason: 'consecutive-failures', detail: String(data.consecutiveFailures) } : null);
      if (stop) data.stop = { ...stop, configurationId: entry.configurationId, at: new Date(now()).toISOString() };
      await ledger.save();
      log(`row ${run.rowsStarted} ${entry.configurationId.slice(0, 12)} ${observed ? 'observed' : `incomplete (${data.rows[entry.configurationId].reason})`}; used ${ledger.used()} of ${cap}`);
      if (stop) { run.haltedBy = stop.reason; break; }
    }
    data.runs.push({ ...run, endedAt: new Date(now()).toISOString() }); await ledger.save();
    return { ...run, used: ledger.used(), requests: structuredClone(data.requests), stop: data.stop };
  } finally { await release(); }
}

function exteriorReference(artifact, registration) {
  const doc = artifact?.document; const bytes = `${JSON.stringify(doc)}\n`; const url = bmwEnrichmentObservationRequestUrls(registration)['image-manifest'];
  need(sha(bytes) === artifact.sha256 && Buffer.byteLength(bytes) === artifact.bytes && doc.schemaVersion === 'bmw-enrichment-source-observation.v1'
    && doc.requestScope?.operation === 'image-manifest' && doc.requestScope.role === 'request-input-only'
    && inputDigest(doc.requestScope.registration) === inputDigest(registration) && doc.observation?.operation === 'image-manifest'
    && doc.observation.capability === 'bmw-image-manifest' && doc.observation.request?.url === url && doc.report?.assetsDownloaded === 0
    && doc.report.urlsRetained === false && /^\d{4}-\d{2}-\d{2}T/.test(doc.observation.observedAt), 'image-manifest-evidence-mismatch');
  const candidates = (doc.report.views || []).map((view) => ({ view, match: DESKTOP_VIEW.exec(view.pointer || '') }))
    .filter(({ view, match }) => match && view.viewpoint === 'HEROFRONT').sort((a, b) => a.match[1] - b.match[1] || a.match[2] - b.match[2]);
  if (candidates.length === 0) return null;
  const size = (doc.report.dimensions || []).find((item) => item.pointer === DESKTOP_META)?.value;
  const m = registration.model;
  return { kind: 'cosy-exterior-render', source: 'BMW COSY', observedDate: doc.observation.observedAt.slice(0, 10),
    manifestRequest: { operation: 'image-manifest', registrationDigest: inputDigest(registration), requestUrlSha256: sha(url), agModelCode: m.agModelCode,
      effectDate: m.effectDate, retainedSha256: artifact.sha256, responseSha256: doc.observation.responseSha256 },
    pointer: candidates[0].view.pointer, device: 'desktop', viewpoint: 'HEROFRONT',
    dimensions: Number.isSafeInteger(size?.width) && Number.isSafeInteger(size?.height) ? { width: size.width, height: size.height } : null,
    selection: { rule: IMAGE_RULE.id, candidates: candidates.length }, fidelity: 'representative-configuration', fidelityDetail: { ...FIDELITY_UNKNOWN },
    assetUrlRetained: false };
}

const UNKNOWN_PROVENANCE = Object.freeze({ kind: 'unknown', source: null, observedDate: null });
const unknownFact = (definition, unit, reason) => ({ state: 'unknown', value: null, unit, definition, reason, provenance: { ...UNKNOWN_PROVENANCE } });
const allUnknown = (reason) => ({ acceleration: unknownFact('0–100 KM/H', 'SECONDS', reason), seats: unknownFact('SEATS', 'COUNT', reason),
  luggageNormal: unknownFact('NORMAL', 'LITRES', reason), rangeOrEconomy: unknownFact('RANGE OR ECONOMY', null, reason),
  co2: unknownFact('CO2 EMISSIONS', null, reason), luggageExpanded: unknownFact('EXPANDED', 'LITRES', reason) });

// The image reference stands on its own manifest artifact, so a technical refusal never removes it.
async function observedEntry(out, directory, item) {
  const envelope = JSON.parse(await readFile(join(out, 'rows', directory, 'observer-checkpoint.json'), 'utf8'));
  need(inputDigest(envelope.content) === envelope.contentDigest && envelope.content.observationStatus === 'observed', 'checkpoint-not-observed');
  const { technical, 'image-manifest': image } = envelope.content.observations; const r = item.registration;
  let reference = null; let imageReason = null;
  try { reference = exteriorReference(image, r); imageReason = reference ? null : 'no-desktop-herofront-view'; } catch (error) { imageReason = safeCode(error); }
  const imageParts = { imageReferences: reference ? [reference] : [], imageReferenceReason: imageReason };
  const imageEvidence = { retainedSha256: image.sha256, responseSha256: image.document.observation.responseSha256 };
  const base = { registrationDigest: inputDigest(r), sourceAcceptedSha256: r.sourceAcceptedSha256, bindingDigest: r.bindingDigest };
  let qualified;
  try {
    qualified = qualifyBmwTechnicalObservation({ artifact: technical, accepted: item.accepted, registration: r,
      pins: { mappingDigest: BMW_OTD_MAPPING_AUTHORITY.digest, acceptedLineSha256: r.sourceAcceptedSha256, retainedSha256: technical.sha256,
        responseSha256: technical.document.observation.responseSha256 } });
  } catch (error) {
    // The qualifier refuses an accepted row that selects dealer accessories; the OTD request itself carried factory codes only.
    const accessories = item.accepted.catalogue?.sourceBinding?.selection?.accessories?.length > 0;
    return { observation: 'rejected', reason: accessories ? 'dealer-accessory-selected' : safeCode(error), observedDate: null,
      facts: allUnknown('qualification-rejected'), unmappedOtdCodes: [], ...imageParts, evidence: { ...base, imageManifest: imageEvidence } };
  }
  const keep = ['state', 'value', 'unit', 'definition', 'reason', 'provenance']; const fact = (name) => Object.fromEntries(keep.map((key) => [key, qualified.facts[name][key]]));
  return { observation: 'observed', reason: null, observedDate: qualified.source.observedDate,
    facts: { acceleration: fact('acceleration'), seats: fact('seats'), luggageNormal: fact('luggageNormal'),
      rangeOrEconomy: unknownFact('RANGE OR ECONOMY', null, 'unmapped-meaning'), co2: unknownFact('CO2 EMISSIONS', null, 'unmapped-meaning'),
      luggageExpanded: fact('luggageExpanded') },
    unmappedOtdCodes: [...qualified.unmappedKeys].sort(), ...imageParts,
    evidence: { ...base, mappingVersion: BMW_OTD_MAPPING_AUTHORITY.version, mappingDigest: BMW_OTD_MAPPING_AUTHORITY.digest,
      technical: { retainedSha256: technical.sha256, responseSha256: technical.document.observation.responseSha256 }, imageManifest: imageEvidence } };
}

/** Compose demo-enrichment.v1 (one entry per published row, sorted) from the retained observations. */
export async function composeEnrichment({ loaded, out, sidecarDir }) {
  need(isAbsolute(out || '') && isAbsolute(sidecarDir || ''), 'invalid-compose');
  const ledger = JSON.parse(await readFile(join(out, 'ledger.json'), 'utf8'));
  need(ledger.schemaVersion === 'demo-enrichment-ledger.v1' && ledger.demoManifestDigest === loaded.manifestDigest, 'ledger-incompatible');
  const byId = new Map(loaded.registrations.map((item) => [item.configurationId, item])); const unregistered = new Map(loaded.unregistered.map((item) => [item.configurationId, item.reason]));
  const entries = [];
  for (const row of [...loaded.rows].sort((a, b) => sorted(a.configurationId, b.configurationId))) {
    const id = row.configurationId; const base = { configurationId: id, demoManifestDigest: loaded.manifestDigest };
    const none = (observation, reason, factReason) => ({ ...base, observation, reason, observedDate: null, facts: allUnknown(factReason), unmappedOtdCodes: [],
      imageReferences: [], imageReferenceReason: observation === 'rejected' ? 'qualification-rejected' : 'not-observed', evidence: null });
    const ledgerRow = ledger.rows[id];
    if (unregistered.has(id)) entries.push(none('not-observed', `not-registrable:${unregistered.get(id)}`, 'not-observed'));
    else if (ledgerRow?.status !== 'observed') entries.push(none('not-observed', ledgerRow?.reason ?? 'not-run', 'not-observed'));
    else {
      try { entries.push({ ...base, ...await observedEntry(out, ledgerRow.dir, byId.get(id)) }); }
      catch (error) { entries.push(none('rejected', safeCode(error), 'qualification-rejected')); }
    }
  }
  const jsonl = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  const dates = entries.map((entry) => entry.observedDate).filter(Boolean).sort();
  const manifest = { schemaVersion: ENRICHMENT_SCHEMA, demoManifestDigest: loaded.manifestDigest,
    sources: { technical: 'BMW UK OTD', images: 'BMW COSY', observationSourceVersion: BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION },
    mapping: { version: BMW_OTD_MAPPING_AUTHORITY.version, digest: BMW_OTD_MAPPING_AUTHORITY.digest }, imageRule: { ...IMAGE_RULE },
    facts: [...ENRICHMENT_FACTS], counts: countEnrichmentEntries(entries), checksums: { 'enrichment.jsonl': sha(jsonl) },
    observedDates: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
    requests: { total: ledger.requests.total, perHost: ledger.requests.perHost, perOperation: ledger.requests.perOperation, stop: ledger.stop?.reason ?? null } };
  await mkdir(sidecarDir, { recursive: true });
  await writeAtomic(join(sidecarDir, 'enrichment.jsonl'), jsonl); await writeAtomic(join(sidecarDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, entries };
}

const USAGE = `Usage:
  node scripts/gcsp/demo-enrichment.mjs [--sources-dir <abs dir>]                          offline: report the exact registrations
  node scripts/gcsp/demo-enrichment.mjs --execute --out <abs dir> --cap <n> [--limit <rows>] [--resume-after-stop]   LIVE: BMW GETs
  node scripts/gcsp/demo-enrichment.mjs --compose --out <abs dir> [--sidecar-dir <abs dir>] [--sources-dir <abs dir>]   offline: write the sidecar
`;
export function parseEnrichmentArgs(args) {
  const options = {}; const flags = { '--execute': 'execute', '--compose': 'compose', '--resume-after-stop': 'resumeAfterStop' };
  const values = { '--out': 'out', '--cap': 'cap', '--limit': 'limit', '--sidecar-dir': 'sidecarDir', '--sources-dir': 'sourcesDir' };
  for (let i = 0; i < args.length; i += 1) {
    if (flags[args[i]]) { if (options[flags[args[i]]]) return null; options[flags[args[i]]] = true; continue; }
    const name = values[args[i]]; const value = args[i + 1]; i += 1;
    if (!name || value === undefined || options[name] !== undefined) return null;
    if (name === 'cap' || name === 'limit') { const n = Number(value); if (!Number.isSafeInteger(n) || n < (name === 'cap' ? ROW_REQUESTS : 1)) return null; options[name] = n; }
    else if (!isAbsolute(value)) return null; else options[name] = resolve(value);
  }
  if (options.execute && options.compose) return null;
  if (options.execute && (!options.out || !options.cap)) return null;
  if (options.compose && !options.out) return null;
  if (!options.execute && (options.cap || options.limit || options.resumeAfterStop)) return null;
  if (!options.execute && !options.compose && options.out) return null;
  return options;
}

export async function enrichmentCli(args, write = (text) => process.stdout.write(text)) {
  const options = parseEnrichmentArgs(args);
  if (!options) { process.stderr.write(USAGE); return 1; }
  const loaded = await loadRegistrations({ sourcesDirs: options.sourcesDir ? [options.sourcesDir] : undefined });
  if (options.execute) {
    const summary = await runLiveObservation({ registrations: loaded.registrations, manifestDigest: loaded.manifestDigest, out: options.out, cap: options.cap,
      limit: options.limit, resumeAfterStop: options.resumeAfterStop, log: (line) => write(`${line}\n`) });
    write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary.refusedToStart || SAFETY_STOPS.has(summary.haltedBy) ? 2 : 0;
  }
  if (options.compose) {
    const { manifest } = await composeEnrichment({ loaded, out: options.out, sidecarDir: options.sidecarDir ?? resolve(REPO_ROOT, ENRICHMENT_DIR) });
    write(`${JSON.stringify({ wrote: ENRICHMENT_DIR, counts: manifest.counts, requests: manifest.requests }, null, 2)}\n`);
    return 0;
  }
  write(`${JSON.stringify({ demoManifestDigest: loaded.manifestDigest, rows: loaded.rows.length, registered: loaded.registrations.length,
    unregistered: loaded.unregistered,
    withDealerAccessories: loaded.registrations.filter((item) => item.accepted.catalogue.sourceBinding.selection.accessories.length > 0).length, requestsPerRow: ROW_REQUESTS, requestsIfAllRun: loaded.registrations.length * ROW_REQUESTS, hosts: ALLOWED_HOSTS }, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  enrichmentCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${error.code ?? 'error'}: ${error.message}\n`); process.exitCode = 1; });
}
