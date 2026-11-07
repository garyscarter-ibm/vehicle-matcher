# Waiting/confirmation input proposal — 6 November 2026

**UNEXECUTED SOURCE PROPOSAL. No server, browser, DB, tests, syntax checks, application/helper probes, scratch or reservations were started.** Root review and a separate execution grant remain outstanding. This implements only the source preparation requested after the [input assessment](waiting-input-source-assessment.md), published at `86df7324726ffc8c5b749555771ffccbdc1f345c`. Original eight ACs/validate, Result, prior raw incomplete/exit1 evidence and valid manual/resolved/closed observations are unchanged. Diagnosis remains an original scenario-input gap, not a confirmed new defect.

The three personal source inputs and their source catalogue are ignored under `.claude/test-runs/fucq122/current-browser-1718/waiting-source-proposed/`. This document preserves their exact source diffs; [the binding](waiting-source-binding.json) pins their bytes, inherited helpers, selected scenario and invocation. No application or supervisor implementation is changed.

## Selected path and expected observations

One 375×812 scenario uses the actual HTTPS launcher in explicit memory/local-synthetic mode. First ordinary HTML navigation obtains this run's real bootstrap cookies. The scenario resolves those browser-issued synthetic sessions through the real identity service solely in memory; it injects no browser cookies and logs no credentials/authority contexts. In the same supervised Node worker, it reuses the existing `createCompositionTestProfile`, both canonical reviewed bundles from the composition recipe (fresh identity contexts after activation), actual brief draft/confirmation, real stock pull/tick and release receipt, actual current repository revisions and `buddy.allocate`. It then declines the actual offer through the existing UI using the current canonical reason. The source is labelled TEST-only, not F77/F78 or live BMW; this is assisted input preparation, not proof of automatic allocation/F96 fairness, mail or native storage.

Greg then uses the real queue/editor and server-projected statuses, decision ID, current brief version, preference path and permitted value/index. Paula uses the ordinary help page, waiting review and explicit preference confirmation. F107 is never confirmed. Expected selected observations:

- One real offer-decision POST records the decline; one help POST opens the case. Greg's two explicit updates move `open → in-progress → remedy-proposed`, each adding one case version/history item; both reviews leave records/POST counts unchanged.
- The remedy comes from the actual `preferences.body.value` projection and its `saloon` entry, or the scenario stops with the observed missing-input failure. No manufactured fallback records, options or outcomes.
- Ordinary Paula navigation/reload shows applicable **Waiting for your confirmation**. Opening **Review body change** changes neither brief/history nor case and sends no change POST.
- One **Confirm preference change** sends one `/brief/change-after-decline` POST and creates exactly one next confirmed brief. Only the registered body value and its confirmation metadata change; importance/other preferences, essentials and other stable content remain equal. `postDeclineChange` must link the real decision/offer/from-version/path/before/after/Paula/time.
- Ordinary reload shows that same brief and confirmed case projection. The stored case stays `remedy-proposed` with its current Greg history intact: employee brief confirmation does not resolve it or append an invented case-history event.
- Four captures: Greg preference review, Paula waiting, Paula preference review, Paula confirmed reload/history. Existing Tab/typeahead/radio helpers, focus/overflow observations and full network/error retention are reused. These are proposed checks, not passed tests or complete keyboard/announcement evidence.

The inherited error/outcome handling is preserved: HTTP/console failures and every failed request remain in the raw result, with only its existing exact deliberate-navigation cancellation classification. Existing clean-log assertions are runner outcome handling, not new Story ACs; prior incomplete/exit1 results are not replaced. Every future actual capture requires inspection against `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md` and the current shared GCSP/Density references.

## Binding and execution boundary

Proposed entry invocation, **not executed and not granted**:

```sh
FUCQ122_BROWSER_LANE_GRANTED=explicit-root-release /usr/bin/python3 -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122/current-browser-1718/waiting-source-proposed/browser-supervisor.py journey-narrow375
```

Only `journey-narrow375` is selected; the new runner rejects any other chunk. All assisted preparation runs inside the existing single worker and its elapsed/resource budget. Reuse the unchanged supervisor/finalizer and strict all-raw HostBudget admission: one Chrome, 120 seconds, maximum 2,560MiB aggregate recursive RSS with at least 2,048MiB admission, 128MiB combined retained output/scratch, 2MiB log, one attempt, no retry/full suite. The supervisor still creates the ownership checkpoint before scratch; its PID/start-identity union, process groups, ports, profile/scratch paths and reservation token must all be independently collected by root after stop/join/removal. No such resources or receipt exist for this proposal.

The copied F122 wrapper and inherited F103 supervisor are byte-for-byte unchanged. The wrapper's historical `report.excluded` string still describes the earlier manual/resolved/closed selection and says waiting/producer setup is excluded. That inherited text cannot describe this selected scenario; the binding and runner's `setup`/`assistedSetup` define the proposed scope. Preserve that discrepancy explicitly in any future raw receipt/review; this source phase neither changes resource machinery nor treats stale metadata as evidence that assisted setup was omitted.

The catalogue retains every one of the previous 698 pins unchanged and adds only the selected inputs and previously unpinned existing recipe/helper sources. Source-root membership is unchanged. Byte hashing/static diff inspection are the only checks performed; no executable was launched for a scenario or helper probe. Any later source drift is for root to assess before a grant, not permission to repin/run autonomously. New features/ACs and sub-High defect repairs remain outside this claimed scope; collaborators retain equal authority.

## Exact runner diff

Zero-context diffs preserve exact changes without whitespace-only context lines.

```diff
--- /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122/current-browser-1718/resolved-closed-selected-1819/browser-runner.mjs
+++ /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122/current-browser-1718/waiting-source-proposed/browser-runner.mjs
@@ -8 +8 @@
-import { runCaseJourney } from '../scenario-resolved-closed-proposed.mjs';
+import { runCaseJourney, stockProvider } from './scenario-waiting-proposed.mjs';
@@ -11 +11 @@
-assert.ok(['journey-desktop', 'journey-narrow375'].includes(chunk));
+assert.equal(chunk, 'journey-narrow375');
@@ -33 +33 @@
-    mode: 'memory', environmentId: `fucq122-current-browser-1718-${chunk}`, policyAsOf: '2026-11-06T09:00:00.000Z', commandId: 'browser-bootstrap',
+    mode: 'memory', stockProvider, environmentId: `fucq122-waiting-source-${chunk}`, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'waiting-browser-bootstrap',
@@ -52 +52 @@
-  report = { ...await runCaseJourney({ page, origin: app.origin, output, viewport }), chunk,
+  report = { ...await runCaseJourney({ page, origin: app.origin, output, viewport, services: app.services }), chunk,
@@ -54 +54 @@
-    setup: 'Fresh empty browser context; first ordinary HTML GET adopts actual bootstrap cookies; presenter UI switches actors. No cookie injection or policy overrides.' };
+    setup: 'First ordinary HTML adopts actual bootstrap cookies; server-assisted canonical adoption/brief/release/exact-candidate offer via existing labelled TEST profile; actual offer decline and Greg/Paula case actions use UI; no cookie injection or direct repository mutation.' };
```

## Exact scenario diff

```diff
--- /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122/current-browser-1718/scenario.mjs
+++ /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122/current-browser-1718/waiting-source-proposed/scenario-waiting-proposed.mjs
@@ -3 +3 @@
-// This module neither starts resources nor selects a fixture or authority cookie.
+// The labelled TEST provider prepares input through existing services in the admitted worker; no authority cookie is injected.
@@ -5,0 +6,3 @@
+import { createCompositionTestProfile } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-060/server/test/helpers/runtime-composition-profile.js';
+import { essential, preference } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-060/server/test/helpers/employee-recommendation.js';
+import { inputDigest } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-060/server/gcsp/repository/index.js';
@@ -7 +10,3 @@
-export async function runCaseJourney({ page, origin, output, viewport }) {
+export const stockProvider = createCompositionTestProfile();
+
+export async function runCaseJourney({ page, origin, output, viewport, services }) {
@@ -10 +15 @@
-  assert.ok([1280, 375].includes(viewport.width));
+  assert.deepEqual(viewport, { width: 375, height: 812 });
@@ -47 +52 @@
-  const caseRecord = ({ employeeName, ...record }) => record;
+  const caseRecord = ({ employeeName, relaxation, ...record }) => record;
@@ -156,0 +162,65 @@
+  async function prepareInput() {
+    // Resolve this run's actual browser-issued synthetic sessions; never inject cookies,
+    // construct contexts, or serialize these credentials into any result/ledger/log.
+    const cookie = (await page.context().cookies(`${origin}/api/gcsp/context`))
+      .map((entry) => `${entry.name}=${entry.value}`).join('; ');
+    const presenter = good(await services.identity.resolveSession({ authorized: true, cookie, purpose: 'presenter-control' }));
+    const issued = good(await services.identity.switchPrincipal(presenter, 'demo-greg', 'waiting-policy-greg'));
+    const gregCookie = [issued.setCookie].flat().map((entry) => entry.split(';')[0]).join('; ');
+    const publications = [];
+    for (const [index, definitionSetId] of ['offer-decline-reasons-v1', 'offer-followup-questions-v1'].entries()) {
+      const greg = good(await services.identity.resolveSession({ authorized: true, cookie: gregCookie }));
+      const time = good(await services.clock.now(greg));
+      const policyVersion = `waiting-input-policy-${index + 1}`;
+      const adopted = good(await services.policy.adoptReviewedAssumptions(greg, {
+        commandId: `waiting-adopt:${definitionSetId}`, expectedActiveVersion: greg.policyVersion,
+        policyVersion, effectiveFrom: time.now, definitionSetId,
+      }));
+      assert.equal(adopted.activationRequired, false); assert.equal(adopted.activation.policyVersion, policyVersion);
+      publications.push({ definitionSetId, policyVersion });
+      if (index === 0) good(await services.clock.advance(presenter, {
+        commandId: 'waiting-next-publication', expectedClockVersion: time.clockVersion, bySeconds: 1,
+      }));
+    }
+    const employee = good(await services.identity.resolveSession({ authorized: true, cookie }));
+    assert.equal(employee.principalId, 'demo-paula'); assert.equal(employee.policyVersion, publications.at(-1).policyVersion);
+    const history = good(await services.brief.readHistory(employee)).versions; assert.equal(history.length, 0);
+    assert.equal((await services.brief.readDraft(employee)).status, 'not-found');
+    const draft = good(await services.brief.saveDraft(employee, {
+      commandId: 'waiting-brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
+      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } },
+    }));
+    const saved = good(await services.brief.confirm(employee, {
+      commandId: 'waiting-brief-confirm', expectedBriefVersion: draft.baseBriefVersion, expectedDraftVersion: draft.draftVersion,
+      consent: { search: true, hold: true },
+    }));
+    const car = await stockProvider.prepare(services, employee);
+    const before = good(await services.clock.now(presenter));
+    good(await services.clock.advance(presenter, {
+      commandId: 'waiting-release-noon', expectedClockVersion: before.clockVersion, to: '2026-11-05T12:00:00.000Z',
+    }));
+    const time = good(await services.clock.now(presenter));
+    good(await services.clock.tick(presenter, {
+      eventId: 'waiting-release-stock', inputDigest: inputDigest('waiting-release-stock'), expectedClockVersion: time.clockVersion,
+    }));
+    const reference = (table, key) => ({ table, key: { runId: employee.runId, ...key } });
+    const stock = good(await services.repository.read(employee, reference('stock', { orderUuid: car.orderUuid })));
+    const owner = good(await services.repository.read(employee, reference('employees', { employeeId: employee.employeeId })));
+    const slot = good(await services.repository.read(employee, reference('entitlement_slots', { entitlementSlotId: employee.entitlementSlotId })));
+    const releases = good(await services.repository.query(employee, 'event_receipts', { consumerId: 'stock-release' }));
+    const release = releases.find((row) => row.state === 'completed' && row.outcome?.value?.orderUuids?.includes(car.orderUuid));
+    assert.ok(release); assert.equal(stock.state, 'released'); assert.equal(stock.available, true);
+    const allocation = good(await services.buddy.allocate(employee, {
+      commandId: 'waiting-actual-offer', orderUuid: car.orderUuid, expectedBriefVersion: saved.brief.briefVersion,
+      expectedStockVersion: stock.version, expectedEmployeeVersion: owner.version, expectedSlotVersion: slot.version,
+    }));
+    assert.equal(allocation.state, 'offered'); assert.equal(allocation.offer.state, 'active');
+    report.assistedSetup = { mode: 'memory/local-synthetic', source: 'Existing labelled TEST composition profile; not F77/F78/live BMW',
+      publications, runId: employee.runId, briefVersion: saved.brief.briefVersion,
+      stock: { orderUuid: car.orderUuid, configurationId: car.configurationId, corpusVersion: car.corpusVersion },
+      release: { consumerId: release.consumerId, eventId: release.eventId, state: release.state },
+      offer: { offerId: allocation.offer.offerId, holdId: allocation.offer.holdId, quoteId: allocation.offer.quoteId },
+      providerCalls: stockProvider.calls.map((entry) => ({ ...entry })),
+      boundary: 'Server-assisted input in the same owned worker; no direct repository writes, F96 fairness, automatic journey, mail or native acceptance claim.' };
+    return allocation.offer;
+  }
@@ -159 +229 @@
-    const paula = await read('context'); assert.equal(paula.principalId, 'demo-paula');
+    let paula = await read('context'); assert.equal(paula.principalId, 'demo-paula');
@@ -160,0 +231,28 @@
+    const offer = await prepareInput();
+    paula = await read('context'); assert.equal(paula.policyVersion, report.assistedSetup.publications.at(-1).policyVersion);
+    assert.equal((await cases()).length, 0);
+    const offerTarget = `${origin}/gcsp/offer?${new URLSearchParams({ offerId: offer.offerId, runId: paula.runId })}`;
+    const navigation = beginNavigation(offerTarget, 'Open actual assisted offer');
+    try {
+      const response = await page.goto(offerTarget); assert.equal(response.status(), 200);
+      await button('Decline this offer').waitFor({ state: 'visible' }); assert.equal(await button('Decline this offer').isEnabled(), true);
+      navigation.confirmed = true;
+    } finally { transition = null; }
+    await pressButton('Decline this offer');
+    await page.getByLabel('Reason for declining', { exact: true }).waitFor({ state: 'visible' });
+    const reasons = await read(`offers/${encodeURIComponent(offer.offerId)}/decision-reasons?${new URLSearchParams({ runId: paula.runId })}`);
+    assert.ok(reasons.reasons.some((row) => row.code === 'body-style'));
+    await select('Reason for declining', 'body-style');
+    const decisionPath = `offers/${encodeURIComponent(offer.offerId)}/decision`;
+    assert.equal(posts(decisionPath), 0);
+    await pressButton('Confirm decline');
+    await page.getByRole('heading', { name: 'Offer declined', exact: true }).waitFor();
+    assert.equal(posts(decisionPath), 1); assert.equal(posts('offer-followup/confirm'), 0);
+    const declined = await read(`offers/${encodeURIComponent(offer.offerId)}?${new URLSearchParams({ runId: paula.runId })}`);
+    assert.equal(declined.state, 'declined'); assert.ok(declined.followup?.decisionId);
+    const decisionId = declined.followup.decisionId;
+    report.assistedSetup.decision = { decisionId, offerId: offer.offerId, state: declined.state };
+    await navigateHelp();
+    const beforeBrief = (await read('brief')).brief;
+    assert.equal(beforeBrief.briefVersion, report.assistedSetup.briefVersion);
+    assert.equal((await read('brief/history')).versions.length, 1); assert.equal(beforeBrief.postDeclineChange, undefined);
@@ -163 +260,0 @@
-    await capture('01-paula-help', button('Ask for help'));
@@ -168 +264,0 @@
-    await capture('02-paula-confirmation', button('Confirm help request'));
@@ -172 +267,0 @@
-    mark('Rendered help and review are read-only; one explicit confirmation creates one case');
@@ -175,30 +270,40 @@
-    assert.equal(await page.locator('[data-region="case-queue"] .gcsp-case-queue').count(), 1);
-    assert.ok((await page.locator('[data-region="case-queue"]').innerText()).includes(reason));
-    await capture('03-greg-actual-queue', page.getByLabel('Case to work', { exact: true }));
-    await select('Case to work', original.caseId); await pressButton('Open selected case');
-    await page.getByLabel('Next case status', { exact: true }).waitFor();
-    const projection = await read(`scheme-team/cases/options?${new URLSearchParams({ caseId: original.caseId })}`);
-    assert.equal(projection.case.employeeName, paula.name);
-    assert.deepEqual(caseRecord(projection.case), original, 'Opening Greg options leaves every stored case field unchanged');
-    assert.ok(projection.nextStatuses.includes('in-progress')); assert.equal(projection.options.manualDecision.available, true);
-    await select('Next case status', 'in-progress'); await select('Remedy to record', 'manualDecision');
-    const action = 'Scheme team to contact Paula about the renewal plan.';
-    const decision = 'Scheme team will discuss the renewal plan with Paula.';
-    const dueInput = new Date(Date.parse(projection.asOf) + 3600000).toISOString().slice(0, 16);
-    await fill('Reason for this update', 'Scheme team reviewed the request.'); await fill('Next action', action);
-    await fill('Next action due, demo clock (UTC)', dueInput); await fill('Authorised scheme-team decision', decision);
-    await pressButton('Review case update');
-    const reviewed = (await read('scheme-team/cases')).cases;
-    assert.equal(reviewed.length, 1); assert.equal(reviewed[0].employeeName, paula.name);
-    assert.deepEqual(reviewed.map(caseRecord), opened, 'Greg review preserves every stored case field; only the role-specific display name is separate');
-    assert.equal(posts('scheme-team/cases/update'), 0);
-    await capture('04-greg-update-review', button('Confirm case update'));
-    await pressButton('Confirm case update'); await settled('[data-region="case-queue"] .gcsp-case-queue-content');
-    const updated = (await read('scheme-team/cases')).cases.find((item) => item.caseId === original.caseId);
-    assert.equal(updated.employeeName, paula.name);
-    assert.equal(updated.version, original.version + 1); assert.equal(updated.status, 'in-progress');
-    assert.equal(updated.nextAction, action); assert.equal(updated.dueAt, new Date(`${dueInput}Z`).toISOString());
-    assert.deepEqual(updated.remedy, { type: 'manual-decision', decision }); assert.deepEqual(updated.owner, original.owner);
-    assert.equal(updated.history.length, original.history.length + 1); assert.equal(updated.history.at(-1).actorId, greg.principalId);
-    assert.equal(posts('scheme-team/cases/update'), 1);
-    mark('Actual presenter Greg queue mounts once; review is read-only; one confirmation records the manual update');
+    let previous = original; let proposal;
+    for (const [index, status] of ['in-progress', 'remedy-proposed'].entries()) {
+      await select('Case to work', original.caseId); await pressButton('Open selected case');
+      await page.getByLabel('Next case status', { exact: true }).waitFor();
+      const projection = await read(`scheme-team/cases/options?${new URLSearchParams({ caseId: original.caseId })}`);
+      assert.equal(projection.case.employeeName, paula.name); assert.deepEqual(caseRecord(projection.case), caseRecord(previous));
+      assert.ok(projection.nextStatuses.includes(status));
+      await select('Next case status', status);
+      if (status === 'remedy-proposed') {
+        const items = projection.options.preferenceRelaxations.items;
+        assert.equal(projection.options.preferenceRelaxations.available, true);
+        const choiceIndex = items.findIndex((item) => item.path === 'preferences.body.value' && item.decisionId === decisionId);
+        assert.ok(choiceIndex >= 0); const choice = items[choiceIndex];
+        assert.equal(choice.expectedBriefVersion, beforeBrief.briefVersion); assert.equal(choice.valueType, 'enum');
+        const valueIndex = choice.values.findIndex((value) => value === 'saloon'); assert.ok(valueIndex >= 0);
+        proposal = { type: 'preference-relaxation', decisionId: choice.decisionId,
+          expectedBriefVersion: choice.expectedBriefVersion, path: choice.path, value: choice.values[valueIndex] };
+        await select('Remedy to record', `preferenceRelaxations:${choiceIndex}`);
+        await select('Proposed preference value', String(valueIndex));
+      }
+      const updateReason = status === 'in-progress' ? 'Scheme team reviewed the request.' : 'Scheme team proposes one body preference change for Paula to confirm.';
+      const nextAction = status === 'in-progress' ? 'Scheme team to review Paula’s preferences.' : 'Paula to review the proposed body preference change.';
+      const dueInput = new Date(Date.parse(projection.asOf) + 3600000).toISOString().slice(0, 16);
+      await fill('Reason for this update', updateReason); await fill('Next action', nextAction);
+      await fill('Next action due, demo clock (UTC)', dueInput); await pressButton('Review case update');
+      const reviewed = (await read('scheme-team/cases')).cases;
+      assert.equal(reviewed.length, 1); assert.deepEqual(caseRecord(reviewed[0]), caseRecord(previous));
+      assert.equal(posts('scheme-team/cases/update'), index);
+      if (proposal) await capture('01-greg-preference-review', button('Confirm case update'));
+      await pressButton('Confirm case update'); await settled('[data-region="case-queue"] .gcsp-case-queue-content');
+      const current = (await read('scheme-team/cases')).cases[0];
+      assert.equal(current.caseId, original.caseId); assert.equal(current.version, previous.version + 1); assert.equal(current.status, status);
+      assert.equal(current.reason, original.reason); assert.deepEqual(current.owner, original.owner);
+      assert.equal(current.nextAction, nextAction); assert.equal(current.dueAt, new Date(`${dueInput}Z`).toISOString());
+      assert.deepEqual(current.history.slice(0, -1), previous.history); assert.equal(current.history.at(-1).actorId, greg.principalId);
+      if (proposal) assert.deepEqual(current.remedy, { ...proposal, confirmationState: 'employee-confirmation-required' });
+      else assert.equal(current.remedy, null);
+      assert.equal(posts('scheme-team/cases/update'), index + 1); previous = current;
+    }
+    mark('Greg uses projected current decision/version/path/value; review is read-only and each explicit update appends one real case event');
@@ -207,6 +312,39 @@
-    assert.deepEqual(await cases(), [caseRecord(updated)], 'Employee reload equals the complete persisted case, apart from Greg display-only name');
-    const article = page.locator(`[data-case-id="${original.caseId}"]`);
-    const content = await article.innerText();
-    const dueText = updated.dueAt.replace('T', ' ').replace('.000Z', ' UTC');
-    for (const text of [original.caseId, original.reason, 'In progress', action, decision, dueText, original.owner.name ?? original.owner.role]) assert.ok(content.includes(text));
-    assert.ok((await page.locator('body').innerText()).includes('No specific next car or greater priority is guaranteed'));
+    const waiting = (await cases())[0]; assert.deepEqual(caseRecord(waiting), caseRecord(previous));
+    assert.equal(waiting.relaxation.applicable, true); assert.equal(waiting.relaxation.confirmed, false);
+    assert.equal(waiting.relaxation.currentBriefVersion, beforeBrief.briefVersion);
+    let article = page.locator(`[data-case-id="${original.caseId}"]`);
+    assert.ok((await article.innerText()).includes('Waiting for your confirmation. Only this preference value will change.'));
+    await capture('02-paula-waiting', button('Review body change'));
+    assert.equal(posts('brief/change-after-decline'), 0);
+    await pressButton('Review body change');
+    await page.getByRole('heading', { name: 'Confirm one preference change', exact: true }).waitFor();
+    assert.equal(posts('brief/change-after-decline'), 0);
+    assert.deepEqual((await read('brief')).brief, beforeBrief);
+    assert.deepEqual((await read('brief/history')).versions, [beforeBrief]);
+    assert.deepEqual(await cases(), [waiting]);
+    await capture('03-paula-preference-review', button('Confirm preference change'));
+    await pressButton('Confirm preference change'); await settled('.gcsp-case-content');
+    const afterBrief = (await read('brief')).brief; const change = afterBrief.postDeclineChange;
+    assert.equal(posts('brief/change-after-decline'), 1); assert.equal(afterBrief.briefVersion, beforeBrief.briefVersion + 1);
+    assert.equal(afterBrief.previousBriefVersion, beforeBrief.briefVersion); assert.equal(afterBrief.status, 'confirmed');
+    assert.deepEqual(afterBrief.essentials, beforeBrief.essentials);
+    assert.deepEqual(afterBrief.preferences, { ...beforeBrief.preferences,
+      body: { ...beforeBrief.preferences.body, value: proposal.value, confirmedAt: afterBrief.confirmedAt } });
+    const stable = ({ briefVersion, previousBriefVersion, preferences, postDeclineChange, confirmedBy, confirmedAt, version, createdAt, updatedAt, ...fields }) => fields;
+    assert.deepEqual(stable(afterBrief), stable(beforeBrief));
+    assert.deepEqual(change, { decisionId, offerId: offer.offerId, fromBriefVersion: beforeBrief.briefVersion,
+      path: proposal.path, before: beforeBrief.preferences.body.value, after: proposal.value,
+      confirmedBy: paula.principalId, confirmedAt: afterBrief.confirmedAt });
+    assert.equal(afterBrief.confirmedBy, paula.principalId); assert.ok(Number.isFinite(Date.parse(change.confirmedAt)));
+    const history = (await read('brief/history')).versions;
+    assert.deepEqual(history, [beforeBrief, afterBrief]);
+    assert.equal(history.filter((brief) => brief.postDeclineChange?.decisionId === decisionId).length, 1);
+    mark('Waiting/review performs no change; one explicit Paula confirmation creates exactly one linked brief version and preserves essentials/other content');
+    await navigateHelp(true);
+    const reloaded = (await cases())[0]; assert.deepEqual(caseRecord(reloaded), caseRecord(previous));
+    assert.equal(reloaded.status, 'remedy-proposed'); assert.equal(reloaded.relaxation.confirmed, true);
+    assert.equal(reloaded.relaxation.currentBriefVersion, afterBrief.briefVersion);
+    assert.deepEqual((await read('brief')).brief, afterBrief); assert.deepEqual((await read('brief/history')).versions, history);
+    article = page.locator(`[data-case-id="${original.caseId}"]`);
+    assert.ok((await article.innerText()).includes('You confirmed this preference change. The scheme team will review the case.'));
+    assert.equal(await button('Confirm preference change').count(), 0);
@@ -214,7 +352,7 @@
-    assert.ok((await article.innerText()).includes(greg.principalId));
-    await capture('05-paula-reload-history', article.locator('details.gcsp-case-history > summary'));
-    assert.equal(posts('cases'), 1); assert.equal(posts('scheme-team/cases/update'), 1);
-    const cookies = await page.context().cookies();
-    report.cookieAttributes = cookies.map(({ name, path, secure, httpOnly, sameSite }) => ({ name, path, secure, httpOnly, sameSite }));
-    assert.ok(cookies.some((cookie) => cookie.name === 'gcsp_session' && cookie.path === '/api/gcsp' && cookie.secure && cookie.httpOnly));
-    assert.ok(cookies.some((cookie) => cookie.name === 'GCSP_LOCAL_BOOTSTRAP' && cookie.path === '/' && cookie.secure && cookie.httpOnly));
+    for (const item of reloaded.history) for (const text of [item.actorId, item.reason]) assert.ok((await article.innerText()).includes(text));
+    await capture('04-paula-confirmed-reload-history', article.locator('details.gcsp-case-history > summary'));
+    assert.equal(posts('cases'), 1); assert.equal(posts('scheme-team/cases/update'), 2);
+    assert.equal(posts('brief/change-after-decline'), 1); assert.equal(posts('offer-followup/confirm'), 0);
+    mark('Ordinary Paula reload shows confirmed linkage and unchanged current case/history; confirmation does not resolve the case or invent a case event');
+    report.case = { caseId: reloaded.caseId, version: reloaded.version, status: reloaded.status, runId: paula.runId };
+    report.confirmation = { ...change, briefVersion: afterBrief.briefVersion, essentialsPreserved: true };
@@ -222,2 +359,0 @@
-    mark('Ordinary HTTPS navigation and Paula reload preserve the run and actual case; browser cookie paths remain scoped');
-    report.case = { caseId: updated.caseId, version: updated.version, status: updated.status, runId: paula.runId };
```
