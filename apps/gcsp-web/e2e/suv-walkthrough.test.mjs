import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { showAdvanced, startComposition } from './composition.mjs';

const input = JSON.parse(readFileSync(new URL('../../../server/gcsp/fixtures/scenarios/suv-walkthrough-v1.json', import.meta.url)));
const good = (response, name) => {
  assert.equal(response.status, 200, name); assert.equal(response.body.status, 'ok', name); return response.body.value;
};
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.fail(message);
}
const values = (value) => Array.isArray(value) ? value : [value];
const bodyFor = (suite, id) => suite.plan.windows[0].stock.find((car) => car.orderUuid === id)?.facts.facts.body.value;
async function capture(suite, page, name, anchor) {
  if (anchor) await anchor.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.images].filter((image) => {
    const box = image.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight;
  }).every((image) => image.complete));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name} fits its viewport`);
  await suite.screenshot(page, name);
}

async function resetMain(suite, presenter, runIds, name) {
  const catalogue = good(await suite.call(presenter, 'GET', '/presenter/scenarios'), 'Actual scenario catalogue');
  const main = catalogue.scenarios.find((row) => row.scenarioId === input.reset.scenarioId);
  assert.equal(main?.availability.available, true, 'Main must actually be available for reset');
  assert.equal(main.fixtureVersion, input.reset.fixtureVersion);
  const before = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Before reset');
  await showAdvanced(presenter);
  await presenter.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(main.scenarioId);
  const reset = presenter.getByRole('button', { name: 'Reset scenario', exact: true });
  await reset.focus(); await presenter.keyboard.press('Enter');
  await presenter.getByRole('heading', { name: 'Confirm scenario reset', exact: true }).waitFor();
  await capture(suite, presenter, `${name}-reset-review`, presenter.locator('.presenter-confirmation'));
  const response = presenter.waitForResponse((row) => row.request().method() === 'POST' && row.url().endsWith('/presenter/scenarios/reset'));
  await presenter.getByRole('button', { name: 'Confirm reset', exact: true }).press('Enter');
  const actual = await response;
  const result = good({ status: actual.status(), body: await actual.json() }, 'Actual Main reset');
  assert.equal(result.retiredRunId, before.runId); assert.notEqual(result.activatedRunId, before.runId);
  assert.ok(!runIds.includes(result.activatedRunId)); runIds.push(result.activatedRunId);
  suite.receipt.walkthroughs.push({ name, reset: result });
  const viewport = presenter.viewportSize(); await presenter.close();
  const currentPresenter = await suite.newPage(`presenter-${name}`, 'demo-presenter', 'presenter');
  await currentPresenter.setViewportSize(viewport);
  const employee = await suite.newPage(`paula-${name}`, 'demo-paula', 'preferences');
  const context = good(await suite.call(employee, 'GET', '/context'), 'Employee context after actual reset');
  assert.equal(context.runId, result.activatedRunId);
  const brief = good(await suite.call(employee, 'GET', '/brief'), 'Main starting brief').brief;
  assert.deepEqual(values(brief.preferences.body.value), ['estate']);
  assert.equal(brief.essentials.seats.value, input.mainStart.essentials.seats);
  assert.equal(brief.essentials.charging.value, input.mainStart.essentials.charging);
  const activity = good(await suite.call(employee, 'GET', '/activity'), 'Main reset activity');
  assert.equal(activity.currentOffer ?? null, null, 'Reset must clear the prior offer before real processing');
  return { employee, presenter: currentPresenter, record: suite.receipt.walkthroughs.at(-1) };
}

async function slider(page, selector, value) {
  const control = page.locator(selector); await control.focus(); await control.press('Home');
  for (let index = 0; index < value; index++) await control.press('ArrowRight');
  assert.equal(await control.inputValue(), String(value));
  assert.equal(await control.evaluate((node) => node === document.activeElement), true);
}

async function prepare(suite, employee, variant, record) {
  await employee.getByRole('heading', { name: 'Your preferences', exact: true, level: 1 }).waitFor();
  const more = employee.locator('.gcsp-brief-more');
  if (await more.count() && await more.getAttribute('open') === null) await more.locator('summary').click();
  const expected = input[variant];
  if (variant === 'suv') {
    const group = employee.locator('#preference-body');
    const suv = group.getByRole('checkbox', { name: 'SUV', exact: true });
    await suv.focus(); await employee.keyboard.press('Space');
    await until(async () => await suv.getAttribute('aria-checked') === 'true', 'SUV renders selected after keyboard activation');
    const estate = group.getByRole('checkbox', { name: 'Estate', exact: true });
    await estate.press('Space');
    await until(async () => await estate.getAttribute('aria-checked') === 'false', 'Estate renders deselected after keyboard activation');
    assert.equal(await suv.getAttribute('aria-checked'), 'true');
    await suv.focus(); assert.equal(await suv.evaluate((node) => node === document.activeElement), true);
  }
  for (const key of ['comfort', 'sportiness']) {
    await slider(employee, `#preference-${key}`, expected.preferences[key].value);
    await slider(employee, `#importance-${key}`, expected.preferences[key].importance);
  }
  await employee.getByRole('radio', { name: 'Engage Buddy', exact: true }).check();
  const response = employee.waitForResponse((row) => row.request().method() === 'POST' && row.url().endsWith('/brief/confirm'));
  await employee.getByRole('button', { name: 'Save your preferences', exact: true }).click();
  const actual = await response;
  record.saved = good({ status: actual.status(), body: await actual.json() }, 'Normal explicit preference confirmation');
  const saved = record.saved.brief;
  for (const [key, preference] of Object.entries(expected.preferences)) {
    assert.deepEqual(values(saved.preferences[key].value), values(preference.value));
    assert.equal(saved.preferences[key].importance, preference.importance);
  }
  assert.equal(saved.essentials.seats.value, expected.essentials.seats);
  assert.equal(saved.essentials.charging.value, expected.essentials.charging);
  assert.equal(saved.buddy.searchConsent, true); assert.equal(saved.buddy.holdConsent, true);
  await capture(suite, employee, `${record.name}-saved-preferences`, employee.locator('#preference-body'));
  await employee.getByText('No stock is available for this preview.', { exact: true }).waitFor();
  await capture(suite, employee, `${record.name}-before-release-empty`, employee.locator('.gcsp-brief-preview'));
}

async function release(suite, employee, presenter, record) {
  let clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Actual reset clock');
  const target = input.stock.releaseAt;
  const beforeTick = new Date(Date.parse(target) - clock.controls.step.value * 1000).toISOString();
  assert.ok(Date.parse(clock.now) < Date.parse(beforeTick));
  await showAdvanced(presenter);
  await presenter.getByText('Advanced clock controls', { exact: true }).click();
  await presenter.getByLabel('Advance by', { exact: true }).selectOption('to');
  await presenter.getByLabel('Named time or instant', { exact: true }).fill(beforeTick);
  await presenter.getByRole('button', { name: 'Advance clock', exact: true }).click();
  await until(async () => {
    clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Advanced clock'); return Date.parse(clock.now) === Date.parse(beforeTick);
  }, 'The actual reset clock must advance to the retained release minus one step');
  await presenter.getByRole('button', { name: /^Step \d+ seconds$/ }).click();
  let activity;
  await until(async () => {
    activity = good(await suite.call(employee, 'GET', '/activity'), 'Actual matching activity');
    return activity.currentOffer?.state === 'active';
  }, 'Actual released stock must be processed into an offer');
  clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Actual release clock'); assert.equal(Date.parse(clock.now), Date.parse(target));
  const offer = activity.currentOffer;
  assert.equal(bodyFor(suite, offer.orderUuid), input[record.variant].preferences.body.value);
  record.clock = clock; record.activity = activity;
  record.offer = good(await suite.call(employee, 'GET', `/offers/${encodeURIComponent(offer.offerRef.offerId)}`), 'Actual offer projection');
  await employee.goto(`${suite.origins.web}/gcsp/offers/${encodeURIComponent(offer.offerRef.offerId)}`, { waitUntil: 'domcontentloaded' });
  await employee.getByRole('button', { name: 'Decline offer', exact: true }).waitFor();
  await capture(suite, employee, `${record.name}-computed-offer`);
  await employee.goto(`${suite.origins.web}/gcsp/activity`, { waitUntil: 'domcontentloaded' });
  await employee.getByRole('link', { name: 'View offer', exact: true }).first().waitFor();
  await capture(suite, employee, `${record.name}-activity`);
  return offer;
}

test('FUCQ-340: actual Main reset and normal preference/release processing replay estate and SUV walkthroughs', { timeout: 540000 }, async (t) => {
  const suite = await startComposition({ caseId: 'f340' }); t.after(() => suite.close());
  suite.receipt.walkthroughs = [];
  try {
    let presenter = await suite.newPage('presenter-initial', 'demo-presenter', 'presenter');
    const runIds = []; const results = {};
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      for (const variant of ['baseline', 'suv']) {
        const name = `${variant}-${width}`;
        await t.test(`AC1–4: ${name} reset, prepare, compute and render`, async () => {
          await presenter.setViewportSize({ width, height });
          const state = await resetMain(suite, presenter, runIds, name); presenter = state.presenter;
          state.record.variant = variant; await state.employee.setViewportSize({ width, height });
          await prepare(suite, state.employee, variant, state.record);
          const offer = await release(suite, state.employee, presenter, state.record);
          const quote = state.record.offer.quote;
          assert.equal(quote.orderUuid, offer.orderUuid, 'The rendered quote belongs to the computed source car');
          const facts = quote.facts.facts;
          assert.ok(facts.eligibilityModelKey.value, 'The computed offer has a source model identity');
          // The normal allocator seeds equal-fit ties with the fresh run ID. Replay promises the
          // same model, fit and terms; exact source paint/upholstery may differ between tied cars.
          const semantic = {
            model: facts.eligibilityModelKey.value, body: bodyFor(suite, offer.orderUuid),
            fuel: facts.fuel.value, seats: facts.seats.value, decision: quote.decision,
            policyVersion: quote.policyVersion, briefVersion: quote.briefVersion,
            terms: quote.terms, allowance: quote.allowance,
          };
          if (results[variant]) assert.deepEqual(semantic, results[variant], 'Repeat reset recomputes the same model, eligible fit and terms');
          results[variant] = semantic; await state.employee.close();
        });
      }
    }
    assert.equal(runIds.length, 4); assert.equal(new Set(runIds).size, 4);
    assert.notEqual(results.baseline.model, results.suv.model);
    assert.deepEqual(suite.receipt.consoleErrors, [], 'The checked walkthroughs have no app runtime errors');
    suite.receipt.namedReset = { used: true, count: runIds.length, runIds, scenarioId: input.reset.scenarioId };
    suite.receipt.checks.f340 = true; await presenter.close();
  } catch (error) {
    suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  }
});
