import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { startComposition } from './composition.mjs';

const experiments = ['process-only', 'order-mix', 'points', 'hold-sweep'];
const labels = ['Process only', 'Order mix', 'Points allowance', 'Hold duration'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const good = (response, label) => {
  assert.equal(response.status, 200, `${label}: HTTP ${response.status}`);
  assert.equal(response.body?.status, 'ok', label);
  return response.body.value;
};
async function until(check, label) {
  const end = performance.now() + 15000;
  while (performance.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(label);
}
async function cleanPresentation(root) {
  assert.equal(await root.locator('pre').count(), 0, 'No raw JSON dumps, including closed details');
  assert.equal(await root.locator('script, iframe, object, embed, [onerror], [onclick]').count(), 0,
    'Labelled result content contains no executable markup');
  const text = await root.innerText();
  assert.doesNotMatch(text, /employee-paula|employee-alex|operator-greg|@gcsp-demo\.com|Bearer\s+\S+/,
    'Comparison aggregates do not expose employee identities or authentication');
  assert.doesNotMatch(text, /\[object Object\]/, 'Nested values are labelled rather than coerced');
}
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.document <= size.viewport + 1, `Comparison fits ${size.viewport}px: ${size.document}`);
  return size;
}
async function bars(root) {
  return root.locator('.gcsp-range-bar').evaluateAll(figures => figures.map(figure => ({
    labelled: !!figure.getAttribute('aria-labelledby') && !!document.getElementById(figure.getAttribute('aria-labelledby')),
    rows: [...figure.querySelectorAll('.gcsp-range-bar-row')].map(row => ({
      label: row.querySelector('.gcsp-range-bar-label')?.textContent,
      value: row.querySelector('.gcsp-range-bar-value')?.textContent,
      missing: row.classList.contains('is-missing'),
      decorative: row.querySelector('.gcsp-range-bar-track')?.getAttribute('aria-hidden'),
      start: row.querySelector('.gcsp-range-bar-span')?.style.getPropertyValue('--gcsp-range-start') ?? null,
      end: row.querySelector('.gcsp-range-bar-span')?.style.getPropertyValue('--gcsp-range-end') ?? null,
      mean: row.querySelector('.gcsp-range-bar-mean')?.style.getPropertyValue('--gcsp-range-mean') ?? null,
    })),
  })));
}
async function openDetails(root) {
  for (const detail of await root.locator('details').all()) {
    if (!await detail.evaluate(node => node.open)) await detail.locator(':scope > summary').click();
  }
}
async function closeDetails(root) {
  for (const detail of await root.locator('details').all()) {
    if (await detail.evaluate(node => node.open)) await detail.locator(':scope > summary').click();
  }
  await root.evaluate(node => node.ownerDocument.defaultView.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
}
async function nodeCall(page, suffix) {
  return page.evaluate(async suffix => {
    const response = await fetch('/api/gcsp/comparison' + suffix, { credentials: 'include', cache: 'no-store' });
    return { status: response.status, body: await response.json() };
  }, suffix);
}

test('FUCQ-560: stored comparison labelled values, source range bars and native experiment picker',
  { timeout: 540000 }, async t => {
    const suite = await startComposition({ caseId: 'f560' });
    t.after(() => suite.close());
    const evidence = suite.receipt.comparison = { humanReviewer: '', humanVerdict: '', humanReviewDate: '', humanSource: '',
      groups: [], keyboard: [], pairs: [],
      source: 'Real Angular/Java/native PostgreSQL startup import, signed test OIDC and frozen Node HTTP stored reads.',
      exclusions: 'No comparison job or full-size workload. No invented result rows, successful response substitution or output rewrites.',
      escapingBoundary: 'Runtime inspects actual retained labelled strings and rejects executable markup. Hostile stored values are not injected; their escaping requires separate component/mapper evidence.' };
    async function check(name, work) {
      const group = { name, state: 'running' }; evidence.groups.push(group); let failure;
      await t.test(name, async () => {
        try { await work(); group.state = 'passed'; }
        catch (error) { group.state = 'failed'; group.failure = error.message.slice(0, 1000); failure = error; throw error; }
      });
      if (failure) throw failure;
    }
    const greg = await suite.newPage('f560-greg', 'demo-greg', 'comparison');
    const jobPosts = [];
    greg.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/gcsp/v1/comparison/jobs') jobPosts.push('POST /comparison/jobs');
    });
    const root = greg.locator('gcsp-comparison');
    const picker = root.getByRole('combobox', { name: 'Experiment', exact: true });
    await picker.waitFor();
    let stored; let catalogue; let artifact;
    await check('actual retained read identity and every typed statistic', async () => {
      catalogue = good(await suite.call(greg, 'GET', '/comparison/results/latest'), 'Actual comparison catalogue');
      stored = good(await suite.call(greg, 'GET', '/comparison/process/latest'), 'Actual native-PG process result');
      assert.deepEqual(catalogue.experiments.map(row => row.experimentId), experiments);
      assert.deepEqual(catalogue.experiments[0].latest, stored, 'Catalogue and process read return the same stored row');
      assert.equal(stored.origin, 'retained');
      const reference = process.env.GCSP_NODE_REFERENCE;
      assert.ok(reference && path.isAbsolute(reference) && !/OneDrive|CloudStorage/i.test(reference), 'Use the verified frozen local reference');
      artifact = JSON.parse(readFileSync(path.join(reference, 'server/data/gcsp/comparison/process-only.json'), 'utf8'));
      assert.equal(stored.resultDigest, artifact.digest, 'Actual Java read identifies the frozen retained artifact');
      assert.equal(digest(stored.result), artifact.digest, 'Actual read digest verifies all result content');
      assert.deepEqual(stored.result, artifact.result, 'All stored statistics, assumptions, manifest and provenance are preserved');
      assert.equal(stored.resultId, 'process-comparison-' + digest({ completedAt: stored.result.completedAt,
        manifest: stored.result.manifest, perSeed: stored.result.perSeed }).slice(0, 32));
      assert.equal(stored.policyVersion, stored.result.manifest.policyVersion);
      for (const difference of stored.result.differences) {
        for (const arm of ['current', 'buddy', 'difference']) {
          assert.deepEqual(Object.keys(difference[arm]).sort(),
            arm === 'difference' ? ['max', 'mean', 'min'] : ['max', 'mean', 'min', 'observedSeeds']);
          for (const key of ['mean', 'min', 'max']) assert.ok(difference[arm][key] === null || Number.isFinite(difference[arm][key]));
        }
      }
      evidence.storedRead = { experimentId: stored.result.experimentId, resultId: stored.resultId,
        resultDigest: stored.resultDigest, policyVersion: stored.policyVersion, activePolicyVersion: stored.activePolicyVersion,
        origin: stored.origin, storedAt: stored.storedAt, measures: stored.result.differences.map(row => row.measure) };
    });

    const angular = {};
    for (const width of [1280, 375]) {
      await check(`four native keyboard choices, honest empty results and labelled values at ${width}`, async () => {
        await greg.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
        assert.equal(await picker.evaluate(node => node.tagName), 'SELECT');
        assert.deepEqual(await picker.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent }))),
          experiments.map((value, i) => ({ value, label: labels[i] })));
        assert.equal(await picker.inputValue(), 'process-only');
        await root.locator('.comparison-result').waitFor();
        assert.equal(await root.locator('.gcsp-range-bar').count(), stored.result.differences.length);
        await openDetails(root);
        await cleanPresentation(root);
        assert.ok((await root.innerText()).includes(stored.resultId), 'Labelled provenance retains the actual result identity');
        assert.ok((await root.innerText()).includes(stored.resultDigest), 'Labelled provenance retains the actual digest');
        assert.ok(await root.locator('dt').count() > 0, 'Provenance uses labelled facts');
        await closeDetails(root);
        angular[width] = { bars: await bars(root), screenshot: await suite.screenshot(greg, `angular-comparison-process-only-${width}`, { fullPage: true }) };
        evidence[`layout${width}`] = await noOverflow(greg);
        await picker.focus();
        for (const [key, id] of [['o', 'order-mix'], ['p', 'points'], ['h', 'hold-sweep'], ['p', 'process-only']]) {
          // Chromium's closed native select uses paced type-ahead, starting after its selected option.
          await picker.press(key, { delay: 1200 });
          await until(async () => await picker.inputValue() === id, `Keyboard chooses ${id}`);
          assert.equal(await picker.evaluate(node => document.activeElement === node), true, 'Native keyboard focus remains on the experiment');
          evidence.keyboard.push({ width, key, expected: id, actual: await picker.inputValue(), focused: true });
          if (id !== 'process-only') {
            assert.equal(catalogue.experiments.find(row => row.experimentId === id).latest, null, 'This scenario really has no stored experiment');
            const missing = await suite.call(greg, 'GET', '/comparison/results/latest?experimentId=' + id);
            assert.equal(missing.status, 404); assert.equal(missing.body.status, 'not-found');
            await root.getByRole('heading', { name: 'No stored result yet', exact: true }).waitFor();
            assert.equal(await root.locator('.comparison-result, .gcsp-range-bar').count(), 0, 'No prior result is painted as the missing experiment');
            assert.equal(await picker.isEnabled(), true, 'The picker remains usable in the empty state');
            assert.equal(await root.getByRole('textbox', { name: 'Why try these values', exact: true }).isDisabled(), true,
              'The default runtime keeps comparison reruns unavailable');
            await cleanPresentation(root); await noOverflow(greg);
            await suite.screenshot(greg, `angular-comparison-${id}-empty-${width}`, { fullPage: true });
          } else await root.locator('.comparison-result').waitFor();
        }
      });
    }

    await check('live frozen Node reads the same stored experiment and source range scales', async () => {
      const node = await suite.visitFrozenNode({ comparison: true }, async ({ page }) => {
        const actual = good(await nodeCall(page, '/process/latest'), 'Actual frozen Node stored process read');
        assert.equal(actual.resultId, stored.resultId);
        assert.deepEqual(actual.result, stored.result, 'Both live implementations read the exact same immutable result');
        assert.equal(digest(actual.result), stored.resultDigest, 'Frozen HTTP result verifies the same digest');
        assert.equal(actual.policyVersion, stored.policyVersion);
        await page.getByRole('tab', { name: 'Route comparison', exact: true }).click();
        const source = page.locator('.gcsp-comparison');
        await until(async () => await source.locator('.gcsp-range-bar').count() === stored.result.differences.length,
          'The live frozen comparison renders every retained measure');
        const sourceMeasures = await page.evaluate(async stored => {
          const { toComparisonView } = await import('/blocks/gcsp/greg/comparison/comparison-view.js');
          return toComparisonView(stored).measures.map(measure => ({ key: measure.key, label: measure.label,
            scale: measure.scale, rows: measure.rows.map(row => ({ ...row,
              text: row.mean === null ? 'Not observed' : Number.isFinite(row.min) && Number.isFinite(row.max) && row.min !== row.max
                ? `${measure.format(row.mean)} (${measure.format(row.min)} to ${measure.format(row.max)})` : String(measure.format(row.mean)) })) }));
        }, actual);
        const captures = {};
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
          await openDetails(source); await cleanPresentation(source);
          const sourceBars = await bars(source);
          assert.equal(sourceBars.length, sourceMeasures.length);
          for (const [index, bar] of sourceBars.entries()) {
            assert.equal(bar.labelled, true); assert.equal(bar.rows.length, 2);
            assert.deepEqual(bar.rows.map(row => row.value), sourceMeasures[index].rows.map(row => row.text));
            assert.ok(bar.rows.every(row => row.decorative === 'true'));
          }
          assert.deepEqual(angular[width].bars, sourceBars, 'Every Angular mean/range text, missing marker and shared-scale position equals frozen source');
          await closeDetails(source);
          captures[width] = await suite.screenshot(page, `node-comparison-process-only-${width}`, { fullPage: true });
          evidence.pairs.push({ screen: 'comparison', state: 'stored-process-only', experimentId: actual.result.experimentId,
            resultId: actual.resultId, resultDigest: digest(actual.result), viewport: `${width}x${width === 1280 ? 800 : 812}`,
            node: captures[width], angular: angular[width].screenshot, reviewer: '', verdict: '', date: '', source: '' });
        }
        return { comparison: { resultId: actual.resultId, digest: digest(actual.result), sourceMeasures, screenshots: captures,
          identityNote: 'Frozen read has no digest/origin fields; digest is recomputed from its unmodified HTTP result. Import times may differ.',
          humanReviewer: '', humanVerdict: '' } };
      });
      assert.ok(node.comparison);
    });

    await check('unavailable read and real denied role reveal no retained result', async () => {
      const pattern = suite.apiBase + '/comparison/results/latest';
      let aborted = 0;
      const abort = async route => { aborted++; await route.abort('failed'); };
      await greg.route(pattern, abort);
      try {
        for (const width of [1280, 375]) {
          if (width === 375) {
            // Start each failure trial from ready, so an old unavailable heading cannot satisfy the wait.
            await greg.unroute(pattern, abort);
            await root.getByRole('button', { name: 'Refresh', exact: true }).click();
            await picker.waitFor();
            await greg.route(pattern, abort);
          }
          await greg.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
          await root.getByRole('button', { name: 'Refresh', exact: true }).click();
          await root.getByRole('heading', { name: 'Comparisons are unavailable', exact: true }).waitFor();
          assert.equal(await root.getByRole('heading', { name: 'Loading the stored comparisons', exact: true }).count(), 0);
          assert.equal(await root.locator('.comparison-result, .gcsp-range-bar').count(), 0);
          await cleanPresentation(root); await noOverflow(greg);
          await suite.screenshot(greg, `angular-comparison-unavailable-${width}`, { fullPage: true });
        }
        assert.equal(aborted, 2);
      } finally { await greg.unroute(pattern, abort); }
      await root.getByRole('button', { name: 'Refresh', exact: true }).click(); await picker.waitFor();
      const paula = await suite.newPage('f560-denied-paula', 'demo-paula', 'help');
      const refused = await suite.call(paula, 'GET', '/comparison/process/latest');
      assert.equal(refused.status, 403, 'Actual signed employee token cannot read comparison aggregates');
      await paula.goto(suite.origins.web + '/gcsp/comparison', { waitUntil: 'domcontentloaded' });
      await paula.waitForURL(url => url.pathname === '/gcsp/access-denied');
      await paula.getByRole('heading', { name: 'Access not available', exact: true }).waitFor();
      for (const width of [1280, 375]) {
        await paula.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
        assert.equal(await paula.locator('.comparison-result, .gcsp-range-bar').count(), 0);
        await noOverflow(paula); await suite.screenshot(paula, `angular-comparison-denied-${width}`, { fullPage: true });
      }
      evidence.refusals = { unavailable: 'Actual comparison GET transport aborted; no response substituted.', deniedHttp: refused.status,
        deniedScreen: '/gcsp/access-denied', missing: 'Actual null catalogue entries and per-experiment HTTP 404.' };
    });
    assert.deepEqual(jobPosts, [], 'Inspecting and switching stored experiments starts no comparison jobs');
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No application runtime errors');
  });
