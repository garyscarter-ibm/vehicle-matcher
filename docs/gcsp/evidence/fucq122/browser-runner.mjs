import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { buildServer } from '../../../../server/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../../../../server/gcsp/repository/index.js';
import { PolicyService } from '../../../../server/gcsp/policy/index.js';
import { createDemoRuntime } from '../../../../server/gcsp/clock/index.js';
import { BriefService } from '../../../../server/gcsp/brief/index.js';
import { RenewalCaseService } from '../../../../server/gcsp/cases/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../../../../server/gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../../../../server/gcsp/manual-context/fixtures.js';
import { createGregDemandService } from '../../../../server/gcsp/greg/index.js';
import { preference, essential, stock, providerValue } from '../../../../server/test/helpers/employee-recommendation.js';
import { FIXTURE_NAMES } from '../../../../blocks/gcsp/cases/fixtures.js';
import { QUEUE_FIXTURE_NAMES } from '../../../../blocks/gcsp/cases/queue-fixtures.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = process.env.FUCQ122_OUTPUT;
const scratch = process.env.FUCQ122_SCRATCH;
const chunk = process.env.FUCQ122_CHUNK;
assert.ok(output && scratch && chunk, 'Launch only through the bounded supervisor after a browser lane grant.');
const viewport = chunk.endsWith('narrow') ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const report = { state: 'incomplete', chunk, viewport, source: process.env.FUCQ122_SOURCE,
  checks: [], captures: [], keyboard: [], errors: [], network: [], expectedTransportFailures: [], setup: [],
  boundary: 'Actual isolated memory-services HTTP and repository assets. Delivered runtime/Greg host and offer/lifecycle producers remain separate acceptance.',
  cookieOverride: 'localhost only: identity.session.sameSite=Lax, secureCookies=false' };
const save = () => writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (reply) => { assert.equal(reply.status, 'ok', JSON.stringify(reply)); return reply.value; };
const check = (name, evidence = {}) => report.checks.push({ name, ...evidence });
const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const store = createMemoryStore();
const repository = createMemoryRepository({ store });
const state = () => structuredClone(store.state);
const assertState = (before, message = 'Repository state unchanged') => assert.equal(inputDigest(state()), inputDigest(before), message);
let server; let backend; let chrome; let browser; let origin; let paula; let greg; let presenter; let clock; let identity;
let transportPhase = null;
const contexts = []; const pendingNetwork = new Set(); const ports = []; const processRecords = [];
const identityOf = (pid) => ({ pid, start: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() });
const ledger = async () => {
  const target = process.env.FUCQ122_PROCESS_LEDGER; const temp = target + '.tmp';
  await writeFile(temp, JSON.stringify({ identities: processRecords, ports })); await rename(temp, target);
};
const safeBody = (text) => {
  try { const body = JSON.parse(text); return Object.fromEntries(['commandId', 'caseId', 'expectedVersion', 'status', 'reason', 'nextAction', 'dueAt', 'remedy']
    .filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])); } catch { return null; }
};
const safeResult = (body) => ({ status: body?.status, case: body?.value?.case ? { caseId: body.value.case.caseId, version: body.value.case.version, status: body.value.case.status } : undefined,
  caseCount: body?.value?.cases?.length, briefVersion: body?.value?.brief?.briefVersion,
  nextStatuses: body?.value?.nextStatuses,
  availability: body?.value?.options ? Object.fromEntries(Object.entries(body.value.options).map(([key, value]) => [key, value.available])) : undefined });
async function api(actor, suffix, body) {
  const response = await actor.context.request[body ? 'post' : 'get'](origin + '/api/gcsp' + suffix,
    body ? { headers: { Origin: origin }, data: body } : {});
  const outcome = await response.json();
  report.network.push({ type: 'setup-or-assertion-api', actor: actor.name, method: body ? 'POST' : 'GET', path: suffix.split('?')[0],
    request: body ? safeBody(JSON.stringify(body)) : undefined, ...safeResult(outcome) });
  return outcome;
}
async function settled(page, selector = '.gcsp-case-content, .gcsp-case-queue-content') {
  await page.locator(selector).first().waitFor({ state: 'visible' });
  await page.waitForFunction((query) => document.querySelector(query)?.getAttribute('aria-busy') === 'false', selector);
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function focusState(page) {
  return page.evaluate(() => {
    const node = document.activeElement; const style = getComputedStyle(node); const box = node.getBoundingClientRect();
    return { tag: node.tagName, id: node.id, text: (node.getAttribute('aria-label') || node.textContent || node.getAttribute('name') || '').trim().slice(0, 100),
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      inViewport: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth };
  });
}
async function tabTo(page, target, backwards = false) {
  await target.waitFor({ state: 'visible' });
  for (let count = 0; count < 160; count++) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      report.keyboard.push({ action: 'tab-to-control', direction: backwards ? 'Shift+Tab' : 'Tab', presses: count, focus: await focusState(page) }); return;
    }
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  throw Error('Keyboard could not reach ' + await target.textContent());
}
async function activate(page, name, key = 'Enter', backwards = false) {
  const target = button(page, name); assert.ok(await target.isEnabled(), name + ' is enabled');
  await tabTo(page, target, backwards); const before = await focusState(page); await page.keyboard.press(key);
  report.keyboard.push({ action: name, key, before, after: await focusState(page) });
}
async function select(page, label, value) {
  const control = page.getByLabel(label, { exact: true }); await tabTo(page, control);
  const choices = await control.evaluate((node) => [...node.options].map((option) => ({ value: option.value, disabled: option.disabled })));
  const target = choices.findIndex((option) => option.value === value && !option.disabled); assert.ok(target >= 0, label + ': projected option exists');
  const keys = ['Home']; await page.keyboard.press('Home');
  // Some selectors redraw on every change. Resolve the labelled control anew after each real key.
  for (let attempt = 0; attempt <= choices.length * 2 + 2; attempt++) {
    const selected = await control.evaluate((node) => ({ index: node.selectedIndex, value: node.value }));
    if (selected.value === value) break;
    if (attempt === choices.length * 2 + 2) throw Error(label + ': keyboard selection did not reach the projected value');
    await tabTo(page, control);
    const key = selected.index < target ? 'ArrowDown' : 'ArrowUp'; keys.push(key); await page.keyboard.press(key);
  }
  assert.equal(await control.inputValue(), value); await page.keyboard.press('Tab'); keys.push('Tab');
  report.keyboard.push({ action: label, method: 'native keyboard selection', selectedValue: value, observedOptionIndex: target, keys, after: await focusState(page) });
}
async function enterText(page, label, value) {
  const control = page.getByLabel(label, { exact: true }); await tabTo(page, control); await control.fill(value);
  report.keyboard.push({ action: label, method: 'automated native text/date entry through fill', after: await focusState(page) });
}
async function capture(page, name, { target, boundary = 'actual API and renderer', visibleFocus = false } = {}) {
  if (target) await target.scrollIntoViewIfNeeded();
  const shape = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    status: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent.trim()),
    text: document.body.innerText.slice(0, 16000) }));
  assert.ok(shape.scrollWidth <= shape.width, name + ': document horizontal overflow');
  const focus = await focusState(page);
  if (visibleFocus) { assert.ok(focus.inViewport, name + ': focused control is visible'); assert.notEqual(focus.outlineStyle, 'none', name + ': focus outline'); assert.notEqual(focus.outlineWidth, '0px'); }
  const file = name + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false });
  report.captures.push({ name, file, boundary, source: report.source, ...shape, focus, keyboardTraceThrough: report.keyboard.length }); await save();
}
async function navigate(actor, surface = 'help') {
  await actor.page.goto(origin + (surface === 'help' ? '/gcsp-help.html' : '/gcsp-case-queue.html'));
  await settled(actor.page); return actor.page;
}
async function discloseHelp(page) {
  const summary = page.locator('details.gcsp-case-entry > summary');
  if (await summary.locator('..').getAttribute('open') === null) {
    await tabTo(page, summary); await page.keyboard.press('Space');
    report.keyboard.push({ action: 'Open help disclosure', key: 'Space', focus: await focusState(page) });
  }
}
async function prepareHelp(page, reason = 'Please review my replacement before the contract ends.') {
  await discloseHelp(page); await activate(page, 'Ask for help');
  await enterText(page, 'What do you need help with?', reason);
  await activate(page, 'Review help request');
}
async function openCase(caseId) {
  const page = greg.page; await navigate(greg, 'queue');
  await select(page, 'Case to work', caseId); await activate(page, 'Open selected case'); await settled(page);
  await page.locator('.gcsp-case-work [data-case-id]').waitFor(); return page;
}
async function updateForm(status, { remedyKey = '', decision, preferenceValue, until } = {}) {
  const page = greg.page;
  await select(page, 'Next case status', status);
  await enterText(page, 'Reason for this update', 'Scheme team reviewed this synthetic renewal.');
  await enterText(page, 'Next action', 'Contact Paula with the reviewed next action.');
  await enterText(page, 'Next action due, demo clock (UTC)', '2026-11-07T12:00:00');
  if (remedyKey) await select(page, 'Remedy to record', remedyKey);
  if (decision) await enterText(page, 'Authorised scheme-team decision', decision);
  if (preferenceValue !== undefined) {
    const input = page.getByLabel('Proposed preference value', { exact: true });
    if (await input.evaluate((node) => node.tagName === 'SELECT')) await select(page, 'Proposed preference value', preferenceValue);
    else await enterText(page, 'Proposed preference value', preferenceValue);
  }
  if (until) await enterText(page, 'Proposed contract end (calendar date)', until);
}
async function confirmUpdate(status, options = {}) {
  await updateForm(status, options); const before = state();
  await activate(greg.page, 'Review case update'); assertState(before, 'Review is read-only');
  await capture(greg.page, 'review-' + report.captures.length, { target: greg.page.locator('.gcsp-case-confirmation') });
  await activate(greg.page, 'Confirm case update'); await settled(greg.page);
  assert.match(await greg.page.locator('.gcsp-case-status').innerText(), /recorded/);
  const c = ok(await api(greg, '/scheme-team/cases')).cases[0]; assert.equal(c.status, status); return c;
}
async function confirmedBrief() {
  const data = { schemaVersion: 1, preferences: { body: preference('estate'), comfort: preference(75, 0) },
    essentials: { seats: essential(5), charging: { value: null, operator: 'equals', unit: null, state: 'needs-confirmation', source: 'employee' } } };
  ok(await api(paula, '/brief/draft', { commandId: 'browser-brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: data }));
  const before = ok(await api(paula, '/brief/confirm', { commandId: 'browser-brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } })).brief;
  ok(await repository.transaction(paula.session.context, command('recorded-decline-setup'), (tx) => tx.insert('decisions', {
    runId: paula.session.context.runId, decisionId: 'synthetic-recorded-decline', employeeId: paula.session.context.employeeId,
    offerId: 'synthetic-prior-offer', decision: 'decline', versions: { brief: before.briefVersion } })));
  report.setup.push('Actual BriefService draft/confirmation; explicitly synthetic prior decline record, not an offer-decision producer.'); return before;
}
async function journey() {
  const page = await navigate(paula); const before = state();
  await capture(page, '01-paula-no-case'); await prepareHelp(page);
  assertState(before); await capture(page, '02-help-review', { target: page.locator('.gcsp-case-confirmation') });
  await activate(page, 'Cancel', 'Enter', true); assertState(before); check('Opening, review and keyboard cancel are read-only');
  await prepareHelp(page); await activate(page, 'Confirm help request'); await settled(page);
  await capture(page, '03-help-confirmed-status', { visibleFocus: true });
  let c = ok(await api(greg, '/scheme-team/cases')).cases[0]; assert.equal(c.trigger.type, 'employee-request'); assert.equal(c.owner.role, 'scheme-team');
  await openCase(c.caseId); await select(greg.page, 'Sort cases', 'status'); await select(greg.page, 'Sort cases', 'deadline');
  await capture(greg.page, '04-greg-queue'); c = await confirmUpdate('in-progress');
  await capture(greg.page, '05-greg-in-progress-status', { visibleFocus: true });
  c = await confirmUpdate('remedy-proposed', { remedyKey: 'manualDecision', decision: 'Authorised synthetic manual review, contact the employee.' });
  await navigate(paula); assert.match(await page.locator('[data-case-id]').innerText(), /Authorised synthetic manual review/);
  await capture(page, '06-paula-manual-remedy', { target: page.locator('[data-case-id]') });
  const oldBrief = await confirmedBrief(); await openCase(c.caseId); c = await confirmUpdate('in-progress');
  const projection = ok(await api(greg, '/scheme-team/cases/options?caseId=' + encodeURIComponent(c.caseId)));
  const index = projection.options.preferenceRelaxations.items.findIndex((item) => item.path === 'preferences.body.value'); assert.ok(index >= 0);
  const choice = projection.options.preferenceRelaxations.items[index]; const next = choice.values.indexOf('suv'); assert.ok(next >= 0);
  c = await confirmUpdate('remedy-proposed', { remedyKey: 'preferenceRelaxations:' + index, preferenceValue: String(next) });
  await capture(greg.page, '07-greg-preference-proposed', { target: greg.page.locator('[data-case-id]') });
  await navigate(paula); await capture(page, '08-paula-waiting', { target: page.locator('[data-case-id]') });
  await activate(page, 'Review body change'); await capture(page, '09-paula-single-change-review', { target: page.locator('.gcsp-case-confirmation') });
  await activate(page, 'Confirm preference change'); await settled(page); await capture(page, '10-paula-confirmed-status', { visibleFocus: true });
  const afterBrief = ok(await api(paula, '/brief')).brief;
  assert.equal(afterBrief.briefVersion, oldBrief.briefVersion + 1); assert.equal(afterBrief.preferences.body.value, 'suv');
  assert.deepEqual({ ...afterBrief.preferences, body: { ...afterBrief.preferences.body, value: oldBrief.preferences.body.value } }, oldBrief.preferences);
  assert.deepEqual(afterBrief.essentials, oldBrief.essentials);
  assert.equal(ok(await api(paula, '/cases')).cases[0].status, 'remedy-proposed');
  await navigate(paula); assert.match(await page.locator('[data-case-id]').innerText(), /You confirmed this preference change/);
  await openCase(c.caseId); c = await confirmUpdate('resolved'); await capture(greg.page, '11-resolved');
  c = await confirmUpdate('closed'); await capture(greg.page, '12-closed');
  await navigate(paula); const history = page.locator('details.gcsp-case-history');
  await tabTo(page, history.locator('summary')); await page.keyboard.press('Space');
  report.keyboard.push({ action: 'Show dated case history', key: 'Space', focus: await focusState(page) });
  await capture(page, '13-paula-closed-history', { target: history });
  assert.equal(ok(await api(paula, '/cases')).cases[0].history.at(-1).actorRole, 'scheme-team');
  check('Actual help, queue manual/preference updates, employee one-change, resolved and closed survive reload', { caseId: c.caseId, briefBefore: oldBrief.briefVersion, briefAfter: afterBrief.briefVersion });
}
async function optionsDeadline() {
  // Actual registered handler consumes a supplied test contract date; no lifecycle receipt is fabricated.
  ok(await repository.transaction(paula.session.context, command('synthetic-deadline-date'), async (tx) => {
    const ref = { table: 'employees', key: { runId: paula.session.context.runId, employeeId: paula.session.context.employeeId } };
    const row = (await tx.get(ref)).value;
    return tx.compareAndSwap(ref, row.version, { contract: { ...row.contract, manualContext: { ...row.contract.manualContext,
      contracts: row.contract.manualContext.contracts.map((item) => item.status === 'current' ? { ...item, contractEndDate: '2026-11-12' } : item) } } });
  }));
  report.setup.push('Synthetic current contract end 2026-11-12, supplied through repository transaction.');
  const clockState = ok(await api(presenter, '/presenter/clock'));
  const input = { eventId: 'actual-browser-deadline-tick', expectedClockVersion: clockState.clockVersion, inputDigest: inputDigest('actual-browser-deadline-tick') };
  const tick = await api(presenter, '/presenter/clock/tick', input); assert.ok(ok(tick).handlerOrder.some((row) => row.handlerId === 'renewal-risk-cases'));
  const replayBefore = state(); assert.deepEqual(await api(presenter, '/presenter/clock/tick', input), tick); assertState(replayBefore);
  let c = ok(await api(paula, '/cases')).cases[0]; assert.equal(c.trigger.type, 'renewal-deadline'); assert.equal(c.history[0].actorId, 'renewal-risk-clock');
  await navigate(paula); await capture(paula.page, '01-actual-clock-deadline-case', { target: paula.page.locator('[data-case-id]') });
  await openCase(c.caseId); await capture(greg.page, '02-deadline-queue-options');
  await capture(greg.page, '02b-server-options-without-confirmed-brief', { target: greg.page.getByLabel('Remedy to record', { exact: true }) }); check('Actual authenticated clock handler and replay', { handler: 'renewal-risk-cases', caseId: c.caseId });
  await confirmedBrief();
  const currentClock = ok(await api(presenter, '/presenter/clock'));
  const bySeconds = Math.max(0, (Date.parse('2026-11-05T12:00:00.000Z') - Date.parse(currentClock.now)) / 1000);
  if (bySeconds) ok(await api(presenter, '/presenter/clock/advance', { commandId: 'synthetic-noon', expectedClockVersion: currentClock.clockVersion, bySeconds }));
  const candidate = stock(122);
  ok(await repository.transaction(paula.session.context, command('synthetic-exact-stock-and-facts'), async (tx) => {
    const ref = { table: 'employees', key: { runId: paula.session.context.runId, employeeId: paula.session.context.employeeId } };
    const employee = (await tx.get(ref)).value;
    ok(await tx.compareAndSwap(ref, employee.version, { contract: { ...employee.contract, manualContext: { ...employee.contract.manualContext, employeeFacts: providerValue().employeeFacts } } }));
    return tx.insert('stock', { runId: paula.session.context.runId, orderUuid: candidate.orderUuid, orderNumber: 'SYNTHETIC-122', configurationId: candidate.configurationId,
      state: 'available', available: true, facts: { recommendationCandidate: candidate } });
  }));
  report.setup.push('Synthetic exact stock, employee recommendation facts and noon time; evaluation still uses canonical PolicyService/recommendation service.');
  await openCase(c.caseId); c = await confirmUpdate('in-progress');
  const release = { type: 'later-release', releaseAt: '2026-11-25T09:00:00.000Z', source: 'Explicitly synthetic reviewed release plan' };
  c = ok(await api(greg, '/scheme-team/cases/update', { commandId: 'synthetic-reviewed-release', caseId: c.caseId, expectedVersion: c.version,
    status: 'remedy-proposed', reason: 'Synthetic reviewed release recorded for option readback.', nextAction: 'Review the persisted release source.', dueAt: '2026-11-07T12:00:00.000Z', remedy: release })).case;
  report.setup.push('Reviewed future release recorded using actual case update API; no release producer asserted.');
  await openCase(c.caseId);
  const projection = ok(await api(greg, '/scheme-team/cases/options?caseId=' + encodeURIComponent(c.caseId)));
  assert.ok(projection.options.alternativeCars.items.some((item) => item.orderUuid === candidate.orderUuid));
  assert.deepEqual(projection.options.laterRelease.items, [release]); assert.equal(projection.options.contractExtension.available, true);
  for (const [name, key] of [['exact-car', 'alternativeCars:0'], ['one-preference', 'preferenceRelaxations:0'], ['known-release', 'laterRelease:0'], ['manual', 'manualDecision'], ['policy-extension', 'contractExtension']]) {
    await select(greg.page, 'Remedy to record', key); await capture(greg.page, '03-option-' + name, { target: greg.page.getByLabel('Remedy to record', { exact: true }) });
  }
  check('Actual projection evaluates exact stock and reads persisted release/date/policy-gated extension', { policyVersion: projection.policyVersion, orderUuid: candidate.orderUuid, release });
}
async function resilience() {
  await navigate(greg, 'queue'); await capture(greg.page, '01-empty-actual-queue');
  let releaseQueue; let arrivedQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  const queueArrived = new Promise((resolve) => { arrivedQueue = resolve; });
  const queueDelay = async (route) => { const actual = await route.fetch(); arrivedQueue(); await queueGate; await route.fulfill({ response: actual }); };
  const queueBefore = state(); await greg.page.route('**/api/gcsp/scheme-team/cases', queueDelay);
  await greg.page.reload(); await queueArrived;
  await greg.page.waitForFunction(() => document.querySelector('.gcsp-case-queue-content')?.getAttribute('aria-busy') === 'true');
  await capture(greg.page, '02-queue-loading-real-reply-held'); releaseQueue(); await settled(greg.page);
  await greg.page.unroute('**/api/gcsp/scheme-team/cases', queueDelay); assertState(queueBefore);
  check('Empty queue and controlled actual loading are read-only');
  // Actual committed request reply is held; the service response is not replaced.
  const page = await navigate(paula); await prepareHelp(page);
  let release; const gate = new Promise((resolve) => { release = resolve; }); let attempts = 0;
  const delayed = async (route) => { attempts++; const actual = await route.fetch(); await gate; try { await route.fulfill({ response: actual }); } catch { /* expected only if teardown aborts */ } };
  await page.route('**/api/gcsp/cases', delayed);
  await activate(page, 'Confirm help request');
  await page.waitForFunction(() => document.querySelector('.gcsp-case-content')?.getAttribute('aria-busy') === 'true');
  assert.equal(await button(page, 'Confirm help request').isDisabled(), true);
  await capture(page, '02-busy-actual-reply-held', { visibleFocus: true }); release(); await settled(page); await page.unroute('**/api/gcsp/cases', delayed);
  assert.equal(attempts, 2, 'POST and authoritative GET both pass controlled delay route');
  // Subsequent help request joins the existing active case. Lost committed reply must replay exactly once.
  await prepareHelp(page, 'Synthetic uncertain transport retry request.'); let first; let second; let dropped = false;
  const lost = async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (!dropped) { dropped = true; first = route.request().postData(); await route.fetch(); return route.abort('failed'); }
    second = route.request().postData(); return route.continue();
  };
  transportPhase = 'committed help reply deliberately dropped';
  await page.route('**/api/gcsp/cases', lost); const beforeLost = ok(await api(paula, '/cases')).cases[0];
  await activate(page, 'Confirm help request'); await settled(page); await capture(page, '03-uncertain-committed-reply-lost', { visibleFocus: true });
  const committed = ok(await api(paula, '/cases')).cases[0]; assert.equal(committed.version, beforeLost.version + 1);
  await activate(page, 'Confirm help request'); await settled(page); await page.unroute('**/api/gcsp/cases', lost); transportPhase = null;
  assert.equal(second, first); assert.equal(ok(await api(paula, '/cases')).cases[0].version, committed.version);
  await capture(page, '04-identical-retry-recovered', { visibleFocus: true }); check('Controlled committed reply loss reuses identical command/payload', { byteIdentical: true, caseVersion: committed.version });
  // Actual stale version: another valid owner update lands after this editor projection.
  let c = ok(await api(greg, '/scheme-team/cases')).cases[0]; await openCase(c.caseId);
  await updateForm('in-progress'); await activate(greg.page, 'Review case update');
  c = ok(await api(greg, '/scheme-team/cases/update', { commandId: 'other-owner-progress', caseId: c.caseId, expectedVersion: c.version, status: 'in-progress',
    reason: 'Concurrent synthetic owner update.', nextAction: 'Reopen current options.', dueAt: '2026-11-07T12:00:00.000Z' })).case;
  await activate(greg.page, 'Confirm case update'); await settled(greg.page);
  assert.match(await greg.page.locator('.gcsp-case-status').innerText(), /changed/); assert.equal(await button(greg.page, 'Confirm case update').count(), 0);
  await capture(greg.page, '05-actual-stale-version-refusal', { visibleFocus: true }); await activate(greg.page, 'Refresh case options'); await settled(greg.page);
  transportPhase = 'actual cases read deliberately aborted';
  const unavailable = async (route) => route.abort('failed'); await page.route('**/api/gcsp/cases', unavailable);
  await page.reload(); await settled(page); assert.match(await page.locator('.gcsp-case-content').innerText(), /unavailable/);
  await capture(page, '06-actual-read-transport-outage'); await page.unroute('**/api/gcsp/cases', unavailable); transportPhase = null; await page.reload(); await settled(page);
  // An employee cookie reaches the real scheme-team access boundary.
  await page.goto(origin + '/gcsp-case-queue.html'); await settled(page); assert.match(await page.locator('.gcsp-case-queue-content').innerText(), /cannot open/);
  await capture(page, '07-actual-forbidden-session'); check('Actual access/source/stale outcomes do not imply empty/saved success');
  // Read unmount: owned AbortController prevents late render or mutation.
  let releaseRead; const readGate = new Promise((resolve) => { releaseRead = resolve; }); let arrivedRead;
  const readArrived = new Promise((resolve) => { arrivedRead = resolve; });
  const readDelay = async (route) => { const actual = await route.fetch(); arrivedRead(); await readGate; try { await route.fulfill({ response: actual }); } catch { /* detached surface abort */ } };
  transportPhase = 'read/save deliberately unmounted while reply delayed';
  await page.route('**/api/gcsp/cases', readDelay); await page.goto(origin + '/gcsp-help.html'); await readArrived;
  const readState = state(); await page.evaluate(() => document.querySelector('gcsp-help').remove()); releaseRead(); await wait(150);
  assert.equal(await page.locator('gcsp-help').count(), 0); assertState(readState); await page.unroute('**/api/gcsp/cases', readDelay);
  // Save unmount: the confirmed write can commit once, but a detached reply cannot cause a reload.
  await navigate(paula); await prepareHelp(page, 'Synthetic teardown confirmed request.'); let releaseSave; let arrivedSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; }); const saveArrived = new Promise((resolve) => { arrivedSave = resolve; });
  const saveDelay = async (route) => { if (route.request().method() !== 'POST') return route.continue(); const actual = await route.fetch(); arrivedSave(); await saveGate;
    try { await route.fulfill({ response: actual }); } catch { /* detached surface abort */ } };
  await page.route('**/api/gcsp/cases', saveDelay); await activate(page, 'Confirm help request'); await saveArrived;
  await page.evaluate(() => document.querySelector('gcsp-help').remove()); const committedState = state(); const networkBeforeRelease = report.network.length;
  releaseSave(); await wait(200); assert.equal(await page.locator('gcsp-help').count(), 0); assertState(committedState);
  assert.equal(report.network.slice(networkBeforeRelease).some((request) => request.method === 'GET' && request.path === '/api/gcsp/cases'), false);
  await page.unroute('**/api/gcsp/cases', saveDelay); await capture(page, '08-detached-help-after-late-save');
  transportPhase = null; check('Delayed actual read/save after unmount do not render or issue a hidden reload');
}
async function previews() {
  const before = state();
  for (const [surface, names] of [['help', FIXTURE_NAMES], ['queue', QUEUE_FIXTURE_NAMES]]) {
    for (const name of names) {
      const page = surface === 'help' ? paula.page : greg.page;
      await page.goto(origin + (surface === 'help' ? '/gcsp-help.html' : '/gcsp-case-queue.html') + '?fixture=' + name);
      if (name === 'loading') await page.locator(surface === 'help' ? '.gcsp-case-content' : '.gcsp-case-queue-content').waitFor(); else await settled(page);
      const previewText = await page.locator(surface === 'help' ? '.gcsp-case-content' : '.gcsp-case-queue-content').innerText();
      const expected = surface === 'help'
        ? ({ none: /No renewal case/, request: /Open/, trigger: /renewal-deadline/, 'in-progress': /In progress/, waiting: /Remedy proposed/,
          resolved: /Resolved/, closed: /Closed/, loading: /Loading your cases/, unavailable: /unavailable/, forbidden: /cannot open/, 'stale-run': /run has changed/ })[name]
        : ({ populated: /Renewal-risk cases/, empty: /No renewal cases/, loading: /Loading renewal cases/, unavailable: /unavailable/,
          forbidden: /cannot open/, 'stale-run': /run has changed/, 'unavailable-options': /Renewal-risk cases/ })[name];
      assert.match(previewText, expected);
      await capture(page, `preview-${surface}-${name}`, { target: surface === 'help' && await page.locator('[data-case-id]').count() ? page.locator('[data-case-id]') : undefined,
        boundary: 'explicit read-only synthetic preview, not live service acceptance' });
      if (surface === 'help' && name === 'none') {
        await prepareHelp(page); await activate(page, 'Confirm help request'); await settled(page);
        assert.match(await page.locator('.gcsp-case-content').innerText(), /read-only synthetic preview/);
        await capture(page, 'preview-help-write-refused', { boundary: 'explicit synthetic fixture refusal', visibleFocus: true });
      }
      if (surface === 'queue' && name === 'populated') {
        await select(page, 'Case to work', 'synthetic-case-0'); await activate(page, 'Open selected case'); await settled(page);
        await select(page, 'Remedy to record', 'manualDecision');
        await select(page, 'Next case status', 'in-progress');
        await enterText(page, 'Reason for this update', 'Synthetic preview only.');
        await enterText(page, 'Authorised scheme-team decision', 'Synthetic preview only.');
        await activate(page, 'Review case update'); await activate(page, 'Confirm case update'); await settled(page);
        assert.match(await page.locator('.gcsp-case-work').innerText(), /read-only synthetic preview/);
        await capture(page, 'preview-queue-write-refused', { boundary: 'explicit synthetic fixture refusal', visibleFocus: true });
      }
      if (surface === 'queue' && name === 'unavailable-options') {
        await select(page, 'Case to work', 'synthetic-case-0'); await activate(page, 'Open selected case'); await settled(page);
        await capture(page, 'preview-queue-unavailable-remedies', { target: page.getByLabel('Remedy to record', { exact: true }), boundary: 'explicit read-only synthetic missing options' });
      }
      assertState(before, 'Preview ' + surface + '/' + name + ' cannot change repository');
    }
  }
  check('Every authored preview state inspected and mutation adapters refuse; repository unchanged', { helpStates: FIXTURE_NAMES, queueStates: QUEUE_FIXTURE_NAMES });
}

async function makeActor(name, session) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); contexts.push(context);
  await context.addCookies([session.setCookie].flat().filter(Boolean).map((text) => {
    const parts = text.split(';').map((part) => part.trim()); const at = parts[0].indexOf('=');
    const attributes = Object.fromEntries(parts.slice(1).map((part) => { const index = part.indexOf('='); return index < 0 ? [part, true] : [part.slice(0, index), part.slice(index + 1)]; }));
    return { name: parts[0].slice(0, at), value: parts[0].slice(at + 1), domain: '127.0.0.1', path: attributes.Path || '/',
      httpOnly: true, sameSite: 'Lax', secure: false, ...(attributes.Expires ? { expires: Date.parse(attributes.Expires) / 1000 } : {}) };
  }));
  await context.route('**/*', async (route) => {
    if (!route.request().url().startsWith(origin + '/')) {
      report.errors.push({ type: 'external-request-blocked', url: route.request().url() }); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', actor: name, message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) report.errors.push({ type: 'console', actor: name, message: message.text() });
  });
  page.on('requestfailed', (request) => {
    const finding = { actor: name, method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText,
      boundary: transportPhase || (request.failure()?.errorText === 'net::ERR_ABORTED' ? 'navigation or element cancellation' : null) };
    if (finding.boundary) report.expectedTransportFailures.push(finding); else report.errors.push({ type: 'unexpected-request-failure', ...finding });
  });
  page.on('response', (response) => {
    const pending = (async () => {
      const pathname = new URL(response.url()).pathname;
      if (!pathname.startsWith('/api/gcsp/')) {
        if (response.status() >= 400) report.errors.push({ type: 'asset-http-error', path: pathname, status: response.status() }); return;
      }
      try { report.network.push({ type: 'browser', actor: name, method: response.request().method(), path: pathname,
        httpStatus: response.status(), request: safeBody(response.request().postData()), ...safeResult(await response.json()) }); }
      catch { /* Controlled response loss or cancelled read is recorded as requestfailed. */ }
    })();
    pendingNetwork.add(pending); pending.finally(() => pendingNetwork.delete(pending));
  });
  return { name, context, session, page };
}

try {
  ok(await repository.open());
  const seed = JSON.parse(await readFile(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
  seed.assumptions.find((row) => row.key === 'identity.session.sameSite').value = 'Lax';
  if (chunk.startsWith('options-deadline-')) {
    seed.assumptions.find((row) => row.key === 'renewalCase.extension.permitted').value = true;
    report.setup.push('Explicit alternate canonical policy input: renewalCase.extension.permitted=true for this chunk; no client policy override.');
  }
  const policy = new PolicyService({ provider: { loadVersions: async () => [seed] } });
  const wallClock = new Date().toISOString();
  ({ clock, identity } = ok(await createDemoRuntime({ repository, policy, environmentId: 'fucq122-browser', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'browser-bootstrap', sessionNow: () => wallClock, secureCookies: false })));
  const presenterSession = ok(await identity.createPresenterSession('browser-presenter'));
  const paulaSession = ok(await identity.switchPrincipal(presenterSession.context, 'demo-paula', 'browser-paula'));
  const gregSession = ok(await identity.switchPrincipal(presenterSession.context, 'demo-greg', 'browser-greg'));
  ok(await seedManualDemoContext({ repository, identity, clock, context: paulaSession.context }));
  report.setup.push('Trusted backend bootstrap issues separate actual presenter, Paula and Greg sessions; synthetic manual-records-v1 supplies account/contract facts. Cookies are never retained in evidence.');
  const brief = new BriefService({ repository, policy, clock, identity });
  const cases = new RenewalCaseService({ repository, policy, clock, identity });
  const manual = new ManualContextService({ repository, policy, clock, identity, ports: createRepositoryManualPorts({ repository, policy }) });
  const gregDemand = createGregDemandService({ repository, policy, clock, identity });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
  let apiHandler;
  server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) return apiHandler(request, response);
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400); return response.end(); }
    if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep) || pathname.split('/').some((part) => part.startsWith('.')) || !mime[path.extname(file)]) { response.writeHead(403); return response.end(); }
    try { const bytes = await readFile(file); response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' }); response.end(bytes); }
    catch { if (!response.headersSent) response.writeHead(404); response.end('Not found'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`; ports.push(server.address().port); report.apiPort = server.address().port;
  processRecords.push(identityOf(process.pid)); await ledger();
  backend = buildServer({ gcspIdentity: identity, gcspClock: clock, gcspBrief: brief, gcspCases: cases, gcspManual: manual, gcspGreg: gregDemand, gcspAllowedOrigins: [origin] });
  apiHandler = backend.listeners('request')[0]; ok(await backend.gcspStartup);
  const profile = path.join(scratch, 'profile'); await mkdir(profile, { recursive: true });
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter',
    '--disable-extensions', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576',
    `--disk-cache-dir=${path.join(scratch, 'cache')}`, `--crash-dumps-dir=${path.join(scratch, 'crashes')}`, 'about:blank'],
  { stdio: 'ignore', env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch } });
  processRecords.push(identityOf(chrome.pid)); await ledger();
  let debug;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { debug = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); break; } catch { await wait(80); }
  }
  assert.ok(debug, 'Owned Chrome exposes its CDP port'); ports.push(Number(debug[0])); report.chromeDebugPort = Number(debug[0]); await ledger();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debug[0]}`);
  paula = await makeActor('Paula', paulaSession); greg = await makeActor('Greg', gregSession); presenter = await makeActor('Presenter', presenterSession);
  if (chunk === 'smoke-desktop') {
    const before = state(); await navigate(paula); await navigate(greg, 'queue'); assertState(before);
    await discloseHelp(paula.page); await tabTo(paula.page, button(paula.page, 'Ask for help'));
    await capture(paula.page, 'smoke-paula-account-help-keyboard', { visibleFocus: true });
    await capture(greg.page, 'smoke-greg-empty-queue'); check('Smoke: actual account/help/empty queue are read-only, assets loaded and keyboard focus visible');
  } else if (chunk.startsWith('journey-')) await journey();
  else if (chunk.startsWith('options-deadline-')) await optionsDeadline();
  else if (chunk.startsWith('resilience-')) await resilience();
  else if (chunk.startsWith('previews-')) await previews();
  else throw Error('Unknown bounded chunk: ' + chunk);
  assert.deepEqual(report.errors, []); report.state = 'passed';
} catch (error) {
  report.errors.push({ type: 'assertion-or-runner', message: error.stack || error.message }); process.exitCode = 1;
} finally {
  for (const context of contexts.reverse()) { try { await context.close(); } catch { /* supervisor owns remaining process identities */ } }
  try { await browser?.close(); } catch { /* supervisor terminates the owned Chrome tree */ }
  const liveChrome = () => chrome && chrome.exitCode === null && chrome.signalCode === null;
  if (liveChrome()) {
    chrome.kill('SIGTERM'); await Promise.race([once(chrome, 'exit'), wait(1200)]);
    if (liveChrome()) { chrome.kill('SIGKILL'); await Promise.race([once(chrome, 'exit'), wait(1200)]); }
  }
  if (server?.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  backend?.closeAllConnections();
  await Promise.allSettled([...pendingNetwork]);
  if (repository.close) await repository.close();
  report.listenerClosed = !server?.listening; report.chromeJoined = !liveChrome();
  if (!report.listenerClosed || !report.chromeJoined) report.errors.push({ type: 'runner-cleanup-incomplete' });
  // Pending response observers and teardown may add errors after the journey assertion.
  if (report.errors.length) { report.state = 'incomplete'; process.exitCode = 1; }
  await save();
  console.log(JSON.stringify({ state: report.state, chunk, checks: report.checks.length, captures: report.captures.length, errors: report.errors }));
}
