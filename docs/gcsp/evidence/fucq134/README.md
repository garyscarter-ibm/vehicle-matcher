# FUCQ-134 first chunk review package

**Repaired static freeze pending dispatcher delta admission. No execution grant.**

Authoring checkpoint, 6 November 2026. No execution grant has been consumed. No
JavaScript import, test, OS proof, HostBudget reservation or test scratch allocation
has occurred. This package is incomplete implementation evidence, not acceptance.

## Frozen scope

- Base: `034b56d08fb742d31478218b670552805d5840ab`.
- Published real66: `eb5a677b37c486e3da7c4547803f739e22df8ac3`.
- Admission SHA-256: `970a2b8c8080b88c25651c604c8fc6bb30e639ed95de6c060da07d353911de6c`.
- Composed source identity: `7a982714de7cf74968cabcfbe3712be2ff4c3fe75cf95acda3381044cffa4a82`.
- 45 embedded source/data files, 971783 source bytes, 236 physical identities,
  14 installed packages. Embedded immutable blobs permit checking the complete
  source content before custom resource-helper imports. Installed dependencies
  remain in place; only the owned scratch mirror links to them, read only.

`first-chunk-admission.json` contains the complete source texts, source hashes,
physical executable/helper/dependency identities and installed metadata.
`first-chunk-freeze.py` builds this artifact using only static reads/hashes and the
pinned Git adapter. Re-freezing changes the reviewed identity and requires review
again. Committing or moving this package does not grant execution. Physical pins
make it intentionally specific to this machine and checkout.

`first-chunk-resources.py` adapts the reviewed resource pattern from
`918ce04510fd327e860809e7de53bd636d1cf7da`, in an owned file. It uses a strict shared
HostBudget ledger, retains unknown process observations, signals exact PID/start
identities and refuses deletion/release when absence is uncertain. It does not
modify `_tools/test_resources.py`.

## Proposed command, not yet run

The dispatcher first reviews the exact freeze and helper bytes. This plan-only
command checks identities without importing custom helpers, allocating resources,
querying OS process state or importing JavaScript:

```sh
/usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-supervisor.py --plan --admission-sha 970a2b8c8080b88c25651c604c8fc6bb30e639ed95de6c060da07d353911de6c
```

Only after an explicit new grant, replace `--plan` with `--execute` and append:

```text
--dispatcher-grant fucq134-first-chunk-970a2b8c8080b88c25651c604c8fc6bb30e639ed95de6c060da07d353911de6c
```

The authorized execution must use an independent parent to retain the actual
controller exit status and immediately audit its bounded stdout ticket. This
proposed shell command has **not** run; it captures at most8KiB from the reviewed
controller and creates no ticket file:

```sh
if fucq134_completion_ticket="$(/usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-supervisor.py --execute --admission-sha 970a2b8c8080b88c25651c604c8fc6bb30e639ed95de6c060da07d353911de6c --dispatcher-grant fucq134-first-chunk-970a2b8c8080b88c25651c604c8fc6bb30e639ed95de6c060da07d353911de6c)"; then
  fucq134_controller_exit=0
else
  fucq134_controller_exit=$?
fi
printf '%s\n' "$fucq134_completion_ticket" | /usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-completion.py --audit --controller-exit "$fucq134_controller_exit" --admission-sha 970a2b8c8080b88c25651c604c8fc6bb30e639ed95de6c060da07d353911de6c
```

Completion requires controller exit0, the independent audit's bounded `complete`
stdout **and audit exit0**. Parent output alone cannot pass after a late audit
failure. The caller retains both statuses and that output as its final receipt.
No controller/audit error, absent ticket or delayed audit permits a retry or
completion claim. On-disk receipt/checkpoint remain provisional and incomplete;
the parent does not rewrite them to account for their own writes.

The argument records a grant; knowing the argument is not authorization. Selection
is exactly `isolation`, `real-claim-review-allocate`, `untaken-expiry` from the
new current-route test. The gated launcher imports that module directly, using
Node's in-process test execution, and enforces three exact TAP names/counts.
The frozen Node26 synchronous import hook and this direct test-launch behavior
remain unverified runtime seams until the granted run. No upstream tests repeat.

## Ownership and limits

- One worker, 120 seconds metered across phases, execution stops at110 seconds
  to leave10 seconds for ordinary cleanup, 768 MiB aggregate recursive RSS including supervisor,
  128 MiB combined scratch/retained output and 2 MiB combined stdout/stderr log.
- Every meter reserves64MiB RAM and1MiB disk **inside** those caps for final
  serialization, all three atomic temporary files, bounded ticket/parent output
  and the sequential parent audit. Final manifest/receipt/checkpoint limits are
  64/64/8KiB; ticket/parent stdout limits are8KiB each.
- Fresh actual HostBudget reservation; at least 5 GiB host disk free and measured
  shared RAM headroom. Unknown ledger/process/capacity state refuses progress.
- Scratch: story worktree `.claude/test-scratch/fucq134/fucq134-<token>`.
- External manifest: shared `.claude/test-runs/ownership/fucq134-<token>.json`.
- Retained checkpoint, original bounded log and receipt: shared
  `.claude/test-runs/fucq134/first-chunk-<run>/`.
- Finalizer registered before reservation/scratch creation. All exits stop and join
  children, prove known PID/start identities and groups absent, check open files
  and root inode/device, delete only owned scratch, then prove reservation absence.
  Unknown states retain exact named leftovers and their reservation.

The outer command uses an empty environment before Python starts. The child also
receives an allowlist and owned TMPDIR/TMP/TEMP. The guard patches egress,
listeners, native loading, workers and subprocess APIs before product imports;
resolved file imports must match frozen hashes. It retains module-load hashes in
TAP comments. No database URL, live run or secret is read. No install, native,
listener, network, browser, corpus, full-suite or large-output execution is granted.

## Evidence and remaining work

Static checks only: four Python AST parses, JSON parses and complete explicit
relative JS import edges. The freeze builder verified stored Git blobs and all
installed file bytes against the earlier source graph. The supervisor itself has
not run, including `--plan`. No test result is claimed.

The harness creates a new memory store, trusted identity contexts and simulated
clock, seeds explicitly fictional records, uses actual66 claim/review/allocation
and expiry unchanged, and exposes CapturedTransport. The isolation expectation
compares a separate in-memory sentinel before/after, without accessing a live demo.
Synthetic driver/insurance/spec facts have typed units and provenance; equipment
and ISOFIX stay unknown. The authored fixture records expected mechanics states,
not computed comparison outcomes or constructibility evidence.

The shared evaluation cache/full-pool projection, release/access/conflict replay,
underlying-needs/70-threshold acceptance, deterministic outcomes, canonical
missing-only policy adoption and final composed/full validation remain open.
The inactive proposal is an explicitly selected PolicyService test variant only.
All six story acceptance boxes remain unchecked. Backend only; no screen.

Review point: admit this exact composed source/guard/resource boundary before the
first three-case run. Root retains queue, claims, Jira, merges, acceptance closure,
shared full-suite/native/browser grants and heartbeat. No descendants were launched.

## Superseding launch-ownership repair

The admission above supersedes the authoring freeze in checkpoint82df084.
Dispatcher's static107 review found the inherited115 Popen-to-registration gap;
no134 run or observed134 failure occurred. The owned ProcessTree now persists a
creating intent before Popen and defers handled SIGTERM/SIGINT through direct
handle assignment, PID/start registration and persistence. It re-raises deferred
cancellation only after registration. An unresolved launch or conflicting handle
cannot certify process absence, so Finalizer cannot delete scratch or release
its reservation. Supervisor cleanup recovers the tree's retained handle even if
the launch call was interrupted before returning it to the local variable.

Validation remains static AST/JSON/hash/diff inspection only. No cancellation
reproduction, JavaScript import, supervisor plan/proof, reservation, scratch or
test execution was authorized or performed. Product/test source identity remains
unchanged; helper/graph/admission hashes changed and require renewed review.


## Original review and repaired delta

Dibble's independent review of90a8b8c/cd24455a admitted the original45-source,
72-edge composition separately and held execution for three resource issues.
That source composition is reused unchanged; no runtime proof was accepted or run
for134. The repaired package batches exactly those findings:

- Policy and admitted limits now retain the existing5GiB free-disk reserve.
- `/bin/ps`, `/usr/bin/vm_stat` and `/usr/sbin/lsof` have exact binary-content,
  physical and ancestor pins checked before custom resource-helper imports.
- Snapshot, persistence or fallback signalling failures enter a finally that
  attempts bounded direct-child terminate/kill/wait without manifest writes or
  OS snapshots. The original failure remains fatal; no failed telemetry or
  uncertain process state can authorize scratch deletion/reservation release.

The new admission contains235 physical identities and unchanged45 embedded
sources/971783bytes. Its product/test code identity remains unchanged. Static
Python AST, structural cleanup-ordering, JSON, hash, source-reuse and diff checks
only; no helper/probe/Node/supervisor/test execution or allocation. The freeze
builder performs static reads/hashes; it did not execute the three probe binaries.

Root requested this clean checkpoint for delta admission. The proposed command
above now names the superseding freeze, but remains unexecuted. Review the owned
resource adapter, freezer, supervisor and admission delta before any new grant.


## Full-row ownership and phase accounting repair

Independent immutable11c7ab1 review passed the preceding three resource repairs,
and held two further issues. This superseding helper-only delta addresses them:

- StrictBudget retains a deep copy of the complete expected reservation row,
  including capacity, parent and previous used/RSS telemetry. Every update and
  release validates the complete previous row under the pinned physical lock,
  verifies readback, then retains the next expected row. Immediately before owned
  deletion the same lock covers exact-row validation, root inode/device recheck
  and removal; uncertain or changed rows refuse deletion and retain scratch.
- The single meter starts before initial admission and covers setup, verification,
  execution and cleanup. All ProcessTree snapshots use it; RSS includes supervisor,
  recursive known children and probes, plus a conservative process high-water
  bound. Combined scratch/retained/manifest bytes, elapsed time and peaks remain
  in the retained receipt. Source-pin verification occurs while the reservation
  is still held. No resource verification is deferred until after release.
- vm_stat and lsof use cancellation-safe tracked probe handles, bounded outputs
  of128KiB and respective3/5-second probe deadlines. Their loops take metered ps
  snapshots; snapshot deadlines respect the remaining120-second budget. Probe
  PIDs/start/groups and joined states remain in the ownership manifest. The
  ordinary execution budget is110 seconds, leaving10 for cleanup.

Every probe and main-child failure path attempts bounded direct-handle stop/join
before metering or persistence can fail again. Incomplete ownership, accounting
or process proof prevents deletion/release and reports named leftovers; mandatory
stop/join still runs if the meter reaches its deadline. Receipts retain actual
elapsed time and failures rather than claiming an overrun stayed within budget.

Static AST/JSON/full-row/deletion/probe-cleanup ordering, pin hashes and unchanged
source checks only. No edited resource helper, OS probe, Node, supervisor plan,
reproduction/test, reservation or scratch has run. All45source/72edge composition
and three-case selection remain accepted separately and unchanged. This package
requires a new dispatcher delta admission and execution grant.

## Final-output completion delta

Immutable2dd62e4 review passed full-row locked binding/deletion and identified one
remaining tail: final manifest/receipt/checkpoint writes followed the last meter.
Only that completion boundary changes here. Accepted ledger/direct-join/pin code,
45-source/72-edge composition and three mechanics cases stay unchanged.

`first-chunk-completion.py` is an owned, admission-pinned helper. Before encoding,
it limits all three payloads together to4096 JSON nodes, depth16,16Ki codepoints
per string and64Ki codepoints total,64-bit integers and finite floats. They are
preencoded once into64/64/8KiB maxima, then written once via exclusive, named
atomic temporary files. Existing targets plus all temporary/encoded bytes fit
within the explicit1MiB disk/64MiB RAM reserves. Encoding/write/budget errors leave
the existing incomplete checkpoint and any exact named leftovers; there is no
fallback rewrite or retry.

Finalizer returns its final record for that bounded write. The shared meter
checks RAM/disk/time before encoding, before writing, after each write and after
ticket stdout flush. The files claim only a candidate result. The separate
parent audit requires the actual controller exit0, the admitted helper hash,
matching bounded file hashes/sizes, exact retained inventory with no atomic
temporary files, owned scratch absence and consistent provisional result. It
checks actual retained allocation/free space, its own RSS within the reserved
64MiB and the same120-second start-to-audit deadline, including final stdout.
Unknown resource/write/audit state stays incomplete without recursive receipts.

This is authored static evidence only. AST/JSON/ordering/source/pin checks and
static freeze generation do not execute these helpers, supervisor, probes or
tests. A new immutable delta admission and explicit execution grant remain due.
