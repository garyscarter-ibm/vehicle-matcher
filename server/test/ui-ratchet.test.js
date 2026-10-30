// The components ratchet. Views build tables, headings, empty states and the other repeated pieces through the shared
// component kit, not by hand. Hand-built ones from before the kit are counted per file in ui-ratchet.json (beside this
// file), and a count may only fall:
//   - a file over its baseline fails: use the kit, or extend it (a new option on a component, in the kit and in COMPONENTS.md);
//   - a file under its baseline also fails, with the new number: lower the baseline in the same commit;
//   - a file the baseline doesn't list starts at zero;
//   - the shared stylesheet may not grow past its line cap, and a shorter one is banked the same way.
//
// Run from the project root: node tests/ui-ratchet.test.mjs        (or --root DIR from elsewhere)
//   --write          rewrite "baseline" (and the stylesheet cap) at the current counts. It refuses to raise any number
//                    unless --allow-raise is given. A config with no "baseline" key is unseeded, and the first --write
//                    seeds it.
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
//     "stylesheet": { "path": "css/app.css", "max_lines": 900 } }   optional
// Comments (/* ... */ and // ...) are stripped before counting.
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
  for (const r of cfg.roots) if (!existsSync(join(root, r))) fail(`root "${r}" not found under ${root} (run from the project root, or pass --root DIR)`);
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

const sheetLines = () => readFileSync(join(root, cfg.stylesheet.path), "utf8").split("\n").length;

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
    if ((k === "patterns" || k === "baseline" || k === "exempt") && Object.keys(v).length) {
      const rows = Object.entries(v).map(([name, val]) => `    ${JSON.stringify(name)}: ${one(val)}`);
      return `  ${JSON.stringify(k)}: {\n${rows.join(",\n")}\n  }`;
    }
    return `  ${JSON.stringify(k)}: ${one(v)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

if (args.includes("--debt")) {
  console.log(JSON.stringify(debt(counts())));
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
  if (cfg.stylesheet) {
    sheet = sheetLines();
    const cap = cfg.stylesheet.max_lines;
    if (seeded && cap !== undefined && sheet > cap) raised.push(`${cfg.stylesheet.path}: ${cap} -> ${sheet} lines`);
  }
  if (raised.length && !args.includes("--allow-raise")) {
    console.error("ui-ratchet: --write would raise these, and a baseline only falls. Use the kit instead, or pass --allow-raise:\n" + raised.join("\n"));
    process.exit(1);
  }
  const next = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "baseline") continue;
    next[k] = k === "patterns" ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, { re: p.re, ...(p.flags ? { flags: p.flags } : {}), use: p.use }])) : v;
    if (k === "stylesheet") next[k] = { path: v.path, max_lines: sheet };
  }
  next.baseline = now;
  // keep a stable key order: baseline just before stylesheet
  const ordered = {};
  for (const k of Object.keys(next)) if (k !== "baseline" && k !== "stylesheet" && k !== "exempt") ordered[k] = next[k];
  ordered.baseline = next.baseline;
  if (next.exempt) ordered.exempt = next.exempt;
  if (next.stylesheet) ordered.stylesheet = next.stylesheet;
  writeFileSync(configPath, serialise(ordered));
  const pieces = Object.values(now).reduce((a, k) => a + Object.values(k).reduce((x, y) => x + y, 0), 0);
  console.log(`ui-ratchet.json written: ${Object.keys(now).length} file(s), ${pieces} hand-built piece(s)` + (sheet !== undefined ? `, ${cfg.stylesheet.path} capped at ${sheet} lines` : ""));
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

if (cfg.stylesheet && cfg.stylesheet.max_lines !== undefined) {
  const { path, max_lines: cap } = cfg.stylesheet;
  test(`${path} doesn't grow: shared looks go in the kit's stylesheet`, () => {
    const n = sheetLines();
    assert.ok(n <= cap, `${path} is ${n} lines, cap ${cap}. Put a shared piece's style in the kit's stylesheet, or make room by removing rules a migration left unused.`);
  });
  test(`${path} shrinks are banked: the cap is lowered when it gets shorter`, () => {
    const n = sheetLines();
    assert.ok(n >= cap, `${path} is ${n} lines, below its cap ${cap}: lower "max_lines" in ui-ratchet.json to ${n}.`);
  });
}
