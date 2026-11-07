// Author-only proposal. Synchronous hooks cover ESM and CommonJS loads.
import { readFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isBuiltin, registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const base = '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer-94e05ff-';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = (name, expected) => {
  const bytes = readFileSync(base + name);
  if (sha(bytes) !== expected) throw Error('Reviewed manifest changed: ' + name);
  return JSON.parse(bytes);
};
const source = manifest('source.json', 'fb9cb018534ca934ebb74582a440f0fab3d2ab4b6ccfa05880d9f1f5f103cda8');
const dependencies = manifest('dependencies.json', '59838f3f60cc54ffffd4150aad7d9fbfdeef0bfc3408de3e7b1c76929a852597');
const declared = new Map(source.rows.map((row) => [row.url, row]));
const paths = new Map(source.rows.map((row) => [row.path, row.url]));
const dependencyFiles = new Map(dependencies.files.map((row) => [pathToFileURL(row.path).href, row]));
const edges = new Map(source.edges.map((edge) => [paths.get(edge.from) + '\0' + edge.specifier,
  edge.to.startsWith('node:') || edge.to.startsWith('file:') ? edge.to : paths.get(edge.to)]));
const roots = dependencies.packages.map((row) => row.path).sort((a, b) => b.length - a.length);
const packageOf = (url) => {
  const path = fileURLToPath(url);
  return roots.find((root) => path.startsWith(root + '/'));
};
const packageName = (specifier) => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/')
  : specifier.split('/')[0];
const entry = paths.get(source.tests[0]);
const journal = process.env.FUCQ107_MODULE_JOURNAL;
if (!journal || !journal.startsWith(base.slice(0, base.lastIndexOf('/') + 1) + 'renderer9-')
  || !journal.endsWith('/modules.jsonl')) throw Error('Owned renderer journal required');
const record = (row) => {
  const line = JSON.stringify(row) + '\n';
  if (statSync(journal).size + Buffer.byteLength(line) > 2 * 1024 ** 2) throw Error('Module journal cap reached');
  appendFileSync(journal, line);
};
const refused = (why, parentURL, specifier) => {
  record({ kind: 'refused-resolution', why, parentURL, specifier });
  throw Error('Reviewed renderer graph refused: ' + why);
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (declared.has(parent)) {
      const expected = edges.get(parent + '\0' + specifier);
      if (!expected) return refused('undeclared application import', parent, specifier);
      const resolved = nextResolve(specifier === 'jsdom' ? pathToFileURL(dependencies.entry).href : specifier, context);
      if (resolved.url !== expected) return refused('application resolution differs', parent, specifier);
      record({ kind: 'application-resolution', parentURL: parent, specifier, url: resolved.url });
      return resolved;
    }
    if (dependencyFiles.has(parent)) {
      const owner = packageOf(parent);
      const builtin = isBuiltin(specifier);
      const relative = specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
      const self = !builtin && !relative && dependencies.packages.some((row) =>
        row.path === owner && row.name === packageName(specifier));
      const edge = !builtin && !relative && dependencies.resolutionEdges.find((row) =>
        row.from === owner && row.name === packageName(specifier));
      if (!builtin && !relative && !self && !edge) return refused('undeclared package requirement', parent, specifier);
      let resolved;
      try { resolved = nextResolve(specifier, context); }
      catch (error) {
        if (edge && !edge.required && !edge.target && ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) {
          record({ kind: 'optional-miss', parentURL: parent, specifier, package: edge.name, code: error.code });
          throw error;
        }
        return refused('unexpected dependency resolution failure', parent, specifier);
      }
      if (builtin ? !isBuiltin(resolved.url) : !dependencyFiles.has(resolved.url)) {
        return refused('dependency outside pinned inventory', parent, specifier);
      }
      if (!builtin && packageOf(resolved.url) !== (relative || self ? owner : edge.target)) {
        return refused('dependency package target differs', parent, specifier);
      }
      record({ kind: 'dependency-resolution', parentURL: parent, specifier, url: resolved.url });
      return resolved;
    }
    if (isBuiltin(specifier)) return nextResolve(specifier, context);
    const resolved = nextResolve(specifier, context);
    if (resolved.url !== entry && resolved.url !== import.meta.url) {
      return refused('undeclared executable entry', parent, specifier);
    }
    return resolved;
  },
  load(url, context, nextLoad) {
    if (isBuiltin(url) || url === import.meta.url) return nextLoad(url, context);
    const application = declared.get(url);
    const dependency = dependencyFiles.get(url);
    const row = application ?? dependency;
    if (!row || application && application.kind !== 'module' || url.endsWith('.node')) {
      record({ kind: 'refused-load', url }); throw Error('Unlisted executable load');
    }
    const bytes = readFileSync(new URL(url));
    if (bytes.length !== row.bytes || sha(bytes) !== row.sha256) {
      record({ kind: 'refused-load', url }); throw Error('Pinned executable bytes differ');
    }
    // Preserve the Node-selected CommonJS/module/json format and its package
    // semantics, while supplying the exact hash-checked bytes synchronously.
    const loaded = nextLoad(url, context);
    if (!['module', 'commonjs', 'json'].includes(loaded.format)) {
      record({ kind: 'refused-load', url }); throw Error('Unreviewed executable format');
    }
    record({ kind: application ? 'application-load' : 'dependency-load', url,
      sha256: row.sha256, bytes: row.bytes, format: loaded.format });
    return { ...loaded, source: bytes, shortCircuit: true };
  },
});
