import { createHash } from 'node:crypto';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { createCollectionSession, assertCollectionHttpObservation } from './collection-session.mjs';
import { publicBmwOperations, strictModelReport, bmwModelLineLocators, validatePublicBmwPlan } from './public-bmw-source.mjs';
import { BMW_MODEL_BATCH_SOURCE_VERSION } from './bmw-public-registration.mjs';
import { CollectionError, requireValue } from './configuration-key.mjs';

export const BMW_SELECTION_CAPTURE_VERSION = 'bmw-complete-selection.v1';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const encode = (v) => JSON.stringify(v) + '\n';
const code = (v) => typeof v === 'string' && /^[A-Z0-9]{4,12}$/.test(v);
const seed = ['FKSFU', 'P0300', 'S0337', 'S043L'];

function selectedMap(value) {
  requireValue(object(value) && Object.keys(value).length <= 320, 'capture-element-shape', 'Retain a bounded typed element map.');
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    const row = value[key];
    requireValue(code(key) && object(row) && row.code === key && ['option', 'accessory'].includes(row.type)
      && Object.keys(row).every((k) => ['code', 'type', 'quantity'].includes(k))
      && (!Object.hasOwn(row, 'quantity') || row.type === 'accessory' && Number.isSafeInteger(row.quantity)
        && row.quantity > 0 && row.quantity <= 999), 'capture-element-shape', 'Every retained element must use the safe source schema.');
    return [key, { code: key, type: row.type, ...(Object.hasOwn(row, 'quantity') ? { quantity: row.quantity } : {}) }];
  }));
}

function solverReport(value, requestCodes = seed) {
  const elements = selectedMap(value.configuration.elements);
  const changesPresent = Object.hasOwn(value, 'configurationChanges');
  const changes = changesPresent ? value.configurationChanges : null;
  requireValue(!changesPresent || object(changes) && Object.keys(changes).every((k) =>
    ['addedElements', 'removedElements', 'ignoredElements'].includes(k)), 'capture-change-shape', 'Unknown solver change maps require review.');
  const retainedChanges = changesPresent ? Object.fromEntries(Object.entries(changes).map(([name, rows]) => [name, selectedMap(rows)])) : null;
  const selected = Object.keys(elements); const added = selected.filter((item) => !requestCodes.includes(item));
  const removed = requestCodes.filter((item) => !selected.includes(item));
  for (const [name, rows] of Object.entries(retainedChanges || {})) {
    requireValue(Object.keys(rows).every((item) => name === 'addedElements' ? added.includes(item)
      : requestCodes.includes(item) && !selected.includes(item)), 'capture-change-membership', 'Provider changes must agree with request and resolved membership.');
    if (name === 'addedElements') requireValue(Object.keys(rows).length === added.length,
      'capture-change-membership', 'The provider added map must cover the actual added set.');
    requireValue(Object.entries(rows).every(([item, row]) => name === 'addedElements'
      ? inputDigest(row) === inputDigest(elements[item]) : row.type === 'option'),
    'capture-change-membership', 'Provider changes must retain the actual selected source type and quantity.');
  }
  return { constructible: true, configuration: { modelCode: value.configuration.modelCode, elements },
    configurationChanges: { state: changesPresent ? 'present' : 'absent', maps: retainedChanges },
    derivedChanges: { basis: 'request-resolved-set-difference', added, removed,
      ignored: { state: retainedChanges && Object.hasOwn(retainedChanges, 'ignoredElements') ? 'known' : 'unknown',
        codes: retainedChanges && Object.hasOwn(retainedChanges, 'ignoredElements') ? Object.keys(retainedChanges.ignoredElements) : null } },
    accessories: selected.filter((item) => elements[item].type === 'accessory').map((item) => ({ code: item, type: 'accessory',
      quantity: Object.hasOwn(elements[item], 'quantity') ? { state: 'known', value: elements[item].quantity, reason: null }
        : { state: 'unknown', value: null, reason: 'quantity-not-exposed' } })) };
}

/** Passive descriptors retain only safe complete-selection fields; the shared executor owns every request. */
export function publicBmwCompleteSelectionOperations(plan) {
  validatePublicBmwPlan(plan);
  requireValue(plan.captureVersion === BMW_SELECTION_CAPTURE_VERSION && /^\d{4}-\d{2}-\d{2}$/.test(plan.qualificationDate),
    'capture-plan-refused', 'Select the explicit complete-selection capture version and observation day.');
  const base = publicBmwOperations(plan); let treeObserved = false;
  const artifact = (report, metadata, operation, locators) => {
    assertCollectionHttpObservation(metadata);
    requireValue(metadata.operation === operation && metadata.sourceId === plan.source.id
      && metadata.sourceVersion === plan.source.version && metadata.observedAt.slice(0, 10) === plan.qualificationDate,
    'capture-observation-mismatch', 'Use the actual executor observation in the selected session and day.');
    const requestBytes = encode(metadata.request); const rawSelectionBytes = encode(report);
    const document = { schemaVersion: BMW_SELECTION_CAPTURE_VERSION, observation: metadata,
      requestSha256: sha(requestBytes), rawSelectionSha256: sha(rawSelectionBytes), locators, report };
    const bytes = encode(document);
    return { document, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) };
  };
  return Object.fromEntries(Object.entries(base).map(([name, descriptor]) => [name, { ...descriptor, strictJson: true,
    project: (value, request, metadata) => {
      if (name === 'discover') {
        const projected = descriptor.project(value, request, metadata);
        const report = plan.source.version === BMW_MODEL_BATCH_SOURCE_VERSION ? projected : strictModelReport(value, plan.modelRegistration);
        const result = artifact(report, metadata, name, report.nodes.flatMap((node, index) => Object.entries(node.fieldPointers)
          .map(([field, sourcePointer]) => ({ name: `${index}-${field}`, sourcePointer, retainedPointer: `/report/nodes/${index}/facts/${field}` }))).concat(plan.source.version === BMW_MODEL_BATCH_SOURCE_VERSION ? bmwModelLineLocators(report) : []));
        treeObserved = true; return result;
      }
      if (name === 'solve') {
        requireValue(treeObserved, 'capture-tree-required', 'Observe the exact fresh full model before its solver selection.');
        descriptor.project(value, request, metadata);
        const report = solverReport(value, request.includedElements || seed);
        const locators = ['constructible', 'configuration/modelCode', 'configuration/elements'].map((pointer) =>
          ({ name: pointer.split('/').at(-1), sourcePointer: '/' + pointer, retainedPointer: '/report/' + pointer }));
        if (report.configurationChanges.state === 'present') locators.push({ name: 'configurationChanges', sourcePointer: '/configurationChanges',
          retainedPointer: '/report/configurationChanges/maps' });
        for (const [code, element] of Object.entries(report.configuration.elements)) if (Object.hasOwn(element, 'quantity'))
          locators.push({ name: `quantity-${code}`, sourcePointer: `/configuration/elements/${code}/quantity`,
            retainedPointer: `/report/configuration/elements/${code}/quantity` });
        return artifact(report, metadata, name, locators);
      }
      if (name === 'options') {
        const report = descriptor.project(value, request, metadata);
        return artifact(report, metadata, name, report.candidates[0].definitions.map((row, index) => ({ name: `definition-${row.code}`,
          sourcePointer: row.pointer, retainedPointer: `/report/candidates/0/definitions/${index}` })));
      }
      return descriptor.project(value, request, metadata);
    } }]));
}

/** An observation stage only. A complete actual source selection is distinct from corpus admission. */
export async function createBmwSelectionCapture({ plan, statePath, http, now = Date.now, onPhase } = {}) {
  const digest = inputDigest(plan);
  const session = await createCollectionSession({ identity: { stage: BMW_SELECTION_CAPTURE_VERSION, planDigest: digest },
    operations: publicBmwCompleteSelectionOperations(plan), limits: plan.limits, statePath, http, now, onPhase,
    initialState: { capture: null, accepted: [] }, validateState: (state) => requireValue(Array.isArray(state.accepted)
      && state.accepted.length === 0 && (state.capture === null || object(state.capture)), 'checkpoint-corrupt', 'Capture cannot admit configurations.') });
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    const report = (reason) => structuredClone({ status: state.capture ? 'observed' : 'incomplete', reason,
      admission: false, accepted: [], capture: state.capture, counts: state.counts });
    if (state.halted || state.capture) return report(state.halted || 'source-selection-observed');
    try {
      const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
      const tree = await execute('discover', {}); const solver = await execute('solve', {});
      state.capture = { tree, solver }; await commit('complete-selection-observation');
      return report('source-selection-observed');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      state.halted = error.code; await commit('capture-stop'); return report(error.code);
    }
  }, { stage: { id: 'complete-selection-capture', version: '1', inputDigest: digest } }) };
}
