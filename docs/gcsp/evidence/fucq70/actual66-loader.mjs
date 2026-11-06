// Exact reviewed module resolver; no source transformation or resolution fallback.
import { readFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const configPath = process.env.FUCQ70_PROOF_CONFIG;
if (!configPath) throw new Error('Missing reviewed FUCQ70 proof configuration');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.kind !== 'fucq70-actual66-exact-loader-v1') throw new Error('Unknown proof configuration');
const byPath = new Map(config.modules.map((r) => [r.path, r]));
const byUrl = new Map();
for (const row of config.modules) { byUrl.set(row.url, row); byUrl.set(row.originalUrl, row); }
const probe = config.probe; byUrl.set(probe.url, probe);
const dependencies = new Map(config.dependencies.map((r) => [pathToFileURL(r.path).href, r]));
const pgParents = new Set(config.pgImporters);
const journalCap = 256 * 1024;
function journal(value) {
  const line = JSON.stringify({ pid: process.pid, ...value }) + '\n';
  let size = 0;
  try { size = statSync(config.journal).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (size + Buffer.byteLength(line) > journalCap) throw new Error('Import journal exceeded selected bound');
  appendFileSync(config.journal, line, { mode: 0o600 });
}
function hash(url, expected) {
  const digest = createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex');
  if (digest !== expected) throw new Error(`Admitted source changed: ${byUrl.get(url)?.path ?? 'dependency'}`);
}
function fromSpecifier(specifier, parent) {
  const base = parent ? parent.originalUrl ?? parent.url : undefined;
  const url = specifier.startsWith('/') ? pathToFileURL(specifier) : new URL(specifier, base);
  if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('Unplanned module URL');
  return byUrl.get(url.href);
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:')) {
    journal({ stage: 'resolve', parent: byUrl.get(context.parentURL)?.path ?? 'node-harness', specifier, target: specifier });
    return nextResolve(specifier, context);
  }
  const parent = byUrl.get(context.parentURL);
  if (dependencies.has(context.parentURL)) {
    const resolved = await nextResolve(specifier, context);
    if (!resolved.url.startsWith('node:') && !dependencies.has(resolved.url)) throw new Error('Unlisted installed-package dependency');
    journal({ stage: 'resolve', parent: context.parentURL, specifier, target: resolved.url });
    return resolved;
  }
  if (specifier === 'pg') {
    if (!parent || !pgParents.has(parent.path)) throw new Error('Unadmitted pg importer');
    journal({ stage: 'resolve', parent: parent.path, specifier, target: config.pgEntry });
    return { url: pathToFileURL(config.pgEntry).href, shortCircuit: true };
  }
  if (!(specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:'))) throw new Error('Unlisted bare import');
  const target = fromSpecifier(specifier, parent);
  if (!target || parent && !parent.imports.includes(target.path)
    || !parent && target.url !== probe.url) throw new Error('Unplanned relative or entry module');
  journal({ stage: 'resolve', parent: parent?.path ?? 'entry', specifier, target: target.path });
  return { url: target.url, shortCircuit: true };
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  const row = byUrl.get(url) ?? dependencies.get(url);
  if (!row) throw new Error('Unlisted executable load');
  hash(url, row.sha256);
  journal({ stage: 'load', path: row.path, sha256: row.sha256 });
  return nextLoad(url, context);
}
