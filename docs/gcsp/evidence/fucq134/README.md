# FUCQ-134 first chunk review package

Authoring checkpoint, 6 November 2026. No execution grant has been consumed. No
JavaScript import, test, OS proof, HostBudget reservation or test scratch allocation
has occurred. This package is incomplete implementation evidence, not acceptance.

## Frozen scope

- Base: `034b56d08fb742d31478218b670552805d5840ab`.
- Published real66: `eb5a677b37c486e3da7c4547803f739e22df8ac3`.
- Admission SHA-256: `354fbe5b69d469f5a9a61c0ce67fa1cb77ea8950e5cc8e4d93aef496b578a965`.
- Composed source identity: `7a982714de7cf74968cabcfbe3712be2ff4c3fe75cf95acda3381044cffa4a82`.
- 45 embedded source/data files, 971783 source bytes, 230 physical identities,
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
/usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-supervisor.py --plan --admission-sha 354fbe5b69d469f5a9a61c0ce67fa1cb77ea8950e5cc8e4d93aef496b578a965
```

Only after an explicit new grant, replace `--plan` with `--execute` and append:

```text
--dispatcher-grant fucq134-first-chunk-354fbe5b69d469f5a9a61c0ce67fa1cb77ea8950e5cc8e4d93aef496b578a965
```

The argument records a grant; knowing the argument is not authorization. Selection
is exactly `isolation`, `real-claim-review-allocate`, `untaken-expiry` from the
new current-route test. The gated launcher imports that module directly, using
Node's in-process test execution, and enforces three exact TAP names/counts.
The frozen Node26 synchronous import hook and this direct test-launch behavior
remain unverified runtime seams until the granted run. No upstream tests repeat.

## Ownership and limits

- One worker, 120 seconds, 768 MiB aggregate recursive RSS including supervisor,
  128 MiB combined scratch/retained output and 2 MiB combined stdout/stderr log.
- Fresh actual HostBudget reservation; at least 2 GiB host disk free and measured
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

Static checks only: three Python AST parses, JSON parses and complete explicit
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
