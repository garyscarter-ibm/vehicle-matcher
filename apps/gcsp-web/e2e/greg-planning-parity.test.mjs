import assert from 'node:assert/strict';
import test from 'node:test';
import { startComposition, showAdvanced } from './composition.mjs';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const good = (response, label) => {
  assert.equal(response.status, 200, label); assert.equal(response.body.status, 'ok', label); return response.body.value;
};
const semantics = (value) => value.requests.map(request => ({
  model: request.model, derivative: request.derivative, quantity: request.quantity,
  stage: request.stage, confirmedQuantity: request.confirmedQuantity,
  releasedQuantity: request.releasedQuantity, outstandingQuantity: request.outstandingQuantity,
})).sort((a, b) => a.quantity - b.quantity);
async function fits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
    `The ${page.viewportSize().width}px page fits its viewport`);
}
async function capture(suite, page, name, widths = [1280, 375]) {
  const files = {};
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
    await fits(page); files[width] = await suite.screenshot(page, `${name}-${width}`, { fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 800 }); return files;
}
async function waitPost(page, suffix, operate) {
  const waiting = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(suffix));
  await operate(); const response = await waiting;
  return { status: response.status(), body: await response.json() };
}
async function refresh(suite, greg) {
  const button = greg.getByRole('button', { name: 'Refresh Production status', exact: true });
  await until(() => button.isEnabled(), 'Greg can deliberately refresh Production');
  await button.click();
  await until(async () => await greg.locator('#gcsp-order-requests').getAttribute('aria-busy') === 'false', 'Production read settles');
  return good(await suite.call(greg, 'GET', '/greg/orders'), 'Actual current Greg orders');
}

test('FUCQ-559: intentional planning and role-separated Production responses use the real composition',
  { timeout: 480000 }, async t => {
    const suite = await startComposition({ caseId: 'f559' }); t.after(() => suite.close());
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    const initialClock = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Actual initial Presenter clock');
    const firstTick = await suite.call(presenter, 'POST', '/presenter/clock/tick', {
      tickId: 'f559-initial-production-clock', expectedClockVersion: initialClock.clockVersion,
    });
    assert.equal(good(firstTick, 'Actual first public supply tick').state, 'completed');
    const greg = await suite.newPage('greg', 'demo-greg', 'greg/plan');
    const states = {}; const screenshots = {}; const commands = [];
    let removeQueueFault;
    suite.receipt.gregPlanning = { states, screenshots, commands, initialClock, firstTick,
      humanReview: 'Pending actual collaborator verdict; automated rendering and source comparisons do not satisfy AC4.' };
    const readOrders = async () => {
      const response = await suite.call(greg, 'GET', '/greg/orders');
      (suite.receipt.gregPlanning.reads ??= []).push(response);
      return good(response, 'Greg orders');
    };
    const initial = await readOrders();
    assert.deepEqual(initial.requests, [], 'The owned Main scenario begins without Production requests');
    const choice = initial.provider.choices.find(row => row.model === '3 Series Saloon' && row.derivative === '320i');
    assert.ok(choice, 'Both real synthetic producers retain this source choice');
    const startingPostCount = suite.receipt.requests.filter(row => row.method === 'POST').length;

    await t.test('AC1/2: request form, table and deliberate plan-limit slider', async () => {
      await greg.locator('gcsp-order-plan').waitFor();
      await greg.locator('.plan-limits > summary').click();
      const slider = greg.locator('gcsp-range-slider input[type="range"]').first(); await slider.waitFor();
      const paint = await slider.evaluate(input => {
        const style = getComputedStyle(input); const bounds = input.getBoundingClientRect();
        return { accent: style.getPropertyValue('--vm-accent').trim(), track: style.getPropertyValue('--vm-line').trim(),
          surface: style.getPropertyValue('--vm-surface').trim(), width: bounds.width, height: bounds.height };
      });
      assert.ok(paint.accent && paint.track && paint.surface, 'The actual range track/thumb resolve the incumbent VM paint tokens');
      assert.ok(paint.width > 40 && paint.height >= 24, 'The painted range retains its visible hit area');
      suite.receipt.gregPlanning.sliderPaint = paint;
      const before = await slider.inputValue();
      await slider.fill(before === '0' ? '1' : '0'); await slider.dispatchEvent('input');
      await slider.focus(); const selected = Number(await slider.inputValue());
      const delta = selected < Number(await slider.getAttribute('max')) ? 1 : -1;
      await slider.press(delta === 1 ? 'ArrowRight' : 'ArrowLeft');
      assert.equal(Number(await slider.inputValue()), selected + delta, 'The visible native range supports a deliberate keyboard step');
      assert.equal(suite.receipt.requests.filter(row => row.method === 'POST').length, startingPostCount,
        'Opening and changing a limit does not publish or request vehicles');
      const preview = await waitPost(greg, '/greg/order-plan/preview', () => greg.getByRole('button', { name: 'Preview changed limits', exact: true }).click());
      good(preview, 'The edited limit is previewed by the real plan service');
      await greg.getByRole('button', { name: 'Back to current plan', exact: true }).click();
      screenshots.limits = await capture(suite, greg, 'planning-limit-slider');
      await greg.getByRole('tab', { name: 'Order requests', exact: true }).click();
      await greg.locator('.gcsp-orders-production > summary').click();
      const table = greg.getByRole('table', { name: 'Requested, confirmed and released cars', exact: true });
      assert.equal(await table.locator('thead th').count(), 6);
      screenshots.initial = await capture(suite, greg, 'planning-request-form');
      const form = greg.locator('.gcsp-orders-production form');
      for (const quantity of [1, 2]) {
        await form.getByLabel('Model', { exact: true }).selectOption(choice.model);
        await form.getByLabel('Derivative', { exact: true }).selectOption(choice.derivative);
        await form.getByLabel('Quantity', { exact: true }).fill(String(quantity));
        const response = await waitPost(greg, '/greg/orders', () => form.getByRole('button', { name: 'Submit request', exact: true }).click());
        commands.push({ operation: 'request', quantity, response }); good(response, 'Deliberate Request cars submission');
        await until(async () => (await readOrders()).requests.length === quantity, 'Exactly one request per deliberate submission');
        await until(() => form.getByRole('button', { name: 'Submit request', exact: true }).isEnabled(), 'Request readback settles');
      }
      states.requested = await readOrders(); assert.deepEqual(states.requested.requests.map(row => row.quantity).sort(), [1, 2]);
    });

    await t.test('AC3: Presenter confirms one actual request and delays the other', async () => {
      await showAdvanced(presenter);
      const controls = presenter.locator('gcsp-production-controls');
      await controls.getByRole('button', { name: 'Refresh Production requests', exact: true }).click();
      await until(() => controls.getByLabel('Request', { exact: true }).isEnabled(), 'Presenter reads actual outstanding requests');
      const confirmed = states.requested.requests.find(row => row.quantity === 1);
      const delayed = states.requested.requests.find(row => row.quantity === 2);
      await controls.getByLabel('Request', { exact: true }).selectOption(confirmed.requestId);
      await controls.getByLabel('Production response', { exact: true }).selectOption('confirm');
      await controls.getByLabel('Quantity to confirm', { exact: true }).fill('1');
      removeQueueFault = suite.failProductionQueueWrites(confirmed.requestId);
      t.after(() => removeQueueFault?.());
      const confirm = await waitPost(presenter, '/presenter/production', () => controls.getByRole('button', { name: 'Save production response', exact: true }).click());
      commands.push({ operation: 'confirm', response: confirm }); good(confirm, 'Presenter real confirmation');
      states.confirmed = await refresh(suite, greg);
      assert.equal(states.confirmed.requests.find(row => row.requestId === confirmed.requestId).stage, 'confirmed');
      assert.equal(states.confirmed.requests.find(row => row.requestId === confirmed.requestId).supplies[0].eligibleFrom, null);
      await greg.getByRole('table', { name: 'Requested, confirmed and released cars', exact: true })
        .getByText('Confirmed: 1 awaiting release queue; arrival date pending', { exact: true }).waitFor();
      assert.equal(await greg.locator('[data-order-result]').count(), 0,
        'A fresh confirmed projection clears the stale manual-request acknowledgement');
      screenshots.confirmed = await capture(suite, greg, 'production-confirmed');
      await until(() => controls.getByLabel('Request', { exact: true }).isEnabled(), 'Confirmation readback settles');
      await controls.getByLabel('Request', { exact: true }).selectOption(delayed.requestId);
      await controls.getByLabel('Production response', { exact: true }).selectOption('delay');
      const date = new Date(Date.parse(states.requested.asOf) + 7 * 86400000).toISOString().slice(0, 10);
      await controls.getByLabel('Delay until', { exact: true }).fill(date);
      await controls.getByLabel('Delay reason', { exact: true }).fill('Demonstration production delay');
      const response = await waitPost(presenter, '/presenter/production', () => controls.getByRole('button', { name: 'Save production response', exact: true }).click());
      commands.push({ operation: 'delay', date, response }); good(response, 'Presenter real delay');
      states.delayed = await refresh(suite, greg);
      const actual = states.delayed.requests.find(row => row.requestId === delayed.requestId);
      assert.equal(actual.stage, 'delayed'); assert.equal(actual.confirmedQuantity, 0); assert.equal(actual.outstandingQuantity, 2);
      assert.equal(actual.reason, 'Demonstration production delay'); assert.equal(actual.delayUntil.slice(0, 10), date);
      screenshots.delayed = await capture(suite, greg, 'production-delayed');
      screenshots.presenter = await capture(suite, presenter, 'presenter-production-controls');
    });

    await t.test('AC3: real queue failure and a lost acknowledgement recover through deliberate retry', async () => {
      const confirmed = states.confirmed.requests.find(row => row.quantity === 1);
      states.queueLost = await refresh(suite, greg);
      assert.equal(states.queueLost.requests.find(row => row.requestId === confirmed.requestId).supplies[0].queued, false);
      const refused = await waitPost(greg, '/greg/orders/queue', () => greg.getByRole('button', { name: 'Retry release queue', exact: true }).click());
      assert.equal(refused.status, 503); assert.equal(refused.body.status, 'unavailable');
      assert.equal(refused.body.code, 'supply-queue-unavailable');
      await greg.getByText(refused.body.reason, { exact: true }).waitFor();
      commands.push({ operation: 'queue-write-unavailable', response: refused });
      screenshots.queueLost = await capture(suite, greg, 'production-release-queue-retry');
      removeQueueFault();
      let receiveCommitted;
      const committed = new Promise(resolve => { receiveCommitted = resolve; });
      await greg.route('**/greg/orders/queue', async route => {
        const input = route.request().postDataJSON();
        const response = await route.fetch();
        const actual = { status: response.status(), body: await response.json() };
        await route.abort('failed'); receiveCommitted({ input, response: actual });
      }, { times: 1 });
      await greg.getByRole('button', { name: 'Retry release queue', exact: true }).click();
      const lostResponse = await committed; good(lostResponse.response, 'Queue recovery committed before its response was deliberately lost');
      commands.push({ operation: 'queue-response-lost', ...lostResponse });
      states.queuedAfterLostResponse = await refresh(suite, greg);
      assert.equal(states.queuedAfterLostResponse.requests.find(row => row.requestId === confirmed.requestId).supplies[0].queued, true);
      assert.equal(await greg.locator('.gcsp-orders-queue').count(), 0, 'Authoritative refresh removes the ordinary unqueued row');
      assert.equal(await greg.getByRole('button', { name: 'Retry release queue', exact: true }).count(), 1,
        'An explicit retained-command retry survives the authoritative queued projection');
      const retryRequest = greg.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/greg/orders/queue'));
      const queued = await waitPost(greg, '/greg/orders/queue', () => greg.getByRole('button', { name: 'Retry release queue', exact: true }).click());
      assert.deepEqual((await retryRequest).postDataJSON(), lostResponse.input, 'Explicit uncertain recovery preserves the original command identity');
      commands.push({ operation: 'queue', response: queued }); good(queued, 'Real deliberate queue recovery');
      states.retried = await refresh(suite, greg);
      assert.equal(states.retried.requests.length, 2, 'Queue recovery creates no new Production request');
      assert.equal(states.retried.requests.find(row => row.requestId === confirmed.requestId).supplies[0].queued, true);
      assert.deepEqual(semantics(states.retried), semantics(states.delayed), 'Recovery changes no confirmed/delayed quantities or stages');
      const again = good(await suite.call(greg, 'POST', '/greg/orders/queue', { commandId: globalThis.crypto.randomUUID(), requestId: confirmed.requestId }), 'Repeated queue recovery');
      assert.deepEqual(again.queued, [], 'Already queued supply is not queued twice');
      screenshots.retried = await capture(suite, greg, 'production-release-queue-recovered');
    });

    await t.test('AC4 evidence: immutable Node follows the same primary request/confirm/delay/retry scenario', async () => {
      await suite.visitFrozenNode({ gregPlanning: { choice, states, screenshots, delayDate: commands.find(row => row.operation === 'delay').date } },
        async replay => replay.visitGregPlanning());
      assert.equal(suite.receipt.nodeReplay.state, 'matched');
      assert.deepEqual(suite.receipt.consoleErrors, []);
    });
  });

test('FUCQ-559: actual configured learned-model differences retain source changed-cell emphasis',
  { timeout: 240000 }, async t => {
    const suite = await startComposition({ caseId: 'f559-learned' }); t.after(() => suite.close());
    const inputs = suite.receipt.coveredLearnedInputs = {
      source: 'LearnedPlanHttpBase.confirmBrief(sub-paula,true): estate, comfort50, sportiness50, Sameagain and registered430L',
    };
    const setup = async (name, actor, method, route, body) => {
      const response = await suite.call(actor, method, route, body); inputs[name] = response;
      return good(response, name);
    };
    const presenter = await suite.newPage('presenter-learned', 'demo-presenter', 'presenter');
    const clock = await setup('initialClock', presenter, 'GET', '/presenter/clock');
    const tick = await setup('firstPublicTick', presenter, 'POST', '/presenter/clock/tick', {
      tickId: 'f559-learned-initial-clock', expectedClockVersion: clock.clockVersion,
    });
    assert.equal(tick.state, 'completed');
    const employee = await suite.newPage('employee-learned', 'demo-paula', 'preferences');
    const editor = await setup('freshEditor', employee, 'GET', '/brief/editor');
    assert.equal(editor.initial.briefVersion, 0, 'The separate native covered scenario starts without a confirmed brief');
    const preferences = await setup('coveredPreferences', employee, 'POST', '/brief/preferences', {
      commandId: 'f559-covered-preferences', expectedBriefVersion: editor.initial.briefVersion, expectedDraftVersion: editor.initial.draftVersion,
      changes: { comfort: { value: 50 }, body: { value: ['estate'] }, sportiness: { value: 50 } },
      sameAgain: { contractId: editor.initial.currentCarRating.contractId, on: true },
    });
    const current = await setup('preferenceReadback', employee, 'GET', '/brief/editor');
    const brief = structuredClone(current.initial.brief);
    brief.essentials.boot = { ...brief.essentials.boot, value: 430, state: 'draft', source: 'employee' };
    const draft = await setup('covered430L', employee, 'POST', '/brief/draft', {
      commandId: 'f559-covered-boot', expectedBriefVersion: current.initial.briefVersion, expectedDraftVersion: preferences.draftVersion, brief,
    });
    await setup('confirmedBriefAndConsent', employee, 'POST', '/brief/confirm', {
      commandId: 'f559-covered-confirm', expectedBriefVersion: draft.baseBriefVersion, expectedDraftVersion: draft.draftVersion,
      consent: { search: true, hold: true },
    });
    const greg = await suite.newPage('greg-learned', 'demo-greg', 'greg/plan');
    const response = await suite.call(greg, 'GET', '/greg/order-plan');
    suite.receipt.learnedPlanning = { response };
    const value = good(response, 'Actual configured learned-model plan');
    assert.equal(value.learned.status, 'available', 'The native configured model supplies real learned figures');
    assert.equal(value.learned.differences.comparable, true);
    const table = greg.getByRole('table', { name: 'Baseline compared with learned model', exact: true }); await table.waitFor();
    const emphasis = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('th,td')).map(cell => !!cell.querySelector('strong'))));
    const differences = value.learned.differences;
    const changed = [...differences.derivatives].sort((a, b) => Number(b.changed === true) - Number(a.changed === true)
      || Number(Math.max(b.baseline, b.learned) > 0) - Number(Math.max(a.baseline, a.learned) > 0)).map(row => row.changed === true)
      .concat(['orderQuantity', 'coverage', 'unmetNeeds', 'spendMinor'].map(key => Number.isFinite(differences[key]?.delta) && differences[key].delta !== 0));
    assert.equal(changed.some(Boolean), true, 'This real producer scenario contains changed cells');
    assert.equal(emphasis.length, changed.length);
    for (let index = 0; index < changed.length; index++) assert.deepEqual(emphasis[index], [changed[index], false, changed[index], changed[index]],
      'Source name/learned/difference emphasis is conditional; baseline stays neutral');
    suite.receipt.learnedPlanning = { response, emphasis, screenshots: await capture(suite, greg, 'planning-learned-changed-cells'),
      setup: 'Separate fresh supported base+learned-model-v1 composition using the retained artifact; not the primary Main production parity scenario.',
      sourcePresentation: 'Frozen panel.js37–41 applies emphasis to name/learned/difference, with an un-emphasized baseline.',
      humanReview: 'Pending actual collaborator verdict.' };
    await suite.visitFrozenNode({ gregPresentation: { value, angularEmphasis: emphasis } }, async replay => replay.visitGregPresentation());
    assert.equal(suite.receipt.nodeReplay.state, 'presentation-matched');
    assert.deepEqual(suite.receipt.consoleErrors, []);
  });
