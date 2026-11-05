import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilePolicyProvider, PolicyService } from '../../server/gcsp/policy/index.js';
import { validInstant } from '../../server/gcsp/policy/file-provider.js';
import { createSyntheticRegistry } from '../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { inputDigest } from '../../server/gcsp/repository/index.js';
import { createLearningDataset, loadLearningPolicy, LearningInputError, validateLearningDataset } from '../../server/gcsp/predict/records/index.js';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const valueOptions = new Set(['seed', 'output', 'snapshot', 'policy-file', 'policy-version', 'as-of', 'run-id', 'corpus-store']);
const help = `Generate a bounded synthetic learning dataset and required manifest.
Usage: node scripts/gcsp/generate-learning-records.mjs --seed SEED [options]
  --output DIR          New output directory; existing paths are preserved
  --policy-file FILE    Complete immutable PolicyService source (default: seed-v1)
  --policy-version ID   Pin a version from that file
  --as-of ISO           Policy read instant (default: that source's effectiveFrom)
  --run-id ID           Policy read scope (default: learning-cli)
  --corpus-store DIR    Read an already published local configuration registry
  --snapshot FILE       Replay a complete prepared learning-policy snapshot
  --allow-fixtures      Explicitly permit labelled structural fixture configurations
  --help                Show this help
No policy adoption, database connection or corpus publication is performed.
`;
class CliError extends Error {
  constructor(code, field) { super(code); this.code = code; this.field = field; }
}
function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const key = token?.startsWith('--') ? token.slice(2) : '';
    if (Object.hasOwn(options, key)) throw new CliError('invalid-arguments', 'options');
    if (['help', 'allow-fixtures'].includes(key)) options[key] = true;
    else if (valueOptions.has(key) && typeof argv[index + 1] === 'string' && argv[index + 1].length > 0
      && !argv[index + 1].startsWith('--')) options[key] = argv[++index];
    else throw new CliError('invalid-arguments', 'options');
  }
  if (options.help) return options;
  if (!options.seed || options.seed.length > 512) throw new CliError('invalid-arguments', 'seed');
  if (options.snapshot && ['policy-file', 'policy-version', 'as-of', 'run-id', 'corpus-store'].some((key) => options[key]))
    throw new CliError('incompatible-options', 'snapshot');
  if (options['as-of'] && !validInstant(options['as-of'])) throw new CliError('invalid-arguments', 'as-of');
  return options;
}
async function readSnapshot(path) {
  try {
    if ((await stat(path)).size > MAX_INPUT_BYTES) throw new Error('oversized');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch { throw new CliError('snapshot-unavailable', 'snapshot'); }
}
async function prepare(options) {
  if (options.snapshot) return readSnapshot(resolve(options.snapshot));
  const provider = new FilePolicyProvider(options['policy-file'] ? { filePath: resolve(options['policy-file']) } : {});
  let versions;
  try { versions = await provider.loadVersions(); } catch { throw new CliError('policy-unavailable', 'policy-file'); }
  const version = options['policy-version'] ? versions.find((row) => row.policyVersion === options['policy-version']) : versions[0];
  if (!version) throw new CliError('policy-unavailable', 'policy-version');
  const policyService = new PolicyService({ provider });
  const policyRead = { runId: options['run-id'] ?? 'learning-cli', asOf: options['as-of'] ?? version.effectiveFrom,
    policyVersion: version.policyVersion };
  let corpus;
  if (options['corpus-store']) {
    corpus = createSyntheticRegistry({ root: resolve(options['corpus-store']), policyService, policyRead });
    const loaded = await corpus.load();
    if (loaded.status !== 'ok' || loaded.recovered) throw new CliError('corpus-unavailable', 'corpus-store');
  }
  return loadLearningPolicy({ policyService, policyRead, corpus });
}

export async function runCli({ argv = [], write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line) } = {}) {
  let ownedOutput;
  try {
    const options = parse(argv);
    if (options.help) { write(help); return 0; }
    const snapshot = await prepare(options);
    const dataset = createLearningDataset(options.seed, snapshot);
    if (validateLearningDataset(dataset).status !== 'ok') throw new CliError('invalid-learning-dataset', 'dataset');
    const sourceKind = dataset.manifest.snapshot.comparison.configurationSource.kind;
    if (sourceKind !== 'corpus' && !options['allow-fixtures']) throw new CliError('real-corpus-required', 'configurationSource');
    const output = resolve(options.output ?? join('.claude', 'learning-records', inputDigest([options.seed, snapshot.snapshotHash])));
    await mkdir(dirname(output), { recursive: true });
    try { await mkdir(output, { mode: 0o700 }); }
    catch (error) { throw new CliError(error.code === 'EEXIST' ? 'output-exists' : 'output-unavailable', 'output'); }
    ownedOutput = output;
    const recordsPath = join(output, 'records.json');
    const manifestPath = join(output, 'manifest.json');
    await writeFile(recordsPath, `${JSON.stringify(dataset.records, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    // A manifest appears only after its complete records have been written.
    await writeFile(manifestPath, `${JSON.stringify(dataset.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    write(`${JSON.stringify({ status: 'ok', datasetKind: dataset.manifest.datasetKind, configurationSource: sourceKind,
      seed: dataset.manifest.seed, policyVersion: dataset.manifest.policyVersion, counts: dataset.manifest.counts,
      recordsPath, manifestPath })}\n`);
    ownedOutput = undefined;
    return 0;
  } catch (error) {
    if (ownedOutput) await rm(ownedOutput, { recursive: true, force: true }).catch(() => {});
    const known = error instanceof CliError || error instanceof LearningInputError;
    writeError(`${JSON.stringify({ status: 'unavailable', code: known ? error.code : 'generation-failed',
      field: known ? error.field : 'dataset' })}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runCli({ argv: process.argv.slice(2) });
