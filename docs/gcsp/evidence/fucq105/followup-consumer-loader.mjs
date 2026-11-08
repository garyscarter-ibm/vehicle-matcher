// Finite105 follow-up consumer proposal. Exact canonical identities and bytes come from the reviewed plan.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const plan = JSON.parse(readFileSync(process.env.GCSP_FUCQ105_FOLLOWUP_MAP, 'utf8'));
const declared = new Map(plan.modules.map((row) => [row.canonical, row]));
const actual = new Map(plan.modules.map((row) => [row.url, row]));
const canonical = (url) => actual.get(url)?.canonical ?? url;
const hash = (url) => createHash('sha256').update(readFileSync(new URL(url))).digest('hex');

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('node:')) return next(specifier, context);
  const parent = context.parentURL && canonical(context.parentURL);
  if (specifier === 'pg' || specifier === 'jsdom') {
    if (!declared.has(parent) && parent !== plan.test.url) throw Error('Unplanned retained dependency caller');
    return { url: plan.dependencies[specifier].url, shortCircuit: true };
  }
  let candidate;
  try {
    candidate = canonical(specifier.startsWith('/') ? pathToFileURL(specifier).href : new URL(specifier, parent).href);
  } catch { /* Third-party bare dependency. */ }
  if (candidate === import.meta.url) {
    if (candidate !== plan.loader.url) throw Error('Unplanned loader registration');
    return next(specifier, context);
  }
  const row = declared.get(candidate);
  if (row) return { url: row.url, shortCircuit: true };
  if (candidate === plan.test.url) return { url: candidate, shortCircuit: true };
  if (declared.has(parent) || parent === plan.test.url || candidate?.startsWith(plan.overlayRoot)
    || candidate?.startsWith(plan.projectRoot)) throw Error('Undeclared project module');
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('node:')) return next(url, context);
  if (url === import.meta.url) {
    if (url !== plan.loader.url || hash(url) !== plan.loader.sha256) throw Error('Approved loader identity changed');
    return next(url, context);
  }
  const row = actual.get(url);
  const entry = row || (url === plan.test.url ? plan.test : null);
  if (entry) {
    if (hash(url) !== entry.sha256) throw Error('Approved source identity changed');
    appendFileSync(plan.journal, JSON.stringify({ pid: process.pid, path: entry.path,
      canonical: entry.canonical || entry.url, url, sha256: entry.sha256, overlay: entry.overlay === true }) + '\n');
  } else if (url.startsWith(plan.overlayRoot) || declared.has(url) || url.startsWith(plan.projectRoot)) {
    throw Error('Project module bypassed declared mapping');
  }
  for (const dependency of Object.values(plan.dependencies)) {
    if (url === dependency.url && hash(url) !== dependency.sha256) throw Error('Retained dependency identity changed');
  }
  return next(url, context);
}
