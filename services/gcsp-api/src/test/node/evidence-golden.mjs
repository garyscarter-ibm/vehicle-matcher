// Offline generator for the Java evidence goldens and fixture stores (FUCQ-459). One function per slice.
// Run from the worktree: node services/gcsp-api/src/test/node/evidence-golden.mjs [s1|s2|s3|s4]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { canonicalContent } from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry, presentCorpusLoad } from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createLocalVehicleEvidenceLookup } from '../../../../../server/gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { DEFAULT_ARTIFACT_ROOT, releaseLimits } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { createPolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { createVehicleEvidenceLookup, canonicalVehicleIdentifier } from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { createVehicleSnapshot } from '../../../../../server/vehicles/index.js';
import { configurationDisplayGallery, readDisplayImageCatalogue, withDisplayImages } from '../../../../../server/gcsp/vehicle-evidence/display-images.js';
import { withConfigurationDefinitions } from '../../../../../server/gcsp/vehicle-evidence/configuration-definitions.js';
import { createLiveDisplayImageHandler } from '../../../../../server/gcsp/vehicle-evidence/live-display-images.js';
import { createHash } from 'node:crypto';
import { createConfiguredVehicleDetails, createVehicleDetailsConsumer } from '../../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import { createLookupVehicleAdapter } from '../../../../../server/gcsp/vehicle-evidence/lookup-adapter.js';
import { createAlternateOfflineVehicleAdapter } from '../../../../../server/gcsp/vehicle-evidence/alternate-offline-adapter.js';
import { vehicleEvidenceFailure, vehicleEvidenceDetails } from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createVehicleIdentityRouting } from '../../../../../server/gcsp/vehicle-evidence/identity-routing.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const EVIDENCE = join(ROOT, 'services/gcsp-api/src/test/resources/evidence');
const STORES = join(EVIDENCE, 'stores');
const GOLDEN = join(EVIDENCE, 'golden');
const REAL = join(ROOT, 'server/data/gcsp/vehicle-evidence');
const ASOF = '2026-11-05T00:00:00.000Z';
const REF = 'lookup-reference.v1';
const C1F8 = 'c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709';
const REF_IDS = { configurationId: 'UkVGMTpSRUZFUkVOQ0U=', lastConfigurationId: null, vin17: 'WBA33DB08TC426611' };
const UNKNOWN = { configurationId: 'no-such-configuration', vin17: 'WBA33DB08TC499999', vin7: 'C499999', bad: 'abc' };

const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : canonicalContent(value));
const pretty = (path, value) => writeFileSync(path, JSON.stringify(value, null, 1) + '\n');
const seal = (value) => { const { contentDigest, ...content } = value; return { ...content, contentDigest: inputDigest(content) }; };
const selection = (digest) => ({ directory: digest, manifestDigest: digest });
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean);
const selectedDir = (root) => {
  const digest = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')).selected.manifestDigest;
  return join(root, 'versions', digest);
};

function fixture(name, mutate = () => {}) {
  const dir = join(STORES, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(join(REAL, REF), dir, { recursive: true });
  mutate(dir); return dir;
}
function buildStores() {
  const inventory = (dir) => JSON.parse(readFileSync(join(dir, 'identity-inventory.json'), 'utf8'));
  const stores = {};
  stores['ok-copy'] = fixture('ok-copy');
  stores['fallback-previous'] = fixture('fallback-previous', (dir) => {
    const copy = 'feedface'.repeat(8);
    cpSync(join(dir, 'versions', C1F8), join(dir, 'versions', copy), { recursive: true });
    write(join(dir, 'active.json'), { schemaVersion: '1', selected: selection(copy), previous: selection(C1F8) });
  });
  stores['checksum-corrupt'] = fixture('checksum-corrupt', (dir) => {
    const path = join(dir, 'versions', C1F8, 'configurations.jsonl'); const text = readFileSync(path, 'utf8');
    const changed = text.replace('"observedDate":"2026-11-01"', '"observedDate":"2026-11-02"');
    if (changed === text) throw new Error('corruption target missing'); write(path, changed);
  });
  stores['truncated-jsonl'] = fixture('truncated-jsonl', (dir) => {
    const path = join(dir, 'versions', C1F8, 'vins.jsonl'); write(path, readFileSync(path, 'utf8').slice(0, -1));
  });
  stores['deactivated'] = fixture('deactivated', (dir) => write(join(dir, 'active.json'), { schemaVersion: '1', selected: null, previous: selection(C1F8) }));
  stores['selection-invalid'] = fixture('selection-invalid', (dir) => write(join(dir, 'active.json'), { schemaVersion: '1', selected: { directory: '../x', manifestDigest: 'zz' }, previous: null }));
  stores['empty'] = (() => {
    const dir = join(STORES, 'empty'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    write(join(dir, '.gitkeep'), ''); return dir;
  })();
  stores['inventory-missing'] = fixture('inventory-missing', (dir) => rmSync(join(dir, 'identity-inventory.json')));
  stores['inventory-tampered'] = fixture('inventory-tampered', (dir) => {
    const path = join(dir, 'identity-inventory.json'); const text = readFileSync(path, 'utf8');
    const changed = text.replace('reference-vehicle-1', 'reference-vehicle-2'); if (changed === text) throw new Error('tamper target missing');
    write(path, changed);
  });
  stores['not-in-history'] = fixture('not-in-history', (dir) => write(join(dir, 'identity-inventory.json'), seal({ ...inventory(dir), datasets: [] })));
  stores['history-config-missing'] = fixture('history-config-missing', (dir) => {
    const value = inventory(dir);
    write(join(dir, 'identity-inventory.json'), seal({ ...value, configurations: value.configurations.filter((row) => row.configurationId !== REF_IDS.configurationId) }));
  });
  stores['history-conflict'] = fixture('history-conflict', (dir) => {
    const value = inventory(dir); const [first, ...rest] = value.configurations;
    const flipped = first.recordDigest.slice(0, -1) + (first.recordDigest.endsWith('0') ? '1' : '0');
    write(join(dir, 'identity-inventory.json'), seal({ ...value, configurations: [{ ...first, recordDigest: flipped }, ...rest] }));
  });
  stores['last-good'] = fixture('last-good', (dir) => {
    write(join(dir, 'active.json'), 'not json {\n');
    write(join(dir, 'last-good.json'), { schemaVersion: '1', selected: selection(C1F8) });
  });
  return stores;
}

const createRegistry = (root) => createSyntheticRegistry({ root: resolve(root), approvedImages: APPROVED_CORPUS_IMAGES,
  policyService: createPolicyService({ provider: new FilePolicyProvider() }), jsonlLimitsForManifest: releaseLimits,
  sourceArtifactRoot: DEFAULT_ARTIFACT_ROOT, policyRead: { runId: 'local-vehicle-evidence', asOf: ASOF } });
const activeOf = (a) => a ? { datasetId: a.datasetId, version: a.version, manifestDigest: a.manifestDigest, counts: a.counts } : null;
const digestOr = (value) => value === undefined || value === null ? null : inputDigest(value);
const project = (r) => ({ status: r.status, code: r.failure?.code ?? null, identityKind: r.identityKind ?? null,
  liveEligible: r.liveEligible ?? null, sourceKind: r.sourceKind ?? null, imageCount: r.images?.length ?? null,
  imageState: r.imageState ?? null, recordDigest: digestOr(r.record), vehicleDigest: digestOr(r.vehicle),
  supplementDigest: digestOr(r.technicalSupplement), activeManifestDigest: r.active?.manifestDigest ?? null,
  vehicleId: r.vehicleId ?? null, configurationId: r.configurationId ?? null, originatingDatasetId: r.originatingDatasetId ?? null });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function idsFor(root, real) {
  if (!real) return { ...REF_IDS, lastConfigurationId: REF_IDS.configurationId };
  const dir = selectedDir(root); const configs = lines(join(dir, 'configurations.jsonl'));
  const vins = existsSync(join(dir, 'vins.jsonl')) ? lines(join(dir, 'vins.jsonl')) : [];
  return { configurationId: JSON.parse(configs[0]).configurationId, lastConfigurationId: JSON.parse(configs.at(-1)).configurationId,
    vin17: vins.length ? JSON.parse(vins[0]).vin17 : REF_IDS.vin17 };
}
async function outcome(root, real) {
  const ids = await idsFor(root, real);
  const lookup = createLocalVehicleEvidenceLookup({ root, asOf: ASOF });
  for (let waited = 0; lookup.readiness().status === 'loading' && waited < 120000; waited += 50) await sleep(50);
  const { elapsedMs, ...readiness } = lookup.readiness();
  const registry = createRegistry(root); const loaded = await registry.load(); const presented = presentCorpusLoad(loaded);
  const status = registry.status();
  const checks = {
    configurationKnown: project(registry.getConfiguration(ids.configurationId)),
    configurationLast: project(registry.getConfiguration(ids.lastConfigurationId ?? ids.configurationId)),
    configurationUnknown: project(registry.getConfiguration(UNKNOWN.configurationId)),
    configurationInvalid: project(registry.getConfiguration('')),
    vin17Known: project(registry.getVin(ids.vin17)), vin7Known: project(registry.getVin(ids.vin17.slice(-7))),
    vinUnknown: project(registry.getVin(UNKNOWN.vin17)), vin7Unknown: project(registry.getVin(UNKNOWN.vin7)),
    vinInvalid: project(registry.getVin(UNKNOWN.bad)),
    classifyConfigurationKnown: project(await registry.classifyConfiguration(ids.configurationId)),
    classifyConfigurationUnknown: project(await registry.classifyConfiguration(UNKNOWN.configurationId)),
    classifyIdentityKnown: project(await registry.classifyIdentity(ids.vin17)),
    classifyIdentityVin7: project(await registry.classifyIdentity(ids.vin17.slice(-7))),
    classifyIdentityUnknown: project(await registry.classifyIdentity(UNKNOWN.vin17)),
  };
  return { ids, readiness, load: { status: presented.status, code: presented.failure?.code ?? null, recovered: presented.recovered,
      active: activeOf(presented.active), causeCode: loaded.diagnostic?.cause?.code ?? null, changed: loaded.diagnostic?.changed ?? null },
    registryStatus: { status: status.status, active: activeOf(status.active) }, checks };
}

function canonicalVectors() {
  const texts = [
    '{"b":1,"a":[3,{"z":null,"y":true},"x"],"c":{"d":false,"b":{"k":1,"a":2}}}',
    '[0,-0,100,2.50,5.6,0.1,1e21,1e-7,0.000001,123456789012345678901234,1.5e300,-3.25]',
    '[1e20,100000000000000000000,4.35,1.7976931348623157e308,5e-324,123e-20,-1e-7,0.1e1,1E3,4294967295,9007199254740993,0.30000000000000004,1.0,1e0]',
    '{"s":"line\\nfeed\\ttab\\rcr\\bback\\fform\\u0000nul\\u001funit\\u007fdel","q":"say \\"hi\\"","bs":"a\\\\b","sl":"a/b"}',
    '{"u":"caf\\u00e9 \\u00c9 \\u2028\\u2029 \\u00a0","raw":"naïve café 日本語","emoji":"\\ud83d\\ude00 and 😀"}',
    '{"lone":"\\ud800","loneLow":"\\udc00x","pair":"\\ud83d\\ude00","mixed":"\\ud800\\ud83d\\ude00"}',
    '{"B":1,"a":2,"é":3,"Z":4,"_":5,"ab":6,"aB":7,"":8,"\\ud83d\\ude00":9,"\\uffff":10}',
    '{"10":"a","2":"b","1a":"c","01":"d","b":"e","0":"f","4294967295":"g","4294967294":"h","-1":"i","1.5":"j"}',
    '{"nested":{"10":{"2":1,"1":2,"x":3},"9":[{"b":1,"a":0}]}}',
    '{"dup":1,"dup":2,"a":{"x":1,"x":null}}',
    '{}', '[]', '"just a string"', 'null', 'true', '-0', '0.5',
  ];
  return texts.map((text) => { const value = JSON.parse(text);
    return { text, canonical: canonicalContent(value).slice(0, -1), digest: inputDigest(value) }; });
}
function rowDigests(store) {
  const dir = selectedDir(join(REAL, store)); const out = { store, configurations: [], vins: [], hashChecks: [] };
  const configs = lines(join(dir, 'configurations.jsonl'));
  configs.slice(0, 3).forEach((line, index) => out.configurations.push({ index, configurationId: JSON.parse(line).configurationId, recordDigest: inputDigest(JSON.parse(line)) }));
  const vins = existsSync(join(dir, 'vins.jsonl')) ? lines(join(dir, 'vins.jsonl')) : [];
  vins.slice(0, 3).forEach((line, index) => {
    const vin = JSON.parse(line); out.vins.push({ index, vehicleId: vin.vehicleId, recordDigest: inputDigest(vin) });
    const config = configs.map((l) => JSON.parse(l)).find((row) => row.configurationId === vin.configurationId);
    out.hashChecks.push({ vehicleId: vin.vehicleId, configurationId: vin.configurationId,
      configurationDigest: inputDigest(config.configuration), vinConfigurationHash: vin.configurationHash });
  });
  return out;
}

async function s1() {
  mkdirSync(GOLDEN, { recursive: true }); mkdirSync(STORES, { recursive: true });
  for (const name of readdirSync(GOLDEN)) if (/^s1-.*\.json$/.test(name)) rmSync(join(GOLDEN, name));
  pretty(join(GOLDEN, 's1-canonical.json'), { vectors: canonicalVectors(), rows: [REF, 'fleet-source.v1'].map(rowDigests) });
  const fixtures = buildStores(); const out = { fixtures: {}, real: {} };
  for (const [name, root] of Object.entries(fixtures)) out.fixtures[name] = await outcome(root, false);
  for (const name of ['lookup-reference.v1', 'demo-fleet.v1', 'fleet-source.v1']) out.real[name] = await outcome(join(REAL, name), true);
  pretty(join(GOLDEN, 's1-stores.json'), out);
}

// ---- s2: exact lookup and evidence projection -------------------------------------------------------------------
const compact = (path, head, cases) => writeFileSync(path, `{${head}"cases":[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`);
const ORDER = '1d736acd-674c-4bb1-8b6b-45dc56906442';
const OTHER_ORDER = '6ff0feca-90cd-4e6f-903c-41fad1ef9b91';
const CONTEXT = { runId: 'lookup-run', environmentId: 'lookup-test', principalId: 'fictional-reader', roles: ['employee'] };
const b64 = (text) => Buffer.from(text).toString('base64');
const OK_CONFIG = 'VDVNSjpGS1NGVSxQMDMwMCxTMDIzMCxTMDJQQSxTMDJWQixTMDJWRCxTMDMwMixTMDMzNyxTMDNESyxTMDNHOSxTMDNNMSxTMDQyOCxTMDQzTCxTMDQ4OCxTMDQ5NCxTMDRUMixTMDRVOSxTMDRVUixTMDRWMSxTMDU1MixTMDVBUyxTMDVBVixTMDVETSxTMDY1NCxTMDY3NCxTMDZBRSxTMDZBRixTMDZBSyxTMDZDNCxTMDZOWCxTMDZQQSxTMDcwNCxTMDcxMCxTMDc2MCxTMDc3NSxTMDgxMixTMDg1MyxTMDg4MCxTMDhSMyxTMDhSOSxTMDhTTSxTMDhURixTMDhURyxTMDhXTSxTMDlRVixTMDlUMSxTMDlUMg==';
const storeRows = (store) => { const dir = selectedDir(join(REAL, store));
  return { configurations: lines(join(dir, 'configurations.jsonl')).map((l) => JSON.parse(l)),
    vins: existsSync(join(dir, 'vins.jsonl')) ? lines(join(dir, 'vins.jsonl')).map((l) => JSON.parse(l)) : [],
    manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) }; };
const registries = new Map();
async function loadedRegistry(store) {
  if (!registries.has(store)) { const registry = createRegistry(join(REAL, store)); await registry.load(); registries.set(store, registry); }
  return registries.get(store);
}
const pathParts = (path) => path.split('.');
function patchValue(target, path, apply) {
  const parts = pathParts(path); let node = target;
  for (const part of parts.slice(0, -1)) node = node?.[part];
  if (node !== null && typeof node === 'object') apply(node, parts.at(-1));
}
// The flat registry result is patched by dotted paths; the Java test applies the same spec to its flat source.
function applyRegistry(registry, spec) {
  if (!spec) return registry;
  const wrap = (read) => async (id) => {
    if (spec.throws) throw new Error('registry failure');
    if (spec.fixed) return structuredClone(spec.fixed);
    const result = structuredClone(await read(id));
    for (const [path, value] of spec.set ?? []) patchValue(result, path, (node, key) => { node[key] = structuredClone(value); });
    for (const path of spec.delete ?? []) patchValue(result, path, (node, key) => { delete node[key]; });
    return result;
  };
  return { getConfiguration: wrap((id) => registry.getConfiguration(id)), getVin: wrap((id) => registry.getVin(id)) };
}
function repositoryFor(spec) {
  const state = { currentRun: 0, read: 0 };
  if (!spec) return { repository: undefined, state };
  const repository = {
    async currentRun() {
      const step = spec.currentRuns[Math.min(state.currentRun++, spec.currentRuns.length - 1)];
      if (step.throws) throw new Error('run lookup failure');
      return step.status === 'ok' ? { status: 'ok', value: { runId: step.runId } } : { status: step.status };
    },
    async read() {
      state.read++;
      if (spec.read.throws) throw new Error('stock read failure');
      return spec.read.status === 'ok' ? { status: 'ok', value: spec.read.record } : { status: spec.read.status };
    },
  };
  return { repository, state };
}
// Successful results are large; only cases marked `full` keep the whole result, the rest keep its canonical digest.
async function runCase(entry) {
  const registry = entry.store === null ? undefined : applyRegistry(await loadedRegistry(entry.store), entry.registry);
  const { repository, state } = repositoryFor(entry.stock);
  const result = JSON.parse(JSON.stringify(await createVehicleEvidenceLookup({ registry, repository }).resolve(entry.request, { context: entry.context })));
  const { full, ...rest } = entry;
  const kept = full || !['complete', 'partial'].includes(result.status) ? { result } : { resultStatus: result.status, resultDigest: inputDigest(result) };
  const out = { ...rest, ...kept };
  if (entry.stock) out.calls = { ...state };
  return out;
}
function identifierVectors() {
  const sig = (text) => b64(text);
  const codes = (n) => Array.from({ length: n }, (_, i) => `C${String(i).padStart(3, '0')}`);
  const wide = (n) => sig(`MODEL:${codes(n).join(',')}`);
  const configurations = [REF_IDS.configurationId, OK_CONFIG, sig('T5MJ:FKSFU,P0300,S0337'), sig('T5MJ:S0337,P0300'), sig('t5mj:P0300'),
    sig('T5MJ:p0300'), sig('T5MJ:P0300,P0300'), sig('T5MJ:P0300,'), sig('T5MJ:'), sig(':P0300'), sig('T5MJ:P0300:S0337'),
    sig('A:B'), sig('AB:CD'), sig('A'.repeat(17) + ':P0300'), sig('T5MJ:' + 'P'.repeat(17)), sig('T5MJ:P0300 '), sig('T5MJ:P0300\n'),
    wide(1), wide(255), wide(256), wide(257), sig('MODEL:' + codes(256).reverse().join(',')),
    sig('T5MJ:P0300').replace(/=+$/, ''), sig('T5MJ:P0300') + '=', ` ${sig('T5MJ:P0300')}`, `${sig('T5MJ:P0300')} `, sig('T5MJ:P0300').toLowerCase(),
    sig('T5MJ:P0300').replace('+', '-').replace('/', '_'), 'AAAA', 'A===', '====', '', 'x'.repeat(8192), 'QUJD'.repeat(2049), 'QUJD'.repeat(2048),
    Buffer.from([0xff, 0xfe, 0x41, 0x42]).toString('base64'), Buffer.from([0xc3, 0x28, 0x41, 0x42]).toString('base64'),
    Buffer.from('T5MJ:P0300é').toString('base64'), Buffer.from('T5MJ:P03\u0000').toString('base64'),
    sig('T5MJ:P0300').slice(0, -2) + 'A=', sig('T5MJ:P03000').replace(/=+$/, '') + '==', null, undefined, 42, {}, []];
  const vins = [REF_IDS.vin17, REF_IDS.vin17.toLowerCase(), `  ${REF_IDS.vin17.toLowerCase()}  `, `\t${REF_IDS.vin17}\n`,
    ` ${REF_IDS.vin17} `, `﻿${REF_IDS.vin17}`, `​${REF_IDS.vin17}`, '  zzzzzzzz0zz000000  ', 'ZZZZZZZZ0ZZ000000',
    'ZZZZZZZZIZ0000000', 'ZZZZZZZZOZ0000000', 'ZZZZZZZZQZ0000000', 'zzzzzzzziz0000000', 'ZZZZZZZZ0ZZ00000!', 'ZZZZZZZZ0ZZ 00000',
    'ZZZZZZZZ0ZZ00000', 'ZZZZZZZZ0ZZ0000000', '1234567', '', '   ', 'ZZZZZZZZ0ZZ000000é', 'ZZZZZZZZ0ZZ00000ß', 'Z'.repeat(4096),
    'Z'.repeat(4097), ' '.repeat(4090) + REF_IDS.vin17, ' '.repeat(4079) + REF_IDS.vin17, ' '.repeat(4080) + REF_IDS.vin17, ' '.repeat(4096) + REF_IDS.vin17, `\u2028${REF_IDS.vin17}\u2029`, null, undefined, 17, {}];
  const stocks = [ORDER, OTHER_ORDER, ORDER.toUpperCase(), ORDER.replace('-4bb1-', '-1bb1-'), ORDER.replace('-8b6b-', '-cb6b-'),
    ORDER.replace('-8b6b-', '-ab6b-'), ` ${ORDER}`, `${ORDER}\n`, '0000123', '', ORDER.slice(1), ORDER + '0', ORDER.replace(/-/g, ''),
    '00000000-0000-4000-8000-000000000000', '00000000-0000-5000-8000-000000000000', 'g' + ORDER.slice(1), null, undefined, 7];
  const out = [];
  for (const [kind, ids] of [['configuration', configurations], ['vin', vins], ['stock', stocks], ['bogus', [ORDER]], [undefined, [ORDER]]]) {
    for (const id of ids) {
      const canonical = canonicalVehicleIdentifier(kind, id);
      out.push({ kind: kind ?? null, id: id === undefined ? { undefined: true } : id, canonical });
    }
  }
  return out;
}
const snapshotFor = (identity, over = {}) => createVehicleSnapshot({ sourceNamespace: 'synthetic:stock-generator.v1', identityKind: 'exact-stock',
  sourceKeys: { stockId: ORDER }, snapshotVersion: 'stock-generator.v1:fixture-policy', observedAt: '2026-11-11T00:00:00.000Z',
  display: { name: 'Exact generated stock' }, facts: { syntheticIdentity: { status: 'known', value: identity, unit: null,
    provenance: { sourceRef: 'generator:stock-generator.v1', observedAt: '2026-11-11T00:00:00.000Z',
      version: 'stock-generator.v1:fixture-policy', assurance: 'synthetic-scenario' } } }, ...over });

async function s2() {
  mkdirSync(GOLDEN, { recursive: true });
  for (const name of readdirSync(GOLDEN)) if (/^s2-.*\.json$/.test(name)) rmSync(join(GOLDEN, name));
  pretty(join(GOLDEN, 's2-identifiers.json'), { vectors: identifierVectors() });
  const ref = storeRows(REF); const fleet = storeRows('fleet-source.v1'); const demo = storeRows('demo-fleet.v1');
  const configRow = (rows, id) => rows.configurations.find((r) => r.configurationId === id);
  const refRow = configRow(ref, REF_IDS.configurationId); const okRow = configRow(ref, OK_CONFIG);
  const vin = ref.vins[0];
  const supplementId = fleet.manifest.technicalSupplements[0].configurationId;
  const partial = (rows, schema) => rows.configurations.find((r) => r.catalogue?.status === 'partial' && r.catalogue.schemaVersion === schema
    && r.configurationId !== supplementId);
  const fleetPartial2 = partial(fleet, '2');
  const demoRow = demo.configurations.find((r) => r.configurationId !== supplementId && r.catalogue?.status === 'partial');
  const fleetNone = fleet.configurations.find((r) => !r.catalogue?.status);
  const cfg = (store, id, extra = {}) => ({ store, request: { kind: 'configuration', id }, context: null, full: true, ...extra });
  const full = [
    { name: 'ref configuration', ...cfg(REF, REF_IDS.configurationId) },
    { name: 'ref second configuration (catalogue ok)', ...cfg(REF, OK_CONFIG) },
    { name: 'ref VIN', store: REF, request: { kind: 'vin', id: vin.vin17 }, context: null, full: true },
    { name: 'ref VIN lowercase with spaces', store: REF, request: { kind: 'vin', id: `  ${vin.vin17.toLowerCase()}  ` }, context: null, full: true },
    { name: 'ref VIN with context', store: REF, request: { kind: 'vin', id: vin.vin17 }, context: CONTEXT, full: true },
    { name: 'fleet reference configuration', ...cfg('fleet-source.v1', fleetNone.configurationId) },
    { name: 'fleet VIN', store: 'fleet-source.v1', request: { kind: 'vin', id: vin.vin17 }, context: null, full: true },
    { name: 'fleet catalogue ok', ...cfg('fleet-source.v1', OK_CONFIG) },
    { name: 'fleet technical supplement', ...cfg('fleet-source.v1', supplementId) },
    { name: 'fleet partial schema 2', ...cfg('fleet-source.v1', fleetPartial2.configurationId) },
    { name: 'demo fleet partial', ...cfg('demo-fleet.v1', demoRow.configurationId) },
    { name: 'demo fleet supplement', ...cfg('demo-fleet.v1', supplementId) },
    { name: 'demo fleet VIN is absent', store: 'demo-fleet.v1', request: { kind: 'vin', id: vin.vin17 }, context: null },
  ];
  const pins = (store, id, kind, row, extra = {}) => {
    const pin = (expected) => ({ store, request: { kind, id, expected }, context: null, ...extra });
    return [
      ['matching configurationId', { configurationId: row.configurationId }], ['mismatching configurationId', { configurationId: 'other' }],
      ['matching market', { market: row.configuration.market }], ['mismatching market', { market: 'ZZ' }],
      ['matching bodyType', { bodyType: row.configuration.body }], ['mismatching bodyType', { bodyType: 'Touring' }],
      ['matching snapshotVersion', { snapshotVersion: row.snapshotVersion }], ['mismatching snapshotVersion', { snapshotVersion: 'other.v9' }],
      ['matching profileId', { profileId: 'wba-430i-convertible-my2026' }], ['mismatching profileId', { profileId: 'not-the-retained-profile' }],
      ['all matching', { configurationId: row.configurationId, market: row.configuration.market, bodyType: row.configuration.body,
        snapshotVersion: row.snapshotVersion }],
      ['unknown pin key', { colour: 'red' }], ['empty pin value', { market: '' }], ['empty pins', {}],
    ].map(([label, expected]) => ({ name: `${kind} pin ${label}`, ...pin(expected) }));
  };
  full.push(...pins(REF, REF_IDS.configurationId, 'configuration', refRow), ...pins(REF, vin.vin17, 'vin', refRow));
  const trio = (kind, missing, invalid) => [
    { name: `${kind} not found`, store: REF, request: { kind, id: missing }, context: CONTEXT },
    { name: `${kind} invalid`, store: REF, request: { kind, id: invalid }, context: CONTEXT },
    { name: `${kind} unavailable (no registry or repository)`, store: null, request: { kind, id: missing }, context: CONTEXT },
  ];
  full.push(...trio('configuration', b64('UNKNOWN:CODE'), 'invalid'), ...trio('vin', 'ZZZZZZZZ0ZZ000000', 'invalid'),
    ...trio('stock', OTHER_ORDER, 'invalid'));
  full.push(
    { name: 'null request', store: REF, request: null, context: null },
    { name: 'string request', store: REF, request: 'configuration', context: null },
    { name: 'array request', store: REF, request: [], context: null },
    { name: 'extra request key', store: REF, request: { kind: 'vin', id: vin.vin17, provider: 'live', identityKind: 'real' }, context: null },
    { name: 'expected not an object', store: REF, request: { kind: 'vin', id: vin.vin17, expected: 'x' }, context: null },
    { name: 'expected null', store: REF, request: { kind: 'vin', id: vin.vin17, expected: null }, context: null },
    { name: 'expected array', store: REF, request: { kind: 'vin', id: vin.vin17, expected: ['market'] }, context: null },
    { name: 'expected value not text', store: REF, request: { kind: 'vin', id: vin.vin17, expected: { market: 7 } }, context: null },
    { name: 'unknown kind', store: REF, request: { kind: 'bogus', id: vin.vin17 }, context: null },
    { name: 'missing kind', store: REF, request: { id: vin.vin17 }, context: null },
    { name: 'kind not text', store: REF, request: { kind: 7, id: vin.vin17 }, context: null },
    { name: 'id not text', store: REF, request: { kind: 'vin', id: 17 }, context: null },
    { name: 'stock without repository', store: REF, request: { kind: 'stock', id: ORDER }, context: CONTEXT },
    { name: 'vin 7-character form is invalid', store: REF, request: { kind: 'vin', id: vin.vin17.slice(-7) }, context: null },
    { name: 'vin unknown but well formed', store: REF, request: { kind: 'vin', id: 'WBA33DB08TC499999' }, context: null },
    { name: 'configuration unknown but canonical', store: REF, request: { kind: 'configuration', id: b64('REF1:NOPE') }, context: null },
    { name: 'no registry', store: null, request: { kind: 'configuration', id: REF_IDS.configurationId }, context: null });
  const doubles = [
    ['status unsupported', { fixed: { status: 'unsupported', failure: { message: 'private source detail' } } }],
    ['status identity-mismatch', { fixed: { status: 'identity-mismatch', failure: { message: 'private source detail' } } }],
    ['status not-found', { fixed: { status: 'not-found' } }], ['status invalid-input', { fixed: { status: 'invalid-input' } }],
    ['status unknown value', { fixed: { status: 'conflict' } }], ['status missing', { fixed: {} }], ['registry throws', { throws: true }],
    ['catalogue unsupported', { set: [['record.catalogue.status', 'unsupported']] }],
    ['catalogue identity-mismatch', { set: [['record.catalogue.status', 'identity-mismatch']] }],
    ['record configurationId differs', { set: [['record.configurationId', 'other']] }],
    ['source without active', { delete: ['active'] }], ['source without images', { delete: ['images'] }],
    ['image with wrong configuration', { set: [['images.0.configurationId', 'other']] }],
    ['sourceRefs not an array', { set: [['record.sourceContext.sourceRefs', 'x']] }],
    ['unresolvedFacts not an array', { delete: ['record.sourceContext.unresolvedFacts'] }],
    ['no canonicalIdentity', { delete: ['record.canonicalIdentity'] }],
    ['configuration not an object', { set: [['record.configuration', []]] }],
    ['selected equipment known, definitions not an array', { set: [['record.catalogue.equipment.selected.state', 'known'], ['record.catalogue.equipment.definitions', {}]] }],
    ['definition resolution with swatches', { set: [['definitionResolution', { state: 'resolved', resolvedCount: 2, selectedCount: 3, unresolved: [] }]] }],
    ['definition resolution without resolved codes', { set: [['definitionResolution', { state: 'unknown', resolvedCount: 0, reason: 'definition-seed-unavailable' }]] }],
    ['catalogue without equipment', { delete: ['record.catalogue.equipment'] }],
    ['catalogue removed', { delete: ['record.catalogue'] }],
    ['technical fact with wrong unit', { set: [['record.catalogue.facts.luggageNormal.unit', 'GALLONS']] }],
    ['technical fact with unknown state', { set: [['record.catalogue.facts.luggageNormal.state', 'guess']] }],
    ['configuration description values removed', { delete: ['record.configuration.model', 'record.configuration.derivative', 'record.configuration.body'] }],
    ['configuration description values null', { set: [['record.configuration.model', null], ['record.configuration.derivative', 0]] }],
  ];
  for (const [label, registry] of doubles) {
    const onVin = (r) => ({ ...r, registry: r.registry });
    full.push({ name: `double ${label} (configuration)`, store: REF, registry, request: { kind: 'configuration', id: OK_CONFIG }, context: null });
    full.push(onVin({ name: `double ${label} (vin)`, store: REF, registry, request: { kind: 'vin', id: vin.vin17 }, context: null }));
  }
  const vinDoubles = [
    ['vin17 differs', { set: [['vehicle.vin17', 'ZZZZZZZZ0ZZ000000']] }], ['vehicle absent', { delete: ['vehicle'] }],
    ['usage delivered-car', { set: [['vehicle.usage', 'delivered-car']] }], ['usage current-car', { set: [['vehicle.usage', 'current-car']] }],
    ['usage unknown', { set: [['vehicle.usage', 'rental']] }], ['usage missing', { delete: ['vehicle.usage'] }],
    ['identityKind real', { set: [['vehicle.identityKind', 'real']] }], ['configurationHash substituted', { set: [['vehicle.configurationHash', 'substituted']] }],
    ['vehicle snapshotVersion differs', { set: [['vehicle.snapshotVersion', 'other.v9']] }], ['vehicle configurationId differs', { set: [['vehicle.configurationId', 'other']] }],
    ['vehicle fields beyond the profile', { set: [['vehicle.registrationDate', '2026-01-01'], ['vehicle.generatorVersion', 'g1']] }],
    ['vehicle profile without registry version', { delete: ['vehicle.profile.registryVersion'] }],
  ];
  for (const [label, registry] of vinDoubles) {
    full.push({ name: `double ${label} (vin)`, store: REF, registry, request: { kind: 'vin', id: vin.vin17 }, context: null });
  }
  const image = (configurationId, role, over = {}) => ({ imageId: `image-${role}`, asset: `assets/gcsp-vehicle-evidence/${role}.webp`, configurationId,
    role, fidelity: role, sourceKind: 'dated-snapshot', observedDate: '2026-11-01', ...over });
  const imageDoubles = (id, label) => [
    [`two images ${label}`, [image(id, 'representative-model'), image(id, 'representative-configuration')]],
    [`image of another configuration ${label}`, [image('other', 'representative-model')]],
    [`image role differs from fidelity ${label}`, [image(id, 'representative-model', { fidelity: 'representative-configuration' })]],
    [`image role unsupported ${label}`, [image(id, 'hero', { fidelity: 'hero' })]],
    [`image not an object ${label}`, ['image.webp']],
    [`image with extra members ${label}`, [image(id, 'representative-model', { viewpoint: 'front', label: 'Front' })]],
  ];
  for (const [label, images] of imageDoubles(OK_CONFIG, '(configuration)')) {
    full.push({ name: `double ${label}`, store: REF, registry: { set: [['images', images]] }, request: { kind: 'configuration', id: OK_CONFIG }, context: null, full: label.startsWith('two images') });
  }
  for (const [label, images] of imageDoubles(REF_IDS.configurationId, '(vin)')) {
    full.push({ name: `double ${label}`, store: REF, registry: { set: [['images', images]] }, request: { kind: 'vin', id: vin.vin17 }, context: null });
  }
  const results = [];
  for (const entry of full) results.push(await runCase(entry));
  compact(join(GOLDEN, 's2-full.json'), '', results);

  // Stock cases: one repository double per case, rebuilt in Java from the recorded spec.
  const hashOf = (row) => inputDigest(row.configuration);
  const identityFor = (row, over = {}) => ({ vehicleId: 'fictional-stock-car', identityKind: 'synthetic', originatingDatasetId: 'lookup-fixture',
    snapshotVersion: row.snapshotVersion, configurationHash: hashOf(row), ...over });
  const stockRow = (row, over = {}) => ({ runId: CONTEXT.runId, orderUuid: ORDER, orderNumber: '0000123', configurationId: row.configurationId,
    corpusVersion: 'reference-corpus.v1', facts: { syntheticIdentity: identityFor(row) }, ...over });
  const runOk = [{ status: 'ok', runId: CONTEXT.runId }];
  const spec = (record, over = {}) => ({ currentRuns: runOk, read: { status: 'ok', record }, ...over });
  const canonicalFacts = (row, identityOver = {}, snapshotOver = {}) => snapshotFor(identityFor(row, identityOver), snapshotOver);
  const stockCase = (name, stock, over = {}) => ({ name, store: REF, request: { kind: 'stock', id: ORDER }, context: CONTEXT, stock,
    full: name === 'legacy envelope' || name === 'canonical exact-stock snapshot', ...over });
  const stocks = [
    stockCase('legacy envelope', spec(stockRow(refRow))),
    stockCase('legacy envelope, catalogue ok configuration', spec(stockRow(okRow))),
    stockCase('legacy envelope, empty role list', spec(stockRow(refRow)), { context: { ...CONTEXT, roles: [] } }),
    stockCase('canonical exact-stock snapshot', spec(stockRow(refRow, { facts: canonicalFacts(refRow) }))),
    stockCase('canonical exact-stock snapshot, catalogue ok configuration', spec(stockRow(okRow, { facts: canonicalFacts(okRow) }))),
    stockCase('legacy envelope with matching pins', spec(stockRow(refRow)), { request: { kind: 'stock', id: ORDER, expected: {
      configurationId: refRow.configurationId, market: refRow.configuration.market, bodyType: refRow.configuration.body, snapshotVersion: refRow.snapshotVersion } } }),
    stockCase('legacy envelope with mismatching pin', spec(stockRow(refRow)), { request: { kind: 'stock', id: ORDER, expected: { market: 'ZZ' } } }),
    stockCase('legacy envelope with profile pin (no vehicle)', spec(stockRow(refRow)), { request: { kind: 'stock', id: ORDER, expected: { profileId: 'x' } } }),
    stockCase('canonical, empty facts', spec(stockRow(refRow, { facts: { ...canonicalFacts(refRow), facts: {} } }))),
    stockCase('canonical, wrong stockId', spec(stockRow(refRow, { facts: { ...canonicalFacts(refRow), sourceKeys: { stockId: OTHER_ORDER } } }))),
    stockCase('canonical, legacy-record identityKind', spec(stockRow(refRow, { facts: { ...canonicalFacts(refRow), identityKind: 'legacy-record' } }))),
    stockCase('canonical, unknown fact status', spec(stockRow(refRow, { facts: { ...canonicalFacts(refRow), facts: { syntheticIdentity: {
      ...canonicalFacts(refRow).facts.syntheticIdentity, status: 'unknown', value: null } } } }))),
    stockCase('canonical, substituted configurationHash', spec(stockRow(refRow, { facts: canonicalFacts(refRow, { configurationHash: 'substituted' }) }))),
    stockCase('canonical, value not an object', spec(stockRow(refRow, { facts: { ...canonicalFacts(refRow), facts: { syntheticIdentity: {
      ...canonicalFacts(refRow).facts.syntheticIdentity, value: 'x' } } } }))),
    stockCase('legacy, configurationHash substituted', spec(stockRow(refRow, { facts: { syntheticIdentity: identityFor(refRow, { configurationHash: 'x' }) } }))),
    stockCase('legacy, snapshotVersion differs', spec(stockRow(refRow, { facts: { syntheticIdentity: identityFor(refRow, { snapshotVersion: 'other.v9' }) } }))),
    stockCase('legacy, identityKind real', spec(stockRow(refRow, { facts: { syntheticIdentity: identityFor(refRow, { identityKind: 'real' }) } }))),
    stockCase('legacy, vehicleId missing', spec(stockRow(refRow, { facts: { syntheticIdentity: identityFor(refRow, { vehicleId: undefined }) } }))),
    stockCase('legacy, originatingDatasetId empty', spec(stockRow(refRow, { facts: { syntheticIdentity: identityFor(refRow, { originatingDatasetId: '' }) } }))),
    stockCase('legacy, hash of another configuration', spec(stockRow(okRow, { facts: { syntheticIdentity: identityFor(refRow) } }))),
    stockCase('empty facts', spec(stockRow(refRow, { facts: {} }))),
    stockCase('facts absent', spec(stockRow(refRow, { facts: undefined }))),
    stockCase('wrong orderUuid on the row', spec(stockRow(refRow, { orderUuid: OTHER_ORDER }))),
    stockCase('wrong runId on the row', spec(stockRow(refRow, { runId: 'next-run' }))),
    stockCase('orderNumber too short', spec(stockRow(refRow, { orderNumber: '123' }))),
    stockCase('orderNumber not digits', spec(stockRow(refRow, { orderNumber: '00001a3' }))),
    stockCase('orderNumber absent', spec(stockRow(refRow, { orderNumber: undefined }))),
    stockCase('configurationId empty', spec(stockRow(refRow, { configurationId: '' }))),
    stockCase('configurationId absent from the corpus', spec(stockRow(refRow, { configurationId: 'no-such-configuration' }))),
    stockCase('read ok without a row', { currentRuns: runOk, read: { status: 'ok', record: undefined } }),
    stockCase('read not-found', { currentRuns: runOk, read: { status: 'not-found' } }),
    stockCase('read invalid-input', { currentRuns: runOk, read: { status: 'invalid-input' } }),
    stockCase('read unsupported', { currentRuns: runOk, read: { status: 'unsupported' } }),
    stockCase('read identity-mismatch', { currentRuns: runOk, read: { status: 'identity-mismatch' } }),
    stockCase('read conflict (unknown status)', { currentRuns: runOk, read: { status: 'conflict' } }),
    stockCase('read throws', { currentRuns: runOk, read: { throws: true } }),
    stockCase('run lookup not ok', { currentRuns: [{ status: 'not-found' }], read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('run lookup throws', { currentRuns: [{ throws: true }], read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('run changed before read', { currentRuns: [{ status: 'ok', runId: 'next-run' }], read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('run changed between read and re-check', { currentRuns: [{ status: 'ok', runId: CONTEXT.runId }, { status: 'ok', runId: 'next-run' }],
      read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('run unavailable at re-check', { currentRuns: [{ status: 'ok', runId: CONTEXT.runId }, { status: 'not-found' }],
      read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('run lookup throws at re-check', { currentRuns: [{ status: 'ok', runId: CONTEXT.runId }, { throws: true }],
      read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('run restored at re-check', { currentRuns: [{ status: 'ok', runId: CONTEXT.runId }, { status: 'ok', runId: CONTEXT.runId }],
      read: { status: 'ok', record: stockRow(refRow) } }),
    stockCase('missing context', spec(stockRow(refRow)), { context: null }),
    stockCase('context without runId', spec(stockRow(refRow)), { context: { ...CONTEXT, runId: undefined } }),
    stockCase('context with empty principalId', spec(stockRow(refRow)), { context: { ...CONTEXT, principalId: '' } }),
    stockCase('context with a non-text role', spec(stockRow(refRow)), { context: { ...CONTEXT, roles: ['employee', 7] } }),
    stockCase('context with an empty role', spec(stockRow(refRow)), { context: { ...CONTEXT, roles: [''] } }),
    stockCase('context roles not an array', spec(stockRow(refRow)), { context: { ...CONTEXT, roles: 'employee' } }),
    stockCase('context not an object', spec(stockRow(refRow)), { context: 'lookup-run' }),
    stockCase('missing repository', null),
    stockCase('no registry', spec(stockRow(refRow)), { store: null }),
    stockCase('invalid stock id', spec(stockRow(refRow)), { request: { kind: 'stock', id: ORDER.toUpperCase() } }),
    stockCase('registry double unsupported', spec(stockRow(refRow)), { registry: { fixed: { status: 'unsupported' } } }),
    stockCase('registry double not-found', spec(stockRow(refRow)), { registry: { fixed: { status: 'not-found' } } }),
    stockCase('registry double throws', spec(stockRow(refRow)), { registry: { throws: true } }),
    stockCase('catalogue unsupported', spec(stockRow(okRow)), { registry: { set: [['record.catalogue.status', 'unsupported']] } }),
    stockCase('invalid source (no active)', spec(stockRow(refRow)), { registry: { delete: ['active'] } }),
  ];
  const stockResults = [];
  for (const entry of stocks) stockResults.push(await runCase(entry));
  compact(join(GOLDEN, 's2-stock.json'), '', stockResults);

  // Digests are in configurations.jsonl row order; idsDigest pins that order so the Java side can read ids in place.
  const digests = {};
  for (const [store, rows] of [[REF, ref], ['demo-fleet.v1', demo], ['fleet-source.v1', fleet]]) {
    const lookup = createVehicleEvidenceLookup({ registry: await loadedRegistry(store) });
    const configurations = []; const vins = [];
    for (const row of rows.configurations) configurations.push(inputDigest(await lookup.resolve({ kind: 'configuration', id: row.configurationId })));
    for (const row of rows.vins) vins.push({ vin17: row.vin17, digest: inputDigest(await lookup.resolve({ kind: 'vin', id: row.vin17 })) });
    digests[store] = { idsDigest: inputDigest(rows.configurations.map((r) => r.configurationId)), configurations, vins };
  }
  write(join(GOLDEN, 's2-digests.json'), digests);
}

// ---- s3: retained display imagery and configuration definitions ---------------------------------------------------
const STORES_S3 = [REF, 'demo-fleet.v1', 'fleet-source.v1'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bump = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
const compactRecord = (entries) => entries.map(([key, value]) => JSON.stringify(key) + ':' + JSON.stringify(value));

// Serves every mapped id through Node's production handler with no network, so only the retained fallback answers.
async function retainedServe(id) {
  const handler = createLiveDisplayImageHandler({ fetchImpl: async () => { throw new Error('offline'); },
    loadSources: async () => { throw new Error('no sources'); } });
  let status = null; let body = null;
  const res = { writeHead(code) { status = code; }, end(bytes) { body = bytes ?? null; } };
  const pathname = `/api/gcsp/vehicle-images/${id}.webp`;
  await handler({ req: { method: 'GET', url: pathname }, res, pathname });
  return { status, body };
}
async function s3Images() {
  const data = await readDisplayImageCatalogue();
  const all = [...data.configurations.map((row) => row.image), ...Object.values(data.variants), ...Object.values(data.models),
    ...Object.values(data.configurationGalleries ?? data.galleries ?? {}).flat()];
  const mapping = new Map();
  for (const image of all) {
    if (/^bmw-display-[a-f0-9]{20}$/.test(image?.imageId) && /^assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/.test(image.asset)
      && /^[a-f0-9]{64}$/.test(image.sha256) && Number.isSafeInteger(image.bytes) && image.bytes > 0 && image.bytes <= 2 * 1024 * 1024) mapping.set(image.imageId, image);
  }
  const ids = [...mapping.keys()];
  const entry = async (id) => {
    const { status, body } = await retainedServe(id);
    const image = mapping.get(id);
    return status === 200 ? { imageId: id, asset: image.asset, sha256: sha(body), bytes: body.length } : null;
  };
  const cases = [];
  for (const id of [...ids.slice(0, 20), 'bmw-display-ffffffffffffffffffff', 'not-an-image-id', 'bmw-display-07c269dd7f55fad0a56bX']) {
    cases.push({ imageId: id, expected: await entry(id) });
  }
  const served = []; for (const id of ids) { const found = await entry(id); if (found) served.push([id, found.sha256]); }
  return { mappingSize: mapping.size, cases, servedCount: served.length, servedDigest: inputDigest(served) };
}
// Node's own gallery logic with an injected asset loader: wrong bytes, size mismatch, one failing view, unreadable asset.
async function s3Failures(rows, registry) {
  const data = await readDisplayImageCatalogue();
  const known = new Map(data.configurations.map((row) => [row.configurationId, row]));
  const row = rows.configurations.find((r) => known.has(r.configurationId));
  const record = registry.getConfiguration(row.configurationId).record;
  const base = await configurationDisplayGallery(record);
  if (base.length < 3) throw new Error('failure fixture needs a three view gallery');
  const load = (target, kind) => async (image) => {
    const bytes = readFileSync(join(ROOT, image.asset));
    if (image.asset !== target) return bytes;
    if (kind === 'throw') throw new Error('asset unreadable');
    if (kind === 'truncate') return bytes.subarray(0, bytes.length - 1);
    const copy = Buffer.from(bytes); copy[copy.length >> 1] ^= 0xff; return copy;
  };
  const cases = [];
  for (const [name, view, kind] of [['wrong bytes, first view', 0, 'flip'], ['wrong bytes, second view', 1, 'flip'],
    ['size mismatch, second view', 1, 'truncate'], ['size mismatch, first view', 0, 'truncate'],
    ['unreadable asset, third view', 2, 'throw'], ['wrong bytes, third view', 2, 'flip']]) {
    const asset = base[view].asset;
    cases.push({ name, store: 'fleet-source.v1', configurationId: row.configurationId, asset, kind,
      gallery: await configurationDisplayGallery(record, { loadAsset: load(asset, kind) }) });
  }
  return { baseline: base, cases };
}
async function s3() {
  mkdirSync(GOLDEN, { recursive: true });
  for (const name of readdirSync(GOLDEN)) if (/^s3-.*\.json$/.test(name)) rmSync(join(GOLDEN, name));
  const lookups = new Map(STORES_S3.map((store) => [store, createLocalVehicleEvidenceLookup({ root: join(REAL, store), asOf: ASOF })]));
  const waitReady = async (lookup) => { for (let w = 0; lookup.readiness().status === 'loading' && w < 120000; w += 50) await sleep(50); };
  for (const lookup of lookups.values()) await waitReady(lookup);
  const fresh = await lookups.get(REF).definitionStatus();
  if (fresh.diagnostics?.resolutions !== 0) throw new Error('definition index already used; run s3 alone');

  const digests = {}; const picks = {};
  const found = (name, label, result) => { if (!picks[name]) picks[name] = { label, result }; };
  for (const store of STORES_S3) {
    const rows = storeRows(store); const lookup = lookups.get(store);
    const configurations = []; const vins = []; const counts = { representative: 0, imageStates: {}, resolutionStates: {}, galleryViews: {} };
    const tally = (result) => {
      bump(counts.imageStates, result.images?.state ?? 'none');
      if (result.images?.state === 'representative') counts.representative += 1;
      bump(counts.resolutionStates, result.equipment?.resolution?.state ?? 'none');
      bump(counts.galleryViews, String(result.images?.items?.length ?? 0));
    };
    for (const row of rows.configurations) {
      const result = await lookup.resolve({ kind: 'configuration', id: row.configurationId });
      configurations.push(inputDigest(result)); tally(result);
      const items = result.images?.items ?? []; const reasons = result.equipment?.resolution?.unresolved?.map((u) => u.reason) ?? [];
      if (items.length >= 3 && items[0].fidelity === 'representative-configuration') found('gallery', `${store} configuration with a representative-configuration gallery`, result);
      if (items.length && items.every((i) => i.fidelity === 'representative-model')) found('modelOnly', `${store} variant-only representative-model image`, result);
      if (result.equipment?.resolution?.state === 'complete') found('known', `${store} complete definitions`, result);
      if (result.equipment?.resolution?.state === 'partial') found('partialDefinitions', `${store} partial definitions`, result);
      if (reasons.includes('definition-context-unavailable')) found('contextUnavailable', `${store} definition context unavailable`, result);
      if (result.status === 'complete' || result.status === 'partial') if (!items.length) found('noImages', `${store} no retained image`, result);
    }
    for (const row of rows.vins) {
      const result = await lookup.resolve({ kind: 'vin', id: row.vin17 });
      vins.push({ vin17: row.vin17, digest: inputDigest(result) }); tally(result);
      if (store === REF) found('referenceVin', 'lookup-reference VIN', result);
    }
    digests[store] = { idsDigest: inputDigest(rows.configurations.map((r) => r.configurationId)), counts, configurations, vins };
  }
  digests.definitionStatusAfter = await lookups.get(REF).definitionStatus();
  write(join(GOLDEN, 's3-digests.json'), digests);

  // The unavailable seed: Node's own decorator with a rejected index, over the bare registry.
  const bare = await loadedRegistry(REF); const refRows = storeRows(REF);
  const unavailable = createVehicleEvidenceLookup({ registry: withConfigurationDefinitions(bare, { index: Promise.reject(new Error('seed')) }) });
  const seedUnavailable = {
    status: await withConfigurationDefinitions(bare, { index: Promise.reject(new Error('seed')) }).definitionStatus(),
    configuration: await unavailable.resolve({ kind: 'configuration', id: REF_IDS.configurationId }),
    vin: await unavailable.resolve({ kind: 'vin', id: REF_IDS.vin17 }),
  };
  // Display images only (no definitions): the same view Java uses to prove a tampered catalogue adds nothing.
  const imagesOnly = createVehicleEvidenceLookup({ registry: withDisplayImages(await loadedRegistry('fleet-source.v1')) });
  const fleetRows = storeRows('fleet-source.v1');
  const imagesOnlyDigests = [];
  for (const row of fleetRows.configurations.slice(0, 40)) imagesOnlyDigests.push(inputDigest(await imagesOnly.resolve({ kind: 'configuration', id: row.configurationId })));

  const names = ['gallery', 'modelOnly', 'known', 'partialDefinitions', 'contextUnavailable', 'noImages', 'referenceVin'];
  for (const name of names) if (!picks[name] && ['gallery', 'modelOnly', 'known', 'contextUnavailable', 'referenceVin'].includes(name)) throw new Error(`no ${name} example`);
  const cases = names.filter((name) => picks[name]).map((name) => ({ name: picks[name].label, key: name,
    id: picks[name].result.requested.id, kind: picks[name].result.requested.kind,
    store: STORES_S3.find((store) => picks[name].label.startsWith(store)) ?? REF, result: picks[name].result }));
  compact(join(GOLDEN, 's3-full.json'), `"definitionStatus":${JSON.stringify(fresh)},"seedUnavailable":${JSON.stringify(seedUnavailable)},`
    + `"imagesOnlyFleetDigests":${JSON.stringify(imagesOnlyDigests)},`, cases);

  pretty(join(GOLDEN, 's3-images.json'), await s3Images());
  pretty(join(GOLDEN, 's3-failures.json'), await s3Failures(fleetRows, await loadedRegistry('fleet-source.v1')));
}

// ---- s4: both provider shapes behind one application contract --------------------------------------------------------
const FIXTURES = join(ROOT, 'server/test/fixtures/gcsp/vehicle-evidence');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const wire = (value) => JSON.parse(JSON.stringify(value));
const NAN = { $nan: true };
// Mutations are data so Java replays exactly what Node ran: set/delete by dotted path (array indexes allowed).
function applyOps(target, ops = []) {
  for (const op of ops) {
    const parts = (op.set ?? op.del).split('.'); let node = target;
    for (const part of parts.slice(0, -1)) node = node?.[part];
    if (node === null || typeof node !== 'object') continue;
    const last = parts.at(-1);
    if (op.del !== undefined) delete node[last];
    else node[last] = op.value && op.value.$nan ? Number.NaN : structuredClone(op.value);
  }
  return target;
}

async function s4() {
  mkdirSync(GOLDEN, { recursive: true });
  for (const name of readdirSync(GOLDEN)) if (/^s4-.*\.json$/.test(name)) rmSync(join(GOLDEN, name));
  const fixture = readJson(join(FIXTURES, 'alternate-provider.json'));
  const context = fixture.context;
  const [vehicle] = lines(join(REAL, 'publication-reference.v1/vins.jsonl')).map((l) => JSON.parse(l));
  const stockEntry = fixture.entries.find((e) => e.key.category === 'order');
  const orderUuid = stockEntry.key.token;
  const stock = { runId: context.runId, orderUuid, orderNumber: '0000123', configurationId: vehicle.configurationId,
    facts: { syntheticIdentity: { identityKind: 'synthetic', vehicleId: 'fictional-stock-car', originatingDatasetId: 'consumer-fixture',
      snapshotVersion: vehicle.snapshotVersion, configurationHash: vehicle.configurationHash } } };
  const repository = { currentRun: async () => ({ status: 'ok', value: { runId: context.runId } }),
    read: async (_context, { key }) => key.orderUuid === orderUuid ? { status: 'ok', value: stock } : { status: 'not-found' } };
  const lookup = createLocalVehicleEvidenceLookup({ root: join(REAL, REF), repository, asOf: ASOF });
  for (let waited = 0; lookup.readiness().status === 'loading' && waited < 120000; waited += 50) await sleep(50);
  if (lookup.readiness().status !== 'ready') throw new Error('lookup-reference.v1 did not load');
  const fixtureClassify = (request) => {
    const card = fixture.entries.find((e) => e.document.card.query.kind === request.kind && e.document.card.query.id === request.id)?.document.card;
    return card ? { status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId: card.identifiers.composition,
      ...(card.identifiers.subject ? { vehicleId: card.identifiers.subject } : {}) }
      : { status: 'not-found', identityKind: 'unknown', liveEligible: false };
  };
  const offlineRead = (key, options) => {
    const entry = fixture.entries.find((e) => e.key.category === key.category && e.key.token === key.token);
    const document = !entry ? { edition: 'offline-cards/1', result: 'missing' }
      : entry.context && entry.context.runId !== options.context?.runId ? { edition: 'offline-cards/1', result: 'mismatch' } : entry.document;
    return { document: structuredClone(document), transportStatus: 200 };
  };
  const entryDocument = (index) => structuredClone(fixture.entries[index].document);
  const requests = fixture.entries.map((e) => ({ kind: e.document.card.query.kind, id: e.key.token }));
  const [configuration, complete] = requests;
  const b64s = (text) => Buffer.from(text).toString('base64');

  // ---- the lookup results the application adapter receives (Node production decorated lookup)
  const bases = {
    configuration: wire(await lookup.resolve(configuration)), complete: wire(await lookup.resolve(complete)),
    vin: wire(await lookup.resolve({ kind: 'vin', id: vehicle.vin17 })),
  };
  const v2 = readJson(join(FIXTURES, 'catalogue-v2-source-record.json'));
  const v2Request = { kind: 'configuration', id: v2.configurationId };
  bases.v2 = wire(vehicleEvidenceDetails(v2Request, { status: 'partial', record: v2, images: [],
    active: { datasetId: 'v2-consumer-regression', version: '1', manifestDigest: 'a'.repeat(64) } }));
  const empty = readJson(join(FIXTURES, 'empty-mandatory-elements-cases.json'));
  empty.cases.forEach((c, i) => { bases[`empty${i}`] = c.direct; });

  const cases = [];
  const matrixRun = async (c) => {
    const base = c.lookupBase ? applyOps(structuredClone(bases[c.lookupBase]), c.ops) : c.lookupResult;
    const document = c.docBase !== undefined ? applyOps(entryDocument(c.docBase), c.ops) : c.document;
    const read = () => ({ ...(c.transportStatus !== undefined ? { transportStatus: c.transportStatus } : {}), document: structuredClone(document) });
    const classification = c.classification;
    const identityLookup = { classifyRequest: () => structuredClone(classification) };
    const options = { identityLookup, ...(c.provider === 'lookup' ? { lookup: { resolve: () => structuredClone(base) } } : { provider: 'alternate-offline', alternateRead: read }) };
    const consumer = c.route === false
      ? createVehicleDetailsConsumer({ adapter: c.provider === 'lookup' ? createLookupVehicleAdapter({ lookup: options.lookup })
        : createAlternateOfflineVehicleAdapter({ read }) })
      : createConfiguredVehicleDetails(options);
    return wire(await consumer.resolve(structuredClone(c.request), { context: c.context ?? undefined }));
  };
  const add = async (c) => {
    const full = { route: true, context: null, ...c };
    const canonical = full.request && typeof full.request === 'object' && typeof full.request.kind === 'string'
      ? canonicalVehicleIdentifier(full.request.kind, full.request.id) : null;
    if (full.classification === undefined) full.classification = canonical ? fixtureClassify({ kind: full.request.kind, id: canonical }) : null;
    const result = await matrixRun(full);
    const keep = full.full || !['complete', 'partial'].includes(result.status) ? { result } : { resultStatus: result.status, resultDigest: inputDigest(result) };
    cases.push({ ...full, ...keep });
    return result;
  };
  const both = async (name, request, ctx, perProvider) => {
    for (const provider of ['lookup', 'alternate-offline']) await add({ name: `${name} [${provider}]`, provider, request, context: ctx, ...perProvider(provider) });
  };
  const vinConfig = (vin) => ({ kind: 'vin', id: vin });

  // 1. providers.json: both shapes for every fixture entry through the real production wiring
  const providers = [];
  for (const request of requests) {
    const local = createConfiguredVehicleDetails({ lookup, identityLookup: { classifyRequest: async (r) => fixtureClassify(r) } });
    const alt = createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: offlineRead, identityLookup: { classifyRequest: async (r) => fixtureClassify(r) } });
    const a = wire(await local.resolve(request, { context })); const b = wire(await alt.resolve(request, { context }));
    const withoutImages = (v) => { const copy = structuredClone(v); delete copy.images; delete copy.equipment.resolution;
      delete copy.completeness.images; delete copy.presentation.imageLabel; return copy; };
    if (inputDigest(withoutImages(a.vehicle)) !== inputDigest(withoutImages(b.vehicle))) throw new Error(`shapes differ for ${request.kind}`);
    providers.push({ request, lookup: a, alternate: b, withoutImagesDigest: inputDigest(withoutImages(a.vehicle)) });
  }
  pretty(join(GOLDEN, 's4-providers.json'), { context, cases: providers });

  // 2. matrix.json: every failure and pin case of the three Node contract suites
  const unknownVin = 'ZZZZZZZZ0ZZ000000';
  // lookup adapter receives the lowercase padded VIN canonicalised; stock without context is refused before the adapter
  await add({ name: 'adapter: lowercase padded VIN is canonicalised', provider: 'lookup', request: { kind: 'vin', id: ` ${vehicle.vin17.toLowerCase()} ` }, context, lookupBase: 'vin' });
  await add({ name: 'adapter: stock without a trusted context', provider: 'lookup', request: { kind: 'stock', id: orderUuid }, context: null, lookupResult: null });
  for (const request of [null, {}, { ...configuration, id: configuration.id.replace(/=+$/, '') }, { kind: 'stock', id: '0000123' },
    { kind: 'vin', id: 'ZZZZZZZZIZ0000000' }, { ...configuration, url: 'https://private.example' }, { ...configuration, provider: 'live' },
    { ...configuration, expected: { unknown: 'field' } }, { ...configuration, expected: null }, { ...configuration, expected: { market: 5 } },
    [], 'text', { ...configuration, baseUrl: 'https://private.example' }, { ...configuration, provider: 'alternate-offline' }]) {
    await both(`invalid input ${JSON.stringify(request)}`, request, context, (p) => p === 'lookup' ? { lookupResult: null } : { document: null });
  }
  for (const request of [{ kind: 'vin', id: unknownVin }, { kind: 'configuration', id: b64s('UNKNOWN:CODE') }, { kind: 'stock', id: '6ff0feca-90cd-4e6f-903c-41fad1ef9b91' }]) {
    await both(`miss ${request.kind}`, request, context, (p) => p === 'lookup' ? { lookupResult: null } : { document: null });
  }
  const staleContext = { ...context, runId: 'old-run' };
  const staleLookup = wire(await lookup.resolve({ kind: 'stock', id: orderUuid }, { context: staleContext }));
  await both('stock under a previous run', { kind: 'stock', id: orderUuid }, staleContext, (p) => p === 'lookup'
    ? { lookupResult: staleLookup } : { document: offlineRead({ category: 'order', token: orderUuid }, { context: staleContext }).document });
  for (const [status, altStatus] of [['unsupported', 'unsupported'], ['source-unavailable', 'unavailable'], ['identity-mismatch', 'mismatch']]) {
    await both(`typed ${status}`, configuration, null, (p) => p === 'lookup' ? { lookupResult: vehicleEvidenceFailure(status, 'configuration') }
      : { document: { edition: 'offline-cards/1', result: altStatus } });
  }
  // pins
  const baseVin = (await createConfiguredVehicleDetails({ lookup, identityLookup: { classifyRequest: async (r) => fixtureClassify(r) } })
    .resolve({ kind: 'vin', id: vehicle.vin17 })).vehicle;
  const pins = { configurationId: vehicle.configurationId, vehicleId: vehicle.vehicleId, datasetId: baseVin.identity.datasetId,
    originatingDatasetId: vehicle.originatingDatasetId, corpusVersion: baseVin.versions.corpus, snapshotVersion: vehicle.snapshotVersion,
    market: 'US', model: '430i', bodyType: 'Convertible', powertrain: 'petrol', profileId: vehicle.profile.profileId, observedDate: '2026-11-01' };
  const vinRequest = (expected) => ({ kind: 'vin', id: vehicle.vin17, ...(expected ? { expected } : {}) });
  const vinBy = (p) => p === 'lookup' ? { lookupBase: 'vin' } : { docBase: 2 };
  await both('every pin matches', vinRequest(pins), null, vinBy);
  for (const key of Object.keys(pins)) await both(`pin ${key} differs`, vinRequest({ [key]: 'different' }), null, vinBy);
  for (const key of ['effectDate', 'orderDate', 'taxDate', 'catalogueDate', 'agModelCode', 'vgModelCode']) {
    await both(`pin ${key} differs (complete)`, { ...complete, expected: { [key]: 'different' } }, null, (p) => p === 'lookup' ? { lookupBase: 'complete' } : { docBase: 1 });
  }
  // alternate stock scope
  for (const scope of [undefined, { run: 'old-run', environment: context.environmentId }, { run: context.runId, environment: 'other-environment' }]) {
    await add({ name: `alternate stock scope ${JSON.stringify(scope ?? null)}`, provider: 'alternate-offline', request: { kind: 'stock', id: orderUuid },
      context, docBase: 3, ops: [scope ? { set: 'card.scope', value: scope } : { del: 'card.scope' }] });
  }
  // wrong identities
  for (const [name, ops] of [['vin', [{ set: 'identity.vin', value: 'ZZZZZZZZ0ZZ000000' }]],
    ['configuration', [{ set: 'resolved.configurationId', value: b64s('OTHER:CODE') }]],
    ['identityKind real', [{ set: 'identity.identityKind', value: 'real' }]], ['usage stock', [{ set: 'identity.usage', value: 'stock' }]]]) {
    await add({ name: `wrong returned ${name}`, provider: 'lookup', request: vinConfig(vehicle.vin17), context: null, lookupBase: 'vin', ops });
  }
  for (const [name, ops] of [['model code', [{ set: 'source.resolvedIdentity.modelCode', value: 'OTHER' }]],
    ['market', [{ set: 'source.resolvedIdentity.market', value: 'US' }]],
    ['requested effect date', [{ set: 'source.requestedIdentity.effectDate', value: '2026-01-01' }]]]) {
    await add({ name: `wrong source ${name}`, provider: 'lookup', request: complete, context: null, lookupBase: 'complete', ops });
  }
  for (const field of ['chassis', 'composition', 'flavour', 'purpose']) {
    await add({ name: `alternate wrong ${field}`, provider: 'alternate-offline', request: vinConfig(vehicle.vin17), context: null, docBase: 2,
      ops: [{ set: `card.identifiers.${field}`, value: field === 'composition' ? b64s('OTHER:CODE') : 'different' }] });
  }
  // malformed, versioned and truncated payloads, wrong units, impossible evidence
  for (const value of [null, {}, 'not JSON', [], { contractVersion: '99', schemaVersion: '1' }]) {
    await add({ name: `lookup value ${JSON.stringify(value)}`, provider: 'lookup', request: configuration, context: null, lookupResult: value });
  }
  for (const document of [null, {}, 'not JSON', '{"edition":', JSON.stringify({ edition: 'offline-cards/2' }), { edition: 'offline-cards/1', result: 'complete', card: {} },
    { edition: 'offline-cards/1', result: 'bogus' }, { edition: 'offline-cards/1', result: 'complete' },
    { edition: 'offline-cards/1', result: 'missing' }, { edition: 'offline-cards/1', result: 'invalid' }]) {
    await add({ name: `alternate document ${JSON.stringify(document)}`, provider: 'alternate-offline', request: configuration, context: null, document });
  }
  const unitOps = [
    ['seats unit', [{ set: 'technical.seats.unit', value: 'LITRES' }]], ['seats NaN', [{ set: 'technical.seats.value', value: NAN }]],
    ['paint object', [{ set: 'description.paint', value: {} }]], ['verifiedFitted known', [{ set: 'equipment.verifiedFitted.state', value: 'known' }]],
    ['images state', [{ set: 'images.state', value: 'exact-build' }]], ['impossible date', [{ set: 'source.observedDate', value: '2026-02-30' }]],
    ['versions deleted', [{ del: 'versions' }]], ['extra fact key', [{ set: 'description.model.sourceKey', value: 'private' }]],
    ['extra identity key', [{ set: 'source.requestedIdentity.privateStorageName', value: 'private' }]],
    ['live routing', [{ set: 'routing.liveEligible', value: true }]], ['routing mode', [{ set: 'routing.mode', value: 'live' }]],
    ['source kind', [{ set: 'source.kind', value: 'real-build' }]], ['unsafe reference', [{ set: 'source.references.0', value: 'http://public.example/x' }]],
    ['private host reference', [{ set: 'source.references.0', value: 'https://10.0.0.1/handbook' }]],
    ['presentation label', [{ set: 'presentation.unknownLabel', value: 'n/a' }]],
  ];
  for (const [name, ops] of unitOps) await add({ name: `impossible evidence: ${name}`, provider: 'lookup', request: complete, context: null, lookupBase: 'complete', ops });
  // transport status stays separate from capability and completeness
  await add({ name: 'transport 503 with a good document', provider: 'alternate-offline', request: configuration, context: null, docBase: 0, transportStatus: 503 });
  await add({ name: 'transport 200 with a truncated document', provider: 'alternate-offline', request: configuration, context: null,
    document: '{"edition":', transportStatus: 200 });
  await add({ name: 'transport 200 with a good document', provider: 'alternate-offline', request: configuration, context: null, docBase: 0, transportStatus: 200 });
  for (const transport of [{ protocol: 'offline', status: 503, attempts: 1, outcome: 'answered' }, { protocol: 'in-process', status: null, attempts: 1, outcome: 'unavailable' },
    { protocol: 'in-process', status: null, attempts: 3, outcome: 'answered' }, { protocol: 'carrier-pigeon', status: null, attempts: 1, outcome: 'answered' },
    { protocol: 'offline', status: 99, attempts: 1, outcome: 'answered' }, { protocol: 'offline', status: 200, attempts: 1, outcome: 'answered' }]) {
    const consumer = createVehicleDetailsConsumer({ adapter: { resolve: () => ({ result: structuredClone(bases.complete), transport }) } });
    const result = wire(await consumer.resolve(complete));
    cases.push({ name: `direct transport ${JSON.stringify(transport)}`, provider: 'direct', transport, request: complete, context: null, lookupBase: 'complete',
      ...(['complete', 'partial'].includes(result.status) ? { resultStatus: result.status, resultDigest: inputDigest(result) } : { result }) });
  }
  // image roles survive either mapping; unsafe assets stay unavailable (adapters used without routing, as the Node test does)
  const image = { imageId: 'fictional-contract-image', asset: 'fixture-only/no-runtime-asset.webp', role: 'representative-model', fidelity: 'representative-model',
    sourceKind: 'dated-snapshot', observedDate: '2026-11-01', label: 'Representative model image' };
  const imageOps = [{ del: 'equipment.resolution' }, { set: 'images', value: { state: 'representative', label: 'Representative imagery', items: [image] } },
    { set: 'presentation.imageLabel', value: 'Representative imagery' }, { set: 'completeness.images', value: 'representative' }];
  const portraits = (extra = {}) => ({ knowledge: 'representative', caption: 'Representative imagery', pictures: [{ reference: image.imageId, resource: image.asset,
    usage: image.role, accuracy: image.fidelity, origin: image.sourceKind, dated: image.observedDate, caption: image.label, ...extra }] });
  const portraitOps = (extra) => [{ set: 'card.portraits', value: portraits(extra) }, { set: 'card.labels.imageLabel', value: 'Representative imagery' },
    { set: 'card.coverage.images', value: 'representative' }];
  const imageCases = [['representative model image', {}], ['exact-build accuracy', { accuracy: 'exact-build' }],
    ['private asset', { resource: 'https://private.local/handbook?key=opaque' }]];
  for (const [name, extra] of imageCases) {
    const lookupOps = [...imageOps]; if (extra.accuracy) lookupOps.push({ set: 'images.items.0.fidelity', value: extra.accuracy });
    if (extra.resource) lookupOps.push({ set: 'images.items.0.asset', value: extra.resource });
    await add({ name: `image ${name} [lookup]`, provider: 'lookup', route: false, request: complete, context: null, lookupBase: 'complete', ops: lookupOps, classification: null, full: !extra.accuracy && !extra.resource });
    await add({ name: `image ${name} [alternate-offline]`, provider: 'alternate-offline', route: false, request: complete, context: null, docBase: 1, ops: portraitOps(extra), classification: null, full: !extra.accuracy && !extra.resource });
  }
  // public citations stay exact; credential parameters and queried image assets stay unavailable
  const citation = 'https://www.press.bmwgroup.com/global/article/reference?language=en';
  for (const [name, references] of [['language citation', [citation]], ['token parameter', ['https://public.example/source?token=opaque']],
    ['language plus key', ['https://public.example/source?language=en&key=opaque']], ['private host', ['https://private.local/source?language=en']],
    ['credentials', ['https://name:opaque@public.example/source?language=en']]]) {
    await add({ name: `citation ${name}`, provider: 'lookup', route: false, request: configuration, context: null, lookupBase: 'configuration',
      ops: [{ set: 'source.references', value: references }], classification: null, full: name === 'language citation' });
  }
  await add({ name: 'citation used as an image asset', provider: 'lookup', route: false, request: configuration, context: null, lookupBase: 'configuration',
    ops: [{ set: 'source.references', value: [citation] }, { set: 'images', value: { state: 'representative', label: 'Representative imagery', items: [{
      imageId: 'citation-is-not-an-asset', asset: citation, role: 'representative-model', fidelity: 'representative-model', sourceKind: 'dated-snapshot',
      observedDate: '2026-11-01', label: 'Representative model image' }] } }, { set: 'presentation.imageLabel', value: 'Representative imagery' },
    { set: 'completeness.images', value: 'representative' }], classification: null });
  // v2 source DTO
  const ok2 = { status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId: v2.configurationId };
  await add({ name: 'v2 source DTO at the application port', provider: 'lookup', request: v2Request, context: null, lookupBase: 'v2', classification: ok2, full: true });
  const bindings = [['binding digest', [{ set: 'source.resolvedIdentity.bindingDigest', value: 'b'.repeat(64) }]],
    ['configuration id', [{ set: 'source.requestedIdentity.configurationId', value: b64s('T5MJ:S0000') }, { set: 'source.resolvedIdentity.configurationId', value: b64s('T5MJ:S0000') }]],
    ['snapshot version', [{ set: 'source.requestedIdentity.snapshotVersion', value: 'different' }, { set: 'source.resolvedIdentity.snapshotVersion', value: 'different' }]]];
  for (const [name, ops] of bindings) await add({ name: `v2 identity substitution: ${name}`, provider: 'lookup', request: v2Request, context: null, lookupBase: 'v2', classification: ok2, ops });
  const refs0 = bases.v2.source.references[0];
  for (const [name, ops] of [['quantity value on unknown', [{ set: 'equipment.selected.accessories.0.quantity.value', value: 1 }]],
    ['scalar quantity', [{ set: 'equipment.selected.accessories.0.quantity', value: 1 }]],
    ['overstated quantity completeness', [{ set: 'equipment.selected.accessoryQuantitiesComplete', value: true }]],
    ['factoryComplete string', [{ set: 'equipment.selected.factoryComplete', value: 'yes' }]],
    ['extra requested identity key', [{ set: 'source.requestedIdentity.extra', value: 'untrusted' }]],
    ['token parameter', [{ set: 'source.references.0', value: `${refs0}&token=secret` }]],
    ['private host', [{ set: 'source.references.0', value: refs0.replace('prod.ucp.bmw.cloud', 'private.example') }]]]) {
    await add({ name: `v2 malformed: ${name}`, provider: 'lookup', request: v2Request, context: null, lookupBase: 'v2', classification: ok2, ops });
  }
  // present-empty mandatory-elements citations
  for (const [i, c] of empty.cases.entries()) {
    const okc = { status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId: c.request.id };
    const request = { kind: c.request.kind, id: c.request.id };
    await add({ name: `empty mandatory-elements ${c.vgModelCode}`, provider: 'lookup', request, context: null, lookupBase: `empty${i}`, classification: okc, full: true });
    if (i === 0) {
      const at = c.direct.source.references.findIndex((r) => r.includes('/rulesolver/'));
      const local = c.direct.source.references.findIndex((r) => r.includes('/localisations/'));
      const reference = c.direct.source.references[at];
      const edits = [(r) => `${r}&mandatory-elements=`, (r) => `${r}S01h2`, (r) => `${r}%2C`, (r) => `${r}%2CS01H2`, (r) => `${r}S01`, (r) => `${r}%20`,
        (r) => `${r}&token=secret`, (r) => r.replace('&mandatory-elements=', '&mandatory-element='), (r) => r.replace(/included-elements=[^&]*/, 'included-elements='),
        (r) => r.replace('/models/1F7A?', '/models/1F7A/extra?'), (r) => r.replace('https:', 'http:'), (r) => `${r}#fragment`,
        (r) => r.replace('&mandatory-elements=', '&mandatory-elements=S0337&mandatory-elements='), (r) => r.replace('mandatory-elements=', 'Mandatory-Elements='),
        (r) => r.replace('prod.ucp.bmw.cloud', 'prod.ucp.bmw.cloud:8443'), (r) => r.replace('prod.ucp.bmw.cloud', 'PROD.UCP.BMW.CLOUD'),
        (r) => r.replace('prod.ucp.bmw.cloud', 'user@prod.ucp.bmw.cloud'), (r) => r.replace('https://', 'https:\\\\')];
      for (const [n, edit] of edits.entries()) {
        await add({ name: `empty mandatory-elements malformed ${n}`, provider: 'lookup', request, context: null, lookupBase: 'empty0', classification: okc,
          ops: [{ set: `source.references.${at}`, value: edit(reference) }] });
      }
      await add({ name: 'empty mandatory-elements on the localisation citation', provider: 'lookup', request, context: null, lookupBase: 'empty0', classification: okc,
        ops: [{ set: `source.references.${local}`, value: `${c.direct.source.references[local]}?mandatory-elements=` }] });
    }
  }
  // egress safeguards ported as data
  const stockRequest = { kind: 'stock', id: orderUuid };
  await add({ name: 'delivered identity cannot enter the stock adapter', provider: 'alternate-offline', request: stockRequest, context, docBase: 3,
    classification: { status: 'identity-mismatch', identityKind: 'unknown', liveEligible: false }, neverRead: true });
  await add({ name: 'unknown VIN miss never reads', provider: 'alternate-offline', request: vinConfig(unknownVin), context: null, docBase: 2,
    classification: { status: 'not-found', identityKind: 'unknown', liveEligible: false }, neverRead: true });
  await add({ name: 'unknown VIN miss never reads [lookup]', provider: 'lookup', request: vinConfig(unknownVin), context: null, lookupBase: 'vin',
    classification: { status: 'not-found', identityKind: 'unknown', liveEligible: false }, neverRead: true });
  await add({ name: 'substituted composition behind a known VIN', provider: 'alternate-offline', request: vinConfig(vehicle.vin17), context: null, docBase: 2,
    ops: [{ set: 'card.identifiers.composition', value: complete.id }] });
  await add({ name: 'live-eligible classification', provider: 'lookup', request: configuration, context: null, lookupBase: 'configuration',
    classification: { status: 'ok', identityKind: 'synthetic', liveEligible: true, configurationId: configuration.id } });
  await add({ name: 'real identity classification', provider: 'lookup', request: configuration, context: null, lookupBase: 'configuration',
    classification: { status: 'ok', identityKind: 'real', liveEligible: false, configurationId: configuration.id } });
  await add({ name: 'unknown classification status', provider: 'lookup', request: configuration, context: null, lookupBase: 'configuration',
    classification: { status: 'maybe', identityKind: 'unknown', liveEligible: false } });
  await add({ name: 'mismatched vehicle id behind the binding', provider: 'lookup', request: vinConfig(vehicle.vin17), context: null, lookupBase: 'vin',
    classification: { ...fixtureClassify({ kind: 'vin', id: vehicle.vin17 }), vehicleId: 'another-vehicle' } });
  compact(join(GOLDEN, 's4-matrix.json'), `"bases":${JSON.stringify(Object.fromEntries(Object.entries(bases).filter(([k]) => ['configuration', 'complete', 'vin', 'v2'].includes(k))))},`
    + `"emptyCases":${JSON.stringify(empty.cases.map((c) => ({ vgModelCode: c.vgModelCode })))},`, cases);

  // 2b. urls.json: Node's accept/reject for each URL as an image asset, a source citation and a v2 citation, via the real consumer
  const v2Ref = bases.v2.source.references;
  const urlVectors = ['https://a/b?', 'https://a/b?#x', 'https://@host/', 'https://:@host/', 'https://@@host/', 'https://user@/p', 'https:///foo.com/bar',
    'https:\\\\foo.com\\x', 'HTTPS://Foo.COM:443/x', 'https://foo.com:0443/x', 'https://foo.com:8443/x', ' https://foo.com/x ', 'https://127.1/', 'https://0x7f.1/',
    'https://2130706433/', 'https://１２７．０．０．１/', 'https://ＬＯＣＡＬＨＯＳＴ/', 'https://a/b/../c/./d/%2e%2e/e', 'https://a/b^c|d', 'https://exa mple.com/',
    'https://foo.com./x', 'https://foo.com:/x', 'https://a%2eb/', 'https://[::1]/', 'https://a/\tb/c', 'https://straße.de/', 'https://a.b.1/', 'https://1.2.3.4.5/',
    'https://256.1/', 'https://a..b/', 'https:foo.com/x', 'https:/foo.com/x', 'https://a:99999/', 'https://a:abc/', 'https://a:443/', 'https://a:80/', 'https://a/.%2e/x',
    'https://a/x/..', 'https://a\\b', 'https://é.com/', 'https://a/b?x=é y', 'https://0300.0250.0.1/', 'https://0x7f000001/', 'https://1.2.3/', 'https://a.1/',
    'https://0x/', 'https://1./', 'https://a%00b/', 'https://a b/', 'https://a_b/', 'https://%61.com/', 'https://a.com%2fx/', 'https://a.com:/', 'https://u:p@a.com/',
    'https://:p@a.com/', 'https://u:@a.com/', 'https://a@b@c.com/', 'https://a/b?%', 'https://[::1]:80/', 'https://a.com:65535/', 'https://a.com:65536/',
    'https://LOCALHOST./', 'https://foo.LOCAL/', 'https://10.0.0.1./', 'https://10.1/', 'https://172.16.0.1/', 'https://172.15.0.1/', 'https://172.32.0.1/',
    'https://192.168.1.1/x', 'https://0.0.0.0/', 'https://128.0.0.1/', 'https://localhost/x', 'https://notlocal/x', 'https://x.local./a', 'https://x.local/a',
    'http://public.example/x', 'ftp://public.example/x', 'data:text/plain,hi', 'javascript:alert(1)', '//public.example/x', 'public.example/x', 'assets/a.webp', '/assets/a.webp',
    'assets/../a.webp', 'assets/a.webp?x=1', 'assets\\a.webp', 'https://public.example/x#frag', 'https://public.example/x?', 'https://public.example/x?language=en',
    'https://public.example/x?language=en-GB', 'https://public.example/x?language=EN', 'https://public.example/x?language=en&', 'https://public.example/x?&language=en',
    'https://public.example/x?language=en&language=en', 'https://public.example/x?language=e', 'https://public.example/x?language=en%2DGB', 'https://public.example/x?language=%65n',
    'https://public.example/x?lang%75age=en', 'https://public.example/x?language=en#f', 'https://public.example/x?language=en+', 'https://public.example/x?language',
    'https://pub lic.example/x?language=en', 'https://public.example:8443/x?language=en', 'https://public.example/x y?language=en', 'https://public.example/x?language=en y',
    'https://user@public.example/x?language=en', 'https://public.example/x?token=a', 'https://public.example/%2e%2e/x?language=en', 'https://public.example/../x?language=en',
    'https://prod.ucp.bmw.cloud/x', 'https://prod.ucp.bmw.cloud/x?trim=S0337', 'https://prod.ucp.bmw.cloud:443/x?language=en', 'https://PROD.UCP.BMW.CLOUD/x',
    ...v2Ref, ...v2Ref.map((r) => r + '#f'), ...v2Ref.map((r) => r.replace('https:', 'http:')), ...v2Ref.map((r) => r.replace('?', '?x=1&')),
    ...v2Ref.map((r) => r.replace(/\?.*/, '')), ...v2Ref.map((r) => r + '&' + r.split('?')[1]), ...v2Ref.map((r) => r.replace('bmwCar', 'bmwcar')),
    ...v2Ref.map((r) => r.replace('/gb/', '/GB/')), ...v2Ref.map((r) => r.replace('2027-01-05', '2027-1-05')), ...v2Ref.map((r) => r.replace('%2C', ',')),
    ...v2Ref.map((r) => r.replace('prod.ucp.bmw.cloud', 'prod.ucp.bmw.cloud.')), ...v2Ref.map((r) => r.replace('prod.ucp.bmw.cloud', 'prod.ucp.bmw.cloud:443')),
    ...v2Ref.map((r) => r.replace('?', '?%61=1&')), ...v2Ref.map((r) => r.replace('S0337', 's0337')), ...v2Ref.map((r) => r.replace('=none', '=%6Eone')),
    ...v2Ref.map((r) => r.replace('trim=S0337', 'trim=S%30337')), ...v2Ref.map((r) => r.replace('?', '?;')), ...v2Ref.map((r) => r.replace('&', ';'))];
  const withUrl = async (base, ops, request, classification) => {
    const consumer = createVehicleDetailsConsumer({ adapter: createLookupVehicleAdapter({ lookup: { resolve: () => applyOps(structuredClone(bases[base]), ops) } }) });
    const r = await consumer.resolve(request, {}); return ['complete', 'partial'].includes(r.status);
  };
  const urlCases = [];
  for (const url of [...new Set(urlVectors)]) {
    const asset = await withUrl('complete', [{ set: 'images', value: { state: 'representative', label: 'Representative imagery', items: [{ ...image, asset: url }] } },
      { set: 'presentation.imageLabel', value: 'Representative imagery' }, { set: 'completeness.images', value: 'representative' }, { del: 'equipment.resolution' }], complete);
    const source = await withUrl('configuration', [{ set: 'source.references', value: [url] }], configuration);
    const v2Source = await withUrl('v2', [{ set: 'source.references.0', value: url }], v2Request);
    urlCases.push({ url, asset, source, v2Source });
  }
  pretty(join(GOLDEN, 's4-urls.json'), { cases: urlCases });

  // 3. routing.json: server-owned classification over retained stores
  const routingRequests = [{ kind: 'configuration', id: REF_IDS.configurationId }, { kind: 'configuration', id: b64s('UNKNOWN:CODE') },
    { kind: 'vin', id: REF_IDS.vin17 }, { kind: 'vin', id: unknownVin }, { kind: 'configuration', id: OK_CONFIG }];
  const routing = {};
  const roots = { 'lookup-reference.v1': join(REAL, REF), ...Object.fromEntries(['deactivated', 'inventory-tampered', 'inventory-missing', 'empty',
    'history-config-missing', 'checksum-corrupt', 'not-in-history'].map((name) => [name, join(STORES, name)])) };
  for (const [name, root] of Object.entries(roots)) {
    const registry = createRegistry(root); await registry.load();
    const route = createVehicleIdentityRouting({ identityLookup: createVehicleEvidenceLookup({ registry }), provider: 'lookup' });
    routing[name] = [];
    for (const request of routingRequests) {
      const outcome = await route(request, {});
      routing[name].push({ request, route: typeof outcome === 'string' ? outcome : { configurationId: outcome.configurationId ?? null, vehicleId: outcome.vehicleId ?? null } });
    }
  }
  pretty(join(GOLDEN, 's4-routing.json'), { stores: routing });
}

const slices = { s1, s2, s3, s4 };
const only = process.argv[2];
for (const [name, run] of Object.entries(slices)) if (!only || only === name) await run();

