/*
 * Headless render tests: the questionnaire, every brand, actually mounted.
 *
 * Proves the CLIENT paints real content in a real DOM for each brand, over a real
 * in-process server (see dom-harness.js). Only the live feed is faked.
 * New brands are added to BRANDS below so their render is guarded from day one.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SHOW_IF } from '../../blocks/vehicle-matcher/quiz-meta.js';
import {
  installDom, resetDom, startModeServer, loadMode, mountMode, settle,
} from './dom-harness.js';
import {
  bmwPool, miniPool, hondaPool, fordPool, motorradPool, ferrariPool,
} from './helpers.js';

// Brands under render test: a stock pool and the marque name the intro must show.
// Motorrad's pool is bikes, but the mapped shape is identical.
const BRANDS = [
  { key: 'bmw', pool: () => bmwPool(20), name: /BMW/i },
  { key: 'mini', pool: () => miniPool(8), name: /MINI/i },
  { key: 'honda', pool: () => hondaPool(20), name: /Honda/i },
  { key: 'ford', pool: () => fordPool(20), name: /Ford/i },
  { key: 'motorrad', pool: () => motorradPool(20), name: /Motorrad/i },
  { key: 'ferrari', pool: () => ferrariPool(20), name: /Ferrari/i },
];

const MODES = ['questionnaire'];

let server;
let modes;

before(async () => {
  installDom();
  const pools = Object.fromEntries(BRANDS.map((b) => [b.key, b.pool()]));
  server = await startModeServer(pools);
  modes = Object.fromEntries(await Promise.all(
    MODES.map(async (k) => [k, await loadMode(k)]),
  ));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => resetDom());

// The core matrix: mount each mode for each brand, assert it paints.
for (const mode of MODES) {
  for (const brand of BRANDS) {
    test(`${mode} mounts and paints for ${brand.key}`, async () => {
      const stage = mountMode(modes[mode], { base: server.base, brand: brand.key });

      // Painted = non-trivial visible text after the async boot lands.
      await settle(stage, (s) => s.textContent.replace(/\s/g, '').length > 20);

      const text = stage.textContent;
      assert.ok(
        text.replace(/\s/g, '').length > 20,
        `${mode}/${brand.key} rendered no meaningful text`,
      );
      // The intro names the marque for every brand.
      assert.match(text, brand.name, `${mode}/${brand.key} did not show the brand wordmark`);
      // The stage carries the brand theme class the CSS hangs off.
      assert.ok(
        stage.classList.contains(`vm-${brand.key}`),
        `${mode}/${brand.key} missing vm-${brand.key} theme class`,
      );
      // It actually built DOM, not just a text node.
      assert.ok(
        stage.querySelector('*'),
        `${mode}/${brand.key} produced no elements`,
      );
    });
  }
}

// A re-mount must start clean, not stack a second interface on top of the first.
test('re-mounting a mode starts a clean run', async () => {
  const first = mountMode(modes.questionnaire, { base: server.base, brand: 'bmw' });
  await settle(first, (s) => s.textContent.replace(/\s/g, '').length > 20);

  // The shell re-mounts by handing the mode a fresh stage; simulate that.
  resetDom();
  const second = mountMode(modes.questionnaire, { base: server.base, brand: 'bmw' });
  await settle(second, (s) => s.textContent.replace(/\s/g, '').length > 20);

  // Exactly one stage in the body — the old one is gone.
  const stages = document.body.querySelectorAll('.vm');
  assert.equal(stages.length, 1, 'a re-mount left a stale interface behind');
});

/*
 * Scope plumbing: ctx.scope has to reach the wire, and nothing on screen shows
 * whether it did. A wrong-pool run paints perfectly, so these watch the server's
 * own record of what it was asked for. A shared #m= link makes the questionnaire
 * read the pool on mount with no playthrough.
 */
async function openSharedRun(base, scope) {
  const res = await fetch(`${base}/api/questions?brand=bmw`);
  const { questions } = await res.json();
  const answers = {};
  for (const q of questions) {
    if (q.conditional && SHOW_IF[q.id] && !SHOW_IF[q.id](answers)) continue;
    if (q.type === 'slider') answers[q.id] = q.range ? q.default : (q.default ?? q.min);
    else if (q.multi) answers[q.id] = [q.options[0].value];
    else answers[q.id] = q.options[0].value;
  }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(answers))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  window.location.hash = `#m=${encoded}`;
  return mountMode(modes.questionnaire, { base, brand: 'bmw', scope });
}

async function stockScopes(scope) {
  // Its own server: stockCalls is cumulative across the shared instance.
  const own = await startModeServer({ bmw: bmwPool() });
  try {
    const stage = await openSharedRun(own.base, scope);
    await settle(stage, () => own.stockCalls.length > 0);
    return own.stockCalls.map((c) => c.scope);
  } finally {
    window.location.hash = '';
    await own.close();
  }
}

test('a mode mounted at national scope asks the server for the national pool', async () => {
  const scopes = await stockScopes('national');
  assert.ok(scopes.length > 0, 'the shared run must read the pool');
  for (const s of scopes) assert.equal(s, 'national', 'ctx.scope did not reach the request');
});

test('a mode mounted with no scope gets the dealer pool, the way an embed with no ?scope= does', async () => {
  const scopes = await stockScopes(undefined);
  assert.ok(scopes.length > 0, 'the shared run must read the pool');
  for (const s of scopes) assert.equal(s, 'dealer', 'an unset scope must resolve to the dealer, not the network');
});

/*
 * Every stock call a mode makes must name a scope.
 *
 * The engine's stock functions take scope positionally, so the way this breaks is
 * not a missing argument but a misplaced one: apiField(api, seed, retailer, brand,
 * SIZE) still runs, still returns cars, and quietly reads size as the scope and
 * nothing as the size. A new mode, or a new call site in an old one, is the likely
 * moment. Nothing about the resulting screen looks wrong, so guard it at the
 * source: find each stock call and require the word scope inside its arguments.
 */
test('every mode stock call passes a scope', () => {
  const MODE_FILES = ['modes/questionnaire.js', 'modes/preview-feed.js'];
  // The engine calls that read stock, plus the shared preview scheduler that
  // wraps one of them. apiNearby is absent on purpose: it searches OTHER
  // retailers by distance, which is not a pool this block chooses.
  const STOCK_CALLS = /\b(apiMatch|apiPreview|apiField|apiPool|createPreviewFeed)\s*\(/g;
  const blockDir = new URL('../../blocks/vehicle-matcher/', import.meta.url);
  const offenders = [];

  for (const rel of MODE_FILES) {
    const src = readFileSync(fileURLToPath(new URL(rel, blockDir)), 'utf8');
    for (const m of src.matchAll(STOCK_CALLS)) {
      // Walk to the matching close paren so a multi-line argument list is read
      // whole; depth counting keeps nested calls and object literals together.
      let depth = 0;
      let end = m.index + m[0].length - 1;
      do {
        if (src[end] === '(') depth += 1;
        else if (src[end] === ')') depth -= 1;
        end += 1;
      } while (depth > 0 && end < src.length);
      const args = src.slice(m.index, end);
      // The definition of createPreviewFeed lives in preview-feed.js and takes
      // scope as a destructured param, which reads the same to this check.
      if (!/\bscope\b/.test(args)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line}  ${args.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }

  assert.equal(
    offenders.length, 0,
    `stock call with no scope (it will read the dealer pool whatever the embed asked for):\n${offenders.join('\n')}`,
  );
});

// No user-facing em dashes on the first painted screen of any mode/brand. The
// house rule (no em dashes in on-screen copy) gets a machine guard here.
test('no em dashes in painted copy', async () => {
  for (const mode of MODES) {
    for (const brand of BRANDS) {
      resetDom();
      // eslint-disable-next-line no-await-in-loop
      const stage = mountMode(modes[mode], { base: server.base, brand: brand.key });
      // eslint-disable-next-line no-await-in-loop
      await settle(stage, (s) => s.textContent.replace(/\s/g, '').length > 20);
      assert.ok(
        !stage.textContent.includes('—'),
        `${mode}/${brand.key} painted an em dash in user-facing copy`,
      );
    }
  }
});

// The painted-copy test only sees the first screen. Later-flow copy lives in static
// tables, so scan each client file for an em dash inside a string literal.
// Comments and console diagnostics are out of scope (the rule is for on-screen copy).
test('no em dashes in any string literal across the client copy surface', () => {
  const CLIENT_FILES = [
    'modes/questionnaire.js', 'modes/match-signal.js',
    'modes/result-card.js', 'modes/question-ui.js', 'modes/brand-copy.js',
    'modes/preview-feed.js',
    'vehicle-matcher.js', 'quiz-meta.js',
    'vehicle-matcher.css',
  ];
  const blockDir = new URL('../../blocks/vehicle-matcher/', import.meta.url);
  const offenders = [];
  for (const rel of CLIENT_FILES) {
    const path = fileURLToPath(new URL(rel, blockDir));
    const src = readFileSync(path, 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      // Skip pure-comment lines (JS // and /* */ bodies, CSS /* */). A code line
      // with a trailing comment is still scanned — but only its string literals
      // are inspected, so the trailing comment can't cause a false positive.
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      // Dev-only console diagnostics are author-facing, not on-screen copy.
      if (/\bconsole\.(warn|error|info|log|debug)\b/.test(line)) return;
      const strings = line.match(/([`'"])(?:\\.|(?!\1).)*\1/g) || [];
      for (const s of strings) {
        if (s.includes('—')) offenders.push(`${rel}:${i + 1}  ${s}`);
      }
    });
  }
  assert.equal(
    offenders.length, 0,
    `em dash in user-facing copy (house rule):\n${offenders.join('\n')}`,
  );
});
