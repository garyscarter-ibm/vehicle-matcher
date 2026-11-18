# FUCQ-437 entry and navigation delivery

Source work began on 16 November 2026 on `dev/DEV-2026-11-13-005`, claimed at
`5d1b8bcdf`. The implemented visual baseline remains
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`.

## Original contract and current evidence

1. Direct entry, refresh, role landing, sign-in return and new offer links reach the
   intended authorized state. **Open:** 31 native route/state and eight auth/context
   regression passes cover the selected local scenarios; hosted refresh, real OIDC
   and actual emailed-link return remain unproven.
2. Unknown frontend routes and unavailable/invalid API responses produce distinct
   useful outcomes; shared entry links preserve brand/context. **Open:** source
   and native checks cover route-state precedence and configured launcher handoff.
   Actual frontend configuration, supported dynamic/unknown host routing and
   rendered proof remain open. The selected static contract fails on inherited
   Bug FUCQ-514; no overall passing validation is claimed.

The original validation remains replaying direct URLs, refresh and email return on
the static host, plus unknown/API failures and shared launcher/retail navigation.
Legacy GCSP aliases are unnecessary. Separate Bugs FUCQ-513 and FUCQ-514 remain
outside this work; neither expands the Story's acceptance or allocated repair scope.

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
  existing landing guard. Independent source review found no blocker; the selected
  31 route/state cases passed natively in a02, subject to its name-matching caveat
  below. This is local scenario evidence, not hosted or rendered acceptance.
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
  Independent source review found no blocker; all 52 selected launcher cases
  passed natively in a03. Deployed configuration remains unverified.
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

The finite selection ran against product source
`2912d73b5c045b1ca8e54faed268ed497d6c80bf`, tree
`0a887cd000d4d75548bd375f645d5d2cdca796dd`, after the minimal guard correction.
Across the original 93 selected cases there are **92 native passes and one
inherited native failure**. There is no overall passing run or Story acceptance.
The remaining declarations are 48 intentional source exclusions, never passes.

| Chunk | Native evidence | Result and limitation |
| --- | --- | --- |
| A: route/state | a02: six policy, nine guard, sixteen state cases | 31 passed, native exit 0. The wrapper stopped because five parameterized names contain quoted state values; a02 outer exit 1/`strict_result=false` is preserved. |
| B: shared launcher | a03: four affected launcher files | 52 passed with exact selection, native exit 0; no replay in a04. |
| C: static contract | a03: one blueprint case | One failed, native exit 1, on inherited Java comparison-input rebuild-filter omission FUCQ-514. Fourteen declarations were filtered. The later frontend assertions were not reached. |
| D: auth/context regressions | a04: six existing OIDC return/recovery cases and two ContextClient typed/malformed cases | Eight passed with exact selection, native exit 0; 22 declarations were natively skipped by the filter. No real provider/API proof is implied. |
| E: actual public caller/package | a04: the changed frontend-configuration assembly case | One passed with exact selection, native exit 0; twelve declarations were omitted by the native filter. Sequential actual assembly retained API/retail checks and removed each output. |

A01's compile failure, a02's name mismatch and a03's inherited failure remain
immutable. Each continuation was separately frozen, audited and released once;
there was no automatic retry or replay of matching passes. A04 alone has outer
exit 0 and `strict_result=true` for its nine selected cases. The exact commands,
full names, filters, native reports and exclusions are retained under the shared
checkout's ignored `.claude/test-runs/fucq437/{plan,receipts}/` directories.

The supervisor reused the existing lifecycle with one worker and a canonical
host reservation. Every attempt used 768 MiB disk, 1,280 MiB aggregate RSS,
2,048 MiB inclusive allocation, 384 MiB Node heap, 60 seconds setup, 480 seconds
work, 600 seconds total, 5 GiB free reserve and 2 MiB whole local retained output.
Owned temporary roots were `/private/tmp/gcsp-f437-<token>` and the matching
`/private/tmp/gcsp-f437-output-<token>`; ownership manifests remained outside them.
No OneDrive location was accessed. No new validation framework was introduced.

Lint, production build, installation, browser/rendering, actual hosted refresh,
real OIDC, actual email delivery/return, Java/service/database and network proof
remain **UNRUN**. Full comparison/provider/retail suites were not selected.
Dynamic-offer and unknown-direct-route hosting still need a supported contract;
no broad fallback that masks missing assets was added.

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
correction, preserving supplied fragments and query parameters. Its later
independent review and native proof are recorded below. The other blocking
diagnostic was missing `oidc-client-ts` types, with consequential `expired` and
`profile` errors. The reused F443 manifest omitted that package and its
`jwt-decode` dependency even though exact lock-matching versions exist in the
same known local dependency root. The later amendment pins those 22 existing
files in a small delta and merges the immutable manifest in memory; no
installation, symlink or unrelated warning repair was included.

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

## Continuations a02–a04 — 17 November 2026

A02 began at 00:18:52.396 UTC and finished at 00:19:32.424 UTC. All 31 native
Angular assertions passed; five `it.each` full names quote `loading`, `signed-out`,
`unavailable`, `denied` and `ready`, whereas the frozen plan omitted those quotes.
Only those five mappings reconcile the exact 31 identities. The supervisor
stopped before B–E and retained outer exit 1/`strict_result=false`; no assertion
failed. Setup/work/total were 23.641/31.927/39.572 seconds; sampled
disk/RSS/inclusive peaks were 538,952,672/1,263,960,064/1,793,507,520 bytes.
Lead audit at 00:20:11.844 UTC matched 1,466 source and 23,030 dependency hashes
and identities, the borrowed tree and Node, clean tested HEAD/tree, and absent
owned processes/groups/token, scratch/output and reservation. No errors remained.

A03 began at 00:22:42.610 UTC and finished at 00:23:19.026 UTC. B passed all 52
launcher cases; the selected C static-contract case failed because
`server/data/gcsp/comparison/process-only.json` is copied by the Java Dockerfile
but absent from that service's Render build filter. D/E remained unrun in this
attempt. Setup/work/total were 22.223/27.540/35.969 seconds; sampled peaks were
529,698,912/492,355,584/1,022,029,920 bytes. Lead audit at 00:23:57.320 UTC again
matched all 1,466 source and 23,030 dependency files, tree and Node and verified
clean tested HEAD/tree and removal of owned processes/groups/token/roots/grant.

Source comparison against the initial claim proves the failing Dockerfile,
Java service section and assertion block are unchanged by FUCQ-437. Commit
`4d84b70fe4b286589df907908117e7e2d5640e4c` introduced the comparison COPY under
FUCQ-480. The dispatcher separately captured Medium Bug **FUCQ-514**, related to
FUCQ-480; it is unclaimed and unrepaired here. The observed risk is an artifact-only
change failing to trigger a Java rebuild; no deployed outage was exercised.
The diagnosis and exact baseline hashes are retained with a03. The Story's
frontend route/cache assertions occur later in C and remain unexecuted.

A04 began at 00:27:12.391 UTC and finished at 00:27:56.003 UTC. Only the remaining
eight auth/context cases and one changed caller/package case ran, all passed
with exact selection, and the supervisor returned 0/`strict_result=true` for
those nine. A/B/C were not replayed. Setup/work/total were
23.854/35.578/43.205 seconds; sampled peaks were
634,566,624/1,204,387,840/1,743,620,096 bytes. Lead audit at 00:28:24.319 UTC
matched all 1,466 source and 23,030 dependency hashes and identities, borrowed
tree and Node. It found no remaining recorded process identity, owned group,
token process, temporary root or reservation and confirmed the tested worktree
was clean. Whole local retention after that audit was 1,544,192 allocated bytes,
below 2 MiB. All attempts passed their sampled resource/deadline limits and had
no sampler or cleanup errors; sampled peaks do not claim kernel containment.

These audits precede the documentation/map checkpoint. That checkpoint changes
no product or test bytes; the runtime evidence remains tied to tested HEAD/tree
and the frozen input hashes. Both original acceptance criteria remain unchecked.
Actual frontend configuration, safe hosted dynamic/unknown routes and the original
hosted/OIDC/email/rendered evidence remain work for the Story.

## Attribution and delivery learning

Speedy Gonzales 2 leads and reviews; Sally Carrera 2 authors Angular route/state
source; Sally Carrera 3 authors static/launcher source. Both implementers requested
and selected `gpt-6.1-sol` / `medium`, without fallback. Their own title tools
confirmed their names and both reported actual overlapping source starts. Their
authoring phase was source only; native validation was subsequently assigned
to the separately managed runner.

Hubie 2 independently reviewed `5d1b8bcdf..e8ebb7e70` and returned **PASS — no
blocking or major issues found**, source only. Requested/selected
`gpt-6.1-sol` / `high`, no fallback. The caller/assembler amendment subsequently
received its own narrow independent source review.

The same Hubie 2 subsequently returned the same PASS verdict for the six-path
caller/assembler amendment `e8ebb7e70..eca975684`, source only. Managed runner
Yakko 2 requested and selected `gpt-6-luna` / `high`, no fallback; title and gateway
were confirmed before the attempts. The same runner performed all four separately
released attempts and returned; no descendants or fallback were used. Hubie 2 also
passed the guard correction `eca975684..2912d73b5`, source only. Native outcomes
and the compile, name-matching and inherited failures retain their separate
evidence and original acceptance limits.

For dispatcher log issue `DL-20261116-GCC-003`, retain the demonstrated difference
between a source-level entry link and a usable deployed handoff. The existing
two-host topology was discovered before publishing a false same-origin link;
source mitigation and hosted verification are distinct remaining outcomes.

For `DL-20261114-GC-002`, retain the actual invocation, bounded native results and
independent teardown audits rather than crediting a written resource plan.
The omitted OIDC closure was amended with exact existing lock-matching packages;
the later native compile/test success verifies that mitigation. The five-name
formatter mismatch stopped correctly but interrupted delivery; future frozen
plans should use native formatter parity for parameterized identities. FUCQ-514
is a separate observed inherited defect, not a resolved Story gate or authority
to expand this repair. Shared dispatcher-log publication remains with the parent.
