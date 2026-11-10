// UX revamp review, 10 Nov: Greg's dashboard, case queue, orders, outbox and presenter flyout. Run with walk-greg.mjs.

const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const h1 = (p) => p.locator('h1').first().innerText().catch(() => '');
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const focusNow = (p) => p.evaluate(() => { const e = document.activeElement; return `${e?.tagName}:${(e?.getAttribute('aria-label') || e?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)}`; });
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const idle = (H) => until(H, async () => !/Action in progress/.test(await H.page().locator('.gcsp-presenter-controls').innerText()), 'presenter action', 60000);
// Flyout-era reset and switch: principals are labelled "<name> (<role>)".
async function resetTo(H, scenario, _j, _c, principal = 'Paula') {
  const p = H.page(); await H.openStrip();
  await p.locator('.gcsp-presenter-controls button[role=radio]', { hasText: scenario }).first().click();
  await btn(p, 'Reset scenario').click(); await H.wait(500); await btn(p, 'Confirm reset').click(); await idle(H); await H.wait(1500);
  const cont = btn(p, 'Continue to workspace'); if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  if (principal) await switchTo(H, principal);
}
async function switchTo(H, who) {
  const p = H.page(); await H.openStrip();
  const opt = p.locator('.gcsp-presenter-controls button[role=radio]', { hasText: who }).filter({ hasNotText: '(presenter)' }).first();
  H.note({ switchOption: await opt.innerText().catch(() => 'none') }); await opt.click();
  const sw = btn(p, 'Switch principal'); if (await sw.isEnabled().catch(() => false)) { await sw.click(); await idle(H); await H.wait(2500); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { H.note({ reloadPrompt: true }); await p.reload(); await H.wait(2500); }
}
const flyoutOpen = (p) => p.evaluate(() => !document.querySelector('.gcsp-presenter-flyout')?.hidden).catch(() => false);
const closeFlyout = async (p) => { if (await flyoutOpen(p)) await p.locator('.gcsp-presenter-flyout-close').click().catch(() => {}); await p.waitForTimeout(300); };
const region = (p, name) => p.getByRole('region', { name }).first();
const txt = async (loc, n = 1500) => (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, n);

// Busyness: boxed regions (border on 3+ sides or a tinted fill), deepest box nesting, headings, buttons, prose lines, words.
async function busy(H, label, loc) {
  const m = await loc.evaluate((root) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const page = getComputedStyle(document.body).backgroundColor;
    const isBox = (e) => { const s = getComputedStyle(e); if (['TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'svg', 'path', 'A', 'SUMMARY', 'LABEL', 'SPAN', 'IFRAME', 'IMG', 'OPTION'].includes(e.tagName)) return false;
      const b = ['Top', 'Right', 'Bottom', 'Left'].filter((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== 'none').length;
      const bg = s.backgroundColor; const tinted = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== page && bg !== 'rgb(255, 255, 255)';
      const r = e.getBoundingClientRect(); return (b >= 3 || tinted) && r.width > 60 && r.height > 24; };
    const all = [root, ...root.querySelectorAll('*')].filter(vis);
    const boxes = all.filter(isBox);
    const depth = (e) => { let d = 0; for (let n = e; n && n !== root.parentElement; n = n.parentElement) if (boxes.includes(n)) d += 1; return d; };
    const prose = all.filter((e) => ['P', 'LI', 'DD'].includes(e.tagName) && !e.closest('table'));
    const lines = prose.reduce((t, e) => { const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; return t + Math.max(1, Math.round(e.getBoundingClientRect().height / lh)); }, 0);
    const words = (root.innerText || '').split(/\s+/).filter(Boolean).length;
    const tinted = boxes.filter((e) => { const bg = getComputedStyle(e).backgroundColor; return bg !== 'rgba(0, 0, 0, 0)' && bg !== page && bg !== 'rgb(255, 255, 255)'; }).map((e) => `${e.tagName}.${String(e.className).split(' ')[0]} ${getComputedStyle(e).backgroundColor}`);
    const btns = all.filter((e) => ['BUTTON', 'SUMMARY'].includes(e.tagName) || (e.tagName === 'A' && /vm-btn/.test(e.className)));
    const primary = btns.filter((e) => /primary/.test(e.className)).map((e) => e.textContent.trim().slice(0, 40));
    const heads = all.filter((e) => /^H[1-6]$/.test(e.tagName)).map((e) => `${e.tagName}:${e.textContent.trim().slice(0, 40)}`);
    const tables = all.filter((e) => e.tagName === 'TABLE').length;
    const repeated = (() => { const c = {}; for (const e of prose) { const t = e.textContent.trim(); if (t.length > 30) c[t] = (c[t] || 0) + 1; } return Object.entries(c).filter(([, n]) => n > 1).map(([t, n]) => `${n}x ${t.slice(0, 70)}`); })();
    return { boxes: boxes.length, maxDepth: Math.max(0, ...boxes.map(depth)), tinted: tinted.slice(0, 8), headings: heads.length, headingList: heads.slice(0, 30),
      buttons: btns.length, primary, buttonList: btns.map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 36)).slice(0, 40), tables, proseLines: lines, words,
      height: Math.round(root.getBoundingClientRect().height), repeated: repeated.slice(0, 8) };
  }).catch((e) => ({ error: e.message }));
  H.note({ busy: label, ...m });
  return m;
}
// Small touch targets in a scope (phone), and whether focus fell to BODY.
async function targets(H, label, loc) {
  const t = await loc.evaluate((root) => [...root.querySelectorAll('a[href],button,input,select,summary,textarea')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 24) && !['checkbox', 'radio'].includes(e.type) && !(e.tagName === 'A' && getComputedStyle(e).display === 'inline'); })
    .map((e) => `${e.tagName} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`)).catch(() => []);
  H.note({ targets: label, small: t.length, list: t.slice(0, 15) });
}
const bodyFocus = async (H, step) => { const f = await focusNow(H.page()); H.note({ focusAfter: step, focus: f, lost: /^BODY|^null|^undefined/.test(f) }); };
async function view(H, J, state, loc) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(400); await H.page().evaluate(() => window.scrollBy(0, -70)); await H.shot(J, state, { full: false, audit: false }); }
const regionShot = async (H, J, state, loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(300); n2 += 1; const file = `${J}-${H.W}-r${String(n2).padStart(2, '0')}-${state}.png`; await loc.screenshot({ path: new URL(file, import.meta.url).pathname }).catch((e) => H.note({ regionShotError: e.message })); H.note({ regionShot: file }); };
let n2 = 0;

async function asGreg(H, scenario = 'Decline then change') {
  const p = H.page();
  await H.signIn();
  await resetTo(H, scenario, 'greg', false, 'Greg');
  await closeFlyout(p); await H.wait(2500);
}

// 10:00 beat: Greg after Reset Decline then change. Dashboard regions, policy preview, next order, production, comparison, cases.
export async function dashboard(H) {
  const p = H.page(); const J = 'greg-dashboard';
  await asGreg(H);
  H.note({ arrive: await h1(p), focus: await focusNow(p), url: p.url().replace(H.origin, '') });
  await H.dump('dashboard');
  await H.shot(J, 'arrival', { full: false, audit: false });
  await H.shot(J, 'full', { audit: false });
  await busy(H, 'page-main', p.locator('main'));
  const sections = await p.locator('main section, main [role=region]').evaluateAll((s) => s.map((x) => ({ label: x.getAttribute('aria-label') || x.querySelector('h2,h3')?.textContent?.trim() || x.className, top: Math.round(x.getBoundingClientRect().top + scrollY), h: Math.round(x.getBoundingClientRect().height), depth: (() => { let d = 0; for (let n = x.parentElement; n; n = n.parentElement) if (n.tagName === 'SECTION' || n.getAttribute?.('role') === 'region') d += 1; return d; })() })));
  H.note({ sectionMap: sections.filter((s) => s.depth === 0 || s.depth === 1).slice(0, 40) });
  const named = ['At a glance', 'Demand', 'Unmet needs', 'Stock', 'Offers'];
  for (const name of named) { const s = p.locator('main section').filter({ has: p.locator('h2', { hasText: new RegExp(`^${name}$`) }) }).first(); if (await s.count()) { await busy(H, name, s); await regionShot(H, J, name.toLowerCase().replace(/\W+/g, '-'), s); } }
  for (const name of ['Preview and publish policy', 'Next order plan', 'Route comparison', 'Renewal cases']) { const r = region(p, name); if (await r.count()) { await busy(H, name, r); await regionShot(H, J, name.toLowerCase().replace(/\W+/g, '-'), r); } }
  const orders = p.locator('.gcsp-orders-host').first(); if (await orders.count()) { await busy(H, 'Order requests', orders); await regionShot(H, J, 'order-requests', orders); }
  // Rail wayfinding: what each Greg nav item does.
  for (const name of ['Publish stock', 'Order tracking', 'Next order', 'Demand and supply']) {
    const item = p.locator('nav[aria-label="Portal"] button, nav[aria-label="Portal"] a').filter({ hasText: name }).first();
    if (!(await item.count())) { H.note({ nav: name, missing: true }); continue; }
    const before = await p.evaluate(() => scrollY);
    await item.click().catch((e) => H.note({ navErr: e.message })); await H.wait(1200);
    H.note({ nav: name, url: p.url().replace(H.origin, ''), scrolledFrom: before, scrolledTo: await p.evaluate(() => scrollY), focus: await focusNow(p), disabled: await item.isDisabled().catch(() => null) });
  }
  await H.tabWalk('dashboard', 40);
}

export async function actions(H) {
  const p = H.page(); const J = 'greg-actions';
  await asGreg(H);
  // Policy preview
  const pol = region(p, 'Preview and publish policy');
  await view(H, J, 'policy', pol);
  const cost = p.getByRole('spinbutton', { name: 'Monthly points cost' }).first();
  if (await cost.count()) { await cost.focus(); await cost.fill('900'); await kb(H, btn(p, 'Preview changes')); await H.wait(2500);
    await bodyFocus(H, 'policy-preview'); await busy(H, 'policy-preview', pol); H.note({ policyPreview: await txt(pol, 2000) }); await regionShot(H, J, 'policy-preview', pol); }
  const src = pol.locator('summary', { hasText: /Sources/ }).first();
  if (await src.count()) { await kb(H, src); await busy(H, 'policy-sources-open', pol); await regionShot(H, J, 'policy-sources-open', pol); }
  // Next order
  const plan = region(p, 'Next order plan');
  H.note({ planText: await txt(plan, 1500) });
  await regionShot(H, J, 'next-order', plan);
  const lim = plan.locator('summary', { hasText: 'Change limits' }).first();
  if (await lim.count()) { await kb(H, lim); await regionShot(H, J, 'next-order-limits-open', plan); await busy(H, 'next-order-limits-open', plan); }
  const min = plan.getByRole('spinbutton', { name: /Min/ }).first();
  if (await min.count()) {
    await min.focus(); await min.fill('2');
    await kb(H, plan.getByRole('button', { name: 'Preview with these limits' })); await H.wait(3000);
    await bodyFocus(H, 'plan-preview'); H.note({ planPreview: await txt(plan, 2000) }); await busy(H, 'next-order-preview', plan);
    await regionShot(H, J, 'next-order-preview', plan);
    const req = plan.getByRole('button', { name: /from Production/ }).first();
    if (await req.isEnabled().catch(() => false)) { await kb(H, req); await H.wait(3500); await bodyFocus(H, 'plan-request'); H.note({ planRequested: await txt(plan, 1500) }); await regionShot(H, J, 'next-order-requested', plan); }
  }
  const orders = p.locator('.gcsp-orders-host').first();
  H.note({ ordersText: await txt(orders, 1500) }); await regionShot(H, J, 'orders-requested', orders);
  const sum = orders.locator('summary').filter({ hasText: /Production controls/ }).first();
  if (await sum.count()) {
    await kb(H, sum);
    const reqSel = p.getByRole('combobox', { name: 'Request' });
    const opts = await reqSel.locator('option').allInnerTexts().catch(() => []);
    if (opts.length) await reqSel.selectOption({ index: opts.length > 1 ? 1 : 0 }).catch(() => {});
    await regionShot(H, J, 'production-controls', orders); await busy(H, 'orders-production-open', orders);
    if (await btn(p, 'Save production response').isEnabled().catch(() => false)) {
      await kb(H, btn(p, 'Save production response')); await H.wait(3500); await bodyFocus(H, 'production-saved');
      H.note({ afterProduction: { orders: await txt(orders, 1200), plan: await txt(plan, 1200) } });
      await regionShot(H, J, 'orders-after-production', orders); await regionShot(H, J, 'next-order-replanned', plan); await busy(H, 'next-order-replanned', plan);
    }
  }
  await H.shot(J, 'dashboard-after-actions', { audit: false });
}

// 12:00 beat: route comparison with the stored result loaded (WALK_COMPARISON), assumptions expanded.
export async function comparison(H) {
  const p = H.page(); const J = 'greg-comparison';
  await asGreg(H);
  const cmp = region(p, 'Route comparison');
  H.note({ cmpText: await txt(cmp, 3000) });
  await busy(H, 'comparison', cmp); await regionShot(H, J, 'result', cmp); await view(H, J, 'result-viewport', cmp);
  const det = cmp.locator('summary', { hasText: /Assumptions/ }).first();
  if (await det.count()) { await kb(H, det); await busy(H, 'comparison-assumptions', cmp); await regionShot(H, J, 'assumptions-open', cmp); }
  const exp = cmp.getByRole('radio').nth(1);
  if (await exp.count()) { await exp.focus(); await p.keyboard.press('Space'); await H.wait(1500); await bodyFocus(H, 'experiment'); H.note({ expText: await txt(cmp, 1200) }); await regionShot(H, J, 'experiment-order-mix', cmp); }
}

// Case queue: standalone populated fixture (the live run has no cases until Paula asks), then the embedded live state.
export async function queue(H) {
  const p = H.page(); const J = 'greg-cases';
  await asGreg(H); // the host serves /gcsp-case-queue.html only to a Greg session
  const live = region(p, 'Renewal cases'); H.note({ liveCases: await txt(live, 600) }); await regionShot(H, J, 'embedded-live', live);
  await H.go('/gcsp-case-queue.html'); await H.wait(1500); H.note({ standaloneLive: await h1(p), url: p.url().replace(H.origin, '') }); await H.shot(J, 'standalone-live', { full: false, audit: false });
  await H.go('/gcsp-case-queue.html?fixture=populated'); await H.wait(1500);
  H.note({ queue: await h1(p), focus: await focusNow(p) });
  await H.dump('case-queue'); await H.shot(J, 'queue-populated', { audit: false });
  await busy(H, 'queue', p.locator('main'));
  const open = p.getByRole('button', { name: /^Open/ }).first();
  if (await open.count()) { await kb(H, open); await bodyFocus(H, 'case-open'); await H.dump('case-open'); await H.shot(J, 'case-open', { audit: false }); await busy(H, 'case-open', p.locator('main')); }
  const rev = btn(p, 'Review case update');
  if (await rev.count()) { await kb(H, rev); await bodyFocus(H, 'case-review-empty'); await H.shot(J, 'case-review', { full: false, audit: false }); }
  await H.go('/gcsp-case-queue.html?fixture=empty'); await H.wait(1200); await H.shot(J, 'queue-empty', { full: false, audit: false }); await busy(H, 'queue-empty', p.locator('main'));
}

// Outbox: Main successful journey, Paula, Next release, then the captured offer email.
export async function outbox(H) {
  const p = H.page(); const J = 'greg-outbox';
  await H.signIn();
  await resetTo(H, 'Main successful journey', 'outbox', false, 'Paula');
  await closeFlyout(p);
  await H.go('/gcsp-outbox.html'); await H.wait(1500); await H.shot(J, 'empty', { full: false, audit: false }); await busy(H, 'outbox-empty', p.locator('main'));
  await H.press('Next release'); await closeFlyout(p);
  await H.go('/gcsp-outbox.html'); await H.wait(2500);
  H.note({ outbox: await h1(p), focus: await focusNow(p) });
  await H.dump('outbox-list'); await H.shot(J, 'list', { audit: false }); await busy(H, 'outbox-list', p.locator('main'));
  const msg = p.locator('main button').filter({ hasText: /offer|car|Paula/i }).first();
  if (await msg.count()) {
    await kb(H, msg); await bodyFocus(H, 'outbox-open');
    await H.dump('outbox-message'); await H.shot(J, 'message', { audit: false }); await busy(H, 'outbox-message', p.locator('main'));
    const frame = p.frameLocator('main iframe').first();
    const mail = await frame.locator('body').innerText().catch(() => '');
    H.note({ emailBody: mail.replace(/\s+/g, ' ').slice(0, 1200) });
    const ifr = p.locator('main iframe').first(); if (await ifr.count()) await regionShot(H, J, 'email-body', ifr);
  }
  await H.tabWalk('outbox', 30);
}

// Presenter entry and the flyout: access gate, landing, open, after Reset and after Switch principal.
export async function presenter(H) {
  const p = H.page(); const J = 'greg-presenter';
  await H.go('/gcsp-presenter.html'); await H.shot(J, 'gate', { full: false, audit: false }); await busy(H, 'gate', p.locator('body'));
  await H.signIn(); await H.wait(1500);
  H.note({ landing: await h1(p), focus: await focusNow(p), flyout: await flyoutOpen(p) });
  await H.dump('landing'); await H.shot(J, 'landing', { full: false, audit: false });
  if (!(await flyoutOpen(p))) await p.locator('.gcsp-nav-presenter-btn').first().click().catch(async () => { await p.locator('.gcsp-menu-toggle').click(); await H.wait(300); await p.locator('.gcsp-nav-presenter-btn').first().click(); });
  await H.wait(600);
  await bodyFocus(H, 'flyout-open');
  const fly = p.locator('.gcsp-presenter-flyout');
  H.note({ flyoutText: await txt(fly, 2500) });
  await H.shot(J, 'flyout-open', { full: false, audit: false }); await busy(H, 'flyout', fly);
  const scrollH = await fly.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
  H.note({ flyoutScroll: scrollH });
  await fly.evaluate((e) => { e.scrollTop = e.scrollHeight; }); await H.shot(J, 'flyout-scrolled-end', { full: false, audit: false });
  await fly.evaluate((e) => { e.scrollTop = 0; });
  await H.tabWalk('flyout', 50);
  await p.locator('.gcsp-presenter-controls button', { hasText: 'Decline then change' }).first().click();
  await btn(p, 'Reset scenario').click(); await H.wait(500); await bodyFocus(H, 'reset-asked');
  await H.shot(J, 'reset-confirm', { full: false, audit: false });
  await btn(p, 'Confirm reset').click();
  await idle(H); await H.wait(1500);
  await bodyFocus(H, 'reset-done'); H.note({ afterReset: await txt(fly, 800), flyout: await flyoutOpen(p), h1: await h1(p) });
  await H.shot(J, 'reset-done', { full: false, audit: false });
  const cont = btn(p, 'Continue to workspace'); if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  await switchTo(H, 'Greg');
  await bodyFocus(H, 'switched'); H.note({ afterSwitch: { h1: await h1(p), flyout: await flyoutOpen(p), reloadShown: await btn(p, 'Reload').isVisible().catch(() => false) } });
  await H.shot(J, 'switched-to-greg', { full: false, audit: false });
  await p.keyboard.press('Escape'); await H.wait(400); await bodyFocus(H, 'escape'); H.note({ afterEscape: await flyoutOpen(p) });
}
