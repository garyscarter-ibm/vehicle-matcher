# FUCQ-451 notification inspection — 16 November 2026

Original Story: `DEV-2026-11-13-019`, 8 points, branch `dev/DEV-2026-11-13-019`.
The two original acceptance criteria remain open. The 18 November increment adds a connected
local Angular/Java/native PostgreSQL 17 proof, signed test OIDC and current focused test evidence.
Actual email receipt, hosted provider/origin evidence and Safari remain unproved. The owned Story
resumed at `1fce88975`; its native status remains In Progress. The 16 November source-only
evidence and failures below are retained as history, with the current result recorded first.

## Coherent focused run and acceptance decision, 18 November 2026 (Claude story-lead)

The branch was fast-forwarded to `gcsp-poc-dev` `836324f8d` (tree `199570d1…`). Outbox, Java
`notify`/`presenter` and Angular `auth` sources are unchanged since `b2b31ac06`, so the connected
browser proof still applies to them. The base did change offers and allocation, and the run below covers that.

| Evidence (root `.claude/test-runs/fucq451/lead4-20261118T103538Z/`) | Result |
| --- | --- |
| Angular outbox client and component specs | **59/59 PASS** in one run |
| Java `notify.**`, `offers.**` and the ten startup/wiring classes on one throwaway native PostgreSQL 17 | **One green run: 49 classes, 286 tests**, 0 failures, errors or skips; peak sampled RSS 2.87 GB |
| `attempt1-metaspace`, `attempt2-metaspace-1g` | My own JVM metaspace caps were too low: one failed before any test ran, the other hit Metaspace OOM after 60 passes. Kept as environment failures. |

**AC1 is met locally.** `NotificationJourneyHttpTest` uses signed JWKS tokens on native PostgreSQL.
It shows the actual recipient, the captured, retrying and sent states with transport, and no
address. The presenter is refused an employee's offer and the employee email command.
**AC2 stays open.** It requires a newly received real email, and only local substitutes have
passed: the Brevo-stub link, and the captured link through local OIDC. The agreed recipient,
mail configuration, hosted provider and origins, and Safari evidence are all external.
Full suite: deferred to batch.

## Connected delivery resumed, 18 November 2026

Current source already composes `presenter/outbox` with `OutboxComponent`, the presenter guard
and the existing Java `PresenterOutboxResource`/`OutboxView` read. Earlier statements below
about an unmade route edit describe the 16 November source checkpoint, not a current blocker.

Tweety 2 leads the existing `inspection`, `offer-return` and `integration` slices without changing
their original acceptance. Timone 3 owns the new bounded connected proof, and Marvin the Martian 4
independently reviews source and resulting evidence. Runtime selection follows the current
`AGENTS.md` Story test set: outbox feature tests, relevant actual Java notify/offer HTTP and
startup/wiring checks, and rendered desktop/narrow/browser/focus evidence. Full suite: deferred
to batch. The historical finite source-only exclusions below no longer restrict this increment.

Configuration inspection at 04:04 UTC found no MAIL, BREVO, OIDC, GCSP or SMTP environment names
in the launching shell. The Java contract supports captured mail by default and requires explicit
Brevo sender/key/public-base settings for external delivery. No agreed external recipient or
usable hosted OIDC/mail configuration has been established by this observation. It is not a
check of remote secret stores. Local signed test OIDC, capture and browser evidence can progress;
a newly received email and its real provider sign-in/ownership journey remain original open work.
No external email, provisioning or Render database operation is authorized by this observation.

Evidence and owned local supervisors are retained under root `.claude/test-runs/fucq451/`.
OneDrive and CloudStorage access remain prohibited, including cleanup and existence checks.

## Connected local result, 18 November 2026

The new `scripts/gcsp/fucq451-connected-outbox-proof.mjs` exercises the composed presenter route
against the actual Java API and an owned native PostgreSQL 17 database. A labelled local issuer
performs the browser authorization-code/PKCE exchange and issues signed JWTs which Java verifies.
The harness seeds explicitly labelled upstream test records; real allocation and notification
services produce the offers and captured messages. Browser business responses are not mocked.
No mail transport, hosted identity provider or live BMW integration is proved by this composition.

The successful `connected-20261118T041801Z` run used proof SHA256
`baccea6f77ba36ef45c01519d10fbf953a1bc1a2700c8a49b2eb2a8f9cf5d61a` and passed all four scenarios:

- An actual empty current-run outbox before allocation.
- Authorized inspection of the Java recipient projection, capture state and all supported local
  filters; selector-free signed GETs, explicit refresh, native Enter activation and heading focus,
  empty sandbox/no-referrer preview, deployed CSP and reduced-motion checks.
- Anonymous, employee and Greg refusals, without presenter inspection granting employee commands.
- A newly captured offer's exact encoded path returned through sign-in to the owned replacement
  offer; a separate wrong account received refusal. The captured URL's origin was deliberately
  mapped to the owned local HTTPS frontend. This does not prove the actual emailed/hosted topology.

The receipt is strict PASS with no cleanup errors. Retained desktop/narrow/private-context
screenshots show the shared shell, recipient/filter selection, truthful capture labels, sign-in,
refusals and owned offer. The full-page narrow screenshot does not establish email-body appearance:
its nested frame was below the original viewport and appears blank. The supplemental
`connected-20261118T042109Z/evidence/outbox-narrow-preview-viewport.png` scrolls that same frame
into view and visibly renders readable narrow email content. The original full-page image remains
unchanged. This resolves the screenshot visibility uncertainty without a blank-preview product
finding. The final proof SHA256 is
`59457fa674bcad6712f0293b22b0df2015b6a771030817e793bab534f08689b7`; its eight-line delta only
adds the scroll, settled viewport capture and scroll coordinates. The supplemental composition
also passed all four scenarios and 41 checks, with no prior assertion weakened.

The desktop email preview loses the generated email's inline styling under the ordinary Angular
sanitizer. This is separately recorded as Low Bug **FUCQ-524**, related to FUCQ-451. No trust bypass,
shared boundary-checker exception, product repair or extra Story acceptance gate was added.

Current focused validation, retained under root `.claude/test-runs/fucq451/timone3/`:

| Evidence | Actual result |
| --- | --- |
| `web-20261118T040706Z/build.log` | Angular builder: 39 component and 20 client tests, **59/59 PASS**; production AOT build PASS. Native log retained; no separate JSON unit report retained. |
| `java-tests-20261118T040809Z` | Resource-stopped, strict false. Native log summaries retain 19 completed classes / 83 tests, zero failures/errors/skips; XML was not retained. |
| `java-remaining-20261118T041128Z` | Only the remaining 29 classes / 201 tests ran: zero failures/errors/skips, native Maven rc0, strict PASS. |
| `java-composite.json`, `impact-map.json` | 48 unique classes / 284 tests across those two Java runs; no overlap or missing selected class, all ten required startup/wiring classes covered. This is composite focused evidence, never one green full run. |
| `connected-20261118T041801Z` | Four actual browser/API/native-database scenarios PASS; local AC1 evidence passes, AC2 remains partial. |
| `connected-20261118T042109Z` | Supplemental narrow viewport image visibly paints the email body; four scenarios / 41 checks PASS, strict PASS. Final receipt SHA256 `4b547da8e74d0339b1b9054e6b855acc3af578a652b006c8fd39fd5398d34e6a`. |

The selected notify/offer HTTP cases include real signed-token OIDC/JWKS/native-database journeys.
The exact finite Maven class selector, native statuses and per-class results are in the receipts.
Only the proof script and own delivery metadata change in this increment; no shared API contract
changes require a new parity selection. **Full suite: deferred to batch.** No broad-impact source
trigger applies; a green covering batch is still required before acceptance.

Three earlier connected attempts remain preserved. `040748Z` exposed an inherited seed that
omitted employee names while the harness expected Paula; the proof now seeds names explicitly and
compares the authoritative projection. `041043Z` failed the native keyboard/focus assertion; the
correction waits for settled filters and exact row focus, brings only the owned headless target
forward and sends a complete native Enter event. The focus expectation was unchanged and later
passed. `041528Z` was resource-stopped as completed private browser contexts accumulated. Closing
each context after its evidence reduced sampled connected RSS from 3,321,069,568 B to
2,039,070,720 B in `041801Z`, without increasing the grant or weakening assertions.

The interrupted Java run sampled 3,243,917,312 B RSS against a 3,221,225,472 B grant. The remaining
selection used bounded Maven/fork heaps and sampled 2,041,888,768 B RSS, 1,525,242,336 B disk and
3,012,975,104 B inclusive over 361 samples. The successful connected run took 28.598 seconds and
sampled 2,039,070,720 B RSS, 330,235,588 B disk and 2,368,699,428 B inclusive over 42 samples.
The supplemental run took 29.592 seconds and sampled 2,169,012,224 B RSS, 331,362,725 B disk and
2,498,624,517 B inclusive over 43 samples. Continuous peak containment is not proved. The original
aggregate 1,500-second deadline was preserved: total elapsed through the supplemental run was
897.520 seconds. Only disposed API/web artifacts were rebuilt, with no replay of the successful
Angular or completed Java tests; the extra browser composition resolved the new image concern.

At 04:20:09 UTC the lead independently verified 2,866 source hashes and 25,884 borrowed input
identities. Fourteen finalized receipts had no surviving historical PID/start identities or
groups, owned port listeners, exact scratch roots or owned native PostgreSQL IPC IDs; cleanup
errors were empty. Source and borrowed pins matched. The worker's canonical reservation and
owned-link audits also passed. Evidence: root `.claude/test-runs/fucq451/lead3/final-runtime-audit.json`
and `timone3/final-resource-audit.json`. The worker's 04:22:13 UTC final audit covers all 17 run
receipts and reports the same clean resource outcome, including the supplemental run and its
artifact keepers. At 04:24:10 UTC the lead independently rechecked all 17 receipts' exact scratch,
canonical token, historical PID/start/group, owned port and native PostgreSQL IPC absence, plus
the 1,251 supplemental source hashes and final proof SHA; all matched and cleanup was clean.
No foreign resources or OneDrive locations were touched.

Marvin the Martian 4 independently reviewed all six outbox source/spec files, the proof and its
seed/keyboard/context-lifecycle corrections: **PASS — no blocking or major issues found**. Final
image review also passed, including all 15 supplemental evidence hashes/byte counts and the
scrolled narrow viewport. Final metadata review applies to the result in this checkpoint.

## Contract and source scope

Implementation reference: kickoff `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`,
`presenter-outbox-contract.md`, `migration-replacement-contracts-2026-11-13.md`,
`experience-quality.md`, `screens/README.md` and the current Angular kit in `COMPONENTS.md`.
`build-rules.md` and `technical-readiness-2026-11-05.md` govern the bounded pickup.

Actual Java `PresenterOutboxResource` exposes presenter-only
`GET /api/gcsp/v1/presenter/outbox` with `{status:"ok",value:{runId,messages}}` and rejects every
query selector. `OutboxView` supplies at most 500 current-run records, actual recipient employee
identity/name, safe delivery fields, rendered bodies and an offer link. It does not expose
recipient addresses, provider identifiers, private payloads or whole-run history.

The new client consumes that exact read without query/body selectors, uses bearer authentication
with omitted credentials, checks environment/run/session identity and bounds cancellation and
stalled configuration/token/fetch/body reads. It projects only the public fields.

The standalone view provides local state/recipient/message-kind filters, current returned counts,
selection and explicit read refresh. Capture reads “Captured, not sent”; configured acceptance
reads “Accepted by email provider” and does not establish inbox receipt. Unknown transport/state
does not become successful delivery. The iframe uses ordinary Angular-sanitized `srcdoc`, a static
empty sandbox and no-referrer policy. Supplied links follow the existing single-slash-path or
credential-free HTTPS rule. There are no send, retry-delivery, employee or Greg commands.
Session replacement immediately masks old facts, then aborts/reset reads and local selection.

Component plan: **reuse** `ScreenIntroComponent`, `StatusScreenComponent`,
`LabelledFieldComponent`, `ButtonDirective` and existing semantic tokens. This is a new route body,
with no shared primitive or catalogue change. Existing shared shell/auth/offer/Java files remain
outside this source allocation.

The dispatcher replaced the 16 November placeholder in `apps/gcsp-web/src/app/routes.ts` with
this row. It is already present and was reused by the 18 November connected proof:

```ts
{ path: 'presenter/outbox', loadComponent: () => import('./outbox/outbox.component').then((m) => m.OutboxComponent), canActivate: [sessionGuard], data: { title: 'Outbox', roles: ['presenter'] } },
```

That shared route edit was dispatcher-owned; no route change belongs to this increment.

## Historical finite source validation, 16 November 2026

Changed source boundaries are the new `outbox.client.*` and `outbox.component.*` files only.
No authentication implementation or existing offer behavior changes. The selected runtime work is
the Angular unit-test builder with exactly these includes, one worker and no file parallelism:

```text
ng test gcsp-web --watch=false
  --include=src/app/outbox/outbox.client.spec.ts
  --include=src/app/outbox/outbox.component.spec.ts
  --reporters=json --reporters=default --output-file=<owned-output>/test-report.json
  --coverage=false --progress=false
```

The a01 selection ran at `b39d789b90ec1890c2f7b7e8ca20058f682c0bd7`, tree
`1c37f21a200df73d52e56e136a868d124de185cb`: **20/20 client + 38/39 component = 58/59 passed**,
native outer and test exits both 1. Client cases cover the real envelope/endpoint/public projection, role/credential/scope
refusals, malformed data, replacement sessions and finite cancellation/timeouts. Component cases
cover states, filters, delivery truth, recipient context, selection/focus, safe previews/links,
explicit refresh and session/destroy teardown. The actual Angular builder is required; a direct
Vitest invocation is not substituted for its Angular compilation/test harness.

The app boundary checker was not reached in a01; after the a02 affected pass it ran once and
failed on the inherited case-queue em dash described below. No unallocated repair was attempted.
A full suite, successful-proof replay, auth suite, services,
database, browser, installation and downloads are excluded from this finite source validation.
Auth/offer integration remains original acceptance work, rather than being inferred from fixtures.

Proposed allocation remains 768 MiB disk, 1280 MiB RSS, 2 GiB inclusive, 5 GiB emergency reserve,
480 seconds work/600 seconds total, 512 MiB Node heap and one worker. The whole retained local
FUCQ-451 runner/plan/manifest/receipt/log allocation is capped at 2 MiB. The parameterised runner
under root `.claude/test-runs/fucq451/` derives from the tested FUCQ-450 full-selection recipe.
It must pin checkpoint/tree, exact source inputs, finite count and borrowed closure before release;
register a fresh canonical reservation and scratch/output ownership manifests before export;
retain native exit status before parsing; and finally stop/join/audit owned historical PID-start,
group and token identities, verify source/dependency identities, remove only its scratch/output
roots and release its reservation. The dispatcher owns the final independent receipt audit.
Both actual runs used separately frozen plans and dispatcher releases. No OneDrive access occurred.

The a01 receipt is retained under root `.claude/test-runs/fucq451/a01/receipt.json`, SHA256
`adb71e9bf320d2d9e874695936c5d765894dc31af0aa7781c70d49f9f7d6b368`. It records 37.969 seconds
total, 30.881 seconds work, sampled peaks of 430,485,376 B disk, 1,153,728,512 B RSS and
1,584,213,888 B inclusive over 71 samples. Continuous peak containment is not proven. The
dispatcher independently verified the 172 exact input files, historical process identities,
groups, token, reservation and exact scratch/output removal; borrowed inputs remained equal.
Cleanup errors were empty. The receipt, report and native failure remain preserved.

### Refresh failure diagnosis and affected selection

The failed case is “refreshes only on request and retains a matching selection and local filters”
at original spec line 95: the native kind select had `''` instead of `replacement-offer`. Source
inspection shows `load()` keeps the three filter signals while loading destroys the ready view.
On recreation, the select value binding precedes its generated options. The correction binds
each generated option's selected state to its retained filter, following the existing
`account-choices.component.html` pattern. The same existing case now checks all three retained
signals and native values. Only three option bindings and that existing case changed. The
focused a02 regression passed after that correction; the binding-order diagnosis is supported
by the retained source and before/after result.

The a02 finite selection reused the tested FUCQ-450 a04 Angular filtering recipe:

```text
ng test gcsp-web --watch=false
  --include=src/app/outbox/outbox.component.spec.ts
  --filter=refreshes only on request and retains a matching selection and local filters
  --reporters=json --reporters=default --output-file=<owned-output>/test-report.json
  --coverage=false --progress=false
```

Observed result: exactly **one executed pass, zero failures and 38 intentionally filtered cases**
out of 39 component cases; native test exit 0. The prior 20 client and 38 other component passes
are retained evidence for their unchanged reviewed boundaries; they were not rerun. This is
composite scoped evidence for 59 cases, not a new 59-pass run or full-suite stamp.

The tested a02 checkpoint is `3cae265b8babb58883f65cd2f62bc4a25b9f90c1`, tree
`92639c5c5cfc0b33fa48b00d1b20c024329c32fb`. All 172 frozen inputs matched; only the two allocated
HTML/spec input hashes differed from a01. The dispatcher then verified unchanged source and
borrowed inputs, 86 historical process identities, groups, token, reservation and exact owned
scratch/output absence. The receipt has no cleanup errors and is retained at root
`.claude/test-runs/fucq451/a02/receipt.json`, SHA256
`d2cf301cae2b6644bfa10a8e5778c63408a60685ae943087ff53237d274e6328`.

The boundary checker ran once after that pass and returned 1 on
`apps/gcsp-web/src/app/cases/case-queue.component.html`'s on-screen em dash assertion. The parent
verified its bytes match the claim base; SHA256
`5fbde6d6ef71834b457294509b768832796fe1d2db57d315a5bdb087c283e776`. Native outer exit remains 1
and strict whole-run result remains false. Boundary log SHA256:
`8d136c12de0dc291a399abe40c5df047932ac351a51baf4f4479570a86379633`.

a02 used 32.942 seconds total and 26.431 seconds work. Its 81 samples recorded peaks of
430,436,256 B disk, 1,019,215,872 B RSS and 1,449,652,128 B inclusive, within the unchanged grant.
Continuous peak containment is not proven. The retained a02 evidence is 89,565 B and the whole
local FUCQ-451 coordination root is 291,675 B, under its 2 MiB cap. No retry, extra suite, service,
browser, database, installation, download or OneDrive operation was performed.

Static lead inspection covered all six new files, the actual Java projection/auth ports and existing
offer route/read boundary. All six added-file whitespace checks emitted no diagnostics; native
`git diff --no-index --check /dev/null <file>` returned 1 because each file is added. This is source
inspection, not compilation or passing runtime evidence.

## Remaining original acceptance after the local proof

1. Local actual-Java/current-run recipient/status/filter, desktop/narrow shell, isolated private
   contexts, keyboard/focus and relevant CSP evidence now exists above. The supplemental viewport
   resolves the narrow nested-body image uncertainty. Safari/WebKit and any applicable hosted
   evidence remain open. A green
   covering batch is still required; this lead does not accept or close the Story.
2. Generate a **new** test email through the configured transport to the agreed recipient; retain
   actual inbox receipt. Follow its replacement `/gcsp/offers/:offerId` link while signed out,
   complete real test OIDC sign-in and verify the owned offer. Repeat with a wrong account and
   retain the truthful refusal. The actual local code/PKCE/signed-token/ownership path now passes
   for a captured URL, but actual received email and real provider/hosted-origin evidence remain
   unproved. Capture or provider acceptance alone cannot satisfy this criterion.

The missing real OIDC/mail setup limits original acceptance. Stable map slices are `inspection`,
`offer-return` and `integration`; none is marked complete by the local substitute proof. Both
original checkboxes remain unchecked. The dispatcher owns shared merge, Jira lifecycle and
acceptance; no deployment or final-switch action belongs to this lead allocation.

## Authorship and delivery observations

Scrappy Doo 2 reviewed the source and prepared this delivery/runner plan. Wile E. Coyote 2 authored
the client and its 20 cases; Mulan 3 authored the component and its 39 cases. Both
implementers requested/selected `gpt-6.1-sol` / `medium`, no fallback; own desktop titles were
confirmed by the title tool. Their disjoint source work overlapped after fresh capacity/tier checks.
Actual source delivery is recorded separately from runtime/integration acceptance. The app checker
forbids a trust bypass, so the preview uses the ordinary sanitized binding; no checker exception
or shared-file change was introduced. No separately allocated Bug repair was attempted.

Goofy 2 independently reviewed all six outbox files, this delivery note, the Story and FUCQ-451
map entry at the a01 checkpoint/tree above: **PASS — no blocking or major issues found.** The
review was source-only, with no runtime or rendered acceptance claim. They requested/selected
`gpt-6.1-sol` / `high`, no fallback or descendants; own title was confirmed. Cecil Turtle 2 ran
a01 exactly once with requested/selected `gpt-6-luna` / `high`, no fallback; own title confirmed.
Goofy's affected-line follow-up also returned **PASS — no blocking or major issues found** on
the exact two-file correction diff over the a01 checkpoint: per-option selection matches the
observed fault and existing convention; the strengthened case checks signal and native values.
That source review is distinct from the subsequent focused runtime result above. All source,
review and runtime workers have returned; the dispatcher owns publication and route integration.

## Dispatcher integration, 16 November 2026, 22:54 UTC

The dispatcher published final checkpoint `27ce16a406606761356e1ec56f457853382bcf6e` and
merged it into `gcsp-poc-dev` at `93306b887`. All 172 final worker input hashes match the a02
manifest. Only own Story, delivery and F451 map metadata changed after the tested checkpoint.
The dispatcher then replaced the existing presenter/outbox placeholder with a lazy import of
`OutboxComponent`, preserving `sessionGuard`, presenter role and title. Target/export and exact
route diff were inspected; no additional runtime or rendered proof was run.

This is a coherent partial development integration. Both original acceptance criteria remain
open, native Jira stays In Progress and the claim is retained. The composite 59 local passes,
inherited boundary failure and real Java/OIDC/mail/ownership limitations above remain applicable.
