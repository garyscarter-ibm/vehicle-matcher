# FUCQ-450 presenter controls: source checkpoint

Observed 16 November 2026. This is an incomplete source checkpoint for
`DEV-2026-11-13-018` on `dev/DEV-2026-11-13-018`, based on claim commit
`79dd4f9883313a13cfcb7d04f60768dfbcdd17b2`. Both original acceptance criteria
remain unchecked. The initial checkpoint was source-only. The first finite
Angular compilation attempt below failed before test execution; browser, live
service and connected acceptance work remain unrun.

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
| `presenter/presenter.client.spec.ts` | P01-P23, 44 expanded controlled cases; authored and statically reviewed, all unrun. |
| `presenter/presenter.component.ts`, `.html`, `.css` | Current readback, step/release, advanced advance/tick, pinned reset confirmation, advertised fault modes, deliberate same-command retry, and read-only inspection entry. Existing kit and semantic tokens. |
| `presenter/presenter.component.spec.ts` | P01-P26, 30 expanded controlled cases, including the actual registered lazy route and guard; authored and statically reviewed, all unrun. |
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
