// FUCQ-374: versioned static URLs and per-page preload hints, so a page loads its module graph in one wave
// and a revisited page loads JS and CSS from the browser cache with no requests.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';

export const VERSION_PREFIX = '/_v/';
const VERSIONED = /^\/_v\/([A-Za-z0-9_-]{1,40})(\/.*)$/;
const STATIC_ROOTS = ['blocks', 'assets'];
const RECHECK_MS = 1000;
// Static imports and re-exports, single or multi-line; dynamic import() is left to load on demand.
const JS_IMPORT = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?['"]([^'"\n]+)['"]/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g;
const PAGE_REF = /\b(src|href)="(?:\.\/|\/)((?:blocks|assets)\/[^"]+|gcsp-[\w-]+\.css)"/g;

// `/_v/<version>/<path>` to { version, path }; anything else to null.
export function splitVersioned(path) {
  const match = VERSIONED.exec(path);
  return match ? { version: match[1], path: match[2] } : null;
}

export function createStaticVersioning({ root, isPublic }) {
  let current = null; let checkedAt = 0; let pending = null;
  const graphs = new Map();

  async function walk(dir, out) {
    let entries; try { entries = await readdir(join(root, dir), { withFileTypes: true }); } catch { return out; }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel, out); else if (entry.isFile()) out.push(rel);
    }
    return out;
  }
  async function compute() {
    const files = (await Promise.all(STATIC_ROOTS.map((dir) => walk(dir, [])))).flat();
    for (const entry of await readdir(root).catch(() => [])) if (/^gcsp-[\w-]+\.css$/.test(entry)) files.push(entry);
    files.sort();
    const parts = await Promise.all(files.map(async (file) => {
      const info = await stat(join(root, file)).catch(() => null);
      return info ? `${file}:${info.size}:${info.mtimeMs}` : file;
    }));
    return createHash('sha256').update(parts.join('\n')).digest('base64url').slice(0, 12);
  }
  // Rechecked at most once a second, so an edit or redeploy changes the version without a restart.
  async function version() {
    if (current && Date.now() - checkedAt < RECHECK_MS) return current;
    pending ??= compute().then((value) => {
      if (value !== current) graphs.clear();
      current = value; checkedAt = Date.now(); return value;
    }).finally(() => { pending = null; });
    return pending;
  }

  async function reachable(entries, pattern) {
    const seen = new Set(); const queue = [...entries];
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path) || !isPublic(path)) continue;
      let source; try { source = await readFile(join(root, `.${path}`), 'utf8'); } catch { continue; }
      seen.add(path);
      for (const match of source.matchAll(pattern)) {
        const spec = match[1];
        if (!/^(\.\.?\/|\/)/.test(spec)) continue;
        queue.push(posix.normalize(spec.startsWith('/') ? spec : posix.join(posix.dirname(path), spec)));
      }
    }
    return [...seen];
  }

  // The page's references moved under the version, plus preload links for its whole static graph.
  async function renderPage(pagePath, html) {
    const v = await version();
    const key = `${v}\n${pagePath}`;
    if (!graphs.has(key)) {
      const scripts = [...html.matchAll(/<script\b[^>]*type="module"[^>]*\bsrc="(?:\.\/|\/)([^"]+)"/g)].map((m) => `/${m[1]}`);
      const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*\bhref="(?:\.\/|\/)([^"]+)"/g)].map((m) => `/${m[1]}`);
      const modules = await reachable(scripts, JS_IMPORT);
      const sheets = (await reachable(styles, CSS_IMPORT)).filter((path) => !styles.includes(path));
      graphs.set(key, [...modules.map((path) => `<link rel="modulepreload" href="${VERSION_PREFIX}${v}${path}">`),
        ...sheets.map((path) => `<link rel="preload" as="style" href="${VERSION_PREFIX}${v}${path}">`)].join('\n  '));
    }
    const rewritten = html.replace(PAGE_REF, (_all, attr, path) => `${attr}="${VERSION_PREFIX}${v}/${path}"`);
    const hints = graphs.get(key);
    return hints ? rewritten.replace(/<\/head>/i, `  ${hints}\n</head>`) : rewritten;
  }

  return { version, renderPage };
}
