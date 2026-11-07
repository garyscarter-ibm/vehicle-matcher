# FUCQ-122 help and renewal cases

Execution chat: 01a1adbb-d057-7e13-a9dd-6556deee47dd. Story DEV-2026-11-04-084, branch dev/DEV-2026-11-04-084, initial base a083e28609172a83bbe3d8de31feec48a183f909.

## Component plan

Reuse portalShell, screenIntro, button, statusScreen and factList for employee and Greg case information. Reuse labelledField and errorSummary for native request/update/remedy controls. Reuse dataTable for the dense queue; if native case-open actions require a cell-rendering option, extend the shared table additively with catalogue/gallery coverage. Keep case history as semantic dated lists composed with el. No client policy or feasibility calculations. Styles use current Density tokens; employee body reference docs/gcsp/evidence/fucq-6/README.md revision a7fc178 and shell references docs/gcsp/screens/00-employee-account.webp and 01-replace-vehicle.webp were inspected.

## Readiness and boundaries

Existing RenewalCaseService and case routes support independent help, own-case read, scheme-team list and update. regions.caseQueue supports dashboard attachment. Add a side-effect-free server-owned options projection through the existing remedy validation and recommendation gates. Jira journey order is context rather than a technical pickup gate. No activity or order-progress host exists in this base: their placement and actual lifecycle producer proof remain incomplete until exercised. Leave Russ activity/producer files unchanged. FUCQ-126 owns server/index.js; existing case registration needs no change. Initial Greg composition lane ends after the small harness attachment checkpoint; no continuing ownership of dashboard core.

## Validation selection

Host checkpoint: existing gcsp-greg-dashboard.test.js plus JSDOM attachment/remount check, covering custom-element readiness and reserved region preservation. Server options: gcsp-case-options.test.js plus gcsp-renewal-case.test.js, covering role/run scope, read side effects, policy-driven extensions, exact candidate gates and source failures. Later slices: authored gcsp-case-views.test.js, real HTTP reload/write/confirmation integration and desktop/375px keyboard browser evidence for every authored state. UI kit changes require ui-ratchet and relevant kit/em-dash checks. Full npm test remains required by authored validate and will only run with dispatcher serial-lane grant after scoped/browser/current-base readiness. No native database, live BMW, real mail or deployment authorised.

## Resource plan

Explicit supervised checks use _tools/test_resources.py HostBudget, owned scratch and outside ownership manifests, one worker, 120 seconds, 128 MiB scratch, 768 MiB RSS and 2 MiB logs. Browser chunks use fresh reservations, <=120 seconds, <=128 MiB scratch and <=2560 MiB RSS with recursive browser ownership and exact teardown receipts. OneDrive large-output destination unavailable: no generated local tree >=256 MiB. Shared installed dependencies are adopted read-only with exact path/identity. Every offline child environment removes all database URL aliases and PG variables. Summaries/failure logs retained under the shared .claude/test-runs/fucq122-options tree; final parent receipt required.

## Agents

Lead requested/selected gpt-6.1-sol/high; implementer case_options requested/selected gpt-6.1-sol/medium from fresh tiers spawn. No fallback. Tier output supplied no cartoon name, task_name or naming_session. Effective runtime settings will be recorded when verified.

## Initial Greg host checkpoint

Only blocks/gcsp/greg/harness.js changes dashboard composition. On gcsp:ready it attaches one standard gcsp-case-queue element with embedded attribute into regions.caseQueue; the case element upgrades once registered by the consuming entry. Repeated host mounts replace the region instance. Dashboard core, other reserved regions and fixture behavior remain unchanged.

Validation: JSDOM host attachment/remount check OK; node --test --test-concurrency=1 server/test/gcsp-greg-dashboard.test.js passed 21/21. Receipts: shared .claude/test-runs/fucq122-options/host-0696ef0fd1/summary.json and host-regression-986a768fbf/summary.json. Peak RSS 280,281,088 bytes, peak scratch 0; both scratch roots, owned process groups and reservations absent after finalizers. Existing root node_modules adopted read-only, 27,138,292 allocated bytes, device16777232 inode149213145. No dependency allocation or native database call. This checkpoint releases the Greg composition lane to FUCQ-103. The actual queue registration and UI remain later slices.
