// Exact six-module immutable overlay; all producer dependencies are declared.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const plan = JSON.parse(readFileSync(process.env.GCSP_PRODUCER_MODULE_MAP, 'utf8'));
const declared = new Map(plan.modules.map((row) => [row.canonical, row]));
const actual = new Map(plan.modules.map((row) => [row.url, row]));
const canonical = (url) => actual.get(url)?.canonical ?? url;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('node:')) return next(specifier, context);
  if (specifier === 'pg') return { url: plan.pg, shortCircuit: true };
  const parent = context.parentURL && canonical(context.parentURL);
  let candidate;
  try { candidate = new URL(specifier, parent).href; } catch { /* Bare baseline dependency. */ }
  candidate = canonical(candidate);
  const row = declared.get(candidate);
  if (row) return { url: row.url, shortCircuit: true };
  if (declared.has(parent) || candidate?.startsWith(plan.overlayRoot)) {
    throw Error('Undeclared producer module mapping');
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  const row = actual.get(url);
  if (row) {
    const digest = createHash('sha256').update(readFileSync(new URL(url))).digest('hex');
    if (digest !== row.sha256) throw Error('Producer module identity changed');
    appendFileSync(plan.journal, JSON.stringify({ pid: process.pid, path: row.path,
      sha256: digest, overlay: row.overlay }) + '\n');
  } else if (url.startsWith(plan.overlayRoot) || declared.has(url)) {
    throw Error('Producer module bypassed its declared mapping');
  }
  return next(url, context);
}
