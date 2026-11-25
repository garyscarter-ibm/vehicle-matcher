import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { startComposition } from './composition.mjs';

const good = (response, name) => {
  assert.equal(response.status, 200, name); assert.equal(response.body.status, 'ok', name); return response.body.value;
};
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 150)); }
  assert.fail(message);
}

// Release the Main window through the public presenter controls; Buddy is paused first so no offer holds the slot.
async function releaseStock(suite, employee, presenter) {
  const advanced = presenter.locator('.gcsp-console-mode');
  await advanced.waitFor();
  if (await advanced.getAttribute('aria-pressed') === 'false') await advanced.click();
  await until(async () => await advanced.getAttribute('aria-pressed') === 'true', 'The presenter shows its advanced controls');
  await suite.prepareInitialBrief(employee, presenter);
  const editor = good(await suite.call(employee, 'GET', '/brief/editor'), 'Actual brief editor').initial;
  good(await suite.call(employee, 'POST', '/brief/pause-search', { commandId: `e2e:${randomUUID()}`,
    expectedBriefVersion: editor.briefVersion, expectedDraftVersion: editor.draftVersion }), 'Public pause so allocation leaves the slot free');
  let clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Initial clock');
  const first = clock.clockVersion;
  await presenter.getByRole('button', { name: 'Next release', exact: true }).click();
  await until(async () => { clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Clock after Next release'); return clock.clockVersion > first; },
    'The public Next release completes');
  const target = suite.input.clock.nextRelease.at;
  if (Date.parse(clock.now) < Date.parse(target)) {
    const step = clock.controls.step.value;
    const seconds = (Date.parse(target) - Date.parse(clock.now)) / 1000 - step;
    assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
    await presenter.getByText('Advanced clock controls', { exact: true }).click();
    await presenter.getByLabel('Seconds', { exact: true }).fill(String(seconds));
    await presenter.getByRole('button', { name: 'Advance clock', exact: true }).click();
    await until(async () => { clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Advanced clock');
      return Date.parse(clock.now) === Date.parse(target) - step * 1000; }, 'The public advance reaches the release minus a step');
    await presenter.getByRole('button', { name: /^Step \d+ seconds$/ }).click();
    await until(async () => { clock = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Released clock'); return clock.now === target; },
      'The public tick reaches the release');
  }
  await chooseOrderDetails(suite, employee);
  let stock;
  await until(async () => { stock = await suite.call(employee, 'GET', '/manual/stock');
    return stock.status === 200 && stock.body.value.decisions?.length > 0; }, 'Actual released stock is browsable');
  return good(stock, 'Actual manual stock');
}

// The stock read needs saved order choices, so use the real account form (replacement is Main's only action).
async function chooseOrderDetails(suite, employee) {
  await employee.goto(`${suite.origins.web}/gcsp/account`, { waitUntil: 'domcontentloaded' });
  await employee.getByRole('button', { name: 'Choose a replacement', exact: true }).click();
  const form = employee.locator('#choices-panel');
  await form.waitFor();
  await form.locator('#choices-driverId').selectOption('driver:employee-paula');
  await form.locator('#choices-contractOptionId').selectOption('twelve-month-12000');
  await form.locator('#choices-requestedCollectionDate').fill(await form.locator('#choices-requestedCollectionDate').getAttribute('min'));
  await form.locator('#choices-collectionLocationId').selectOption('demo-collection-centre');
  const mileage = form.locator('#choices-expectedReturnMileage');
  if (await mileage.count()) await mileage.fill('5000');
  for (const [id, value] of [['#choices-phone', '07700 900123'], ['#choices-email', 'paula@example.test']]) {
    if (!await form.locator(id).inputValue()) await form.locator(id).fill(value);
  }
  await form.getByRole('button', { name: 'Find a car', exact: true }).click();
  await employee.waitForURL((url) => url.pathname === '/gcsp/stock');
}

// Save the contact and return mileage through the real review-details form; declarations stay unticked.
async function saveReviewDetails(suite, page) {
  const form = page.locator('#manual-details-form');
  await form.waitFor();
  for (const [id, value] of [['#manual-contact-phone', '07700 900123'], ['#manual-contact-email', 'paula@example.test'], ['#manual-return-mileage', '5000']]) {
    const field = form.locator(id);
    if (await field.count() && !await field.inputValue()) await field.fill(value);
  }
  const save = form.getByRole('button', { name: 'Save review details', exact: true });
  if (!await save.isEnabled()) return;
  const saved = page.waitForResponse((row) => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/manual/review-details'));
  await save.click();
  assert.equal((await saved).status(), 200, 'The actual review details save');
}

async function assertReview(suite, page, car, width, stage) {
  const card = page.locator('section.manual-vehicle');
  await card.waitFor();
  await page.locator('#manual-details-form').waitFor();
  await until(async () => await page.locator('.manual-review, .manual-summary').first().getAttribute('aria-busy') !== 'true', `${width} ${stage}: reads settle`);
  assert.equal(await page.locator('#manual-details-status').innerText().then((t) => t.includes('unavailable')), false, `${width} ${stage}: review details load`);
  const name = card.locator('#manual-car-name, #manual-summary-car');
  await until(async () => (await name.innerText()) === car.name, `${width}: the selected-car card shows ${car.name}`);
  const text = await card.innerText();
  for (const absent of ['Car name not supplied', 'No image available for this car']) assert.ok(!text.includes(absent), `${width} ${stage}: card has no "${absent}"`);
  const identity = await card.locator('p.gcsp-note').first().innerText();
  assert.ok([`Car order ${car.orderNumber}`, `Car ID ${car.orderUuid}`].includes(identity), `${width}: exact car identity, saw "${identity}"`);
  const image = card.locator('img.vm-card-photo');
  await image.waitFor();
  await until(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), `${width}: the supplied photo loads`);
  const src = await image.getAttribute('src');
  assert.ok(car.sources.includes(src), `${width}: the img src is the supplied photo, saw ${src}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}: the page fits its viewport`);
  await suite.screenshot(page, `${stage}-${width}`);
  return { identity, src };
}

test('FUCQ-520: the actual manual review shows the pinned car name and photo at 1280 and 390', { timeout: 540000 }, async (t) => {
  const suite = await startComposition({ caseId: 'f520' }); t.after(() => suite.close());
  try {
    const employee = await suite.newPage('employee', 'demo-paula', 'account');
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    const stock = await releaseStock(suite, employee, presenter);
    assert.equal(stock.heldOffer ?? null, null, 'No held offer blocks review');
    await employee.goto(`${suite.origins.web}/gcsp/stock`, { waitUntil: 'domcontentloaded' });
    const card = employee.locator('article.gcsp-vehicle-card').filter({ has: employee.locator('button:enabled', { hasText: 'Review this car' }) }).first();
    await card.waitFor();
    const orderUuid = await card.getAttribute('data-member-id');
    const decision = stock.decisions.find((row) => row.orderUuid === orderUuid);
    assert.ok(decision, 'The chosen card is in the actual stock response');
    assert.equal(decision.gateStatus, 'eligible');
    const display = decision.snapshot.display;
    assert.ok(display.name, 'The actual snapshot supplies a car name');
    const sources = [display.photo, ...(display.images ?? []).map((image) => image.src)].filter(Boolean);
    assert.ok(sources.length, 'The actual snapshot supplies a photo');
    const car = { orderUuid, orderNumber: decision.orderNumber, name: display.name, sources };

    await card.getByRole('button', { name: 'Review this car', exact: true }).click();
    await employee.waitForURL((url) => url.pathname === '/gcsp/manual/review');
    const claimed = employee.waitForResponse((row) => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/manual/claim'));
    await employee.getByRole('button', { name: 'Reserve this car to review', exact: true }).click();
    assert.equal((await claimed).status(), 200, 'The actual claim is acquired');

    const claim = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual claim readback');
    assert.equal(claim.quote.orderUuid, orderUuid, 'The quote pins the chosen car');
    assert.equal(claim.quote.facts.facts.display.name, display.name, 'The quote facts carry the snapshot display name');
    suite.receipt.f520 = { orderUuid, name: display.name, sources, quoteId: claim.quote.quoteId, widths: {} };

    const sizes = [[1280, 800], [390, 844]];
    for (const [width, height] of sizes) {
      await employee.setViewportSize({ width, height });
      suite.receipt.f520.widths[width] = await assertReview(suite, employee, car, width, 'preview');
    }
    await employee.setViewportSize({ width: 1280, height: 800 });
    await saveReviewDetails(suite, employee);
    const reviewed = employee.waitForResponse((row) => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/manual/claim/review'));
    await employee.getByRole('button', { name: 'Continue to order review', exact: true }).click();
    assert.equal((await reviewed).status(), 200, 'The actual order review begins');
    await employee.getByRole('heading', { name: 'Review your order', exact: true, level: 1 }).waitFor();
    const phase = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual claim in order review');
    assert.equal(phase.hold.phase, 'order-review'); assert.equal(phase.quote.orderUuid, orderUuid);
    assert.equal(phase.quote.facts.facts.display.name, display.name);
    suite.receipt.f520.orderReview = {};
    for (const [width, height] of sizes) {
      await employee.setViewportSize({ width, height });
      suite.receipt.f520.orderReview[width] = await assertReview(suite, employee, car, width, 'order-review');
    }
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No app runtime errors in the checked flow');
    suite.receipt.checks.f520 = true;
  } catch (error) {
    suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  }
});
