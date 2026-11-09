// Walk sections for walk.mjs, in demo order. Each takes the helper bag H.
export async function probe(H) {
  const p = H.page();
  await H.go('/gcsp-presenter.html');
  await H.dump('gate');
  await H.shot('presenter', 'access-gate');
  await H.signIn();
  await H.dump('after-key');
  await H.ariaDump('after-key');
  await H.shot('presenter', 'after-key');
  await H.go('/');
  await H.dump('index');
}

// Presenter strip: collapsed, open, keyboard, Reset / Tick / Next release, principal switch.
export async function presenter(H) {
  const p = H.page();
  await H.go('/gcsp-presenter.html');
  await H.shot('presenter', 'access-gate');
  await H.tabWalk('access-gate', 6);
  await H.signIn();
  await H.shot('presenter', 'landing-collapsed', { full: false });
  await H.tabWalk('landing', 12);
  await H.openStrip();
  const s = p.locator('.gcsp-presenter-controls');
  H.note({ strip: H.clip(await s.innerText(), 3000) });
  H.note({ stripControls: await s.locator('button,select,input,summary,a').evaluateAll((els) => els.map((e) => `${e.tagName}:${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 50)}${e.tagName === 'SELECT' ? ` [${[...e.options].map((o) => o.textContent.trim()).join(' | ')}]` : ''}`)) });
  await H.ariaDump('strip-open');
  await H.shot('presenter', 'strip-open');
  await H.reflow320('strip-open');
  await H.tabWalk('strip-open', 45);
}

const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const h1 = (p) => p.locator('h1').first().innerText().catch(() => '');
// Keyboard activation: focus the control, then Enter (reachability is checked separately by tabWalk).
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1200); };
const focusNow = (p) => p.evaluate(() => { const e = document.activeElement; return `${e?.tagName}:${(e?.textContent || '').trim().slice(0, 50)}`; });
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});

export async function resetTo(H, scenario, journey, capture = false, principal = 'Paula') {
  const p = H.page();
  await H.openStrip();
  const opt = p.locator('.gcsp-presenter-controls button', { hasText: scenario }).first();
  H.note({ scenarioOption: await opt.evaluate((e) => `${e.getAttribute('role')} ${e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed')}`) });
  await opt.click();
  await btn(p, 'Reset scenario').click(); await H.wait(600);
  if (capture) await H.shot(journey, 'reset-confirm', { full: false });
  await btn(p, 'Confirm reset').click();
  await until(H, async () => !/Action in progress/.test(await p.locator('.gcsp-presenter-controls').innerText()), 'reset done', 60000);
  await H.wait(1500);
  if (capture) { H.note({ afterReset: { focus: await focusNow(p), strip: H.clip(await p.locator('.gcsp-presenter-controls').innerText(), 600) } }); await H.shot(journey, 'reset-done', { full: false }); }
  const cont = btn(p, 'Continue to workspace');
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2000); }
  if (principal) await switchTo(H, principal, journey, capture);
}
export async function switchTo(H, who, journey, capture = false) {
  const p = H.page();
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: `${who} (fictional)` }).first().click();
  await btn(p, 'Switch principal').click();
  await until(H, async () => !/Action in progress/.test(await p.locator('.gcsp-presenter-controls').innerText()), 'switch done', 60000);
  await H.wait(2500);
  if (capture) { H.note({ afterSwitch: { focus: await focusNow(p), h1: await h1(p), stripOpen: await p.evaluate(() => document.querySelector('.gcsp-presenter-controls')?.open) } }); await H.shot(journey, `switched-${who.toLowerCase()}`, { full: false }); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { H.note({ reloadPromptAfterSwitch: true }); await p.reload(); await H.wait(2500); }
}

export async function manual(H) {
  const p = H.page();
  await H.signIn();
  if (process.env.WALK_RESET) await resetTo(H, process.env.WALK_RESET, 'presenter', true);
  await closeStrip(p);
  H.note({ step: 'account', h1: await h1(p), url: p.url() });
  await H.shot('paula-manual', 'account');
  await H.reflow320('account'); await H.ariaDump('account'); await H.tabWalk('account');
  await kb(H, btn(p, 'Choose a replacement'));
  await until(H, async () => (await h1(p)) === 'Your order choices', 'setup');
  await H.wait(1500);
  H.note({ step: 'setup', focus: await focusNow(p), url: p.url() });
  await H.dump('setup-empty'); await H.shot('paula-manual', 'setup-empty');
  await H.tabWalk('setup', 40); await H.ariaDump('setup');
  await kb(H, btn(p, 'Save choices'));
  H.note({ step: 'setup-save-empty', focus: await focusNow(p) });
  await H.dump('setup-validation'); await H.shot('paula-manual', 'setup-validation');
  const pick = async (name) => { const s = p.locator(`select[name="${name}"]`); if (!(await s.count())) return null;
    await until(H, async () => (await s.locator('option:not([disabled])').count()) > 1, `${name} options`);
    const v = await s.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value); await s.selectOption(v); return v; };
  const driver = p.locator('select[name="driverId"]');
  await driver.selectOption({ label: 'You: Paula (fictional)' }).catch(() => pick('driverId'));
  await pick('contractOptionId');
  const date = p.locator('input[name="requestedCollectionDate"]'); await date.fill(await date.getAttribute('min'));
  await pick('collectionLocationId');
  const fill = async (sel, v) => { const c = p.locator(sel); if (await c.count() && await c.isVisible() && !(await c.inputValue())) await c.fill(v); };
  await fill('input[name="phone"]', '07700900123'); await fill('input[name="email"]', 'paula.test@example.test'); await fill('input[name="expectedReturnMileage"]', '24000');
  await kb(H, btn(p, 'Save choices'));
  await until(H, async () => /Your choices are saved/.test(await H.text()), 'saved');
  await H.shot('paula-manual', 'setup-saved');
  await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue enabled');
  await kb(H, btn(p, 'Continue'));
  await until(H, async () => /Released cars/.test(await H.text()), 'gallery');
  await H.wait(2500);
  H.note({ step: 'gallery-before-release', h1: await h1(p), focus: await focusNow(p) });
  await H.dump('gallery-empty'); await H.shot('paula-manual', 'gallery-before-release');
  await H.press('Next release'); await closeStrip(p);
  const refresh = btn(p, 'Refresh availability'); if (await refresh.count()) await kb(H, refresh);
  await H.wait(2500);
  if (!(await p.getByRole('button', { name: 'Review this car' }).count())) {
    H.note({ step: 'date-recovery-needed', text: H.clip(await H.text(), 800) });
    await H.shot('paula-manual', 'gallery-after-release-date-outside');
    await kb(H, btn(p, 'Back to your choices'));
    await until(H, async () => (await h1(p)) === 'Your order choices', 'setup again');
    await until(H, async () => (await date.getAttribute('min')) && !(await date.isDisabled()), 'window');
    await date.fill(await date.getAttribute('min'));
    await kb(H, btn(p, 'Save choices')); await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue');
    await kb(H, btn(p, 'Continue'));
  }
  await until(H, async () => (await p.getByRole('button', { name: 'Review this car' }).count()) > 0, 'cards', 30000);
  await H.wait(1500);
  await H.dump('gallery'); await H.shot('paula-manual', 'gallery-released');
  await H.reflow320('gallery'); await H.ariaDump('gallery'); await H.tabWalk('gallery', 50);
  for (let tries = 0; tries < 4 && (await h1(p)) !== 'Review your car'; tries += 1) {
    const enabled = p.locator('button:enabled', { hasText: 'Review this car' });
    await kb(H, enabled.nth(Math.min(tries, (await enabled.count()) - 1)));
    await until(H, async () => (await h1(p)) === 'Review your car' || /no longer available/.test(await H.text()), 'review or conflict');
    if ((await h1(p)) !== 'Review your car') {
      H.note({ reviewConflict: tries, text: H.clip(await H.text(), 300) });
      if (tries === 0) await H.shot('paula-manual', 'gallery-conflict');
      await kb(H, btn(p, 'Refresh availability').first()); await H.wait(2500);
      if (tries === 0) await H.shot('paula-manual', 'gallery-after-conflict-refresh');
    }
  }
  await H.wait(2000);
  H.note({ step: 'review', focus: await focusNow(p), url: p.url() });
  await H.dump('review'); await H.shot('paula-manual', 'review');
  await H.reflow320('review'); await H.ariaDump('review'); await H.tabWalk('review', 40);
  // Resume: reload, back to Your cars, Resume saved journey.
  await p.reload(); await H.wait(2500);
  H.note({ step: 'after-reload', h1: await h1(p), url: p.url() });
  const yc = p.getByRole('link', { name: 'Your cars' }).first();
  if ((await h1(p)) !== 'Your cars' && await yc.count()) { await kb(H, yc); await H.wait(2000); }
  await until(H, async () => (await p.getByRole('button', { name: /Resume saved journey/ }).count()) > 0, 'resume button');
  await H.dump('account-resume'); await H.shot('paula-manual', 'account-resume');
  await kb(H, p.getByRole('button', { name: /Resume saved journey/ }));
  await until(H, async () => (await h1(p)) === 'Review your car', 'review after resume', 30000);
  await H.wait(1500);
  H.note({ step: 'resumed', focus: await focusNow(p) });
  await H.shot('paula-manual', 'review-resumed', { full: false });
  await kb(H, btn(p, 'Continue to order review'));
  await until(H, async () => (await h1(p)) === 'Review your order', 'summary');
  await H.wait(1500);
  const boxes = p.locator('input[type="checkbox"][data-declaration]');
  H.note({ step: 'summary', focus: await focusNow(p), boxes: await boxes.count(), submitEnabled: await p.getByRole('button', { name: 'Submit order' }).isEnabled().catch(() => null) });
  await H.dump('summary'); await H.shot('paula-manual', 'summary');
  await H.ariaDump('summary'); await H.tabWalk('summary', 40);
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await H.shot('paula-manual', 'summary-declared', { full: false });
  await kb(H, btn(p, 'Submit order'));
  await until(H, async () => /^(Order received|Order saved|Order not sent)$/.test((await h1(p)).trim()), 'outcome', 60000);
  await H.wait(1500);
  H.note({ step: 'outcome', h1: await h1(p), focus: await focusNow(p) });
  await H.dump('outcome'); await H.shot('paula-manual', 'outcome');
  await H.reflow320('outcome'); await H.ariaDump('outcome'); await H.tabWalk('outcome', 30);
  await kb(H, btn(p, 'Finish'));
  await until(H, async () => (await h1(p)) === 'Your cars', 'account after order');
  await H.wait(2000);
  await H.dump('account-ordered'); await H.shot('paula-manual', 'account-ordered');
}

// Buddy route to the offer: brief, activity, Next release, offer. WALK_STAGE=decline goes on to the decline form.
export async function offer(H) {
  const p = H.page();
  const J = 'paula-offer';
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Decline then change', 'presenter');
  await closeStrip(p);
  await H.go('/gcsp-brief-live.html'); await H.wait(1500);
  H.note({ step: 'brief', h1: await h1(p), focus: await focusNow(p) });
  await H.dump('brief'); await H.shot(J, 'brief'); await H.reflow320('brief'); await H.ariaDump('brief'); await H.tabWalk('brief', 60);
  await H.go('/gcsp-activity-live.html'); await H.wait(1500);
  await H.dump('activity-before'); await H.shot(J, 'activity-before-release');
  await H.openStrip();
  if (await btn(p, 'Next release').isEnabled()) { await H.press('Next release'); await p.reload(); await H.wait(2500); } else H.note({ nextReleaseDisabled: H.clip(await p.locator('.gcsp-presenter-controls').innerText(), 400) });
  await closeStrip(p);
  H.note({ step: 'activity-after', h1: await h1(p) });
  await H.dump('activity-after'); await H.shot(J, 'activity-found'); await H.reflow320('activity'); await H.ariaDump('activity'); await H.tabWalk('activity', 40);
  const open = p.getByRole('link', { name: /View offer|Open the offer/i }).or(p.getByRole('button', { name: /View offer|Open the offer/i })).first();
  H.note({ offerLink: await open.evaluate((e) => `${e.tagName} ${e.textContent.trim()} ${e.getAttribute('href') || ''}`).catch(() => 'none') });
  await kb(H, open); await H.wait(2500);
  H.note({ step: 'offer', h1: await h1(p), url: p.url().replace(H.origin, ''), focus: await focusNow(p) });
  await H.dump('offer'); await H.shot(J, 'offer'); await H.reflow320('offer'); await H.ariaDump('offer'); await H.tabWalk('offer', 50);
  if (process.env.WALK_STAGE === 'accept') return acceptHere(H, J, 'first');
  const decline = btn(p, /Decline/, false).first();
  await kb(H, decline); await H.wait(1500);
  H.note({ step: 'decline-form', h1: await h1(p), focus: await focusNow(p) });
  await H.dump('decline'); await H.shot(J, 'decline-form'); await H.ariaDump('decline'); await H.tabWalk('decline', 40);
  if (process.env.WALK_STAGE !== 'full') return;
  // Confirm with no reason first, to see the error state.
  await kb(H, btn(p, 'Confirm decline')); await H.wait(1200);
  H.note({ step: 'decline-no-reason', focus: await focusNow(p), text: H.clip((await H.text()).split('Reason for declining')[1], 200) });
  await H.shot(J, 'decline-no-reason', { full: false });
  const reason = p.getByRole('combobox', { name: 'Reason for declining' });
  await reason.focus(); await reason.selectOption({ label: 'Body style' }); await H.wait(800);
  H.note({ step: 'decline-reason-chosen', text: H.clip((await H.text()).split('Reason for declining')[1], 400) });
  await H.shot(J, 'decline-reason-body-style', { full: false });
  await kb(H, btn(p, 'Confirm decline')); await H.wait(3000);
  H.note({ step: 'declined', h1: await h1(p), url: p.url().replace(H.origin, ''), focus: await focusNow(p), buttons: (await p.locator('main button:visible, main a[href]:visible').allInnerTexts()).slice(0, 20) });
  await H.dump('declined'); await H.shot(J, 'declined'); await H.ariaDump('declined'); await H.tabWalk('declined', 40); await H.reflow320('declined');
}
// Continues after a decline: change body style to Saloon, tick, open the new offer, accept.
export async function change(H) {
  const p = H.page(); const J = 'paula-change';
  const saloon = p.getByRole('radio', { name: 'Saloon' }).or(p.getByRole('button', { name: 'Saloon' })).first();
  H.note({ step: 'change-start', h1: await h1(p), saloon: await saloon.count() });
  if (!(await saloon.count())) { await H.go('/gcsp-brief-live.html'); await H.wait(1500); H.note({ step: 'change-via-brief', h1: await h1(p) }); }
  await saloon.focus(); await p.keyboard.press('Space'); await H.wait(800);
  await H.shot(J, 'saloon-chosen', { full: false });
  const save = p.getByRole('button', { name: /Save|Search again|Confirm|Update/ }).first();
  H.note({ changeSave: await save.innerText().catch(() => 'none') });
  await kb(H, save); await H.wait(2500);
  H.note({ step: 'change-saved', h1: await h1(p), focus: await focusNow(p), buttons: (await p.locator('main button:visible, main a[href]:visible').allInnerTexts()).slice(0, 15) });
  await H.dump('change-saved'); await H.shot(J, 'change-saved');
  await H.openStrip(); await H.press(/^Tick \(/); await closeStrip(p);
  await H.go('/gcsp-activity-live.html'); await H.wait(2000);
  await H.dump('activity-second'); await H.shot(J, 'activity-second-offer'); await H.tabWalk('activity-second', 30);
  const open = p.getByRole('link', { name: /View offer|Open the offer/i }).first();
  await kb(H, open); await H.wait(2500);
  H.note({ step: 'second-offer', h1: await h1(p), focus: await focusNow(p) });
  await H.dump('second-offer'); await H.shot(J, 'second-offer'); await H.ariaDump('second-offer');
  await acceptHere(H, J, 'second');
}
async function acceptHere(H, J, label) {
  const p = H.page();
  const boxes = p.locator('input[type="checkbox"]');
  H.note({ step: `accept-${label}`, boxes: await boxes.count(), acceptEnabled: await btn(p, /^Accept/, false).first().isEnabled().catch(() => null) });
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await H.shot(J, `${label}-declared`, { full: false });
  await kb(H, btn(p, /^Accept/, false).first()); await H.wait(2500);
  H.note({ step: `accepted-${label}`, h1: await h1(p), focus: await focusNow(p) });
  await H.dump(`accepted-${label}`); await H.shot(J, `${label}-accepted`); await H.ariaDump(`accepted-${label}`); await H.tabWalk(`accepted-${label}`, 30);
  await p.reload(); await H.wait(2500);
  await H.dump(`accepted-${label}-reload`); await H.shot(J, `${label}-accepted-reload`, { full: false });
}

// The run sheet beats 5:00 to 8:30: decline for Body style, change to Saloon, tick, accept the second offer.
export async function decision(H) { process.env.WALK_STAGE = "full"; await offer(H); await change(H); }
