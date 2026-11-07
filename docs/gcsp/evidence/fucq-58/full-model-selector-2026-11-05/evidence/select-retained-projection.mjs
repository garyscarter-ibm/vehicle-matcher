import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectFullModelRecord } from './full-model-selector.mjs';

if (process.argv.length !== 2) throw Error('offline-selector-arguments');
const hash = value => createHash('sha256').update(value).digest('hex');
const planBytes = await readFile(new URL('../plan.json', import.meta.url));
const plan = JSON.parse(planBytes);
if (plan.version !== 'fleet-full-model-selector-offline-plan.v1' || plan.network.attempts !== 0 || plan.network.writes !== 0) throw Error('offline-selector-plan');
const projectionBytes = await readFile(new URL('../../steering-diagnostic-2026-11-05/evidence/projection.json', import.meta.url));
const diagnosticBytes = await readFile(new URL('../../steering-diagnostic-2026-11-05/evidence/diagnostic.json', import.meta.url));
const diagnostic = JSON.parse(diagnosticBytes);
if (hash(projectionBytes) !== plan.fixtureSha256 || hash(projectionBytes) !== diagnostic.projectionSha256 || diagnostic.status !== 'completed-bounded-diagnostic') throw Error('offline-selector-provenance');
const selected = selectFullModelRecord(JSON.parse(projectionBytes), plan.expected);
const result = {
  ...selected,
  selectedAt: new Date().toISOString(),
  sourceObservedAt: diagnostic.observedDate,
  source: 'public-bmw-uk-configurator',
  providerStatus: 'unsupported-public-website',
  inputProjection: plan.fixture,
  inputProjectionSha256: hash(projectionBytes),
  inputDiagnosticSha256: hash(diagnosticBytes),
  planSha256: hash(planBytes),
  selectorSha256: hash(await readFile(new URL('./full-model-selector.mjs', import.meta.url))),
  testsSha256: hash(await readFile(new URL('./full-model-selector.test.mjs', import.meta.url))),
  entrypointSha256: hash(await readFile(new URL('./select-retained-projection.mjs', import.meta.url))),
  networkAttempts: 0,
  explanation: 'Offline selection from the retained actual observation; no fresh source observation, steering-code translation, constructibility or VIN-profile claim.',
};
await writeFile(new URL('./selection.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ selection: result.selection, aliasAppearances: result.aliasAppearances, distinctSelectedModels: result.distinctSelectedModels, qualification: result.qualification, networkAttempts: 0, output: 'selection.json' }));
