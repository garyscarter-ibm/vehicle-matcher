# FUCQ-447 delivery checkpoint

## Employee Help source checkpoint — 14 November 2026

**Source only: six new native Help files, no runtime, HOLD for independent review.**
Released from clean `2ea7035add5e115ce661e180e77a4963c442afd7` by the finite parent
source release `.claude/fucq447-employee-help-source-release-1212.json`, SHA-256
`e41e151eaa51714d5e2207e5260e1d37b18bc94db4ae1373dd718090af2448ba`.
The readiness note SHA is `5d3dc008502ed3fc1b5d61726c9ea3d4b205c207f8d4593a8d655aa22fd2000f`;
actual parent audit `5be0931cbea457321f5f25a663287a71eb365ce7b02664bf28bbccae5c044636`
permits only this bounded increment. Existing client/projection source/spec bytes stay frozen.

### Native body and state boundary

New `HelpComponent` (`gcsp-help`) provides a per-instance `HelpStore`. Guidance and
owned-case reads never write. Ask, labelled reason, review and cancel remain local;
review prepares one immutable existing-client command, and only Confirm submits it.
Duplicate pending commands are guarded. Later deliberate requests use new IDs even
for identical reason text. Acknowledged success is distinguished from a subsequent
readback failure. An unknown outcome retains the exact command but offers retry only
after current reads; matching reason/history is not proof of commitment. Explicit
retry uses the same object. No automatic POST follows refresh or auth recovery.

The store invalidates generations/aborts and gates all private view fields on exact
ready-session identity plus subject/environment/run/employee/policy/roles. Account,
context or role change, denial and destruction clear private cases/history/remedies,
draft/review and obsolete intents; late results cannot repaint. An individual denied
read clears state even when a sibling ignores abort. Current exact-case readback
retains the newer complete version against the list. Java owns all decisions.

The approved seam is `quiet=false`, `headingLevel:1|2=1`, optional
`announce:(message:string)=>void`. Quiet embedding suppresses the page title and uses
Get help with your renewal. Host announcements suppress this body's live region and
all StatusScreen announcements. Existing shared button, LabelledField/native textarea,
FactList and ScreenIntro/StatusScreen APIs are reused; semantic subordinate headings
use the appropriate h3/h4. No ErrorSummary clone, shared primitive or legacy wrapper.

Frozen reference: Help/case-content/cases CSS at
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, supplied
`docs/gcsp/screens/00-employee-account.webp`, approved broad employee body `a7fc178`
in `docs/gcsp/evidence/fucq-6/README.md`, `COMPONENTS.md` and the experience contract.
No image/rendered inspection is claimed now. Routes, Activity, F446 orders hosts,
Account F440, auth/runtime/shell/global styles/kit/gallery/catalogue/build and Java
remain parent/assigned-owner paths. No employee call to Greg options/update is added.
Preference confirmation, suitability, canonical clock/risk producer and notification
parity are still original OPEN obligations; no invented controls/success or AC waiver.

### Unrun checks and finite proposal

Authored only `help.store.spec.ts` and `help.component.spec.ts`: exact intent identity,
pending/readback/unknown/stale/refusal/privacy/teardown; native association, focus,
headings, facts/history and quiet/host-announcement behavior. **All new specs,
compiler/typecheck/AOT/build/boundary/ratchet/browser/services checks are UNRUN.**
No test stamp or rendered/connected acceptance. Existing contracts26 and client59
passes retain their previous bounded evidence without rerun; the old840B contracts
success log remains unavailable and unreconstructed.

Finite non-executable runtime proposal:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq447/employee-help-runtime-plan-1212.json`
SHA-256 `3a9b66e3ccf7042551ed2fb2e3e8e3c88c5144e2b0d81f4d092a88e20b8e5f4f`.
It proposes only those two specs through the actual Angular unit-test builder and
TestBed/jsdom, one worker, shared2GiB RAM/disk,600s inclusive/480work/120cleanup,
5GiB emergency reserve and30GiB adjustment trigger. Copied/generated closure expected
above256MiB goes directly to the configured OneDrive run root; owned manifests,
explicit caches/TMP/logs, checkpoint/full JSON/success log/failure tail, finalizer and
independent actual teardown proof are required. No resource-helper import/API/lock/
reservation, Node/npm/version/compiler/test/build/browser/service/port/profile,
closure copy/link/cache/scratch, child or allocation occurred. Initial proposal
ignore-path guard failed read-only from the worker; corrected root `git -C` guard
created no allocation and no product check was run.

Actual Java/real OIDC/native PostgreSQL/restart/concurrency and full composed
employee→Greg→employee journey remain open, as do desktop/narrow/Safari/private,
keyboard/focus/announcements/reduced motion/CSP/accessibility and hosted/email gates.
A fixture is not integrated acceptance. Parent reviews source and exact executable
separately before any runtime release; no follow-on pickup is authorized.

### Current pins and preservation

All47 readiness pins matched before these metadata edits (the actual parent audit
also says47, despite46 in dispatch prose). The45 non-allocated input pins remain
byte-identical; Story's full old bytes remain an exact prefix and delivery's old
header/tail remain exact. Seven existing client/contracts source/spec files stay
frozen. Six stable IDs/13points/original2uncheckedAC/native+file In Progress/Gary
Carter claim and lease are unchanged. Only employee-help moves to in-progress;
contracts stays in-progress, client complete, Greg/composition/integration not-started.
The own FUCQ-447 map row is updated through the vendored slice helper with an own-row
writer; all301 foreign raw rows/order and every outside-row byte remain exact.
Waiting observation expires immediately and makes no active-worker inference.

| New source | SHA-256 |
| --- | --- |
| `apps/gcsp-web/src/app/help/help.component.ts` | `ac3afc332025e3378bbce3f6fbd31e3ae42b74aada2ee41ab5b801f717785dd7` |
| `apps/gcsp-web/src/app/help/help.component.html` | `4a9c1fb9f278f864a97924c1c59c6a2b65390c6876e207fdcbd65ef97b04e30d` |
| `apps/gcsp-web/src/app/help/help.component.css` | `5d17f32214eac0ac0c59c76967bbbf31a6d859957701ae9862ff0072766fbb62` |
| `apps/gcsp-web/src/app/help/help.component.spec.ts` | `1c0e093f4d1901eece3fe69ef25c0a383a63879edbe45ac422990c5e820d5350` |
| `apps/gcsp-web/src/app/help/help.store.ts` | `154befb8532bf32ee84fc46a63dba13a47e87e7241df1b042be82377ff09c446` |
| `apps/gcsp-web/src/app/help/help.store.spec.ts` | `d0c5f880aa28fbc7d19327a6270df5998a6899b716cdf0f0a9d2e62122f999c4` |

FUCQ-501 remains separate linked Medium/P2,unassigned/unclaimed/unfixed/nonblocking/
outside66; no repair, duplicate or new acceptance/dependency. No new defect established.
SAME Hubie requested/selected/effective `gpt-6.1-sol/high`, no settings/title/fallback
change or children. Gateway PASS api.servicesessentials.ibm.com. ONE official named
nine-path commit is authorized; parent owns sync/publication/Jira/importer/shared
integration. HOLD after returning its exact SHA, pins and proposal.

## Client validation checkpoint — 14 November 2026

**Current disposition: bounded client slice complete with 59/59 scoped checks and
independent parent result/teardown audit PASS; metadata-only checkpoint, HOLD.**
The tested source is `a0d905b64cb09411f914ea57ae195cd306e4e7f8` on the unchanged, unsynced worker branch
`dev/DEV-2026-11-13-015`. This section supersedes earlier source-only/UNRUN/runtime-HOLD
statements below only for the consumed client release. Earlier receipts remain historical.
Source, harnesses and runtime artifacts are unchanged by this metadata checkpoint.

The Story Lead records completion only at the original `client` delivery boundary:
the six actual Java operations plus exact-case GET selector, bearer/no cookies,
role/scope/session safeguards, bounded requests, cancellation and late-response
rejection, immutable prepared intent and identical-body explicit retry, and truthful
stale/refusal/uncertain-write evidence. The 59 full assertions cover these paths and
the authored malformed/config/token/stalled-work/privacy boundaries. Elmer's semantic
source review1119 passed; parent and Elmer's exact-delta executable reviews1147
passed; parent actual runtime audit1147 independently checked every assertion and
resource/input outcome. No product policy, frontend eligibility or backend authority
was inferred from fixtures. This records the bounded client outcome, not original
Story acceptance or a connected screen/Java journey.

Exactly ONE invocation, now consumed, from worker015:

```sh
/usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq447/client-runtime-stable-directory/supervisor.py run
```

Only `src/app/cases/case.client.spec.ts` ran with Angular compiler JIT/direct Injector:
59 passed, 0 failed, 0 skipped/pending, 0 TODO; supervisor exit0. Full59-assertion JSON
and the714-byte successful text log are retained outside scratch, together with the
allocation journal/checkpoint/receipt. There was no retry, alternate runtime,
config/source change or historical projection-spec replay. TypeScript typecheck,
AOT/build, boundary/composed UI, browser/rendered desktop/narrow/Safari/private/
keyboard/focus/CSP/accessibility, actual Java/real OIDC/native PostgreSQL/restart/
concurrency, hosted/email and full originalAC acceptance remain UNRUN/open.
Vitest JIT transpilation does not establish those gates.

Preparation limitations and corrections are retained honestly. Review1119 required
correcting the old proposal's540s work/60s cleanup split to480s work/120s reserve and
requiring strict complete canonical locked reservation readback. The old proposal
remains byte exact. Initial executable review1135 returned HOLD for
`F447-HARNESS-DIRECTORY-NLINK`: mutable directory link counts were frozen as ownership,
so normal child creation would fail mkdir/tree/root/deletion checks. That mechanism
was established by source and read-only target-volume metadata; no failing runtime
or product Bug was created. A separately authorised new stable-directory sibling
excludes nlink only for directory identity, preserving dev/ino/type-as-mode/mode/
uid/gid and explicit regular-file single-link guards. Unique roots/release/token
scope and exact pins were audited before the one run. All prior preparations,
proposals and failure/HOLD receipts remain unchanged. There were no test failures
in the released run; neither the initial HOLD nor preflight PASS is a test result.

The isolated regular copied closure contained46 packages/8,230 files/58,138,177 bytes,
including Angular compiler/core/common, rxjs, tslib and selected Vitest/Vite/native
runtime dependencies. Owned node_modules, Vite configuration, bundle/default caches,
TMP/npm/XDG and generated output stayed within the declared namespace. Canonical
shared HostBudget granted2GiB inclusive RAM/disk with1,028 telemetry updates.
Total141.3338s includes setup, copies, tests, audits, teardown and final writes;
sampled peak supervisor-plus-group RSS303,153,152B, aggregate owned disk98,239,744B.
Final retained owned metadata was15,606,336B; the714B log,26,717B full JSON and bounded
journal/receipts are deliberate retained evidence. No large output/OneDrive exception,
browser, service or database was allocated. The5GiB reserve, adaptation below30GiB
and direct configured OneDrive rule above256MiB remain the resource contract.

Parent independently verified supervisor33869, entire group35045 and network FDs
absent; scratch, all nested config/cache/temp/node_modules paths and worker dependency
link absent; canonical locked strict full-schema token absence for
`fucq447-client-stable-directory-1147-fd3a37d755af4335ab63f4ab4275cdda`.
No cleanup failures or unknown retained runtime allocations remain. Parent checked
all33 frozen runtime inputs,8 prepared pins,64 historical artifacts,8,230 selected
closure content hashes and full identities,Node/helper pins and full borrowed package/
toolchain lstat metadata. Metadata plus selected hashes does not prove whole borrowed
tree byte immutability. This checkpoint changes only3 authorised evidence metadata
files; the other30 runtime input pins and all source files remain exact.

All six stable slice IDs and original13 points remain: `contracts` in-progress with
historical cases19/help7 =26PASS at `d75d369ce14193252bf53154905a8a9282befa19` reused;
`client` complete at the bounded outcome above; `employee-help`, `greg-queue`,
`composition` and required `integration` not-started. The historical840B successful
contracts text log remains unavailable, unreconstructed and unreplayed; its full JSON
and original parent audit retain their existing identities. FUCQ-501 remains a
separate linked Medium/P2 backlog Bug, unassigned/unclaimed/unfixed/nonblocking,
outside66; its frozen numeric-offset response limitation is not repaired or waived.

Native/file In Progress, Gary Carter claim/lease, source/reference freeze
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, both original uncheckedACs and the required
integration/experience obligations are unchanged. The Story file is append-only;
only own FUCQ-447 map object changes, with301 foreign raw rows/order and every outer
byte preserved through the vendored helper's slice mutation and own-row writer.
Worker waiting observation expires at this checkpoint. The parent's newer
`jira_changed` importer notice is neither imported nor suppressed here; parent will
preserve/reconcile it at sync. No In Review, Done, full stamp or connected acceptance.
Remaining Java suitability/decline/preference-confirmation/clock/risk/notification
coordination and dispatcher-owned auth/routes/kit/host/backend seams stay open.

Hubie retains requested/selected/effective Sol `gpt-6.1-sol` / `high`, no fallback,
settings/title change or descendants. This finite receipt authorises one official
three-path metadata commit only: no source/harness change, further runtime, Jira,
sync, push, merge, deploy, email, publication or next pickup. Parent owns exact
checkpoint review and guarded publication/integration. HOLD after the returned SHA.

### Client runtime evidence pins

Paths beginning `client-runtime-stable-directory/` are under root
`.claude/test-runs/fucq447/`. These are retained local evidence, not shipped runtime.

| Evidence | SHA-256 |
| --- | --- |
| `.claude/fucq447-client-independent-source-review-1119.json` | `fbeb04c7986ff0b1bf87feb9b8386880537d9276b4ee097a7ac96255d3f5c97f` |
| `.claude/fucq447-client-executable-review-1135.json (historical HOLD)` | `6448e5eda36286d0cf7f5ec5cf30c6ed1fc530a21b263f80a8b79bce72c17dc3` |
| `.claude/fucq447-client-directory-executable-parent-audit-1147.json` | `12230f09508c145c6246edf9f5dbe1b2a0a083dd58297f96fcf53073e6563eae` |
| `.claude/fucq447-client-directory-executable-review-1147.json` | `7d0af8965864c0dc360e892d3ff299b88ea8a2eba64b003b7462a735cc961dad` |
| `.claude/fucq447-client-runtime-parent-audit-1147.json` | `1b8d5675dd2dd60624c6149582f00f06baa03dd598e9c228690c9838e5c04738` |
| `client-runtime-stable-directory/supervisor.py` | `9c5d936d2d5fb20c9bd9a8cc5bb0e3e4a97d3239ad0a87e1ba6d5c49824f10dd` |
| `client-runtime-stable-directory/manifest-template.json` | `558b3ed9970c7b750f6fb89b8760df8819dd62eb964991b7f01addc421ee3e41` |
| `client-runtime-stable-directory/preparation-final.json` | `adaf7445d752bdb22968cc5176f34d584e866e508f3e40aaa4dfd3a66baffb79` |
| `client-runtime-stable-directory/runtime-release.json` | `d32c9ac7e09879819323c04446d4ae82040e2bbc01f142d9027b0a8ca665dde4` |
| `client-runtime-stable-directory/receipt.json` | `72a2e9b036e932a18f9e70815603617343054cedb401a28026c8423d7243a53b` |
| `client-runtime-stable-directory/test-report.json` | `9625e7c942ac7dcf4e6c58b7ab40fe1362b34b252274850a1de5df30e1819e70` |
| `client-runtime-stable-directory/test-output.log` | `b2f256de127f3994157c7d662f6621f8d475118171f449021b58013a64f72743` |
| `client-runtime-stable-directory/allocation.json` | `4b20ea1b7ceedd45b713b922c550402731cafe633a6ed7c7e482ba1601e0da98` |
| `client-runtime-stable-directory/allocation-journal.jsonl` | `1b029df3260aa5fbd2a7069733ba75a085ca1389d501b15f3bfc09c2995c35e5` |
| `client-runtime-stable-directory/checkpoint.json` | `f389b0997c570e0fd61b57305f846cfef7fd52fb0457251a346079583219b772` |

Tested client source remains unchanged:

| Source | SHA-256 |
| --- | --- |
| `apps/gcsp-web/src/app/cases/case.client.ts` | `2e54eee7405f8bfc4f16f50ce10a04ea92914e63ab7aa4ab137688892bbfe530` |
| `apps/gcsp-web/src/app/cases/case.client.spec.ts` | `cd1197fa26a5f77ac33565ee000bae8860aec803ca0bb86686f9e5a205f9375f` |

## Client source checkpoint — 14 November 2026

**Current disposition: source-only client and specs authored; all new checks UNRUN; HOLD for parent audit.**
This finite client release is recorded in root `.claude/fucq447-client-source-release-1058.json`.
Verified clean base `5aee261aca174a19adeedb29f411deaabe98e02f`, configured base `gcsp-poc-dev` and integration root
`bed78ba385eb5b1c5272c3b548d5da2fcd9e96a9` before editing. Parent published/synced
contracts metadata `fbb37d7bc955905d44eafce024db1c3e7d7738a0` into this base.
This section supersedes earlier current-disposition/source-HOLD statements only for
the consumed finite two-source client release; earlier receipts remain historical.

The two new files implement the actual six Java operations, plus the exact-case GET
selector, through the existing AuthPort/runtime-config/PORTAL_FETCH interfaces.
Bearer authority stays outside query/body; fetch omits cookies and uses no-store and
redirect refusal. Employee and Greg role/scope gates are local safeguards; Java
remains authoritative. Captured ready-session object identity and immutable
subject/environment/run/employee/policy/roles values are checked at each await;
a new ready session with identical identity cannot revive old commands/results.
The actual OIDC service publishes new ready objects after context reload.

`prepareHelp`/`prepareUpdate` validate and freeze a reviewable command; only explicit
`requestHelp`/`updateCase` submits it. A private WeakMap binds the exact object to
its captured scope and serialized bytes. Explicit same-object retry replays identical
bytes; copied/foreign-instance/old-session commands fail locally. Caller commandId
identifies intent and Java resolves idempotency conflicts. No automatic auth retry,
POST replay, operation-status endpoint, contract-version tag or frontend eligibility,
transition/suitability/clock table is introduced. Four actual remedy input shapes are
supported; omitted remedy stays omitted. Numeric-offset command timestamps are
permitted by Java input. The frozen F501 response-parser limitation remains unfixed.

A10-second race covers config,token,fetch and async body work,including promises that
ignore AbortSignal. Late work rechecks abort/session before transport or returning
private data. HTTP/refusal pairing and frozen projection validation preserve only
permitted Java refusal evidence,stale versions,field reasons and operationId.
Local failure/malformed/scope outcomes remain distinct. Dispatched writes with an
unproved outcome are labelled unknown; pre-dispatch failures are not-sent. Known
HTTP status survives cancellation/timeout after headers. No private UI state store,
view,route or shared primitive is implemented by this client-only slice.

The authored spec uses Angular compiler plus Injector/runInInjectionContext in a
Node test environment,not TestBed/browser. It covers routes/encoding/headers,role and
scope refusal,immutable intent/explicit retry,actual remedies,privacy/refusal matrix,
malformed/transport/config/token failures and session/abort/stalled-work boundaries.
**The new spec,compiler/typecheck,AOT/build,boundary and all runtime checks are UNRUN.**
Read-only source/interface review,SHA-256/base/path checks,raw-map/AC integrity and
`git diff --check` are the only checks selected for this source checkpoint.

The five frozen projection/type/spec files retain their exact hashes below. Historical
`d75d369ce14193252bf53154905a8a9282befa19` cases19/help7 =26 passed is retained with
parent audit1058; it is neither rerun nor represented as client/typecheck/integration
proof. The840B successful text log remains missing/unavailable; full structured JSON,
receipt and actual cleanup evidence retain the hashes in the historical section.
FUCQ-501 stays separate Medium/P2,unassigned/unclaimed/unfixed/nonblocking,outside66;
no repair,new dependency or acceptance change.

All six stable slices remain: `contracts` in-progress with historical scoped26PASS;
`client` in-progress with source-only evidence; `employee-help`,`greg-queue`,
`composition`,`integration` not-started. Original13 points,native/file In Progress,
Gary Carter claim/lease and both original uncheckedACs remain. Only own FUCQ-447 map
object changes;301 foreign raw rows/order and every outside-object byte are preserved.
The waiting worker observation expires immediately and makes no active-worker claim.
Dispatcher's1112 importer notice reports an existing validation-evidence difference,
with unchanged native payload and originalAC; parent retains/reconciles it after this
checkpoint. No importer header or native amendment is made in this worker release.

Only the ignored non-executable runtime proposal was prepared:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq447/client-runtime-plan-1058.json`
SHA-256 `faf5ca88c6ea1ff3735880ddae2edbbb306deb45384aef1b64f892bd86146d49`. It selects only
`src/app/cases/case.client.spec.ts`,requires an isolated regular copied Angular
compiler/core/common,rxjs,tslib and Vitest/Vite/runtime closure with owned configuration,
`.vite-temp`,`.vite`,TMP/npm/XDG caches,canonical shared HostBudget,one worker,
2GiB RAM/disk and600s TOTAL including preflight/copy/cleanup. The5GiB reserve,
adaptation below30GiB,direct configured OneDrive output above256MiB,manifest before
allocation,process-group stop/join/absence,owned path removal/absence,token release/
absence,full borrowed metadata plus selected pins and parent final receipt are explicit.
It is a proposal only: further executable audit and separate one-run release are required.
No runtime,copies,links,caches,scratch,resource API,Node/version,services or children ran.

Remaining original gates include client spec/typecheck/AOT,boundary/shared composition,
employee/Greg screens and approved shared components,actual Java/real OIDC/native
PostgreSQL transactions/restart/concurrency,desktop/narrow/Safari/private/keyboard/
focus/CSP/accessibility and hosted/email/fullAC evidence. Actual Java suitability,
decline/preference confirmation,canonical clock/risk and notification composition
remain original integration gaps. No rendered screen or current connected acceptance
is claimed. Shared account/auth/config/routes/kit/orders/host/backend and frozen source
remain untouched; parent owns source/executable audit,separate runtime release and
publication. No sync,push,merge,Jira,deploy,email,final switch or next source pickup.

Hubie retains requested/selected/effective `gpt-6.1-sol` / `high`,no fallback or children.
Gateway PASS `api.servicesessentials.ibm.com`. Exact commit SHA is returned after the
official five-path helper commit. HOLD after this checkpoint.

### Current client source and input pins

These identities are freshly read from current base `5aee261aca174a19adeedb29f411deaabe98e02f`;
the two new source files are uncommitted until the returned checkpoint SHA. Existing
historical inventories below keep their original base; all historical63 pins are not
asserted to match a later parent integration.

| File | SHA-256 |
| --- | --- |
| `apps/gcsp-web/src/app/cases/case.client.ts` | `2e54eee7405f8bfc4f16f50ce10a04ea92914e63ab7aa4ab137688892bbfe530` |
| `apps/gcsp-web/src/app/cases/case.client.spec.ts` | `cd1197fa26a5f77ac33565ee000bae8860aec803ca0bb86686f9e5a205f9375f` |
| `apps/gcsp-web/src/app/cases/case.types.ts` | `a1071b1627f531a813c659b660f1549e8892ae4aa36e403be0f36784dd23d14f` |
| `apps/gcsp-web/src/app/cases/case.projection.ts` | `2b18645de9cc94fbaa34cba6ad227346625273d50cc72f9aabc2b79ff6eb0fac` |
| `apps/gcsp-web/src/app/cases/case.projection.spec.ts` | `3139d1b5a95462f77ebe23292dbecf6dbb3ed39591c68e7e3b2e06a64e80bc00` |
| `apps/gcsp-web/src/app/help/help.projection.ts` | `cf55e2fddef836e79f66b87a8170e82ef86f124d55fed1383faf7286a6839748` |
| `apps/gcsp-web/src/app/help/help.projection.spec.ts` | `27aeeb6e87035343372ee78d665d63db2a2c14d65a0116d35ae31f5f77d6ff55` |
| `apps/gcsp-web/src/app/auth/auth.port.ts` | `e8bd3ee619df1b34135fd754e6c83b394e3214088e046ab455dec4af3a762ad1` |
| `apps/gcsp-web/src/app/auth/runtime-config.ts` | `31e385fc95f490ca270c5687c998515b6422f9f22778b09a9e3aa4976059dc41` |
| `apps/gcsp-web/src/app/auth/oidc-auth.service.ts` | `d768b866f401c70bd64c5d770e64ae38a288d5dc98ca7111ed4c4fd69c1c8aa9` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseResource.java` | `ff65461cd1526d60371315e6929f89bffabc91be7f6a245c5084a0910d9925ce` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseService.java` | `89a3950de3df2b717c9ce3218d89d3ec90b6bceff9e2a375b2aea253fb1b68ab` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseResult.java` | `92522315f38ebef3b93c653906e5632aa34bd8b1f2ca34cdacf71fba2df8ac1b` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseJson.java` | `690edda615496b84d33a6acd35656a72e47934edbf478a5907dcc48801fe3bf6` |
| `services/gcsp-api/src/main/java/gcsp/api/auth/IdentityRefusalMapper.java` | `15660146d1aff3b17696602bbec147d046feb2307758aeb8c16f88bbee404033` |
| `apps/gcsp-web/package.json` | `db4427099ecdc0197ed991efb68cf22631b02087ba42a09eb0dbdd976568e540` |
| `apps/gcsp-web/package-lock.json` | `fb9ba0a4b7c8f0f4bcb33ccbbd8059a2d57593325f7aff085d0248917fbfa5a3` |
| `apps/gcsp-web/tsconfig.json` | `bf15840d26a748b6aa0df95da87fbc141909ec9854da7db7a2daceec56b57250` |
| `apps/gcsp-web/tsconfig.spec.json` | `1db769dfa5c1800b9ffaf3f01bb6a3e65a5d2cf3c45d4e8d15aa68128b14edc1` |
| `apps/gcsp-web/vitest.config.ts` | `f042a4b99a4d4f5733239f3cf20d24c4d5271cdf9df46f7c171f20ee8739f1fe` |
| `_tools/scaffold_git.py` | `ef8db3e5aab5494c6cdd2b6f7d272b325fc15436348cb7724a9f47b37fbc019a` |
| `_tools/product_map.py` | `dceee85bb1d2cf077406b3c908987ce5e1226c7c7aa23de9a5b2b7c6360d22cc` |

## Contracts validation checkpoint — 14 November 2026

**Current disposition: scoped26/26 passed and parent teardown audit passed; metadata-only checkpoint,HOLD for dispatcher review/publication.**
Frozen tested source remains `d75d369ce14193252bf53154905a8a9282befa19`. This current result supersedes
historical untested/source-audit/runtime-release statements below for exactly the
consumed two-spec run. The full stable six-slice plan and original2AC are unchanged.
`contracts` remains in-progress; `client`,`employee-help`,`greg-queue`,`composition`
and `integration` remain not-started. Native/file In Progress,Gary Carter claim/lease
and thirteen points remain; no acceptance,In Review,Done or closure.

The exact ONE released command,from
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-13-015`:

```sh
/usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq447/contracts-shared-budget/supervisor.py run
```

`case.projection.spec.ts`:19 passed; `help.projection.spec.ts`:7 passed.
Total26 passed,0 failed,0 skipped/pending,0 TODO. The five source/spec SHA-256
pins in the table below remain exact; no source or additional runtime is part of
this metadata checkpoint. SAME Wakko independent source review1027 passed with
separate F501,executable audit1050 passed,and parent
`.claude/fucq447-contracts-runtime-parent-audit-1058.json` independently passed the
retained full structured result,pins,borrowed metadata and actual teardown.

The run copied only41 packages/610 regular files/32,768,718 bytes plus five source
files and minimal metadata to independent owned inodes,no links/hardlinks.
Vite config,bundling/default caches,TMP/npm/XDG were owned. One Vitest worker used
the canonical shared HostBudget across both apps:normal2GiB RAM/disk grant,
121 telemetry updates. Total11.059s includes preflight,copies and cleanup;
sampled peak RSS235,061,248B and owned disk34,688,064B. Parent verified
supervisor PID99221,group99343,all14 scratch/cache paths and token
`fucq447-contracts-497d2c99-daf1-4a54-8163-41b6ea7c52e0` absent; reservation released.
No large output,OneDrive artifact,browser,database,service or F412/B-Bot runtime.

Retained under root `.claude/test-runs/fucq447/contracts-shared-budget/`:

| Evidence | SHA-256 |
| --- | --- |
| `receipt-shared-budget.json` | `51774feab6d2dc8b2a574862ae89666839029a9ec11d0dc7df04cef6a20794f3` |
| `test-report-shared-budget.json` (full26-assertion JSON) | `85398192ec6061761d9ec2a421139d052140d8e18ec0787c02d135d5b855acad` |
| `allocation-shared-budget.json` and `checkpoint-shared-budget.json` | `9803a00cffa41a01eaf81cb46911c0043ab1e0a40eec9b06ee3ab038d45effdd` |

The840B successful text log was removed with scratch by the frozen finalizer and
is unavailable. No failure tail was created; no transcript was reconstructed and
no runtime was repeated. Historical harness files remain unchanged. All63 source/
input pins,610 selected hashes and Node/helper pins matched. Full borrowed lstat
metadata matched; this does not establish unselected whole-tree byte immutability.

FUCQ-501 remains a separate linked Medium/P2 backlog Bug,unassigned/unclaimed/
unfixed/nonblocking,outside66:Z-only instant validation rejects Java-preserved
numeric-offset later-release times. Source mechanism established; runtime
reproduction UNRUN. Passing these26 specs does not repair or waive the defect.

Typecheck,AOT/build,composed client/screens/routes/kit/host behavior,desktop/narrow,
Safari/private,keyboard/focus,CSP/accessibility,actual Java/real OIDC/native
PostgreSQL/restart/concurrency,hosted/email and both full originalACs remain open.
Shared source,account/auth/kit/routes/build/Java files are untouched. The original
six-slice outcomes and required integration gate below remain binding. Parent owns
exact metadata review and guarded publication/integration only to `gcsp-poc-dev`;
this finite release authorizes no sync,push,merge,Jira/state/lifecycle transition,
new source work,descendants,deploy,email or final switch. Hubie retains Sol/high,
no fallback/children; HOLD after this checkpoint.

## Contracts source checkpoint — 14 November 2026

**Historical source-checkpoint disposition: authored, untested; then held for audit/runtime release.**
The dispatcher audited plan `5bc8d6524e7952b668fb254273e963493b3b2e7d`, reconciled it
with root `6c1628e21` and officially published worker base
`eaabe0186d14ea9b48d3c75785ea71fe33d2d294`. This worker verified that exact clean
base before editing. Existing claim, Hubie identity and Sol/high pair are retained;
no reclaim, fallback, child, worker sync or push occurred. All 53 original input
pins below still match this release base and current files.

The finite release covers only the five new files pinned below. They define the
actual Java case/help envelopes and wire DTOs, pure read validation, calendar/UK/UTC
facts, named ownership/history/remedy display, exact-car labels and frozen queue
sorting. Employee scope checks every returned row's employee and run; Greg scope
checks the run without comparing employees to Greg. Scope is already trusted caller
context, not authentication or permission conferred by a query/body. Backend bearer,
role and resource enforcement remains authoritative; later client scope capture and
late-response protection are still required.

Local not-loaded/invalid-response/scope-mismatch states remain distinct from Java
refusals. Refusal projection preserves actual code/reason/retryability, field reasons,
action/version/operation evidence, and drops attached private case/value/history.
Server transition order, remedy availability/reasons, exact IDs and confirmation-needed
car evidence survive unchanged. There is no fabricated contract-version tag,
clock-driven remedy eligibility, transition table, success inference, business command,
request, controller, Angular view or shared primitive. Historical/unknown recorded
remedy evidence grants no action; Java's absent preference-confirmation/relaxation
projection is not invented here. Existing Java suitability, decline/confirmation,
canonical clock/risk trigger and notification seams remain original integration gaps.

Two focused spec files are authored for these boundaries. **Tests, compiler/type checks,
builds, browser/rendered checks and services are UNRUN; no stamp or passing count.**
Only source inspection and metadata integrity checks ran. `contracts` is **in-progress**;
the other five stable slices remain not-started. Neither original AC is met/checked.
No new screen is rendered by this slice; later consuming screens retain all original
rendered desktop/narrow, Safari/private, keyboard/focus, CSP/accessibility and integrated
Java/OIDC/native-PostgreSQL/restart/hosted gates. Used Cars/shared code is unchanged.

The only runtime artifact prepared is the ignored, non-executable proposal
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq447/contracts-runtime-plan-1008.json`.
It selects exactly the two specs and proposes an owned, materialized dependency facade,
owned Vite configuration/cache, bounded supervised scratch/output and finalizers.
No dependency link, facade, config, cache, toolchain, process, browser or database was
allocated. Borrowed node_modules/config directories must receive no writes; prior
low-process cleanup evidence does not establish whole-tree immutability. The proposal
requires source audit and explicit runtime release before any allocation or execution.
F412/B-Bot runtime remains consumed and unused here. Parent owns the final receipt.

Exact checkpoint SHA is returned after the official worker-root commit. Dispatcher
owns publication/native lifecycle/shared integration; source/runtime work stops here.
The approved plan and original source identities follow as historical checkpoint facts.

### Contracts source and selected-check input pins

| File | SHA-256 |
| --- | --- |
| `apps/gcsp-web/src/app/cases/case.types.ts` | `a1071b1627f531a813c659b660f1549e8892ae4aa36e403be0f36784dd23d14f` |
| `apps/gcsp-web/src/app/cases/case.projection.ts` | `2b18645de9cc94fbaa34cba6ad227346625273d50cc72f9aabc2b79ff6eb0fac` |
| `apps/gcsp-web/src/app/cases/case.projection.spec.ts` | `3139d1b5a95462f77ebe23292dbecf6dbb3ed39591c68e7e3b2e06a64e80bc00` |
| `apps/gcsp-web/src/app/help/help.projection.ts` | `cf55e2fddef836e79f66b87a8170e82ef86f124d55fed1383faf7286a6839748` |
| `apps/gcsp-web/src/app/help/help.projection.spec.ts` | `27aeeb6e87035343372ee78d665d63db2a2c14d65a0116d35ae31f5f77d6ff55` |
| `apps/gcsp-web/package.json` | `db4427099ecdc0197ed991efb68cf22631b02087ba42a09eb0dbdd976568e540` |
| `apps/gcsp-web/package-lock.json` | `fb9ba0a4b7c8f0f4bcb33ccbbd8059a2d57593325f7aff085d0248917fbfa5a3` |
| `apps/gcsp-web/tsconfig.json` | `bf15840d26a748b6aa0df95da87fbc141909ec9854da7db7a2daceec56b57250` |
| `apps/gcsp-web/tsconfig.spec.json` | `1db769dfa5c1800b9ffaf3f01bb6a3e65a5d2cf3c45d4e8d15aa68128b14edc1` |
| `apps/gcsp-web/vitest.config.ts` | `f042a4b99a4d4f5733239f3cf20d24c4d5271cdf9df46f7c171f20ee8739f1fe` |

## Approved inventory and full plan — plan-only checkpoint

14 November 2026. **Plan only; HOLD for dispatcher review and explicit source release.**
Story `DEV-2026-11-13-015`, branch `dev/DEV-2026-11-13-015`, inspected tree
`ae8705e474ab83ac35be05e02fec29d6a4c9e10c`. The product freeze is
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`; `23f6ce3…` is authoring evidence.
No application source, runtime, test, build, browser, dependency link, provisioning,
deployment, email or child agent is authorised by this checkpoint. The dispatcher
publishes/reconciles this exact checkpoint and owns all lifecycle and integration.
No worker push, merge, sync or rebase. Helper base remains `gcsp-poc-dev`, merge `auto`.

## Fixed contract and authority

Native FUCQ-447 was read in full through Atlassian on 14 November: In Progress,
Gary Carter assigned; its description matches the local Story. The dispatcher brief
records 13 points, start 14 November and branch comment `3629453`; those fields were
not independently returned by the default issue read. Nothing native was changed.
The two original local acceptance boxes remain unchecked:

1. Users see authorized cases, named ownership, real status and permitted feasible remedies/actions.
2. Empty, unavailable, stale and denied cases remain useful and private; employee and Greg authority are enforced by the backend.

Preserve implemented help/queue behavior through Java E3.S21, with distinct real
employee/Greg logins. Unfinished optional case operations remain separate. No
fabricated case, employee, remedy, ownership, source fact or recovery priority;
no presenter impersonation/business commands and no legacy URL compatibility work.

Read independently: `AGENTS.md`, `docs/gcsp/README.md`, `demo-brief.md`,
`build-rules.md` (including Demo delivery and scope control), `experience-quality.md`,
`technical-readiness-2026-11-05.md`, `screens/README.md`,
`angular-java-dev-poller-kickoff-2026-11-13.md`,
`poller-tooling-2026-11-05.md`, `migration-baseline-2026-11-13.md`,
`migration-replacement-contracts-2026-11-13.md` (relevant ownership/API sections),
and `COMPONENTS.md`. Procedure: installed
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`
(whole/team rules, B4–B12 and Codex adapter). Skills read: sibling
`product-map/SKILL.md` and `defects/SKILL.md`; global test-resource contract read
in `/Users/garycarter/Claude/agent-scaffolding/managed/CLAUDE.md.tmpl`.

Equal collaborator authority supersedes named-owner privilege. Jira writes resumed
13 November; this does not waive the explicit source hold or acceptance. Actual
readiness, interfaces and file ownership govern pickup; Jira dependency links alone
do not. Preserve claims, source/access limits and existing deferrals. Defects below
High go through dispatcher to separate linked backlog Bugs and do not expand this
Story; Critical/High needs resolution or explicit collaborator deferral. Source
gaps below are recorded integration obligations, not reproduced defect verdicts.
New product requests/AC changes require separately reviewed backlog scope.
False child HTTP422 is diagnostic, not proof of exhausted credit while the launcher
can continue; retain configured gateway/credentials. Propagate these rules and
`docs/gcsp/build-rules.md` in every future brief.

## Frozen behavior and visual references

Direct comparisons through `scaffold_git.git` establish that current help, queue,
case-content, case HTTP adapter, Node case service/routes, standalone pages and Greg
host files are byte-identical to the product freeze (hashes below). Thus their
implemented behavior, rather than later Greg concepts or historical proposed scope,
is the parity reference.

* Employee help: one heading, a short introduction and Ask for help; opening/read/review/cancel
  writes nothing. A labelled reason (1–2,000 characters), review and separate confirmation
  send one command. Successful readback shows actual case owner/name/role, status, original
  reason, latest update, trigger, next action, due, renewal deadline, remedy and dated history.
  Repeat requests append to the active renewal case. The quiet embedded form remains usable
  from Buddy activity; relevant order-progress help uses the same body.
* Greg: Renewal cases within the dashboard and standalone queue, named employee/owner,
  reason/trigger, deadline, status and due. Sort by deadline with active cases first, or status
  then deadline, with case ID as deterministic tie-break. Each Open action is named for its
  employee; focus enters the case heading and returns to that row on close. The current options
  read supplies transitions and remedies; editable action/due/reason leads to review, separate
  confirm and authoritative queue/options reread. Terminal cases offer no further invalid action.
* Remedies: exact suitable available car (server rechecks eligibility, essentials, allowance,
  timing and custody), one confirmed preference change after a real unused decline, a reviewed
  future release/date/source already recorded for that case, manual scheme-team decision,
  and an extension only when policy and actual contract date permit it. No new future-plan
  provider or extension-permitted default is required. Employee preference change has its own
  review/confirmation; it preserves essentials/other values and does not itself resolve a case.
* Frozen loading/empty/unavailable/denied/stale/conflict/pending/readback behavior and disabled
  action reasons remain distinct. Access loss/account change must clear private state under
  the intentional OIDC changes, even where legacy code retained previously loaded content.
  A failed/uncertain write never announces a saved result. Reads never open a case.
* `case-content.js` preserves employee UK time, Greg's explicitly labelled UTC due/history,
  separate calendar deadline, short case reference, honest missing facts and actual owner.
  Stored owner is currently **Scheme team**, not an invented assignment to Greg personally.

The shell/header/sidebar/palette reference is the eight files in `docs/gcsp/screens/README.md`,
especially `00-employee-account.webp`. Current Density tokens and shared component catalogue
apply. Body authority is the exact frozen case JS/CSS and host composition above.
`docs/gcsp/evidence/fucq-6/README.md` at approved body revision `a7fc178` remains the broad
employee body reference. Case-specific historical screen sets are
`docs/gcsp/evidence/fucq122/demo-states-2026-11-07/README.md`,
`current-host-browser-2026-11-06/original-ac-evidence-matrix.md` and
`activity-host-2026-11-08/observations.md`. These were read for references/limits:
historical isolated Node/fixture/cookie captures do not prove Angular/Java/OIDC acceptance.
Later frozen source takes precedence over their obsolete collapsed-help/presenter descriptions.
No image or rendered-browser inspection is claimed in this plan.

## Actual Java contract at the inspected tree

All six routes are in `services/gcsp-api/src/main/java/gcsp/api/cases/CaseResource.java`.
Base `/api/gcsp/v1`; namespace `v1` is the exposed API version. Case responses currently
have **no `contractVersion` or `schemaVersion` field**. Do not invent one or confuse it
with row `version`, policy version, outbox message version `1` or Angular runtime-config schema `1`.

| Method and suffix | Authority and accepted input | Successful value |
| --- | --- | --- |
| GET `/help` | Employee; no query/body authority | `opensCase:false`, `ownerRole`, `extensionPermitted`, `nextAction`, `automaticRecoveryPriority:false`, `policyVersion`, `assumptions` |
| GET `/cases` | Employee; optional single `caseId` (1–128 chars), no other query | `{cases,asOf,policyVersion}` or `{case,asOf,policyVersion}` |
| POST `/cases` | Employee; JSON object exactly `{commandId,reason}`; nonblank text ≤128/2,000 chars | `{case}` |
| GET `/scheme-team/cases` | Greg only; no query | `{cases,asOf,policyVersion}`; case adds `employeeName` (ID fallback when unavailable) |
| GET `/scheme-team/cases/options` | Greg; one `caseId`, required by service | `{case,nextStatuses,asOf,policyVersion,automaticRecoveryPriority:false,options}` |
| POST `/scheme-team/cases/update` | Greg; exactly `commandId,caseId,expectedVersion,status,reason,nextAction,dueAt`, optional `remedy` | `{case}` |

Envelope is `{status:"ok",value}` with top-level `replayed:true` only for receipt replay.
`case` contains `caseId,runId,employeeId,renewalId,owner:{role,name},status,reason,trigger,
nextAction,dueAt,openedAt,lastUpdatedAt,renewalDeadline,renewalDeadlineState,policyVersion,
history,remedy,fictional,version`. History supplies `at,actorId,actorRole,status,reason,
nextAction,dueAt`, optional trigger and nullable remedy. `version` is positive and is the
next update's expected version. `fictional` is provenance; never paint demo disclaimers.

Update requires positive integer `expectedVersion`, text reason/nextAction ≤2,000,
and an ISO instant `dueAt` strictly after the service clock. Command IDs/case IDs are
nonblank ≤128. Preserve exact ID/body for an explicit same-command retry. A new intent
gets a new ID. `TransactionRunner` records operation plus canonical input under resolved
environment/run/actor (`employee:<employeeId>` or `greg:<subject>`); changed input with
the same identity conflicts. Row lock/CAS, history, receipt and outbox are transactional.
Unknown outcome carries `operationId`; check current state before offering deliberate
retry, with no automatic POST on auth recovery. CaseResource exposes no operation-status
or receipt-inspection endpoint; the scoped case GET remains the available readback.

Permitted transitions are:
`open → in-progress|closed`; `in-progress → remedy-proposed|resolved|closed`;
`remedy-proposed → in-progress|resolved|closed`; `resolved → closed`; `closed → []`.
Consume `nextStatuses`, not a separate frontend business rule. A remedy is required
for remedy-proposed/resolved; omitted remedy can retain the current recorded remedy,
which is revalidated where required.

Options groups: `alternativeCars:{available,items,needsConfirmation,reason?}`;
`preferenceRelaxations` and `laterRelease:{available,items,reason?}`;
`manualDecision:{available:true,type:"manual-decision",requiresDecision:true}`;
`contractExtension:{available,type:"contract-extension",contractEndDate,requiresUntil:true,reason?}`.
Commands currently accept manual `{type,decision}`, extension `{type,until}` after actual
contract end and current clock, later release `{type,releaseAt,source}` strictly future,
and alternative `{type,orderUuid}` checked by the suitability port. Preference relaxation
is currently always forbidden. Unavailable groups remain understandable with their reason.

| HTTP / status | Actual resource/service behavior and UI obligation |
| --- | --- |
| 400 `invalid` | malformed/non-object/trailing body, extra/multiple query keys, invalid command/date/status/remedy; preserve useful local edits; correct/review explicitly |
| 401 `unauthenticated` | missing/invalid/expired bearer; clear private output, shared auth recovery and safe return; never auto-submit |
| 403 `forbidden` | `role-required`, `not-resource-owner`, unmapped account or forbidden remedy; show no foreign case payload and no actionable stale preview |
| 404 `not-found` | unknown scoped case; useful return/refresh, no invented empty-success result |
| 409 `stale-version` | expected/current versions plus `action:"refresh"`; clear obsolete review and require fresh options/reconfirmation |
| 409 `conflict` | changed-input receipt, renewal change or other transaction conflict; inspect/refresh before new intent |
| 503 `unavailable` | absent persistence/context/policy, provider/SQL failure; usually `case-unavailable`, retryable true |
| 503 `unavailable`, `outcome-uncertain` | `operationId`, retryable false; no success inference and no automatic resubmit |

Refusals preserve `status,code,reason,retryable`, plus relevant `reasons,action,
expectedVersion,currentVersion,operationId`. The case implementation itself does not
currently emit `stale-run`; do not fabricate a Java response. Guard account/run/context
changes locally and re-evaluate shared reset behavior at integration.

Authentication precedes role/ownership, query validation and service availability.
`BearerAuthentication` resolves `IdentityPort`; `OidcIdentity` validates JWT signature,
issuer, audience, expiration/lifetime, subject and configured claims before trusted mapping.
`Access` requires employee for employee routes, Greg for team routes; presenter alone has
neither. Employee identity is taken from principal, never query/body. `CaseStore` scopes
all reads/locks/CAS to environment+run; own reads additionally filter employee or check
the found case owner before returning it. Greg legitimately sees the current run's cases;
do not apply an employee-ID-equals-Greg rule to team responses. Private history is released
only inside an authorized case projection. Real identity/role/ownership trials remain unrun.

## Readiness and precise shared seams

The agreed current interfaces permit independent types/projections and a scoped client,
then help/queue bodies. Both future feature directories are absent. All existing shared
Account/auth/runtime/shell/routes/styles/kit/catalogue/build paths remain dispatcher-owned;
Marvin owns only the four allocated account client/preview/spec files. Bertie owns new
orders only and is on HOLD after integrated `8bff1258b`. Russ owns Java/backend/repository
419–425. F417 reservation remains inactive and retained. No second shared writer.

1. **Dispatcher route/composition seam:** replace only `help` and `greg/cases` placeholder
   entries in `apps/gcsp-web/src/app/routes.ts` with lazy feature components, retaining
   employee/Greg guards. Shell already links Renewal help. Arrange Greg Renewal cases
   entry/section and employee quiet Activity/conditional order-progress hosts using feature
   exports after their owners agree exact mount points. This worker cannot edit those hosts.
2. **Shared kit seam:** reuse native Angular ScreenIntro/StatusScreen, ButtonDirective,
   FactList, LabelledField and ErrorSummary. The current Angular kit has no data-table
   counterpart to the frozen stacked Greg table. Dispatcher must name one writer for a
   native shared table with stacked rows and named Open/focus behavior, catalogue/gallery
   and applicable ratchet coverage. Nested heading support beyond ScreenIntro's h1/h2
   needs either an agreed shared extension or semantic page headings. No competing local
   primitive or legacy-controller wrapper. Request these precise seams before queue work.
3. **Russ case parity seam:** `CaseDefaults.NoSuitability` is the sole current production
   `CaseCarSuitabilityPort`; it returns disconnected/empty and UNAVAILABLE on check.
   `CaseService` returns empty preference relaxations and unconditionally rejects them;
   own projection has no `relaxation` confirmation state. Current `BriefResource` exposes
   no `/brief/change-after-decline`, although Angular `BriefClient` already declares that
   method. Frozen source implements these flows; retain them as original parity obligations.
   Do not fix Java or manufacture success/data in this worker. Russ/dispatcher must allocate
   actual suitability/decline/brief-confirmation composition and its evidence.
4. **Clock/trigger/persistence seam:** `CaseServiceHolder` uses `Clock.systemUTC()`, while
   frozen service uses canonical DemoClock. F474's recorded result explicitly leaves
   renewal-risk deadline/lifecycle handler unported. Both affect real case status/due/action
   parity and require Russ's clock/producer composition. Confirm actual run reset and
   employee renewal data from `AccountCaseContext`/`AccountRecordsPort`, with canonical
   `renewalCase.*` PolicyService rows, before connected trials. No new policy defaults.
5. **Notification boundary:** `OutboxCaseNotifications` writes `renewal-case-update` with
   actual case/version/recipient and message version 1. F474's result records notify's
   missing case renderer/dispatch; this is a shared producer/delivery limitation, not proof
   of delivered mail. Do not start email or add notification product scope here.
6. **External connected evidence:** actual test-provider registration/logins, isolated
   Render dev plus own PostgreSQL/topology and agreed Brevo sender/recipient/real-send
   permission remain outstanding per dispatcher. No credentials/configuration are inferred
   from committed source. Test JWKS/synthetic account fixtures do not establish browser login.

F474 native In Review/source integration is credited as available implementation, not
connected acceptance. Its local result records 44 case tests and 580 Java verify tests
passing on its own PG17 source tree; those are historical, not rerun or transplanted to this
tree. It explicitly excludes Angular, real provider login, hosted Render and email, and
records clock/suitability/decline/notification integration still open. No defect severity or
live reproduction is inferred here. The dispatcher can route the precise remaining
original-scope seams without new dependency links or transfer of Java ownership.

## Full stable slice plan

All six slices start **not-started**. The inventory checkpoint is not a completed delivery
slice. Preserve these IDs across retries; completion needs lead review and selected checks
at the actual delivery boundary. These indicative slices total the claimed 13 points;
they neither amend the native estimate nor split/expand the acceptance contract.

| ID / points | Bounded outcome and future files | Original AC / delivery checks |
| --- | --- | --- |
| `contracts` / 2 | First independent source checkpoint: new `cases/case.types.ts`, `case.projection.ts`, `case.projection.spec.ts`; new `help/help.projection.ts`, `help.projection.spec.ts`. Pure domain-specific envelope/case/options parsing and display/sorting projections, server remedies/transitions retained. No requests, controls or shared files. | AC1+2: exact Java shapes, absent version tag, owner/status/missing facts, malformed/empty/denied/stale envelopes, employee/Greg projection differences; focused specs. Source remains held until release. |
| `client` / 2 | New `cases/case.client.ts` and `.spec.ts`, using existing AuthPort/RuntimeConfigService/PORTAL_FETCH read-only. Six actual v1 operations, bounded requests, bearer/no cookies, role/scope guards, cancellation and late-response rejection; command ID/body and uncertain/refusal preservation. Feature client only. | AC1+2: request/path/body assertions; no identity query, role denial, subject/run change, auth recovery with no auto-POST, same-command retry, stale/uncertain refusal; focused client specs. |
| `employee-help` / 2 | New `help/help.component.ts/.html/.css/.spec.ts` plus `help.store.ts/.spec.ts` only as state complexity requires; standalone and embedded/quiet inputs, help reason/review/confirm, own case/history/remedy readback and later single-change confirmation against the actual released backend port. | AC1+2: nonmutating open/review/cancel, repeat request, real readback, loading/empty/pending/unavailable/denied/stale; private state clear and focus/announcement. No placeholder confirmation success. |
| `greg-queue` / 3 | New `cases/case-queue.component.ts/.html/.css/.spec.ts`, `case-queue.store.ts/.spec.ts`, `case-detail.component.ts/.html/.spec.ts` as needed. Server-projected remedies/statuses; shared native table; sorting, row selection/focus, review/confirm/readback, closed states. | AC1+2: current versions only, exact car option identity, unavailable options/reasons, deliberate update and cancellation, employee confirmation gate, no employee/presenter commands. Requires table seam and real backend parity for completion. |
| `composition` / 1 | Feature exports/embedding and coordination with dispatcher-owned route/host/auth/kit integration; own feature integration specs under `help/` or `cases/`. Dispatcher owns actual route/Greg/Activity/orders/shared edits. | AC1+2: own-login direct navigation, menu/host placement, one shell/heading/live region, teardown, no legacy controller, route guards plus backend enforcement. No source permission is implied for shared files. |
| `integration` / 3 | Story-level Java + real OIDC + native PostgreSQL + rendered development gate; evidence in this delivery record/Story and later explicitly allocated evidence paths. All source acceptance remains open until this passes. | AC1+2: employee request → Greg authorized feasible action → employee current readback, denied cross-user/role/resource reads/writes, stale/replay/conflict/uncertain/restart/concurrency, clock/trigger cases and original remedies, actual desktop/narrow/Safari/private/keyboard/focus/CSP/accessibility. No fixture-only completion or automatic Done. |

Existing verified product component is `renewal-help` (Renewal risk and help cases),
already associated with FUCQ-447/FUCQ-474 in `components.json`; no boundary or registry
change is needed. Only the own work row may change; preserve all 301 foreign rows,
their order and every outer byte. The helper's original formatting round-trip is exact;
guard the row spans before/after helper mutation. No map build/publication is run.

## Selected future validation and resource receipt

**Ran now:** source/document/native read-only inventory and metadata integrity checks only.
**Tests/build/browser/services: unrun, not allocated. No test stamp.** No test success
is inferred from source or inherited receipts. No validation scratch, dependency link,
toolchain mutation, subprocess service, browser profile, database or child was created.

After source release, select the narrowest meaningful affected specs first, for example
from the worker root (commands planned, not executed):

```sh
npm --prefix apps/gcsp-web test -- --include='src/app/cases/case.projection.spec.ts' --include='src/app/help/help.projection.spec.ts'
npm --prefix apps/gcsp-web test -- --include='src/app/cases/case.client.spec.ts'
npm --prefix apps/gcsp-web test -- --include='src/app/help/*.spec.ts' --include='src/app/cases/*.spec.ts'
npm --prefix apps/gcsp-web run check:boundaries
```

Production AOT `npm --prefix apps/gcsp-web run build` is a later integration selection
after shared composition, not a first-slice requirement. Dispatcher/Russ owns the Java
lane: reuse matching evidence or, when justified and allocated, select
`./mvnw -B test -Dtest='gcsp.api.cases.**'` from `services/gcsp-api` with native PostgreSQL.
The existing CaseRead/Request/Update/Http/HttpUnavailable/PolicyCaseAdapter tests cover
important contracts; database tests skip without GCSP_TEST_DATABASE_URL, and HTTP tests
use signed test JWTs/JWKS plus an alternative known-renewal adapter. Record real skips;
these do not prove actual browser provider login or the production account adapter.
Existing Node `gcsp-case-views`, `gcsp-renewal-case` and `gcsp-cases-local-demo` scenarios
are semantic references, not an instruction to rerun the whole Node suite.

At the integration slice, record exact Java/Angular/input/base/provider identities.
Exercise two distinct employee logins plus Greg and presenter denial; current employee
and run must constrain all private case/history reads and writes. Use actual persisted
renewal/brief/decline/stock inputs through the same services, not fabricated outcome
fixtures. Observe version/receipt/history/outbox persistence through normal compatible
restart, concurrent help requests/updates and rollback/uncertain outcomes. Inspect
1280×900 and 375×812, Safari/private, keyboard-only review/confirm/cancel, focus return,
long/missing fields, stacked queue/history and all applicable state outcomes. Check CSP,
labels/contrast/status announcements/reduced motion and new-path ratchet coverage.
Shared changes need relevant Used Cars checks selected by their owner. Hosted proof
awaits actual isolated setup; unavailable live BMW access remains distinct.

Before any test/proof/build/link/browser allocation, establish an owned manifest outside
scratch plus supervisor finalizer under the root's `.claude/test-runs/fucq447`, explicit
selected commands, process groups, output paths and checkpoint/resume identities.
Start one worker with ≤2 GiB RAM/scratch and ≤600-second chunks; maintain 5 GiB reserve
and adapt below 30 GiB rather than idling. Large generated outputs >256 MiB go directly
to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq447`.
Preserve borrowed dependencies/toolchains read-only with device/inode/hash; never touch
another worker's cache/process. Retain concise results/useful failures, stop/join owned
children, remove disposable owned allocations and verify filesystem absence. Parent
owns final receipt. No new F412/B-Bot runtime; its one-shot is consumed. No full suite
without a concrete broad-impact requirement or agreed checkpoint; targeted is not a full stamp.

Before any future descendant: reread AGENTS, fresh capacity and authoritative
`tiers spawn implementer|runner --harness codex --session 01a1d6ae-1c69-7240-888b-98af7b3562bd`;
one at a time, fork none, exact returned name/task/model/effort and self-contained brief,
all current scope/resource/experience policies, verify saved title/runtime/parent and
record requested/selected/effective pair plus fallback truth. No descendant now.

## Identity and disposition

Hubie, they/them, chat `01a1d97e-70b9-7831-8632-3f7405b25af2`.
Saved title **Hubie** verified by desktop read_thread after set_thread_title was the
first action. Requested/selected `gpt-6.1-sol` / `high`, no fallback; local session
turn_context independently confirms effective `gpt-6.1-sol` / `high`.
The session metadata has no parent field; linked dispatcher
`01a1d6ae-1c69-7240-888b-98af7b3562bd` is evidenced by the incoming delegation,
not independently inferred from session metadata. Desktop cwd is the root; every shell
operation explicitly uses the allocated worker. IBM gateway check PASS:
`api.servicesessentials.ibm.com` under `ibm.com`. No children and no runtime allocation.

Dispatcher action: review/publish the exact clean plan SHA, then explicitly release
only `contracts` if appropriate; retain the source hold until that message. Route the
named shared kit/entry and Russ parity seams for later completion. The Story remains
In Progress, both original ACs unchecked; this checkpoint is **waiting**, not built.

## Source identity inventory

The following SHA-256 values are generated from inspected files, not runtime evidence.

Every file below matches inspected HEAD `ae8705e474ab83ac35be05e02fec29d6a4c9e10c`.
All 12 files in the first group also match the product freeze byte for byte.
Test hashes identify inspected source only; references retain their historical limitations.

### Frozen behavior / current retained source

| File | SHA-256 |
| --- | --- |
| `blocks/gcsp/cases/gcsp-help.js` | `e590c4c60c75b49f064e2b5df0fec23318df226cc0d944388e51e37e0bf94bc1` |
| `blocks/gcsp/cases/gcsp-case-queue.js` | `704883d4f35214c6b38c375b5a1735b2409623c3d441843a74c1e2c0d21c8880` |
| `blocks/gcsp/cases/case-content.js` | `1536807f431263029030275e5421b92f7b2782c08350614316a7fb75b3fd778b` |
| `blocks/gcsp/cases/http-adapter.js` | `86348b032fa2ff185860402c5afd9a836089941547c8429ca91df3cb0ef539b0` |
| `blocks/gcsp/cases/gcsp-cases.css` | `ce0778f39f99aa796c04fe7d0b226ad1e6e345616214a075e66b151b92ae8e7b` |
| `blocks/gcsp/cases/gcsp-case-queue.css` | `a82d924b39cddbf125cd4e9d78c4a6e2b8b1a0c306ca5a7d85e2be62e9a416b8` |
| `server/gcsp/cases/index.js` | `4e3de45c8a636d451d835b53bc4a5a92a4f580ecad62d8c7c9a2783648eb351c` |
| `server/gcsp/cases/http.js` | `55524d7895ae5a76d363e12f07a5919c27a228c0e34e7149cf2c900f364cfadc` |
| `gcsp-help.html` | `87f46e017b262a05498675996357007e9c6bab31b9edba5f1214ee7ca2ca8065` |
| `gcsp-case-queue.html` | `51bacd8716762fa2e02057728ea8cb4e919f5e4e749fedcf5df6c0e4bc84d103` |
| `blocks/gcsp/greg/gcsp-greg.js` | `a13a4320c7ce67d4c7112f041e98edebb7eca4cf9d456357d6289e1e7f41f548` |
| `blocks/gcsp/greg/harness.js` | `d9f75ce39de66f3c59a9ad123d88dd98359931339b3afb3ce229bd7cf8d5d709` |

### Java API, private scope and remaining parity seams

| File | SHA-256 |
| --- | --- |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseResource.java` | `ff65461cd1526d60371315e6929f89bffabc91be7f6a245c5084a0910d9925ce` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseService.java` | `89a3950de3df2b717c9ce3218d89d3ec90b6bceff9e2a375b2aea253fb1b68ab` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseStore.java` | `9d863e235597528190b148ae39e84e908ed2c6dc0bc86a6ae75c0d88c1e705e1` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseServiceHolder.java` | `ab0ac4b9440e4e14c281df2917cdf8c2bbcc38946f831dc35e22e378f8d765f2` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseDefaults.java` | `8fe8df7733caf2b6c4b06f28c7e07b813fb9d9ffb1a104f247374dafce5fe7eb` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseCarSuitabilityPort.java` | `8066a30eeb45cd00b44321a66157307c0986626d0ab52314fcfe1cc3904c23d8` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseResult.java` | `92522315f38ebef3b93c653906e5632aa34bd8b1f2ca34cdacf71fba2df8ac1b` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/CaseJson.java` | `690edda615496b84d33a6acd35656a72e47934edbf478a5907dcc48801fe3bf6` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/AccountCaseContext.java` | `8063d66393b562bb3dc6f99d88dc876867f4993276572e2b604a32a46c69f2c6` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/PolicyCaseAdapter.java` | `908e1b82e23d3203e7852b5f3bfdce0722cc19a481577795123b967ad61dee09` |
| `services/gcsp-api/src/main/java/gcsp/api/cases/OutboxCaseNotifications.java` | `b6c8c0d3350182c65665ba1b07868936f737f70810f64c412a632ac799060a68` |
| `services/gcsp-api/src/main/java/gcsp/api/brief/BriefResource.java` | `4c8184d08e5f0753493da8870b55bc24ebddc378861cc36c5de1a5061a45c683` |
| `services/gcsp-api/src/main/java/gcsp/api/auth/BearerAuthentication.java` | `e04308348f876a8c7a7d06bd0baa766a20e20c5e54a6a4fb5cdfbf6a478cd8a7` |
| `services/gcsp-api/src/main/java/gcsp/api/auth/Access.java` | `8acaf2ce1daaa35c1da02e2513d5c2d9d8b83c71bb93084b69852a10e6d51112` |
| `services/gcsp-api/src/main/java/gcsp/api/identity/OidcIdentity.java` | `3979ce026adcac90885f361e534025f35ffbf4c5c89eba69c961c6cd5a6148b7` |

### Angular read-only integration seams

| File | SHA-256 |
| --- | --- |
| `apps/gcsp-web/src/app/routes.ts` | `12c0ff99492971b42a02323d4a85ca8cb676e0b07098173cc8a4feaa3053abeb` |
| `apps/gcsp-web/src/app/shell/shell.component.ts` | `8b3d1e6b2b576d97eb1cf4f3430f5e65f849aecacbfdd5327b427ac8be64c01c` |
| `apps/gcsp-web/src/app/shell/shell.component.html` | `3356118b234f16d5967d99c66a1663ae8be3b207e566a3c8a54fe4a81c7d1524` |
| `apps/gcsp-web/src/app/auth/auth.port.ts` | `e8bd3ee619df1b34135fd754e6c83b394e3214088e046ab455dec4af3a762ad1` |
| `apps/gcsp-web/src/app/auth/runtime-config.ts` | `31e385fc95f490ca270c5687c998515b6422f9f22778b09a9e3aa4976059dc41` |
| `apps/gcsp-web/src/app/auth/route.guards.ts` | `76a0140d322bbdf2cd12cdc49b120f13e53843ccd95c27fb9b0e6bd668016962` |
| `apps/gcsp-web/src/app/preferences/brief.client.ts` | `b460d8c4c8298078910a53be1c6526d33da807147ab02fd93a7a498c46ec4488` |
| `apps/gcsp-web/src/app/kit/screen-intro.component.ts` | `7dd3f8b103722b39ae2ae709460327f1f94d5eff4113eb4e9111e6d4515374ba` |
| `apps/gcsp-web/src/app/kit/status-screen.component.ts` | `a314c00ef2f9bba4112d119acc416b24418f1fe3b192d93328198083289fa470` |
| `apps/gcsp-web/src/app/kit/button.directive.ts` | `9bb53c1f9ccf21c5ac75f56e523a52cd2e236acc80f0bb5a8444201c4896ac75` |
| `apps/gcsp-web/src/app/kit/fact-list.component.ts` | `3cfc9e2acaac692ac13a371927dfcca257e77e086859bbd95cf58198f330f13d` |
| `apps/gcsp-web/src/app/kit/labelled-field.component.ts` | `a9d0af0a7435a0e31f0c3772ed311227146696bcf9826983eae47a908136f96a` |
| `apps/gcsp-web/src/app/kit/error-summary.component.ts` | `9fdc1131121a9385e001f0a56ad6ff2347c67e1bf1d92470808ac1ad2cbaf1b2` |

### Inspected test sources and historical visual/validation references

| File | SHA-256 |
| --- | --- |
| `services/gcsp-api/src/test/java/gcsp/api/cases/CaseReadTest.java` | `665596b348af495a15999f5b213d768da07e3e7e210c6e0fd920c37fccc53bb9` |
| `services/gcsp-api/src/test/java/gcsp/api/cases/CaseRequestTest.java` | `384e6f68375a6b4fcf76927c19f07d36614c2d07fb7741529ea8148e2f561803` |
| `services/gcsp-api/src/test/java/gcsp/api/cases/CaseUpdateTest.java` | `a9abac45199518cb638b90277f4829ddf1d8c0053836393a7385198074eda6f2` |
| `services/gcsp-api/src/test/java/gcsp/api/cases/CaseHttpTest.java` | `c332980008d290c52b3376a94d6f0c73d0b11c802dc98852aa5397b6a3f9db4d` |
| `services/gcsp-api/src/test/java/gcsp/api/cases/CaseHttpUnavailableTest.java` | `828541ddc0303a064332f3f4d51956c3b6d35ea5e7db640a7f31ca37fca4020c` |
| `services/gcsp-api/src/test/java/gcsp/api/cases/PolicyCaseAdapterTest.java` | `b7eb9acf02c586140f43188d449c72a5b637ab70f92ab82658caa9027f374f2c` |
| `_dev/done/2026-11/DEV-2026-11-13-042.md` | `08dc7fe9cadcbe3b4f3baf138ab8fdfcfbcc9ce40bef33b8e6cbab26c31e0b8b` |
| `docs/gcsp/screens/README.md` | `c187e449aa873d90a0ffe1a903bd7263bce71b759e419dc2718627469a16dfdc` |
| `docs/gcsp/evidence/fucq-6/README.md` | `396fb712294c19f0f79d13f5202f49ee80808376ed643354a99bfcdc5c4139db` |
| `docs/gcsp/evidence/fucq122/demo-states-2026-11-07/README.md` | `ddd0a070ad44ad600ca2b8b4b139fb0fb4c4b8cd56ed9b8daf4369b7def2e72b` |
| `docs/gcsp/evidence/fucq122/current-host-browser-2026-11-06/original-ac-evidence-matrix.md` | `8638f22e165476e5a14b5177add2d54ce989439f15877a6cb5cf70700d76862a` |
| `docs/gcsp/evidence/fucq122/activity-host-2026-11-08/observations.md` | `d17058ce0dfe19ff15ba2903af00bc4055c3e46b6ef1c655bc7fffce35f3cc1d` |
| `COMPONENTS.md` | `5cbcd4841bb6dbf28e7ffb29cf91d05eb1a04846bdaf19e082c4b0a1ec5bc70e` |


## Employee Help validation and independent review — 14 November 2026

The employee Help partial checkpoint at `587e66fa0d24c2741ddd0a4ad808e0f285c627a3` passed the native Angular test compiler and all49 selected assertions: component14,store28,projection7;0 failed/skipped/pending/TODO. Final run `b7087891a923499895c0842c38b11331` is consumed/nonreplayable. Earlier TS2339 compilation failure, subsequent48PASS/1whitespace-sensitive assertionFAIL and preallocation verifier NameError remain retained. The compiler correction is explicit CaseRead narrowing in `help.projection.ts`; the store is unchanged. Three final component expectations now assert exact associated fact label/value rows within the proper case/history scope, preserving the original values,privacy and other assertions.

Parent actual audit `.claude/fucq447-help-facts-runtime-parent-audit-1329.json` (SHA-256 `901724fe559973023d7ae552bb7e3f0b8d44c3a0e2d98e5fa5972043fc7744ed`) verified13 prepared,82 source,46 project,22991 closure,149 historical and10 builder pins,full borrowed package/toolchain metadata,actual supervisor83226/process group84934/networkFD/all scratch+created container/canonical locked full-schema token absence. Final receipt SHA-256 `223accfa251e325597475a589046622d48f2cb5d4878cd1b63bb3dbc28a4d0e0`; full49-assertion JSON `018b1e061ddecd54da7737d492d66940713f1f00882212d25f2f3233c89eb573`; successful2225-byte log `e6fa242b9716fafeace399df83dd4194d6b86a6eb93178673c80e5a4cb6c03ed`. Inclusive212.421s,peak RSS907870208B,owned disk360173344B. Engine bytes normalized exactly to the prior and canonical reviewed engines after declared literal changes. Parent ran no tests or cleanup; no runtime resources remain.

Elmer Fudd independently reviewed the final source/test delta and meaningful actual49-assertion evidence: PASS for partial `gcsp-poc-dev` integration,with no new findings or Critical/High issues. Receipt `.claude/fucq447-help-final-independent-review-1329.json`, SHA-256 `1fdc041e496cd83c89fe2972ffcd6fe818907092812ddda87a2f75e3c9682cb0`. Requested/selected/effective gpt-6.1-sol/high,no fallback,children,tests or runtime resources. FUCQ-501 Medium and FUCQ-502 Low remain separate linked backlog Bugs,unclaimed,unfixed and nonblocking under `docs/gcsp/build-rules.md` Demo delivery and scope control.

Both original AC remain unchanged and unchecked; native In Progress,claim/lease and13points remain. Employee-help stays in-progress,contracts in-progress,client complete,Greg queue/composition/integration not-started. Employee preference-change confirmation,suitability/canonical clock+risk/notification parity,parent routes/host composition,actual Java/realOIDC/nativePostgreSQL/restart/concurrency/remote/hosted/email and rendered desktop/narrow/Safari/private/keyboard/focus/announcement/CSP/accessibility remain open original obligations. Entirely unobserved auth history cannot be reconstructed from exposed current state. This tested partial increment does not establish full Story acceptance,In Review or Done. Earlier26 contracts/client59 results stay historical and are not added to current49; the old840-byte contracts success log remains unavailable/unreconstructed.
