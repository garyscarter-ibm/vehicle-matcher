import { readFileSync, appendFileSync, statSync, realpathSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = (data) => createHash('sha256').update(data).digest('hex');
const bytes = readFileSync(process.env.FUCQ100_COMPOSITION_CONFIG);
if (digest(bytes) !== process.env.FUCQ100_COMPOSITION_CONFIG_SHA256) throw Error('Loader configuration drift.');
const config = JSON.parse(bytes);
const own = import.meta.url;
const ownPath = fileURLToPath(own);
const ownSpecifiers = new Set([own, ownPath]);
function record(url) {
  const path = fileURLToPath(url); const row = config.files[path];
  const stat = statSync(path);
  if (!row || realpathSync(path) !== row.realpath || stat.dev !== row.device || stat.ino !== row.inode
    || digest(readFileSync(path)) !== row.sha256) throw Error(`Unadmitted or changed ESM module: ${path}`);
  const line = JSON.stringify({ path, sha256: row.sha256 }) + '\n';
  if ((existsSync(config.esmJournal) ? statSync(config.esmJournal).size : 0) + Buffer.byteLength(line) > 524288) throw Error('ESM journal bound.');
  appendFileSync(config.esmJournal, line);
}
export async function resolve(specifier, context, next) {
  const resolved = Object.hasOwn(config.entries, specifier)
    ? { url: pathToFileURL(config.entries[specifier]).href, shortCircuit: true } : await next(specifier, context);
  if (resolved.url === own && (!ownSpecifiers.has(specifier) || context.parentURL !== config.parentURL)) {
    throw Error('Invalid loader registration coordinate.');
  }
  if (resolved.url.startsWith('file:')) record(resolved.url);
  else if (!resolved.url.startsWith('node:')) throw Error('Unadmitted module protocol.');
  return resolved;
}
export async function load(url, context, next) {
  if (url.startsWith('file:')) record(url);
  else if (!url.startsWith('node:')) throw Error('Unadmitted load protocol.');
  return next(url, context);
}
