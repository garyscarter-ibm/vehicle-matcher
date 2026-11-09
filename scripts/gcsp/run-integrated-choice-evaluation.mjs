import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptChoiceTrainingPolicy } from '../../server/gcsp/predict/model/adoption.js';
import { ChoiceModelError } from '../../server/gcsp/predict/model/optimizer.js';
import { trainChoiceDataset } from '../../server/gcsp/predict/model/pipeline.js';
import { prepareActualChoiceBaselines } from '../../server/gcsp/predict/model/baselines.js';
import { writeModelArtifact } from '../../server/gcsp/predict/model/artifact.js';
import { createLearningDataset, loadLearningPolicy, readLearningDataset, validateLearningDataset } from '../../server/gcsp/predict/records/index.js';
import { bindDemoFleet } from './learning-demo-fleet.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Offline sensitivity run: real demo fleet, learning.cohortSize and learning.cycles changed by one dated successor.
Usage: node scripts/gcsp/run-integrated-choice-evaluation.mjs [--seed SEED] [--input FILE] [--output DIR] [--dataset-output DIR]
  --input FILE           Sensitivity values (default docs/gcsp/models/fucq115-sensitivity-60x4.json)
  --output DIR           Content-addressed artifact directory (default docs/gcsp/models/artifacts)
  --dataset-output DIR   Also write manifest.json and records.json there (new directory only)
Reviewed values, seed-v1 and runtime defaults are never edited. Training never activates a model.
`;
const withValue = new Set(['seed', 'input', 'output', 'dataset-output']);
function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (Object.hasOwn(options, key)) throw new ChoiceModelError('invalid-arguments', 'options');
    if (key === 'help') options.help = true;
    else if (withValue.has(key) && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new ChoiceModelError('invalid-arguments', 'options');
  }
  return options;
}

export async function runCli({ argv = [], write = (s) => process.stdout.write(s), writeError = (s) => process.stderr.write(s) } = {}) {
  let adopted;
  try {
    const options = parse(argv); if (options.help) { write(usage); return 0; }
    let sensitivity;
    try { sensitivity = JSON.parse(await readFile(resolve(options.input ?? join(root, 'docs/gcsp/models/fucq115-sensitivity-60x4.json')), 'utf8')); }
    catch { throw new ChoiceModelError('sensitivity-unavailable', 'input'); }
    adopted = await adoptChoiceTrainingPolicy({ sensitivity });
    const { policyService, policyRead } = adopted;
    const fleet = await bindDemoFleet({ policyService, policyRead });
    const snapshot = await loadLearningPolicy({ policyService: fleet.policyService, policyRead, corpus: fleet.corpus });
    const dataset = createLearningDataset(options.seed ?? '1', snapshot);
    if (validateLearningDataset(dataset).status !== 'ok') throw new ChoiceModelError('invalid-learning-dataset', 'dataset');
    if (options['dataset-output']) {
      const dir = resolve(options['dataset-output']); await mkdir(dir, { recursive: false });
      await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(dataset.manifest)}\n`, { flag: 'wx' });
      await writeFile(join(dir, 'records.json'), `${JSON.stringify(dataset.records)}\n`, { flag: 'wx' });
    }
    const result = await trainChoiceDataset({ dataset, readLearningDataset, policyService, policyRead,
      prepareBaselines: (input) => prepareActualChoiceBaselines({ ...input, policyService, policyRead }) });
    const artifact = await writeModelArtifact(resolve(options.output ?? join(root, 'docs/gcsp/models/artifacts')), result.artifact);
    const { manifest } = dataset;
    write(`${JSON.stringify({ ...result.summary, artifactPath: artifact.path, dataset: { seed: manifest.seed, generatorVersion: manifest.generatorVersion,
      policyVersion: manifest.policyVersion, dataHash: manifest.dataHash, snapshotHash: manifest.snapshotHash, counts: manifest.counts,
      corpus: manifest.snapshot.comparison.configurationSource.manifestDigest }, policyAdoptions: adopted.adoptions })}\n`);
    return 0;
  } catch (error) {
    const known = error instanceof ChoiceModelError || typeof error?.code === 'string';
    writeError(`${JSON.stringify({ status: 'unavailable', code: known ? error.code : 'evaluation-unavailable', field: known ? error.field : 'source' })}\n`);
    return 2;
  } finally { await adopted?.close().catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runCli({ argv: process.argv.slice(2) });
