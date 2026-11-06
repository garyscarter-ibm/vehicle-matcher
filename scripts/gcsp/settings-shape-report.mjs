import { createHash } from 'node:crypto';
import { assertCollectionHttpObservation } from './collection-session.mjs';
import { requireValue } from './configuration-key.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => object(value) && Object.keys(value).length === names.length
  && names.every((name) => Object.hasOwn(value, name));
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 30000;
const labels = { tree: 'settingsVehicleTree', localisation: 'settingsLocalisation' };
const kinds = ['missing', 'null', 'object', 'array', 'string', 'number', 'boolean'];
const kind = (value, present = true) => !present ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const invalid = (ok) => requireValue(ok, 'settings-shape-report-invalid', 'The fixed settings refusal report failed validation.');
const flags = ['missingProfile', 'multipleProfiles', 'missingCandidate', 'multipleCandidates', 'conflictingCandidates', 'empty', 'oversized', 'wrongType'];

// Only fixed fields escape this traversal. Profile/header strings stay local and are never hashed.
function inspectRole(settings, label) {
  const row = { profileMatches: 0, profileNodeKinds: { object: 0, array: 0 }, exactLabelObjectKeys: 0, exactLabelScalarValues: 0,
    candidates: { directProperty: 0, nameValue: 0, distinctValues: 0 },
    flags: Object.fromEntries(flags.map((name) => [name, false])), strictVerdict: 'refused',
    traversal: { visited: 0, maxDepth: 0, limited: false, countsCapped: false } };
  const profiles = []; const unique = new Set();
  const add = (target, field) => { if (target[field] < 30000) target[field] += 1; else row.traversal.countsCapped = true; };
  const stop = {};
  const visit = (value, callback, name = '', depth = 0) => {
    if (!object(value) && !Array.isArray(value)) return;
    if (row.traversal.visited === 30000 || depth > 24) { row.traversal.limited = true; throw stop; }
    row.traversal.visited += 1; row.traversal.maxDepth = Math.max(row.traversal.maxDepth, depth);
    callback(value, name);
    for (const [key, entry] of Object.entries(value)) if (entry && typeof entry === 'object') visit(entry, callback, key, depth + 1);
  };
  const candidate = (value, field) => {
    if (typeof value !== 'string') { row.flags.wrongType = true; return; }
    add(row.candidates, field);
    if (unique.size < 30000) unique.add(value); else if (!unique.has(value)) row.traversal.countsCapped = true;
    row.flags.empty ||= value.length === 0; row.flags.oversized ||= value.length > 4096;
  };
  try {
    // Keep the document guard; only the canonical profile contributes role and candidate counts.
    visit(settings, () => {});
    const app = object(settings) && Object.hasOwn(settings, 'APP') ? settings.APP : undefined;
    const backend = object(app) && Object.hasOwn(app, 'backend') ? app.backend : undefined;
    const present = object(backend) && Object.hasOwn(backend, label);
    const profile = present ? backend[label] : undefined;
    if (present) add(row, 'exactLabelObjectKeys');
    if (object(backend)) for (const value of Object.values(backend)) if (value === label) add(row, 'exactLabelScalarValues');
    if (object(profile) || Array.isArray(profile)) {
      add(row, 'profileMatches'); add(row.profileNodeKinds, Array.isArray(profile) ? 'array' : 'object'); profiles.push(profile);
    }
    for (const profile of profiles) visit(profile, (value) => {
      for (const [name, entry] of Object.entries(value)) {
        if (name === label) {
          add(row, 'exactLabelObjectKeys');
          if (object(entry) || Array.isArray(entry)) { add(row, 'profileMatches'); add(row.profileNodeKinds, Array.isArray(entry) ? 'array' : 'object'); }
        }
        if (entry === label) add(row, 'exactLabelScalarValues');
        if (name.toLowerCase() === 'x-api-key') candidate(entry, 'directProperty');
      }
      if (typeof value.name === 'string' && value.name.toLowerCase() === 'x-api-key') candidate(value.value, 'nameValue');
    });
  } catch (error) { if (error !== stop) throw error; }
  row.candidates.distinctValues = unique.size;
  const occurrences = row.candidates.directProperty + row.candidates.nameValue;
  const complete = !row.traversal.limited && !row.traversal.countsCapped;
  row.flags.missingProfile = complete && row.profileMatches === 0;
  row.flags.multipleProfiles = row.profileMatches > 1;
  row.flags.missingCandidate = complete && occurrences === 0;
  row.flags.multipleCandidates = occurrences > 1;
  row.flags.conflictingCandidates = unique.size > 1;
  row.strictVerdict = !complete ? 'unresolved-limit'
    : row.profileMatches === 1 && row.profileNodeKinds.object === 1 && row.exactLabelObjectKeys === 1
      && occurrences === 1 && unique.size === 1 && !row.flags.empty && !row.flags.oversized && !row.flags.wrongType ? 'accepted' : 'refused';
  return row;
}

export function validateSettingsShapeRefusal(report, { plan, mode }) {
  const scoped = report?.schemaVersion === 'bmw-settings-shape-refusal.v2';
  invalid(exact(report, ['schemaVersion', 'qualification', 'admission', 'failedRole', 'reason', 'observation', 'layout', 'roles', ...(scoped ? ['selection'] : [])])
    && (scoped ? report.selection === 'APP.backend.own-property' : report.schemaVersion === 'bmw-settings-shape-refusal.v1') && report.qualification === 'unqualified-structural-observation'
    && report.admission === false && typeof report.failedRole === 'string' && Object.hasOwn(labels, report.failedRole)
    && ['settings-header-shape', 'settings-traversal-limit'].includes(report.reason));
  const observation = report.observation;
  invalid(exact(observation, ['schemaVersion', 'operation', 'sourceId', 'sourceVersion', 'capability', 'transportKind', 'request', 'observedAt', 'responseBytes', 'responseSha256'])
    && observation.schemaVersion === 'collection-http-observation.v1' && observation.operation === 'settings'
    && observation.sourceId === plan.source.id && observation.sourceVersion === plan.source.version && observation.capability === 'bmw-settings'
    && ['source-fixture', 'live'].includes(mode) && observation.transportKind === (mode === 'live' ? 'live' : 'fixture')
    && exact(observation.request, ['method', 'url']) && observation.request.method === 'GET'
    && typeof observation.request.url === 'string' && /^https:\/\/configure\.bmw\.co\.uk\/en_GB\/settings\.[A-Za-z0-9]+\.json$/.test(observation.request.url)
    && typeof observation.observedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observation.observedAt)
    && Number.isFinite(Date.parse(observation.observedAt)) && new Date(observation.observedAt).toISOString() === observation.observedAt
    && observation.observedAt.slice(0, 10) === plan.qualificationDate
    && Number.isSafeInteger(observation.responseBytes) && observation.responseBytes >= 0 && observation.responseBytes <= plan.limits.responseBytes
    && typeof observation.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(observation.responseSha256));
  invalid(exact(report.layout, ['status', 'appKind', 'backendKind']) && report.layout.status === 'unverified'
    && kinds.includes(report.layout.appKind) && kinds.includes(report.layout.backendKind) && exact(report.roles, ['tree', 'localisation']));
  for (const role of Object.keys(labels)) {
    const row = report.roles[role];
    invalid(exact(row, ['profileMatches', 'profileNodeKinds', 'exactLabelObjectKeys', 'exactLabelScalarValues', 'candidates', 'flags', 'strictVerdict', 'traversal'])
      && count(row.profileMatches) && count(row.exactLabelObjectKeys) && count(row.exactLabelScalarValues)
      && exact(row.profileNodeKinds, ['object', 'array']) && Object.values(row.profileNodeKinds).every(count)
      && row.profileMatches === row.profileNodeKinds.object + row.profileNodeKinds.array
      && exact(row.candidates, ['directProperty', 'nameValue', 'distinctValues']) && Object.values(row.candidates).every(count)
      && row.candidates.distinctValues <= row.candidates.directProperty + row.candidates.nameValue
      && exact(row.flags, flags) && Object.values(row.flags).every((value) => typeof value === 'boolean')
      && exact(row.traversal, ['visited', 'maxDepth', 'limited', 'countsCapped']) && count(row.traversal.visited)
      && Number.isSafeInteger(row.traversal.maxDepth) && row.traversal.maxDepth >= 0 && row.traversal.maxDepth <= 24
      && typeof row.traversal.limited === 'boolean' && typeof row.traversal.countsCapped === 'boolean'
      && ['accepted', 'refused', 'unresolved-limit'].includes(row.strictVerdict));
    const occurrences = row.candidates.directProperty + row.candidates.nameValue;
    const complete = !row.traversal.limited && !row.traversal.countsCapped;
    const strict = complete && row.profileMatches === 1 && occurrences === 1 && row.candidates.distinctValues === 1 && !row.flags.empty && !row.flags.oversized
      && (!scoped || row.profileNodeKinds.object === 1 && row.exactLabelObjectKeys === 1 && !row.flags.wrongType);
    invalid(row.flags.missingProfile === (complete && row.profileMatches === 0) && row.flags.multipleProfiles === (row.profileMatches > 1)
      && row.flags.missingCandidate === (complete && occurrences === 0) && row.flags.multipleCandidates === (occurrences > 1)
      && row.flags.conflictingCandidates === (row.candidates.distinctValues > 1)
      && row.strictVerdict === (!complete ? 'unresolved-limit' : strict ? 'accepted' : 'refused'));
  }
  invalid(report.roles[report.failedRole].strictVerdict !== 'accepted'
    && (report.reason !== 'settings-traversal-limit' || report.roles[report.failedRole].traversal.limited));
  // Exact schemas reject every unreviewed field before any clone, persistence or receipt serialization.
  return structuredClone(report);
}

export function createSettingsShapeRefusal({ settings, failedRole, reason, metadata, plan }) {
  assertCollectionHttpObservation(metadata);
  const appPresent = object(settings) && Object.hasOwn(settings, 'APP'); const app = appPresent ? settings.APP : undefined;
  const backendPresent = object(app) && Object.hasOwn(app, 'backend');
  const report = { schemaVersion: 'bmw-settings-shape-refusal.v2', selection: 'APP.backend.own-property', qualification: 'unqualified-structural-observation', admission: false,
    failedRole, reason, observation: structuredClone(metadata),
    layout: { status: 'unverified', appKind: kind(app, appPresent), backendKind: kind(backendPresent ? app.backend : undefined, backendPresent) },
    roles: Object.fromEntries(Object.entries(labels).map(([role, label]) => [role, inspectRole(settings, label)])) };
  return validateSettingsShapeRefusal(report, { plan, mode: metadata.transportKind === 'live' ? 'live' : 'source-fixture' });
}

export function settingsShapeReceiptBytes(report, context) {
  const safe = validateSettingsShapeRefusal(report, context);
  const receipt = { schemaVersion: 'bmw-settings-shape-refusal-receipt.v1', qualification: 'unqualified-structural-observation',
    admission: false, accepted: [], distinctConfigurations: 0, settingsShapeRefusal: safe };
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  invalid(bytes.length <= 16384);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
