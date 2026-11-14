import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function files(path) { return (await Promise.all((await readdir(path, { withFileTypes: true })).map((item) => item.isDirectory() ? files(join(path, item.name)) : join(path, item.name)))).flat(); }
for (const path of await files(join(root, 'src'))) {
  if (path.endsWith('.spec.ts')) continue;
  const source = await readFile(path, 'utf8');
  assert(!/\beval\s*\(|new\s+Function\s*\(|\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(source), `${path}: dynamic execution`);
  assert(!/\son[a-z]+\s*=/i.test(source), `${path}: inline event attribute`);
  assert(!/<script\b[^>]*>\s*\S/i.test(source), `${path}: inline script`);
  assert(!/\binnerHTML\b|bypassSecurityTrust|\blegacy\b.*import/i.test(source), `${path}: unsafe rendering`);
  assert(!/from\s*['"][^'"]*(?:blocks|server)\//.test(source), `${path}: controller/business import`);
  assert(!/[—]/.test(source), `${path}: on-screen em dash`);
  if (path.endsWith('.css')) assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(source), `${path}: use shared semantic colours`);
}
const config = JSON.parse(await readFile(join(root, 'angular.json'), 'utf8'));
const production = config.projects['gcsp-web'].architect.build.configurations.production;
assert.equal(production.aot, true); assert.equal(production.optimization.styles.inlineCritical, false);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert(/^\d+\.\d+\.\d+$/.test(version), `Pin ${name} exactly`);
console.log('PASS app CSP, component token, controller boundary and pinned AOT configuration checks');
let built;
try { built = await readFile(join(root, 'dist/gcsp-web/browser/index.html'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (built) {
  assert(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(built), 'production: inline script');
  assert(!/<style\b|\sstyle\s*=|\son[a-z]+\s*=/i.test(built), 'production: inline CSS/event attribute');
  assert(/<base href="\/gcsp\/">/.test(built), 'production: GCSP base path');
  console.log('PASS production HTML external bootstrap/style and base-path checks');
}
assert.equal(await readFile(join(root, 'src/assets/brand-logos/bmwgroup-bmw-mini.svg'), 'utf8'), await readFile(join(root, '../../assets/brand-logos/bmwgroup-bmw-mini.svg'), 'utf8'), 'Retain the approved Density brand artwork');
