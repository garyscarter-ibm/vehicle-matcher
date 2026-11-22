# GCSP browser suite

The persistent suite starts the compiled Angular app and the real Java API, signs in through the API's built-in
demo OIDC issuer, and drives employee and presenter tabs in one fresh private browser context. Authentication
is independent in each tab's session storage. It uses an owned fresh database on the shared PostgreSQL 17 stack.

Run from the repository root with the pinned toolchain:

```sh
npx -y -p node@24.22.3 -p npm@11.19.1 npm --prefix apps/gcsp-web run test:e2e
```

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
Public editor validation is unchanged. Stock enters the existing tranche-plan provider; public presenter actions
create release/allocation/holds/offers/counts. The test asserts these derived tables are empty before those actions.
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
and the run/environment and slot wall-timestamp differences are recorded. Omitting the reference records this
comparison as unrun; it cannot establish parity acceptance.

Visibility and persisted-pageshow event assertions make actual signed Java reads; their synthetic event fallback
is identified separately from actual tab visibility/BFCache observations. The interval assertion uses elapsed
time with no fake timers. Engineering screenshots do not satisfy human parity acceptance: Gary or Russell must
review the same-state 1280px Node/Angular pair, and a green batch must cover the merge.
