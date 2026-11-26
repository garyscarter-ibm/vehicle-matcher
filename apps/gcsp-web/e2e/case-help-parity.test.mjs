import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { startComposition } from './composition.mjs';

const retainedNote = 'Previously loaded case information is shown below. Refresh to check its current state.';
const chargingCode = 'charging-unconfirmed';
const chargingLabel = 'Charging access not confirmed';
const reasons = { paula: 'My replacement needs a charging check.', alex: 'Please review my renewal.', greg: 'Please review my later renewal.' };
const good = (response, label) => {
  const key = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,96}$/.test(value) ? value : undefined;
  const diagnostic = JSON.stringify({ httpStatus: response.status, status: key(response.body?.status), code: key(response.body?.code),
    fields: Array.isArray(response.body?.reasons) ? response.body.reasons.slice(0, 5).map(item => key(item?.field)).filter(Boolean) : [] });
  assert.equal(response.status, 200, `${label}: ${diagnostic}`);
  assert.equal(response.body?.status, 'ok', `${label}: ${diagnostic}`);
  return response.body.value;
};
const serviceGood = (response, label) => {
  assert.equal(response?.status, 'ok', label);
  return response.value;
};
async function until(check, message) {
  const end = performance.now() + 15000;
  while (performance.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
function sorted(rows, mode) {
  const statuses = ['open', 'in-progress', 'remedy-proposed', 'resolved', 'closed'];
  const rank = row => statuses.indexOf(row.status);
  const terminal = row => Number(['resolved', 'closed'].includes(row.status));
  const deadline = (a, b) => (a.renewalDeadline ?? '9999-99-99').localeCompare(b.renewalDeadline ?? '9999-99-99');
  return [...rows].sort((a, b) => (mode === 'status' ? rank(a) - rank(b) || deadline(a, b)
    : terminal(a) - terminal(b) || deadline(a, b) || rank(a) - rank(b)) || a.caseId.localeCompare(b.caseId));
}
const caseState = row => Object.fromEntries(['employeeId', 'renewalDeadline', 'status', 'reason', 'nextAction', 'dueAt', 'policyVersion']
  .map(key => [key, key === 'dueAt' ? new Date(row[key]).toISOString() : row[key]]));
const caseStates = rows => rows.map(caseState).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
async function unansweredCharging(call) {
  const editor = good(await call('GET', '/brief/editor'), 'Read the actual editor before changing its practical answer');
  const brief = structuredClone(editor.initial.brief);
  const definition = editor.context.essentials.charging;
  brief.essentials.charging = { operator: definition.operator, unit: definition.unit, source: 'employee', state: 'needs-confirmation', value: null };
  good(await call('POST', '/brief/draft', { commandId: 'f557-charging-draft', expectedBriefVersion: editor.initial.briefVersion,
    expectedDraftVersion: editor.initial.draftVersion, brief }), 'Save the unanswered charging answer through the actual editor');
  let current = good(await call('GET', '/brief'), 'Read the actual saved brief').brief;
  if (current.essentials.charging.value !== null) {
    const after = good(await call('GET', '/brief/editor'), 'Read actual draft versions');
    good(await call('POST', '/brief/confirm', { commandId: 'f557-charging-confirm', expectedBriefVersion: after.initial.briefVersion,
      expectedDraftVersion: after.initial.draftVersion, consent: { search: false, hold: false } }), 'Confirm the unanswered charging answer');
    current = good(await call('GET', '/brief'), 'Read the confirmed charging answer').brief;
  }
  assert.equal(current.essentials.charging.value, null);
  assert.equal(current.essentials.charging.state, 'needs-confirmation');
  return current;
}
async function openCases(callPaula, callAlex, callGreg) {
  const paula = good(await callPaula('POST', '/cases', { commandId: 'f557-paula-help', reason: reasons.paula }), 'Open actual Paula case').case;
  good(await callAlex('POST', '/cases', { commandId: 'f557-alex-help', reason: reasons.alex }), 'Open actual Alex case');
  const greg = good(await callGreg('POST', '/cases', { commandId: 'f557-greg-help', reason: reasons.greg }), 'Open Greg’s actual employee case').case;
  assert.ok(greg.renewalDeadline > paula.renewalDeadline, 'The canonical Greg renewal supplies the later deadline');
  const options = good(await callGreg('GET', '/scheme-team/cases/options?caseId=' + encodeURIComponent(paula.caseId)),
    'Read current Paula case options before preparing the update');
  assert.equal(options.case.caseId, paula.caseId);
  assert.ok(options.nextStatuses.includes('in-progress'), 'The actual case permits the intended status');
  assert.ok(Number.isFinite(Date.parse(options.asOf)), 'Actual case options provide the run clock');
  // The first release can open this case more than its response window before the final release.
  const dueAt = new Date(Date.parse(options.asOf) + 60 * 60 * 1000).toISOString();
  good(await callGreg('POST', '/scheme-team/cases/update', { commandId: 'f557-progress', caseId: options.case.caseId,
    expectedVersion: options.case.version, status: 'in-progress', reason: 'Checking the available charging evidence.',
    nextAction: 'Confirm charging access with Paula.', dueAt }), 'Progress the real Paula case');
  const queue = good(await callGreg('GET', '/scheme-team/cases'), 'Read actual queue after the case commands');
  assert.ok(queue.cases.some(row => row.employeeId === 'employee-paula' && row.status === 'in-progress'));
  assert.ok(queue.cases.some(row => row.employeeId === 'employee-alex' && row.status === 'open'));
  assert.ok(queue.cases.some(row => row.employeeId === 'operator-greg' && row.status === 'open'));
  assert.notDeepEqual(sorted(queue.cases, 'deadline').map(row => row.caseId), sorted(queue.cases, 'status').map(row => row.caseId),
    'The source scenario must distinguish deadline and status ordering');
  return queue;
}
async function assertQueue(page, rows, mode) {
  const expected = sorted(rows, mode).map(row => row.caseId);
  const buttons = page.locator('gcsp-data-table button[data-row-id]');
  await until(async () => JSON.stringify(await buttons.evaluateAll(nodes => nodes.map(node => node.dataset.rowId))) === JSON.stringify(expected),
    `The visible queue follows actual ${mode} ordering`);
}
async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1, JSON.stringify(dimensions));
  return dimensions;
}
async function nodeCall(page, method, suffix, body) {
  return page.evaluate(async ({ method, suffix, body }) => {
    const response = await fetch('/api/gcsp' + suffix, { method, credentials: 'include', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { method, suffix, body });
}
async function frozenPage(context, origin, runtime, control, subject, route) {
  const issued = serviceGood(await runtime.identity.switchPrincipal(control, subject, `f557-node-${subject}`), 'Issue actual frozen identity');
  const cookie = issued.setCookie.split(';', 1)[0];
  const pageContext = await context.browser().newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 },
    locale: 'en-GB', timezoneId: 'Europe/London', reducedMotion: 'reduce' });
  await pageContext.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
    url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
  const page = await pageContext.newPage();
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
  return { page, close: () => pageContext.close() };
}

test('FUCQ-557: actual queue sorting, plain unknown gate, retained Help refresh and card skeleton',
  { timeout: 540000 }, async t => {
    const suite = await startComposition({ caseId: 'f557' });
    t.after(() => suite.close());
    const evidence = suite.receipt.caseHelp = { groups: [], humanAcceptance: '',
      scenario: 'f557-charging-and-distinct-renewal-deadlines',
      source: 'Real Angular/Java/native PostgreSQL, signed test OIDC, real case/editor commands and retained generated stock.' };
    async function check(name, work) {
      const group = { name, state: 'running' }; evidence.groups.push(group); let failure;
      await t.test(name, async () => {
        try { await work(); group.state = 'passed'; }
        catch (error) { group.state = 'failed'; group.failure = error.message.slice(0, 1000); failure = error; throw error; }
      });
      if (failure) throw failure;
    }
    const paula = await suite.newPage('f557-paula', 'demo-paula', 'help');
    const presenter = await suite.newPage('f557-presenter', 'demo-presenter', 'presenter');
    const released = await suite.releaseMainOffer(paula, presenter);
    const alex = await suite.newPage('f557-alex', 'demo-alex', 'help');
    const greg = await suite.newPage('f557-greg', 'demo-greg', 'greg/cases');
    const call = page => (method, suffix, body) => suite.call(page, method, suffix, body);
    evidence.brief = await unansweredCharging(call(paula));
    const queue = await openCases(call(paula), call(alex), call(greg));
    evidence.queue = queue;
    const paulaCase = queue.cases.find(row => row.employeeId === 'employee-paula' && row.status === 'in-progress');
    const options = good(await suite.call(greg, 'GET', '/scheme-team/cases/options?caseId=' + encodeURIComponent(paulaCase.caseId)), 'Read actual unknown-gate options');
    evidence.options = options;
    const unknowns = options.options.alternativeCars.needsConfirmation;
    assert.ok(unknowns.some(row => row.unknowns.includes(chargingCode)), 'Actual released stock and unanswered charging produce the raw gate input');
    await greg.getByRole('button', { name: 'Refresh cases', exact: true }).click();

    for (const width of [1280, 375]) {
      await check(`native sorting, focus and actual gate labels at ${width}`, async () => {
        await greg.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
        const sort = greg.getByRole('combobox', { name: 'Sort cases', exact: true });
        await sort.waitFor();
        assert.equal(await sort.evaluate(node => node.tagName), 'SELECT');
        await sort.focus(); await sort.press('Home'); await sort.press('Enter');
        await until(async () => await sort.inputValue() === 'deadline', 'Keyboard selects deadline');
        await assertQueue(greg, queue.cases, 'deadline');
        assert.equal(await sort.evaluate(node => document.activeElement === node), true);
        await sort.press('End'); await sort.press('Enter');
        await until(async () => await sort.inputValue() === 'status', 'Keyboard selects status');
        await assertQueue(greg, queue.cases, 'status');
        assert.equal(await sort.evaluate(node => document.activeElement === node), true);
        await sort.press('Home'); await sort.press('Enter'); await assertQueue(greg, queue.cases, 'deadline');
        await greg.locator(`button[data-row-id="${paulaCase.caseId}"]`).click();
        const detail = greg.locator('.case-detail');
        await detail.getByText(new RegExp(chargingLabel)).first().waitFor();
        assert.equal(await detail.getByText(new RegExp(chargingCode)).count(), 0);
        assert.equal(await detail.locator('h2[data-case-heading]').evaluate(node => document.activeElement === node), true);
        evidence[`queue${width}`] = await noOverflow(greg);
        await suite.screenshot(greg, `angular-case-queue-charging-${width}`, { fullPage: true });
      });

      await check(`card loading skeleton and same-context failed refresh at ${width}`, async () => {
        await paula.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
        const pattern = suite.apiBase + '/help';
        let release; const hold = new Promise(resolve => { release = resolve; }); let delayed = 0;
        const delayRead = async route => { delayed++; await hold; await route.continue(); };
        await paula.route(pattern, delayRead);
        try {
          await paula.reload({ waitUntil: 'domcontentloaded' });
          const skeleton = paula.locator('gcsp-help div[gcspLoadingSkeleton][data-layout="card"]');
          await skeleton.waitFor(); assert.equal(await skeleton.getAttribute('aria-busy'), 'true');
          assert.ok(delayed > 0, 'The actual Help read is pending');
          await suite.screenshot(paula, `angular-help-loading-${width}`, { fullPage: true });
        } finally { release(); await paula.unroute(pattern, delayRead); }
        const cases = paula.locator('.help-cases article[data-case-id]');
        await paula.locator(`.help-cases article[data-case-id="${paulaCase.caseId}"]`).waitFor();
        const before = await cases.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.caseId, text: node.textContent })));
        const abort = route => route.abort('failed'); let aborted = 0;
        const failing = async route => { aborted++; await abort(route); };
        await paula.route(pattern, failing);
        try {
          await paula.getByRole('button', { name: 'Refresh cases', exact: true }).click();
          await paula.getByText(retainedNote, { exact: true }).waitFor();
          assert.ok(aborted > 0);
          assert.deepEqual(await cases.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.caseId, text: node.textContent }))), before,
            'The same owned case information survives the failed refresh');
          evidence[`help${width}`] = { retainedCaseIds: before.map(row => row.id), abortedReads: aborted, dimensions: await noOverflow(paula) };
          await suite.screenshot(paula, `angular-help-retained-${width}`, { fullPage: true });
        } finally { await paula.unroute(pattern, failing); }
        await paula.getByRole('button', { name: 'Refresh cases', exact: true }).click();
        await until(async () => await paula.getByText(retainedNote, { exact: true }).count() === 0, 'Actual successful reread clears the retained-data note');
        await paula.getByRole('button', { name: 'Ask for help', exact: true }).waitFor();
        await suite.screenshot(paula, `angular-help-current-${width}`, { fullPage: true });
      });
    }

    await check('frozen live-path same-case-state pair at 1280', async () => {
      const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: released.hold, clock: released.clock,
        finalAccount: released.account }, async ({ page, context, origin, runtime, control }) => {
        await page.goto(origin + '/gcsp-help.html', { waitUntil: 'domcontentloaded' });
        await unansweredCharging((method, suffix, body) => nodeCall(page, method, suffix, body));
        const alexNode = await frozenPage(context, origin, runtime, control, 'demo-alex', '/gcsp-help.html');
        const gregNode = await frozenPage(context, origin, runtime, control, 'demo-greg', '/gcsp-case-queue.html');
        try {
          const nodeQueue = await openCases((...args) => nodeCall(page, ...args), (...args) => nodeCall(alexNode.page, ...args),
            (...args) => nodeCall(gregNode.page, ...args));
          assert.deepEqual(caseStates(nodeQueue.cases), caseStates(queue.cases), 'Actual Node/Java case states and deadlines agree');
          const nodeCase = nodeQueue.cases.find(row => row.employeeId === 'employee-paula' && row.status === 'in-progress');
          const nodeOptions = good(await nodeCall(gregNode.page, 'GET', '/scheme-team/cases/options?caseId=' + encodeURIComponent(nodeCase.caseId)), 'Frozen actual case options');
          assert.ok(nodeOptions.options.alternativeCars.needsConfirmation.some(row => row.unknowns.includes(chargingCode)));
          await gregNode.page.reload({ waitUntil: 'domcontentloaded' });
          await gregNode.page.getByRole('button', { name: /Open case for Paula/ }).click();
          await gregNode.page.getByText(chargingLabel, { exact: true }).first().waitFor();
          assert.equal(await gregNode.page.getByText(chargingCode, { exact: true }).count(), 0);
          await suite.screenshot(gregNode.page, 'node-case-queue-charging-1280', { fullPage: true });
          await page.goto(origin + '/gcsp-help.html', { waitUntil: 'domcontentloaded' });
          await page.getByText('In progress', { exact: true }).first().waitFor();
          await suite.screenshot(page, 'node-help-current-1280', { fullPage: true });
          return { caseHelp: { java: queue.cases.map(row => ({ caseId: row.caseId, ...caseState(row) })),
            node: nodeQueue.cases.map(row => ({ caseId: row.caseId, ...caseState(row) })),
            gateCodes: [...new Set(nodeOptions.options.alternativeCars.needsConfirmation.flatMap(row => row.unknowns))],
            humanVerdict: '', source: 'Frozen live pages and case HTTP routes; identical actual case commands over canonical account sources.' } };
        } finally { await alexNode.close(); await gregNode.close(); }
      });
      evidence.nodeReplay = replay;
      assert.equal(replay.state, 'matched');
    });

    await check('sign-out and account change clear retained private cases', async () => {
      await paula.locator('.gcsp-account-details summary').click();
      await paula.getByRole('button', { name: 'Sign out', exact: true }).click();
      await until(async () => await paula.locator('.help-cases article').count() === 0, 'Signing out clears owned case data');
      assert.equal(await paula.getByText(retainedNote, { exact: true }).count(), 0);
      await paula.waitForURL(url => url.origin === suite.origins.web && url.pathname === '/gcsp/sign-in');
      await paula.goto(suite.origins.web + '/gcsp/help', { waitUntil: 'domcontentloaded' });
      await paula.getByRole('button', { name: 'Sign in', exact: true }).first().click();
      await paula.locator('button[data-subject="demo-alex"]').click();
      await paula.waitForURL(url => url.origin === suite.origins.web && url.pathname !== '/gcsp/auth/callback');
      const alexCase = queue.cases.find(row => row.employeeId === 'employee-alex' && row.status === 'open');
      await paula.locator(`.help-cases article[data-case-id="${alexCase.caseId}"]`).waitFor();
      assert.equal(await paula.locator(`.help-cases article[data-case-id="${paulaCase.caseId}"]`).count(), 0);
      assert.equal(await paula.getByText(reasons.paula, { exact: true }).count(), 0);
      evidence.accountIsolation = { previousEmployee: 'employee-paula', currentEmployee: 'employee-alex', previousCaseAbsent: true };
    });
  });
