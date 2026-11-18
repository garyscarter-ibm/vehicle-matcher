# FUCQ-450 presenter controls: source checkpoint

Observed 16 November 2026. This is an incomplete source checkpoint for
`DEV-2026-11-13-018` on `dev/DEV-2026-11-13-018`, based on claim commit
`79dd4f9883313a13cfcb7d04f60768dfbcdd17b2`. Both original acceptance criteria
remain unchecked. The initial checkpoint was source-only. The first finite
Angular attempt failed compilation; the second compiled and passed 83/84 cases.
Matching retained evidence now covers all 84 selected cases across a02-a04.
The existing boundary checker fails in an unchanged case-queue template. Browser,
live service and connected acceptance work remain unrun.

## Fixed delivery boundary

The original criteria are (1) clock, tick/release, scenario/reset and fault/retry
controls operate actual backend state with current outcomes, and (2) permitted
inspection is read-only and employee/Greg commands require their own logins.
Original validation still requires isolated-dev controls, direct API permission
refusals, reset isolation and no impersonation. Fixtures cannot establish those
connected outcomes.

The existing Java contracts in `PresenterClockResource` and
`PresenterScenarioResource` supply the independent implementation boundary.
The kickoff visual reference remains
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, with the shared shell/header/sidebar,
palette and `COMPONENTS.md` language preserved. No shared component, shell,
authentication, backend, deployment or database changes are included.

## Source impact and contract mapping

| Allocated source | Intended behaviour and existing boundary |
| --- | --- |
| `presenter/presenter.types.ts` | Typed clock/tick/control, scenario/reset, fault and refused/pending/unknown projections. |
| `presenter/presenter.client.ts` | Presenter bearer transport through the existing `AuthPort`, runtime configuration and `PORTAL_FETCH`. Six GET routes and five POST command kinds; no run/account query selector or principal-switch request. |
| `presenter/presenter.client.spec.ts` | P01-P23, 44 controlled cases, passed in a02; unchanged evidence reused. |
| `presenter/presenter.component.ts`, `.html`, `.css` | Current readback, step/release, advanced advance/tick, pinned reset confirmation, advertised fault modes, deliberate same-command retry, and read-only inspection entry. Existing kit and semantic tokens. |
| `presenter/presenter.component.spec.ts` | P01-P26, 30 controlled cases; 29 passed in a03 and strengthened P20 passed in a04, with matching evidence reused. |
| `routes.ts` | Only the main `presenter` entry loads `PresenterComponent`; the presenter guard and role metadata remain. |

Commands retain immutable submitted inputs and exact serialized bytes; retry is
explicit. A changed auth session prevents the old registered command from being
sent. The view aborts active work and clears private projections on context
changes. The Java `scenario-preparation-incomplete` response may activate a run
before preparation finishes. A deliberate same-account/environment context
refresh can therefore retain the original reset input, including its original
command reference, expected run and versions, and re-prepare only when the user
explicitly retries. Historical `expectedRunId` remains a concurrency pin, not a
run selector. A different account/environment or sign-out drops that recovery.

The backend currently advertises stock fault modes `none`, `unavailable` and
`stale`; ordering is unavailable. The screen displays the supplied availability,
missing stages and handler outcomes. It does not infer a completed journey from
a successful clock command.

The existing outbox destination remains a guarded placeholder. A presenter
comparison inspection route is absent; the screen says inspection is unavailable
and provides no Greg command link. Real outbox/comparison inspection is therefore
remaining original Story work, not verified by this checkpoint.

## Finite validation selection and envelope

Reuse the existing retained finite Angular recipe at
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq443/manual-local-20261116/run-chunk-a-04.py`.
Adapt its constants, frozen source/dependency closure and selection only. Do not
execute it unchanged: its old source, borrowed dependency and output paths are
historical. The parent released one finite runtime allocation after the source
checkpoint. Its observed outcome is recorded below; no further run is implied.

Select exactly these four specs for one finite Angular run:

- `presenter/presenter.client.spec.ts`: 44 new controlled cases.
- `presenter/presenter.component.spec.ts`: 30 new controlled cases, including the
  actual lazy route, login refusal, reset confirmation and explicit retry.
- `auth/route-policy.spec.ts`: five existing checks for the presenter-only rail,
  role separation, guarded published routes and safe return paths.
- `auth/route.guards.spec.ts`: five existing checks for sign-in return, role
  refusal and unavailable context.

Expected authored selection: 84 cases across four specs. This count is not a test
result. Use the recipe's pinned local Node 24.22.3 and Angular CLI 21.2.30,
one worker and copied dependency closure; no install or network. Native command
shape within the owned copy is:

```text
<owned-node> <owned-node_modules>/@angular/cli/bin/ng.js test gcsp-web --watch=false
  --include=src/app/presenter/presenter.client.spec.ts
  --include=src/app/presenter/presenter.component.spec.ts
  --include=src/app/auth/route-policy.spec.ts
  --include=src/app/auth/route.guards.spec.ts
  --reporters=json --reporters=default --output-file=<owned-output>/test-report.json
  --coverage=false --progress=false
```

Capture selected specs and their actual transitive relative/static/dynamic
imports, templates, styles, Angular/Vitest/TypeScript/package configuration and
referenced assets. `routes.ts` dynamically imports the existing registered
components, so include that production import closure without unrelated specs.
Reuse the existing `tools/check-boundaries.mjs` once against captured current
production inputs, configuration and the approved brand asset. This checks the
changed route/view's existing CSP/token/import contract; it is not a full suite
or browser campaign. Record any existing unrelated boundary failure separately.

Released finite envelope: one worker; 768 MiB owned disk; 1280 MiB
aggregate RSS; 2 GiB inclusive disk plus RSS; 5 GiB free reserve; 480 seconds
work and 600 seconds total including teardown; 2 MiB total retained output.
Assign a fresh token at admission, owned scratch under
`/private/tmp/gcsp-f450-<token>`, and a bounded local receipt directory under
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq450/`.
Validate all paths before access, reject symlink escapes, retain source and
dependency identities/hashes, record whole argv, historical process identities,
groups, sampled peaks and native exit/test counts, then run the existing
identity-checked finalizer and independently verify cleanup. Sampled peaks do
not establish continuous containment. Stop at the first grant breach or failed
check; correct the concrete issue before another finite run. Do not replay
successful evidence without a relevant changed input.

No OneDrive reads, writes, existence checks, copies or cleanup are permitted.
No Java, PostgreSQL, browser, test email, deployment or connected service work is
part of this proposed source-validation run.

## First finite attempt: failed compilation

At approximately 22:04 UTC, allocation `a01` attempted the then-authored 81-case
selection across the same four specs, before P26 was added,
against source `7b190aa4d98e15dfa176116225349c2653ba192c`, tree
`9482b2342d894ac9667528ce65f035352dab86cc`, using one worker and a 512 MiB
Node heap. Angular exited 1 before executing tests: nine TS7053 errors in
`presenter.client.ts` lines 163-171. The private preparation method's union input
type retained incompatible members after its object guard, preventing dynamic
field indexing. No test report or passed case count was produced. The boundary
checker was not run after this concrete failure. The existing Stock template
also emitted an unrelated optional-chain warning; it was not changed.

The smallest proposed correction is to accept `unknown` in the private method,
keeping the typed public preparation methods and existing runtime record
validation. No source correction or second runtime run is included in this
observation.

The retained recipe was adapted for this source, selection, 512 MiB heap,
whole-evidence output accounting and pre-export verification of the historical
dependency closure. All 23,008 dependency files matched their pinned metadata
and hashes before export and after execution; the Node identity/hash and
borrowed tree metadata also matched. The 175-file source freeze includes the
resource helper; the actual project closure contains 174 unchanged inputs.
The receipt retains the test's full argv and historical process/group evidence.

Sampled peaks were 439,638,880 bytes disk, 893,861,888 bytes aggregate RSS and
1,333,500,768 bytes inclusive. Work elapsed 33.253 seconds and total elapsed
42.766 seconds. The sampler and finalizer reported no errors. Independent
post-run inspection verified the exact scratch/output roots and canonical token
were absent and found no process matching those roots or the token. Retained
regular files totalled 124,127 bytes at that inspection. These are sampled
resource results, not continuous peak proof or a passing product result.

Local evidence (outside Git):
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq450/a01/receipt.json`
(SHA-256 `9a6b5f6ff69fa103145b949e2bcdfbb9afecdfe9a9de098a8ea9f6f8dc9e14cf`),
`tests.log`, `project-inputs.json` and `independent-cleanup-audit.json`
(SHA-256 `3a0c0c418ddc787c8030623616c9c6410fa25536d1ddd2f5fc439f2904eaaf07`).
The earlier routine replacement assertion occurred before reservation/export;
its exact `setup-a01.json` receipt is preserved. Removing the redundant
replacement allowed this same allocation to reach actual compilation.

After that failed attempt, the parent authorized the exact private-input type
correction and one further finite run. Typed public preparation methods, runtime
record validation and submitted command bytes are unchanged.

Concurrent independent source review also found a blocker in the original
fault/retry criterion: retaining an interrupted tick locked the fault controls,
preventing the injected stock fault from being cleared before retry. The
existing Java fault journey requires clearing the fault before retrying the
interrupted tick; refreshing auth would instead discard that tick identity.
The parent authorized the bounded view correction before the next run.

The view now permits an explicit supported `none` fault command while retaining
an interrupted tick/control command. If that clear has an unknown or retryable
outcome, it retains its own exact retry and blocks the tick retry until resolved.
A successful clear preserves the original tick object and version pin; only a
deliberate retry submits it. P26 covers acknowledged, unknown and unavailable
fault-clear outcomes, adding three cases. The next authorized selection is
therefore 84 authored cases with the same envelope. These source corrections are
applied; compilation and tests at the corrected source remain pending.

## Remaining acceptance evidence

After focused source validation, original Story work still includes operating
the controls against actual Java/API state on isolated dev; real read-only
inspection; direct permission refusals; proof reset cannot affect the running
deployment; and the applicable rendered desktop/narrow, Safari/private,
keyboard/focus and CSP/accessibility evidence. Source inspection and controlled
Angular fixtures establish none of those connected or visual results.

Agents: Cuthbert 2 requested/selected `gpt-6.1-sol/high`; Mr Potato Head 2 and
Pluto 2 each requested/selected `gpt-6.1-sol/medium`, with no fallback. Both
implementers ran concurrently in disjoint allocated files after explicit parent
authorization. Effective model settings were not independently inspectable.

## Second finite attempt: 83/84 passed; bounded refresh correction

Allocation `a02` used source `e9dd2768ff6ffd232348c09c318cb2ead52082ac`,
tree `24fb96c88bb72d7f1f2751f228262b1c96bf1a53`. Compilation passed.
The client passed 44/44; route policy and guards each passed 5/5; component
passed 29/30, including all three P26 fault-clear outcomes. Native exit was 1,
with 83 passed, one failed and zero pending; the boundary checker remained
unrun after that failure. P20 expected a second reset preparation but observed
one. This result does not prove destructive loss of retained reset input.

Independent review found the fixture could observe idle before the scheduled
auth handoff, then attempt Retry while the new read was busy. It also returned
run-1 GET projections after changing auth to run-2. Source inspection confirmed
a brief busy-state gap in `retryAuthentication`, while retained reset input
survived the same-account/environment handoff. The applied bounded mitigation
sets busy synchronously, reconciles the latest session on completion and clears
busy only if its original generation still owns it. P20 now drives explicit
loading-to-ready auth, supplies consistent run-2 projections, holds the new GET
open to assert busy ownership and exact retained input, waits for authoritative
new-run readback, then explicitly retries with unchanged pins and count-two
preparation assertions. The independent reviewer found no blocking/major source
issue in this correction. Runtime resolution remains unverified.

The parent released one finite `a03`: component spec only (30 cases), followed
by the previously unrun existing boundary checker if those pass. Reuse the 54
unchanged client/auth passes from a02; do not rerun their successful evidence.
The same grant, one worker, 512 MiB Node heap, pinned dependencies, whole-output
accounting, deadlines and cleanup apply. No connected or visual proof is added.

The a02 receipt is
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq450/a02/receipt.json`,
SHA-256 `8a0bb76b85b0e10b79b1e7c7d37428adcb80f14cbd2dff6a7209e41a3fb70034`.
The independent cleanup audit at 22:11:48 UTC has SHA-256
`7fa3a2b1c1941a1bddc021256617ca7090ad4d06b2e866b0bd8b816900824ee7`.
Sampled disk/RSS/inclusive peaks were 441,136,768 / 1,332,805,632 /
1,764,963,616 bytes; work/total elapsed were 35.370 / 43.778 seconds.
All 23,008 dependency files, Node and source audits matched; no sampler or
finalizer error was recorded. Exact scratch/output, token/reservation and owned
process/group/listener cleanup passed, independently audited. Retained regular
files totalled 286,976 bytes after that audit. Sampled peaks do not establish
continuous containment. a01/a02 failed evidence is preserved; no OneDrive access.

## Third finite attempt: preservation passed; explicit retry still failed

Allocation `a03` used reviewed source `a0fe1c39cfb27290bdbf0e462de50e1537bcd097`,
tree `c9cbab18b73ad8c4a25c4815386dda7c521cce69`. Compilation and 29/30 component
cases passed, but P20 again observed one reset preparation instead of two.
Every newly added precondition passed: immediate busy, loading-to-ready auth,
busy during deferred GET, retained exact input, authoritative run-2 readbacks,
no read problems and no automatic submission. The busy mitigation is exercised;
it did not resolve the complete P20 failure. The boundary checker stayed unrun.
The earlier fixture diagnosis was insufficient to establish the remaining cause.

Independent source review identified a more precise remaining candidate: the
helper checks signals after its final render. A read continuation can therefore
make the signal predicate pass while the native Retry button is still disabled;
its subsequent native click would be suppressed. The bounded next change is
test-only: require the rendered Retry button to be enabled and all public
guards clear, spy on the actual handler to prove native click dispatch, then
await the existing count-two preparation assertion. Exact retained-input and
no-replay assertions stay intact. No further production correction is made.

The installed pinned Angular builder schema supports `--filter` and its Vitest
executor forwards it to `testNamePattern`. The parent released a single `a04`
using only component P20 (`--filter=P20 retains an incomplete reset`), followed
by the previously unrun boundary checker on pass. Native filtered/pending counts
will be retained and distinguished from executed evidence. Reuse the unchanged
29 component passes from a03 and 54 client/auth passes from a02. The same finite
resource envelope and cleanup obligations apply. This candidate is unverified.

The a03 receipt SHA-256 is
`0ddc291d7463ad40710faa768fb0e134d5919f16abf9436e2a0e918bcdee4d6a`;
independent cleanup at 22:17:50 UTC has SHA-256
`62cc00b76fdb1d41a809411b4fc02069c7144bdd8c89983b69c16391559c2ace`.
Both are under the existing local evidence root's `a03/` directory. Native rc1;
29 passed, one failed, zero pending. Sampled disk/RSS/inclusive peaks were
432,305,600 / 1,304,264,704 / 1,736,570,304 bytes; work/total elapsed were
32.547 / 39.794 seconds. All dependency, Node and source audits matched, with
no sampler or finalizer error. Exact roots/token/reservation and owned live
identity/group/listener checks passed. Retained regular files totalled 430,618
bytes after independent audit. No continuous-peak or connected/visual proof.

## Fourth finite attempt: P20 passed; inherited boundary failure

Final product source: `523a6aba280ddc2aacf3a8bf87c311db8fd0601e`, tree
`b2f10c7500e8c3f697a6df743962273db27323e3`. Allocation a04 ran only P20 using
the supported Angular filter. Native test exit was 0: one passed, zero failed,
29 pending. Those 29 non-selected assertions all have skipped status; they are
intentional exclusions, not new passes. P20 proved the native Retry button was
enabled, the actual handler ran once and reset preparation occurred a second
time with exactly the original input only after explicit retry. Busy, retained
input, new-run readback and no automatic replay assertions also passed. Only
P20 changed after a03; no further product change was required. This focused
outcome supports the rendered-control synchronization diagnosis. Earlier real
failures and diagnosis revisions remain retained.

The matching composite is 84 passed cases: a02 client 44 plus ten auth cases,
a03 unchanged component 29 and a04 P20. There was no successful single 84-case
run. The source freezes show only component/spec changed after a02 and only P20
changed after a03. Unchanged evidence was reused under the explicit finite
allocation. Local composite-evidence.json records all 84 native case positions,
names and report hashes, preserving duplicate parameterized titles; SHA-256
`e5d0ca671a1f4d1057c6ef00d0129b648e22027625a16831979da332e69f4544`.

The unmodified existing boundary checker then exited 1 on
apps/gcsp-web/src/app/cases/case-queue.component.html: on-screen em dash.
The file is byte-identical to claim base 79dd4f9883313a13cfcb7d04f60768dfbcdd17b2,
SHA-256 `5fbde6d6ef71834b457294509b768832796fe1d2db57d315a5bdb087c283e776`;
the em dashes occur on lines 40-43. The checker stops at this inherited failure,
so no full boundary pass or completion of later checks is claimed. The file is
outside this allocation and was not edited. a04 overall strict_result is false
for this actual boundary failure despite the focused test passing.

Local a04/receipt.json SHA-256:
`d94d883b07f7194638b4c26a566bdc4489e596a5a58c3fc3735feee569d95660`.
Source freeze: `bafed27b2b00b253db8dca9dcc08b954964869a05e5763d2a100f5c3356e52a0`.
Runner: `c71419410005bebbae916b7b70df7f06abe3a164b1a90061025beccac656d05e`.
Sampled disk/RSS/inclusive peaks were 437,139,456 / 1,233,403,904 /
1,670,543,360 bytes; work/total elapsed were 30.404 / 37.328 seconds. All 23,008
dependency file hashes/metadata, borrowed tree, Node and source audits matched.
Sampler and finalizer errors were empty. Independent cleanup at 22:22:47 UTC
verified exact scratch/output roots, token/reservation, 94 historical owned
identities, both groups and listeners absent. Audit SHA-256:
`b88cf55d0389be8b197d480320f5d2c2073e767f8aae1e1fd3037c631bc6a654`.
Retained regular evidence was 573,494 bytes then, before the small composite
index. No continuous-peak, browser, Java/PostgreSQL, connected-service or
OneDrive-access claim is made. No further runtime was started.

Both original Story criteria remain open. The smallest coherent remaining source
step is to allocate the existing read-only inspection client/route surface:
outbox remains a guarded placeholder and presenter comparison inspection is
unavailable. That needs exact file allocation beyond the main presenter entry.
Actual isolated-dev controls, direct API permission refusals, reset isolation,
no impersonation and the applicable rendered-experience proof also remain unrun.
This is a partial delivery, not Story completion.

Final input-count clarification: the a04 source freeze retains 175 hashes,
including the three previously selected client/auth specs and the resource
helper. The actual component-only runtime project-inputs.json has 171 records,
not 175. Parent independently audited all 171 hashes as matching; manifest
SHA-256 `798a367988a26f01d1699cc9ef94240d93e94bf34195056fd1f5ab435eadcd60`.
This distinguishes the reuse/freeze record from the actual runtime input set.


## Dispatcher integration, 16 November 2026, 22:54 UTC

Final checkpoint `a6c8c874f0a449c31ead90724dd80ac030a7aa4d` was merged and pushed to
`gcsp-poc-dev` at `2394926ed`. Its presenter lazy route was already in that checkpoint.
The subsequent F451 integration supplies the outbox body; the dispatcher connects its guarded
route. The earlier statement that outbox is a placeholder is superseded by those source changes.
Comparison inspection and actual connected/reset-isolation/rendered acceptance remain open.
No new runtime proof or full Story completion is claimed; native In Progress and claim remain.
