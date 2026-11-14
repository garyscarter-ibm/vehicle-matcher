// Offline generator for the Java evidence goldens and fixture stores (FUCQ-459). One function per slice.
// Run from the worktree: node services/gcsp-api/src/test/node/evidence-golden.mjs [s1]
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

const slices = { s1 };
const only = process.argv[2];
for (const [name, run] of Object.entries(slices)) if (!only || only === name) await run();
