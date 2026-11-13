#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { references } from './assemble-site.mjs';
import { validateRuntimeConfig, runtimeConfigFromEnv, contentSecurityPolicy } from './gcsp-runtime-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashed = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u;
const publicFile = /\.(?:html|js|css|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|json)$/u;
export const GCSP_FIXED_ROUTES = Object.freeze(['/gcsp/', '/gcsp/sign-in', '/gcsp/auth/callback', '/gcsp/account', '/gcsp/preferences',
  '/gcsp/stock', '/gcsp/manual/review', '/gcsp/manual/summary', '/gcsp/activity', '/gcsp/orders', '/gcsp/help', '/gcsp/greg',
  '/gcsp/greg/cases', '/gcsp/presenter', '/gcsp/presenter/outbox', '/gcsp/components', '/gcsp/access-denied', '/gcsp/unavailable']);

async function compiledFiles(root, relative = '') {
  const files = [];
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Compiled browser input must not contain symlinks: ${file}`);
    if (entry.isDirectory()) files.push(...await compiledFiles(root, file));
    else if (!entry.isFile() || !publicFile.test(file) || file.split('/').some((part) => part.startsWith('.'))) {
      throw new Error(`Unsupported compiled browser file: ${file}`);
    } else files.push(file);
  }
  return files;
}

async function compilerRecord(appRoot, tools) {
  const inputs = [];
  const values = {};
  for (const file of ['package.json', 'package-lock.json', 'angular.json']) {
    const bytes = await readFile(path.join(appRoot, file));
    inputs.push({ path: file, sha256: sha256(bytes) });
    values[file] = JSON.parse(bytes);
  }
  if (!tools || !['node', 'npm'].every((key) => typeof tools[key] === 'string' && tools[key].trim())) {
    throw new Error('Explicit compiler toolchain versions (node and npm) are required');
  }
  const pkg = values['package.json'];
  return { tools, declaredEngines: pkg.engines ?? {}, dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {}, inputs };
}

export async function assembleGcspStatic({ browser, output, config, environment = 'deployed', revision, appRoot = path.join(ROOT, 'apps/gcsp-web'), compilerTools } = {}) {
  if (!browser || !output) throw new Error('Explicit --browser and empty --output directories are required');
  if (typeof revision !== 'string' || !revision.trim() || /[\u0000-\u001f]/u.test(revision)) throw new Error('Explicit source revision is required');
  const valid = validateRuntimeConfig(config, { environment });
  browser = await realpath(browser); appRoot = await realpath(appRoot); output = path.resolve(output);
  const compiler = await compilerRecord(appRoot, compilerTools);
  let parent = path.dirname(output);
  while (true) {
    try { parent = await realpath(parent); break; } catch (error) {
      if (error.code !== 'ENOENT' || parent === path.dirname(parent)) throw error;
      parent = path.dirname(parent);
    }
  }
  if (output === browser || browser.startsWith(`${output}${path.sep}`) || parent === browser || parent.startsWith(`${browser}${path.sep}`)) {
    throw new Error('Output must be separate from the compiled browser input');
  }
  try {
    const entry = await lstat(output);
    if (!entry.isDirectory() || entry.isSymbolicLink() || (await readdir(output)).length) throw new Error('Output must be a new or empty directory, not a symlink');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputs = [];
  const bytesByPath = new Map();
  for (const file of await compiledFiles(browser)) {
    if (file !== 'index.html' && file.endsWith('.html')) throw new Error(`Unexpected compiled HTML page: ${file}`);
    if (file === 'runtime-config.json' || file === 'static-manifest.json') throw new Error(`Compiled input contains deployment output: ${file}`);
    if (file !== 'index.html' && !/\.(?:js|css)$/u.test(file) && !file.startsWith('assets/') && !file.startsWith('media/')) throw new Error(`Compiled asset must be under assets/ or media/: ${file}`);
    if (/\.(?:js|css)$/u.test(file) && (file.includes('/') || !hashed.test(file))) throw new Error(`JS/CSS must be hashed files at the browser root: ${file}`);
    if (file.startsWith('media/') && !hashed.test(file)) throw new Error(`Media must have a compiler hash for immutable caching: ${file}`);
    const bytes = await readFile(path.join(browser, file));
    bytesByPath.set(file, bytes); inputs.push({ path: file, sha256: sha256(bytes), bytes: bytes.length });
  }
  if (!bytesByPath.has('index.html')) throw new Error('Missing compiled browser index.html');
  if (!bytesByPath.has('assets/brand-logos/bmwgroup-bmw-mini.svg')) throw new Error('Missing required compiled brand logo: assets/brand-logos/bmwgroup-bmw-mini.svg');
  const dependencies = [];
  for (const [file, bytes] of bytesByPath) {
    if (!/\.(?:html|js|css)$/u.test(file)) continue;
    const text = bytes.toString('utf8');
    for (const target of references(text, file)) {
      const url = new URL(target, `https://static.invalid/gcsp/${file === 'index.html' ? '' : file}`);
      if (url.origin !== 'https://static.invalid' || !url.pathname.startsWith('/gcsp/')) throw new Error(`${file}: dependency escapes /gcsp/: ${target}`);
      const to = decodeURIComponent(url.pathname.slice('/gcsp/'.length));
      if (!bytesByPath.has(to)) throw new Error(`Missing compiled dependency ${to}, referenced by ${file}`);
      dependencies.push({ from: file, to });
    }
  }
  let index = bytesByPath.get('index.html').toString('utf8');
  const localAsset = (value, extension) => {
    if (!value) return false;
    const url = new URL(value, 'https://static.invalid/gcsp/');
    return url.origin === 'https://static.invalid' && url.pathname.startsWith('/gcsp/')
      && extension.test(url.pathname) && bytesByPath.has(decodeURIComponent(url.pathname.slice('/gcsp/'.length)));
  };
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu'))?.[1];
  const module = [...index.matchAll(/<script\b[^>]*>/giu)].some(([tag]) => attr(tag, 'type') === 'module' && localAsset(attr(tag, 'src'), /\.js$/u));
  const stylesheet = [...index.matchAll(/<link\b[^>]*>/giu)].some(([tag]) => attr(tag, 'rel') === 'stylesheet' && localAsset(attr(tag, 'href'), /\.css$/u));
  if (!module || !stylesheet) throw new Error('Compiled index requires a packaged module script and stylesheet');
  if (!dependencies.some((edge) => edge.from.endsWith('.css') && /\.woff2?$/u.test(edge.to))) throw new Error('Compiled stylesheet requires a packaged WOFF/WOFF2 font');
  if ((index.match(/<base\b[^>]*href=["']\/gcsp\/["'][^>]*>/giu) ?? []).length !== 1) throw new Error('Compiled index must have exactly one base href="/gcsp/"');
  if (/http-equiv=["']Content-Security-Policy["']/iu.test(index)) throw new Error('Compiled index must not contain an existing CSP');
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/iu.test(index) || /\son[a-z]+\s*=/iu.test(index)) throw new Error('Compiled index violates the external-script CSP');
  if ((index.match(/<head\b[^>]*>/giu) ?? []).length !== 1) throw new Error('Compiled index requires exactly one head element');
  const policy = contentSecurityPolicy(valid, { environment }).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  index = index.replace(/<head\b[^>]*>/iu, (head) => `${head}<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  bytesByPath.set('index.html', Buffer.from(index));
  bytesByPath.set('runtime-config.json', Buffer.from(`${JSON.stringify(valid, null, 2)}\n`));
  const files = [];
  await mkdir(path.join(output, 'gcsp'), { recursive: true });
  for (const [file, bytes] of [...bytesByPath].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    await mkdir(path.dirname(path.join(output, 'gcsp', file)), { recursive: true });
    await writeFile(path.join(output, 'gcsp', file), bytes, { flag: 'wx' });
    files.push({ path: `gcsp/${file}`, sha256: sha256(bytes), bytes: bytes.length });
  }
  const manifest = { schemaVersion: 1, sourceRevision: revision, compiler, environment, compiledInputs: inputs,
    files, dependencies: dependencies.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`, 'en')) };
  await writeFile(path.join(output, 'gcsp/static-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const options = {};
    const names = { '--browser': 'browser', '--output': 'output', '--environment': 'environment', '--revision': 'revision', '--app': 'appRoot' };
    for (let i = 0; i < args.length; i += 2) {
      if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, names[args[i]])) throw new Error('Expected --browser <dir> --output <new/empty-dir> --environment <local|deployed> --revision <source-revision> [--app <app-dir>]');
      options[names[args[i]]] = args[i + 1];
    }
    options.config = runtimeConfigFromEnv(process.env, { environment: options.environment ?? 'deployed' });
    // These are observed tool versions; a separate compile receipt must establish compiler execution.
    options.compilerTools = { node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim() };
    const result = await assembleGcspStatic(options);
    console.log(`Assembled ${result.files.length} GCSP files from ${result.sourceRevision}`);
  } catch (error) { console.error(`GCSP static assembly failed: ${error.message}`); process.exitCode = 1; }
}
