# GCSP browser suite

The persistent suite starts the compiled Angular app and the real Java API, signs in through the API's built-in
demo OIDC issuer, and drives employee and presenter tabs in one fresh private browser context. Authentication
is independent in each tab's session storage. It uses an owned fresh database on the shared PostgreSQL 17 stack.

Run from the repository root with the pinned toolchain:

```sh
npx -y -p node@24.22.3 -p npm@11.19.1 npm --prefix apps/gcsp-web run test:e2e
```

The default runs every registered case family, including the retained FUCQ-548 bell cases. Select FUCQ-555 alone
with `npm --prefix apps/gcsp-web run test:e2e -- --case f555`; repeat `--case f548 --case f555` to select both.
Only those allowlisted names are accepted. The heavy-slot re-exec preserves the selection, and the run receipt
lists the selected files. A selected run is scoped evidence; it does not stamp the full browser batch.

Select the bounded FUCQ-551 account family with `npm --prefix apps/gcsp-web run test:e2e -- --case f551`.
One real Main composition checks the held Buddy, current-car styling/image, shared history, drawer focus and
390px keyboard/layout, then actual Pause/Resume, transport-read failure/recovery and acceptance to finished Buddy.
It retains full redacted material readbacks and a full-page 1280 Node/Angular held pair before commands mutate
the brief. Supply the frozen reference below. Account parser states are labelled inferred from uniquely gated
UI states and actual envelopes. Image framing/dimensions remain distinct; the separate hosted asset probe is
availability evidence. The pair awaits human review; this local run does not prove a hosted sign-in journey.

Select FUCQ-561 presenter coverage with `npm --prefix apps/gcsp-web run test:e2e -- --case f561`.
Run once on the final committed source. It checks the Basic console, actual release projection,
suitability, captured mail, restart and the live frozen 1280px comparison. The local composition
uses each engine's public Main reset and Basic release button, comparing semantic inputs, confirmed
brief, clock and stock while retaining the distinct generated run IDs. It does not establish the
actual hosted-dev release cue or human acceptance of the screenshot pair.

## Manual F340 walkthrough

Run `python3 -B apps/gcsp-web/e2e/run.py --case f340 --manual` with the same pinned Node, installed
dependencies/browser and shared-build settings below. This option accepts F340 alone. Without `--manual`,
case selection and automated tests keep their existing behavior.

The supervisor prints **F340 manual session ready**, actual local Presenter/Paula links and an exact
`touch -- <run-owned-stop-file>` command. Wait for that message, then open the links yourself in separate tabs
and sign in as Presenter and Paula. The automation never opens or focuses your browser. Startup checks use
two owned headless tabs for signed OIDC/context reads, then close them; they perform no scenario reset,
preference save or release. Follow `docs/gcsp/suv-walkthrough-2026-11-25.md` for the manual journey.

The local HTTPS certificate is self-signed and lasts two days; a fresh session generates a new certificate.
If your browser shows a certificate warning, review the hostname and use its per-site session exception only
for the printed `gcsp-web.localhost` and `gcsp-api.localhost` origins. Open the printed API certificate-check
link first if needed (a signed-out/401 response is expected), then the Presenter and Paula links. No trust is
installed and no browser security setting is changed by the runner. A browser that refuses a per-site exception
remains a manual-browser setup limitation; do not disable certificate checks globally or install system trust.

This is a held manual interval within the **same ten-minute startup/run chunk**, including build/startup time,
2 GiB scratch and 3.5 GiB night/CI RAM budget. It does not reserve another ten minutes after readiness. Stop by
running the exact printed command in another terminal; its unique marker belongs only to this run, so an old
stop file cannot end a new session. Ctrl+C requests cancellation and runs the existing finalizers. Timeout or
resource exhaustion also ends the interval. The composition closes, the owned database is dropped, owned
processes are joined and scratch absence is recorded; inspect `run-receipt.json` for actual cleanup results.

`f340/manual-session.json` is published atomically with run/source identity, readiness, actual origins/links
and the exact stop file, then updated on stop/failure. `f340/browser-receipt.json` records startup sign-in probes
and the manual stop request; `run-receipt.json` records mode `manual` with no test files. These records establish
startup/teardown evidence, not successful completion of a person's walkthrough or passing automated tests.

## Automated cases and shared setup

Select the bounded FUCQ-552 preferences family with `npm --prefix apps/gcsp-web run test:e2e -- --case f552`.
It reuses this composition and unchanged Main inputs to check category icons, importance/bin/stops, segmented
mode/help, understanding segments, editor chips/range axes/end labels, actual preview decision cards and keyboard
interaction at 1280/390. It captures live Node/Angular account and editor pairs at 1280 against the same actual
brief/account/clock, then saves through the editor and follows Activity and an actual accepted offer to Orders.
Supply the frozen reference below; this family fails an omitted comparison rather than claiming a pair.
Run once on the final committed source. Screenshots await human parity review; full suites remain in the batch.

Use `_tools/test_stack_build.py node link --app <absolute-app-path>` for the lockfile-keyed install first.
The only added development dependency is `playwright-core@1.60.0`; Node's test runner owns the tests. Install
its matching Chromium browser once using the team's normal local browser setup. No browser download happens
inside the suite. `GCSP_E2E_BROWSER_PATH` can select an already-installed compatible browser executable.
`GCSP_E2E_BROWSER=webkit` selects an installed matching WebKit runtime; an absent WebKit run stays an explicit
limitation and is not called Safari evidence.

`PROOF_API_JAR` and `PROOF_WEB_BROWSER` reuse verified prebuilt outputs. If omitted, the shared build cache
builds/reuses them. `GCSP_E2E_NODE` overrides the pinned Node executable. `GCSP_E2E_OUTPUT` selects a local retained
directory outside disposable worktrees; otherwise evidence goes under the main checkout's ignored
`.claude/test-runs/web-e2e/`. Temporary certificates, profiles and assembly live in owned `/private/tmp` scratch.
The supervisor records ownership before allocation, takes the shared heavy slot, caps a single chunk at 2 GiB
scratch/3 GiB RAM/10 minutes, stops and joins owned children, drops the run database and records scratch absence.
OneDrive and the user's foreground browser are never used. Mail uses the captured adapter; no real email is sent.

The FUCQ-548 cases assert the empty bell, header placement, real offer thumbnail/deadline/action, one-off note,
unchanged count on open/navigation, presenter/30-second/lifecycle refresh, keyboard and account disclosure,
375px layout and actual service expiry. Screenshots, a bounded network journal and a cleanup receipt accompany
the assertions. Six-row overflow is also covered by the notification model's focused unit tests; the connected
case checks its real projection stays bounded without fabricating offer history.

The exact frozen Main initial brief/consent and full stock input have retained provenance in `fixtures/`.
The lossless stock fixture contains 500 exact cars across five windows: 24,374,358 raw bytes and 2,305,230 gzip
bytes. Both hashes, byte counts and window/car bounds are asserted before the one expanded copy is written
inside owned scratch. No expanded fixture is retained. Fixture refresh is an explicit operation through
`fixtures/capture-main-input.mjs`, never an automatic test step.

The suite records Java's observed named Main availability (FUCQ-562), and uses an explicitly authorized
initial-input fixture following `BuddyJourneySeed`. A bootstrap run migrates the owned database and is legally
retired. The fresh replay run receives its captured initial clock/account/brief before Java restarts, so replay
remains valid on later dates without moving a clock backwards or disabling database guards. The exact reviewed
policy is `gcsp-policy-v1+offer-journey-v1`; existing Java startup adopts it. Actual signed context, account,
brief/consent and clock responses are compared to captured inputs, mapping only environment/run identifiers.
Before comparison, `initial-readbacks.json` retains the actual `/context`, `/manual/account`, `/brief` and
`/presenter/controls` response bodies, recursively redacting credential-named fields and excluding headers/session storage.
Account `asOf` and `versions.clock` remain mandatory equality checks. The separately authorized FUCQ-564 repair
binds persisted packaged Java account reads to their scoped run clock; `gcsp.account.fixed-now` remains test-only.
The connected suite must execute these strict checks on the final committed build before claiming this boundary green.
Public editor validation is unchanged. Stock enters the existing tranche-plan provider; public presenter actions
create release/allocation/holds/offers/counts. The composition explicitly enables the canonical `recommendation`
candidates provider, which registers allocation and expiry; Buddy holds use the existing local-synthetic default.
The test asserts these derived tables are empty before those actions.
The known initial `GET /brief` predecessor projection difference (`0` versus frozen `null`, FUCQ-563) is retained separately:
the database must still store `NULL`, current brief version/content/consent stay exact, and only this lineage metadata
field is excluded from semantic equality. Recorded source references show allocation/offer/bell derivation does not
use the malformed public field; activity event-history validation reads the correct nullable database value directly.
Java's named release cue differs from the generated Node window; the extra public Advanced clock advance and tick
to the exact captured generated instant are recorded. No successful named-reset claim is made.

For a frozen Node comparison, also supply `GCSP_NODE_REFERENCE` pointing at the preserved
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38` checkout. The supervisor verifies its commit and the replay checks captured
source hashes. If that checkout has no linked dependencies, `GCSP_E2E_PG_MODULE` may point to `pg/lib/index.js` in
an existing reviewed local install; it resolves the unused PostgreSQL import of the memory runtime without editing
the frozen tree. The real Node runtime replays its Main loader, then releases the identical captured stock through
its existing synthetic-provider seam and actual clock/allocation services. The replay run identity is derived
from the frozen initializer/reset command algorithm and asserted against its real result;
Java uses that same fresh run ID because it participates in both engines' car lottery. Actual held UUID, deadline,
car title and thumbnail must match Java before the second 1280px screenshot is retained. Read-only queries also
compare the actual active Buddy hold rows (car, employee, entitlement slot, type, state and normalized deadline),
recording their distinct IDs/versions. Initial input comparisons
and the environment and slot wall-timestamp differences are recorded. Node replays the same meaningful recorded
Next release/Advanced advance/step transitions through its unchanged clock APIs; actual final instant, version
and account clock must also agree. There are no no-op advances or version-padding writes. Raw clock/account
readbacks are retained before equality assertions. Omitting the reference records this
comparison as unrun; it cannot establish parity acceptance.

Visibility and persisted-pageshow event assertions make actual signed Java reads; their synthetic event fallback
is identified separately from actual tab visibility/BFCache observations. The interval assertion uses elapsed
time with no fake timers. Engineering screenshots do not satisfy human parity acceptance: Gary or Russell must
review the same-state 1280px Node/Angular pair, and a green batch must cover the merge.


FUCQ-555 adds five sequential flows with fresh owned schemas: pending offer/details/comparison at 1280/390,
under-five/deadline readback and actual expiry; native Documents/validation/declarations and acceptance to Orders;
native reason selection and saved follow-up to Activity; remote ordering rejection; and remote unknown followed
by reconciliation of the same operation to rejection. The last two use an owned HTTPS ordering substitute through
the real remote adapter, never a browser response stub or inserted selection/offer/hold. Its bounded journal
records identity and idempotency, excluding the transient bearer token. Initial source fixtures are unchanged.
The empty-highlight branch reuses retained component evidence rather than modifying the real Main quote.
Both actual offer pages retain bounded DOM journals for the under-five warning, countdown, decision controls
and expiry announcement. Ordinary active offers project directly to expired at the deadline (frozen
`server/gcsp/offers/access.js:116-117`; Java `OfferView.java:61-63`). The frozen view's pending-at-zero checking
announcement is conditional (`blocks/gcsp/offer/offer-view.js:364-366`): if observed, Angular must match it.
Otherwise that conditional branch reuses the existing offer-screen/store regressions, identified in the receipt.
No intermediate projection is manufactured for this Main offer.

Each flow has a separate scratch/output namespace and receipt; the supervisor's aggregate process journal retains
every flow's child identity. `withNodeReplay` owns the frozen runtime and private browser context through a live
visitor and closes both in `finally`; `captureNodeReplay` retains the existing bell visitor. The frozen checkout
is never installed into or modified. The pending same-offer screenshot pairs remain pending human review.
Saved follow-up readbacks retain their actual timestamps; a clock discrepancy is reported, never normalized.
Five-flow duration and peak allocation must be measured on the final run. The 3 GiB/2 GiB/600-second limits still
apply; a resource stop leaves the exact incomplete cases visible for a separately bounded continuation.

FUCQ-556 selects the synthetic Orders lifecycle and provider-none blocked approval with `--case f556`; the
declined connected case is explicitly skipped because its existing file seam lacks a supported composed-policy
input. It uses actual signed public commands and readbacks for ordering,
grouped document acknowledgement, keyboard handover booking, no-show/rebooking/history and return outcomes.
Only this family enables its existing lifecycle providers. Its case-owned return policy copy changes only the
existing missed-return outcome fields, with source/fixture hashes and deltas in the receipt. The supported return
seam pins its own file policy version; the approvals seam instead requires the accepted order's composed version.
The ordering state has one actual frozen Node/Angular pair at 1280 and 390. Proposed-handover connected proof is
unavailable with the bundled `proposeChange=false` policy and remains an explicit original acceptance gap;
component proof does not close it. Screenshots still need human review and full suites remain in the shared batch.

Select FUCQ-595 with `npm --prefix apps/gcsp-web run test:e2e -- --case f595`. It keeps the original account tab through the actual public release, verifies healthy offer/order envelopes and absence of the two duplicate panels, captures a matching frozen Node/Angular 1280 pair, then aborts an actual preview transport read and proves keyboard recovery from a successful real reread. Desktop and 375px failure/healthy captures support visual review; the new pair still requires a human verdict. No success responses are substituted.
