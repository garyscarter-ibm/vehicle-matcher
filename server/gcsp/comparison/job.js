import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryRepository, createMemoryStore, createPostgresRepository, inputDigest } from '../repository/index.js';
import { PolicyService, MemoryPolicyProvider } from '../policy/index.js';
import { runComparison, EXPERIMENT_IDS, PROCESS_EXPERIMENT_ID, PROCESS_COMPARISON_CAVEAT, EXPERIMENT_CAVEAT } from './experiments.js';
import { ComparisonRunError } from './harness.js';
import { ComparisonInputError } from './generator.js';
import { parseExperimentRequest, refusalFor, refusedBoundary } from './requests.js';
import { storeComparisonResult } from './results.js';

export const COMPARISON_CLI_CONTEXT = Object.freeze({ principalId: 'gcsp-comparison-cli', roles: Object.freeze(['presenter']) });
export const COMPARISON_RESULT_FORMAT = 'gcsp-process-comparison-result-v1';
export const EXPERIMENT_RESULT_FORMAT = 'gcsp-experiment-comparison-result-v1';
// The command line calls the process-only comparison "process"; the what-if experiments keep their ids.
const EXPERIMENTS = Object.freeze({ process: PROCESS_EXPERIMENT_ID, ...Object.fromEntries(EXPERIMENT_IDS.filter((id) => id !== PROCESS_EXPERIMENT_ID).map((id) => [id, id])) });
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FLAGS = Object.freeze({ '--experiment': 'experiment', '--change': 'change', '--seeds': 'seeds', '--out': 'out', '--import': 'import' });

export const USAGE = `Usage:
  node scripts/gcsp-comparison.mjs --experiment process [--seeds a,b,c] [--out <file>]
  node scripts/gcsp-comparison.mjs --experiment <order-mix|points|hold-sweep> --change <json> [--seeds a,b,c] [--out <file>]
  node scripts/gcsp-comparison.mjs --import <file>
  node scripts/gcsp-comparison.mjs --help

Runs a comparison offline and stores the result: process (today's release route against the buddy route),
or a what-if that changes one policy value. The browser worker runs the same experiments the same way.
--experiment  process, order-mix, points or hold-sweep.
--change      the change as JSON, as the browser sends it, with a basis saying why it is worth trying:
                hold-sweep  {"values":[3600,14400],"basis":"..."}
                points      {"value":1.5,"basis":"..."}
                order-mix   {"value":[{"modelLine":"...","weight":1}],"basis":"..."}
--seeds       comma-separated seeds; whole numbers are read as numbers. Default: the policy's comparison seeds.
--out         also write the result to this file, to store later or load into the server.
--import      store an existing result file without running anything.
Exit codes: 0 stored, 2 refused input or file, 1 failed.
The replay always runs in memory in this process, reading policy from the reviewed seed in the repository.
Only the result is stored, through GCSP_REPOSITORY_MODE (memory by default, or postgres with GCSP_DATABASE_URL).`;

const invalidArgs = (reason) => ({ status: 'invalid', reason });

/** Reads argv (without node and script) into { experiment, change, seeds, out, import, help } or a refusal reason. */
export function parseComparisonArgs(argv) {
  if (!Array.isArray(argv)) return invalidArgs('Arguments must be a list.');
  const value = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [name, inline] = String(argv[index]).split(/=(.*)/s, 2);
    if (name === '--help' || name === '-h') { value.help = true; continue; }
    const key = FLAGS[name];
    if (!key) return invalidArgs(`Unknown option "${argv[index]}". Use --help to see the options.`);
    if (key in value) return invalidArgs(`${name} was given more than once.`);
    let given = inline;
    if (given === undefined) {
      given = argv[index + 1];
      if (given === undefined || String(given).startsWith('--')) return invalidArgs(`${name} needs a value.`);
      index += 1;
    }
    if (given === '' && key !== 'seeds') return invalidArgs(`${name} needs a value.`);
    value[key] = String(given);
  }
  if (value.help) return { status: 'ok', value: { help: true } };
  if (value.import !== undefined && ['experiment', 'change', 'seeds', 'out'].some((key) => key in value)) {
    return invalidArgs('--import stores an existing file and cannot be combined with --experiment, --change, --seeds or --out.');
  }
  if (value.import === undefined && value.experiment === undefined) {
    return invalidArgs('Give --experiment to run a comparison, or --import <file> to store a result file.');
  }
  if (value.experiment !== undefined && !Object.hasOwn(EXPERIMENTS, value.experiment)) {
    return invalidArgs(`Unsupported experiment "${value.experiment}". Choose ${Object.keys(EXPERIMENTS).join(', ')}.`);
  }
  if (value.change !== undefined) {
    try { value.change = JSON.parse(value.change); } catch { return invalidArgs('--change is not valid JSON. Give the change as a JSON object.'); }
  }
  if (value.seeds !== undefined) {
    // A blank seed would only fail after the earlier seeds had run, so refuse it here.
    if (value.seeds.split(',').some((token) => !token.trim())) return invalidArgs('--seeds cannot contain an empty seed.');
    value.seeds = value.seeds.split(',').map((token) => {
      const number = /^-?\d+$/.test(token) ? Number(token) : NaN;
      return Number.isSafeInteger(number) ? number : token;
    });
  }
  return { status: 'ok', value };
}

const envelopeOf = (result) => ({ format: result.kind === 'process-comparison' ? COMPARISON_RESULT_FORMAT : EXPERIMENT_RESULT_FORMAT,
  digest: inputDigest(result), result });

/** Writes the digest-wrapped result atomically: a temporary file beside the target, then a rename. */
export async function writeComparisonResultFile(path, result) {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(envelopeOf(result), null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

/** Reads and verifies a result file: { status: 'ok', value: result } or { status: 'invalid', reason }. */
export async function readComparisonResultFile(path) {
  let envelope;
  try { envelope = JSON.parse(await readFile(resolve(path), 'utf8')); }
  catch (error) {
    return invalidArgs(error?.code === 'ENOENT' ? `The file ${path} does not exist.` : `The file ${path} could not be read as a result file.`);
  }
  const process = envelope?.format === COMPARISON_RESULT_FORMAT;
  if (!process && envelope?.format !== EXPERIMENT_RESULT_FORMAT) {
    return invalidArgs(`The file is not a ${COMPARISON_RESULT_FORMAT} or ${EXPERIMENT_RESULT_FORMAT} file.`);
  }
  const { result } = envelope;
  if (!result || typeof result !== 'object' || envelope.digest !== inputDigest(result)) {
    return invalidArgs('The file has changed since it was written (its digest does not match). Run the comparison again.');
  }
  if (process && (result.kind !== 'process-comparison' || result.experimentId !== PROCESS_EXPERIMENT_ID || result.schemaVersion !== 1
    || result.caveat !== PROCESS_COMPARISON_CAVEAT)) return invalidArgs('The file does not hold a process comparison result this version understands.');
  if (!process && (result.kind !== 'experiment-comparison' || !EXPERIMENT_IDS.includes(result.experimentId) || result.experimentId === PROCESS_EXPERIMENT_ID
    || result.schemaVersion !== 1 || result.caveat !== EXPERIMENT_CAVEAT)) return invalidArgs('The file does not hold an experiment comparison result this version understands.');
  return { status: 'ok', value: result };
}

/** Stores a verified result file through the same immutable-store path as a fresh run. */
export async function importComparisonResult(repository, context, path) {
  const read = await readComparisonResultFile(path);
  return read.status === 'ok' ? storeComparisonResult(repository, context, read.value) : read;
}

/** The short git revision of this checkout, else GCSP_CODE_REVISION, else 'unknown'. Runs git synchronously. */
export function defaultCodeRevision(env) {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return out;
  } catch { /* fall back */ }
  return env.GCSP_CODE_REVISION || 'unknown';
}

const LABELS = Object.freeze({ acceptableCoverage: ['Employees with an acceptable car by renewal', 'share'],
  carsNeverAllocated: ['Cars never allocated', 'number'], heldNotTakenCarDays: ['Car-days held but not taken', 'number'],
  declinedOffers: ['Offers declined', 'number'], expiredOffers: ['Offers expired', 'number'],
  failedClaims: ['Failed claims (holds expired untaken)', 'number'], retries: ['Retries after a claim conflict', 'number'],
  meanAcceptedFit: ['Mean fit of employees with a car', 'number'] });
const VERDICTS = Object.freeze({ 'no-clear-difference': 'no clear difference', 'buddy-better': 'buddy route better',
  'current-better': "today's route better", 'insufficient-seeds': 'too few seeds' });
const GROUP_PREFIX = 'accessGroupCoverage:';

const labelOf = (measure) => measure.startsWith(GROUP_PREFIX) ? [`Coverage, access group ${measure.slice(GROUP_PREFIX.length)}`, 'share'] : LABELS[measure] ?? [measure, 'number'];
const figure = (number, kind, signed = false) => {
  if (typeof number !== 'number' || !Number.isFinite(number)) return 'n/a';
  const text = kind === 'share' ? `${Number((number * 100).toFixed(1))}%` : String(Number(number.toPrecision(4)));
  return signed && number > 0 ? `+${text}` : text;
};
const spread = (entry, kind, signed) => entry?.mean == null ? 'n/a'
  : `${figure(entry.mean, kind, signed)} (${figure(entry.min, kind)} to ${figure(entry.max, kind)})`;

const renderTable = (head, rows) => {
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
  return [line(head), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)];
};

/** The measures table as plain text lines, one row per entry of result.differences. */
export function formatMeasuresTable(result) {
  const head = ['Measure', "Today's release route", 'Buddy route', 'Difference (buddy minus today)', 'Verdict'];
  return renderTable(head, result.differences.map((entry) => {
    const [label, kind] = labelOf(entry.measure);
    return [label, spread(entry.current, kind), spread(entry.buddy, kind), spread(entry.difference, kind, true), VERDICTS[entry.verdict] ?? entry.verdict];
  }));
}

const ARM_VERDICTS = Object.freeze({ 'no-clear-difference': 'no clear difference', 'variant-better': 'tried value better',
  'baseline-better': "today's value better", 'insufficient-seeds': 'too few seeds' });
const ROUTE_LABELS = Object.freeze({ current: "today's release route", buddy: 'buddy route' });

/** One effect's table for one route as plain text lines: baseline against the tried arm, one row per entry. */
export function formatArmTable(entries) {
  const head = ['Measure', "Today's value", 'Tried value', 'Difference (tried minus today)', 'Verdict'];
  return renderTable(head, entries.map((entry) => {
    const [label, kind] = labelOf(entry.measure);
    return [label, spread(entry.baseline, kind), spread(entry.variant, kind), spread(entry.difference, kind, true), ARM_VERDICTS[entry.verdict] ?? entry.verdict];
  }));
}

// A number reads with its unit; anything else (the model line mix) reads as compact JSON.
const valueText = (value, unit) => (typeof value === 'number' ? `${value} ${unit}` : JSON.stringify(value));
const triedText = (value, unit) => (typeof value === 'number' ? valueText(value, unit) : 'the tried mix');
const todayText = (value, unit) => (typeof value === 'number' ? valueText(value, unit) : 'the mix used today');

function printResult(stdout, result, { resultId, codeRevision }) {
  const out = (text = '') => stdout(`${text}\n`);
  const whatIf = result.kind === 'experiment-comparison';
  const { change } = result.manifest;
  out(whatIf ? `What-if comparison: ${result.experimentId}` : 'Process comparison: today\'s release route against the buddy route');
  out(`Experiment: ${result.experimentId}`);
  out(`Seeds: ${result.manifest.seeds.join(', ')}`);
  out(`Policy version: ${result.manifest.policyVersion}`);
  out(`Completed at: ${result.completedAt}`);
  out(`Result id: ${resultId}`);
  out(`Code revision: ${codeRevision}`);
  if (whatIf) {
    out(`Change: ${change.key} (${change.unit})`);
    out(`Used today: ${valueText(change.baselineValue, change.unit)}`);
    out(`Tried: ${change.values ? change.values.map((value) => valueText(value, change.unit)).join(', ') : valueText(change.value, change.unit)}`);
    out(`Basis: ${change.basis}`);
    for (const effect of result.effects) {
      for (const route of ['current', 'buddy']) {
        out();
        out(`${triedText(effect.value, change.unit)} against ${todayText(change.baselineValue, change.unit)}: ${ROUTE_LABELS[route]}`);
        for (const line of formatArmTable(effect.routes[route])) out(line);
      }
    }
  } else {
    out();
    for (const line of formatMeasuresTable(result)) out(line);
  }
  out();
  out(result.caveat);
  for (const limitation of result.limitations) if (limitation !== result.caveat) out(`Limitation: ${limitation}`);
}

const sink = (stream) => (text) => { stream.write(text); };

/** The replay's policy: the reviewed seed, held in memory. The CLI and the worker both read policy this way. */
export const createReplayPolicy = () => new PolicyService({ provider: new MemoryPolicyProvider() });

// The configured repository only stores the result; the replay's policy is always in memory (FUCQ-241),
// so a PostgreSQL run makes no policy queries and matches a memory-mode run exactly.
async function openBackend({ env, repository, policy }) {
  if (repository && policy) return { status: 'ok', repository, policy, close: async () => {} };
  const mode = env.GCSP_REPOSITORY_MODE || 'memory';
  if (!['memory', 'postgres'].includes(mode)) return { status: 'invalid', reason: `Unsupported GCSP_REPOSITORY_MODE "${mode}". Use memory or postgres.` };
  const options = { connectionString: env.GCSP_DATABASE_URL };
  if (mode === 'postgres' && !options.connectionString) return { status: 'invalid', reason: 'GCSP_REPOSITORY_MODE is postgres but GCSP_DATABASE_URL is not set.' };
  const ownedRepository = repository ?? (mode === 'memory' ? createMemoryRepository({ store: createMemoryStore() }) : createPostgresRepository(options));
  const ownedPolicy = policy ?? createReplayPolicy();
  const close = async () => {
    // Close failures are not worth a second error and may carry configuration.
    if (!repository) await Promise.resolve(ownedRepository.close()).catch(() => {});
    if (!policy) await Promise.resolve(ownedPolicy.close()).catch(() => {});
  };
  if (!repository) {
    let opened;
    try { opened = await ownedRepository.open(); } catch { opened = null; }
    if (opened?.status !== 'ok') { await close(); return { status: 'failed', reason: `Could not open the ${mode} repository. Check the repository settings and that it is reachable.` }; }
  }
  return { status: 'ok', mode, repository: ownedRepository, policy: ownedPolicy, close };
}

const seedsReason = 'The seeds are not valid. Give at least one seed, each different and not empty.';
export const describeFailure = (error) => {
  if (error instanceof ComparisonRunError) {
    return error.code === 'invalid-input' && error.boundary === 'seeds' ? { exitCode: 2, reason: seedsReason }
      : { exitCode: error.code === 'invalid-input' ? 2 : 1, reason: error.message };
  }
  if (error instanceof ComparisonInputError) {
    return error.code === 'invalid-seed' ? { exitCode: 2, reason: seedsReason } : { exitCode: 1, reason: error.message };
  }
  // Driver errors can carry connection details, so only a fixed reason is printed.
  return { exitCode: 1, reason: 'The comparison could not be completed.' };
};

/** Runs one command-line invocation. Returns { exitCode, stored?, result? }; never throws for expected failures. */
export async function runComparisonCli({ argv = [], env = process.env, stdout = sink(process.stdout), stderr = sink(process.stderr),
  now = () => new Date().toISOString(), codeRevision, overlay, repository, policy } = {}) {
  const say = (text) => stdout(`${text}\n`);
  const fail = (exitCode, reason) => { stderr(`${reason}\n`); return { exitCode }; };
  const refuse = (reasons) => fail(2, [...reasons.map(({ field, key, reason }) => `${field}${key ? ` (${key})` : ''}: ${reason}`), 'Nothing was stored.'].join('\n'));
  const parsed = parseComparisonArgs(argv);
  if (parsed.status !== 'ok') return fail(2, parsed.reason);
  const args = parsed.value;
  if (args.help) { say(USAGE); return { exitCode: 0 }; }

  // The same shape check the browser request gets; --seeds is CLI-only and joins after it.
  let request;
  if (args.import === undefined) {
    const body = { experimentId: EXPERIMENTS[args.experiment], ...('change' in args && { change: args.change }) };
    const checked = parseExperimentRequest(body);
    if (checked.status !== 'ok') return refuse(checked.reasons);
    request = checked.value;
  }
  let file;
  if (args.import !== undefined) {
    file = await readComparisonResultFile(args.import);
    if (file.status !== 'ok') return fail(2, file.reason);
  }
  const backend = await openBackend({ env, repository, policy });
  if (backend.status !== 'ok') return fail(backend.status === 'invalid' ? 2 : 1, backend.reason);
  const revision = codeRevision ?? defaultCodeRevision(env);
  const memoryNote = () => { if (backend.mode !== 'memory') return;
    say(file ? 'Memory mode keeps nothing after this command. To load this file into a memory-mode server, set GCSP_COMPARISON_RESULT_FILE to it.'
      : 'The result is stored in memory only and is lost when this command ends. Pass --out <file> to keep it, then point the server at it with GCSP_COMPARISON_RESULT_FILE.');
  };
  try {
    let result = file?.value;
    if (!result) {
      const experiment = { ...request, ...(args.seeds && { seeds: args.seeds }), ...(overlay && { overlay }) };
      const onRecord = (record, { armId }) => stderr(`Seed ${record.seed}${request.change ? `, ${armId}` : ''}: ${record.route === 'current' ? "today's release route" : 'buddy route'} replayed.\n`);
      try { result = await runComparison(experiment, { policy: backend.policy, codeRevision: revision, now, onRecord }); }
      catch (error) {
        const { exitCode, reason } = describeFailure(error);
        // The seeds are the CLI's own option, so they keep their own reason; any other refused key reads as the browser's does.
        const boundary = reason === seedsReason ? null : refusedBoundary(error);
        return boundary && request.change ? refuse(refusalFor(boundary, request.experimentId, request.change).reasons) : fail(exitCode, `${reason} Nothing was stored.`);
      }
      if (args.out) {
        try { await writeComparisonResultFile(args.out, result); }
        catch { return fail(1, `The result could not be written to ${args.out}. Nothing was stored.`); }
      }
    }
    let saved;
    try { saved = await storeComparisonResult(backend.repository, COMPARISON_CLI_CONTEXT, result); }
    catch { saved = { status: 'unavailable' }; }
    if (saved.status !== 'ok') {
      const kept = args.out ? ` The result was saved to ${args.out}; store it later with --import ${args.out}.` : '';
      return fail(1, `The result could not be stored (${saved.status}).${kept}`);
    }
    printResult(stdout, result, { resultId: saved.value.resultId, codeRevision: result.manifest.codeRevision ?? revision });
    if (args.out) say(`Saved to ${args.out}.`);
    memoryNote();
    return { exitCode: 0, stored: saved.value, result };
  } finally { await backend.close(); }
}
