// UNEXECUTED SOURCE PROPOSAL: two original terminal states; no waiting-state claim.
// Original scenario.mjs and published d60d458 evidence remain immutable.
// Source-only preparation. The admitted existing supervisor owns the page, current
// startGcspDemo HTTPS launcher, TLS, browser tree, output, reservation and cleanup.
// This module neither starts resources nor selects a fixture or authority cookie.
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function runCaseJourney({ page, origin, output, viewport }) {
  assert.equal(new URL(origin).protocol, 'https:');
  assert.equal(new URL(origin).hostname, 'localhost');
  assert.ok([1280, 375].includes(viewport.width));
  await page.setViewportSize(viewport);
  page.setDefaultTimeout(8000);
  const report = { state: 'incomplete', viewport, checks: [], keyboard: [], captures: [], errors: [], network: [], navigations: [], requestFailures: [], transitions: [] };
  const pending = new Set();
  const started = new WeakMap(); let requestNumber = 0; let transition = null;
  const onRequest = (request) => started.set(request, { id: ++requestNumber, method: request.method(), path: new URL(request.url()).pathname, documentURL: page.url() });
  const mark = (name) => report.checks.push(name);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const good = (value) => { assert.equal(value.status, 'ok'); return value.value; };
  const watch = (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin) { report.errors.push({ kind: 'external-response', path: url.pathname }); return; }
    const request = response.request();
    report.network.push({ requestId: started.get(request)?.id, path: url.pathname, method: request.method(), status: response.status() });
    if (request.isNavigationRequest() && request.resourceType() === 'document') {
      const task = request.allHeaders().then((headers) => {
        const authorityOnHtml = /(?:^|;\s*)(?:gcsp_session|gcsp_presenter)=/.test(headers.cookie || '');
        report.navigations.push({ path: url.pathname, status: response.status(), authorityOnHtml });
        assert.equal(authorityOnHtml, false, 'API authority cookies stay off HTML requests');
      }).catch((error) => report.errors.push({ kind: 'navigation-cookie', message: error.message }));
      pending.add(task); task.finally(() => pending.delete(task));
    }
    if (response.status() >= 400 && url.pathname !== '/favicon.ico') report.errors.push({ kind: 'http', path: url.pathname, status: response.status() });
  };
  const onError = (error) => report.errors.push({ kind: 'page', message: error.message });
  const onConsole = (message) => { if (message.type() === 'error' && !message.location().url?.endsWith('/favicon.ico')) report.errors.push({ kind: 'console', message: message.text().slice(0, 300) }); };
  const onFailure = (request) => report.requestFailures.push({ ...started.get(request), failure: request.failure()?.errorText,
    transitionId: transition?.id ?? null, failureDocumentURL: page.url() });
  page.on('request', onRequest); page.on('response', watch); page.on('pageerror', onError); page.on('console', onConsole); page.on('requestfailed', onFailure);
  const read = async (path) => good(await page.evaluate(async (path) => {
    const response = await fetch(`/api/gcsp/${path}`, { credentials: 'include' });
    if (!response.ok) throw Error(`Read failed: ${path} ${response.status}`);
    return response.json();
  }, path));
  const cases = async () => (await read('cases')).cases;
  const posts = (path) => report.network.filter((row) => row.method === 'POST' && row.path === `/api/gcsp/${path}`).length;
  const caseRecord = ({ employeeName, ...record }) => record;
  const beginNavigation = (target, action) => {
    transition = { id: report.transitions.length + 1, from: page.url(), target, action, confirmed: false };
    report.transitions.push(transition); return transition;
  };
  async function navigateHelp(reload = false) {
    const current = beginNavigation(`${origin}/gcsp-help.html`, reload ? 'Paula reload' : 'Ordinary help navigation');
    try {
      const response = await (reload ? page.reload() : page.goto(current.target));
      assert.equal(response.status(), 200); await settled('.gcsp-case-content');
      assert.equal(page.url(), current.target); current.confirmed = true;
    } finally { transition = null; }
  }
  const focus = () => page.evaluate(() => {
    const node = document.activeElement; const style = getComputedStyle(node); const box = node.getBoundingClientRect();
    return { tag: node.tagName, id: node.id, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor, visible: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth };
  });
  // Reused from the existing FUCQ-122 runner: Tab reachability and native observed-label typeahead.
  async function tabTo(target) {
    await target.waitFor({ state: 'visible' });
    for (let presses = 0; presses < 160; presses++) {
      if (await target.evaluate((node) => node === document.activeElement)) {
        const value = await focus(); assert.ok(value.visible);
        report.keyboard.push({ action: 'Tab to control', presses, focus: value }); return;
      }
      await page.keyboard.press('Tab');
    }
    throw Error('Keyboard could not reach the selected control');
  }
  async function activate(target, label, key = 'Enter') {
    await tabTo(target); const before = await focus(); await page.keyboard.press(key);
    report.keyboard.push({ action: label, key, before, after: await focus() });
  }
  const pressButton = (name) => activate(button(name), name);
  async function fill(label, value) {
    const target = page.getByLabel(label, { exact: true }); await tabTo(target); await target.fill(value);
    assert.equal(await target.inputValue(), value);
    report.keyboard.push({ action: label, method: 'native automated text/date fill; focus reached with Tab', focus: await focus() });
  }
  async function select(label, value) {
    const target = page.getByLabel(label, { exact: true }); await tabTo(target);
    const choices = await target.evaluate((node) => [...node.options].map((option) => ({ value: option.value, label: option.label.trim(), disabled: option.disabled })));
    const chosen = choices.find((option) => option.value === value && !option.disabled); assert.ok(chosen?.label);
    assert.equal(choices.filter((option) => !option.disabled && option.label.toLowerCase() === chosen.label.toLowerCase()).length, 1);
    const previous = await target.inputValue();
    await target.evaluate((node) => {
      const watch = { id: node.id, events: [] };
      watch.record = (event) => { if (event.target.tagName === 'SELECT' && event.target.id === watch.id) watch.events.push({ type: event.type, trusted: event.isTrusted, value: event.target.value }); };
      window.fucq122SelectionWatch = watch;
      for (const type of ['input', 'change']) document.addEventListener(type, watch.record, true);
    });
    try {
      if (previous !== value) {
        await page.keyboard.press('Space');
        const characters = [...chosen.label]; let index = 0;
        for (let attempt = 0; attempt < characters.length + choices.length && await target.inputValue() !== value; attempt++) {
          await tabTo(target); const original = await target.elementHandle();
          try {
            await page.keyboard.type(characters[index]);
            index = await original.evaluate((node) => node.isConnected) ? index + 1 : 0;
            if (index === characters.length) break;
          } finally { await original.dispose(); }
        }
        assert.equal(await target.inputValue(), value);
        await tabTo(target); await page.keyboard.press('Enter');
      }
      await tabTo(target); await page.keyboard.press('Tab');
      assert.equal(await target.inputValue(), value);
      const events = await page.evaluate(() => window.fucq122SelectionWatch.events.slice());
      assert.ok(events.every((event) => event.trusted));
      if (previous !== value) for (const type of ['input', 'change']) assert.ok(events.some((event) => event.type === type && event.value === value));
      report.keyboard.push({ action: label, method: 'native observed-label typeahead', value, events });
    } finally {
      await page.evaluate(() => { const watch = window.fucq122SelectionWatch; for (const type of ['input', 'change']) document.removeEventListener(type, watch.record, true); delete window.fucq122SelectionWatch; });
    }
  }
  const settled = (selector) => page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-busy') === 'false', selector);
  async function capture(name, target) {
    await tabTo(target);
    const shape = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      status: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent.trim()) }));
    assert.ok(shape.scrollWidth <= shape.width, `${name}: document horizontal overflow`);
    const focused = await focus(); assert.ok(focused.visible);
    assert.notEqual(focused.outlineStyle, 'none'); assert.ok(parseFloat(focused.outlineWidth) > 0);
    const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true });
    report.captures.push({ path, shape, focus: focused });
  }
  async function switchTo(principalId) {
    const disclosure = page.locator('details.gcsp-presenter-controls');
    await disclosure.waitFor({ state: 'visible' });
    if (await disclosure.getAttribute('open') === null) await activate(disclosure.locator(':scope > summary'), 'Presenter controls', 'Space');
    const group = disclosure.getByRole('radiogroup', { name: 'Acting principal', exact: true });
    await tabTo(group.locator('button[tabindex="0"]'));
    const count = await group.getByRole('radio').count();
    for (let presses = 0; presses < count && await group.locator('button[aria-checked="true"]').getAttribute('data-value') !== principalId; presses++) await page.keyboard.press('ArrowRight');
    const choice = group.locator(`button[data-value="${principalId}"]`);
    assert.equal(await choice.getAttribute('aria-checked'), 'true');
    report.keyboard.push({ action: `Choose ${principalId}`, method: 'Tab into roving radio group, ArrowRight', focus: await focus() });
    const current = beginNavigation(`${origin}/gcsp-presenter.html`, `Presenter UI switch to ${principalId}`);
    try {
      // Switching from Greg to Paula reloads the same presenter URL. Wait for
      // a fresh document navigation, so the old URL/main cannot satisfy this.
      const [response] = await Promise.all([page.waitForNavigation({ url: current.target, waitUntil: 'domcontentloaded' }), pressButton('Switch principal')]);
      assert.equal(response.status(), 200);
      await page.locator(principalId === 'demo-greg' ? '[data-region="case-queue"] .gcsp-case-queue-content' : '[data-presenter-workspace] main').first().waitFor();
      const context = await read('context'); assert.equal(context.principalId, principalId);
      assert.equal(page.url(), current.target); current.confirmed = true; return context;
    } finally { transition = null; }
  }
  try {
    await navigateHelp();
    const paula = await read('context'); assert.equal(paula.principalId, 'demo-paula');
    assert.equal((await cases()).length, 0);
    const help = page.locator('details.gcsp-case-entry');
    if (await help.getAttribute('open') === null) await activate(help.locator(':scope > summary'), 'Open help disclosure', 'Space');
    await pressButton('Ask for help');
    const reason = 'Please review my replacement before my current contract ends.';
    await fill('What do you need help with?', reason); await pressButton('Review help request');
    assert.equal((await cases()).length, 0); assert.equal(posts('cases'), 0);
    await pressButton('Confirm help request'); await settled('.gcsp-case-content');
    const opened = await cases(); assert.equal(opened.length, 1); assert.equal(posts('cases'), 1);
    const original = opened[0]; assert.equal(original.status, 'open'); assert.equal(original.reason, reason);
    mark('Rendered help and review are read-only; one explicit confirmation creates one case');
    const greg = await switchTo('demo-greg'); assert.equal(greg.runId, paula.runId); assert.equal(greg.environmentId, paula.environmentId);
    await settled('[data-region="case-queue"] .gcsp-case-queue-content');
    assert.equal(await page.locator('[data-region="case-queue"] .gcsp-case-queue').count(), 1);
    assert.ok((await page.locator('[data-region="case-queue"]').innerText()).includes(reason));
    await select('Case to work', original.caseId); await pressButton('Open selected case');
    await page.getByLabel('Next case status', { exact: true }).waitFor();
    const projection = await read(`scheme-team/cases/options?${new URLSearchParams({ caseId: original.caseId })}`);
    assert.equal(projection.case.employeeName, paula.name);
    assert.deepEqual(caseRecord(projection.case), original, 'Opening Greg options leaves every stored case field unchanged');
    assert.ok(projection.nextStatuses.includes('in-progress')); assert.equal(projection.options.manualDecision.available, true);
    await select('Next case status', 'in-progress'); await select('Remedy to record', 'manualDecision');
    const action = 'Scheme team to contact Paula about the renewal plan.';
    const decision = 'Scheme team will discuss the renewal plan with Paula.';
    const dueInput = new Date(Date.parse(projection.asOf) + 3600000).toISOString().slice(0, 16);
    await fill('Reason for this update', 'Scheme team reviewed the request.'); await fill('Next action', action);
    await fill('Next action due, demo clock (UTC)', dueInput); await fill('Authorised scheme-team decision', decision);
    await pressButton('Review case update');
    const reviewed = (await read('scheme-team/cases')).cases;
    assert.equal(reviewed.length, 1); assert.equal(reviewed[0].employeeName, paula.name);
    assert.deepEqual(reviewed.map(caseRecord), opened, 'Greg review preserves every stored case field; only the role-specific display name is separate');
    assert.equal(posts('scheme-team/cases/update'), 0);
    await pressButton('Confirm case update'); await settled('[data-region="case-queue"] .gcsp-case-queue-content');
    const updated = (await read('scheme-team/cases')).cases.find((item) => item.caseId === original.caseId);
    assert.equal(updated.employeeName, paula.name);
    assert.equal(updated.version, original.version + 1); assert.equal(updated.status, 'in-progress');
    assert.equal(updated.nextAction, action); assert.equal(updated.dueAt, new Date(`${dueInput}Z`).toISOString());
    assert.deepEqual(updated.remedy, { type: 'manual-decision', decision }); assert.deepEqual(updated.owner, original.owner);
    assert.equal(updated.history.length, original.history.length + 1); assert.equal(updated.history.at(-1).actorId, greg.principalId);
    assert.equal(posts('scheme-team/cases/update'), 1);
    mark('Actual presenter Greg queue mounts once; review is read-only; one confirmation records the manual update');
    const returned = await switchTo('demo-paula'); assert.equal(returned.runId, paula.runId);
    await navigateHelp(); await navigateHelp(true);
    assert.deepEqual(await cases(), [caseRecord(updated)], 'Employee reload equals the complete persisted case, apart from Greg display-only name');
    const article = page.locator(`[data-case-id="${original.caseId}"]`);
    const content = await article.innerText();
    const dueText = updated.dueAt.replace('T', ' ').replace('.000Z', ' UTC');
    for (const text of [original.caseId, original.reason, 'In progress', action, decision, dueText, original.owner.name ?? original.owner.role]) assert.ok(content.includes(text));
    assert.ok((await page.locator('body').innerText()).includes('No specific next car or greater priority is guaranteed'));
    await activate(article.locator('details.gcsp-case-history > summary'), 'Dated case history', 'Space');
    assert.ok((await article.innerText()).includes(greg.principalId));
    assert.equal(posts('cases'), 1); assert.equal(posts('scheme-team/cases/update'), 1);
    // Proposed continuation only: the manual-decision case does not represent
    // Paula's preference-confirmation waiting state. Use two existing transitions.
    let persisted = updated;
    let expectedUpdatePosts = 1;
    const terminalSteps = [
      { status: 'resolved', label: 'Resolved', reason: 'The scheme team recorded the manual decision and resolved the case.',
        action: 'Scheme team to record the completed renewal review.', reviewCapture: '01-greg-resolved-review', employeeCapture: '02-paula-resolved-reload-history' },
      { status: 'closed', label: 'Closed', reason: 'The scheme team closed the case after recording the outcome.',
        action: 'No further case action is planned.', reviewCapture: '03-greg-closed-review', employeeCapture: '04-paula-closed-reload-history' },
    ];
    report.selectedContinuation = { states: terminalSteps.map((step) => step.status), waitingForPaulaSelected: false };
    for (const step of terminalSteps) {
      const gregAgain = await switchTo('demo-greg');
      assert.equal(gregAgain.runId, paula.runId); assert.equal(gregAgain.environmentId, paula.environmentId);
      await settled('[data-region="case-queue"] .gcsp-case-queue-content');
      await select('Case to work', original.caseId); await pressButton('Open selected case');
      await page.getByLabel('Next case status', { exact: true }).waitFor();
      const options = await read(`scheme-team/cases/options?${new URLSearchParams({ caseId: original.caseId })}`);
      assert.equal(options.case.employeeName, paula.name);
      assert.deepEqual(caseRecord(options.case), caseRecord(persisted));
      assert.ok(options.nextStatuses.includes(step.status), 'Use only a transition in the actual server projection');
      // Fresh options initialise remedyKey to empty: retain the existing manual decision.
      assert.equal(await page.getByLabel('Remedy to record', { exact: true }).inputValue(), '');
      await select('Next case status', step.status);
      await fill('Reason for this update', step.reason); await fill('Next action', step.action);
      await fill('Next action due, demo clock (UTC)', dueInput);
      await pressButton('Review case update');
      const reviewedAgain = (await read('scheme-team/cases')).cases;
      assert.deepEqual(reviewedAgain.map(caseRecord), [caseRecord(persisted)], 'Terminal review is read-only');
      assert.equal(posts('scheme-team/cases/update'), expectedUpdatePosts);
      await capture(step.reviewCapture, button('Confirm case update'));
      await pressButton('Confirm case update'); await settled('[data-region="case-queue"] .gcsp-case-queue-content');
      const next = (await read('scheme-team/cases')).cases.find((item) => item.caseId === original.caseId);
      assert.equal(next.employeeName, paula.name); assert.equal(next.status, step.status);
      assert.equal(next.version, persisted.version + 1); assert.equal(next.caseId, original.caseId);
      assert.equal(next.reason, original.reason); assert.deepEqual(next.owner, original.owner);
      assert.equal(next.nextAction, step.action); assert.equal(next.dueAt, new Date(`${dueInput}Z`).toISOString());
      assert.deepEqual(next.remedy, persisted.remedy); assert.equal(next.history.length, persisted.history.length + 1);
      assert.deepEqual(next.history.slice(0, -1), persisted.history);
      assert.equal(next.history.at(-1).actorId, greg.principalId); assert.equal(next.history.at(-1).status, step.status);
      assert.equal(next.history.at(-1).reason, step.reason); assert.equal(next.history.at(-1).nextAction, step.action);
      assert.equal(next.history.at(-1).dueAt, next.dueAt); assert.deepEqual(next.history.at(-1).remedy, next.remedy);
      assert.ok(Number.isFinite(Date.parse(next.history.at(-1).at)));
      expectedUpdatePosts += 1; assert.equal(posts('scheme-team/cases/update'), expectedUpdatePosts);
      const afterOptions = await read(`scheme-team/cases/options?${new URLSearchParams({ caseId: original.caseId })}`);
      assert.deepEqual(afterOptions.nextStatuses, step.status === 'resolved' ? ['closed'] : []);
      const paulaAgain = await switchTo('demo-paula'); assert.equal(paulaAgain.runId, paula.runId);
      await navigateHelp(); await navigateHelp(true);
      assert.deepEqual(await cases(), [caseRecord(next)], 'Paula reload equals the complete terminal stored record');
      const terminalArticle = page.locator(`[data-case-id="${original.caseId}"]`);
      assert.equal(await terminalArticle.getByRole('heading', { name: step.label, exact: true }).count(), 1);
      const terminalContent = await terminalArticle.innerText();
      for (const text of [original.caseId, original.reason, original.owner.name ?? original.owner.role,
        step.reason, step.action, next.dueAt.replace('T', ' ').replace('.000Z', ' UTC'), 'Recorded remedy', decision]) assert.ok(terminalContent.includes(text));
      const historySummary = terminalArticle.locator('details.gcsp-case-history > summary');
      await activate(historySummary, `${step.label} dated case history`, 'Space');
      const history = terminalArticle.locator('details.gcsp-case-history');
      assert.equal(await history.locator('li.gcsp-case-event').count(), next.history.length);
      assert.ok((await history.innerText()).includes(greg.principalId));
      await capture(step.employeeCapture, historySummary);
      assert.equal(posts('cases'), 1); assert.equal(posts('scheme-team/cases/update'), expectedUpdatePosts);
      report.checks.push(`${step.label}: reviewed without writing, explicitly confirmed, ordinary Paula reload/history equals the stored record`);
      persisted = next;
    }
    assert.equal(expectedUpdatePosts, 3);
    const cookies = await page.context().cookies();
    report.cookieAttributes = cookies.map(({ name, path, secure, httpOnly, sameSite }) => ({ name, path, secure, httpOnly, sameSite }));
    assert.ok(cookies.some((cookie) => cookie.name === 'gcsp_session' && cookie.path === '/api/gcsp' && cookie.secure && cookie.httpOnly));
    assert.ok(cookies.some((cookie) => cookie.name === 'GCSP_LOCAL_BOOTSTRAP' && cookie.path === '/' && cookie.secure && cookie.httpOnly));
    await Promise.all([...pending]); assert.deepEqual(report.errors, []);
    mark('Ordinary HTTPS navigation and Paula reload preserve the run and actual case; browser cookie paths remain scoped');
    report.case = { caseId: persisted.caseId, version: persisted.version, status: persisted.status, runId: paula.runId };
    report.state = 'passed'; return report;
  } catch (error) {
    report.errors.push({ kind: 'scenario', message: error.stack || error.message }); return report;
  } finally {
    await Promise.allSettled([...pending]);
    // Preserve every failed request. Classify only these exact read-only aborts
    // when observed across a deliberate, successfully completed page transition.
    for (const failure of report.requestFailures) {
      const navigation = report.transitions.find((item) => item.id === failure.transitionId);
      failure.expectedNavigationCancellation = failure.failure === 'net::ERR_ABORTED' && failure.method === 'GET'
        && ['/api/gcsp/manual/account', '/api/gcsp/presenter/controls'].includes(failure.path)
        && navigation?.confirmed === true && failure.documentURL === navigation.from;
      if (!failure.expectedNavigationCancellation) report.errors.push({ kind: 'request', ...failure });
    }
    if (report.errors.length) report.state = 'incomplete';
    page.off('request', onRequest); page.off('response', watch); page.off('pageerror', onError); page.off('console', onConsole); page.off('requestfailed', onFailure);
  }
}
