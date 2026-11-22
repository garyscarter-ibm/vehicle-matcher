// The components ratchet. Views build tables, headings, empty states and the other repeated pieces through the shared
// component kit, not by hand. Hand-built ones from before the kit are counted per file in ui-ratchet.json (beside this
// file), and a count may only fall:
//   - a file over its baseline fails: use the kit, or extend it (a new option on a component, in the kit and in COMPONENTS.md);
//   - a file under its baseline also fails, with the new number: lower the baseline in the same commit;
//   - a file the baseline doesn't list starts at zero;
//   - the shared stylesheet may not grow past its line cap, and a shorter one is banked the same way;
//   - with a "port" block (below), two more counts are kept the same way: source selectors still missing from the
//     target stylesheet, and catalogue rows still unported.
//
// Run from the project root: node tests/ui-ratchet.test.mjs        (or --root DIR from elsewhere)
//   --write          rewrite "baseline" (and the stylesheet cap, and port.baseline) at the current counts. It refuses
//                    to raise any number unless --allow-raise is given. A config with no "baseline" key is unseeded, and
//                    the first --write seeds it.
//   --debt           print the total outstanding per pattern as JSON ({} when clear), then exit
//   --allow-raise    with --write, accept a higher number
//
// ui-ratchet.json (all paths relative to the project root, forward slashes):
//   { "version": 1,
//     "roots": ["js/"],                      folders (or files) to scan
//     "exclude": ["js/ui/"],                 folders or files to skip (the kit itself)
//     "extensions": [".js", ".mjs"],         default shown
//     "patterns": { "table": { "re": "\\bh\\(\\s*\"table\"", "flags": "g", "use": "dataTable() (js/ui/table.js)" } },
//     "baseline": { "js/views/a.js": { "table": 2 } },
//     "exempt": { "js/views/a.js": ["table"] },        optional: counted, but left out of --debt
//     "stylesheet": { "path": "css/app.css", "max_lines": 900 },   optional
//     "port": {                                 optional: a project porting its UI to another framework
//       "source": ["ref/blocks/"],              the old stylesheets: folders are walked for .css files
//       "target": ["src/styles/app.css"],       the new stylesheet(s), .css only
//       "kit": ["src/kit/"],                    the new kit's code: every file under these is searched for root classes
//       "catalogue": "COMPONENTS.md",           default shown; its "## Port status" table lists each component
//       "rewrites": [{ "sheet": "ref/blocks/a.css", "from": ".section .a", "to": ".a" }],
//       "retired": [{ "sheet": "ref/blocks/b.css", "selector": ".b-old", "decision": "name, YYYY-MM-DD, source" }],
//                                               selector omitted: the whole sheet is retired
//       "baseline": { "missing_selectors": 12, "unported_components": 3 } } }   absent: unseeded
// Comments (/* ... */ and // ...) are stripped before counting. With "port", the two counts are missing_selectors (the
// source's selectors, per sheet, with no match in the target) and unported_components (catalogue rows not ported, or
// retired without a decision). Selectors are read at top level and inside @media, @supports, @layer, @container, @scope
// and @document; a rule nested inside a style rule (CSS nesting) belongs to its parent and is not counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "ui-ratchet.json");
const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
const root = resolve(rootArg >= 0 ? args[rootArg + 1] : process.cwd());
const PORT_COUNTS = ["missing_selectors", "unported_components"];
const DECISION = /^[^,]+,\s*\d{4}-\d{2}-\d{2},\s*\S/;             // "<name>, <YYYY-MM-DD>, <source>"
const RETIRED = /^retired:\s*[^,]+,\s*\d{4}-\d{2}-\d{2},\s*\S/i;   // a "retired:" catalogue status with its decision
const DESCEND = /^@(media|supports|layer|container|scope|document)\b/i;   // at-rules whose rules count as selectors
const isCss = (f) => f.endsWith(".css");
const isDir = (rel) => statSync(join(root, rel)).isDirectory();
const readText = (rel) => readFileSync(join(root, rel), "utf8");

function fail(msg) {
  console.error("ui-ratchet: " + msg);
  process.exit(2);
}

function loadConfig() {
  if (!existsSync(configPath)) fail(`${configPath} not found; it sits beside this test`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    fail(`ui-ratchet.json is not valid JSON: ${e.message}`);
  }
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(cfg)) fail("ui-ratchet.json must be a JSON object");
  if (cfg.version !== 1) fail('ui-ratchet.json needs "version": 1');
  const strList = (key, required) => {
    if (cfg[key] === undefined) {
      if (required) fail(`ui-ratchet.json is missing "${key}"`);
      return;
    }
    if (!Array.isArray(cfg[key]) || (required && !cfg[key].length) || cfg[key].some((s) => typeof s !== "string" || !s))
      fail(`"${key}" must be a${required ? " non-empty" : ""} list of strings`);
  };
  strList("roots", true);
  strList("exclude", false);
  strList("extensions", false);
  if (!isObj(cfg.patterns) || !Object.keys(cfg.patterns).length) fail('ui-ratchet.json is missing "patterns" (an object of pattern name to {re, use})');
  for (const [name, p] of Object.entries(cfg.patterns)) {
    if (!isObj(p)) fail(`pattern "${name}" must be an object with "re" and "use"`);
    if (typeof p.re !== "string" || !p.re) fail(`pattern "${name}" is missing "re" (a regular expression as a string)`);
    if (typeof p.use !== "string" || !p.use) fail(`pattern "${name}" is missing "use" (what to use instead)`);
    if (p.flags !== undefined && typeof p.flags !== "string") fail(`pattern "${name}": "flags" must be a string`);
    try {
      p.regex = new RegExp(p.re, [...new Set((p.flags || "") + "g")].join(""));
    } catch (e) {
      fail(`pattern "${name}" has a bad regular expression: ${e.message}`);
    }
    if (new RegExp(p.regex.source, p.regex.flags).test("")) fail(`pattern "${name}" matches the empty string; make it match one hand-built piece`);
  }
  for (const key of ["baseline", "exempt"]) {
    if (cfg[key] === undefined) continue;
    if (!isObj(cfg[key])) fail(`"${key}" must be an object keyed by file`);
    for (const [f, v] of Object.entries(cfg[key])) {
      if (key === "baseline") {
        if (!isObj(v)) fail(`baseline "${f}" must be an object of pattern name to count`);
        for (const [k, n] of Object.entries(v)) {
          if (!(k in cfg.patterns)) fail(`baseline "${f}" names pattern "${k}", which is not in "patterns"`);
          if (!Number.isInteger(n) || n < 0) fail(`baseline "${f}": "${k}" must be a whole number, not ${JSON.stringify(n)}`);
        }
      } else if (!Array.isArray(v) || v.some((k) => !(k in cfg.patterns))) {
        fail(`exempt "${f}" must be a list of pattern names from "patterns"`);
      }
    }
  }
  if (cfg.stylesheet !== undefined) {
    const s = cfg.stylesheet;
    if (!isObj(s) || typeof s.path !== "string" || !s.path) fail('"stylesheet" needs a "path"');
    if (s.max_lines !== undefined && (!Number.isInteger(s.max_lines) || s.max_lines < 0)) fail('"stylesheet.max_lines" must be a whole number');
    if (!existsSync(join(root, s.path))) fail(`stylesheet "${s.path}" not found under ${root}`);
  }
  if (cfg.stylesheets !== undefined) {
    if (!Array.isArray(cfg.stylesheets)) fail('"stylesheets" must be a list of {path, max_lines}');
    for (const s of cfg.stylesheets) {
      if (!isObj(s) || typeof s.path !== "string" || !s.path) fail('each "stylesheets" entry needs a "path"');
      if (!Number.isInteger(s.max_lines) || s.max_lines < 0) fail(`"stylesheets" entry "${s.path}" needs a whole-number "max_lines"`);
      if (!existsSync(join(root, s.path))) fail(`stylesheet "${s.path}" not found under ${root}`);
    }
  }
  for (const r of cfg.roots) if (!existsSync(join(root, r))) fail(`root "${r}" not found under ${root} (run from the project root, or pass --root DIR)`);
  if (cfg.port !== undefined) {
    const p = cfg.port;
    if (!isObj(p)) fail('"port" must be an object');
    const need = (key) => {
      if (p[key] === undefined) fail(`ui-ratchet.json's "port" is missing "${key}"`);
      if (!Array.isArray(p[key]) || !p[key].length || p[key].some((s) => typeof s !== "string" || !s))
        fail(`"port.${key}" must be a non-empty list of strings`);
      for (const x of p[key]) if (!existsSync(join(root, x))) fail(`"port.${key}" path "${x}" not found under ${root} (run from the project root, or pass --root DIR)`);
    };
    for (const key of ["source", "target"]) {   // a listed file must be .css, so no sheet is dropped without a word
      need(key);
      for (const x of p[key]) if (!isCss(x) && !isDir(x)) fail(`"port.${key}" "${x}" is not a .css file or a folder`);
      if (!filesUnder(p[key], isCss).length) fail(`"port.${key}" holds no .css file (${p[key].join(", ")})`);
    }
    need("kit");
    if (p.catalogue !== undefined && (typeof p.catalogue !== "string" || !p.catalogue)) fail('"port.catalogue" must be a path');
    const catalogue = p.catalogue ?? "COMPONENTS.md";
    if (!existsSync(join(root, catalogue))) fail(`"port.catalogue" "${catalogue}" not found under ${root}`);
    if (isDir(catalogue)) fail(`"port.catalogue" "${catalogue}" is a folder, not a file`);
    portRows(catalogue);   // fails unless the "## Port status" table and its columns are there
    if (p.rewrites !== undefined && (!Array.isArray(p.rewrites) || p.rewrites.some((r) => !isObj(r) || ["sheet", "from", "to"].some((k) => typeof r[k] !== "string" || !r[k]))))
      fail('"port.rewrites" must be a list of {"sheet", "from", "to"} objects, each a non-empty string');
    if (p.retired !== undefined && !Array.isArray(p.retired)) fail('"port.retired" must be a list');
    for (const r of p.retired ?? []) {
      if (!isObj(r) || typeof r.sheet !== "string" || !r.sheet || (r.selector !== undefined && (typeof r.selector !== "string" || !r.selector)))
        fail('"port.retired" entries need a "sheet" (and a "selector" to retire one selector), each a non-empty string');
      if (typeof r.decision !== "string" || !DECISION.test(r.decision))
        fail(`"port.retired" of "${r.sheet}" needs a human collaborator's recorded decision "<name>, <YYYY-MM-DD>, <source>", not ${JSON.stringify(r.decision ?? null)}`);
    }
    if (p.baseline !== undefined) {
      if (!isObj(p.baseline)) fail('"port.baseline" must be an object');
      for (const [k, n] of Object.entries(p.baseline)) {
        if (!PORT_COUNTS.includes(k)) fail(`"port.baseline" names "${k}"; the port block counts ${PORT_COUNTS.join(" and ")}`);
        if (!Number.isInteger(n) || n < 0) fail(`"port.baseline.${k}" must be a whole number, not ${JSON.stringify(n)}`);
      }
    }
    for (const name of PORT_COUNTS) if (name in cfg.patterns) fail(`pattern "${name}" clashes with the port block's count of that name (--debt reports it); rename the pattern`);
  }
  cfg.extensions ||= [".js", ".mjs"];
  cfg.exclude ||= [];
  return cfg;
}

const cfg = loadConfig();
const baseline = cfg.baseline || {};
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");   // comments don't count

function excluded(rel) {
  return cfg.exclude.some((e) => {
    const x = e.replace(/\/+$/, "");
    return rel === x || rel.startsWith(x + "/");
  });
}

function files() {
  const out = new Set();
  const walk = (rel) => {
    if (excluded(rel)) return;
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (name === "node_modules" || name === ".git") continue;
        walk(rel ? rel + "/" + name : name);
      }
    } else if (cfg.extensions.some((x) => rel.endsWith(x))) {
      out.add(rel);
    }
  };
  for (const r of cfg.roots) walk(r.replace(/\/+$/, ""));
  return [...out].sort();
}

function counts() {
  const out = {};
  for (const f of files()) {
    const src = strip(readFileSync(join(root, f), "utf8"));
    for (const [kind, p] of Object.entries(cfg.patterns)) {
      const n = (src.match(p.regex) || []).length;
      if (n) (out[f] ||= {})[kind] = n;
    }
  }
  return out;
}

const linesOf = (path) => readFileSync(join(root, path), "utf8").split("\n").length;
const allSheets = () => [...(cfg.stylesheet ? [cfg.stylesheet] : []), ...(cfg.stylesheets || [])];

// The port block. portReport() gives the source selectors missing from the target stylesheets, and the catalogue rows
// not yet ported, each with its reason. Nothing computed is stored on cfg (--write serialises it).
const normalise = (sel) => sel.replace(/\s+/g, " ").replace(/\s*([>+~])\s*/g, "$1").replace(/\(\s*/g, "(").replace(/\s*\)/g, ")").trim();

function quoteEnd(s, at) {                  // the index just past the quoted string that opens at s[at]
  let j = at + 1;
  while (j < s.length && s[j] !== s[at]) j += s[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, s.length);
}

function splitTop(list) {                   // a selector list's parts: the commas outside (), [] and quotes
  const parts = [];
  let depth = 0, from = 0;
  for (let j = 0; j < list.length; j++) {
    const c = list[j];
    if (c === '"' || c === "'") j = quoteEnd(list, j) - 1;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(list.slice(from, j));
      from = j + 1;
    }
  }
  parts.push(list.slice(from));
  return parts;
}

function selectors(cssText) {               // the normalised selectors of a stylesheet's rules (a Set)
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Set();
  let i = 0;
  const skipBlock = () => {                 // the "{" is read: move past its matching "}"
    let depth = 1;
    while (i < css.length && depth > 0) {
      const c = css[i];
      if (c === '"' || c === "'") i = quoteEnd(css, i);
      else {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
    }
  };
  const rules = (nested) => {               // rules up to the "}" closing this block (nested), or the end of the text
    let prelude = "";
    while (i < css.length) {
      const c = css[i];
      if (c === '"' || c === "'") {
        const end = quoteEnd(css, i);
        prelude += css.slice(i, end);
        i = end;
        continue;
      }
      i++;
      if (c === ";") prelude = "";
      else if (c === "}") {
        if (nested) return;
        prelude = "";
      } else if (c === "{") {
        const head = prelude.trim();
        prelude = "";
        if (DESCEND.test(head)) rules(true);
        else if (head.startsWith("@")) skipBlock();
        else {
          for (const part of splitTop(head)) {
            const sel = normalise(part);
            if (sel) out.add(sel);
          }
          skipBlock();
        }
      } else prelude += c;
    }
  };
  rules(false);
  return out;
}

// The files under the listed folders and files (root-relative). Folders are walked sorted, skipping node_modules and .git.
function filesUnder(list, keep) {
  const out = new Set();
  const walk = (rel) => {
    if (!isDir(rel)) {
      if (keep(rel)) out.add(rel);
      return;
    }
    for (const name of readdirSync(join(root, rel)).sort()) if (name !== "node_modules" && name !== ".git") walk(join(rel, name));
  };
  for (const r of list) walk(join(r));
  return [...out].sort();
}

// The rows of the catalogue's "## Port status" table, as cell text. Fails when the section, its table or a column is missing.
function portRows(catalogue) {
  const lines = readText(catalogue).split("\n");
  const head = lines.findIndex((l) => /^## Port status\s*$/.test(l));
  if (head < 0) fail(`${catalogue} has no "## Port status" section (the port block counts its rows)`);
  let i = head + 1;
  while (i < lines.length && !lines[i].startsWith("## ") && !lines[i].trimStart().startsWith("|")) i++;
  if (i >= lines.length || lines[i].startsWith("## ")) fail(`${catalogue}: the "## Port status" section has no table`);
  const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const cols = cells(lines[i]).map((c) => c.toLowerCase());
  for (const name of ["Source component", "Root class", "Target", "Status", "Classes kept"])
    if (!cols.includes(name.toLowerCase())) fail(`${catalogue}: the "## Port status" table has no "${name}" column`);
  const rows = [];
  let j = i + 1;
  if (j < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[j])) j++;   // the |---| separator
  for (; j < lines.length && lines[j].trimStart().startsWith("|"); j++) {
    const c = cells(lines[j]);
    if (c.every((x) => !x)) continue;
    const at = (name) => c[cols.indexOf(name.toLowerCase())] ?? "";
    rows.push({ component: at("Source component"), root: at("Root class"), status: at("Status") });
  }
  return rows;
}

function portReport() {
  const p = cfg.port;
  const target = new Set();
  for (const f of filesUnder(p.target, isCss)) for (const s of selectors(readText(f))) target.add(s);
  const rewrites = new Map(), gone = new Set(), goneSel = new Map();
  for (const r of p.rewrites ?? []) {                  // sheet names are matched as sheet ids ("./x.css" is "x.css")
    const key = `${join(r.sheet)}\n${normalise(r.from)}`;
    if (!rewrites.has(key)) rewrites.set(key, normalise(r.to));
  }
  for (const r of p.retired ?? []) {
    if (r.selector === undefined) gone.add(join(r.sheet));
    else goneSel.set(join(r.sheet), (goneSel.get(join(r.sheet)) ?? new Set()).add(normalise(r.selector)));
  }
  const missing = [];
  for (const sheet of filesUnder(p.source, isCss)) {
    if (gone.has(sheet)) continue;
    for (const sel of selectors(readText(sheet))) {
      if (goneSel.get(sheet)?.has(sel)) continue;
      if (!target.has(rewrites.get(`${sheet}\n${sel}`) ?? sel)) missing.push(`${sheet}: ${sel}`);
    }
  }
  const kit = filesUnder(p.kit, () => true).map(readText);
  const unported = [];
  for (const row of portRows(p.catalogue ?? "COMPONENTS.md")) {
    const status = row.status.replace(/`/g, "").trim();
    if (/^ported$/i.test(status)) {
      const cls = row.root.replace(/`/g, "").trim().replace(/^\./, "").split(".")[0];
      if (!cls) unported.push(`${row.component}: marked ported, but it names no root class`);
      else if (!kit.some((text) => new RegExp(`(?<![\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text)))
        unported.push(`${row.component}: marked ported, but its root class .${cls} is in none of the kit files`);
    } else if (/^retired/i.test(status)) {
      if (!RETIRED.test(status)) unported.push(`${row.component}: retired without a recorded decision (retired: <name>, <YYYY-MM-DD>, <source>)`);
    } else unported.push(`${row.component}: ${status}`);
  }
  return { missing, unported };
}

// The debt left to migrate: every current count outside "exempt", summed per pattern.
function debt(c) {
  const out = {};
  for (const [f, kinds] of Object.entries(c))
    for (const [kind, n] of Object.entries(kinds)) if (!cfg.exempt?.[f]?.includes(kind)) out[kind] = (out[kind] || 0) + n;
  return out;
}

function serialise(next) {
  const one = (v) => Array.isArray(v) ? `[${v.map(one).join(", ")}]`
    : v && typeof v === "object" ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${one(x)}`).join(", ")}}`
    : JSON.stringify(v);
  const lines = Object.entries(next).map(([k, v]) => {
    if ((k === "patterns" || k === "baseline" || k === "exempt" || k === "port") && Object.keys(v).length) {
      const rows = Object.entries(v).map(([name, val]) => `    ${JSON.stringify(name)}: ${one(val)}`);
      return `  ${JSON.stringify(k)}: {\n${rows.join(",\n")}\n  }`;
    }
    return `  ${JSON.stringify(k)}: ${one(v)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

if (args.includes("--debt")) {
  const out = debt(counts());
  if (cfg.port) {
    const { missing, unported } = portReport();
    if (missing.length) out.missing_selectors = missing.length;
    if (unported.length) out.unported_components = unported.length;
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

if (args.includes("--write")) {
  const now = counts();
  const seeded = cfg.baseline !== undefined;
  const raised = [];
  if (seeded) {
    for (const [f, kinds] of Object.entries(now))
      for (const [kind, n] of Object.entries(kinds)) {
        const was = baseline[f]?.[kind] || 0;
        if (n > was) raised.push(`${f}: ${kind} ${was} -> ${n}`);
      }
  }
  let sheet;
  for (const s of allSheets()) {
    const n = linesOf(s.path);
    if (s === cfg.stylesheet) sheet = n;
    if (seeded && s.max_lines !== undefined && n > s.max_lines) raised.push(`${s.path}: ${s.max_lines} -> ${n} lines`);
  }
  let portNow;
  if (cfg.port) {
    const { missing, unported } = portReport();
    portNow = { missing_selectors: missing.length, unported_components: unported.length };
    if (cfg.port.baseline !== undefined)
      for (const k of PORT_COUNTS) if (portNow[k] > (cfg.port.baseline[k] || 0)) raised.push(`port: ${k} ${cfg.port.baseline[k] || 0} -> ${portNow[k]}`);
  }
  if (raised.length && !args.includes("--allow-raise")) {
    console.error("ui-ratchet: --write would raise these, and a baseline only falls. Use the kit instead, or pass --allow-raise:\n" + raised.join("\n"));
    process.exit(1);
  }
  const next = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "baseline") continue;
    next[k] = k === "patterns" ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, { re: p.re, ...(p.flags ? { flags: p.flags } : {}), use: p.use }]))
      : k === "port" ? { ...v, baseline: portNow } : v;
    if (k === "stylesheet") next[k] = { path: v.path, max_lines: sheet };
    if (k === "stylesheets") next[k] = v.map((s) => ({ path: s.path, max_lines: linesOf(s.path) }));
  }
  next.baseline = now;
  // keep a stable key order: baseline just before stylesheet; port stays right after the key that came before it in the file
  const ordered = {};
  for (const k of Object.keys(next)) if (!["baseline", "stylesheet", "exempt", "port"].includes(k)) ordered[k] = next[k];
  ordered.baseline = next.baseline;
  if (next.exempt) ordered.exempt = next.exempt;
  if (next.stylesheet) ordered.stylesheet = next.stylesheet;
  const before = Object.keys(cfg)[Object.keys(cfg).indexOf("port") - 1];   // undefined when port is first, or absent
  const placed = {};
  if (next.port && before === undefined) placed.port = next.port;
  for (const [k, v] of Object.entries(ordered)) {
    placed[k] = v;
    if (next.port && k === before) placed.port = next.port;
  }
  writeFileSync(configPath, serialise(placed));
  const pieces = Object.values(now).reduce((a, k) => a + Object.values(k).reduce((x, y) => x + y, 0), 0);
  console.log(`ui-ratchet.json written: ${Object.keys(now).length} file(s), ${pieces} hand-built piece(s)` + (sheet !== undefined ? `, ${cfg.stylesheet.path} capped at ${sheet} lines` : "")
    + (portNow ? `, port: ${portNow.missing_selectors} missing selector(s), ${portNow.unported_components} unported component(s)` : ""));
  process.exit(0);
}

test("no file hand-builds more of any counted piece (patterns) than its baseline", () => {
  const over = [];
  for (const [f, kinds] of Object.entries(counts()))
    for (const [kind, n] of Object.entries(kinds)) {
      const was = baseline[f]?.[kind] || 0;
      if (n > was) over.push(`${f}: ${n} hand-built ${kind}${n > 1 ? "s" : ""} (baseline ${was}). Use ${cfg.patterns[kind].use}.`);
    }
  assert.deepEqual(over, [], "\n" + over.join("\n") + "\nSee COMPONENTS.md. A piece the kit can't draw: extend the kit, don't build it in the file.");
});

test("the baseline holds what has been won: a count that fell is lowered in ui-ratchet.json", () => {
  const now = counts(), under = [];
  for (const [f, kinds] of Object.entries(baseline))
    for (const [kind, was] of Object.entries(kinds)) {
      const n = now[f]?.[kind] || 0;
      if (n < was) under.push(`${f}: ${kind} ${was} -> ${n}`);
    }
  assert.deepEqual(under, [], "\nLower these in ui-ratchet.json (or run `node " + process.argv[1] + " --write`):\n" + under.join("\n"));
});

for (const { path, max_lines: cap } of allSheets()) {
  if (cap === undefined) continue;
  test(`${path} doesn't grow: shared looks go in the kit's stylesheet`, () => {
    const n = linesOf(path);
    assert.ok(n <= cap, `${path} is ${n} lines, cap ${cap}. Put a shared piece's style in the kit's stylesheet, or make room by removing rules a migration left unused.`);
  });
  test(`${path} shrinks are banked: the cap is lowered when it gets shorter`, () => {
    const n = linesOf(path);
    assert.ok(n >= cap, `${path} is ${n} lines, below its cap ${cap}: lower "max_lines" in ui-ratchet.json to ${n}.`);
  });
}

if (cfg.port) {
  const listed = (items) => (items.length > 20 ? [...items.slice(0, 20), `... and ${items.length - 20} more`] : items).join("\n");
  test("port: no more of the source's selectors are missing from the target stylesheet than the baseline", () => {
    const { missing } = portReport(), was = cfg.port.baseline?.missing_selectors || 0;
    assert.ok(missing.length <= was, `\n${missing.length} source selector(s) missing from ${cfg.port.target.join(", ")} (baseline ${was}):\n${listed(missing)}\n` +
      "Carry the rule over from its source sheet with its selector unchanged, or record a rewrite in port.rewrites. Only a human collaborator's recorded decision retires a selector or sheet (port.retired).");
  });
  test("port: unported components don't rise", () => {
    const { unported } = portReport(), was = cfg.port.baseline?.unported_components || 0;
    assert.ok(unported.length <= was, `\n${unported.length} catalogue row(s) not ported (baseline ${was}):\n${unported.join("\n")}\n` +
      "Port the component 1:1 (same DOM, class names and state classes), then mark it ported in the catalogue's Port status table.");
  });
  test("port: a fall is banked", () => {
    const { missing, unported } = portReport(), now = { missing_selectors: missing.length, unported_components: unported.length };
    const under = PORT_COUNTS.filter((k) => now[k] < (cfg.port.baseline?.[k] || 0));
    assert.deepEqual(under, [], "\n" + under.map((k) => `Lower port.baseline in ui-ratchet.json (or run \`node ${process.argv[1]} --write\`): ` +
      `${k} ${cfg.port.baseline[k]} -> ${now[k]}`).join("\n"));
  });
}
