// Proposed exact graph loader. Never imports an undeclared application module.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestPath = "/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/controller-94e05ff-source.json";
const bytes = readFileSync(manifestPath);
if (sha(bytes) !== "bf9b0638f69c923efc16c8fa4a62ebc77698d4ed159523f26e971bc28ef42a68") throw Error('Reviewed source manifest changed');
const source = JSON.parse(bytes);
const declared = new Map(source.rows.map((row) => [row.url, row]));
const entry = source.rows.find((row) => row.path === source.tests[0]).url;
const paths = new Map(source.rows.map((row) => [row.path, row.url]));
const edges = new Map(source.edges.map((edge) => [paths.get(edge.from) + '\0' + edge.specifier,
  edge.to.startsWith('node:') ? edge.to : paths.get(edge.to)]));
export async function resolve(specifier, context, next) {
  const parent = context.parentURL;
  if (declared.has(parent)) {
    const expected = edges.get(parent + '\0' + specifier);
    if (!expected) throw Error('Undeclared application import');
    const resolved = await next(specifier, context);
    if (resolved.url !== expected) throw Error('Application resolution differs');
    appendFileSync(process.env.FUCQ107_MODULE_JOURNAL, JSON.stringify({ kind: 'application-resolution', parentURL: parent, specifier, url: resolved.url }) + '\n');
    return resolved;
  }
  if (specifier.startsWith('node:')) return next(specifier, context);
  const resolved = await next(specifier, context);
  if (resolved.url !== entry && resolved.url !== import.meta.url) throw Error('Undeclared executable entry');
  return resolved;
}
export async function load(url, context, next) {
  if (url.startsWith('node:') || url === import.meta.url) return next(url, context);
  const row = declared.get(url);
  const bytes = row && readFileSync(new URL(url));
  if (!row || row.kind !== 'module' || sha(bytes) !== row.sha256) throw Error('Unlisted or changed executable load');
  appendFileSync(process.env.FUCQ107_MODULE_JOURNAL, JSON.stringify({ kind: 'application-load', url, sha256: row.sha256 }) + '\n');
  return { format: 'module', source: bytes, shortCircuit: true };
}
