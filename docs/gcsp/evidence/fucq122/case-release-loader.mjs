// Proposal only: the parent admits this file and the exact source plan first.
import { readFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = readFileSync(process.env.FUCQ122_C4_PLAN);
if (hash(bytes) !== process.env.FUCQ122_C4_PLAN_SHA) throw Error('C4 source plan differs');
const plan = JSON.parse(bytes);
if (plan.status !== 'frozen-for-review' || plan.pending.length) throw Error('C4 source closure is incomplete');
const mirror = process.env.FUCQ122_C4_MIRROR;
const url = (path) => pathToFileURL(`${mirror}/${path}`).href;
const declared = new Map(plan.rows.map((row) => [url(row.path), row]));
const installed = new Map(Object.entries(plan.installed.files).map(([path, row]) => [pathToFileURL(row.realpath).href, row]));
const edges = new Map(plan.edges.filter((edge) => edge.kind === 'module').map((edge) => [url(edge.from) + '\0' + edge.specifier,
  edge.to.startsWith('node:') ? edge.to : edge.installed ? pathToFileURL(edge.to).href : url(edge.to)]));
const own = import.meta.url; const ownPath = fileURLToPath(own);
const ownParent = pathToFileURL(plan.root + '/').href;
const entry = url(plan.test); const journal = process.env.FUCQ122_C4_JOURNAL;
function record(row) {
  const text = JSON.stringify(row) + '\n';
  if (statSync(journal).size + Buffer.byteLength(text) > 512 * 1024) throw Error('C4 module journal limit');
  appendFileSync(journal, text);
}
export async function resolve(specifier, context, next) {
  const parent = context.parentURL;
  if (specifier === own || specifier === ownPath) {
    if (parent !== ownParent || hash(readFileSync(ownPath)) !== process.env.FUCQ122_C4_LOADER_SHA) throw Error('C4 loader registration differs');
    record({ kind: 'loader-registration', specifier, parentURL: parent, url: own });
    return { url: own, shortCircuit: true };
  }
  if (declared.has(parent)) {
    const expected = edges.get(parent + '\0' + specifier);
    if (!expected) throw Error('Undeclared C4 application edge');
    record({ kind: 'application-resolution', parentURL: parent, specifier, url: expected });
    return expected.startsWith('node:') ? next(expected, context) : { url: expected, shortCircuit: true };
  }
  if (parent === own && specifier.startsWith('node:')) return next(specifier, context);
  if (installed.has(parent)) {
    const resolved = await next(specifier, context);
    if (!resolved.url.startsWith('node:') && !installed.has(resolved.url)) throw Error('Undeclared C4 installed import');
    record({ kind: 'installed-resolution', parentURL: parent, specifier, url: resolved.url });
    return resolved;
  }
  const resolved = await next(specifier, context);
  if (resolved.url !== entry || parent !== undefined) throw Error('Undeclared C4 executable entry');
  return resolved;
}
export async function load(target, context, next) {
  if (target.startsWith('node:') || target === own) return next(target, context);
  const row = declared.get(target) ?? installed.get(target);
  if (!row) throw Error('Undeclared C4 executable');
  const data = readFileSync(new URL(target));
  if (hash(data) !== row.sha256 || data.length !== row.bytes) throw Error('C4 executable drift');
  record({ kind: declared.has(target) ? 'application-load' : 'installed-load', url: target, sha256: row.sha256 });
  if (declared.has(target)) {
    if (row.kind !== 'module') throw Error('C4 data cannot become executable');
    return { format: 'module', source: data, shortCircuit: true };
  }
  return next(target, context);
}
