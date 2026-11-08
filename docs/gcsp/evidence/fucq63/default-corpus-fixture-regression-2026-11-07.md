# F63 default-corpus parity fixture regression — 7 November 2026

Diagnosis: the authored full npm run at integrated launcher `e60c70e6` reported 1,872 tests: 1,848 passed, 19 failed and 5 skipped. Three failures share the changed default-corpus boundary. The alternate provider cards explicitly transcribe `publication-reference.v1`, but their same-process lookup omitted `root`. F62 correctly changed the runtime default to the published `fleet-source.v1`. Returned dataset/originating dataset IDs, corpus version and manifest digest therefore differed from the pinned cards; mixed expected dataset pins yielded `identity-mismatch`. The failing equality and pin assertions are retained red evidence; no new regression framework was needed.

Severity for this repaired fixture regression: Medium (test setup integration regression; runtime default selection remains intentional). The smallest repair supplies the existing published `lookup-reference.v1` registry root to this one test file. That store selects the immutable `publication-reference.v1` candidate. The runtime loader, default fleet data, application consumer, fixture cards and all assertions are unchanged. A first scoped attempt mistakenly selected the candidate directory itself; the real loader correctly returned unavailable (8 failed/4 passed). Correcting the fixture to the published store gave 12/12 passed, with zero skips. Both attempt logs remain in the launcher's retained evidence.

Selected command, authorised by root: `node --test --test-concurrency=1 server/test/gcsp-vehicle-details-contract.test.js`. Final tested file SHA-256 `310fe196a0af7ae14fa2339aa16996b3e676cb39d2e566356def241a6561840a`; explicit old fixture input SHA-256 `5ff33eca90f748c2dab18ed02fd9d2e3571a43adfed9a9146c8e1970f284a8c2`. Existing v2/default publication evidence is reused only for unchanged production paths; root explicitly restricted this allocation to the affected file. No broader rerun, source traffic, runtime/UI change, native SQL or whole-suite green claim.

The supervisor retained code/input hashes, selected command, aggregate V8 coverage and bounded logs under `.claude/f58-63-overnight-20261106/f63-integration/fixture-root-*`, with the shared impact map under `.claude/test-runs/impact/fucq63-active-integration.json`. The successful chunk took 0.248 seconds supervised wall time and removed 536,672 bytes scratch. RSS sampling observed 2,260,992 bytes; this very short process may finish between sampling intervals, so this is an observed sample rather than an exact peak. The first failed attempt removed 508,000 bytes. Finalizers stopped/joined owned groups, released reservations and verified scratch/dependency link absence; no compatibility exception or leftover allocation. The lane was explicitly released to root immediately after cleanup.

The other 16 failures remain unresolved and were not repaired or converted to file-backend Bugs. Their actual product severity is not established by this fixture diagnosis; preserve existing severity/rulings and owning triage. Jira linkage remains pending authentication restoration, rather than inventing keys. Launcher preview discovery remains specifically deferred. Greg's saved-demand `source-invalid` originates in recommendation fact projection, not this vehicle-evidence lookup; buddy handler/policy assertions, UI DOM/focus/style assertions, renewal availability and shell routing likewise have separate observed boundaries. No whole-suite result is inferred from the scoped repair.

Exact retained full-run failure inventory:

| Test location | Failure |
| --- | --- |
| `server/test/gcsp-account-render.test.js:196:1` | account composition preserves complete supplied facts, labelled details and dated vehicle hierarchy |
| `server/test/gcsp-buddy-runtime-integration.test.js:119:1` | normal runtime shares services, registers before startup, and serves real presenter scenario controls |
| `server/test/gcsp-buddy-runtime-integration.test.js:159:1` | fresh composed backend reconciles overdue memory authority before dispatch |
| `server/test/gcsp-buddy-runtime-integration.test.js:187:1` | reviewed publication activates the shared provider while preserving pinned buddy quote and access |
| `server/test/gcsp-buddy-runtime-integration.test.js:200:1` | normal named mechanics reset retains handlers and invalidates old employee and offer authority |
| `server/test/gcsp-greg-dashboard-data.test.js:15:1` | real service: each step of the demo changes the view figures and versions |
| `server/test/gcsp-greg-dashboard-data.test.js:59:1` | real service: canonical threshold shows only "fewer than 5" bands and no other number |
| `server/test/gcsp-greg-dashboard-data.test.js:104:1` | every fixture projection has the shape of a real readDemand value and the view accepts it |
| `server/test/gcsp-greg-dashboard.test.js:179:1` | refused shows no figures, no Retry and hides the reserved regions |
| `server/test/gcsp-greg-dashboard.test.js:377:1` | stylesheets: every selector starts with .gcsp, tokens only, no side stripe, reduced motion honoured |
| `server/test/gcsp-greg-publish-render.test.js:90:1` | an invalid hidden price row is selected and focused from the error summary |
| `server/test/gcsp-greg-publish-render.test.js:98:1` | each invalid price summary link selects its own row while retaining the real native focus target |
| `server/test/gcsp-manual-journey-resume.test.js:150:1` | real account Resume recovers the same quoted claim through default HTTP without another write |
| `server/test/gcsp-renewal-case.test.js:19:34` | alternative car uses current eligibility, points, essentials and availability; unresolved charging stays unknown |
| `server/test/gcsp-shell.test.js:729:1` | harness page loads the harness module and the body stylesheet; the element never reads location |
| `server/test/gcsp-vehicle-details-contract.test.js:45:1` | both providers give the same complete/partial vehicle, provenance and failure interface for all three identities |
| `server/test/gcsp-vehicle-details-contract.test.js:97:1` | trusted expected identity and model/market/date context pins refuse substitutions with either provider |
| `server/test/gcsp-vehicle-details-contract.test.js:226:1` | representative image roles/fidelity survive either mapping without a claimed real asset or fitted build |
| `server/test/launcher-package.test.js:48:1` | a future offer block and its own nested direct page are discovered without assembler edits |
