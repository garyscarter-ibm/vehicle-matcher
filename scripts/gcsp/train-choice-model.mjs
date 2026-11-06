import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicyService, FilePolicyProvider } from '../../server/gcsp/policy/index.js';
import { ChoiceModelError } from '../../server/gcsp/predict/model/optimizer.js';
import { trainChoiceDataset } from '../../server/gcsp/predict/model/pipeline.js';
import { writeModelArtifact } from '../../server/gcsp/predict/model/artifact.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Train and evaluate the offline synthetic choice model.
Usage: node scripts/gcsp/train-choice-model.mjs [options]
  --dataset FILE        Manifest-backed FUCQ-113 dataset (default: committed demo)
  --policy-file FILE    Immutable policy version (default: committed canonical capture)
  --retained-policy-file FILE  Original historical policy for runtime bootstrap
  --policy-version ID   Pin a retained training policy version
  --as-of ISO          Policy read instant (otherwise source effectiveFrom)
  --run-id ID          Isolated offline policy-read scope
  --output DIR         Immutable content-addressed artifact directory
  --help               Show this help
Training never activates a model. Missing data/policy/baselines return unavailable.
The default policy source includes its committed, unchanged original historical version.
An explicit --policy-file needs any required history supplied explicitly.
`;
const optionsWithValues = new Set(['dataset', 'policy-file', 'retained-policy-file', 'policy-version', 'as-of', 'run-id', 'output']);
function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (Object.hasOwn(options, key)) throw new ChoiceModelError('invalid-arguments', 'options');
    if (key === 'help') options.help = true;
    else if (optionsWithValues.has(key) && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new ChoiceModelError('invalid-arguments', 'options');
  }
  return options;
}

export async function runCli({ argv = [], write = (s) => process.stdout.write(s), writeError = (s) => process.stderr.write(s) } = {}) {
  try {
    const options = parse(argv); if (options.help) { write(usage); return 0; }
    const policyPath = resolve(options['policy-file'] ?? join(projectRoot, 'docs/gcsp/models/choice-training-policy.json'));
    const history = options['retained-policy-file'] ? [resolve(options['retained-policy-file'])]
      : options['policy-file'] ? [] : [join(projectRoot, 'docs/gcsp/models/choice-training-policy-base.json')];
    const provider = new FilePolicyProvider({ filePath: policyPath, retainedFilePaths: history });
    let versions;
    try { versions = await provider.loadVersions(); }
    catch { throw new ChoiceModelError('choice-policy-unavailable', 'policy-source'); }
    const version = options['policy-version'] ? versions.find((v) => v.policyVersion === options['policy-version']) : versions[0];
    if (!version) throw new ChoiceModelError('choice-policy-unavailable', 'policy-version');
    const policyService = new PolicyService({ provider });
    const policyRead = { runId: options['run-id'] ?? 'offline-choice-training', asOf: options['as-of'] ?? version.effectiveFrom,
      policyVersion: version.policyVersion };
    const datasetPath = resolve(options.dataset ?? join(projectRoot, 'docs/gcsp/models/choice-training-dataset.json'));
    let dataset;
    try {
      if ((await stat(datasetPath)).size > 16 * 1024 * 1024) throw new Error('oversized');
      dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
    } catch { throw new ChoiceModelError('dataset-unavailable', 'dataset'); }
    let records; let baselines;
    try { records = await import('../../server/gcsp/predict/records/index.js'); }
    catch { throw new ChoiceModelError('dataset-source-unavailable', 'FUCQ-113.reader'); }
    try { baselines = await import('../../server/gcsp/predict/model/baselines.js'); }
    catch { throw new ChoiceModelError('baseline-unavailable', 'actual-baselines'); }
    const result = await trainChoiceDataset({ dataset, readLearningDataset: records.readLearningDataset, policyService, policyRead,
      prepareBaselines: (input) => baselines.prepareActualChoiceBaselines({ ...input, policyService, policyRead }) });
    const artifact = await writeModelArtifact(resolve(options.output ?? join(projectRoot, '.claude/choice-models')), result.artifact);
    write(`${JSON.stringify({ ...result.summary, artifactPath: artifact.path })}\n`); return 0;
  } catch (error) {
    writeError(`${JSON.stringify({ status: 'unavailable', code: error instanceof ChoiceModelError ? error.code : 'training-unavailable',
      field: error instanceof ChoiceModelError ? error.field : 'source' })}\n`); return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runCli({ argv: process.argv.slice(2) });
