import { dirname, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildBmwSelectionBinding, qualifyBmwSelectionRecord, createBmwSelectionRegistration } from './bmw-selection-binding.mjs';
import { open } from 'node:fs/promises';
import { settingsShapeReceiptBytes, validateSettingsShapeRefusal } from './settings-shape-report.mjs';
import { fileURLToPath } from 'node:url';
import { createCollectionSession, readCollectionJson as readBounded } from './collection-session.mjs';
import { bmwCatalogueLookupIdentity } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { CollectionError, createConfigurationKey, normaliseCode, normaliseCodes, requireValue } from './configuration-key.mjs';
import { publicBmwOperations, publicBmwObservation, validatePublicBmwPlan,
  publicBmwQualificationOperations, validatePublicBmwDiagnosticPlan, qualifyPublicBmwDiagnosticFields,
  validatePublicBmwContextPlan, publicBmwContextOperations, validatePublicBmwContextObservation,
  validatePublicBmwOptionsPlan, publicBmwOptionsOperations, validatePublicBmwOptionsObservations } from './public-bmw-source.mjs';
import { publicBmwCompleteSelectionOperations } from './capture-bmw-selection.mjs';
import { BMW_BATCH_SOURCE_VERSION, BMW_MODEL_BATCH_SOURCE_VERSION, isBmwBatchPlan, bmwBatchPlanRequestUrls } from './bmw-public-registration.mjs';

export const COLLECTOR_VERSION = '2';
const CONTEXT = ['catalogueDate', 'market', 'locale', 'orderDate', 'effectDate', 'productionDate', 'taxDate'];
const MODEL = ['modelCode', 'agModelCode', 'modelRange', 'rawModelRange', 'trim'];
const TYPES = ['option', 'paint', 'upholstery', 'accessory'];
const NO_TRAFFIC = ['dry-run', 'ci', 'lookup', 'demo-start'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => inputDigest(a) === inputDigest(b);
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const version = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(value);
const freshCounts = () => ({ sourceCalls: 0, operations: { discover: 0, solve: 0 }, cacheHits: { discover: 0, solve: 0 },
  failures: 0, timeouts: 0, substitutions: 0, cacheEvictions: 0 });

function validatePlan(plan) {
  const l = plan?.limits;
  requireValue(object(plan) && plan.schemaVersion === '1' && version(plan.planId) && version(plan.version)
    && version(plan.seed) && object(plan.source) && version(plan.source.id) && version(plan.source.version)
    && object(plan.policyRead) && version(plan.policyRead.policyVersion)
    && typeof plan.policyRead.asOf === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(plan.policyRead.asOf)
    && Number.isFinite(Date.parse(plan.policyRead.asOf))
    && object(plan.context) && (plan.source.kind === 'public-bmw-uk' || CONTEXT.every((key) => typeof plan.context[key] === 'string'))
    && Array.isArray(plan.models) && plan.models.length > 0 && plan.models.length <= 100
    && plan.models.every((code) => typeof code === 'string' && /^[A-Z0-9]{4,12}$/.test(code))
    && new Set(plan.models).size === plan.models.length && bounded(plan.target, 1, 10000)
    && object(l) && bounded(l.maxCandidates, 1, 10000) && bounded(plan.candidateCount, 1, l.maxCandidates)
    && bounded(l.maxAttempts, 1, 5) && bounded(l.operationTimeoutMs, 1, 300000)
    && bounded(l.deadlineMs, 1, 3600000) && bounded(l.retryDelayMs, 0, 60000) && l.concurrency === 1
    && bounded(l.cacheEntries, 1, 10000) && bounded(l.cacheRetentionMs, 1, 7 * 86400000)
    && bounded(l.checkpointBytes, 1024, 16 * 1024 * 1024) && l.imageRequests === 0
    && object(l.requestBudgets) && ['discover', 'solve'].every((key) => bounded(l.requestBudgets[key], 0, 100000))
    && (plan.candidates === undefined || (Array.isArray(plan.candidates) && plan.candidates.length <= l.maxCandidates)),
  'invalid-plan', 'Supply a finite versioned plan with explicit offline budgets; supported concurrency is one and image requests are zero.');
  if (plan.source.kind === 'public-bmw-uk') validatePublicBmwPlan(plan);
  return structuredClone(plan);
}

/** F77 can select a bounded subset of an explicit plan without maintaining another collector. */
export function selectPlan(plan, modelCodes) {
  validatePlan(plan);
  const models = normaliseCodes(modelCodes);
  requireValue(models.length > 0 && models.every((code) => plan.models.includes(code)), 'unplanned-model', 'Select models already present in the plan.');
  return { ...structuredClone(plan), models,
    ...(plan.candidates ? { candidates: plan.candidates.filter((row) => models.includes(normaliseCode(row.modelCode))) } : {}) };
}

function sourceDefinitions(rows) {
  requireValue(Array.isArray(rows) && rows.length > 0 && rows.length <= 512, 'invalid-discovery', 'The source must define the selectable elements.');
  const definitions = rows.map((row) => {
    const code = normaliseCode(row?.code);
    requireValue(TYPES.includes(row?.type) && (!code.startsWith('SE') || row.type === 'accessory'),
      'invalid-discovery', 'Factory options and dealer accessories need separate source types.');
    return { code, type: row.type, aliases: normaliseCodes(row.aliases || []) };
  }).sort((a, b) => a.code.localeCompare(b.code));
  requireValue(new Set(definitions.map((row) => row.code)).size === definitions.length, 'invalid-discovery', 'Source definitions must be unique.');
  const aliases = {};
  for (const row of definitions) for (const alias of row.aliases) {
    requireValue(!Object.hasOwn(aliases, alias) || aliases[alias] === row.code, 'invalid-alias', 'Source aliases cannot identify two codes.');
    requireValue(!definitions.some((entry) => entry.code === alias && entry.code !== row.code), 'invalid-alias', 'An alias cannot replace another canonical code.');
    aliases[alias] = row.code;
  }
  return { definitions, aliases };
}

function normaliseDiscovery(plan, value) {
  requireValue(value?.schemaVersion === '1' && object(value.context) && CONTEXT.every((key) => value.context[key] === plan.context[key]),
    'discovery-context-mismatch', 'Discover the exact planned market, locale and dates.');
  requireValue(Array.isArray(value.models) && value.models.length > 0 && value.models.length <= 100, 'invalid-discovery', 'Bounded model mapping is required.');
  const models = [];
  for (const code of plan.models) {
    const matches = value.models.filter((row) => normaliseCode(row.modelCode) === code);
    requireValue(matches.length === 1, 'invalid-discovery', 'Every planned model needs exactly one real VG/AG mapping.');
    const row = matches[0]; const fields = Object.fromEntries(MODEL.map((key) => [key, normaliseCode(row[key])]));
    const { definitions, aliases } = sourceDefinitions(row.definitions);
    const baseElements = normaliseCodes(row.baseElements, aliases);
    requireValue(baseElements.length > 0 && baseElements.every((element) => definitions.some((d) => d.code === element)),
      'invalid-discovery', 'The complete base request must use discovered elements.');
    models.push({ ...fields, definitions, baseElements });
  }
  return { schemaVersion: '1', context: structuredClone(plan.context), models };
}

/** Seeded requests are only candidates; the solver, never the generator, establishes selection. */
export function buildCandidateQueue(input, sourceDiscovery) {
  const plan = validatePlan(input);
  if (isBmwBatchPlan(plan)) {
    const definitions = sourceDiscovery?.definitions;
    requireValue(Array.isArray(definitions) && definitions.length > 0 && definitions.length <= 512,
      'invalid-discovery', 'Enumerate only bounded actual typed definitions.');
    const groups = ['paint', 'fabric', 'rim'].map((type) => definitions.filter((row) => row.optionType === type && row.option === row.code
      && Array.isArray(row.issues) && row.issues.length === 0).map((row) => normaliseCode(row.code)).sort());
    const size = groups.reduce((n, rows) => n * rows.length, 1);
    requireValue(groups.every((rows) => rows.length > 0 && new Set(rows).size === rows.length) && size <= 10000
      && size >= plan.candidateCount, 'invalid-discovery', 'The bounded source candidate space must cover the selected finite request count.');
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    let stride = Math.floor(Math.sqrt(size)) + 1; while (gcd(stride, size) !== 1) stride += 1;
    const offset = parseInt(inputDigest({ seed: plan.seed, model: plan.models[0] }).slice(0, 8), 16) % size;
    return Array.from({ length: plan.candidateCount }, (_, index) => {
      let ordinal = (offset + index * stride) % size;
      const includedElements = groups.map((rows) => { const value = rows[ordinal % rows.length]; ordinal = Math.floor(ordinal / rows.length); return value; });
      const mandatoryElements = plan.source.version === BMW_MODEL_BATCH_SOURCE_VERSION
        ? plan.lineRegistration.optionsQuery.kind === 'trim' ? [plan.lineRegistration.optionsQuery.code] : []
        : [plan.modelRegistration.optionsTrim || 'S0337'];
      const request = { includedElements: normaliseCodes([...includedElements, ...mandatoryElements, ...(plan.candidateBaseElements || [])]), mandatoryElements };
      return { candidateId: 'candidate-' + inputDigest({ model: plan.models[0], request }).slice(0, 24), request };
    });
  }
  const discovered = normaliseDiscovery(plan, sourceDiscovery); const candidates = [];
  for (const model of discovered.models) {
    const { definitions, aliases } = sourceDefinitions(model.definitions);
    const explicit = plan.candidates?.filter((row) => normaliseCode(row.modelCode) === model.modelCode);
    const selections = explicit ? explicit.map((row) => row.elements) : Array.from({ length: plan.candidateCount }, (_, index) =>
      [...model.baseElements, ...definitions.filter((row) => !model.baseElements.includes(row.code)
        && index > 0 && parseInt(inputDigest([plan.seed, model.modelCode, index, row.code]).slice(0, 2), 16) % 2 === 0).map((row) => row.code)]);
    for (const selection of selections) {
      const elements = normaliseCodes(selection, aliases);
      requireValue(elements.length > 0 && elements.every((code) => definitions.some((row) => row.code === code)), 'invalid-candidate', 'Candidates use discovered selectable codes.');
      const request = { ...plan.context, ...Object.fromEntries(MODEL.map((key) => [key, model[key]])), elements,
        selectedAccessories: elements.filter((code) => definitions.find((row) => row.code === code).type === 'accessory')
          .map((code) => ({ code, type: 'accessory', quantity: 1 })) };
      candidates.push({ candidateId: inputDigest(request), request, definitions });
    }
  }
  const unique = [...new Map(candidates.map((row) => [row.candidateId, row])).values()];
  requireValue(unique.length <= plan.limits.maxCandidates, 'candidate-budget', 'The requested model/candidate set exceeds the explicit queue budget.');
  return unique.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

export function validateSolverResponse(candidate, response, key) {
  const { request } = candidate; const { definitions, aliases } = sourceDefinitions(candidate.definitions);
  requireValue(response?.status === 'ok' && response.selectionComplete === true && response.resolvedIdentity?.selectionComplete === true,
    'incomplete-solver-selection', 'Only successful complete solver selections are configurations.');
  const resolved = response.resolvedIdentity;
  requireValue([...CONTEXT, ...MODEL].every((field) => resolved[field] === request[field]), 'solver-context-substitution', 'The solver substituted the model, mapping, market, locale or dated context.');
  const options = normaliseCodes(resolved.selectedOptions, aliases);
  requireValue(options.length > 0 && options.length <= 256 && Array.isArray(resolved.selectedAccessories)
    && resolved.selectedAccessories.length <= 64 && Array.isArray(response.selectedElements)
    && response.selectedElements.length <= 320, 'incomplete-solver-selection', 'The complete factory selection and typed element set are required.');
  const accessories = resolved.selectedAccessories.map((row) => {
    const [code] = normaliseCodes([row.code], aliases);
    requireValue(row.type === 'accessory' && bounded(row.quantity, 1, 999), 'inconsistent-solver-selection', 'Accessories need a code, type and positive quantity.');
    return { code, type: 'accessory', quantity: row.quantity };
  }).sort((a, b) => a.code.localeCompare(b.code));
  requireValue(new Set(accessories.map((row) => row.code)).size === accessories.length, 'inconsistent-solver-selection', 'Accessories must be unique.');
  const elements = response.selectedElements.map((row) => {
    const [code] = normaliseCodes([row.code], aliases); const definition = definitions.find((d) => d.code === code);
    requireValue(definition?.type === row.type, 'inconsistent-solver-selection', 'Retain each selected element with its discovered source type.');
    return row.type === 'accessory' ? { code, type: row.type, quantity: row.quantity } : { code, type: row.type };
  }).sort((a, b) => a.code.localeCompare(b.code));
  requireValue(new Set(elements.map((row) => row.code)).size === elements.length
    && same(elements.filter((row) => row.type === 'accessory'), accessories)
    && same(elements.filter((row) => row.type !== 'accessory').map((row) => row.code), options),
  'inconsistent-solver-selection', 'Typed complete elements must agree exactly with the resolved factory/accessory selections.');
  requireValue(elements.some((row) => row.type === 'paint') && elements.some((row) => row.type === 'upholstery')
    && options.includes(resolved.trim), 'incomplete-solver-selection', 'Retain complete paint, upholstery, trim and equipment selection.');
  const all = elements.map((row) => row.code); const requestedCodes = request.elements;
  const ignored = normaliseCodes(response.ignoredCodes || [], aliases);
  requireValue(ignored.every((code) => requestedCodes.includes(code) && !all.includes(code)), 'invalid-solver-changes', 'Only an unselected request can be reported ignored.');
  const catalogueRequest = { ...Object.fromEntries([...CONTEXT, ...MODEL].map((field) => [field, resolved[field]])),
    selectedOptions: options, selectedAccessories: accessories, selectionComplete: true };
  const lookupIdentity = bmwCatalogueLookupIdentity(catalogueRequest);
  requireValue(lookupIdentity, 'invalid-catalogue-identity', 'The resolved selection must satisfy the existing F39 dated catalogue contract.');
  const identity = key({ vgModelCode: resolved.modelCode, agModelCode: resolved.agModelCode, factoryOptionCodes: options });
  return { ...identity, modelRange: resolved.modelRange, resolvedOptions: options, selectedAccessories: accessories,
    selectedElements: elements, catalogueRequest, lookupIdentity,
    solverChanges: { added: all.filter((code) => !requestedCodes.includes(code)),
      removed: requestedCodes.filter((code) => !all.includes(code) && !ignored.includes(code)), ignored } };
}

/** No default network transport exists. Only an explicitly injected offline source is executable here. */
export async function createFleetCollector({ plan: input, source, policyService, policyRead, statePath,
  operations = {}, http, mode = 'dry-run', now = Date.now, onPhase = async () => {}, captureReplay, batchBinding, continuation } = {}) {
  const plan = validatePlan(input);
  if (mode === 'capture-replay' || captureReplay !== undefined) {
    requireValue(mode === 'capture-replay' && plan.captureVersion === 'bmw-complete-selection.v1'
      && plan.source.kind === 'public-bmw-uk' && object(captureReplay) && http === undefined
      && policyRead === undefined, 'capture-replay-required', 'Use the explicit capture version and server-owned replay registration without transport.');
    return createCaptureReplayCollector({ plan, captureReplay, policyService, statePath, operations, now, onPhase });
  }
  if (plan.source.kind === 'public-bmw-uk' && !NO_TRAFFIC.includes(mode)) {
    if (isBmwBatchPlan(plan))
      return createPublicBatchCollector({ plan, source, policyService, policyRead, statePath, operations, http, mode, now, onPhase, batchBinding, continuation });
    return createPublicCollector({ plan, source, policyService, policyRead, statePath, operations, http, mode, now, onPhase });
  }
  requireValue(mode !== 'live', 'live-source-unallocated', 'Live source execution requires the qualified public-source plan and explicit allocation.');
  requireValue(mode === 'offline' || NO_TRAFFIC.includes(mode), 'invalid-mode', 'Choose explicit offline execution or a no-traffic inspection mode.');
  if (NO_TRAFFIC.includes(mode)) return { run: async () => ({ status: 'incomplete', reason: mode, accepted: [], rejected: [], duplicates: [], counts: freshCounts(), coverage: { distinctConfigurations: 0, target: plan.target } }) };
  requireValue(source?.kind === 'offline' && version(source.version) && typeof source.discover === 'function' && typeof source.solve === 'function',
    'offline-source-required', 'Offline execution requires explicitly injected offline catalogue/solver functions.');
  requireValue(typeof statePath === 'string' && isAbsolute(statePath), 'explicit-path-required', 'Supply an absolute owned checkpoint path.');
  requireValue(policyRead === undefined || policyRead.asOf === plan.policyRead.asOf
    && policyRead.policyVersion === plan.policyRead.policyVersion, 'policy-read-mismatch', 'Use the explicit policy date/version pinned by the plan.');
  const key = await createConfigurationKey({ policyService,
    policyRead: { runId: `collector-${plan.planId}`, ...policyRead, ...plan.policyRead } });
  const identity = { planDigest: inputDigest(plan), sourceVersion: source.version, toolVersion: COLLECTOR_VERSION,
    signaturePolicyVersion: key.policyVersion, mode };
  const session = await createCollectionSession({ identity, limits: plan.limits, statePath, now, onPhase,
    initialState: { queue: null, cursor: 0, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => requireValue((state.queue === null || (Array.isArray(state.queue) && state.queue.length <= plan.limits.maxCandidates))
      && bounded(state.cursor, 0, state.queue?.length || 0)
      && ['accepted', 'rejected', 'duplicates'].every((field) => Array.isArray(state[field]) && state[field].length <= plan.limits.maxCandidates),
    'checkpoint-corrupt', 'The collector queue or outcome state is invalid.'),
    operations: {
      ...operations,
      discover: { sourceId: plan.source.id, sourceVersion: source.version, kind: 'offline',
        execute: (request, options) => source.discover(request, options), project: (value) => normaliseDiscovery(plan, value) },
      solve: { sourceId: plan.source.id, sourceVersion: source.version, kind: 'offline',
        execute: (request, options) => source.solve(request, options),
        project: (value) => {
          requireValue(object(value), 'invalid-solver-response', 'The solver response must be an object.');
          const resolved = value.resolvedIdentity;
          return { status: value.status, selectionComplete: value.selectionComplete ?? false,
            resolvedIdentity: object(resolved) ? Object.fromEntries([...CONTEXT, ...MODEL, 'selectedOptions', 'selectedAccessories', 'selectionComplete']
              .filter((field) => resolved[field] !== undefined).map((field) => [field, structuredClone(resolved[field])])) : null,
            selectedElements: Array.isArray(value.selectedElements) ? value.selectedElements.map((row) => Object.fromEntries(['code', 'type', 'quantity']
              .filter((field) => row?.[field] !== undefined).map((field) => [field, row[field]]))) : [], ignoredCodes: value.ignoredCodes || [] };
        } },
    } });
  requireValue(!Object.hasOwn(operations, 'discover') && !Object.hasOwn(operations, 'solve'), 'invalid-session', 'Additional stages cannot replace collector source operations.');
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit, checkDeadline }) => {
    requireValue(source.version === plan.source.version, 'checkpoint-incompatible', 'The injected source version must match the explicit plan.');
    const report = (reason) => ({ status: state.accepted.length >= plan.target ? 'complete' : 'incomplete',
      reason: state.accepted.length >= plan.target ? 'target-reached' : reason,
      qualification: 'offline-fixture-not-source-qualified', ...structuredClone({ accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates, counts: state.counts }),
      coverage: { distinctConfigurations: state.accepted.length, target: plan.target,
        models: Object.fromEntries(plan.models.map((code) => [code, state.accepted.filter((row) => row.canonicalIdentity.vgModelCode === code).length])) }, checkpoint: statePath });
    if (state.halted) return report(state.halted);
    if (state.accepted.length >= plan.target) return report('target-reached');
    try {
      if (state.queue === null) {
        state.queue = buildCandidateQueue(plan, await execute('discover', { context: plan.context, models: plan.models }));
        await commit('queue');
      }
      while (state.cursor < state.queue.length && state.accepted.length < plan.target) {
        checkDeadline(); const candidate = state.queue[state.cursor];
        const response = await execute('solve', candidate.request); await onPhase('response-cached', { candidateId: candidate.candidateId });
        try {
          const record = validateSolverResponse(candidate, response, key);
          if (state.accepted.some((row) => row.configurationId === record.configurationId)) state.duplicates.push({ candidateId: candidate.candidateId, configurationId: record.configurationId, solverChanges: record.solverChanges });
          else state.accepted.push({ ...record, source: structuredClone(plan.source), sourceKind: 'offline-fixture', candidateId: candidate.candidateId });
        } catch (error) {
          if (!(error instanceof CollectionError)) throw error;
          if (error.code === 'solver-context-substitution') state.counts.substitutions += 1;
          state.rejected.push({ candidateId: candidate.candidateId, code: error.code });
        }
        state.cursor += 1; await commit('outcome'); await onPhase('outcome-committed', { cursor: state.cursor });
      }
      return report('queue-exhausted');
    } catch (error) {
      if (!error.stop) throw error;
      if (error.sticky) state.halted = error.code;
      await commit('stop'); return report(error.code);
    }
  }, { stage: { id: 'collection', version: COLLECTOR_VERSION, inputDigest: inputDigest(plan) } }) };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const addCounts = (a, b) => Object.fromEntries(Object.keys(b).map((name) => [name, object(b[name])
  ? Object.fromEntries(Object.keys(b[name]).map((operation) => [operation, (a?.[name]?.[operation] || 0) + b[name][operation]]))
  : (a?.[name] || 0) + b[name]]));
async function checkpointBytes(path, limit) {
  const file = await open(path, 'r');
  try {
    requireValue((await file.stat()).size <= limit, 'checkpoint-corrupt', 'The predecessor exceeds its finite checkpoint limit.');
    const buffer = Buffer.alloc(limit + 1); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    requireValue(bytesRead <= limit, 'checkpoint-corrupt', 'The predecessor exceeds its finite checkpoint limit.');
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

async function createPublicBatchCollector({ plan, source, policyService, policyRead, statePath, operations, http, mode, now, onPhase, batchBinding, continuation }) {
  requireValue(['live', 'source-fixture'].includes(mode) && source?.kind === 'public-bmw-uk' && source.version === plan.source.version
    && http?.kind === (mode === 'live' ? 'live' : 'fixture') && object(batchBinding)
    && object(batchBinding.producerPins) && version(batchBinding.snapshotVersion)
    && Array.isArray(batchBinding.existingConfigurationIds) && batchBinding.existingConfigurationIds.length <= 10000
    && batchBinding.existingConfigurationIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 8192)
    && (policyRead === undefined || policyRead.asOf === plan.policyRead.asOf && policyRead.policyVersion === plan.policyRead.policyVersion),
  'source-allocation-required', 'Use the explicit finite batch source, policy, prior canonical index and producer/snapshot binding.');
  const key = await createConfigurationKey({ policyService, policyRead: { runId: `collector-${plan.planId}`, ...plan.policyRead } });
  const descriptors = publicBmwCompleteSelectionOperations(plan);
  requireValue(!Object.keys(operations).some((name) => Object.hasOwn(descriptors, name)), 'invalid-session', 'Additional stages cannot replace source operations.');
  const catalogueRegistrations = []; const prior = new Set(batchBinding.existingConfigurationIds);
  const artifact = (entry) => ({ bytes: JSON.stringify(entry.document) + '\n', artifactSha256: entry.sha256, retrievedAt: entry.retrievedAt || entry.document.observation.observedAt });
  // FUCQ-151: bindings are pure in their exact artifact bytes, so a digest of those bytes caches the validated result.
  // Every pass re-hashes the bytes it reads; altered bytes miss the cache and get the full strict build.
  const bindings = new Map(); const registered = new Set();
  const pass = () => {
    const seen = new WeakMap();
    return (capture) => {
      let value = seen.get(capture);
      if (!value) {
        const entry = artifact(capture); value = { entry, digest: sha256(JSON.stringify([sha256(entry.bytes), entry.artifactSha256, entry.retrievedAt])) };
        seen.set(capture, value);
      }
      return value;
    };
  };
  const resolveBinding = (state, solver, evidence, memo) => {
    const source = evidence === undefined ? state.batchEvidence : evidence; const parts = [source.tree, solver, source.options].map(memo);
    return { id: sha256(parts.map((part) => part.digest).join(':')), input: { plan, configurationKey: key, producerPins: batchBinding.producerPins,
      snapshotVersion: batchBinding.snapshotVersion, artifacts: { tree: parts[0].entry, solver: parts[1].entry }, definitionBinding: { options: parts[2].entry } } };
  };
  const remember = (id, row) => {
    const hit = { recordDigest: inputDigest(row), lookupDigest: inputDigest(row.lookupIdentity), dated: row.sourceKind === 'dated-snapshot' };
    bindings.set(id, hit); return hit;
  };
  const bind = (state, solver, evidence, memo) => {
    const { id, input } = resolveBinding(state, solver, evidence, memo);
    return { hit: bindings.get(id) || remember(id, buildBmwSelectionBinding(input).record), input };
  };
  const register = ({ hit, input }) => {
    if (hit.dated && !registered.has(hit.lookupDigest)) { catalogueRegistrations.push(createBmwSelectionRegistration(input)); registered.add(hit.lookupDigest); }
  };
  const stageIdentity = { planDigest: inputDigest(plan), sourceVersion: plan.source.version, toolVersion: COLLECTOR_VERSION, mode,
    signaturePolicyVersion: key.policyVersion, batchBindingDigest: inputDigest(batchBinding) };
  const candidatesById = new Map(); for (const candidate of plan.candidates) if (!candidatesById.has(candidate.candidateId)) candidatesById.set(candidate.candidateId, candidate);
  const solveIndexes = new Map();
  const candidateForCacheKey = (state, cacheKey) => {
    const sourceDigest = inputDigest(state.identity.sources.solve ?? null); let index = solveIndexes.get(sourceDigest);
    if (!index) {
      index = new Map(); solveIndexes.set(sourceDigest, index);
      for (const candidate of plan.candidates) {
        const candidateKey = inputDigest({ operation: 'solve', ...state.identity.sources.solve, request: candidate.request });
        if (!index.has(candidateKey)) index.set(candidateKey, candidate);
      }
    }
    return index.get(cacheKey);
  };
  const validateRetainedCache = (state, allocation, memo = pass()) => {
    requireValue(Array.isArray(allocation.cache) && allocation.cache.length <= plan.limits.cacheEntries && object(allocation.attempts),
      'cache-corrupt', 'Retained allocation caches and spending must remain bounded.');
    for (const cached of allocation.cache) {
      requireValue(inputDigest(cached.payload) === cached.payloadDigest, 'cache-corrupt', 'Retained response bytes must match their digest.');
      if (cached.operation !== 'solve') continue;
      const candidate = candidateForCacheKey(state, cached.cacheKey);
      requireValue(candidate && allocation.attempts[cached.cacheKey] === 1 && allocation.batchEvidence
        && same(cached.payload?.document?.observation?.request, { method: 'GET', url: bmwBatchPlanRequestUrls(plan, candidate.request).solve }),
      'cache-corrupt', 'Retained solver evidence must identify a spent exact planned request.');
      bind(state, cached.payload, allocation.batchEvidence, memo);
    }
  };
  const validateState = (state) => {
      requireValue((state.batchEvidence === null || object(state.batchEvidence) && object(state.batchEvidence.tree) && object(state.batchEvidence.options))
        && bounded(state.cursor, 0, plan.candidateCount) && ['sourceCaptures', 'records', 'accepted', 'rejected', 'duplicates'].every((field) =>
          Array.isArray(state[field]) && state[field].length <= plan.candidateCount), 'checkpoint-corrupt', 'Use bounded batch captures and outcomes.');
      const memo = pass(); const captures = new Map(); const recordDigests = new Set();
      for (const entry of state.sourceCaptures) if (!captures.has(entry.solver?.sha256)) captures.set(entry.solver?.sha256, entry);
      for (const row of state.records) {
        const captured = captures.get(row.sourceEvidence?.solver); let bound = null;
        try { if (captured && state.batchEvidence) bound = bind(state, captured.solver, captured.batchEvidence, memo); } catch { bound = null; }
        const digest = bound && inputDigest(row);
        requireValue(bound && digest === bound.hit.recordDigest, 'source-selection-mismatch', 'Every persisted record must match its exact source capture.');
        recordDigests.add(digest); register(bound);
      }
      for (const row of state.accepted) requireValue(mode === 'live' && row.admission === true
        && recordDigests.has(inputDigest({ ...row, admission: false })),
      'source-selection-mismatch', 'Accepted state must retain the exact live source-derived record.');
      for (const captured of state.sourceCaptures) {
        const candidate = candidatesById.get(captured.candidateId);
        requireValue(candidate && same(captured.solver?.document?.observation?.request,
          { method: 'GET', url: bmwBatchPlanRequestUrls(plan, candidate.request).solve }),
        'checkpoint-corrupt', 'Captures belong to their exact planned queue request.');
        bind(state, captured.solver, captured.batchEvidence, memo);
      }
      if (state.continuation) {
        requireValue(object(state.continuation.contract) && same(state.continuation.contract.limits, state.continuation.limits)
          && Array.isArray(state.continuation.retainedAllocations) && state.continuation.retainedAllocations.length <= 32
          && bounded(state.continuation.recoveredSolverResponses, 0, plan.candidateCount),
        'checkpoint-corrupt', 'Continuation identity, retained allocation lineage and recovered responses must remain bounded.');
        for (const allocation of state.continuation.retainedAllocations) validateRetainedCache(state, allocation, memo);
        validateRetainedCache(state, { cache: state.cache, attempts: state.attempts, batchEvidence: state.activeBatchEvidence }, memo);
        if (lineage) {
          requireValue(['contract', 'limits', 'allocationIds', 'retainedAllocations', 'priorCounts'].every((field) => same(state.continuation[field], lineage[field]))
            && ['records', 'accepted', 'rejected', 'duplicates', 'sourceCaptures'].every((field) =>
              same(state[field].slice(0, initialState[field].length), initialState[field])),
          'continuation-predecessor-mismatch', 'Preserve every inherited outcome, capture and allocation without rewriting or resetting it.');
        }
      }
    };
  let initialState = { batchEvidence: null, sourceCaptures: [], cursor: 0, records: [], accepted: [], rejected: [], duplicates: [] };
  let limits = plan.limits; let lineage;
  if (continuation !== undefined) {
    requireValue(mode === 'live' && object(continuation) && isAbsolute(continuation.checkpointPath || '')
      && isAbsolute(statePath || '') && resolve(continuation.checkpointPath) !== resolve(statePath)
      && /^[a-f0-9]{64}$/.test(continuation.checkpointSha256 || '') && object(continuation.limits),
    'continuation-required', 'Use a distinct checkpoint, exact predecessor byte hash and explicit fresh finite limits.');
    const bytes = await checkpointBytes(continuation.checkpointPath, plan.limits.checkpointBytes);
    requireValue(sha256(bytes) === continuation.checkpointSha256, 'continuation-predecessor-mismatch', 'Preserve the exact predecessor checkpoint bytes.');
    let envelope;
    try { envelope = JSON.parse(bytes); } catch { throw new CollectionError('checkpoint-corrupt', 'The predecessor must be a complete checkpoint.'); }
    const previous = envelope?.content; const previousLineage = previous?.continuation;
    const predecessor = await createCollectionSession({ statePath: continuation.checkpointPath, now,
      http: { ...http, allocation: previous?.identity?.transport?.allocation }, limits: previousLineage?.limits || plan.limits,
      identity: { ...stageIdentity, ...(previousLineage ? { continuationDigest: inputDigest(previousLineage.contract) } : {}) },
      operations: { ...operations, ...publicBmwCompleteSelectionOperations(plan) }, validateState });
    const retained = await predecessor.withCheckpoint(async ({ state }) => {
      requireValue(sha256(await checkpointBytes(continuation.checkpointPath, plan.limits.checkpointBytes)) === continuation.checkpointSha256,
        'continuation-predecessor-mismatch', 'The predecessor changed during validation.');
      validateRetainedCache(state, { cache: state.cache, attempts: state.attempts,
        batchEvidence: state.activeBatchEvidence || state.batchEvidence });
      return structuredClone(state);
    });
    requireValue([null, 'source-batch-interrupted', 'request-budget', 'source-attempt-budget', 'source-byte-budget',
      'response-byte-budget', 'deadline', 'operation-timeout'].includes(retained.halted),
    'continuation-stop-refused', 'Continue only a process, finite budget or deadline interruption; preserve source access, refusal, substitution and shape stops.');
    requireValue(retained.batchEvidence && retained.cursor < plan.candidateCount && retained.counts.httpAttempts > 0,
      'continuation-bootstrap-required', 'Continue an interrupted batch only after complete retained tree and option evidence.');
    const allocationIds = [...(previousLineage?.allocationIds || []), retained.identity.transport.allocation.id];
    requireValue(version(http?.allocation?.id) && !allocationIds.includes(http.allocation.id),
      'continuation-allocation-used', 'A continuation requires a fresh explicit allocation identity.');
    limits = structuredClone(continuation.limits);
    requireValue(Object.keys(plan.limits).every((name) => name === 'requestBudgets'
      ? same(Object.keys(limits.requestBudgets || {}).sort(), Object.keys(plan.limits.requestBudgets).sort())
        && ['page', 'settings', 'discover', 'options'].every((operation) => limits.requestBudgets[operation] === 1)
        && bounded(limits.requestBudgets.solve, 0, plan.candidateCount - retained.cursor)
      : bounded(limits[name], 0, plan.limits[name])) && limits.sourceAttempts <= 4 + limits.requestBudgets.solve,
    'continuation-limits', 'Budget the four fresh bootstrap GETs and bounded remaining solver work within the original ceilings.');
    const contract = { checkpointPath: resolve(continuation.checkpointPath), checkpointSha256: continuation.checkpointSha256, limits,
      rootPath: previousLineage?.contract.rootPath || resolve(continuation.checkpointPath) };
    const retainedAllocations = [...(previousLineage?.retainedAllocations || []), {
      allocationId: retained.identity.transport.allocation.id, cache: retained.cache, attempts: retained.attempts,
      batchEvidence: retained.activeBatchEvidence || retained.batchEvidence }];
    requireValue(retainedAllocations.length <= 32, 'continuation-budget', 'The explicit continuation chain is bounded to 32 allocations.');
    lineage = { contract, limits, allocationIds, retainedAllocations,
      priorCounts: addCounts(previousLineage?.priorCounts, retained.counts), recoveredSolverResponses: previousLineage?.recoveredSolverResponses || 0 };
    initialState = { ...Object.fromEntries(['batchEvidence', 'sourceCaptures', 'cursor', 'records', 'accepted', 'rejected', 'duplicates']
      .map((field) => [field, retained[field]])), activeBatchEvidence: null, continuation: lineage };
  }
  const session = await createCollectionSession({ statePath, now, onPhase, http, limits,
    identity: { ...stageIdentity, ...(lineage ? { continuationDigest: inputDigest(lineage.contract) } : {}) },
    operations: { ...operations, ...descriptors }, initialState, validateState });
  return { session, catalogueRegistrations, run: async () => {
    if (lineage) {
      // FUCQ-152: one durable successor per predecessor allocation, reserved before this allocation's own marker.
      const predecessorId = lineage.allocationIds.at(-1);
      const successorPath = `${lineage.contract.rootPath}.continuation-successor-${inputDigest(predecessorId)}.json`;
      const successor = { schemaVersion: '1', predecessorAllocationId: predecessorId, allocation: http.allocation,
        statePath: resolve(statePath), contract: lineage.contract };
      let reserved;
      try { reserved = await open(successorPath, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await readBounded(successorPath, 16384, 'continuation-predecessor-forked');
        requireValue(existing?.allocation?.id !== http.allocation.id || same(existing, successor),
          'continuation-allocation-used', 'This allocation is already bound to another continuation checkpoint.');
        requireValue(same(existing, successor),
          'continuation-predecessor-forked', 'This predecessor already has a continuation successor; continue from the chain tip instead.');
      }
      if (reserved) {
        try { await reserved.writeFile(JSON.stringify(successor) + '\n'); await reserved.sync(); } finally { await reserved.close(); }
        const directory = await open(dirname(successorPath), 'r'); try { await directory.sync(); } finally { await directory.close(); }
      }
      const markerPath = `${lineage.contract.rootPath}.continuation-allocation-${inputDigest(http.allocation.id)}.json`;
      const marker = { schemaVersion: '1', allocation: http.allocation, statePath: resolve(statePath), contract: lineage.contract };
      let file;
      try { file = await open(markerPath, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        requireValue(same(await readBounded(markerPath, 16384, 'continuation-allocation-used'), marker),
          'continuation-allocation-used', 'This allocation is already bound to another continuation checkpoint.');
        try { await checkpointBytes(statePath, limits.checkpointBytes); }
        catch (missing) {
          if (missing.code !== 'ENOENT') throw missing;
          throw new CollectionError('continuation-allocation-used', 'A consumed continuation allocation cannot restart after checkpoint loss.');
        }
      }
      if (file) {
        try { await file.writeFile(JSON.stringify(marker) + '\n'); await file.sync(); } finally { await file.close(); }
        const directory = await open(dirname(markerPath), 'r'); try { await directory.sync(); } finally { await directory.close(); }
      }
    }
    return session.withCheckpoint(async ({ state, execute, commit, checkDeadline }) => {
    const report = (reason) => ({ status: state.accepted.length >= plan.target ? 'complete' : 'incomplete', reason,
      qualification: mode === 'live' ? 'source-configuration-admitted' : 'synthetic-http-fixture', admission: state.accepted.length > 0,
      ...structuredClone({ records: state.records, accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates,
        counts: state.continuation ? addCounts(state.continuation.priorCounts, state.counts) : state.counts }),
      ...(state.continuation ? { allocationCounts: structuredClone({ prior: state.continuation.priorCounts, fresh: state.counts }),
        continuation: { checkpointPath: state.continuation.contract.checkpointPath, checkpointSha256: state.continuation.contract.checkpointSha256,
          recoveredSolverResponses: state.continuation.recoveredSolverResponses,
          bootstrap: 'fresh-page-settings-tree-options-required-for-ephemeral-capabilities' } } : {}),
      coverage: { distinctConfigurations: state.accepted.length, observedDistinctConfigurations: state.records.length, target: plan.target,
        attemptedCandidates: state.continuation ? addCounts(state.continuation.priorCounts, state.counts).operations.solve : state.counts.operations.solve, processedCandidates: state.cursor,
        rejectedCandidates: state.rejected.length, duplicateCandidates: state.duplicates.length,
        plannedCandidates: plan.candidateCount, models: { [plan.models[0]]: state.accepted.length } }, checkpoint: statePath });
    if (state.halted) return report(state.halted);
    if (state.cursor === plan.candidateCount) return report('queue-exhausted');
    // A recreated process cannot replay the spent settings operation to recover ephemeral headers.
    if (state.counts.httpAttempts > 0) { state.halted = 'source-batch-interrupted'; await commit('batch-stop'); return report(state.halted); }
    try {
      const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
      const tree = await execute('discover', {}); tree.retrievedAt = new Date(now()).toISOString();
      const options = await execute('options', {}); options.retrievedAt = new Date(now()).toISOString();
      if (state.continuation) {
        for (const [name, entry] of Object.entries({ tree, options })) requireValue(same(entry.document.report, state.batchEvidence[name].document.report)
          && entry.document.observation.responseSha256 === state.batchEvidence[name].document.observation.responseSha256,
        'continuation-source-changed', 'The fresh source bootstrap must match the exact retained model and definition context.');
        state.activeBatchEvidence = { tree, options };
      } else state.batchEvidence = { tree, options };
      await commit('batch-source-evidence');
      while (state.cursor < plan.candidateCount) {
        checkDeadline(); const candidate = plan.candidates[state.cursor];
        let solver; let evidence = state.activeBatchEvidence || state.batchEvidence;
        const cacheKey = inputDigest({ operation: 'solve', ...state.identity.sources.solve, request: candidate.request });
        const spent = state.continuation?.retainedAllocations.findLast((allocation) => allocation.attempts[cacheKey]);
        if (spent) {
          const cached = spent.cache.find((entry) => entry.operation === 'solve' && entry.cacheKey === cacheKey);
          if (!cached) {
            state.rejected.push({ candidateId: candidate.candidateId, code: 'source-request-spent' }); state.cursor += 1;
            await commit('candidate-spent'); continue;
          }
          solver = structuredClone(cached.payload); evidence = spent.batchEvidence;
          // A retained immutable observation remains evidence after its transport cache expiry.
          bind(state, solver, evidence, pass());
          state.continuation.recoveredSolverResponses += 1;
        }
        try { solver ||= await execute('solve', candidate.request); }
        catch (error) {
          if (error.code !== 'source-not-constructible') throw error;
          state.rejected.push({ candidateId: candidate.candidateId, code: error.code }); state.cursor += 1;
          await commit('candidate-rejected'); continue;
        }
        solver.retrievedAt ||= spent ? solver.document.observation.observedAt : new Date(now()).toISOString();
        state.sourceCaptures.push({ candidateId: candidate.candidateId, solver,
          ...(state.continuation ? { batchEvidence: evidence } : {}) });
        const { id, input } = resolveBinding(state, solver, evidence, pass()); const row = buildBmwSelectionBinding(input).record;
        register({ hit: remember(id, row), input });
        if (prior.has(row.configurationId) || state.records.some((record) => record.configurationId === row.configurationId))
          state.duplicates.push({ candidateId: candidate.candidateId, configurationId: row.configurationId, solverChanges: row.solverChanges,
            priorBatch: prior.has(row.configurationId) });
        else { state.records.push(row); if (mode === 'live') state.accepted.push({ ...row, admission: true }); }
        state.cursor += 1; await commit('candidate-outcome'); await onPhase('outcome-committed', { cursor: state.cursor });
      }
      return report('queue-exhausted');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      state.halted = error.code; if (error.code === 'source-model-substitution' || error.code === 'source-solver-shape') state.counts.substitutions += 1;
      await commit('batch-stop'); return report(error.code);
    }
  }, { stage: { id: 'collection', version: COLLECTOR_VERSION, inputDigest: inputDigest(plan) } }); } };
}

/** Source-qualified ingress shares the same checkpoint, accounting and later enrichment stages. */
async function createCaptureReplayCollector({ plan, captureReplay, policyService, statePath, operations, now, onPhase }) {
  const configurationKey = await createConfigurationKey({ policyService, policyRead: { runId: `collector-${plan.planId}`, ...plan.policyRead } });
  const registration = { ...structuredClone(captureReplay), plan, configurationKey };
  const expected = buildBmwSelectionBinding(registration).record;
  requireValue(expected.sourceKind === 'dated-snapshot', 'source-selection-not-live', 'Configuration admission requires retained live source captures.');
  requireValue(!Object.hasOwn(operations, 'capture'), 'invalid-session', 'Additional stages cannot replace trusted capture ingress.');
  const catalogueRegistration = createBmwSelectionRegistration(registration);
  const limits = { ...plan.limits, requestBudgets: { capture: 1,
    ...Object.fromEntries(Object.keys(operations).map((name) => [name, plan.limits.requestBudgets[name]])) } };
  const session = await createCollectionSession({
    identity: { planDigest: inputDigest(plan), sourceVersion: plan.source.version, toolVersion: COLLECTOR_VERSION,
      signaturePolicyVersion: configurationKey.policyVersion, mode: 'capture-replay', sourceBindingDigest: expected.lookupIdentity.bindingDigest },
    limits, statePath, now, onPhase, initialState: { accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue(Array.isArray(state.accepted) && state.accepted.length <= 1
        && ['rejected', 'duplicates'].every((field) => Array.isArray(state[field]) && state[field].length === 0),
      'checkpoint-corrupt', 'A retained source capture admits at most its exact source-derived configuration.');
      for (const row of state.accepted) requireValue(row?.admission === true
        && qualifyBmwSelectionRecord({ ...row, admission: false }, registration).status === 'qualified',
      'source-selection-mismatch', 'Accepted state must retain the exact registered source selection.');
    },
    operations: { ...operations, capture: { kind: 'offline', sourceId: plan.source.id, sourceVersion: plan.source.version,
      execute: () => structuredClone(expected) } } });
  return { session, catalogueRegistration, run: () => session.withCheckpoint(async ({ state, execute, commit, checkDeadline }) => {
    const report = (reason) => ({ status: state.accepted.length >= plan.target ? 'complete' : 'incomplete', reason,
      qualification: 'source-configuration-admitted', admission: state.accepted.length > 0,
      ...structuredClone({ records: state.accepted, accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates, counts: state.counts }),
      coverage: { distinctConfigurations: state.accepted.length, target: plan.target }, checkpoint: statePath });
    if (state.halted) return report(state.halted);
    if (state.accepted.length) return report('source-capture-admitted');
    try {
      checkDeadline(); const captured = await execute('capture', {});
      const qualified = qualifyBmwSelectionRecord(captured, registration);
      requireValue(qualified.status === 'qualified', 'source-selection-mismatch', 'Ingress must retain the exact source-derived selection.');
      state.accepted.push({ ...qualified.record, admission: true }); await commit('source-admission');
      return report('source-capture-admitted');
    } catch (error) {
      if (!error.stop) throw error;
      if (error.sticky) state.halted = error.code;
      await commit('stop'); return report(error.code);
    }
  }, { stage: { id: 'collection', version: COLLECTOR_VERSION, inputDigest: inputDigest(plan) } }) };
}

async function createPublicCollector({ plan, source, policyService, policyRead, statePath, operations, http, mode, now, onPhase }) {
  requireValue(['source-fixture', 'live'].includes(mode) && source?.kind === 'public-bmw-uk'
    && source.version === plan.source.version && http?.kind === (mode === 'live' ? 'live' : 'fixture'),
  'source-allocation-required', 'Select a matching explicit public-source transport and live allocation.');
  requireValue(policyRead === undefined || policyRead.asOf === plan.policyRead.asOf
    && policyRead.policyVersion === plan.policyRead.policyVersion, 'policy-read-mismatch', 'Use the plan policy date/version.');
  const key = await createConfigurationKey({ policyService, policyRead: { runId: `collector-${plan.planId}`, ...plan.policyRead } });
  const identity = { planDigest: inputDigest(plan), sourceVersion: source.version, toolVersion: COLLECTOR_VERSION,
    signaturePolicyVersion: key.policyVersion, mode };
  const publicOperations = publicBmwOperations(plan);
  requireValue(!Object.keys(operations).some((name) => Object.hasOwn(publicOperations, name)), 'invalid-session', 'Additional stages cannot replace source operations.');
  const session = await createCollectionSession({ identity, limits: plan.limits, statePath, now, onPhase, http,
    initialState: { sourceObservations: [], accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => requireValue(Array.isArray(state.sourceObservations) && state.sourceObservations.length <= 1
      && ['accepted', 'rejected', 'duplicates'].every((field) => Array.isArray(state[field]) && state[field].length === 0),
    'checkpoint-corrupt', 'The qualified source observation is separate from corpus-ready configurations.'),
    operations: { ...operations, ...publicOperations } });
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    const report = (reason) => ({ status: 'incomplete', reason, qualification: 'canonical-adapter-context-unqualified',
      ...structuredClone({ accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates,
        sourceObservations: state.sourceObservations, counts: state.counts }),
      coverage: { distinctConfigurations: 0, sourceObservations: state.sourceObservations.length, target: plan.target }, checkpoint: statePath });
    if (state.halted) return report(state.halted);
    if (state.sourceObservations.length) return report('source-observed-context-unqualified');
    try {
      const page = await execute('page', {});
      await execute('settings', { path: page.settingsPath });
      const model = await execute('discover', {});
      const selection = await execute('solve', {});
      state.sourceObservations.push(publicBmwObservation({ plan, model, selection, key, mode, observedAt: new Date(now()).toISOString() }));
      await commit('source-observation');
      return report('source-observed-context-unqualified');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      state.halted = error.code; await commit('source-stop'); return report(error.code);
    }
  }, { stage: { id: 'collection', version: COLLECTOR_VERSION, inputDigest: inputDigest(plan) } }) };
}

/** Explicit observation-only stage; never invokes the collector's solver or publication ports. */
export async function createPublicBmwContextQualification({ plan: input, statePath, http, mode, now = Date.now, onPhase } = {}) {
  const plan = validatePublicBmwContextPlan(input);
  requireValue(['source-fixture', 'live'].includes(mode) && http?.kind === (mode === 'live' ? 'live' : 'fixture'),
    'source-allocation-required', 'Use explicit context transport and a separately pinned live allocation.');
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(plan), sourceVersion: plan.source.version,
    stage: 'source-context-qualification', version: '1', mode }, operations: publicBmwContextOperations(plan),
    limits: plan.limits, statePath, http, now, onPhase, initialState: { contextObservation: null, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue(['accepted', 'rejected', 'duplicates'].every((key) => Array.isArray(state[key]) && state[key].length === 0),
        'checkpoint-corrupt', 'Context qualification cannot admit or construct configurations.');
      if (state.contextObservation !== null) validatePublicBmwContextObservation(plan, state.contextObservation, mode);
    } });
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    const report = () => structuredClone({ status: 'incomplete', reason: state.halted || (state.contextObservation?.document.report.nodes[0].facts.trim
      ? 'context-observed-options-unallocated' : 'source-trim-unknown'), qualification: 'model-context-only', admission: false,
      accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates, counts: state.counts, tree: state.contextObservation });
    if (state.halted || state.contextObservation) return report();
    if (state.counts.httpAttempts > 0) { state.halted = 'context-interrupted'; await commit('context-stop'); return report(); }
    try {
      const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
      state.contextObservation = await execute('discover', {}); await commit('context-observed');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      state.halted = error.code; await commit('context-stop');
    }
    return report();
  }, { stage: { id: 'source-context-qualification', version: '1', inputDigest: inputDigest(plan) } }) };
}

/** Options inspection observes typed definitions; it cannot construct or admit configurations. */
export async function createPublicBmwOptionsQualification({ plan: input, statePath, http, mode, now = Date.now, onPhase } = {}) {
  const plan = validatePublicBmwOptionsPlan(input);
  requireValue(['source-fixture', 'live'].includes(mode) && http?.kind === (mode === 'live' ? 'live' : 'fixture'),
    'source-allocation-required', 'Use explicit options transport and a separately pinned live allocation.');
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(plan), sourceVersion: plan.source.version,
    stage: 'source-options-qualification', version: '1', mode }, operations: publicBmwOptionsOperations(plan),
    limits: plan.limits, statePath, http, now, onPhase,
    initialState: { contextObservation: null, trimRelationships: [], optionsObservation: null, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue(['accepted', 'rejected', 'duplicates'].every((key) => Array.isArray(state[key]) && state[key].length === 0),
        'checkpoint-corrupt', 'Options qualification cannot admit or construct configurations.');
      validatePublicBmwOptionsObservations(plan, state, mode);
    } });
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    const report = () => structuredClone({ status: state.optionsObservation && !state.halted ? 'observed' : 'incomplete',
      reason: state.halted || (state.optionsObservation ? 'source-options-qualified' : 'options-interrupted'),
      qualification: 'typed-options-only', admission: false, accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates,
      counts: state.counts, tree: state.contextObservation, trimRelationships: state.trimRelationships, options: state.optionsObservation });
    if (state.halted || state.optionsObservation) return report();
    if (state.counts.httpAttempts > 0) { state.halted = 'options-interrupted'; await commit('options-stop'); return report(); }
    try {
      const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
      state.contextObservation = await execute('discover', {}); state.trimRelationships = state.contextObservation.document.trimRelationships;
      await commit('options-context-observed');
      state.optionsObservation = await execute('options', {}); await commit('options-observed');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      state.halted = error.code; await commit('options-stop');
    }
    return report();
  }, { stage: { id: 'source-options-qualification', version: '1', inputDigest: inputDigest(plan) } }) };
}

export async function createPublicBmwQualificationDiagnostic({ plan: input, statePath, http, mode, now = Date.now, onPhase } = {}) {
  const plan = validatePublicBmwDiagnosticPlan(input);
  requireValue(['source-fixture', 'live'].includes(mode) && http?.kind === (mode === 'live' ? 'live' : 'fixture'),
    'source-allocation-required', 'Use an explicit diagnostic transport and a separate allocation for live work.');
  const session = await createCollectionSession({
    identity: { planDigest: inputDigest(plan), sourceVersion: plan.source.version, stage: 'source-qualification-diagnostic', version: '1', mode },
    operations: publicBmwQualificationOperations(plan), limits: plan.limits, statePath, http, now, onPhase,
    initialState: { diagnostic: null, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue((state.diagnostic === null || object(state.diagnostic))
        && ['accepted', 'rejected', 'duplicates'].every((key) => Array.isArray(state[key]) && state[key].length === 0),
      'checkpoint-corrupt', 'A source diagnostic cannot contain admitted configurations.');
      if (state.diagnostic && Object.hasOwn(state.diagnostic, 'settingsShapeRefusal')) {
        requireValue(Object.keys(state.diagnostic).length === 1, 'settings-shape-report-invalid', 'A refusal retains only its fixed settings report.');
        validateSettingsShapeRefusal(state.diagnostic.settingsShapeRefusal, { plan, mode });
        requireValue(state.halted === state.diagnostic.settingsShapeRefusal.reason,
          'settings-shape-report-invalid', 'A settings report must retain its fail-closed stop.');
      }
    } });
  const qualifyRetained = (retained) => qualifyPublicBmwDiagnosticFields(plan, retained);
  return { session, qualifyRetained, exportSettingsShapeReceipt: (path) => session.withCheckpoint(async ({ state }) => {
    requireValue(isAbsolute(path || ''), 'explicit-path-required', 'Supply an absolute owned receipt path.');
    requireValue(state.diagnostic?.settingsShapeRefusal, 'settings-shape-report-unavailable', 'No validated settings refusal report is available.');
    const stage = state.stages['source-qualification-diagnostic'];
    requireValue(stage?.version === '1' && stage.inputDigest === inputDigest(plan), 'settings-shape-report-invalid', 'The diagnostic stage identity changed.');
    const { bytes, sha256 } = settingsShapeReceiptBytes(state.diagnostic.settingsShapeRefusal, { plan, mode });
    try {
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      const parent = await open(dirname(path), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    } catch { throw new CollectionError('settings-shape-export-failed', 'The safe settings receipt could not be written.'); }
    return { schemaVersion: 'bmw-settings-shape-refusal-receipt.v1', bytes: bytes.length, sha256 };
  }), run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    const report = (reason) => {
      let fieldQualification = null;
      if (state.diagnostic?.tree && state.diagnostic?.options) {
        try { fieldQualification = qualifyRetained(state.diagnostic); }
        catch (error) { if (error.code !== 'source-qualification-binding') throw error; }
      }
      return structuredClone({ status: 'incomplete', reason: fieldQualification ? 'field-qualification-incomplete' : reason, qualification: 'observation-only-schema-diagnostic',
      admission: false, accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates,
      counts: state.counts, diagnostic: state.diagnostic, fieldQualification, coverage: { distinctConfigurations: 0 } });
    };
    if (state.halted) return report(state.halted);
    if (state.diagnostic) return report('raw-schema-review-required');
    try {
      const page = await execute('page', {});
      const settings = await execute('settings', { path: page.settingsPath });
      const tree = await execute('discover', {});
      const options = await execute('options', {});
      state.diagnostic = { bootstrapObservations: [page.observation, settings.observation], tree, options };
      await commit('diagnostic-observation');
      return report('raw-schema-review-required');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      if (Object.hasOwn(error, 'settingsShapeRefusal')) {
        state.diagnostic = { settingsShapeRefusal: validateSettingsShapeRefusal(error.settingsShapeRefusal, { plan, mode }) };
      }
      state.halted = error.code; await commit('diagnostic-stop'); return report(error.code);
    }
  }, { stage: { id: 'source-qualification-diagnostic', version: '1', inputDigest: inputDigest(plan) } }) };
}

/** Invoking without an explicit offline fixture reports zero operations. Importing performs no work. */
export async function runCollectorCli(argv = process.argv.slice(2)) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--dry-run')) return { status: 'incomplete', reason: 'dry-run', counts: freshCounts() };
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    requireValue(['--plan', '--offline', '--checkpoint'].includes(argv[index]) && argv[index + 1] && !args.has(argv[index]), 'invalid-command', 'Use --plan PATH --offline FIXTURE --checkpoint PATH.');
    args.set(argv[index], argv[index + 1]);
  }
  requireValue(args.size === 3 && [...args.values()].every(isAbsolute), 'invalid-command', 'All three paths must be explicit and absolute.');
  const plan = await readBounded(args.get('--plan'), 1024 * 1024, 'invalid-plan');
  const fixture = await readBounded(args.get('--offline'), 16 * 1024 * 1024, 'invalid-fixture');
  const { PolicyService } = await import('../../server/gcsp/policy/index.js');
  const collector = await createFleetCollector({ plan, mode: 'offline', statePath: args.get('--checkpoint'), policyService: new PolicyService(),
    source: { kind: 'offline', version: plan.source.version, discover: async () => fixture.discovery,
      solve: async (request) => { const result = fixture.responses?.[inputDigest(request)]; requireValue(result, 'fixture-response-missing', 'No exact offline response for this request.'); return result; } } });
  const { status, reason, qualification, counts, coverage, checkpoint } = await collector.run();
  return { status, reason, qualification, counts, coverage, checkpoint };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCollectorCli().then((result) => { process.stdout.write(JSON.stringify(result) + '\n'); }, (error) => {
    process.stderr.write(JSON.stringify({ status: 'incomplete', code: error instanceof CollectionError ? error.code : 'collector-failure' }) + '\n'); process.exitCode = 1;
  });
}
