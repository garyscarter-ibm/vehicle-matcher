# FUCQ-451 notification inspection — 16 November 2026

Original Story: `DEV-2026-11-13-019`, 8 points, branch `dev/DEV-2026-11-13-019`.
The two original acceptance criteria remain open. Bounded local evidence is composite: 58 a01
passes plus one corrected refresh-case pass from a02. The app boundary checker failed on an
unchanged case-queue em dash. This does not establish a received email, integrated Java journey
or rendered acceptance, and the Story remains waiting.

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

The dispatcher must replace only the existing placeholder row in `apps/gcsp-web/src/app/routes.ts`:

```ts
{ path: 'presenter/outbox', loadComponent: () => import('./outbox/outbox.component').then((m) => m.OutboxComponent), canActivate: [sessionGuard], data: { title: 'Outbox', roles: ['presenter'] } },
```

That shared route edit belongs to the dispatcher; it has not been made at this checkpoint.

## Finite validation selection

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

## Remaining original acceptance

1. Integrate the allocated body through the presenter route, then exercise authorized inspection
   against actual Java with current-run recipient/status/filter outcomes. Actual rendered desktop,
   narrow, Safari/private browsing, keyboard/focus and applicable CSP/accessibility checks are unrun.
2. Generate a **new** test email through the configured transport to the agreed recipient; retain
   actual inbox receipt. Follow its replacement `/gcsp/offers/:offerId` link while signed out,
   complete real test OIDC sign-in and verify the owned offer. Repeat with a wrong account and
   retain the truthful refusal. Existing `offers/:offerId`, `sessionGuard`, `safeReturnTo` and Java
   `OffersResource`/ownership reads are available source seams, not proof of those outcomes.

The missing real OIDC/mail setup limits that connected proof; it does not prevent the independent
source increment. Stable map slices are `inspection`, `offer-return` and `integration`; none is
complete on source inspection alone. No Jira, merge, deployment or final-switch action belongs
to this lead allocation.

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
