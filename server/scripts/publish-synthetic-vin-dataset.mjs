#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createPolicyService } from '../gcsp/policy/index.js';
import { writeCorpusCandidate, validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry, presentCorpusLoad } from '../gcsp/vehicle-evidence/synthetic-registry.js';

const fail = (message, code = 'invalid-command') => ({ status: 'invalid-input', failure: { code, message } });
async function main(args) {
  const [command, ...flags] = args; const values = {};
  if (!['prepare', 'validate', 'publish', 'load', 'deactivate'].includes(command) || flags.length % 2) return [2, fail('Use prepare|validate|publish|load|deactivate with explicit absolute --artifacts/--store/--input paths, --run-id and ISO --as-of.')];
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i]; if (!['--artifacts', '--store', '--input', '--run-id', '--as-of', '--policy-version'].includes(key) || Object.hasOwn(values, key)) return [2, fail('Unknown or duplicate argument.')];
    values[key] = flags[i + 1];
  }
  const required = command === 'prepare' ? ['--artifacts', '--input'] : command === 'validate' ? ['--artifacts']
    : command === 'publish' ? ['--artifacts', '--store'] : ['--store'];
  if (!required.every((key) => typeof values[key] === 'string' && isAbsolute(values[key])) || !values['--run-id']
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(values['--as-of'] || '') || !Number.isFinite(Date.parse(values['--as-of']))) return [2, fail('Supply all required absolute paths, --run-id and a valid ISO --as-of. No paths or policy context are guessed.')];
  const options = { policyService: createPolicyService(), policyRead: { runId: values['--run-id'], asOf: values['--as-of'],
    ...(values['--policy-version'] ? { policyVersion: values['--policy-version'] } : {}) } };
  let result;
  if (command === 'prepare') result = await writeCorpusCandidate(values['--artifacts'], JSON.parse(await readFile(values['--input'], 'utf8')), options);
  else if (command === 'validate') { const checked = await validateCorpusDirectory(values['--artifacts'], options); result = checked.status === 'ok' ? { status: 'ok', manifest: checked.manifest, manifestDigest: checked.manifestDigest } : checked; }
  else {
    const registry = createSyntheticRegistry({ root: values['--store'], ...options });
    result = await registry[command](...(command === 'publish' ? [values['--artifacts']] : []));
    result.presentation = presentCorpusLoad(result);
  }
  return [result.status === 'ok' ? 0 : 1, result];
}
try {
  const [code, result] = await main(process.argv.slice(2)); process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = code;
} catch {
  process.stdout.write(JSON.stringify(fail('The command could not read or parse its explicit local input. No live provider is available.', 'input-unavailable')) + '\n'); process.exitCode = 1;
}
