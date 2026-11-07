/** One evidence-only model/range shape inspection through the existing context executor. */
import { createHash } from 'node:crypto';
import { createCollectionSession } from '../../../../../scripts/gcsp/collection-session.mjs';
import { publicBmwContextOperations, validatePublicBmwContextPlan, validatePublicBmwContextObservation } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { CollectionError, requireValue } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const escape = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const type = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const shapeVersion = 'f70-one-context-range-shape.v1';
const containers = new Set(['lines', 'transmissionVariants', 'variants', 'defaultModel', 'includedTransmissionVariants',
  'configuration', 'model', 'phrases', 'labels', 'options', 'includedElements', 'mandatoryElements', 'elements', 'optionCodes', 'includedOptions']);
const labels = new Set(['name', 'label', 'title', 'description', 'shortDescription', 'longDescription', 'modelName', 'modelNameRaw',
  'derivative', 'trim', 'line', 'lineCode', 'lineName', 'code', 'modelCode', 'agModelCode', 'option', 'optionCode', 'variant', 'variantCode']);
const codeArrays = new Set(['options', 'includedElements', 'mandatoryElements', 'elements', 'optionCodes', 'includedOptions']);
const safeKey = (value) => /^[A-Za-z0-9_.+-]{1,64}$/.test(value) && !/[A-HJ-NPR-Z0-9]{17}/.test(value);
const safeLabel = (value) => typeof value === 'string' && value.length > 0 && value.length <= 160
  && !/[\x00-\x1f\x7f<>]/u.test(value) && !/[A-HJ-NPR-Z0-9]{17}/.test(value);

export function projectRangeShape(tree, registration) {
  const rows = []; let omittedKeys = 0;
  const visit = (value, path, depth, parentKey, dynamic = false) => {
    requireValue(depth <= 10, 'range-shape-depth', 'Stop rather than expanding the diagnostic traversal.');
    requireValue(object(value) || Array.isArray(value), 'range-shape-container', 'Inspect only bounded model/range containers.');
    const entries = Object.entries(value);
    requireValue(entries.length <= 128, 'range-shape-width', 'A diagnostic container exceeded its finite width.');
    for (const [key, entry] of entries) {
      if (!safeKey(key)) { omittedKeys++; continue; }
      requireValue(rows.length < 768, 'range-shape-count', 'A diagnostic projection exceeded its finite record count.');
      const pointer = `${path}/${escape(key)}`; const row = { pointer, type: type(entry) };
      if (object(entry) || Array.isArray(entry)) row.entries = Object.keys(entry).length;
      if (safeLabel(entry) && (labels.has(key) || Array.isArray(value) && codeArrays.has(parentKey) && /^[A-Z0-9]{2,16}$/.test(entry))) row.value = entry;
      rows.push(row);
      const descend = dynamic || Array.isArray(value) || containers.has(key);
      if (descend && (object(entry) || Array.isArray(entry))) visit(entry, pointer, depth + 1, key,
        key === 'lines' || Array.isArray(entry));
    }
  };
  for (const alias of registration.aliases) {
    const range = tree[alias]?.modelRanges?.[registration.catalogueRangeKey];
    const model = range?.models?.[registration.modelCode];
    requireValue(object(range) && object(model), 'range-shape-context', 'The full registered model and containing range must remain present.');
    const rangePath = `/${escape(alias)}/modelRanges/${escape(registration.catalogueRangeKey)}`;
    visit(model, `${rangePath}/models/${escape(registration.modelCode)}`, 0, 'model');
    // Other models and numeric/imagery/pricing subtrees are excluded; range keys/types remain visible.
    for (const [key, entry] of Object.entries(range)) {
      if (!safeKey(key)) { omittedKeys++; continue; }
      const row = { pointer: `${rangePath}/${escape(key)}`, type: type(entry) };
      if (object(entry) || Array.isArray(entry)) row.entries = Object.keys(entry).length;
      if (safeLabel(entry) && labels.has(key)) row.value = entry;
      rows.push(row);
      if (key !== 'models' && containers.has(key) && (object(entry) || Array.isArray(entry))) visit(entry, row.pointer, 0, key, key === 'lines' || Array.isArray(entry));
    }
  }
  const result = { schemaVersion: shapeVersion, modelCode: registration.modelCode, agModelCode: registration.agModelCode,
    aliases: [...registration.aliases], catalogueRangeKey: registration.catalogueRangeKey, rows, omittedKeys,
    interpretation: 'Source pointers, types and allowed primitive labels only; no inferred trim, model label, option classification or constructibility.' };
  requireValue(rows.length <= 768 && Buffer.byteLength(JSON.stringify(result)) <= 98304,
    'range-shape-output', 'Stop rather than broadening retained diagnostic output.');
  return result;
}

const artifact = (document) => {
  const bytes = JSON.stringify(document) + '\n';
  return { document, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
};
const validateArtifact = (value) => requireValue(object(value) && value.document?.schemaVersion === shapeVersion
  && inputDigest(artifact(value.document)) === inputDigest(value), 'range-shape-checkpoint', 'Preserve exact bounded diagnostic artifact bytes.');

export async function createRangeShapeDiagnostic({ plan: input, statePath, http, mode, now = Date.now }) {
  const plan = validatePublicBmwContextPlan(input); const operations = publicBmwContextOperations(plan);
  requireValue(['source-fixture', 'live'].includes(mode) && http?.kind === (mode === 'live' ? 'live' : 'fixture'),
    'range-shape-transport', 'Use matching explicit fixture/live transport.');
  const directProject = operations.discover.project;
  operations.discover.project = (value, request, metadata) => ({ contextObservation: directProject(value, request, metadata),
    rangeShape: artifact(projectRangeShape(value, plan.modelRegistration)) });
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(plan), sourceVersion: plan.source.version,
    stage: 'one-f70-range-shape', version: '1', mode }, operations, limits: plan.limits, statePath, http, now,
    initialState: { contextObservation: null, rangeShape: null, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue(['accepted', 'rejected', 'duplicates'].every((key) => Array.isArray(state[key]) && state[key].length === 0),
        'range-shape-checkpoint', 'The diagnostic cannot admit configurations.');
      if (state.contextObservation !== null) validatePublicBmwContextObservation(plan, state.contextObservation, mode);
      if (state.rangeShape !== null) validateArtifact(state.rangeShape);
    } });
  return { run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    if (!state.halted && !state.rangeShape) {
      if (state.counts.httpAttempts > 0) { state.halted = 'range-shape-interrupted'; await commit('shape-stop'); }
      else try {
        const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
        const result = await execute('discover', {}); Object.assign(state, result); await commit('shape-observed');
      } catch (error) {
        if (!(error instanceof CollectionError)) throw error;
        state.halted = error.code; await commit('shape-stop');
      }
    }
    return structuredClone({ reason: state.halted || 'range-shape-observed', counts: state.counts,
      contextObservation: state.contextObservation, rangeShape: state.rangeShape, admitted: 0, acceptance: false });
  }, { stage: { id: 'one-f70-range-shape', version: '1', inputDigest: inputDigest(plan) } }) };
}
