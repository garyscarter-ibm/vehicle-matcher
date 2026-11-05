import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createVinProfileRegistry } from '../../server/gcsp/vehicle-evidence/vin-profiles.js';

export const FLEET_PLAN_VERSION = 'fleet-plan.v1';
const ROOT = new URL('../../', import.meta.url);
const PILOT = 'docs/gcsp/evidence/fucq-4/configuration-generation-native-2026-11-01.json';
const SNAPSHOT = 'server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512;
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const strings = (v) => Array.isArray(v) && v.length > 0 && v.every(text) && new Set(v).size === v.length;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const selection = (v) => strings(v) && v.every((x) => /^[A-Z0-9]{4,12}$/.test(x)) && equal(v, [...v].sort());
const evidence = (v) => object(v) && text(v.source) && date(v.observedDate) && text(v.confidence)
  && ['observed', 'synthetic'].includes(v.kind);
const CONTEXT = ['modelCode', 'agModelCode', 'modelRange', 'generation', 'market', 'steering', 'locale',
  'orderDate', 'effectDate', 'catalogueDate'];
const accessories = (v) => Array.isArray(v) && (v.length === 0 || selection(v));
const FACTS = ['model', 'derivative', 'generation', 'body', 'powertrain', 'agModelCode', 'market', 'steering', 'modelYear', 'plant'];
const RETAIN = new Set(['shared-type-codes', 'resolved-selections', 'sanitised-evidence', 'provenance', 'technical-facts', 'representative-images']);
const STOPS = ['budget-exhausted', 'permission-revoked', 'identity-substitution', 'profile-mismatch', 'source-failure', 'retention-violation', 'destination-full'];
const ONEDRIVE = '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/';

/** Semantic corpus identity excludes dates, source aliases and stock/vehicle identities. */
export function configurationKey(modelCode, completeSelectedElements, selectedAccessories = []) {
  const accessories = new Set(selectedAccessories);
  const options = completeSelectedElements.filter((code) => !accessories.has(code)).map((code) => code.toUpperCase()).sort();
  return Buffer.from(`${modelCode.toUpperCase()}:${options.join(',')}`, 'utf8').toString('base64');
}

async function repositoryEvidence() {
  const [pilot, snapshot] = await Promise.all([PILOT, SNAPSHOT].map(async (p) => JSON.parse(await readFile(new URL(p, ROOT), 'utf8'))));
  const context = { modelCode: pilot.identity.modelCode, agModelCode: pilot.identity.agModelCode,
    modelRange: pilot.identity.range, generation: snapshot.model.rawModelRange, market: 'GB', steering: 'RHD',
    locale: snapshot.locale, orderDate: pilot.identity.orderDate, effectDate: pilot.identity.effectDate, catalogueDate: snapshot.observedDate };
  return { registry: createVinProfileRegistry(), catalogues: [{ id: snapshot.snapshotVersion, context,
    model: 'i5', derivative: 'i5 eDrive40 M Sport Touring', body: 'Touring', powertrain: 'electric',
    optionFamilies: Object.fromEntries(['paint', 'fabric', 'rim'].map((kind) => [kind, Object.entries(snapshot.definitions).filter(([, v]) => v.optionType === kind).map(([code]) => code)])),
    evidence: { kind: 'observed', source: SNAPSHOT, observedDate: snapshot.observedDate, confidence: 'dated selected catalogue fields' } }],
  builds: pilot.variants.map((v) => ({ id: v.id, context, constructible: v.constructible,
    resolvedModelCode: v.resolvedModelCode, requestedOptionsPreserved: v.requestedOptionsPreserved,
    completeSelectedElements: v.completeSelectedElements, seedOptions: v.seedOptions, selectedAccessories: v.selectedAccessoryCodes, evidence: { kind: 'observed', source: PILOT,
      observedDate: pilot.observedDate, confidence: 'HTTP 200 constructibility and configuration-specific OTD' } })) };
}

const fields = (names) => Object.fromEntries(names.split(' ').map((key) => [key, null]));
const EVIDENCE_SCHEMA = fields('kind source observedDate confidence');
const PLAN_SCHEMA = {
  ...fields('schemaVersion planVersion identityScope seed registryVersion'), tool: { ...EVIDENCE_SCHEMA, version: null },
  coverage: { requestedWmis: [null], additionalWmis: [null], exclusions: [fields('scope reason')], schemeModelLines: [null],
    schemeSource: { ...EVIDENCE_SCHEMA, provenanceKind: null } },
  families: [{ ...fields('familyId schemeModelLine catalogueVersion wmi profileId profileVersion plannedCount'),
    context: fields('model derivative generation body powertrain drive transmission engineCode agModelCode vgModelCode market region steering modelYear productionEra productionDate plant modelCode modelRange locale orderDate effectDate catalogueDate descriptor'),
    profileEvidence: EVIDENCE_SCHEMA, optionFamilies: { paint: [null], fabric: [null], rim: [null] },
    configurations: [{ ...fields('configurationId evidenceId selectionComplete'), seedOptions: [null], completeSelectedElements: [null], selectedAccessories: [null], evidence: EVIDENCE_SCHEMA }],
    evidence: EVIDENCE_SCHEMA, unknownFields: [null] }],
  permissions: Object.fromEntries(['sourceAccess', 'dataRetention', 'imageDisplay'].map((key) => [key, { ...EVIDENCE_SCHEMA, status: null, basis: null }])),
  work: fields('candidateRequests solverCandidates otdConfigurations imageConfigurations viewsPerConfiguration imageBytesPerView'),
  budgets: fields('requests imageRequests cacheEntries cacheBytes concurrency timeoutMs durationMs'),
  cache: { ...fields('policy key ttlMs entryBytes'), hits: fields('candidate solver otd image') },
  retry: { ...fields('maxRetries initialBackoffMs maxBackoffMs multiplier'), retryStatuses: [null] },
  retention: { fields: [null], discardPrivateIdentifiers: null },
  destinations: Object.fromEntries(['evidence', 'images'].map((key) => [key, fields('path expectedBytes public retention')])), stopConditions: [null],
};
function retainedSchema(value, schema, add, depth = 0) {
  if (value === null || value === undefined) return;
  if (depth > 24) { add('invalid-retained-schema'); return; }
  if (schema === null) { if (object(value) || Array.isArray(value)) add('unknown-retained-payload'); return; }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) { add('invalid-retained-schema'); return; }
    for (const item of value) retainedSchema(item, schema[0], add, depth + 1);
  } else if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema, key)) add('unknown-retained-payload');
      else retainedSchema(item, schema[key], add, depth + 1);
    }
  } else add('invalid-retained-schema');
}

function privateRetention(value, add, depth = 0) {
  if (depth > 24) { add('retention-depth'); return; }
  if (Array.isArray(value)) { for (const v of value) privateRetention(v, add, depth + 1); return; }
  if (object(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k !== 'discardPrivateIdentifiers' && /(?:vin|plate|vrm|serial|private|customerId|userId|identifier|employeeId|orderUuid|orderReference|garage|configurationState|capture|screenshot|identityHash|session|token|credential|apiKey)/i.test(k)) add('private-retention');
      privateRetention(v, add, depth + 1);
    }
  } else if (typeof value === 'string') {
    if (/(?:^|[^A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?:$|[^A-Z0-9])/i.test(value)
      || /\b[A-Z]{2}[0-9]{2}\s?[A-Z]{3}\b/.test(value)
      || /https?:\/\/\S*(?:[?&](?:vin|vrm|plate|serial|token|key|garage|id|customerId|userId|identifier)=|\/(?:vin|vehicle|garage|capture)\/)/i.test(value)) add('private-retention');
  }
}

/** Pure offline qualification over trusted, locally loaded evidence. Injected evidence is for isolated tests. */
export async function qualifyFleetPlan(plan, supplied) {
  const errors = []; let issueCount = 0;
  const add = (code) => { issueCount++; if (errors.length < 80 && !errors.includes(code)) errors.push(code); };
  const report = { schemaVersion: '1', planVersion: FLEET_PLAN_VERSION, qualified: false, contractQualified: false, collectionImplemented: false,
    identity: 'configurationId:Base64(vgModelCode:sorted-base-option-codes);accessories-excluded', sourceKind: 'unknown',
    coverage: { distinctProved: 0, profileQualified: 0, synthetic: 0, unresolved: 0, activeTarget: 200,
      activeShortfall: 200, legacyTarget: 10000, legacyShortfall: 10000, deferredCollection: 'FUCQ-61 after 2026-11-12', byWmi: {}, missingSchemeModels: [] },
    projection: { status: 'unavailable', reason: 'missing or invalid explicit run inputs' },
    presentation: { status: 'unqualified', selectedEquipment: 'complete resolved selection only', verifiedFitted: 'unknown',
      notice: 'No VIN generated. Structural profiles do not establish factory build or source permission.', families: [] }, errors };
  if (!object(plan)) { add('invalid-plan'); return report; }
  privateRetention(plan, add);
  retainedSchema(plan, PLAN_SCHEMA, add);
  if (errors.includes('private-retention') || errors.includes('unknown-retained-payload') || errors.includes('retention-depth')) return report;
  if (plan.schemaVersion !== '1' || plan.planVersion !== FLEET_PLAN_VERSION || plan.identityScope !== 'configuration-corpus'
    || !text(plan.seed) || !evidence(plan.tool) || plan.tool.version !== FLEET_PLAN_VERSION
    || plan.registryVersion !== 'vin-profiles.v1') add('invalid-version-or-identity');
  const syntheticContract = supplied?.syntheticContract === true;
  const families = Array.isArray(plan.families) ? plan.families : [];
  if (!families.length || families.length > 500) { add('empty-or-excessive-coverage'); return report; }
  let trusted;
  try { trusted = supplied || await repositoryEvidence(); } catch { add('evidence-unavailable'); return report; }
  if (!trusted.registry || !Array.isArray(trusted.catalogues) || !Array.isArray(trusted.builds)) { add('evidence-unavailable'); return report; }
  const wmis = plan.coverage?.requestedWmis;
  if (!strings(wmis) || wmis.some((w) => !/^[A-HJ-NPR-Z0-9]{3}$/.test(w))) add('invalid-requested-wmis');
  if (!Array.isArray(plan.coverage?.additionalWmis) || plan.coverage.additionalWmis.some((w) => !/^[A-HJ-NPR-Z0-9]{3}$/.test(w))
    || new Set(plan.coverage.additionalWmis).size !== plan.coverage.additionalWmis.length || !Array.isArray(plan.coverage?.exclusions)
    || plan.coverage.exclusions.some((v) => !object(v) || !text(v.scope) || !text(v.reason))) add('missing-exclusions');
  if (!strings(plan.coverage?.schemeModelLines) || plan.coverage?.schemeSource?.kind !== 'eligibility-only'
    || !evidence({ ...plan.coverage?.schemeSource, kind: plan.coverage?.schemeSource?.provenanceKind })) add('missing-scheme-coverage-source');
  const seen = new Set(); const ids = new Set(); const models = new Set(); const kinds = new Set();
  for (const [index, f] of families.entries()) {
    const prefix = `family-${index}`;
    if (!object(f) || !text(f.familyId) || ids.has(f.familyId)) { add(`${prefix}:invalid-family`); continue; }
    ids.add(f.familyId);
    const before = issueCount;
    if (!object(f.context) || CONTEXT.some((k) => !text(f.context[k]))
      || ['orderDate', 'effectDate', 'catalogueDate'].some((k) => !date(f.context?.[k]))
      || FACTS.some((k) => !Object.hasOwn(f.context || {}, k)) || !strings(f.unknownFields)
      || !text(f.schemeModelLine) || !evidence(f.evidence)) add(`${prefix}:missing-context-evidence`);
    const catalogue = trusted.catalogues.find((c) => c.id === f.catalogueVersion);
    if (!catalogue || !evidence(catalogue.evidence) || CONTEXT.some((k) => catalogue.context?.[k] !== f.context?.[k])
      || ['model', 'derivative', 'body', 'powertrain'].some((k) => catalogue[k] !== f.context?.[k])) add(`${prefix}:unsupported-catalogue-context`);
    if (!trusted.builds.some((v) => v.evidence?.source === f.evidence?.source && v.evidence?.kind === f.evidence?.kind
      && v.evidence?.observedDate === f.evidence?.observedDate && CONTEXT.every((k) => v.context?.[k] === f.context?.[k]))) add(`${prefix}:unqualified-family-source`);
    let profileOK = false;
    try {
      const result = await trusted.registry.resolve(f.context, { profileId: f.profileId, usage: 'current-car', referenceOnly: true, registryVersion: plan.registryVersion });
      profileOK = result.status === 'ok' && result.profile?.status === 'enabled' && result.profile.format.wmi === f.wmi
        && result.profile.profileVersion === f.profileVersion && evidence(f.profileEvidence)
        && result.profile.evidence.observedDate === f.profileEvidence.observedDate
        && result.sources?.some((s) => s.source === f.profileEvidence.source)
        && result.profile.evidence.confidence === f.profileEvidence.confidence;
    } catch { /* A failing provider is a refusal, never a nearest match. */ }
    if (!profileOK) add(`${prefix}:incompatible-or-unqualified-profile`);
    if (!object(f.optionFamilies) || ['paint', 'fabric', 'rim'].some((k) => !strings(f.optionFamilies[k]))) add(`${prefix}:missing-option-families`);
    if (object(f.optionFamilies) && ['paint', 'fabric', 'rim'].some((k) => !Array.isArray(f.optionFamilies[k])
      || f.optionFamilies[k].some((code) => !catalogue?.optionFamilies?.[k]?.includes(code)))) add(`${prefix}:unproved-option-family-classification`);
    const builds = Array.isArray(f.configurations) ? f.configurations : [];
    if (!builds.length || builds.length > 20000 || !integer(f.plannedCount, 1) || f.plannedCount !== builds.length) add(`${prefix}:unresolved-count`);
    let proved = 0; let synthetic = 0;
    for (const b of builds.slice(0, 20000)) {
      if (!object(b) || !selection(b.completeSelectedElements) || b.selectionComplete !== true
        || !selection(b.seedOptions) || !b.seedOptions.every((s) => b.completeSelectedElements?.includes(s))
        || !accessories(b.selectedAccessories) || !b.selectedAccessories.every((s) => b.completeSelectedElements?.includes(s))
        || !evidence(b.evidence)) { add(`${prefix}:incomplete-selection`); report.coverage.unresolved++; continue; }
      const key = configurationKey(text(f.context?.modelCode) ? f.context.modelCode : '', b.completeSelectedElements, b.selectedAccessories);
      if (seen.has(key)) { add(`${prefix}:duplicate-resolved-build`); continue; }
      seen.add(key);
      if (b.configurationId !== key) { add(`${prefix}:substituted-identity`); report.coverage.unresolved++; continue; }
      if (object(f.optionFamilies) && ['paint', 'fabric', 'rim'].some((k) => !(Array.isArray(f.optionFamilies[k]) && f.optionFamilies[k].some((s) => b.completeSelectedElements.includes(s))))) add(`${prefix}:missing-selected-family`);
      const source = trusted.builds.find((v) => v.id === b.evidenceId && CONTEXT.every((k) => v.context?.[k] === f.context?.[k]));
      if (!source || source.constructible !== true || source.resolvedModelCode !== f.context?.modelCode
        || source.requestedOptionsPreserved !== true || !equal(source.completeSelectedElements, b.completeSelectedElements)
        || !equal(source.seedOptions, b.seedOptions) || !equal(source.selectedAccessories, b.selectedAccessories)
        || !evidence(source.evidence) || source.evidence.kind !== b.evidence.kind || source.evidence.source !== b.evidence.source
        || source.evidence.observedDate !== b.evidence.observedDate) { add(`${prefix}:unproved-complete-build`); report.coverage.unresolved++; continue; }
      kinds.add(source.evidence.kind);
      if (source.evidence.kind === 'synthetic') { synthetic++; report.coverage.synthetic++; }
      else { proved++; report.coverage.distinctProved++; }
    }
    if (profileOK && issueCount === before) {
      report.coverage.profileQualified += proved + synthetic;
      report.coverage.byWmi[f.wmi] = (report.coverage.byWmi[f.wmi] || 0) + proved + synthetic;
      if (proved || (syntheticContract && synthetic)) models.add(f.schemeModelLine);
    }
    report.presentation.families.push({ familyId: f.familyId, sourceKind: evidence(f.evidence) ? f.evidence.kind : 'unknown',
      profileStatus: profileOK ? 'compatible-reference-only' : 'unsupported', distinctProved: proved, synthetic,
      unknownFields: Array.isArray(f.unknownFields) ? f.unknownFields.filter(text).slice(0, 30) : ['context'],
      source: evidence(f.evidence) ? { source: f.evidence.source, observedDate: f.evidence.observedDate, confidence: f.evidence.confidence } : null });
  }
  for (const w of Array.isArray(wmis) ? wmis.filter((v) => typeof v === 'string' && /^[A-HJ-NPR-Z0-9]{3}$/.test(v)) : []) if ((report.coverage.byWmi[w] || 0) < 2) add(`wmi-multiple-configurations-required:${w}`);
  report.coverage.missingSchemeModels = (Array.isArray(plan.coverage?.schemeModelLines) ? plan.coverage.schemeModelLines.filter(text).slice(0, 500) : []).filter((m) => !models.has(m));
  report.coverage.activeShortfall = Math.max(0, 200 - report.coverage.distinctProved);
  report.coverage.legacyShortfall = Math.max(0, 10000 - report.coverage.distinctProved);
  if ((syntheticContract ? report.coverage.profileQualified < 200 : report.coverage.activeShortfall) || report.coverage.missingSchemeModels.length) add('active-demo-route-shortfall');
  report.sourceKind = kinds.size === 1 ? [...kinds][0] : kinds.size ? 'mixed' : 'unknown';
  const operationalEvidence = [plan.tool, ...Object.values(plan.permissions || {}),
    { kind: plan.coverage?.schemeSource?.provenanceKind }, ...families.flatMap((f) => object(f) ? [f.evidence, f.profileEvidence,
      ...((Array.isArray(f.configurations) ? f.configurations : []).map((b) => b?.evidence))] : []),
    ...trusted.catalogues.filter((c) => families.some((f) => f?.catalogueVersion === c.id)).map((c) => c.evidence)];
  for (const e of operationalEvidence) if (['observed', 'synthetic'].includes(e?.kind)) kinds.add(e.kind);
  const realEvidence = operationalEvidence.every((e) => e?.kind === 'observed');
  if (!syntheticContract && !realEvidence) add('unqualified-operational-provenance');
  report.sourceKind = kinds.size === 1 ? [...kinds][0] : kinds.size ? 'mixed' : 'unknown';
  validateRun(plan, report, add);
  report.contractQualified = errors.length === 0;
  report.qualified = report.contractQualified && report.coverage.synthetic === 0 && realEvidence;
  if (syntheticContract) report.contractOnly = true;
  report.presentation.status = report.qualified ? 'qualified-offline-plan' : report.contractQualified ? 'synthetic-contract-only' : 'unqualified';
  return report;
}

function validateRun(plan, report, add) {
  for (const permission of ['sourceAccess', 'dataRetention', 'imageDisplay']) {
    const p = plan.permissions?.[permission];
    if (!object(p) || p.status !== 'approved' || !evidence(p) || !text(p.basis)) add(`permission-unselected:${permission}`);
  }
  const retained = plan.retention;
  if (!strings(retained?.fields) || retained.fields.some((f) => !RETAIN.has(f)) || retained.discardPrivateIdentifiers !== true) add('invalid-retention');
  for (const kind of ['evidence', 'images']) {
    const d = plan.destinations?.[kind];
    if (!object(d) || !text(d.path) || !path.isAbsolute(d.path) || path.normalize(d.path) !== d.path
      || !integer(d.expectedBytes) || d.public !== false || d.retention !== 'reusable-non-personal'
      || (d.expectedBytes >= 256 * 1024 * 1024 && !d.path.startsWith(ONEDRIVE))) add(`invalid-destination:${kind}`);
  }
  const b = plan.budgets; const c = plan.cache; const r = plan.retry; const work = plan.work;
  const limitKeys = ['requests', 'imageRequests', 'cacheEntries', 'cacheBytes', 'concurrency', 'timeoutMs', 'durationMs'];
  const limitsOK = object(b) && limitKeys.every((k) => integer(b[k], ['concurrency', 'timeoutMs', 'durationMs'].includes(k) ? 1 : 0));
  const retryOK = object(r) && integer(r.maxRetries) && r.maxRetries <= 20 && integer(r.initialBackoffMs)
    && integer(r.maxBackoffMs) && r.initialBackoffMs <= r.maxBackoffMs && Number.isFinite(r.multiplier)
    && r.multiplier >= 1 && r.multiplier <= 10 && Array.isArray(r.retryStatuses)
    && r.retryStatuses.every((v) => [429, 500, 502, 503, 504].includes(v));
  const cacheOK = object(c) && ['cold', 'verified-hits'].includes(c.policy) && c.key === 'full-context+complete-selection+provider-version'
    && integer(c.ttlMs, 1) && integer(c.entryBytes, 1) && object(c.hits)
    && ['candidate', 'solver', 'otd', 'image'].every((k) => integer(c.hits[k]));
  const workOK = object(work) && ['candidateRequests', 'solverCandidates', 'otdConfigurations', 'imageConfigurations', 'viewsPerConfiguration', 'imageBytesPerView'].every((k) => integer(work[k]))
    && work.solverCandidates >= report.coverage.distinctProved + report.coverage.synthetic
    && work.otdConfigurations >= report.coverage.distinctProved + report.coverage.synthetic;
  if (!limitsOK) add('missing-numeric-budgets');
  if (!retryOK) add('invalid-retry-backoff');
  if (!cacheOK) add('invalid-cache-policy');
  if (!workOK) add('invalid-work-counts');
  if (!strings(plan.stopConditions) || STOPS.some((s) => !plan.stopConditions.includes(s))) add('missing-stop-conditions');
  if (!(limitsOK && retryOK && cacheOK && workOK)) return;
  const base = { candidate: work.candidateRequests, solver: work.solverCandidates, otd: work.otdConfigurations,
    image: work.imageConfigurations * (1 + work.viewsPerConfiguration) };
  const misses = {}; const worstCase = {};
  for (const k of Object.keys(base)) {
    if (!integer(base[k]) || c.hits[k] > base[k] || (c.policy === 'cold' && c.hits[k] !== 0)) { add('invalid-cache-hit-counts'); return; }
    if (c.hits[k] > 0) add('unproved-cache-hits');
    misses[k] = base[k]; worstCase[k] = misses[k] * (1 + r.maxRetries);
  }
  const totalRequests = Object.values(worstCase).reduce((a, v) => a + v, 0);
  const cacheEntries = Object.values(base).reduce((a, v) => a + v, 0); const cacheBytes = cacheEntries * c.entryBytes;
  let backoffMs = 0;
  for (let i = 0; i < r.maxRetries; i++) backoffMs += Math.min(r.maxBackoffMs, r.initialBackoffMs * r.multiplier ** i);
  // Serial upper bound remains conservative under any chosen concurrency and dependency ordering.
  const imageBytes = work.imageConfigurations * work.viewsPerConfiguration * work.imageBytesPerView;
  const durationMs = totalRequests * b.timeoutMs + Object.values(misses).reduce((a, v) => a + v, 0) * backoffMs;
  if (![totalRequests, cacheEntries, cacheBytes, durationMs, imageBytes].every((v) => integer(v))) { add('projection-overflow'); return; }
  report.projection = { status: 'available', base, declaredHits: Object.fromEntries(Object.keys(base).map((k) => [k, c.hits[k]])), hits: Object.fromEntries(Object.keys(base).map((k) => [k, 0])), misses, worstCase, totalRequests,
    imageRequests: worstCase.image, imageBytes, cacheEntries, cacheBytes, backoffPerMissMs: backoffMs, serialWorstCaseDurationMs: durationMs,
    concurrency: b.concurrency, retryPolicy: 'Every declared request is a miss; positive cache hits refuse until trusted exact-key cache evidence is implemented' };
  if (cacheBytes > plan.destinations?.evidence?.expectedBytes) add('insufficient-evidence-destination');
  if (imageBytes > plan.destinations?.images?.expectedBytes) add('insufficient-image-destination');
  if (totalRequests > b.requests || worstCase.image > b.imageRequests || cacheEntries > b.cacheEntries
    || cacheBytes > b.cacheBytes || durationMs > b.durationMs) add('budget-exceeded');
}

export async function runCli(argv, { loadConfig = async (p) => JSON.parse(await readFile(p, 'utf8')), qualificationOptions, write = (s) => process.stdout.write(s) } = {}) {
  if (argv.length !== 3 || argv[0] !== '--config' || !text(argv[1]) || argv[2] !== '--offline') {
    write(`${JSON.stringify({ qualified: false, collectionImplemented: false, errors: ['offline-only: use --config PATH --offline; real collection is not implemented'] })}\n`); return 2;
  }
  try {
    const report = await qualifyFleetPlan(await loadConfig(argv[1]), qualificationOptions);
    write(`${JSON.stringify(report, null, 2)}\n`); return report.contractQualified ? 0 : 1;
  } catch { write(`${JSON.stringify({ qualified: false, errors: ['config-unavailable-or-invalid'] })}\n`); return 2; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
