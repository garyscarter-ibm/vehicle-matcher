import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, rm } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { createBmwCatalogueAdapter, bmwCatalogueLookupIdentity } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { canonicalContent, durableWrite, syncDirectory, validateCorpusDirectory, writeCorpusCandidate }
  from '../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { emptyAllocationInventory } from '../../server/gcsp/vehicle-evidence/vin-allocation.js';
import { enrichFleet } from './enrich-fleet.mjs';

export const HISTORICAL_ENRICHMENT_VERSION = '1';
export const HISTORICAL_PINS = Object.freeze({
  manifest: 'c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709',
  configurations: '9c1fb6a34e324e6e4937baa1e80eabafa44fae394dd138f2f77be9f6867e9855',
  snapshot: 'ee1ae6c5cb6ab742f9a2959825ca722007409fa019d15acd44bb4b79984556a3',
});
const PRODUCER_PINS = {
  'scripts/gcsp/collection-session.mjs': '7495084c33c84538beb6ae3a04a292dbc0a800af6c9a10144de8e9728fc4b4b2',
  'scripts/gcsp/configuration-key.mjs': '2527393ebb3c0221595200283293ec88c584a1a7178ed1060e2313c0e1998b60',
};
const SNAPSHOT_VERSION = 'bmw-gb-i5-2026-11-01.v1';
const INPUT_BYTES = 2 * 1024 * 1024;
const inputs = new WeakSet();
const same = (a, b) => a !== undefined && b !== undefined && inputDigest(a) === inputDigest(b);
const clone = (value) => structuredClone(value);
function requireHistorical(condition, code, message) {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
async function boundedRead(path) {
  const file = await open(path, 'r');
  try {
    requireHistorical((await file.stat()).isFile(), 'historical-input-invalid', 'Read only regular retained input files.');
    const buffer = Buffer.alloc(INPUT_BYTES + 1); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    requireHistorical(bytesRead <= INPUT_BYTES, 'historical-input-budget', 'The retained input exceeds its 2 MiB file budget.');
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

/** Exactly one registered historical sample. Reading pins does not perform a source operation. */
export async function readRetainedHistoricalInput({ directory, snapshotPath, pins = HISTORICAL_PINS } = {}) {
  requireHistorical(isAbsolute(directory || '') && isAbsolute(snapshotPath || ''),
    'historical-path-required', 'Supply absolute retained artifact and snapshot paths.');
  const retainedPins = clone(pins);
  requireHistorical(same(retainedPins, HISTORICAL_PINS), 'historical-pin-mismatch', 'Only the reviewed historical input pins are admitted.');
  const raw = {};
  for (const [name, path] of [['manifest', `${directory}/manifest.json`],
    ['configurations', `${directory}/configurations.jsonl`], ['snapshot', snapshotPath]]) {
    raw[name] = await boundedRead(path);
    requireHistorical(createHash('sha256').update(raw[name]).digest('hex') === retainedPins[name],
      'historical-pin-mismatch', `The retained ${name} differs from its reviewed source pin.`);
  }
  const manifest = JSON.parse(raw.manifest); const snapshot = JSON.parse(raw.snapshot);
  const rows = raw.configurations.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line))
    .filter((row) => row.sourceContext?.sourceKind === 'dated-snapshot');
  requireHistorical(rows.length === 1, 'historical-input-invalid', 'Select one exact retained dated configuration.');
  const row = rows[0]; const catalogueRequest = { ...row.catalogue.resolvedIdentity, selectionComplete: true };
  const lookupIdentity = bmwCatalogueLookupIdentity(catalogueRequest, { snapshotVersion: SNAPSHOT_VERSION });
  requireHistorical(row.catalogue.snapshotVersion === SNAPSHOT_VERSION && lookupIdentity
    && same(lookupIdentity, row.catalogue.lookupIdentity) && same(lookupIdentity, row.catalogue.resolvedLookupIdentity),
  'historical-input-invalid', 'The original complete catalogue identity must remain unchanged.');
  const input = { row, manifest, snapshot, catalogueRequest, lookupIdentity, pins: retainedPins,
    directory: resolve(directory), snapshotPath: resolve(snapshotPath) };
  input.digest = inputDigest({ row, manifest, catalogueRequest, pins: retainedPins });
  inputs.add(input); return freeze(input);
}

/** F59 functions are injected from the actual pinned producer; no executor or key algorithm is copied. */
export async function createHistoricalEnrichmentRun({ input, createCollectionSession, createConfigurationKey,
  producerIdentity, policyService, policyRead, statePath, limits, asOf, now = Date.now, onPhase = async () => {} } = {}) {
  requireHistorical(inputs.has(input), 'historical-input-required', 'Use the immutable pin-verified historical input.');
  requireHistorical(typeof createCollectionSession === 'function' && typeof createConfigurationKey === 'function'
    && same(producerIdentity, PRODUCER_PINS) && typeof onPhase === 'function',
  'historical-producer-required', 'Inject the actual reviewed F59 session/key functions and their pinned identity.');
  requireHistorical(/^\d{4}-\d{2}-\d{2}$/.test(asOf || '') && Number.isFinite(Date.parse(asOf))
    && new Date(asOf).toISOString().slice(0, 10) === asOf
    && asOf >= input.row.sourceContext.observedDate,
  'historical-date-required', 'Assess retained evidence on an explicit valid date.');
  const read = clone(policyRead); const bounds = clone(limits); const producerPins = clone(producerIdentity);
  const key = await createConfigurationKey({ policyService, policyRead: read });
  const identity = key(input.row.canonicalIdentity);
  requireHistorical(identity.configurationId === input.row.configurationId
    && identity.decodedIdentity === input.row.canonicalSignature
    && identity.signaturePolicyVersion === input.manifest.signaturePolicy.policyVersion,
  'historical-policy-mismatch', 'The canonical retained identity and coherent policy must agree.');
  const accepted = [{ ...identity, catalogueRequest: clone(input.catalogueRequest),
    lookupIdentity: clone(input.lookupIdentity), sourceKind: 'dated-snapshot', source: clone(input.row.sourceContext) }];
  const receipt = { schemaVersion: '1', kind: 'retained-historical-source', version: HISTORICAL_ENRICHMENT_VERSION,
    inputDigest: input.digest, acceptedDigest: inputDigest(accepted), catalogueDigest: inputDigest(input.row.catalogue),
    observedDate: input.row.sourceContext.observedDate, pins: clone(input.pins),
    signaturePolicyVersion: identity.signaturePolicyVersion, policyReadDigest: inputDigest(read) };
  const validateState = (state) => {
    const ingress = state.stages['historical-ingress'];
    const empty = Array.isArray(state.accepted) && state.accepted.length === 0
      && state.historicalReceipt === null && state.historicalCatalogue === null
      && (!ingress || ingress.data?.admitted === false);
    const admitted = same(state.accepted, accepted) && same(state.historicalReceipt, receipt)
      && same(state.historicalCatalogue, input.row.catalogue) && ingress?.data?.admitted === true;
    requireHistorical(empty || admitted, 'historical-state-mismatch', 'Accepted historical evidence and receipt must commit together unchanged.');
  };
  const catalogue = createBmwCatalogueAdapter({ loadSnapshot: async () => clone(input.snapshot) });
  const session = await createCollectionSession({
    identity: { kind: 'retained-historical-enrichment', version: HISTORICAL_ENRICHMENT_VERSION,
      inputDigest: input.digest, producerIdentity: producerPins, policyReadDigest: inputDigest(read),
      signaturePolicyVersion: identity.signaturePolicyVersion, asOf },
    operations: { catalogue: { sourceId: 'bmw-retained-catalogue', sourceVersion: SNAPSHOT_VERSION,
      kind: 'offline', execute: (request) => catalogue.resolve(request, { snapshotVersion: SNAPSHOT_VERSION }) } },
    limits: bounds, statePath, now, onPhase,
    initialState: { accepted: [], historicalReceipt: null, historicalCatalogue: null }, validateState,
  });

  async function qualify() {
    return session.withCheckpoint(async ({ state, stageState, execute, commit, checkDeadline }) => {
      checkDeadline();
      if (state.accepted.length === 0) {
        requireHistorical(stageState.admitted === false, 'historical-state-mismatch', 'An unqualified historical stage cannot be marked admitted.');
        const envelope = await execute('catalogue', input.catalogueRequest);
        await onPhase('historical-response-cached');
        requireHistorical(same(envelope, input.row.catalogue), 'historical-catalogue-mismatch',
          'The actual F39 envelope must match the retained identity, dates, complete selection and unknowns.');
        state.accepted = clone(accepted); state.historicalReceipt = clone(receipt); state.historicalCatalogue = clone(envelope);
        stageState.admitted = true; await commit('historical-admission');
        await onPhase('historical-admitted');
      }
      requireHistorical(stageState.admitted === true, 'historical-state-mismatch', 'The historical stage needs its committed admission.');
      return { accepted: clone(state.accepted), receipt: clone(state.historicalReceipt) };
    }, { stage: { id: 'historical-ingress', version: HISTORICAL_ENRICHMENT_VERSION,
      inputDigest: inputDigest({ input: input.digest, receipt }) }, initialState: { admitted: false } });
  }

  async function run() {
    const ingress = await qualify(); // The ingress lease is released before enrichment starts.
    const enrichment = await enrichFleet({ session, accepted: ingress.accepted, catalogueOperation: 'catalogue',
      imageOperation: null, catalogueOptions: { snapshotVersion: SNAPSHOT_VERSION }, asOf,
      stageId: 'historical-enrichment', onPhase });
    await session.withCheckpoint(async ({ stageState, commit }) => {
      requireHistorical(stageState.result === null || same(stageState.result, enrichment),
        'historical-result-mismatch', 'A historical result cannot replace a previous committed report.');
      if (stageState.result === null) { stageState.result = clone(enrichment); await commit('historical-result'); }
    }, { stage: { id: 'historical-result', version: HISTORICAL_ENRICHMENT_VERSION,
      inputDigest: inputDigest({ input: input.digest, acceptedDigest: receipt.acceptedDigest, asOf }) }, initialState: { result: null } });
    return { ingress, enrichment };
  }

  async function writeCandidate({ directory, result } = {}) {
    requireHistorical(isAbsolute(directory || '') && resolve(directory) !== input.directory
      && !resolve(directory).startsWith(input.directory + sep),
    'historical-output-required', 'Supply a separate absolute owned candidate output directory.');
    directory = resolve(directory); const supplied = clone(result);
    return session.withCheckpoint(async ({ state, stageState, commit, checkDeadline }) => {
      checkDeadline();
      requireHistorical(same(supplied?.ingress, { accepted, receipt })
        && same(supplied?.enrichment, state.stages['historical-result']?.data?.result)
        && same(supplied?.enrichment?.records, state.stages['historical-enrichment']?.data?.records)
        && supplied.enrichment?.processing === 'finished' && supplied.enrichment?.pending === 0
        && supplied.enrichment?.qualification === 'offline-session-not-source-qualified',
      'historical-result-mismatch', 'Package only the same admitted evidence and actual committed F60 report.');
      const metadata = clone(input.manifest);
      metadata.sourceContexts = metadata.sourceContexts.filter((source) => source.sourceKind === 'dated-snapshot'
        && source.market === input.row.configuration.market && source.observedDate === receipt.observedDate);
      const options = { policyService, policyRead: read };
      let checked;
      try { const file = await open(`${directory}/manifest.json`, 'r'); await file.close(); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const written = await writeCorpusCandidate(directory, { metadata, configurations: [clone(input.row)],
          images: [], allocationInventory: emptyAllocationInventory() }, options);
        requireHistorical(written.status === 'ok', 'historical-candidate-invalid', 'The F54 historical candidate failed packaging.');
      }
      checked = await validateCorpusDirectory(directory, options);
      requireHistorical(checked.status === 'ok' && same(checked.corpus.configurations, [input.row])
        && checked.corpus.vins.length === 0 && checked.corpus.images.length === 0
        && ['datasetId', 'version', 'schemaVersion', 'profileRegistryVersion', 'generatorVersion', 'seed', 'sourceContexts']
          .every((field) => same(checked.manifest[field], metadata[field]))
        && (stageState.manifestDigest === null || stageState.manifestDigest === checked.manifestDigest),
      'historical-candidate-mismatch', 'Reuse only the exact validated immutable historical candidate.');
      const sidecarsPath = `${directory}.f60.json`;
      const sidecars = { schemaVersion: '1', manifestDigest: checked.manifestDigest,
        ingress: clone(receipt), enrichment: supplied.enrichment };
      const text = canonicalContent(sidecars);
      const staging = `${sidecarsPath}.writing-${process.pid}-${randomUUID()}`;
      try {
        await durableWrite(staging, text, true);
        await onPhase('historical-sidecar-staged');
        try { await link(staging, sidecarsPath); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          requireHistorical((await lstat(sidecarsPath)).isFile() && (await boundedRead(sidecarsPath)).toString('utf8') === text,
            'historical-sidecar-conflict', 'Preserve a conflicting historical sidecar for diagnosis.');
        }
        await syncDirectory(dirname(sidecarsPath));
      } finally { await rm(staging, { force: true }); }
      stageState.manifestDigest = checked.manifestDigest; stageState.sidecarsDigest = inputDigest(sidecars);
      await commit('historical-candidate');
      return { directory, manifestDigest: checked.manifestDigest, sidecarsPath, sidecarsDigest: stageState.sidecarsDigest };
    }, { stage: { id: `historical-package-${inputDigest(directory).slice(0, 16)}`, version: HISTORICAL_ENRICHMENT_VERSION,
      inputDigest: inputDigest({ input: input.digest, acceptedDigest: receipt.acceptedDigest, directory }) },
    initialState: { manifestDigest: null, sidecarsDigest: null } });
  }
  return Object.freeze({ session, run, writeCandidate });
}
