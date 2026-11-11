// FUCQ-371 slice C2: record two real Offer read envelopes (without / with a saved positive current-car rating)
// through the actual allocation and offer-access services, then render the real Offer page for both.
// Usage: perl -e 'alarm shift; exec @ARGV' 300 node scripts/gcsp/fucq371-offer-capture.mjs <outDir> <scratchDir>
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../../server/gcsp/repository/index.js';
import { createPolicyService } from '../../server/gcsp/policy/index.js';
import { createDemoRuntime } from '../../server/gcsp/clock/index.js';
import { BriefService } from '../../server/gcsp/brief/index.js';
import { seedManualDemoContext } from '../../server/gcsp/manual-context/fixtures.js';
import { BuddyHoldService } from '../../server/gcsp/offers/buddy-hold.js';
import { createOfferAccessService } from '../../server/gcsp/offers/access.js';
import { verifyOfferToken } from '../../server/gcsp/offers/offer-token.js';
import { withVehicleDisplayImages } from '../../server/gcsp/vehicle-evidence/display-projection.js';
import { stock, essential, preference, fact, rating } from '../../server/test/helpers/employee-recommendation.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const [OUT, SCRATCH] = process.argv.slice(2).map((p) => resolve(p));
if (!OUT || !SCRATCH) throw Error('Usage: <outDir> <scratchDir>');
const PORT = 3029;
const PLAYWRIGHT = '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const LONG_NAME = 'BMW 330e xDrive M Sport Touring Shadow Edition Plug-in Hybrid Automatic';
const passed = (o) => { if (o.status !== 'ok') throw Error(`Unexpected outcome: ${o.status}`); return o.value; };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ref = (runId, table, key = {}) => ({ table, key: { runId, ...key } });

// ---------- Part 1: record the envelopes (same setup as server/test/gcsp-offer-access-producer.test.js) ----------
async function record({ briefExtra = {}, carFacts = {} }) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  passed(await repository.open());
  try {
    const policy = createPolicyService(); const wall = '2026-11-05T12:00:00.000Z';
    const runtime = passed(await createDemoRuntime({ repository, policy, environmentId: 'actual-producer-access-proof',
      policyAsOf: wall, commandId: 'producer-bootstrap', sessionNow: () => wall, environmentKind: 'synthetic' }));
    const { clock, identity } = runtime;
    const presenter = passed(await identity.createPresenterSession('producer-presenter'));
    const context = passed(await identity.switchPrincipal(presenter.context, 'demo-paula', 'producer-paula')).context;
    passed(await seedManualDemoContext({ repository, identity, clock, context }));
    const initial = passed(await clock.now(context));
    passed(await clock.advance(presenter.context, { commandId: 'producer-noon', expectedClockVersion: initial.clockVersion,
      bySeconds: (Date.parse(wall) - Date.parse(initial.now)) / 1000 }));
    const brief = new BriefService({ repository, policy, clock, identity });
    passed(await brief.saveDraft(context, { commandId: 'producer-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) }, ...briefExtra } }));
    passed(await brief.confirm(context, { commandId: 'producer-confirm', expectedBriefVersion: 0,
      expectedDraftVersion: 1, consent: { search: true, hold: true } }));
    const car = stock(1, carFacts);
    passed(await repository.transaction(context, { commandId: 'producer-stock', inputDigest: inputDigest('producer-stock') },
      (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: '0123456',
        configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
        facts: car.snapshot, release: { eventId: 'explicit-synthetic-release', availability: car.availability },
        visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
    const employee = passed(await repository.read(context, ref(context.runId, 'employees', { employeeId: context.employeeId })));
    const slot = passed(await repository.read(context, ref(context.runId, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId })));
    const producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
    const allocated = passed(await producer.allocate(context, { commandId: 'producer-allocate', orderUuid: car.orderUuid,
      expectedBriefVersion: 1, expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version }));
    const access = createOfferAccessService({ repository, policy, clock, identity, environmentId: context.environmentId,
      sessionNow: () => wall, verifyOfferToken });
    const selector = { runId: context.runId, offerId: allocated.offer.offerId };
    // The GET /api/gcsp/offers/:offerId handler returns fromAccount(...) unwrapped, then adds display images.
    const read = await access.fromAccount(context, selector);
    const body = await withVehicleDisplayImages({ status: 'ok', value: passed(read).offer, contractVersion: read.contractVersion });
    return { envelope: body, selector, account: { name: employee.name, gradeId: context.gradeId } };
  } finally { await repository.close(); }
}

// ---------- Part 2: serve and capture ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function staticServer() {
  const server = createServer(async (req, res) => {
    try {
      const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)));
      if (!path.startsWith(ROOT)) return res.writeHead(403).end();
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(path));
    } catch { res.writeHead(500).end(); }
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const VIEWPORTS = [[1440, 1100], [375, 812], [320, 800]];

async function capturePage(context, { name, envelope, selector, account, imageFiles, width, height, reason }) {
  const page = await context.newPage();
  const record = { requests: [], blocked: [], consoleErrors: [], pageErrors: [] };
  await page.setViewportSize({ width, height });
  page.on('console', (m) => { if (m.type() === 'error') record.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => record.pageErrors.push(String(e)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { record.blocked.push(url.href); return route.abort(); }
    const path = decodeURIComponent(url.pathname); record.requests.push(`${route.request().method()} ${path}`);
    if (path === `/api/gcsp/offers/${selector.offerId}`) return json(route, 200, envelope);
    if (path === '/api/gcsp/manual/account') return json(route, 200, { status: 'ok', value: { state: 'ready', account } });
    if (path === '/api/gcsp/activity') return json(route, 200, { status: 'ok', value: { runId: selector.runId, offers: [], stateChanges: [], currentOffer: null } });
    const image = /^\/api\/gcsp\/vehicle-images\/(.+)\.webp$/.exec(path);
    if (image && imageFiles.has(image[1])) return readFile(join(ROOT, imageFiles.get(image[1]))).then((body) => route.fulfill({ status: 200, contentType: 'image/webp', body }));
    if (path.startsWith('/api/')) { record.unhandledApi = [...(record.unhandledApi ?? []), path]; return json(route, 404, { status: 'not-found' }); }
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${PORT}/gcsp-offer.html?offerId=${selector.offerId}&runId=${selector.runId}`, { waitUntil: 'load' });
  try { await page.waitForSelector('.gcsp-offer-comparison .vm-reasons', { timeout: 15000 }); } catch (error) {
    throw Error(`${error.message}\nbody: ${(await page.evaluate(() => document.body.innerText)).slice(0, 600)}\nrequests: ${record.requests.join(', ')}\nconsole: ${record.consoleErrors.join(' | ')}${record.pageErrors.join(' | ')}`);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((ok) => { img.onload = img.onerror = ok; }))));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
  await writeFile(join(OUT, `${name}-${width}.png`), png);
  const facts = await page.evaluate(() => {
    const root = document.querySelector('gcsp-offer');
    const box = (selector) => { const el = root.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; };
    const why = [...root.querySelectorAll('.vm-why-label')].filter((p) => p.textContent.trim() === 'Why it suits you');
    const lists = why.map((p) => p.nextElementSibling).filter((n) => n?.classList.contains('vm-reasons'));
    const reasons = lists.flatMap((ul) => [...ul.children].map((li) => li.textContent.trim()));
    const clone = root.cloneNode(true);
    const cloneWhy = [...clone.querySelectorAll('.vm-why-label')].filter((p) => p.textContent.trim() === 'Why it suits you');
    cloneWhy.forEach((p) => p.nextElementSibling?.classList.contains('vm-reasons') && p.nextElementSibling.remove());
    const textWithoutReasons = clone.innerText ?? clone.textContent;
    // innerText on a detached clone has no layout; use a hidden-free text walk instead.
    const walk = (node) => (node.nodeType === 3 ? node.textContent : [...node.childNodes].map(walk).join(' ')).replace(/\s+/g, ' ');
    return { reasons, whyLabelCount: why.length, bodyTextWithoutWhyLists: walk(clone).trim(), textWithoutReasons: undefined,
      imgs: [...root.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
      heading: root.querySelector('h1')?.textContent, scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth,
      pageHeight: document.documentElement.scrollHeight,
      boxes: { heading: box('h1'), countdown: box('.gcsp-countdown'), media: box('.gcsp-offer-exact .vm-card-media'),
        card: box('.gcsp-offer-exact'), comparison: box('.gcsp-offer-comparison table') ?? box('.gcsp-offer-comparison > :last-child'),
        reasonsList: box('.gcsp-offer-exact .vm-reasons'), afterColumns: box('.gcsp-offer-comparison + *') },
      fallbackSentence: root.textContent.includes("This car meets one of your scheme's checks.") };
  });
  await page.close();
  return { name, width, height, reason, png: `${name}-${width}.png`, ...facts, ...record };
}

async function main() {
  await mkdir(OUT, { recursive: true }); await mkdir(SCRATCH, { recursive: true });
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = join(SCRATCH, 'tmp'); await mkdir(process.env.TMPDIR, { recursive: true });
  const profile = join(SCRATCH, 'profile');
  const files = {}; let server; let context;
  const teardown = async () => {
    await context?.close().catch(() => {});
    await new Promise((ok) => (server ? server.close(ok) : ok()));
    try { const pids = execFileSync('pgrep', ['-f', profile], { encoding: 'utf8' }).split('\n').filter(Boolean);
      for (const pid of pids) process.kill(Number(pid), 'SIGKILL'); } catch { /* none left */ }
  };
  process.on('SIGALRM', () => { teardown().finally(() => process.exit(124)); });
  try {
    const old = await record({});
    const feedback = await record({ briefExtra: { currentCarRating: rating(5, 'current:employee-paula') }, carFacts: { modelLine: fact('G21 Touring') } });
    for (const [key, value] of [['envelope-old', old], ['envelope-feedback', feedback]]) {
      const text = `${JSON.stringify(value.envelope, null, 2)}\n`; await writeFile(join(OUT, `${key}.json`), text); files[`${key}.json`] = sha(text);
    }
    const catalogue = JSON.parse(await readFile(join(ROOT, 'server/data/gcsp/vehicle-evidence/display-images.v1.json'), 'utf8'));
    const imageFiles = new Map();
    for (const row of [...catalogue.configurations.map((r) => r.image), ...Object.values(catalogue.variants), ...Object.values(catalogue.models)]) if (row?.imageId) imageFiles.set(row.imageId, row.asset);

    server = await staticServer();
    const { chromium } = await import(PLAYWRIGHT);
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, deviceScaleFactor: 1,
      locale: 'en-GB', reducedMotion: 'reduce', colorScheme: 'light', viewport: { width: 1440, height: 1100 } });
    // Long-name variant: page-served rewrite of the exact car's name only.
    const original = feedback.envelope.value.quote.facts.display.name;
    const longEnvelope = JSON.parse(JSON.stringify(feedback.envelope).split(JSON.stringify(original).slice(1, -1)).join(LONG_NAME));
    // Improvement variant: page-served reason swap only, so the other feedback sentence is seen in place.
    const improved = JSON.parse(JSON.stringify(longEnvelope));
    improved.value.quote.decision.reasons = improved.value.quote.decision.reasons.map((r) => r.code === 'feedback-similar' ? { code: 'feedback-improvement', keys: ['sportiness', 'economy'] } : r);
    const variants = [{ name: 'old', ...old }, { name: 'feedback', ...feedback }, { name: 'feedback-longname', ...feedback, envelope: longEnvelope },
      { name: 'improvement-longname', ...feedback, envelope: improved, reason: 'Better than your current car for sportiness and economy.' }];
    const captures = [];
    for (const variant of variants) for (const [width, height] of VIEWPORTS) {
      captures.push(await capturePage(context, { ...variant, imageFiles, width, height }));
    }

    // ---------- Checks ----------
    const by = (name, width) => captures.find((c) => c.name === name && c.width === width);
    const checks = [];
    const add = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });
    const REASON = 'Similar to your current car, which you rated highly.'; const FALLBACK = "This car meets one of your scheme's checks.";
    for (const c of captures) {
      const tag = `${c.name}@${c.width}`;
      add(`${tag}: no horizontal overflow`, c.scrollWidth <= c.innerWidth, { scrollWidth: c.scrollWidth, innerWidth: c.innerWidth });
      const bad = c.consoleErrors.filter((m) => !/404/.test(m));
      add(`${tag}: no console/page errors other than 404s`, !bad.length && !c.pageErrors.length, { consoleErrors: c.consoleErrors, pageErrors: c.pageErrors });
      add(`${tag}: no fallback sentence`, !c.fallbackSentence && !c.reasons.includes(FALLBACK), c.reasons);
      const want = c.reason ?? REASON;
      add(`${tag}: reason ${c.name === 'old' ? 'absent' : 'present'}`, c.name === 'old' ? !c.reasons.includes(REASON) : c.reasons.includes(want), c.reasons);
      add(`${tag}: all images loaded`, c.imgs.every((i) => i.ok), c.imgs);
      add(`${tag}: no blocked external requests`, !c.blocked.length && !(c.unhandledApi ?? []).length, { blocked: c.blocked, unhandledApi: c.unhandledApi ?? [] });
    }
    const shifts = [];
    for (const [width] of VIEWPORTS) {
      const a = by('old', width); const b = by('feedback', width); if (!a || !b) continue;
      add(`old vs feedback@${width}: text outside Why-it-suits lists identical`, a.bodyTextWithoutWhyLists === b.bodyTextWithoutWhyLists,
        a.bodyTextWithoutWhyLists === b.bodyTextWithoutWhyLists ? 'identical' : { old: a.bodyTextWithoutWhyLists, feedback: b.bodyTextWithoutWhyLists });
      for (const key of ['heading', 'countdown', 'media']) {
        add(`old vs feedback@${width}: ${key} bounding box equal`, JSON.stringify(a.boxes[key]) === JSON.stringify(b.boxes[key]), { old: a.boxes[key], feedback: b.boxes[key] });
      }
      // The table may sit below the reasons when stacked: size and x must match; y may move only by the added reasons height.
      const [ca, cb] = [a.boxes.comparison, b.boxes.comparison]; const dy = cb.y - ca.y; const dh = b.boxes.reasonsList.h - a.boxes.reasonsList.h;
      add(`old vs feedback@${width}: comparison box equal in x/width/height, y moves only by the added reasons height`,
        ca.x === cb.x && ca.w === cb.w && ca.h === cb.h && (dy === 0 || dy === dh), { old: ca, feedback: cb, yShift: dy, reasonsHeightShift: dh });
      shifts.push({ width, pageHeightShift: b.pageHeight - a.pageHeight, cardHeightShift: (b.boxes.card?.h ?? 0) - (a.boxes.card?.h ?? 0),
        afterColumnsYShift: (b.boxes.afterColumns?.y ?? 0) - (a.boxes.afterColumns?.y ?? 0), reasonsHeightShift: (b.boxes.reasonsList?.h ?? 0) - (a.boxes.reasonsList?.h ?? 0) });
    }
    const results = { slice: 'FUCQ-371 C2 Offer visual comparison', capturedAt: new Date().toISOString(), allPassed: checks.every((c) => c.pass),
      envelopeSha256: files, offerIds: { old: old.selector, feedback: feedback.selector }, carName: original, longName: LONG_NAME,
      servedBy: `inline 127.0.0.1:${PORT} static server over worktree root`, yShifts: shifts, checks,
      captures: captures.map(({ bodyTextWithoutWhyLists, textWithoutReasons, ...c }) => c) };
    await writeFile(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify({ allPassed: results.allPassed, failed: checks.filter((c) => !c.pass).map((c) => c.id), shifts }));
  } finally { await teardown(); await rm(profile, { recursive: true, force: true }); }
}
main().catch((e) => { console.error(e); process.exit(1); });
