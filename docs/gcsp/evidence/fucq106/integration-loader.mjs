// Reviewed 39-module composition plus one owned test entry. Canonical URLs are
// the only module identities; immutable scratch files provide bytes at load time.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const plan = JSON.parse(readFileSync(process.env.FUCQ106_MODULE_MAP, 'utf8'));
const declared = new Map(plan.modules.map((row) => [row.canonical, row]));
if (declared.size !== 40) throw Error('Unexpected decision integration module count');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('node:')) return next(specifier, context);
  if (specifier === 'pg') return { url: plan.pg.url, shortCircuit: true };
  let candidate;
  try { candidate = specifier.startsWith('/') ? pathToFileURL(specifier).href : new URL(specifier, context.parentURL).href; }
  catch { /* Existing pg package dependencies are resolved by Node. */ }
  if (candidate === import.meta.url) return next(specifier, context);
  if (declared.has(candidate)) return { url: candidate, shortCircuit: true };
  if (declared.has(context.parentURL) || candidate?.startsWith(plan.sourceRoot)
    || candidate?.startsWith(plan.scratchRoot)) throw Error(`Undeclared integration module mapping: ${candidate}`);
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === import.meta.url) {
    if (sha256(readFileSync(new URL(url))) !== plan.loaderSHA256) throw Error('Integration loader identity changed');
    return next(url, context);
  }
  const row = declared.get(url);
  if (row) {
    const source = readFileSync(new URL(row.bytesURL)); const digest = sha256(source);
    if (digest !== row.sha256) throw Error('Integration module identity changed');
    appendFileSync(plan.journal, JSON.stringify({ pid: process.pid, path: row.path,
      canonical: url, sha256: digest, source: row.source, overlay: row.overlay }) + '\n');
    return { format: 'module', source: source.toString('utf8'), shortCircuit: true };
  }
  if (url === plan.pg.url && sha256(readFileSync(new URL(url))) !== plan.pg.sha256) {
    throw Error('Read-only pg identity changed');
  }
  if (url.startsWith(plan.sourceRoot) || url.startsWith(plan.scratchRoot)) {
    throw Error('Integration module bypassed canonical mapping');
  }
  return next(url, context);
}
