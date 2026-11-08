import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let map; let canonical; let actual;
const sha = (data) => createHash('sha256').update(data).digest('hex');
export function initialize(input) {
  const data = readFileSync(input.path);
  if (sha(data) !== input.sha256) throw Error('Frozen module map differs.');
  map = JSON.parse(data); canonical = new Map(map.modules.map((row) => [row.canonical, row]));
  actual = new Map(map.modules.map((row) => [row.url, row]));
  if (canonical.size !== map.modules.length || actual.size !== map.modules.length || !canonical.has(map.entry)) throw Error('Invalid module identities.');
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier === map.entry && !actual.has(context.parentURL)) return { url: canonical.get(specifier).url, shortCircuit: true };
  const parent = actual.get(context.parentURL);
  if (!parent) throw Error('Unplanned module parent.');
  const edge = map.edges.find((row) => row.from === parent.path && row.specifier === specifier);
  if (!edge) throw Error('Unplanned module import.');
  if (specifier.startsWith('node:') && map.builtins.includes(specifier)) return nextResolve(specifier, context);
  if (specifier === 'pg') return { url: map.pgEntry, shortCircuit: true };
  const target = canonical.get(new URL(specifier, parent.canonical).href);
  if (!target || target.path !== edge.to) throw Error('Module edge differs.');
  return { url: target.url, shortCircuit: true };
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('node:') && map.builtins.includes(url)) return nextLoad(url, context);
  if (url === map.pgEntry) return nextLoad(url, { ...context, format: 'commonjs' });
  const row = actual.get(url);
  if (!row) throw Error('Unplanned module load.');
  const source = readFileSync(fileURLToPath(url));
  if (sha(source) !== row.sha256) throw Error('Frozen application source differs.');
  appendFileSync(map.journal, `${JSON.stringify({ path: row.path, sha256: row.sha256 })}\n`);
  return { format: 'module', source, shortCircuit: true };
}
