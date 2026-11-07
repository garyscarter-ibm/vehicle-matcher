// Journal and verify CJS loads inside JSDOM and pg, including cached modules.
const fs = require('node:fs');
const crypto = require('node:crypto');
const Module = require('node:module');
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const bytes = fs.readFileSync(process.env.FUCQ100_COMPOSITION_CONFIG);
if (digest(bytes) !== process.env.FUCQ100_COMPOSITION_CONFIG_SHA256) throw Error('CJS configuration drift.');
const config = JSON.parse(bytes);
const builtins = new Set(Module.builtinModules.flatMap((name) => [name, `node:${name}`]));
const recorded = new Set();
function record(path) {
  const row = config.files[path]; const stat = fs.statSync(path);
  if (!row || fs.realpathSync(path) !== row.realpath || stat.dev !== row.device || stat.ino !== row.inode
    || digest(fs.readFileSync(path)) !== row.sha256) throw Error(`Unadmitted or changed CJS module: ${path}`);
  if (recorded.has(path)) return;
  recorded.add(path);
  const line = JSON.stringify({ path, sha256: row.sha256 }) + '\n';
  if ((fs.existsSync(config.cjsJournal) ? fs.statSync(config.cjsJournal).size : 0) + Buffer.byteLength(line) > 524288) throw Error('CJS journal bound.');
  fs.appendFileSync(config.cjsJournal, line);
}
record(__filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (builtins.has(request)) return resolve.call(this, request, parent, ...rest);
  const path = resolve.call(this, Object.hasOwn(config.entries, request) ? config.entries[request] : request, parent, ...rest);
  if (typeof path !== 'string' || !path.startsWith('/') || path.endsWith('.node')) throw Error('Unadmitted CJS resolution.');
  record(path); return path;
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (!builtins.has(request)) Module._resolveFilename(request, parent);
  return load.call(this, Object.hasOwn(config.entries, request) ? config.entries[request] : request, parent, ...rest);
};
for (const extension of ['.js', '.json', '.cjs']) {
  const handler = Module._extensions[extension];
  if (handler) Module._extensions[extension] = function (module, path) { record(path); return handler(module, path); };
}
