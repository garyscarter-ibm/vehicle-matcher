# FUCQ-446 employee lifecycle screen checkpoint — 14 November 2026

**PARTIAL; HOLD for parent publication/integration.** Worker
`dev/DEV-2026-11-13-014` starts at
`6a75a85b1bdf920380c6d3fb1070a2c7ac74e96a`; the frozen product reference remains
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. Release:
`.claude/fucq446-lifecycle-screen-brief-1700.txt`, SHA256
`f8e57fc3dd44378120dad0d23eeb1a908775eeab3f49cdba220964054d02427d`.
Both original acceptance criteria remain unchecked:

- [ ] Supported approval, document, readiness, appointment and return states/actions reflect the provider and employee authority.
- [ ] Ownership, pending/refused work and current-car relationships remain accurate through reload and supported transitions.

## Implemented increment and authority

The native standalone `OrdersComponent` composes the existing screen intro, status screen,
fact list, labelled field and buttons. It displays the exact selected order/car/image,
approval stages, documents/readiness, handover and return states/history, independent
provider failures and supplied current-car relationship. A missing image has a meaningful
fallback. The body follows the frozen lifecycle composition and current semantic tokens;
the supplied `00-employee-account.webp` shell reference was viewed during implementation.
No rendered final capture was obtained.

`OrdersClient` delegates the complete orders list and selection snapshot to `AccountClient`.
It binds only the existing Java stages/documents/appointments/return-plan reads and document
acknowledgement, appointment request/accept and return request/accept commands. It uses the
existing AuthPort/runtime configuration/fetch contracts, bearer authentication and omitted
cookies. Own employee login is required; presenter authority, including a combined
presenter/employee context, cannot issue these commands. Exact scope/order checks, returned
revisions/versions/slots/choices/proposal IDs, pending/null/refusal/operation evidence,
10-second deadlines, cancellation and late-context rejection are retained.

`OrdersActions` requires explicit review and confirmation against the same settled projection.
It locks an already-sent resource/context/order/version against duplicate sends, including
after refresh, and drops disposed/context-changed results. The screen rereads provider state
after a response; a command response never optimistically completes a physical event.
Sign-in recovery never replays an unfinished command. Current car comes only from the
designated relationship source, never from the return plan's old car. Java no-show rebooking
remains outside this release; observation 3629452 is unresolved.

Only nine source files change under `apps/gcsp-web/src/app/orders/`: `orders.types.ts`,
new client/spec, actions/spec and component TS/HTML/CSS/spec. Existing controller,
projection and read port are unchanged and were included in current selected validation.
The type adjustment permits an explicit null failure value and typed optional return history.
Only the allocated Story/delivery appendices, this record and FUCQ-446 map object accompany
the source. Parent routes, shell/auth/account/shared kit/catalogue/gallery, all backend,
package/build configuration and peer active worktrees remain outside the write allocation.

## Current selected validation

`native-5`, observed **17:22:55–17:23:32 UTC**, returned **rc0: 116 PASS, zero failures,
zero skips, eight files**. Breakdown: client 26, actions 14, component 11, controller 31,
projection 18, account preview 6, route policy 5 and route guards 5. Tests cover meaningful
authority, exact DTO/scope, pending/refusal, abort/timeout/context, review/stale/duplicate,
reload/current-car and independent-provider behavior. The selected test bundle compiled.

The safe local supervisor invoked a private copied Node/Angular CLI using:

```text
ng test gcsp-web --watch=false
 --include=src/app/orders/orders.client.spec.ts
 --include=src/app/orders/orders.actions.spec.ts
 --include=src/app/orders/orders.controller.spec.ts
 --include=src/app/orders/orders.projection.spec.ts
 --include=src/app/orders/orders.component.spec.ts
 --include=src/app/auth/route-policy.spec.ts
 --include=src/app/auth/route.guards.spec.ts
 --include=src/app/account/account.preview.spec.ts
 --reporters=json --reporters=default
 --output-file=<local receipt>/test-report.json --coverage=false --progress=false
```

The consumed invocation was `/usr/bin/python3 -I -B
<root>/.claude/test-runs/fucq446/lifecycle-screen-local/run.py native-5`.
Its `project-inputs.json` pins 136 source/config/reference inputs; every current input
matched at final source review. No product source changed after this successful run.
Read-only source/path/whitespace review also passed. This is selected frontend evidence,
not a full app/production build, full suite, broad boundary script or connected acceptance.

### Actual failed attempts

| Attempt | Outcome | Cause/correction |
| --- | --- | --- |
| native-1, 17:17:36–17:18:12 UTC | rc1; zero tests | Client TS7053 indexing error; selected fixture also copied unrelated OIDC specs without their dependency. Corrected the type and fixture closure. |
| native-2, 17:18:58–17:19:32 UTC | rc1; zero tests | Selected source graph omitted global `src/styles.css`; included it. |
| native-3, 17:20:13–17:20:49 UTC | 103 pass / 11 fail; 114 total | Component fixture assertions preceded settled async reads; assertions now await settled reads. |
| native-4, 17:21:34–17:22:12 UTC | 114 pass / 2 fail; 116 total | Broad absence assertions matched the baseline stage label “Handover booked”; replaced with section-specific actual-state assertions. |
| browser-1, 17:24:34–17:26:37 UTC | incomplete; `RuntimeError('browser timeout')` | Development preview build rc0, then Chrome failed to produce any rendered check/capture within 90 seconds. Precise cause unresolved; no repeat or browser repair campaign. |

Browser preview used actual frontend shell/component/client code with local fixture HTTP/auth
substitution and an owned scratch route entry. The development bundle compiled (build process
4.914 seconds, Angular bundle generation 1.987 seconds). The empty `browser.log` and final
`browser-report.json` retain state `planned`, port 59192, zero checks and zero captures.
No screenshots exist to inspect. This build does not establish the real parent route or
connected Java behavior. Desktop/narrow rendering and browser keyboard/focus checks were
attempted without usable proof; Safari/private browsing, CSP/accessibility and hosted proof
remain unrun. The component Escape unit test does not establish browser keyboard acceptance.

Real Java/OIDC/native PostgreSQL, transaction/restart/concurrency, configured provider/email,
full journey and hosted original-AC acceptance remain unrun. Default unavailable producers
remain unavailable. No acceptance waiver, Done transition or full-build claim is made.
Historical Low FUCQ-499 and Medium FUCQ-501 remain separate/unfixed; no new product Bug is
established by the fixture or browser infrastructure failures.

## Local resources and retained evidence

All runtime scratch used explicit `output_root=/private/tmp` and a local scratch reason,
canonical HostBudget acquisition plus locked readback before allocation, one worker,
2 GiB inclusive disk and aggregate RSS, 480 seconds work / 600 total / 120 cleanup,
and at least 5 GiB reserve. Private regular dependencies and Node were copied from the
expressly authorised read-only worker007 installation. No OneDrive access, import/execution
of historical cloud runners or cloud cleanup check occurred. Historical cloud observations
in earlier appendices retain their original observation times only.

Selected dependency closure: 23,008 files / 241,262,821 bytes; manifest SHA256
`5dc8e9635f79c56dea71255a3db9e8376b949f40f52bf0b448e261718530a271`.
Node SHA256 `ba7073582822078d8c90bca3facacc46690bc5366fab4b815aeef9148cd6e854`.
Each run records unchanged selected borrowed hashes, full borrowed metadata, Node identity/hash
and source inputs. Whole borrowed-tree content immutability is not proven.

| Attempt | Total seconds | Peak disk bytes | Peak aggregate RSS bytes | Owned teardown |
| --- | ---: | ---: | ---: | --- |
| native-1 | 36.208 | 432129216 | 946323456 | group 69607, scratch and locked token absent; cleanup errors [] |
| native-2 | 34.030 | 439359232 | 971702272 | group 70518, scratch and locked token absent; cleanup errors [] |
| native-3 | 36.147 | 440676384 | 1254031360 | group 71896, scratch and locked token absent; cleanup errors [] |
| native-4 | 38.508 | 440668192 | 1397555200 | group 72863, scratch and locked token absent; cleanup errors [] |
| native-5 | 37.734 | 440680480 | 1142161408 | group 74153/ports, scratch and locked token absent; cleanup errors [] |
| browser-1 | 123.072 | 449686744 | 1190739968 | groups 74977/75063 and group ports, scratch and locked token absent; cleanup errors [] |

The first four receipts did not retain separate port readbacks; they do retain no-live-group
readbacks. No worker dependency links were created. Browser receipt's
`other_reservation_tokens_retained=false` records one unrelated token present initially and
absent finally. Its cause is unverified; do not claim all foreign tokens were retained.
The runner calls `HostBudget.release` only for its own token, and the inspected helper
removes that token under lock. No foreign-reservation cleanup was attempted.

Receipts remain locally under root
`.claude/test-runs/fucq446/lifecycle-screen-local/`. `evidence-index.json`, observed
2026-11-14T17:29:05.167461+00:00, pins all 36 retained files including every run's
receipt/ownership/input/log, available test JSON, saved harnesses and browser fixture inputs;
SHA256 `f1f60f3d39cf91f6da629ef614d08325620ac02ebed9b27e76cfe3d6ab768968`.
These ignored runtime files are not published artifacts.

| Evidence relative to that local directory | SHA256 |
| --- | --- |
| native-1/receipt.json | `92b1948c11885a1f9404083e94e988f3fa4830e5575e7572dec7950daa2c75dd` |
| native-2/receipt.json | `33722119e998369f1ad01f8e18568991eed29616b424c84c5dd9a536b0226b06` |
| native-3/receipt.json | `a4d3b93e73a8f8cd71c02eca72c233be09ed94c9cf379aa8e65195957deebeda` |
| native-4/receipt.json | `b27b7b207b8e1471c0fed562b6a96de406f7e2683c85daa378d120967e9c4f2c` |
| native-5/receipt.json | `efc3ba2cf986d80d7ef2c7bc35a4cf7718f240986f3dc2461833fbb499a31c7f` |
| native-5/project-inputs.json | `af589f039d8e6bd797751e023eb362acc1562b217f36c6d79b8c2801f8334d76` |
| native-5/test-report.json | `632341ca09427548f73601fae7fe7c4a17e3da2a8e41525e8ce17c1045a9527d` |
| native-5/tests.log | `f464f7a1b1a6a503152b4d906cf8a0b9fff80180df2a7789ee29458f3263b34e` |
| native-5/ownership/ee942863778c4c7cb4835e5208c04f78.json | `ffd12cbf7ee0e1aa7493ff81e9b8e2a6d69f9755e435e93be15053b565a48caf` |
| browser-1/receipt.json | `20b82f64f638a65e50a38c90d15c9081a8c424e03560c14f426857169c117c0e` |
| browser-1/project-inputs.json | `7a68e4975e22d45ea5e40db7a4c93763ff78652537f6f63381c0d6e01dbdd722` |
| browser-1/browser-report.json | `39d43dbabbeed6acd698375ddfb65c8da089537af5390d11afaf7fbd127c7415` |
| browser-1/ownership/1fad02efd3174ffa8c5a53c74d202383.json | `86237ecdd98fb526bb0a499733dd4cc68691c85ad705ae79220acadffba3d2db` |

## Parent integration recipe and remaining work

Replace only the existing `feature('orders', 'Order progress', ['employee'])` in
parent-owned `apps/gcsp-web/src/app/routes.ts` with:

```ts
{
  path: 'orders',
  loadComponent: () => import('./orders/orders.component').then(m => m.OrdersComponent),
  canActivate: [sessionGuard],
  data: { title: 'Order progress', roles: ['employee'] }
}
```

Preserve other routes/guards/titles. Optional `?orderUuid=...` selects an exact order;
existing `/orders` account/shell links need no change. OrdersClient is root provided and
uses existing shared dependencies. Add a catalogue entry for native `gcsp-orders`, composed
of the existing intro/status/facts/labelled-field/buttons plus supplied stage/task/slot/history
lists. Shared extraction/gallery decisions remain parent-owned. No legacy controller wrapper
or business-command kit is needed.

The five slice IDs/points remain progress-read(3), employee-actions(3), view-parity(3),
review-proof(2), java-integration(2). The first three are in-progress/PARTIAL; the last two
remain not-started. Parent route binding, rendered experience and actual connected original
acceptance are remaining Story work. Retain native observation/assignment/lease and expired
historical worker observation. No native operation occurred.

## Dispatcher learning events to append through the parent

- **2026-11-14 17:18–17:23 UTC, Bertie/GC Codex, fixture diagnosis and correction:**
  native-1/2 establish missing selected-graph prerequisites; native-3/4 establish early and
  overbroad assertions. Source/type/closure and settled/section-specific assertions were
  corrected; native-5 independently records 116 pass. Proposed framework improvement:
  include declared global styles and only selected specs in bounded fixture graphs, and
  await actual settled producer state. This is a verified selected-fixture mitigation,
  not connected or visual resolution; no framework change is requested in this Story.
- **2026-11-14 17:26:37 UTC, Bertie/GC Codex, DL-20261114-GC-006 recurrence:**
  browser-1 preview rc0 but 90-second browser timeout, planned report/zero checks/zero
  captures and no log diagnosis. Owned teardown succeeded; original visual proof remains
  open. Stop after the finite attempt. Proposed framework improvement: establish a supported
  installed browser capability and causal diagnosis before another runtime allocation;
  do not infer render acceptance from compilation. Precise cause remains unresolved.
- **2026-11-14 17:26:37 UTC, Bertie/GC Codex, reservation observation caveat:**
  browser-1 sees one unrelated reservation disappear during its lifetime. Own cleanup
  succeeds; foreign-token continuity is unproven. Inspected release code removes only the
  supplied own token; no foreign mutation is observed. Proposed framework improvement:
  report foreign token presence as a timed observation, distinguishing independent
  completion from evidence of mutation. No cleanup/framework repair is authorised here.
- **2026-11-14 17:31:12 UTC, Bertie/GC Codex, product-map serialization boundary:**
  the official slice CLI normalized the raw formatting of five foreign objects and advanced
  the own row's historical/native observation time. The first precommit boundary check
  correctly failed. Retained the CLI-generated own slice output, restored original native
  fields and spliced only that output into the original own object; final boundary checks
  must confirm all 301 foreign raw objects/order and every outside byte match. Proposed
  framework improvement: support an own-object-preserving slice write and distinguish
  slice evidence time from native tracker observation. No helper/framework file changed.

Agents: same Bertie requested/selected/effective `gpt-6.1-sol/high`, parent verified;
no fallback, setting change or descendants. IBM gateway PASS. Equal collaborator authority,
resumed Jira policy within task scope, false-child-422 diagnostic rule and fixed Story/
defect boundaries apply. This worker makes one bounded local commit with the Codex trailer,
then HOLDs. Parent owns exact-SHA publication/integration. No push/merge/rebase/sync,
Jira/lease/deployment/email/external-service operation or final switch is authorised here.
