# Isolated resource authoring for the six HTTP cases

6 November 2026. **HOLD; source-only authoring; unexecuted.**

**Current follow-up:** [cleanup/query reserve and source-pin repair](http-cleanup-authoring-repair-2026-11-06.md)
supersedes this checkpoint’s wrapper/supervisor bytes after Granny’s LOW-effort HOLD review.
This page and its receipt retain the original source identity and proof limits. The shared patch is not adopted.
This is the current resource route for the existing FUCQ-126 claim, replacing the shared-patch
dependency at `a5b50abd3880b181916d313c8b9c0b73dbbd39cc`. It changes no product, UI or business scope.

## Diagnosis and decision

The collected independent readiness review is
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/results/claude-assist-fucq126-2026-11-06-01.md`,
SHA256 `732756a21acd6f36b87d478c9ee683ff47e35ce6f2a5fb67e802ae80e0772059`.
The proposed shared patch adds row fields that exact seven-key launchers reject (A1), changes
existing caller semantics (A2), targets a vendored copy without the upstream version/rollout (A3),
and would invalidate live frozen grants (A4). It must not be applied. These findings are avoided
by this isolated route, not repaired in the shared helper or fleet.

The [story-owned wrapper](strict-http-resources.py) adapts the reviewed FUCQ-103 `Budget`/`Tree`
source from DEV-066, SHA256
`1e128d8d538b3d6ac9255adec1d2c8e05e9707ad66e965dd74ca0462f4b1231c`.
The shared `_tools/test_resources.py` remains unchanged at
`3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d`.
The wrapper uses its policy and atomic-JSON utility, without shared HostBudget, process, RSS,
stop/join or scratch-cleanup calls. The existing cancellation-safe Node guard remains exact.

## Authored resource contract

- Read every raw ledger row under the stable, physically anchored lock. Open no-follow,
  nonblocking descriptors, require a bounded regular ledger, reject duplicate/nonstandard JSON,
  unknown owners/accounting/ancestry and every schema except the seven keys
  `owner, disk, ram, used, rss, parent, root`. Missing or unreadable ledger means refusal.
- Account for ALL rows, without owner-PID pruning or foreign-row deletion. Write only the owned
  token change and compare the complete ledger on readback, including every foreign row.
  Record reservation intent before a potentially ambiguous atomic write/readback. Preserve the
  exact supervisor start-string spacing used by the unchanged helper; normalize only tree comparisons.
- Keep pending launch and PID/start/PGID records in the external scratch ownership journal.
  Preserve the guard's handled-cancellation deferral across Node creation, identity and registration.
  Its actual Popen handle remains responsible for cleanup even when registration/persistence fails.
- Own strict recursive process/RSS observations and exact PID/start signaling. Failed or malformed
  observations fail closed; attempted telemetry charges the full RAM reservation before stopping.
  Uncertain ownership remains sticky and blocks scratch deletion and reservation release.
- Bound process waits and OS queries with the same absolute chunk deadline. Query Popen creation
  and cleanup also defer handled cancellation, retain direct join handles and journal their intent.
  Query outputs are capped and not persisted; unknown query start identities stay explicit and
  require direct-handle joining plus group absence. Failed query cleanup remains recorded.
- Require joined child, recursive PID/group/observed-port absence, query cleanup, the same physical
  scratch inode and a bounded successful open-file absence query before deletion. Require definite
  `lstat`/canonical-directory-parent absence after deletion and before release. Lookup errors retain
  the charge. Direct child joining is attempted independently of journal/probe failures.

The wrapper deliberately rejects uncertain state. This authoring is not proof that its new paths
work on this host. The 120-second total, 90-second work/30-second finalization split, one worker,
768 MiB RAM, 128 MiB combined disk, 124 MiB scratch, 4 MiB retained output and capped 2 MiB TAP
remain the selected limits. Existing manifest binding, environment scrub, allocation finalizer,
source verification, original TAP names/totals and actual V8-module requirements remain.
These are supervision/sampling limits, not an operating-system quota or an uninterruptible-I/O guarantee.

## Exact current candidate and proof limits

The [replacement candidate](http-physical-candidate-isolated-2026-11-06.json) pins the wrapper,
supervisor, static preparation source and unchanged shared helper. It removes the patch generator,
patch and patch receipt from the execution input set while preserving those historical files.
It carries forward 138 source/data/helper/reference pins, 1,975 dependency pins, 267 literal product
edges and 29 read/import classifications. Dependency pins, membership, links and Node identity are
carried forward from the prior freeze, **not freshly collected or revalidated**.

The [exact source receipt](http-isolated-resource-authoring-2026-11-06.json) records the current
pins and this authoring scope. The preparation source was edited as text and was not run.
Validation here is source reading, text comparison, hashes, JSON and Git metadata/whitespace only.
No reviewed-code import, AST/syntax check, Node, test, signal fault, process/RSS/lsof probe,
ledger read/write, collector, browser, listener, native database, scratch or reservation ran.
No descendants or new execution grant were created.

The earlier 2,216-check receipt still belongs to `8ca2162`; root's 936-check static absence receipt
still belongs to the `a5b50ab` follow-up. Their exact files/pins remain unchanged. Neither is new
validation of this wrapper. Accepted controller/browser evidence, shell references, COMPONENTS.md,
the FUCQ-64 body, C5 proposal, pauses, foreign claims and business gates are unchanged. No new
visual acceptance claim applies to this resource-only change.

## Outstanding findings and review inputs

| Original finding | Current status before independent review/execution |
| --- | --- |
| H1–H6 | Earlier harness repairs preserved byte-for-byte; semantic independent review and the selected six-case run remain outstanding. |
| R1 | This wrapper never reaps, journals child state externally and preserves guarded local-handle cleanup. **Fleet-wide dead-owner reaping remains open** below. No SIGKILL survival claim is made. |
| R2 | Strict seven-key ALL-row no-follow ledger operations and full foreign-row readback authored; independent wrapper review and admitted failure-path evidence remain outstanding. |
| R3 | Recursive strict RSS with fail-closed uncertainty authored; no failed/malformed-query path was executed. |
| R4 | One deadline, bounded queries/stop/join and finalization authored; deadline/cancellation proof remains outstanding. |
| R5, R6, R8, R9 | Manifest hash, explicit host registry, pre-allocation finalizer and capped TAP repairs retained; fresh host anchors and admitted validation remain outstanding. |
| R7 | Owned open-file/inode/definite-absence finalizer authored; open-file retention/deletion/release proof remains outstanding. |
| A5 | An unpatched launcher elsewhere can still reap this token after the supervisor dies while its child or scratch survives. Only coordinated upstream release, fleet vendoring and per-story refreezing close this risk. |
| A6 | Generic shared `run_process` Popen-registration gap remains outside this route; FUCQ-126 uses its own exact cancellation guard. |

Review the new wrapper, supervisor integration and preparation delta together with the unchanged
H1–H6 harness, transport helper, guard, complete source graph and static classifications.
The candidate's flags remain false, `outputRoot` is null and host directory/lock anchors are null.
Before any execution, the coordinator must collect fresh strict ALL-row host/physical evidence,
admit an absolute external output/impact/ownership plan and the final manifest hash, and independently
review this replacement. A later run must retain original TAP 6/6, actual V8 modules, unchanged
source identity and independently collected cleanup. No unchanged matrix rerun is requested.

The delivered C5 host, positive new-run supply, six atomic business preparations, browser/native/full
lanes and paused96 remain separate and unchanged. No Jira or backlog change was made.
