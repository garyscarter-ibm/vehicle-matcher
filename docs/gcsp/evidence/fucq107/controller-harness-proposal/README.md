# FUCQ-107 controller14 harness proposal

Historical proposal below. On 6 November 2026, independent delta admission passed and the dispatcher granted one exact run. The [scoped controller14 result](../controller-pass/README.md) records 14/14 PASS and read-only audit PASS; the dispatcher final independent audit subsequently passed 1,313 checks and accepted controller14 only. The earlier no-grant/unexecuted statements below describe the authoring checkpoint.

Author-only checkpoint with handled-cancellation repair, 6 November 2026. **Unreviewed and unexecuted.** The dispatcher has authorised the minimal authentication repair and this external supervisor/lifecycle repair, then a review freeze. There is no execution grant. No broader backend, renderer, mixed-producer, browser, native or full-suite work is authorised by this checkpoint. FUCQ-107 is not built.

The scoped product source is immutable `94e05ff9070aa19f5deb3e9997dfed96cc268473`: three JavaScript modules, four package metadata inputs, two application imports and two builtin imports. The controller source differs from the rejected `942c854` proposal only in the `unknown-principal` authentication branch and its saved-receipt regression. All original 13 cases remain, with one added case for authentication loss versus ordinary source unavailability. Exact 14 names and all seven source hashes are in `controller-94e05ff-source.json`.

## Diagnosis and repair

The rejected external supervisor observed only the launched leader, inherited a nonrecursive RSS probe that returned zero on uncertainty, removed scratch before independently proving descendant/group absence, and called a permissive ledger release before its strict final read. Its environment filter omitted some native loader variables, and its claimed reserve differed from the helper's actual 5 GiB. These are harness defects; the rejected proposal is retained unchanged as history and must not execute.

This proposal adapts the dispatcher-reviewed static FUCQ-115 resource/supervisor pattern at immutable `918ce04510fd327e860809e7de53bd636d1cf7da`. That reference does not confer review or runtime success on this adaptation. The dispatcher subsequently reported that the first 115 runtime attempt failed on macOS `lstart` trailing padding. Both 107 process parsers normalize that padding before strict start validation. Missing or malformed observations still fail closed.

The new lifecycle:

1. Require an externally reviewed admission SHA, isolated Python, the exact interpreter, all 30 frozen physical/content pins and the owned worktree before any custom helper import. Execute already hashed helper bytes. Recheck all pins before launch, before opening the gate and after cleanup; compare every product/input row with its immutable Git bytes before and after.
2. Use only the fixed environment in the admission. All ambient database, PG, GCSP, NODE, Python, debug, coverage and native loader variables are removed, including every `LD_`/`DYLD_` prefix, `LIBPATH` and `SHLIB_PATH`. Only owned TMPDIR/TMP/TEMP and the exact module-journal path are added for the child.
3. Establish the absolute scratch root and external ownership manifest, then register the finalizer before allocation. A minimal isolated Python launcher waits for one stdin byte. The supervisor records its PID/PPID/start/group and a recursive RSS sample before opening the gate; `execve` then hands that same PID/group to the exact Node test command. Recursive observations retain every relevant PID/start and process group, including uncertain observations.
4. Open only the existing frozen lock, read-only with `O_NOFOLLOW`, validate its descriptor and path identity, and take its bounded machine-wide flock. Strictly reject malformed/duplicate/nonfinite ledger data, invalid owners/accounting/roots/parents and cyclic ancestry before every mutation, update, cleanup authorization and release. Never prune another reservation. Bind the owned token, owner, root, disk, RAM and parent exactly and read back each write. A strict `vm_stat` probe rejects unknown host-memory headroom. Inherited permissive budget methods are prohibited.
5. Charge recursive child RSS plus supervisor and measurement-process RSS to 384 MiB. Charge scratch plus the **entire retained external FUCQ-107 directory**, including historical runs and proposals, to 128 MiB with 128 KiB receipt headroom. Stream the original combined stdout/stderr and module journal within a combined 2 MiB cap. One worker; 120-second execution chunk; explicit 5 GiB emergency disk reserve and 512 MiB host RAM reserve.
6. On success, failure or handled cancellation, stop exact observed identities, join the direct child and prove every observed PID/group absent. Validate the ledger/owned binding before destructive cleanup. Check root inode and open-file absence, repeat the process proof and root identity immediately before deletion, prove scratch absence, then release only the exact reservation with no descendants under the strict lock. Unknown states retain a named scratch/reservation issue. The shared helper is unchanged and its automatic Scratch teardown and permissive budget APIs are unused.
7. Preserve original TAP/names/counts and the complete module journal. Require all 14 cases, zero failures/skips/cancellations/todos and the exact three-module/four-edge graph. The separately pinned auditor runs only after supervisor exit, reparses original evidence, checks every recorded identity/group and supervisor absence, validates the ledger without mutation, checks reservation/descendant and scratch absence, and verifies current/immutable source plus Node/helper pins. No automatic repair or retry.

The owned adapter diff against the immutable 115 resource file is included. Besides 107 sizing and the padding fix, it adds non-creating inode-checked lock acquisition, strict host-memory parsing, immutable reservation accounting binding, descendant guards, pre-deletion ledger admission, repeated root identity checks, unknown first-registration retention and prohibited inherited budget methods. The controller supervisor and independent auditor are new owned adaptations. A parser prefix check on a grant string is only an invocation guard; external dispatcher authorisation remains mandatory.

## Handled-cancellation handoff repair

The dispatcher review of publication `06a2c149bba6e323d73ade3dec6675bb8783d123` found a concrete gap between supervisor-local `Popen` return and `tree.register`. A handled cancellation in that gap could leave a gated Python child outside the tree while the no-process branch reported absence. The previous admission `5ec65398ba26f07f966cb843c68553a91e3b2e7594769423d78e9a3e23b28261` is superseded and must not execute. The original published files remain available at that immutable commit.

The minimal owned repair changes the resource adapter, supervisor and independent auditor:

- `ProcessTree.launch` records launch intent before starting and assigns the returned `Popen` directly to the tree. SIGTERM/SIGINT handling is deferred only across that single launch call and in-memory handle retention; identity probes, manifest writes and full registration occur outside that handoff. Pending cancellation then propagates with the handle already retained. The child gate remains closed.
- The direct observation begins with unknown start, PPID and PGID. Full registration validates its actual parent and new-session group before storing the OS-observed identities. PID equality is a checked expectation, never a substitute for an observation.
- An attempted launch without a returned handle, or a retained child with incomplete registration, cannot produce a successful joined/PID/group absence proof. For the latter, cleanup stops and joins the actual unreaped direct `Popen` handle before any potentially failing evidence write or descendant probe; TERM/wait and KILL/wait each have a three-second wait bound. Signals received during that direct cleanup are recorded and deferred. Incomplete identity evidence retains the named scratch/reservation after the direct child has been joined.
- The supervisor recovers the tree-owned handle for pipe closure even if cancellation prevented its local assignment. The auditor additionally requires launch-attempt, returned-handle and completed-registration evidence before accepting cleanup. Existing exact source14, module journal, budget and identity checks remain.

`controller-94e05ff-cancellation-handoff-repair.diff` is the exact three-file delta against06a2c14. This proposal has not exercised cancellation or launched any child. The new admission is `6dfe2623e3ac0ece6b352abdb336cab59a29a7d535c270a4c68973bf321d6a27`; independent review and a new explicit grant are still required.

## Review surface and exact freeze

The authoritative execution proposal lives under:

`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/controller-94e05ff-*`

The adjacent committed files are byte-identical review copies. Runtime pins name the external originals and this worktree, not these copies. Moving, regenerating or editing them requires a new freeze/review. The product/input pins remain on 94e05ff even when this evidence-only publication changes HEAD.

| File suffix | SHA-256 |
|---|---|
| `admission.json` | `6dfe2623e3ac0ece6b352abdb336cab59a29a7d535c270a4c68973bf321d6a27` |
| `source.json` | `bf9b0638f69c923efc16c8fa4a62ebc77698d4ed159523f26e971bc28ef42a68` |
| `node.json` | `0e7261d7c74fb4048118f2c78403ab00bda93ef51ce7d3f51a5c30576460bd10` |
| `loader.mjs` | `e349c7fe5e7b92108f5d3edcb6ba986f3f1d1847004425bb928d564a689515ec` |
| `launch.py` | `a6c4a36082fc30365f551176b80a60330e57c102ee592193b8fddb0289f7738f` |
| `resources.py` | `1c19f35495cd5a186dfcb75490a314814a9b37be594acaa51dcfbdcfae445790` |
| `supervisor.py` | `a065e2f38318f3dcd1053a8e4439fcd88ac2b42199b9531c85723f58426ce147` |
| `audit.py` | `a3116175602b7a12f1acc51e323bedb932a329a081b509cf3320bed07662d76f` |
| `freeze.py` | `f4afb55b2bd5d5964fe5b8101a9539645b0b9b903eb14b9f77d0ae05cb9fcd36` |

The admission lists the exact source graph, expected names, environment, interpreter, helper/executable identities, physical lock, limits and commands. Its status remains `proposal-awaiting-independent-review-and-new-execution-grant`. No installed package is required, imported, copied, linked or installed. Existing metadata and Node identities are frozen without launching Node.

## Author verification and outstanding evidence

`controller-94e05ff-author-static-review.json` records **45 author metadata checks plus 10 static handoff-structure assertions**: 30 physical/content identities, five Python AST parses, seven immutable/current source comparisons, the two-path authentication-only source delta, 14-case freeze and seven-row/four-edge closure. The additional structural assertions check the owned Popen assignment, short signal-deferral scope, unknown initial identities, partial-registration refusal, direct-child stop/join ordering and auditor gate; these are source inspections, not runtime cancellation proof. The stdlib metadata freezer was run. No proposed resource helper, launcher, supervisor or auditor was imported/executed; no Node, controller tests, OS process probes, host reservation or scratch allocation was performed. JavaScript execution and runtime cleanup remain unproved.

Accepted backend service evidence remains **12/12** for old source1683932, published separately in `../scoped-service-pass/`; it does not cover the later unexecuted renewal/historical-slot correction at `17e7fe1`. Prior policy7/7 is separate unchanged-graph evidence and is not a combined run. The 14 controller cases are independently accepted; the separate nine renderer cases remain unexecuted. Canonical103 source registration is independently accepted at `f80fc61`; runtime registration, safe102 entry, actual105/106/102/100 composition, allocation/tick, evaluation/wait/no-match, browser/visual and full integration gates remain open. No shared lane, Jira record, producer source, shared helper or product-map status changed here.

Agents: Lego Batman lead requested/selected Sol (`gpt-6.1-sol`)/high, no fallback; Baymax's earlier completed scoped work remains Luna/high as previously verified. No new agent was launched for this harness repair.
