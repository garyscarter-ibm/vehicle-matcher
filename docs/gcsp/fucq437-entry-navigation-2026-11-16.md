# FUCQ-437 entry and navigation delivery

Source work began on 16 November 2026 on `dev/DEV-2026-11-13-005`, claimed at
`5d1b8bcdf`. The implemented visual baseline remains
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`.

## Original contract and current evidence

1. Direct entry, refresh, role landing, sign-in return and new offer links reach the
   intended authorized state. **Open:** source changes and authored tests do not
   prove hosted refresh, real OIDC or actual emailed-link return.
2. Unknown frontend routes and unavailable/invalid API responses produce distinct
   useful outcomes; shared entry links preserve brand/context. **Open:** source
   review identified the wildcard page's auth-state precedence and a launcher
   deployment topology gap. No successful runtime or rendered proof is claimed.

The original validation remains replaying direct URLs, refresh and email return on
the static host, plus unknown/API failures and shared launcher/retail navigation.
Legacy GCSP aliases are unnecessary. Separate FUCQ-513 remains outside this work.

## Bounded implementation plan

| Slice | Author and exact ownership | Boundary |
| --- | --- | --- |
| `route-state` | Sally Carrera 2: `apps/gcsp-web/src/app/routes.ts`, `auth/route-policy.ts` and spec, `auth/route.guards.ts` and spec, `pages/state-page.component.ts` and spec | Existing AuthPort/OIDC roles, safe protected/root return context, explicit route failure presentation; reuse shared status/button components. |
| `static-launcher` | Sally Carrera 3: `scripts/build-gcsp-static.mjs`, only the independent migration static site's routing in `render.gcsp.yaml`, allocated `blocks/demo-launcher/{entry-context,employee-entry,boot,launcher}.js` and five allocated launcher/static server specs | Comparison route/cache parity, truthful Angular handoff, preserve retail context and existing live services. |
| `integration` | Speedy Gonzales 2: review, named-path source checkpoint, this delivery record, own Story and own map object | Original affected-boundary validation, followed by original hosted/OIDC/email/rendered evidence when available. |

No new component, policy, provider, business feature or validation framework is
allocated. Existing product-map associations already include FUCQ-437; its 301
foreign Story objects, their order and outer fields are preserved.

## Source findings and open topology

- Existing Angular routes, guards, AuthPort/OIDC and offer route supply the agreed
  interfaces. Comparison/presenter/outbox behavior is retained.
- The wildcard state page now gives the distinct not-found outcome priority over
  auth state. Safe root query/hash survives sign-in and role landing; thrown
  initialization preserves the return candidate. Retry handles ordinary void and
  signed-out results. Same-root recovery reloads navigation and re-evaluates the
  existing landing guard. Lead source review found no blocker; runtime is UNRUN.
- `/gcsp/comparison` is now in the static fixed route, exact Render rewrite and
  no-store header contracts (source checkpoint `118b0098f`).
- The existing launcher service publishes the shared launcher, whereas
  `gcsp-angular-dev` publishes the separate Angular artifact. A same-origin
  `/gcsp/` link from the former would therefore misrepresent deployed availability.
  No configured frontend origin has yet been verified. The parent dispatcher
  authorized an explicit public frontend URL capability option with useful
  unavailability when absent. This is now applied in the allocated launcher source:
  HTTPS (or loopback HTTP), exact `/gcsp/`, no credentials/query/fragment. Configured
  links send only `brand=bmw`; defensive shared-entry mounting uses `location.replace`
  to avoid a redirecting Back entry. Legacy journey/cookie-adapter imports are gone.
  Lead source review found no blocker; all execution remains UNRUN.
- The dispatcher's 23:58 UTC allocation amendment on 16 November added the actual
  public caller, assembler and its directly matching packaging case under original
  criterion 2. Assembly now accepts `employeeFrontendUrl` / `--employee-frontend`,
  validates the explicit root before creating output and safely templates the
  actual caller. The manifest retains the enabled flag and records the canonical
  frontend root and actual availability separately. Missing configuration keeps
  entry unavailable; invalid supplied configuration fails usefully. The changed
  packaging case retains API and retail assertions, uses one output at a time and
  exercises literal URL templating. No deployment hostname or configuration was
  invented. Actual URL/topology configuration and hosted proof remain open.
- A broad `/gcsp/*` rewrite would mask missing scripts/media with HTML. Existing
  source does not establish an exclusion/regex mechanism. Unknown direct routes
  and dynamic offer refresh remain original work until a supported host contract
  and its evidence exist.

## Validation and resources

The original source checkpoints permitted source inspection and authored tests
only. The dispatcher subsequently released the single finite a01 attempt below.
No successful test, build or integrated acceptance is claimed. Lint, production
build, installation, browser, service, database and network proof remain **UNRUN**.
No OneDrive location was accessed.

After source review, the lead sends an exact frozen selection and pins to the
dispatcher. Reuse matching existing OIDC/context/offer evidence; select changed
route/state and launcher/static regressions. Do not rerun full comparison, Java,
provider or retail suites without changed-boundary justification. Original real
OIDC, actual email, hosted refresh and rendered/browser evidence remain separate.

The Angular source slice authors 31 expanded cases: six route-policy, nine guard
and sixteen state-presentation cases. The refresh test mounts the actual shell;
lazy account/comparison checks use constructor identity. Proposed selection:

```sh
npm test -- --include=src/app/auth/route-policy.spec.ts --include=src/app/auth/route.guards.spec.ts --include=src/app/pages/state-page.component.spec.ts
```

Run from `apps/gcsp-web` only under a later explicit resource release. This command
has not executed. Unchanged ContextClient source already maps malformed/network
API outcomes to unavailable; source inspection is not credited as a passing test.

The launcher selection is all 52 declared cases in the four affected boundary
files (15 context, nine employee-entry, 18 navigation and ten render), sequential:

```sh
node --test --test-concurrency=1 server/test/launcher-context.test.js server/test/launcher-employee-entry.test.js server/test/launcher-navigation.test.js server/test/launcher-render.test.js
node --test --test-name-pattern='artifact: dev blueprint has independent builds, exact fixed routes and disjoint cache policies' server/test/gcsp-static-angular.test.js
```

The latter selects one existing blueprint case; fourteen other declared cases
are excluded. The caller/assembler amendment adds exactly its changed packaging
case, excluding the other twelve cases:

```sh
node --test --test-concurrency=1 --test-name-pattern='^employee frontend configuration reaches the public caller while retail and availability stay bounded$' server/test/launcher-package.test.js
```

This is a proposed, unrun selection. It assembles actual public inputs sequentially
and removes each output before the next variant; no full source copy is selected.
For the shared `safeReturnTo` consumer, the proposed bounded auth selection is six
existing OIDC sign-in/callback/retry/expiry cases and two existing ContextClient
typed/malformed-response cases. Reuse matching retained evidence where exact
source/input/environment pins support it; otherwise run only those eight cases,
with the precise names and native exclusions recorded in the released plan.

The proposed first release is therefore 31 Angular route cases, 52 launcher cases,
one static contract case, one changed packaging case, plus up to eight bounded
existing auth cases if matching evidence cannot be reused. These are finite
targets, not executed pass counts.
Use the existing parent supervisor and canonical reservation, with one worker;
no new runner framework is introduced. Runtime roots and immutable source pins
must be frozen by the dispatcher before any command starts.

Any later released finite run retains the parent-owned resource envelope: 768 MiB
disk, 1,280 MiB aggregate RSS, 2,048 MiB inclusive allocation, one worker, 384 MiB
Node heap, 480 seconds work/600 seconds total, 5 GiB reserve and 2 MiB whole local
retained output, with exact local ownership/reservation/finalizer and cleanup proof.
No runtime release is implied by recording this envelope.

## Attempt a01 — 17 November 2026

Yakko 2 invoked the exact released supervisor at 00:08:55.825 UTC against source
`eca975684505190566582d471275159e10132d30`, tree
`2f05953bc9857d7081a0a9077c537538b6f7b545`. The first native Angular command
returned 1 during compilation, before assertions. **Zero of the 93 selected
cases ran**; the 48 intentionally filtered declarations are exclusions. The
launcher, selected static contract, auth regression and packaging chunks remain
unrun. The missing JSON report produced a secondary wrapper `FileNotFoundError`;
the native exit and compiler log were retained first. No retry occurred.

The compiler identified an introduced nullable-fragment mismatch in
`route.guards.ts`. Sally Carrera 2 applied the minimal `entry.fragment ?? undefined`
correction, preserving supplied fragments and query parameters. This correction
is source only until separately reviewed and validated. The other blocking
diagnostic was missing `oidc-client-ts` types, with consequential `expired` and
`profile` errors. The reused F443 manifest omitted that package and its
`jwt-decode` dependency even though exact lock-matching versions exist in the
same known local dependency root. A pinned closure amendment is being prepared;
no installation, symlink or unrelated warning repair is included.

The attempt finished at 00:09:35.577 UTC. Setup/work/total elapsed were
22.912/30.137/39.359 seconds. Sampled disk/RSS/inclusive peaks were
534,545,344/838,418,432/1,370,194,880 bytes, within the released limits; no
continuous/kernel containment claim is made. The receipt records no sampler or
cleanup errors, unchanged source and borrowed identities/hashes, absent owned
processes/groups/listeners, and removed owned scratch/output/reservation.

Lead read-only audit at 00:10:40.577 UTC independently matched all 1,466 source
pins and identities, all 23,008 borrowed file hashes and identities, and Node
identity/hash. The worktree remained clean; the exact roots and reservation were
absent and no recorded process identity or owned group remained. Whole local
retention was 1,073,152 allocated bytes before the audit file, below 2 MiB.
Local evidence is under `.claude/test-runs/fucq437/receipts/a01/` in the shared
checkout; the immutable receipt, native log and `lead-final-audit.json` retain the
actual failure. Both original acceptance criteria remain unchecked.

## Attribution and delivery learning

Speedy Gonzales 2 leads and reviews; Sally Carrera 2 authors Angular route/state
source; Sally Carrera 3 authors static/launcher source. Both implementers requested
and selected `gpt-6.1-sol` / `medium`, without fallback. Their own title tools
confirmed their names and both reported actual overlapping source starts. No
validator or executed-test credit is assigned in this source-only phase.

Hubie 2 independently reviewed `5d1b8bcdf..e8ebb7e70` and returned **PASS — no
blocking or major issues found**, source only. Requested/selected
`gpt-6.1-sol` / `high`, no fallback. The caller/assembler amendment requires its
own narrow independent source review before the final runtime freeze.

The same Hubie 2 subsequently returned the same PASS verdict for the six-path
caller/assembler amendment `e8ebb7e70..eca975684`, source only. Managed runner
Yakko 2 requested and selected `gpt-6-luna` / `high`, no fallback; title and gateway
were confirmed before a01. They earn invocation/resource/finalizer evidence,
with no assertion-pass or acceptance credit for the failed compile.

For dispatcher log issue `DL-20261116-GCC-003`, retain the demonstrated difference
between a source-level entry link and a usable deployed handoff. The existing
two-host topology was discovered before publishing a false same-origin link;
source mitigation and hosted verification are distinct remaining outcomes.
