#!/usr/bin/env node
// GCSP-only static release assembly. Retail Pages keeps its existing build.
import { readdir, readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(?:html|js|mjs|css)$/;
const PUBLIC = /\.(?:html|js|mjs|css|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|json)$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blockName = (file) => file.match(/^blocks\/gcsp\/([^/]+)/)?.[1];
const label = (file) => blockName(file) ? `GCSP block "${blockName(file)}"` : 'Static package';

async function filesBelow(root, relative = '') {
  const result = [];
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in public inputs: ${file}`);
    if (entry.isDirectory()) result.push(...await filesBelow(root, file));
    else if (PUBLIC.test(file)) result.push(file);
  }
  return result;
}

/** A directory-discovered manifest, including support blocks with no standalone page. */
export async function discoverManifest(sourceRoot = ROOT) {
  const blocks = [];
  for (const entry of (await readdir(path.join(sourceRoot, 'blocks/gcsp'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in GCSP blocks: ${entry.name}`);
    if (entry.isDirectory()) {
      const files = await filesBelow(sourceRoot, `blocks/gcsp/${entry.name}`);
      if (!files.length) throw new Error(`GCSP block "${entry.name}" has no public files`);
      blocks.push({ name: entry.name, files });
    }
  }
  const pages = (await readdir(sourceRoot)).filter((file) => /^gcsp-.*\.html$/.test(file)).sort();
  return { blocks, pages: ['index.html', 'block.html', 'components.html', ...pages] };
}

function apiSetting(value, environment) {
  let url;
  try { url = new URL(value); } catch { throw new Error('API setting must be an absolute http(s) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API setting must be http(s), without credentials, query or fragment');
  }
  if (!['local', 'deployed'].includes(environment)) throw new Error('Environment must be local or deployed');
  if (environment === 'deployed' && (url.protocol !== 'https:' || /^(?:localhost|127(?:\.\d+){3}|\[?::1\]?)$/i.test(url.hostname))) {
    throw new Error('Deployed API setting requires an HTTPS non-localhost backend URL');
  }
  return url.href.replace(/\/$/, '');
}

function replaceOnce(source, before, after, file) {
  if (source.split(before).length !== 2) throw new Error(`${file}: incompatible frontend revision; expected exactly one ${JSON.stringify(before)}`);
  return source.replace(before, after);
}

function references(source, file) {
  const found = new Set();
  // All literal ESM imports (including import()), CSS url/@import, page assets,
  // and literal module-relative assets/styles used by lazy entry loaders.
  const quoted = /(['"])(\.{1,2}\/[^'"\n]+\.(?:js|mjs|css|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf))(?:[?#][^'"\n]*)?\1/g;
  for (const match of source.matchAll(quoted)) found.add(match[2]);
  if (/\.(?:js|mjs)$/.test(file)) {
    for (const match of source.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) {
      if (!/^(['"])\.{1,2}\/[^'"\n]+\1\s*$/.test(match[1])) {
        throw new Error(`${label(file)}: unresolved dynamic import in ${file}: ${match[0]}; use a literal relative module target`);
      }
    }
    if (/\beval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\s*\(\s*['"`]/.test(source)) {
      throw new Error(`${file}: eval, Function or string timer violates GCSP CSP`);
    }
  }
  if (file.endsWith('.html')) {
    for (const match of source.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"<>]+)\1/gi)) {
      if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(match[2])) found.add(match[2].split(/[?#]/)[0]);
    }
  }
  if (file.endsWith('.css')) {
    for (const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
      if (!/^(?:data:|https?:|#)/.test(match[1])) found.add(match[1].split(/[?#]/)[0]);
    }
  }
  return [...found].sort();
}

function csp(apiUrl) {
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self' ${new URL(apiUrl).origin}; frame-src 'self' blob:; object-src 'none'; base-uri 'self'`;
}

/** Build into an empty directory; never clean an arbitrary user path. */
export async function assembleSite({ sourceRoot = ROOT, output, apiUrl = 'http://localhost:8787', environment = 'local', employeeEnabled = true, revision = 'unrecorded' } = {}) {
  sourceRoot = await realpath(sourceRoot);
  if (!output) throw new Error('An explicit empty --output directory is required');
  output = path.resolve(output);
  if (output === sourceRoot || sourceRoot.startsWith(`${output}${path.sep}`)) throw new Error('Output must not contain the source tree');
  try { if ((await lstat(output)).isSymbolicLink()) throw new Error(`Refusing symbolic link output: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const api = apiSetting(apiUrl, environment);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error(`Output must be empty: ${output}`);
  const discovered = await discoverManifest(sourceRoot);
  const inputs = new Set([...discovered.pages, ...(await filesBelow(sourceRoot, 'blocks')), ...(await filesBelow(sourceRoot, 'assets')),
    ...(await readdir(sourceRoot)).filter((file) => /^gcsp-.*\.css$/.test(file))]);
  // Template URLs cannot be statically enumerated by the import scanner. Their
  // finite brand domain comes from the shipped entry registry, never a second list.
  const registry = await readFile(path.join(sourceRoot, 'blocks/demo-launcher/entry-context.js'), 'utf8');
  const brands = registry.match(/retailBrands:\s*Object\.freeze\(\[([^\]]+)\]/)?.[1].match(/[a-z]+/g);
  if (!brands?.length) throw new Error('entry-context.js: incompatible retail brand registry');
  const requiredAssets = [...brands.flatMap((brand) => [`assets/brand-logos/${brand}.svg`, `assets/brand-hero/${brand}.jpg`]), 'assets/brand-logos/bmwgroup-bmw-mini.svg'];
  for (const file of requiredAssets) {
    if (!inputs.has(file)) throw new Error(`Missing required brand/image fallback asset: ${file}`);
  }
  const edges = [];
  for (const file of [...inputs].sort()) {
    const absolute = path.join(sourceRoot, file);
    if (!(await lstat(absolute)).isFile()) throw new Error(`Required public input is not a file: ${file}`);
    let bytes = await readFile(absolute);
    if (TEXT.test(file)) {
      let text = bytes.toString();
      if (file === 'blocks/demo-launcher/boot.js') {
        text = replaceOnce(text, "const LOCAL_API = 'http://localhost:8787';", `const LOCAL_API = ${JSON.stringify(api)};`, file);
        text = replaceOnce(text, "const REMOTE_API = 'https://bmw-matcher-api.onrender.com';", `const REMOTE_API = ${JSON.stringify(api)};`, file);
      }
      if (file === 'blocks/demo-launcher/demo-launcher.js') {
        text = replaceOnce(text, 'createEmployeeCapability()', `createEmployeeCapability({ enabled: ${employeeEnabled === true} })`, file);
      }
      if (file === 'block.html') {
        text = replaceOnce(text, 'data-api="http://localhost:8787"', `data-api="${api.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`, file);
        const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((match) => !/\bsrc\s*=/.test(match[1]));
        if (scripts.length !== 1) throw new Error('block.html: incompatible standalone script boundary');
        const script = scripts[0][2];
        await writeFile(path.join(output, 'block-entry.js'), script);
        text = text.replace(scripts[0][0], '<script type="module" src="./block-entry.js"></script>');
        edges.push(...references(script, 'block-entry.js').map((target) => ({ from: 'block-entry.js', to: path.posix.normalize(target) })));
      }
      if (file.endsWith('.html')) {
        if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(text) || /\son[a-z]+\s*=/i.test(text)) {
          throw new Error(`${file}: inline script or event handler violates GCSP CSP`);
        }
        text = text.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${csp(api)}">\n</head>`);
      }
      for (const target of references(text, file)) {
        const to = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
        if (to.startsWith('../')) throw new Error(`${file}: public dependency escapes package: ${target}`);
        edges.push({ from: file, to });
      }
      bytes = Buffer.from(text);
    }
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), bytes);
  }
  const files = await filesBelow(output);
  for (const edge of edges) {
    if (!files.includes(edge.to)) throw new Error(`${label(edge.from)}: missing required ${edge.to}, referenced by ${edge.from}`);
  }
  const demoPages = [
    { name: 'offer', block: 'offer', file: discovered.pages.find((p) => /(?:^|-)offer\.html$/.test(p))
      || (files.includes('blocks/gcsp/offer/preview.html') ? 'blocks/gcsp/offer/preview.html' : 'gcsp-offer.html') },
    { name: 'greg', block: 'greg', file: 'gcsp-greg.html' },
    { name: 'outbox', block: 'presenter', file: 'gcsp-outbox.html' },
  ].map((page) => ({ ...page, available: files.includes(page.file) }));
  const manifest = { version: 1, revision, environment, apiUrl: api, employeeEnabled: employeeEnabled === true,
    blocks: discovered.blocks, pages: discovered.pages, demoPages, requiredAssets,
    files: await Promise.all(files.map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(output, file))) }))),
    dependencies: edges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`, 'en')) };
  await writeFile(path.join(output, 'site-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await verifySite({ output });
  return manifest;
}

/** Recheck the exact assembled artifact, including accidental deletion/changes. */
export async function verifySite({ output, requireDemoPages = false } = {}) {
  const manifest = JSON.parse(await readFile(path.join(output, 'site-manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    let bytes;
    try { bytes = await readFile(path.join(output, file.path)); }
    catch { throw new Error(`${label(file.path)}: missing packaged file ${file.path}`); }
    if (hash(bytes) !== file.sha256) throw new Error(`${label(file.path)}: packaged file changed: ${file.path}; reassemble with the intended API setting/revision`);
  }
  if (requireDemoPages) for (const page of manifest.demoPages) {
    if (!page.available) throw new Error(`GCSP block "${page.block}": required direct ${page.name} page ${page.file} is unavailable in revision ${manifest.revision}`);
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    const keys = { '--output': 'output', '--api': 'apiUrl', '--environment': 'environment', '--revision': 'revision', '--source': 'sourceRoot' };
    let release = false;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--employee-disabled') options.employeeEnabled = false;
      else if (args[i] === '--require-demo-pages') release = true;
      else if (keys[args[i]] && args[i + 1] && !args[i + 1].startsWith('--')) options[keys[args[i]]] = args[++i];
      else throw new Error(`Unknown or incomplete assembly option: ${args[i]}`);
    }
    const manifest = await assembleSite(options);
    if (release) await verifySite({ output: options.output, requireDemoPages: true });
    console.log(`Assembled ${manifest.files.length} files; ${manifest.blocks.length} GCSP blocks; API ${manifest.apiUrl}; employee ${manifest.employeeEnabled ? 'enabled' : 'disabled'}`);
    for (const page of manifest.demoPages.filter((p) => !p.available)) console.log(`INCOMPLETE release gate: GCSP block "${page.block}" direct page ${page.file} is unavailable`);
  } catch (error) { console.error(`Assembly failed: ${error.message}`); process.exitCode = 1; }
}
