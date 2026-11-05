/*
 * Headless render tests — every interface mode, every brand, actually mounted.
 *
 * The api/engine/brand suites prove the server. These prove the CLIENT: that
 * each mode's mount(root, ctx) paints real content in a real DOM, for each
 * brand, driving the true engine over a real (in-process) server. This is the
 * machine check that stands in for eyeballing `?brand=<key>&mode=<key>` in a
 * browser after onboarding a brand — a mode that throws on mount, or renders
 * nothing for a new brand, fails here.
 *
 * See dom-harness.js for how the DOM + server are stood up. Only the live feed
 * is faked; the mode, the engine client, the endpoints and the engine are all
 * production code.
 *
 * Coverage note (testing gap this closes): before this file, no test mounted a
 * client mode at all — client render regressions were caught only by manual
 * browser checks. New brands are added to BRANDS below so their client render
 * is guarded from the day they land, not just their server-side mapping.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { questionsForBrand } from '../questions.js';

import {
  installDom, resetDom, startModeServer, loadMode, mountMode, settle,
} from './dom-harness.js';
import {
  bmwPool, miniPool, hondaPool, fordPool, motorradPool, ferrariPool,
} from './helpers.js';

// Brands under render test, each with a stock pool and the marque name. The
// wordmark is asserted only where a mode actually shows it: the questionnaire
// intro names the brand for every marque ("Find your perfect BMW"), whereas the
// two game modes lead with a neutral, brand-agnostic seed screen ("Car Match" /
// "Head to Head" on BMW) and reveal the brand voice later, by design (see the
// mode requirement docs). So the universal render check is "paints + correct
// theme + no em dashes"; the wordmark check is scoped to questionnaire.
// Motorrad is the first non-car brand: its pool is BIKES (motorrad-bikes.json),
// but the mapped shape is identical, so the same render matrix applies. Its
// wordmark on the questionnaire intro is "BMW Motorrad".
const BRANDS = [
  { key: 'bmw', pool: () => bmwPool(20), name: /BMW/i },
  { key: 'mini', pool: () => miniPool(8), name: /MINI/i },
  { key: 'honda', pool: () => hondaPool(20), name: /Honda/i },
  { key: 'ford', pool: () => fordPool(20), name: /Ford/i },
  { key: 'motorrad', pool: () => motorradPool(20), name: /Motorrad/i },
  { key: 'ferrari', pool: () => ferrariPool(20), name: /Ferrari/i },
];

const MODES = ['questionnaire', 'mingle', 'knockout', 'podium', 'guess-who'];

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
      // Brand copy resolved on the questionnaire intro, which names the marque for
      // every brand. The game modes lead with a neutral seed screen by design,
      // so their wordmark is checked in their own reveal, not here.
      if (mode === 'questionnaire') {
        assert.match(
          text, brand.name,
          `questionnaire/${brand.key} did not show the brand wordmark`,
        );
      }
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

/*
 * Podium's two locked rules, neither of which the mount matrix above can see
 * (it only asserts the first paint).
 *
 * 1. The conditional questions are spliced IN PLACE. A rebuild of the pane is
 *    one line and it throws away scroll position and focus, so the check is
 *    that the removed block is gone AND that a neighbouring block is the same
 *    DOM node it was before the answer changed.
 * 2. "Not this one" only offers a reason whose follow-up can move the result
 *    FOR THIS BRAND. MINI drops the mileage question in brands.js, so MINI must
 *    not offer Mileage; a button that looks like it did something but cannot is
 *    worse than no button.
 */
test('podium splices a conditional question out in place', async () => {
  const stage = mountMode(modes.podium, { base: server.base, brand: 'bmw' });
  // `charging` shows while fuel is unanswered (SHOW_IF.charging).
  await settle(stage, (s) => s.querySelector('.vm-podium-q[data-qid="charging"]'));

  const budgetBefore = stage.querySelector('.vm-podium-q[data-qid="budget"]');
  const fuel = stage.querySelector('.vm-podium-q[data-qid="fuel"]');
  const petrol = [...fuel.querySelectorAll('.vm-option')]
    .find((b) => b.textContent.includes('Petrol'));
  petrol.click();

  assert.equal(
    stage.querySelector('.vm-podium-q[data-qid="charging"]'), null,
    'charging survived a petrol-only answer',
  );
  assert.equal(
    stage.querySelector('.vm-podium-q[data-qid="budget"]'), budgetBefore,
    'the pane was rebuilt rather than spliced: the budget block is a new node',
  );
});

test('podium only offers a dismissal reason the brand can act on', async () => {
  const reasonsFor = async (brand) => {
    resetDom();
    const stage = mountMode(modes.podium, { base: server.base, brand });
    // The reject trigger only exists once a live podium has painted.
    await settle(stage, (s) => s.querySelector('.vm-podium-reject'));
    stage.querySelector('.vm-podium-reject').click();
    return [...stage.querySelectorAll('.vm-podium-pop-reason')].map((b) => b.textContent);
  };

  const bmw = await reasonsFor('bmw');
  assert.ok(bmw.includes('Price'), 'BMW was not offered the price branch');
  assert.ok(bmw.includes('Mileage'), 'BMW asks about mileage, so it must offer that branch');

  const mini = await reasonsFor('mini');
  assert.ok(mini.includes('Price'), 'MINI was not offered the price branch');
  assert.ok(
    !mini.includes('Mileage'),
    'MINI drops the mileage question, so the branch has nowhere to write',
  );
});

/*
 * Podium's third locked rule, and the load-bearing one: a medal is a claim that
 * one car beat another, so the podium must never invent a ranking the engine
 * did not make. When the engine is not decisive the tied cars are joint first;
 * nothing is labelled 2nd or 3rd.
 *
 * Written as an invariant that holds in BOTH states rather than as a test that
 * forces a tie, because whether a given pool ties is a property of the engine's
 * scoring and would make this a brittle assertion about fixture data. Either
 * branch is meaningful: the tied branch catches a fabricated runner-up, the
 * decisive branch catches a podium that lost its single clear winner. Run over
 * every brand so a tie is genuinely exercised somewhere in the matrix.
 */
test('podium never labels a runner-up unless the engine ranked one', async () => {
  for (const brand of BRANDS) {
    resetDom();
    // eslint-disable-next-line no-await-in-loop
    const stage = mountMode(modes.podium, { base: server.base, brand: brand.key });
    // eslint-disable-next-line no-await-in-loop
    await settle(stage, (s) => s.querySelector('.vm-podium-step'));

    const steps = stage.querySelector('.vm-podium-steps');
    const all = [...stage.querySelectorAll('.vm-podium-step')];
    const count = (cls) => all.filter((s) => s.classList.contains(cls)).length;

    // No step may carry two rank classes at once, tied or not.
    for (const step of all) {
      const ranks = ['is-gold', 'is-silver', 'is-bronze']
        .filter((c) => step.classList.contains(c));
      assert.equal(
        ranks.length, 1,
        `${brand.key}: a step carried ${ranks.length} rank classes (${ranks.join(', ')})`,
      );
    }

    if (steps.classList.contains('is-tied')) {
      assert.equal(
        count('is-gold'), all.length,
        `${brand.key}: a tied podium left a step without joint first`,
      );
      assert.equal(
        count('is-silver') + count('is-bronze'), 0,
        `${brand.key}: a tied podium fabricated a runner-up the engine did not rank`,
      );
    } else {
      assert.equal(
        count('is-gold'), 1,
        `${brand.key}: a decisive podium did not have exactly one winner`,
      );
    }
  }
});

test('questionnaire offers and applies a known gearbox rejection with visible undo', async (t) => {
  const listings = [
    { id: 'auto-listing', shade: 'Blue', colour: 'Blue', priceMin: 30000, mileage: 10000, transmission: 'auto', features: [], link: '/auto' },
    { id: 'manual-listing', shade: 'White', colour: 'White', priceMin: 31000, mileage: 12000, transmission: 'manual', features: [], link: '/manual' },
  ];
  const match = {
    score: 88, reasons: [], tradeOffs: [],
    car: {
      id: 'mixed-gearbox', name: 'BMW 320i Touring', body: 'estate', fuel: 'petrol',
      colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' }, priceMin: 30000,
      priceMax: 30000, priceFrom: 30000, priceTo: 31000, mileage: 10000,
      transmission: 'auto', listingCount: 2, colours: ['Blue', 'White'], features: [],
      retailerName: 'Test Retailer', distance: null, link: '/auto',
    },
    listings,
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = String(url);
    const data = path.includes('/api/questions')
      ? { questions: questionsForBrand('bmw').filter((q) => ['budget', 'fuel'].includes(q.id)) }
      : path.includes('/api/nearby')
        ? { nearby: [], unmet: {} }
        : { matches: [match], alternatives: [], decisive: false, clusterSize: 1, tasteLead: false, searched: 2, unmet: {} };
    return { ok: true, status: 200, json: async () => data };
  });
  const root = document.createElement('div');
  root.className = 'vm vm-bmw';
  document.body.append(root);
  const ctx = {
    api: 'https://example.test', brand: 'bmw', retailer: '96',
    retailerLabel: 'Test Retailer', scope: 'dealer', overrides: {},
  };
  const cleanup = modes.questionnaire.mount(root, ctx);
  t.after(cleanup);
  await settle(root, (stage) => stage.querySelector('.vm-intro'));
  const answers = { budget: [10000, 40000], fuel: ['petrol'] };
  ctx.answers = answers;
  ctx.showResults(answers);
  await settle(root, (stage) => stage.querySelector('.vm-reject-open'));

  root.querySelector('.vm-reject-open').click();
  const menu = root.querySelector('.vm-reject-menu');
  const manualReason = [...menu.querySelectorAll('.vm-reject-option')]
    .find((button) => button.textContent === 'Only manual');
  assert.ok(manualReason, 'a mixed group with another known gearbox should offer Only manual');
  assert.match(manualReason.nextElementSibling.textContent, /whole current search.*all retailers and listings/i);
  manualReason.click();

  assert.match(root.querySelector('.vm-feedback-scope').textContent, /not saved/i);
  assert.equal(root.querySelector('.vm-card .vm-specs').textContent.includes('Manual'), true);
  assert.equal(root.querySelector('.vm-card .vm-avail-count'), null, 'the filtered card should describe only its manual listing');
  const undo = root.querySelector('.vm-brief-undo');
  assert.equal(undo.textContent, 'Undo');
  assert.equal(undo.getAttribute('aria-label'), 'Undo Only manual');
  undo.click();
  assert.equal(root.querySelector('.vm-card .vm-avail-count').textContent, '2 available');
  assert.match(root.querySelector('.vm-reject-menu').textContent, /exact group and model/i);
});

test('component gallery keeps browse and employee examples local and reversible', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = document.createElement('div');
  document.body.append(root);
  mountComponentGallery(root);
  assert.doesNotMatch(root.textContent, /undefined|0–62 nulls|null mpg/);

  root.querySelector('.vm-reject-open').click();
  const menu = root.querySelector('.vm-reject-menu');
  const options = [...menu.querySelectorAll('.vm-reject-option')];
  assert.ok(options.some((button) => button.textContent === 'Only manual'), 'mixed synthetic gearboxes must show the alternative');
  const shade = options.find((button) => button.textContent === 'Not the blue');
  assert.match(shade.nextElementSibling.textContent, /whole current search.*all retailers and listings/i);
  shade.click();
  assert.match(root.querySelector('.vm-gallery-feedback .vm-feedback-scope').textContent, /nothing is saved/i);
  const undo = root.querySelector('.vm-gallery-feedback .vm-brief-undo');
  assert.equal(undo.getAttribute('aria-label'), 'Undo Not the blue');
  undo.click();
  assert.equal(root.querySelectorAll('.vm-gallery-cards .vm-card').length, 2);

  for (let index = 0; index < 2; index += 1) {
    root.querySelector('.vm-reject-open').click();
    const group = [...root.querySelectorAll('.vm-reject-option')]
      .find((button) => button.textContent === 'Just not this one');
    assert.match(group.nextElementSibling.textContent, /exact group and model/i);
    group.click();
  }
  assert.equal(root.querySelectorAll('.vm-gallery-cards .vm-card').length, 0);
  assert.ok(root.querySelector('.vm-gallery-reset'));
  root.querySelector('.vm-gallery-reset').click();
  assert.equal(root.querySelectorAll('.vm-gallery-cards .vm-card').length, 2);

  assert.match(root.querySelector('.vm-gallery-employee').textContent, /Charging access: unknown \(needs confirmation\)/);
  root.querySelector('.vm-gallery-employee button.vm-btn-primary').click();
  assert.match(root.querySelector('.vm-gallery-employee').textContent, /Charging access: none \(confirmed\)/);
  const employeeUndo = root.querySelector('.vm-gallery-employee .vm-brief-undo');
  assert.equal(employeeUndo.getAttribute('aria-label'), 'Undo Confirm no charging access');
  employeeUndo.click();
  assert.match(root.querySelector('.vm-gallery-employee').textContent, /Charging access: unknown \(needs confirmation\)/);
  assert.match(root.querySelector('.vm-gallery-employee .vm-feedback-scope').textContent, /No saved brief.*account learning.*hold/i);
});

// A re-mount (switching tabs re-calls mount) must start clean, not stack a
// second interface on top of the first. Mount twice into the same stage-owning
// body and assert the second run replaced rather than appended.
test('re-mounting a mode starts a clean run', async () => {
  const first = mountMode(modes.questionnaire, { base: server.base, brand: 'bmw' });
  await settle(first, (s) => s.textContent.replace(/\s/g, '').length > 20);

  // The shell re-mounts by handing the mode a fresh stage; simulate that.
  resetDom();
  const second = mountMode(modes.mingle, { base: server.base, brand: 'bmw' });
  await settle(second, (s) => s.textContent.replace(/\s/g, '').length > 20);

  // Exactly one stage in the body — the old one is gone.
  const stages = document.body.querySelectorAll('.vm');
  assert.equal(stages.length, 1, 'a re-mount left a stale interface behind');
});

/*
 * Scope plumbing — ctx.scope has to reach the wire, and nothing on screen shows
 * whether it did.
 *
 * A mode handed the national scope but silently asking for the dealer's stock
 * paints perfectly: right theme, right copy, real cars, just the wrong pool. So
 * these two tests watch the server's own record of what it was asked for rather
 * than the DOM. Guess Who is the mode driven here because it reads the pool on
 * mount with no playthrough; the other four are covered by the source guard
 * below, which is what actually catches a positional-argument slip.
 */
test('a mode mounted at national scope asks the server for the national pool', async () => {
  // Its own server: stockCalls is cumulative, and the suite's shared instance has
  // every other test's requests in it.
  const own = await startModeServer({ bmw: bmwPool() });
  try {
    const stage = mountMode(modes['guess-who'], { base: own.base, brand: 'bmw', scope: 'national' });
    await settle(stage, (s) => s.textContent.replace(/\s/g, '').length > 20);
    assert.ok(own.stockCalls.length > 0, 'guess-who must read the pool on mount');
    for (const call of own.stockCalls) {
      assert.equal(call.scope, 'national', 'ctx.scope did not reach the request');
    }
  } finally {
    await own.close();
  }
});

test('a mode mounted with no scope gets the dealer pool, the way an embed with no ?scope= does', async () => {
  const own = await startModeServer({ bmw: bmwPool() });
  try {
    const stage = mountMode(modes['guess-who'], { base: own.base, brand: 'bmw' });
    await settle(stage, (s) => s.textContent.replace(/\s/g, '').length > 20);
    assert.ok(own.stockCalls.length > 0, 'guess-who must read the pool on mount');
    for (const call of own.stockCalls) {
      assert.equal(call.scope, 'dealer', 'an unset scope must resolve to the dealer, not the network');
    }
  } finally {
    await own.close();
  }
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
  const MODE_FILES = [
    'modes/questionnaire.js', 'modes/mingle.js', 'modes/knockout.js',
    'modes/podium.js', 'modes/guess-who.js', 'modes/preview-feed.js',
  ];
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

// The painted-copy test above only sees the FIRST screen of each mode. The house
// rule (no em dashes in user-facing copy) also has to hold on the later-flow
// screens a render test can't cheaply reach without a full playthrough: deck
// instructions, per-tie verdicts, weak/thin notes, empty-deck ledes, result CTAs.
// Those all live in static copy tables in the mode source, so we guard them at
// the source: scan each client file for an em dash inside a string literal. This
// caught real violations in the BMW/MINI mingle + knockout copy that the painted
// check never reached (they only appear on the result/verdict/empty screens), and
// it stops any future edit from reintroducing one on any screen.
//
// Comments and dev-only console diagnostics are out of scope (the rule is about
// on-screen copy), so pure-comment lines are skipped and CSS/JS content strings
// are the target. This is a source scan, not a runtime paint, so it needs no
// server or DOM — it stands alone.
test('no em dashes in any string literal across the client copy surface', () => {
  const CLIENT_FILES = [
    'modes/questionnaire.js', 'modes/mingle.js', 'modes/knockout.js',
    'modes/podium.js', 'modes/guess-who.js', 'modes/match-signal.js',
    // The shared render modules lifted out of questionnaire.js. Their string
    // literals are on-screen copy for every mode that renders a card or a
    // question, so they belong in the same guard.
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
