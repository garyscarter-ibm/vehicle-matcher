# FUCQ-437 entry and navigation delivery

Source work began on 16 November 2026 on `dev/DEV-2026-11-13-005`, claimed at
`5d1b8bcdf`. The implemented visual baseline remains
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`.

## Original contract and current evidence

1. Direct entry, refresh, role landing, sign-in return and new offer links reach the
   intended authorized state. **Open:** the 18 November local composition passes
   direct/refresh, role and newly generated offer-link return/ownership scenarios;
   deployed host, registered provider and actual delivered-email return remain unproven.
2. Unknown frontend routes and unavailable/invalid API responses produce distinct
   useful outcomes; shared entry links preserve brand/context. **Open:** named offer
   routing, packaged launcher context, malformed/unavailable API recovery and native
   unknown-route handling pass locally. The 18 November recovery increment also passes
   useful branded unknown-entry recovery at desktop/narrow sizes, refresh and keyboard
   return with context preserved. Deployed Render behavior remains unproved. The
   unchanged Java build-filter Bug FUCQ-514 is
   separate; final local evidence and earlier failed attempts are detailed below.

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
- Initial source finding: a broad `/gcsp/*` rewrite alone would mask missing
  scripts/media with HTML. The later connected checkpoint supplied named offer
  routing; the 18 November recovery increment below adds ordered resource
  exclusions before the unknown-page fallback. Hosted matching remains unverified.

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

## Connected delivery checkpoint — 18 November 2026

Published source `52729e593caf25b0c511e357ceb1cb2b20ec1bf3`; connected proof source
SHA256 `6ed3060651292c393356c06de6f586aa82512bb689b5c001e1ba2689901fdc2e`. The static builder exports the named
`/gcsp/offers/:offerId` route. The independent Angular Render service rewrites
that route to its index and marks offer paths `no-store`; unknown paths and
missing root/media/assets resources keep native 404s. There is no general SPA
wildcard. Render's documented placeholder matching was checked; a segment
that looks like `missing.js` is still a syntactically valid offer ID. Existing
Java blueprint assertions and earlier Render service sections remain unchanged.

The changed static contract passed **1/1** (55,558,144 B child RSS, child exited,
empty scratch removed). Existing 31 route/state, eight auth/context, 52 launcher
and one caller/package passes remain separately qualified above. FUCQ-514's
unchanged Java build-filter assertion was not rerun or removed. No Java or
Angular application source changed in this increment. API packaging and Angular
production builds passed and were hash-bound to equivalent artifact inputs.
Full suite: deferred to batch; no new full-suite or Java-test replay.

Final local composition passed **68 checks / six scenarios**, with **13 PNGs**:
actual static Angular, Java API, owned native PostgreSQL 17 and signed local
OIDC authorization-code/PKCE login. It covers protected direct entry/refresh
with query/hash, three authorized role destinations, a newly generated offer
link with owner sign-in and another employee's real 403, actual assembled shared
launcher/retail context, native unknown-route/missing-asset 404, malformed GET
response, genuinely stopped API, restart and keyboard retry. Fault injection
is explicitly limited to malformed GET content; the CORS preflight reaches Java.
The host is a documented-contract emulator, and the generated link is mapped to
an owned local origin. Neither is a deployed Render or delivered-email proof.

Parent independently verified all 1,528 exported source files and final evidence
bytes/hashes, reviewed desktop captures and the byte-identical narrow captures,
and audited all 12 build/connected receipts: **3916 unique PID/start identities
absent, 20 ports closed, owned groups/scratch/reservations/native IPC absent**.
Final connected sampled RSS/disk/inclusive peaks were
2,334,408,704/432,319,587/2,766,265,219 B. The final
connected receipt is strict PASS; resource measurements are sampled. All
attempts retained the original 04:37:58–05:02:58 UTC pipeline deadline.

Three earlier connected failures remain recorded: independent per-read `asOf`
timestamps compared for equality; Document rather than body text on launcher
and native error documents; malformed-response injection including OPTIONS.
Only proof helpers changed for those recoveries; all failed receipts remain
strict false. Parent observed cumulative retained output at 38,876,956 B against
the 32 MiB plan, then losslessly compressed verbose immutable metadata with
verified original hashes. Final retained output is below the cap; this does
not erase the observed aggregate retention breach.

Pumbaa 3 requested/selected Sol/high; Shaggy 3 and Emmet 2 Sol/medium, no fallback.
They delivered useful parallel static/proof work. Repeated child IBM422 errors
interrupted lead/reviewer calls while the parent launcher worked. Parent carried
source review, three proof-helper corrections, runtime supervision and evidence
review forward without changing gateway/models or duplicating workers. Sylvester
2 returned no useful independent review before its422; none is claimed.

**Both original acceptance boxes remain open.** Native unknown-route output is
a bare404 without established useful branded recovery. Hosted Render topology,
registered provider, actual email delivery/return, Safari and a green covering
batch remain unproved. Greg's authorized route currently shows its existing
unavailable placeholder; route authorization is not Greg capability completion.
The account capture truthfully retains its existing partial offer/order read
warning. No new repair scope, Story hold or acceptance gate was introduced.
FUCQ-513/FUCQ-514 remain separate. No deployment or OneDrive access occurred.


## Branded unknown-entry recovery increment — 18 November 2026

This increment closes the local bare-404 presentation gap within the original
second acceptance item. It reuses Angular's existing wildcard StatePage,
StatusScreen, ButtonDirective and portal shell; no component, style, alias or
business contract is added. The recovery action now preserves the query and
fragment when the existing landing guard selects the authorized role home or
sign-in return.

The separate `gcsp-angular-dev` service retains its fixed and offer rewrites,
then reserves `assets/`, `media/`, `api/` and filename-shaped paths before a final
`/gcsp/*` rewrite to the compiled index. The missing-resource destination is
outside `/gcsp/` and the assembler's output, so it cannot enter the fallback.
Existing packaged resources retain their content and cache metadata; the separate
`/api/gcsp/v1` URL space receives no frontend rewrite. A named offer ID keeps its
existing unrestricted segment contract, including an asset-looking ID.

Provider basis: Render's [redirect/rewrite documentation](https://render.com/docs/redirects-rewrites),
observed 18 November 2026, says existing resources bypass rules, rules are matched
in order and only the first matching rule is applied, wildcards match arbitrary
strings, and placeholders match whole URL segments. The `*.*` filename exclusion
uses that documented wildcard rule; the documentation does not provide an exact
suffix-wildcard example. This remains a provider uncertainty until actual hosted
replay. No unsupported custom-404 artifact behavior is assumed. Existing cache
headers remain unchanged because precedence for overlapping header rules was
not established. Local routing proof does not establish deployed Render routing
or unknown-path caching.

Validation scope is the changed static-blueprint case, the existing Angular
state-page spec with its new context regression, production compilation needed
for actual rendered desktop/narrow refresh and keyboard recovery, and native
resource/API 404 responses under a local model of the documented static rules.
No Java, PostgreSQL or previously passing 68-check composition replay is needed
for this frontend/configuration boundary. Full suite: deferred to batch. Hosted,
registered-provider, delivered-email, Safari/private-browser and covering-green
acceptance gaps remain explicit; both original checkboxes remain open.

The first owned validation supervisor failed before any selected command ran:
an absent-parent `None == None` comparison contaminated its process collection,
and its cleanup raised `PermissionError` while attempting a signal. The target
PID/start and any preceding successful signal attempts were not retained and
remain unverified; no zero-impact claim is made. The contaminated collection was
never reused for corrective signals. Exact own-manifest recovery verified a dead
supervisor, zero registered child groups, matching scratch device/inode and no
open files, removed 8,727,328 bytes, and removed only its exact reservation token.
Original source, initial receipt and traceback remain retained in the local
`sniffles2/attempt01-*` evidence. Independent review requires positive parent
membership, direct-child registration, baseline identity exclusion, a persisted
per-signal identity journal, cancellation on sampler errors and fail-closed
teardown before any reattempt. This is a supervisor failure, not a product-test
failure; no selected product checks ran in that attempt.


The corrected supervisor was independently source-reviewed by Mulan 5 before
attempt02. It requires positive parent membership in both observed identity maps,
excludes baseline identities, registers roots from the direct Popen object and
current parent/start/group, journals each signal intent and result, and retains
uncertain resources. Attempt02 passed the changed static blueprint case **1/1**,
then Angular compilation stopped before assertions because two existing JSON
fixture directories were absent from the private copied input closure. Build and
render were unrun. Its clean natural-exit teardown had no signal intents, sampler
errors or teardown errors; both owned groups, scratch and token were absent.

Attempt03 added only the exact account/node-baseline and brief/java-golden fixture
families and reused the passing static result at matching hashes. The state-page
spec passed **17/17**, and production compilation passed. Existing optional-chain
warnings in outbox/stock remain outside this change. The local HTTP proof passed
eight missing-resource/API checks and served a packaged script as JavaScript, but
the first browser `Page.navigate` timed out before any browser request reached the
local server. No rendered product outcome is inferred. Its failed receipt remains
strict false. Cleanup journaled one TERM to a positively recorded Chrome identity
after a fresh exact PID/start/PGID and baseline check; all owned groups, scratch and
token were subsequently absent, with no sampler or teardown errors. Mulan 5 read
both terminal receipts. This exercises that bounded signal/cleanup path; it does
not prove the earlier failed supervisor's unknown signal target or all lifecycle
branches safe.

Attempt04 reuses the static and 17 state results at matching complete input hashes.
The prior compiled artifact was removed by verified cleanup, so production
compilation is regenerated only as the prerequisite for remaining rendered proof;
the new hash-listed artifact is retained within the aggregate 32 MiB output cap.
The helper now connects directly to the existing owned blank page's CDP socket,
uses the established headless GPU-disable recipe and retains bounded Chrome
stderr. The precise first timeout cause remains unproved. Mulan 5 independently
passed this helper delta before fresh atomic admission; no product change or
broader test selection was added.


Attempt04's direct-page socket did not resolve the first-navigation timeout; the
failed receipt and bounded Chrome stderr remain retained. Display-link errors
were observed, but no causal attribution is made. The rebuilt artifact passed
compilation and its retained hashes support all later render-only attempts;
static/state/build commands and npm dependency copying are not replayed again.

Attempt05's finite data-document diagnostic succeeded and the actual desktop
unknown route, branded shell, refresh, arrival focus and Tab recovery-button focus
rendered correctly in two retained PNGs. The helper then failed waiting for home
recovery after Enter, with the document unchanged and no Runtime exceptions.
Attempt06 isolated that input issue on a native data-document button: the old
Enter keyDown/up payload caused **zero activations**, whereas supplying carriage
return text and unmodifiedText caused **one activation**. The app proof adopts
the verified full-text recipe; no product handler change was needed. That attempt
then encountered another 10-second navigation-command timeout, with the captured
document at the expected app URL and Angular boot loading. Both receipts remain
strict false and both clean natural-exit teardowns recorded no signals, sampler
errors or teardown errors. The intermittent command timing remains unproved.

Attempt07 reuses the native key diagnosis and all matching prior results/artifact,
with only navigation/reload command waits increased to 30 seconds; other CDP calls
remain 10 seconds and the 300-second phase/600-second run bounds are unchanged.
Actual rendered state, URL, brand, refresh, focus, keyboard and context assertions
are unchanged. Mulan 5 reviewed this bounded mitigation. A diagnostic output
projection clipped and was replaced by a bounded typed reread before conclusions;
no omitted output supplies the result (DL-20261117-GCC-013 recurrence).


The final scoped result is **PASS**: attempt07 completed at **09:11:18 UTC,
18 November 2026**, native/outer exit 0 and strict result true. Actual compiled
Angular under the documented-rule local static-host model passed desktop
1440×1000 and narrow 375×812 unknown direct entry and refresh, branded shell/logo,
no horizontal overflow, arrival heading focus, Tab focus and full Enter recovery
to Sign in. The return URL retained `/gcsp/?brand=mini#entry`. The narrow unavailable
screen remained visibly distinct. Seven final PNGs were inspected by the lead:
unknown, keyboard focus and recovered Sign in at both sizes, plus narrow Account
unavailable. No visual defect was found; the existing shared shell/card/button,
palette and focus outline remain intact. This is browser evidence, not deployed
Render/provider/API success evidence.

The changed static case **1/1** and Angular state-page cases **17/17** are reused
at exact matching product/input hashes. Production compilation passed in attempts
03 and 04; later render attempts use the verified retained attempt04 artifact,
without dependency copy or recompilation. Eight actual local missing-resource/API
requests returned plain 404 and a packaged script returned JavaScript/200 in the
retained attempt04 HTTP proof. The existing actual Java/native PostgreSQL 17/static
Angular/signed-local-OIDC **68 checks / six scenarios / 13 PNGs** remain separately
qualified evidence and were not replayed.

Attempt07 used 8.598 seconds, sampled peak RSS **1,162,330,112 B** and inclusive
sampled scratch/retained-output peak **136,651,928 B**. It exited naturally with
no signal intents, sampler errors or teardown errors; its owned group, processes,
scratch and reservation were absent. Corrected attempts02–07 each recorded clean
closure; their largest sampled RSS/disk peaks were **1,324,498,944 B** and
**460,753,048 B**, within the granted 2 GiB RAM/1 GiB disk bounds. These are sampled
measurements, not an exhaustive peak guarantee. Failed attempts remain immutable;
none is relabelled passing. Attempt01's signal-target/preceding-signal uncertainty
remains unresolved and is not erased by later successful cleanup. Final local
receipts, hash-listed source/artifact inputs and PNGs are retained beneath
`.claude/test-runs/fucq437/sniffles2/`; the dispatcher independently audits closure.

Sniffles 2 leads and Mulan 5 independently reviews; both requested and selected
`gpt-6.1-sol` / `high`, without fallback. An earlier Buzz Lightyear 4 spawn was
refused by the actual thread limit and created no child; it was not treated as a
permanent session cap. The bounded product delta remains four paths: the dev static
service rules, their existing test, and StatePage source/spec. Allocated delivery
documentation and this Story are the only other tracked changes. No Java/API,
provider, launcher, component or styling change was required.

**Both original acceptance criteria remain open.** Useful branded unknown-entry
recovery is now locally proved. Actual Render suffix/wildcard matching, unknown-path
caching and hosted topology, registered-provider and actual delivered-email return,
Safari/private-browser evidence and a green covering batch remain unproved. Full
suite: deferred to batch. The existing Greg placeholder/account partial-read
limitations, FUCQ-513/FUCQ-514 and attempt01 uncertainty remain as recorded. No new
Story scope, deployment, Jira lifecycle change, real email or OneDrive access occurred.


Mulan 5's final independent source/rendered review returned **PASS — no blocking
or major issues found**. It inspected all seven final PNGs and matched all
**359 current source-input hashes** and **36 retained compiled-artifact hashes**.
The local review receipt is `.claude/results/fucq437-mulan5-review.json`, SHA256
`be85f8118bb04a7cb22663466395845ae3fe7e0acc74be5b1313af75f8ac201e`.
The review preserves the original acceptance limits and failed-attempt/unknown
signal history; it does not infer deployed routing or blanket framework safety.


The lead's separate read-only closure audit at **09:15:16 UTC** found all **726
recorded PID/start identities** and **10 owned groups** absent, exact corrected-run
scratch paths and six tokens absent, and retained output **2,768,736 B** before
that audit file was written. It preserved peer processes/reservations and made no
signals. Proof03 did not retain explicit HTTP/CDP ports, so no port-specific03
absence audit is claimed; recorded own identity/group closure is verified.
The dispatcher's independent audit remains separate from this lead observation.
