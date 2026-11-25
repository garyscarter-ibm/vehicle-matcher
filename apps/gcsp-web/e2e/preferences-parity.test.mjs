import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { startComposition } from './composition.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const good = (response, name) => {
  assert.equal(response.status, 200, name); assert.equal(response.body.status, 'ok', name); return response.body.value;
};
const focused = (locator) => locator.evaluate((node) => document.activeElement === node);
const project = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
const briefKeys = ['schemaVersion', 'preferences', 'essentials', 'buddy', 'briefVersion', 'status', 'policyVersion',
  'confirmedBy', 'currentCarFeedback', 'currentCarRating', 'sameAgain'];

async function readbacks(suite, page) {
  const paths = ['/context', '/manual/account', '/brief', '/brief/editor'];
  const responses = await Promise.all(paths.map((route) => suite.call(page, 'GET', route)));
  return Object.fromEntries(paths.map((route, index) => [route, good(responses[index], `Actual ${route}`)]));
}

async function capture(suite, page, name) {
  const destination = path.join(process.env.GCSP_E2E_OUTPUT, 'f552', `${name}.png`);
  // Off-screen lazy images deliberately have no response yet. Wait for the actual visible/eager images;
  // keep the full-page capture honest rather than changing loading policy or replacing image responses.
  await page.waitForFunction(() => [...document.images].filter((image) => {
    const box = image.getBoundingClientRect();
    return image.loading !== 'lazy' || box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  }).every((image) => image.complete), null, { timeout: 15000 });
  await page.screenshot({ path: destination, fullPage: true });
  suite.receipt.screenshots.push({ name, path: destination, viewport: page.viewportSize() });
  return destination;
}

async function accountSurface(page) {
  const root = page.locator('.gcsp-prefs').first(); await root.waitFor();
  return root.evaluate((node) => ({
    tiles: [...node.querySelectorAll('.gcsp-prefs-tile')].map((tile) => ({
      label: tile.querySelector('.gcsp-prefs-top span')?.textContent.trim(),
      value: tile.querySelector('.gcsp-prefs-value')?.textContent.trim(),
      considered: tile.classList.contains('is-considered'), important: tile.classList.contains('is-important'),
      icon: !!tile.querySelector('.gcsp-prefs-top svg path'), bin: !!tile.querySelector('.gcsp-prefs-remove svg path'),
    })),
    meter: { label: node.querySelector('.gcsp-understanding-label')?.textContent.trim(),
      value: node.querySelector('.gcsp-understanding-value')?.textContent.trim(),
      segments: node.querySelectorAll('.gcsp-understanding-meter i').length,
      filled: node.querySelectorAll('.gcsp-understanding-meter .is-filled').length },
    mode: [...node.querySelectorAll('.gcsp-prefs-mode-option label')].map((item) => item.textContent.trim()),
    stops: [...node.querySelectorAll('.gcsp-prefs-stops span')].map((item) => item.textContent.trim()),
  }));
}

async function accountChecks(page, readEditor) {
  const root = page.locator('.gcsp-prefs').first();
  // The frozen compact editor saves an unset stopped category's openDefault on open. Exercise the
  // same public actions on both engines and await their actual saves before comparing their state.
  for (const [key, label] of [['comfort', 'Comfort'], ['sportiness', 'Sportiness']]) {
    const tile = root.locator('.gcsp-prefs-open').filter({ hasText: label });
    await tile.focus(); await page.keyboard.press('Enter');
    await until(async () => (await readEditor()).initial.accountPreferences.categories[key]?.state === 'considered',
      `${label} default must reach the actual saved editor`);
    await until(async () => await root.locator('.gcsp-understanding.is-pending').count() === 0,
      `${label} save must finish rendering`);
  }
  const slider = root.locator('.gcsp-prefs-panel:not([hidden]) input[type="range"]'); await slider.waitFor();
  assert.ok(Number(await slider.getAttribute('step')) > 1, 'The compact range moves between the source stops');
  const surface = await accountSurface(page);
  assert.ok(surface.tiles.length >= 6 && surface.tiles.every((item) => item.icon && item.bin));
  const colours = await root.locator('.gcsp-prefs-tile').evaluateAll((tiles) => tiles.map((item) => ({
    important: item.classList.contains('is-important'), background: getComputedStyle(item).backgroundColor,
  })));
  const important = colours.find((item) => item.important); const ordinary = colours.find((item) => !item.important);
  assert.ok(important && ordinary && important.background !== ordinary.background, 'Important tiles retain a distinct visible colour');
  assert.deepEqual(surface.mode, ['Set my preferences', 'Same again, please!']);
  assert.equal(surface.meter.label, 'Buddy understanding');
  assert.match(surface.meter.value, /^\d+ \/ \d+$/);
  const [value, maximum] = surface.meter.value.split(' / ').map(Number);
  assert.equal(surface.meter.segments, maximum); assert.equal(surface.meter.filled, value);
  assert.ok(surface.stops.length >= 3);
  return surface;
}

async function editorSurface(page) {
  await page.locator('.gcsp-brief-preference').first().waitFor();
  return page.locator('.gcsp-brief').evaluate((root) => ({
    preferences: [...root.querySelectorAll('.gcsp-brief-preference')].map((field) => ({
      label: field.querySelector('legend')?.textContent.trim(),
      axes: [...field.querySelectorAll('.gcsp-brief-axis-label')].map((node) => node.textContent.trim()),
      ends: [...field.querySelectorAll('.gcsp-brief-scale')].map((scale) => [...scale.children].map((node) => node.textContent.trim())),
    })),
    questions: [...root.querySelectorAll('.gcsp-brief-question')].map((field) => ({
      label: field.querySelector('legend')?.textContent.trim(),
      choices: [...field.querySelectorAll('.vm-options')][0] ? [...field.querySelector('.vm-options').querySelectorAll('.vm-option')].map((node) => node.textContent.trim()) : [],
    })),
    cards: [...root.querySelectorAll('.gcsp-brief-cards article.vm-card')].map((card) => ({
      member: card.dataset.memberId, gate: card.dataset.gate, title: card.querySelector('.vm-card-name')?.textContent.trim(),
    })),
  }));
}

async function openEditor(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Your preferences', exact: true, level: 1 }).waitFor();
  const more = page.locator('.gcsp-brief-more');
  if (await more.count()) await more.locator('summary').click();
}

test('FUCQ-552: source preferences, real preview, keyboard and accepted exits', { timeout: 540000 }, async (t) => {
  const suite = await startComposition({ caseId: 'f552' });
  t.after(() => suite.close());
  let completed = 0;
  const check = (name, action) => t.test(name, async () => {
    try { await action(); }
    catch (error) {
      suite.receipt.failure ??= { group: name, name: error.name, message: error.message.slice(0, 1000) };
      throw error;
    }
  });
  try {
    const employee = await suite.newPage('employee', 'demo-paula', 'account');
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    const state = await suite.releaseMainOffer(employee, presenter);
    let before = await readbacks(suite, employee);
    suite.receipt.preferences = { initial: before, parity: 'pending human review; automated comparison is engineering evidence' };
    await employee.reload({ waitUntil: 'domcontentloaded' });

    await check('AC1–3: source tiles, stopped slider, segmented mode/help and labelled meter at 1280', async () => {
      await employee.setViewportSize({ width: 1280, height: 800 });
      suite.receipt.preferences.account = await accountChecks(employee, async () =>
        good(await suite.call(employee, 'GET', '/brief/editor'), 'Actual compact save readback'));
      before = await readbacks(suite, employee); suite.receipt.preferences.before = before;
      await capture(suite, employee, 'angular-account-sportiness-1280');
      const root = employee.locator('.gcsp-prefs').first();
      await root.getByRole('button', { name: 'Done', exact: true }).click();
      const info = root.getByRole('button', { name: 'About Same again, please!', exact: true });
      await info.focus();
      const tipId = await info.getAttribute('aria-describedby'); assert.ok(tipId);
      await employee.locator(`[id="${tipId}"]`).waitFor({ state: 'visible' });
      await employee.keyboard.press('Escape');
      await employee.locator(`[id="${tipId}"]`).waitFor({ state: 'hidden' });
      assert.equal(await focused(info), true, 'Help dismissal keeps keyboard focus');
      const remove = root.locator('.gcsp-prefs-remove:visible').first();
      await remove.focus(); await employee.keyboard.press('Enter');
      await root.getByRole('button', { name: 'Keep it', exact: true }).waitFor();
      await root.getByRole('button', { name: 'Keep it', exact: true }).press('Enter');
      assert.equal(await focused(remove), true, 'Keeping a preference restores focus to its bin');
      completed++;
    });

    let angularEditor;
    await check('AC4/5: editor chips, two axes, end labels and actual decision-card preview', async () => {
      await openEditor(employee, `${suite.origins.web}/gcsp/preferences`);
      const response = employee.waitForResponse((value) => value.request().method() === 'POST'
        && new URL(value.url()).pathname.endsWith('/brief/preview'));
      await employee.getByRole('button', { name: 'Update preview', exact: true }).click();
      const actual = await response; assert.equal(actual.status(), 200);
      suite.receipt.preferences.preview = await actual.json(); assert.equal(suite.receipt.preferences.preview.status, 'ok');
      await until(async () => await employee.locator('.gcsp-brief-cards article.vm-card').count() > 0, 'The real preview produces decision cards');
      angularEditor = await editorSurface(employee);
      assert.ok(angularEditor.preferences.length > 0 && angularEditor.questions.length > 0);
      for (const field of angularEditor.preferences) {
        assert.deepEqual(field.axes, ['Preference', 'Importance']);
        assert.ok(field.ends.length >= 1 && field.ends.every((ends) => ends.length === 2 && ends.every(Boolean)));
      }
      for (const question of angularEditor.questions) assert.deepEqual(question.choices, ['Yes', 'No', 'Not sure yet']);
      assert.ok(angularEditor.cards.every((card) => card.member && card.gate && card.title));
      suite.receipt.preferences.editor = angularEditor;
      await capture(suite, employee, 'angular-editor-1280');
      completed++;
    });

    await check('AC7 engineering pair: frozen live account/editor use the same actual brief, account and clock', async () => {
      const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: state.hold, clock: state.clock,
        finalAccount: state.account }, async ({ page, origin, runtime, employee: sourceEmployee }) => {
        await page.goto(`${origin}/gcsp-account.html`, { waitUntil: 'domcontentloaded' });
        const sourceAccount = await accountChecks(page, async () => {
          const actual = await runtime.editor.readEditor(sourceEmployee); assert.equal(actual.status, 'ok'); return actual.value;
        });
        const sourceBrief = await runtime.brief.readCurrent(sourceEmployee);
        assert.equal(sourceBrief.status, 'ok');
        assert.deepEqual(project(sourceBrief.value.brief, briefKeys), project(before['/brief'].brief, briefKeys), 'Actual saved brief inputs match across engines');
        assert.deepEqual(project(sourceEmployee, ['runId', 'employeeId', 'policyVersion']),
          project(before['/context'], ['runId', 'employeeId', 'policyVersion']), 'Actual contexts map only the isolated environment');
        const sourceAccountRead = await runtime.account.readAccount(sourceEmployee); assert.equal(sourceAccountRead.status, 'ok');
        assert.deepEqual(project(sourceAccountRead.value, ['state', 'asOf', 'account', 'drivers', 'contracts', 'currentContract', 'contractState', 'choices', 'allowance', 'versions']),
          project(before['/manual/account'], ['state', 'asOf', 'account', 'drivers', 'contracts', 'currentContract', 'contractState', 'choices', 'allowance', 'versions']), 'Actual accounts and clocks match');
        const sourceEditorRead = await runtime.editor.readEditor(sourceEmployee); assert.equal(sourceEditorRead.status, 'ok');
        for (const key of ['preferences', 'essentials', 'practicalQuestions', 'slider', 'accountPreferences']) {
          assert.deepEqual(sourceEditorRead.value.context[key], before['/brief/editor'].context[key], `Actual editor context ${key}`);
        }
        assert.deepEqual(sourceAccount, suite.receipt.preferences.account, 'Same actual categories, mode, importance and completeness');
        const accountCapture = await capture(suite, page, 'node-account-sportiness-1280');
        await openEditor(page, `${origin}/gcsp-brief-live.html`);
        await until(async () => await page.locator('.gcsp-brief-cards article.vm-card').count() > 0, 'Frozen real preview produces decision cards');
        const sourceEditor = await editorSurface(page);
        assert.deepEqual(sourceEditor, angularEditor, 'Both actual editors render the same schema and preview decisions');
        const editorCapture = await capture(suite, page, 'node-editor-1280');
        return { preferences: { actualBrief: sourceBrief.value, actualAccount: sourceAccountRead.value, actualEditor: sourceEditorRead.value,
          account: sourceAccount, editor: sourceEditor,
          screenshots: [accountCapture, editorCapture], humanReview: 'pending' } };
      });
      assert.equal(replay.state, 'matched', 'A missing frozen reference cannot establish the required pair');
      completed++;
    });

    await check('AC1/2/4: 390px keyboard controls retain input and leave the saved brief unchanged', async () => {
      await employee.setViewportSize({ width: 390, height: 844 });
      const question = employee.locator('.gcsp-brief-question').first();
      const no = question.getByRole('radio', { name: 'No', exact: true });
      await no.focus(); await employee.keyboard.press('Space');
      await until(async () => await no.getAttribute('aria-checked') === 'true', 'No renders after keyboard activation');
      assert.equal(await focused(no), true);
      const yes = question.getByRole('radio', { name: 'Yes', exact: true });
      await yes.focus(); await employee.keyboard.press('Enter');
      await until(async () => await yes.getAttribute('aria-checked') === 'true', 'Yes renders after keyboard activation');
      const unknown = question.getByRole('radio', { name: 'Not sure yet', exact: true });
      await unknown.focus(); await employee.keyboard.press('Enter');
      await until(async () => await unknown.getAttribute('aria-checked') === 'true', 'Not sure yet renders after keyboard activation');
      const range = employee.locator('input[id^="preference-"][type="range"]').first();
      await range.focus(); await employee.keyboard.press('Home'); const minimum = await range.inputValue();
      await employee.keyboard.press('ArrowRight'); assert.ok(Number(await range.inputValue()) > Number(minimum));
      assert.equal(await focused(range), true);
      await capture(suite, employee, 'angular-editor-draft-keyboard-390');
      assert.equal(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Narrow editor fits the viewport');
      assert.deepEqual(project(good(await suite.call(employee, 'GET', '/brief'), 'Saved brief after draft keyboard input').brief, briefKeys),
        project(before['/brief'].brief, briefKeys), 'Keyboard drafts never save implicitly');
      await employee.goto(`${suite.origins.web}/gcsp/account`, { waitUntil: 'domcontentloaded' });
      await accountChecks(employee, async () => good(await suite.call(employee, 'GET', '/brief/editor'), 'Actual narrow compact readback'));
      await capture(suite, employee, 'angular-account-sportiness-390');
      assert.equal(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Narrow tiles and stopped slider fit the viewport');
      const custom = employee.getByRole('radio', { name: 'Set my preferences', exact: true });
      await custom.focus(); await employee.keyboard.press('Space');
      assert.equal(await custom.isChecked(), true); assert.equal(await focused(custom), true, 'Segmented mode remains keyboard accessible');
      completed++;
    });

    await check('AC6: explicit save opens Activity; actual acceptance opens order progress', async () => {
      await employee.setViewportSize({ width: 1280, height: 800 });
      await openEditor(employee, `${suite.origins.web}/gcsp/preferences`);
      await employee.getByRole('button', { name: 'Refresh and review', exact: true }).click();
      await employee.getByRole('button', { name: 'Replace draft with saved preferences', exact: true }).click();
      await employee.getByRole('heading', { name: 'Your preferences', exact: true, level: 1 }).waitFor();
      assert.deepEqual(project(good(await suite.call(employee, 'GET', '/brief'), 'Actual saved brief after explicit draft replacement').brief, briefKeys),
        project(before['/brief'].brief, briefKeys), 'Draft replacement preserves the saved baseline');
      await employee.getByRole('radio', { name: 'Engage Buddy', exact: true }).check();
      await employee.getByRole('button', { name: 'Save your preferences', exact: true }).click();
      const activity = employee.getByRole('link', { name: 'See your buddy at work', exact: true }); await activity.waitFor();
      await activity.focus(); await employee.keyboard.press('Enter');
      await employee.waitForURL((url) => url.pathname === '/gcsp/activity');
      const activityRead = good(await suite.call(employee, 'GET', '/activity'), 'Actual Activity after unchanged save');
      suite.receipt.preferences.afterSaveActivity = activityRead;
      assert.equal(activityRead.currentOffer?.state, 'active', 'The unchanged explicit save retains the real active offer');
      assert.equal(activityRead.currentOffer.offerRef.offerId, state.offer.offerRef.offerId);
      await employee.goto(`${suite.origins.web}/gcsp/offers/${encodeURIComponent(state.offer.offerRef.offerId)}`, { waitUntil: 'domcontentloaded' });
      await employee.getByRole('button', { name: 'Review & accept', exact: true }).click();
      const dialog = employee.getByRole('dialog', { name: 'Accept your offer', exact: true }); await dialog.waitFor();
      await dialog.getByLabel('Expected return mileage (miles)', { exact: true }).fill('5400');
      await dialog.getByLabel('Expected return mileage (miles)', { exact: true }).press('Tab');
      const declarations = dialog.getByRole('checkbox');
      for (let index = 0; index < await declarations.count(); index++) await declarations.nth(index).check();
      const response = employee.waitForResponse((value) => value.request().method() === 'POST'
        && new URL(value.url()).pathname.endsWith(`/offers/${encodeURIComponent(state.offer.offerRef.offerId)}/decision`));
      await dialog.getByRole('button', { name: 'Accept offer', exact: true }).click();
      const actual = await response; assert.equal(actual.status(), 200);
      const decision = await actual.json(); assert.equal(decision.status, 'ok');
      suite.receipt.preferences.acceptance = decision;
      await employee.goto(`${suite.origins.web}/gcsp/preferences`, { waitUntil: 'domcontentloaded' });
      const editor = good(await suite.call(employee, 'GET', '/brief/editor'), 'Actual accepted editor');
      assert.equal(editor.selection.state, 'accepted');
      const orders = employee.getByRole('link', { name: 'See your order progress', exact: true }); await orders.waitFor();
      assert.equal(await employee.locator('.gcsp-brief-form').count(), 0, 'Accepted preferences are read only');
      await capture(suite, employee, 'angular-editor-accepted-1280');
      await orders.focus(); await employee.keyboard.press('Enter');
      await employee.waitForURL((url) => url.pathname === '/gcsp/orders');
      suite.receipt.preferences.after = await readbacks(suite, employee);
      completed++;
    });
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No app runtime errors in the checked preferences flow');
    assert.equal(completed, 5, 'All five connected acceptance groups completed');
    suite.receipt.checks.f552 = true;
  } catch (error) {
    suite.receipt.failure ??= { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  }
});
