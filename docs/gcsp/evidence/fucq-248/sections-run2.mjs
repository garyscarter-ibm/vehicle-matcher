// FUCQ-248 run 2 walk sections (Greg, outbox, order progress, help and cases). Run with WALK_SECTIONS=sections-run2.mjs.
import { resetTo, switchTo } from './sections.mjs';

const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const h1 = (p) => p.locator('h1').first().innerText().catch(() => '');
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const focusNow = (p) => p.evaluate(() => { const e = document.activeElement; return `${e?.tagName}:${(e?.getAttribute('aria-label') || e?.textContent || '').trim().slice(0, 50)}`; });
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
const full = async (H, J, state, label, { tab = 60, reflow = true } = {}) => {
  await H.dump(label); await H.shot(J, state); await H.ariaDump(label);
  if (reflow) await H.reflow320(label);
  await H.tabWalk(label, tab);
};

export async function probe(H) {
  const p = H.page();
  await H.signIn();
  await resetTo(H, 'Decline then change', 'run2-greg', false, 'Greg');
  await closeStrip(p);
  for (const path of ['/gcsp-greg.html', '/gcsp-outbox.html', '/gcsp-help.html', '/gcsp-case-queue.html', '/gcsp-order-progress-live.html']) {
    await H.go(path); await H.wait(2500);
    const label = path.replace(/\W+/g, '-');
    H.note({ probe: path, h1: await h1(p), focus: await focusNow(p) });
    await H.dump(`probe${label}`);
  }
}

const controls = (loc) => loc.locator('button,select,input,summary,a[href],textarea').evaluateAll((els) => els.map((e) => `${e.tagName}${e.type ? `[${e.type}]` : ''}:${(e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.textContent || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 60)}${e.disabled ? ' (disabled)' : ''}`));
export async function probeGreg(H) {
  const p = H.page();
  await H.signIn();
  await resetTo(H, 'Decline then change', 'run2-greg', false, 'Greg');
  await closeStrip(p);
  await H.wait(2500);
  H.note({ h1: await h1(p), focus: await focusNow(p) });
  await H.dump('greg-live');
  H.note({ mainControls: await controls(p.locator('main')) });
  await H.openStrip();
  H.note({ stripControls: await controls(p.locator('.gcsp-presenter-controls')) });
}

const failures = (H) => H.page().on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) H.note({ failed: `${r.status()} ${r.request().method()} ${r.url().replace(H.origin, '')}` }); });
const region = (p, name) => p.getByRole('region', { name }).first();
async function view(H, J, state, loc) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(400); await H.page().evaluate(() => window.scrollBy(0, -80)); await H.shot(J, state, { full: false }); }
const regionText = async (loc, n = 1500) => (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, n);

// 10:00 to 12:00: Greg after Reset Decline then change. Dashboard, policy preview, next order, production, comparison, cases.
export async function greg(H) {
  const p = H.page(); const J = process.env.WALK_J || 'run2-greg';
  failures(H);
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Decline then change', 'run2-greg', false, 'Greg');
  await closeStrip(p); await H.wait(2000);
  H.note({ step: 'arrive', h1: await h1(p), focus: await focusNow(p) });
  await full(H, J, 'dashboard', 'dashboard', { tab: 150 });
  await view(H, J, 'top', p.locator('h1').first());
  // Policy preview
  const pol = region(p, 'Preview and publish policy');
  await view(H, J, 'policy', pol);
  const cost = p.getByRole('spinbutton', { name: 'Monthly points cost' });
  if (await cost.count()) { await cost.focus(); await cost.fill('900'); await kb(H, btn(p, 'Preview changes')); await H.wait(2500);
    H.note({ step: 'policy-preview', focus: await focusNow(p), text: await regionText(pol, 2500) }); await view(H, J, 'policy-preview', pol); }
  // Next order plan
  const plan = region(p, 'Next order plan');
  H.note({ step: 'plan', text: await regionText(plan, 800) });
  if (await plan.getByRole('button', { name: 'Retry' }).count()) { await kb(H, plan.getByRole('button', { name: 'Retry' })); await H.wait(3000); H.note({ step: 'plan-retry', text: await regionText(plan, 800), focus: await focusNow(p) }); }
  await view(H, J, 'next-order', plan);
  const min = plan.getByRole('spinbutton', { name: /Min/ }).first();
  if (await min.count()) {
    await min.focus(); await min.fill('2');
    await kb(H, plan.getByRole('button', { name: 'Preview with these limits' })); await H.wait(3000);
    H.note({ step: 'plan-preview', focus: await focusNow(p), text: await regionText(plan, 2500) });
    await view(H, J, 'next-order-preview', plan);
    const req = plan.getByRole('button', { name: /from Production/ }).first();
    H.note({ submit: await req.innerText().catch(() => 'none'), enabled: await req.isEnabled().catch(() => null) });
    if (await req.isEnabled().catch(() => false)) { await kb(H, req); await H.wait(3000); H.note({ step: 'plan-submitted', focus: await focusNow(p), text: await regionText(plan, 1500) }); await view(H, J, 'next-order-submitted', plan); }
  }
  // Order requests and synthetic production
  const orders = p.locator('.gcsp-orders-host').first();
  H.note({ step: 'orders', text: await regionText(orders, 1500) });
  await view(H, J, 'orders', orders);
  const sum = p.locator('summary', { hasText: 'Synthetic production controls' }).first();
  if (await sum.count()) {
    await kb(H, sum); await H.wait(800);
    const reqSel = p.getByRole('combobox', { name: 'Request' });
    const opts = await reqSel.locator('option').allInnerTexts().catch(() => []);
    H.note({ productionRequestOptions: opts, disabled: await reqSel.isDisabled().catch(() => null) });
    if (!(await reqSel.isDisabled().catch(() => true)) && opts.length > 0) {
      await reqSel.selectOption({ index: opts.length > 1 ? 1 : 0 }).catch(() => {});
      const resp = p.getByRole('combobox', { name: 'Production response' });
      H.note({ responseOptions: await resp.locator('option').allInnerTexts().catch(() => []), saveEnabled: await btn(p, 'Save production response').isEnabled().catch(() => null) });
      await view(H, J, 'production-controls', sum);
      await kb(H, btn(p, 'Save production response')); await H.wait(3500);
      H.note({ step: 'production-saved', focus: await focusNow(p), orders: await regionText(orders, 1500), plan: await regionText(plan, 1200) });
      await view(H, J, 'production-saved', orders); await view(H, J, 'next-order-after-production', plan);
    } else await view(H, J, 'production-controls', sum);
  }
  // Route comparison and experiments
  const cmp = region(p, 'Route comparison');
  await view(H, J, 'comparison', cmp);
  const exp = cmp.getByRole('button', { name: /Order mix/ }).first();
  if (await exp.count()) { await kb(H, exp); await H.wait(1500); H.note({ step: 'experiment', focus: await focusNow(p), text: await regionText(cmp, 1000) }); await view(H, J, 'comparison-order-mix', cmp); }
  const cases = region(p, 'Renewal cases');
  H.note({ step: 'cases', text: await regionText(cases, 600) });
  await view(H, J, 'cases', cases);
  await H.dump('dashboard-end'); await H.shot(J, 'dashboard-end');
}

export async function probePlan(H) {
  const p = H.page();
  await H.signIn();
  for (const sc of ['Decline then change', 'Main successful journey']) {
    await resetTo(H, sc, 'run2-greg', false, 'Greg'); await closeStrip(p); await H.wait(1500);
    const body = await p.evaluate(async () => { const r = await fetch('/api/gcsp/greg/order-plan', { credentials: 'include', cache: 'no-store' }); return `${r.status} ${(await r.text()).slice(0, 600)}`; });
    H.note({ scenario: sc, plan: body });
  }
}

// Fixture-only Greg states the live offline run can't reach: stored comparison, experiments, plan edge states, a populated case queue.
export async function gregFixtures(H) {
  const p = H.page(); const J = 'run2-greg-fixture';
  failures(H);
  await H.signIn();
  const cmpAt = async (name) => { await H.go(`/gcsp-greg.html?comparison=${name}`); await H.wait(1500); return region(p, 'Route comparison'); };
  let cmp = await cmpAt('buddy-better');
  H.note({ step: 'cmp-buddy-better', text: await regionText(cmp, 2500) });
  await view(H, J, 'comparison-buddy-better', cmp);
  const det = cmp.locator('summary').first();
  if (await det.count()) { await kb(H, det); await H.wait(600); await H.shot(J, 'comparison-assumptions-open'); H.note({ assumptions: await regionText(cmp, 3500) }); }
  await H.ariaDump('comparison'); await H.tabWalk('comparison', 80);
  for (const name of ['no-clear-difference', 'experiments-ready', 'job-running', 'job-fails']) {
    cmp = await cmpAt(name); H.note({ step: `cmp-${name}`, text: await regionText(cmp, 1500) }); await view(H, J, `comparison-${name}`, cmp);
  }
  for (const name of ['infeasible', 'stale', 'learned']) {
    await H.go(`/gcsp-greg.html?plan=${name}`); await H.wait(1500);
    const plan = region(p, 'Next order plan'); H.note({ step: `plan-${name}`, text: await regionText(plan, 1500) }); await view(H, J, `plan-${name}`, plan);
  }
  await H.go('/gcsp-case-queue.html?fixture=populated'); await H.wait(1500);
  H.note({ step: 'queue', h1: await h1(p), focus: await focusNow(p), controls: (await controls(p.locator('body'))).slice(0, 40) });
  await full(H, J, 'case-queue', 'case-queue', { tab: 60 });
  const open = p.locator('button,summary,a[href]', { hasText: /Review|Open|Choose|Propose|remedy/i }).first();
  if (await open.count()) {
    H.note({ open: await open.innerText() }); await kb(H, open); await H.wait(1200);
    H.note({ step: 'queue-open', focus: await focusNow(p), controls: (await controls(p.locator('body'))).slice(0, 40) });
    await H.dump('case-open'); await H.shot(J, 'case-queue-open');
  }
  await H.go('/gcsp-greg.html'); await H.wait(1500);
  await H.dump('harness-populated'); await H.shot(J, 'harness-populated-top', { full: false });
}

async function tickTo(H, target) {
  const p = H.page(); await H.openStrip();
  const f = p.locator('.gcsp-presenter-controls input[type=text]').first(); await f.scrollIntoViewIfNeeded(); await f.fill(target); H.note({ tickTarget: target, value: await f.inputValue() });
  await H.press('Tick to target'); await closeStrip(p);
}
// Paula, live, Main successful journey: release to offer on Buddy activity, the email in the outbox, accept,
// order progress to a booked handover, documents and return, then help.
export async function paula(H) {
  const p = H.page();
  failures(H);
  await H.signIn();
  await resetTo(H, 'Main successful journey', 'run2-paula', false, 'Paula');
  await closeStrip(p);
  await H.go('/gcsp-activity-live.html'); await H.wait(1500);
  H.note({ step: 'activity-before', h1: await h1(p), focus: await focusNow(p) });
  await H.dump('activity-before'); await H.shot('run2-activity', 'before-release');
  await H.press('Next release'); await closeStrip(p);
  H.note({ step: 'activity-no-reload', text: H.clip(await H.text(), 600) });
  await H.shot('run2-activity', 'after-release-no-reload', { full: false });
  await p.reload(); await H.wait(2500);
  H.note({ step: 'activity-after', h1: await h1(p), focus: await focusNow(p) });
  await full(H, 'run2-activity', 'found-a-car', 'activity-found', { tab: 40 });
  // Outbox
  await H.go('/gcsp-outbox.html'); await H.wait(2000);
  H.note({ step: 'outbox', h1: await h1(p), focus: await focusNow(p), controls: (await controls(p.locator('main'))).slice(0, 20) });
  await full(H, 'run2-outbox', 'list', 'outbox-list', { tab: 30 });
  const msg = p.locator('main button', { hasText: 'Paula (fictional)' }).last();
  if (await msg.count()) {
    await kb(H, msg); await H.wait(1500);
    H.note({ step: 'outbox-open', focus: await focusNow(p), links: await p.locator('main a[href]').evaluateAll((a) => a.map((x) => `${x.textContent.trim().slice(0, 40)} -> ${x.getAttribute('href').slice(0, 60)}`)) });
    await full(H, 'run2-outbox', 'message', 'outbox-message', { tab: 40 });
  }
  // Offer from the email link if there is one, else the activity link.
  const mail = p.locator('main a[href*="offer"]').first();
  if (await mail.count()) { await kb(H, mail); await H.wait(2500); H.note({ step: 'offer-from-email', url: p.url().replace(H.origin, '').slice(0, 60), h1: await h1(p), pages: p.context().pages().length }); }
  if (!/offer/.test(p.url())) { await H.go('/gcsp-activity-live.html'); await kb(H, p.getByRole('link', { name: /View offer|Open the offer/i }).first()); await H.wait(2500); }
  const boxes = p.locator('input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await kb(H, btn(p, /^Accept/, false).first()); await H.wait(2500);
  H.note({ step: 'accepted', h1: await h1(p) });
  // Order progress
  const op = async (state, label = state) => { await H.go('/gcsp-order-progress-live.html'); await H.wait(1500); H.note({ step: `op-${label}`, h1: await h1(p), focus: await focusNow(p), text: H.clip((await H.text()).split('Order progress').slice(2).join(' '), 900) }); await H.dump(`op-${label}`); await H.shot('run2-order', state); };
  await op('accepted'); await H.ariaDump('op-accepted'); await H.reflow320('op-accepted'); await H.tabWalk('op-accepted', 40);
  for (let i = 0; i < 6; i += 1) await H.press(/^Tick \(/, { settle: 800 });
  await closeStrip(p);
  await op('approvals-done');
  const slot = p.getByRole('button', { name: /^Request \d/ }).first();
  H.note({ slots: await p.getByRole('button', { name: /^Request \d/ }).allInnerTexts().catch(() => []) });
  if (await slot.count()) {
    await kb(H, slot); await H.wait(2000);
    H.note({ step: 'slot-requested', focus: await focusNow(p), live: await p.locator('[role=status],[aria-live]').allInnerTexts().catch(() => []) });
    await H.shot('run2-order', 'handover-requested');
    await tickTo(H, '2026-11-05T10:07:00.000Z');
    await op('handover-booked'); await H.ariaDump('op-booked'); await H.tabWalk('op-booked', 50);
    const ack = btn(p, 'Acknowledge the agreement');
    if (await ack.count()) { await kb(H, ack); await H.wait(2000); H.note({ step: 'ack', focus: await focusNow(p) }); await H.shot('run2-order', 'agreement-acknowledged'); }
    await tickTo(H, '2026-11-07T09:37:00.000Z');
    await op('ready-for-handover');
    const ret = p.getByRole('button', { name: /^Request return/ }).first();
    if (await ret.count()) { await kb(H, ret); await H.wait(2000); H.note({ step: 'return-requested', focus: await focusNow(p) }); await H.shot('run2-order', 'return-requested'); }
  }
  // Help and case view
  await H.go('/gcsp-help.html'); await H.wait(2000);
  H.note({ step: 'help', h1: await h1(p), focus: await focusNow(p), controls: (await controls(p.locator('body'))).slice(0, 40) });
  await full(H, 'run2-help', 'help', 'help', { tab: 40 });
}

async function fillForm(H, scope) {
  const p = H.page();
  for (const s of await scope.locator('select:visible:enabled').all()) { const v = await s.locator('option').evaluateAll((o) => o.find((x) => x.value && !x.disabled)?.value); if (v) await s.selectOption(v); }
  for (const t of await scope.locator('textarea:visible:enabled, input[type=text]:visible:enabled').all()) if (!(await t.inputValue())) await t.fill('My replacement may miss my contract end.');
  for (const c of await scope.locator('input[type=checkbox]:visible:enabled').all()) if (!(await c.isChecked())) { await c.focus(); await p.keyboard.press('Space'); }
  for (const r of await scope.locator('input[type=radio]:visible:enabled').all()) { await r.focus(); await p.keyboard.press('Space'); break; }
  for (const d of await scope.locator('input[type=datetime-local]:visible:enabled').all()) if (!(await d.inputValue())) await d.fill('2026-11-06T09:00');
}
// Paula asks for renewal help; Greg works the case in his queue with a remedy; Paula sees it in her case view.
export async function helpCase(H) {
  const p = H.page(); const J = 'run2-help';
  failures(H);
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'No suitable match', 'run2-help', false, 'Paula');
  await closeStrip(p);
  await H.go('/gcsp-help.html'); await H.wait(1500);
  const main = p.locator('main');
  const sum = main.locator('summary', { hasText: 'Get help' }).first();
  if (await sum.count()) { await kb(H, sum); await H.wait(600); }
  H.note({ step: 'help-open', focus: await focusNow(p), controls: await controls(main), text: await regionText(main, 1200) });
  await H.shot(J, 'request-form'); await H.ariaDump('help-form'); await H.tabWalk('help-form', 30);
  for (let i = 0; i < 4; i += 1) {
    const next = main.locator('button:visible:enabled', { hasText: /^(Ask for help|Review help request|Send|Send help request|Send request|Confirm|Submit)/ }).first();
    if (!(await next.count())) break;
    const label = await next.innerText();
    if (i === 1) { await kb(H, next); await H.wait(1200); H.note({ step: 'help-empty-submit', focus: await focusNow(p), text: await regionText(main, 600) }); await H.shot(J, 'request-validation', { full: false }); }
    await fillForm(H, main); await kb(H, next); await H.wait(2000);
    H.note({ step: `help-${i}`, label, focus: await focusNow(p), text: await regionText(main, 1200), controls: await controls(main) });
    await H.shot(J, `request-step-${i}`, { full: false });
  }
  await full(H, J, 'case-open', 'help-case', { tab: 40 });
  // Greg's queue
  await switchTo(H, 'Greg', J); await closeStrip(p); await H.wait(1500);
  const q = region(p, 'Renewal cases');
  H.note({ step: 'queue', text: await regionText(q, 1500), controls: await controls(q) });
  await view(H, 'run2-greg-cases', 'queue', q);
  const pick = q.getByRole('combobox', { name: 'Case to work' });
  if (await pick.count()) { await pick.focus(); await pick.selectOption({ index: 1 }); await kb(H, q.getByRole('button', { name: 'Open selected case' })); await H.wait(2000);
    H.note({ step: 'case-opened', focus: await focusNow(p), text: await regionText(q, 2500), controls: await controls(q) });
    await view(H, 'run2-greg-cases', 'case-detail', q); await H.ariaDump('greg-case'); }
  for (let i = 0; i < 3; i += 1) {
    if (i === 0) { const st = q.getByRole('combobox', { name: 'Next case status' }); if (await st.count()) await st.selectOption({ label: 'In progress' }).catch(() => {}); const rm = q.getByRole('combobox', { name: 'Remedy to record' }); if (await rm.count()) { H.note({ remedyOptions: await rm.locator('option').evaluateAll((o) => o.map((x) => `${x.disabled ? '[x] ' : ''}${x.textContent.trim().slice(0, 120)}`)) }); await rm.selectOption({ label: 'Manual decision' }).catch(() => {}); await H.wait(500); } }
    const act = q.locator('button:visible:enabled', { hasText: /^(Review case update|Confirm case update|Confirm|Save)/ }).first();
    if (!(await act.count())) break;
    const label = await act.innerText(); await fillForm(H, q); await kb(H, act); await H.wait(2000);
    H.note({ step: `case-action-${i}`, label, focus: await focusNow(p), text: await regionText(q, 1500), controls: await controls(q) });
    await view(H, 'run2-greg-cases', `case-after-${label.replace(/\W+/g, '-').toLowerCase().slice(0, 24)}`, q);
  }
  await switchTo(H, 'Paula', J); await closeStrip(p);
  await H.go('/gcsp-help.html'); await H.wait(1500);
  H.note({ step: 'paula-case', text: await regionText(p.locator('main'), 1500), controls: await controls(p.locator('main')) });
  await full(H, J, 'case-with-remedy', 'help-remedy', { tab: 40 });
}

// Run 1 gaps, live through the presenter scenarios: no match, data unavailable, offer expired, uncertain handoff.
export async function gaps(H) {
  const p = H.page(); const J = 'run2-gaps';
  failures(H);
  await H.signIn();
  const toActivity = async () => { await H.go('/gcsp-activity-live.html'); await H.wait(1200); };
  const release = async () => { await H.openStrip(); if (await btn(p, 'Next release').isEnabled().catch(() => false)) await H.press('Next release'); await closeStrip(p); };
  const openOffer = async () => { const l = p.getByRole('link', { name: /View offer|Open the offer/i }).first(); if (await l.count()) { await kb(H, l); await H.wait(2500); return true; } return false; };
  const step = async (name, fn) => { try { await fn(); } catch (e) { H.note({ gapError: name, msg: H.clip(e.message, 300) }); } };
  await step('no-match', async () => {
    await resetTo(H, 'No suitable match', J, false, 'Paula'); await closeStrip(p); await release(); await toActivity();
    H.note({ step: 'no-match', h1: await h1(p), text: H.clip(await regionText(p.locator('main'), 900)) }); await H.shot(J, 'no-match-activity');
    await H.go('/gcsp-account.html'); await H.wait(1500); H.note({ step: 'no-match-account', text: H.clip(await regionText(p.locator('main'), 700)) }); await H.shot(J, 'no-match-account', { full: false });
  });
  await step('data-unavailable', async () => {
    await resetTo(H, 'Data unavailable', J, false, 'Paula'); await closeStrip(p); await release(); await toActivity();
    H.note({ step: 'data-unavailable', text: H.clip(await regionText(p.locator('main'), 900)) }); await H.shot(J, 'data-unavailable-activity');
  });
  await step('expired', async () => {
    await resetTo(H, 'Offer expires', J, false, 'Paula'); await closeStrip(p); await release(); await toActivity();
    H.note({ step: 'expiring', text: H.clip(await regionText(p.locator('main'), 600)) });
    await tickTo(H, '2026-11-05T11:31:00.000Z'); await toActivity();
    H.note({ step: 'expired-activity', text: H.clip(await regionText(p.locator('main'), 900)) }); await H.shot(J, 'expired-activity');
    if (await openOffer()) { H.note({ step: 'expired-offer', h1: await h1(p), focus: await focusNow(p), text: H.clip(await regionText(p.locator('main'), 900)) }); await H.shot(J, 'expired-offer'); await H.tabWalk('expired-offer', 20); }
  });
  await step('uncertain', async () => {
    await resetTo(H, 'Uncertain handoff, rejected', J, false, 'Paula'); await closeStrip(p); await release(); await toActivity();
    if (await openOffer()) {
      const boxes = p.locator('input[type="checkbox"]'); for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
      await kb(H, btn(p, /^Accept/, false).first()); await H.wait(3000);
      H.note({ step: 'uncertain-accepted', h1: await h1(p), focus: await focusNow(p), text: H.clip(await regionText(p.locator('main'), 1200)) }); await H.shot(J, 'uncertain-after-accept');
      await H.press(/^Tick \(/); await closeStrip(p); await p.reload(); await H.wait(2500);
      H.note({ step: 'uncertain-after-tick', h1: await h1(p), text: H.clip(await regionText(p.locator('main'), 1200)) }); await H.shot(J, 'uncertain-after-tick');
    }
  });
  await H.go('/gcsp-order-progress.html?fixture=appointment-completed'); await H.wait(1500);
  H.note({ step: 'op-completed-fixture', h1: await h1(p), text: H.clip(await regionText(p.locator('body'), 900)) }); await H.shot('run2-order-fixture', 'appointment-completed'); await H.ariaDump('op-completed');
  await H.go('/gcsp-order-progress.html?fixture=return-handover-complete'); await H.wait(1500); await H.shot('run2-order-fixture', 'return-handover-complete');
}
