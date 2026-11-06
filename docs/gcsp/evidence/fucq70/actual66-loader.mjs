// Exact reviewed module resolver; no source transformation or resolution fallback.
import { readFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const configPath = process.env.FUCQ70_PROOF_CONFIG;
if (!configPath) throw new Error('Missing reviewed FUCQ70 proof configuration');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.kind !== 'fucq70-actual66-exact-loader-v2') throw new Error('Unknown proof configuration');
const registration = config.loaderRegistration;
if (registration?.url !== import.meta.url || !/^[a-f0-9]{64}$/.test(registration.sha256)) {
  throw new Error('Unpinned loader registration identity');
}
const registrationSpecifiers = new Set([registration.url, fileURLToPath(registration.url)]);
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
function diagnosticIdentity(value) {
  if (value === undefined) return { kind: 'absent' };
  const text = String(value);
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (byUrl.has(text) || text === registration.url || text === registration.parentUrl
    || registrationSpecifiers.has(text)) return { kind: 'pinned', display: text.slice(0, 512), sha256 };
  try {
    const url = new URL(text);
    if (url.protocol === 'file:' && !url.username && !url.password && url.href.startsWith(registration.parentUrl)) {
      url.search = ''; url.hash = '';
      return { kind: 'checkout-file-url', display: url.href.slice(0, 512), sha256 };
    }
  } catch { /* Non-URL values are handled below. */ }
  // Never expose arbitrary URL credentials, query strings or opaque unlisted values.
  if (/^[A-Za-z0-9_@./-]{1,160}$/.test(text) && !text.includes('//') && !/[A-Za-z0-9_-]{32,}/.test(text)) {
    return { kind: 'bounded-module-specifier', display: text, sha256 };
  }
  return { kind: 'unlisted-redacted', bytes: Buffer.byteLength(text), sha256 };
}
function reject(reason, specifier, parentURL) {
  const event = { stage: 'reject', reason, specifier: diagnosticIdentity(specifier), parent: diagnosticIdentity(parentURL) };
  journal(event);
  throw new Error('Strict loader rejected: ' + JSON.stringify(event));
}
function fromSpecifier(specifier, parent) {
  const base = parent ? parent.originalUrl ?? parent.url : undefined;
  const url = specifier.startsWith('/') ? pathToFileURL(specifier) : new URL(specifier, base);
  if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('Unplanned module URL');
  return byUrl.get(url.href);
}
export async function resolve(specifier, context, nextResolve) {
  // Node registers a loader from its cwd URL. This permits only the already-pinned
  // helper itself; it adds no application module or default-resolution fallback.
  if (registrationSpecifiers.has(specifier) && context.parentURL === registration.parentUrl) {
    hash(registration.url, registration.sha256);
    journal({ stage: 'resolve-loader-registration', parent: context.parentURL, specifier, target: registration.url, sha256: registration.sha256 });
    return { url: registration.url, shortCircuit: true };
  }
  if (specifier.startsWith('node:')) {
    journal({ stage: 'resolve', parent: byUrl.get(context.parentURL)?.path ?? 'node-harness', specifier, target: specifier });
    return nextResolve(specifier, context);
  }
  const parent = byUrl.get(context.parentURL);
  if (dependencies.has(context.parentURL)) {
    const resolved = await nextResolve(specifier, context);
    if (!resolved.url.startsWith('node:') && !dependencies.has(resolved.url)) reject('unlisted-installed-dependency', resolved.url, context.parentURL);
    journal({ stage: 'resolve', parent: context.parentURL, specifier, target: resolved.url });
    return resolved;
  }
  if (specifier === 'pg') {
    if (!parent || !pgParents.has(parent.path)) reject('unadmitted-pg-importer', specifier, context.parentURL);
    journal({ stage: 'resolve', parent: parent.path, specifier, target: config.pgEntry });
    return { url: pathToFileURL(config.pgEntry).href, shortCircuit: true };
  }
  if (!(specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:'))) reject('unlisted-bare-import', specifier, context.parentURL);
  let target;
  try { target = fromSpecifier(specifier, parent); } catch { reject('unplanned-module-url', specifier, context.parentURL); }
  if (!target || parent && !parent.imports.includes(target.path)
    || !parent && target.url !== probe.url) reject('unplanned-relative-or-entry-module', specifier, context.parentURL);
  journal({ stage: 'resolve', parent: parent?.path ?? 'entry', specifier, target: target.path });
  return { url: target.url, shortCircuit: true };
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  if (url === registration.url) {
    hash(url, registration.sha256);
    journal({ stage: 'load-loader-registration', url, sha256: registration.sha256 });
    return nextLoad(url, context);
  }
  const row = byUrl.get(url) ?? dependencies.get(url);
  if (!row) reject('unlisted-executable-load', url, undefined);
  hash(url, row.sha256);
  journal({ stage: 'load', path: row.path, sha256: row.sha256 });
  return nextLoad(url, context);
}
