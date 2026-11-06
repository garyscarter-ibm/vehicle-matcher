# Independent-review repairs for the six HTTP cases

6 November 2026. **Authored and statically checked; HOLD retained; no execution.**
This replaces the planning identity for the six cases, preserving the earlier accepted controller
and browser evidence and the separate C5 proposal. No product file or shared resource helper changes.

**Latest narrow follow-up:** [scratch-absence authoring repair](http-absence-authoring-2026-11-06.md)
replaces the proposed helper's ambiguous lexists absence check after review of `8ca2162`.
Its validation is text/hash/Git metadata only; no new AST, syntax or runtime execution occurred.
The earlier validation record below belongs to the preceding checkpoint. HOLD remains.

## Decided diagnosis and source basis

Claude's independent report is
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/reviews/fucq126-claude-review-2026-11-06.md`:
11,779 bytes, SHA256 `7bb9ed97476951bdc12ba43a217e5df740c28a6d67b10bd3f7bcbe7ee132c216`.
Its exact bytes were verified. It reviews `5adba2e`, including the physical candidate manifest
`efdb32a33413919315b4dbcc9a09c6b5e5be0d27602b1a9c2d8ac51801b84437`.
The report's HOLD findings agree with the current source; no second review or reproduction ran.

Diagnosis: default-enabled controls can satisfy the old ready predicate before controller
authorization; `start()` then drops the first action while busy. Ambient DEMO_ACCESS_KEY is an
independent request gate. The resource helper's owner-only reaping, permissive ledger reads,
zero-on-uncertain RSS and untimed final wait remain in the pinned shared helper. The supervisor's
old timing, manifest/environment binding and output path need corresponding owned repairs.
The next checks are coordinator adoption/compatibility review of the helper patch, replacement
source refreeze and independently admitted execution. No Jira changes are authorized or made.

## Authored repair coverage

| Finding | Authored response; behavior remains unexecuted |
|---|---|
| H1 | Ready requires visible controller root, aria-busy false, loaded `Tick (` label and enabled Tick. Every click requires a visible, idle root. |
| H2 | Harness saves/deletes/restores DEMO_ACCESS_KEY; supervisor strips it and option/database/GCSP/resource injection from the child environment. |
| H3 | Removed self-comparisons of runtime properties. Reset checks nonempty fresh stock and actual acting principal/roles against the issued presenter. No runtime-object identity proof is claimed. |
| H4 | Deterministic producer invalidity is asserted in the actual nested outcome and interrupted tick. The clock's retryable outer interruption remains product behavior. |
| H5 | Refusal waits require visible, idle root and enabled Retry before finishing. |
| H6 | Case 3 now names only exhaustion of the offered isolated TEST window. Case 6 names actual presenter-cookie renewal and old run-bound TEST-provider refusal. |
| R1 | Supervisor persists a pending launch before Popen and binds exact PID/start/group into the future helper's reservation. Guard adds HUP and deadline-signal handling while preserving creation/registration/cleanup deferral. Shared reaping repair is supplied, unapplied. |
| R2 | Exact shared-helper patch reads one bounded regular ledger descriptor while holding the stable shared lock, rejects corrupt/unreadable/duplicate/cyclic data and preserves foreign rows. Only missing ledger means empty. Unapplied. |
| R3 | Supervisor refuses uncertain RSS after charging the full RAM reservation. Helper patch returns None on incomplete/failed ps and adapts its generic caller. Unapplied helper is an explicit blocker. |
| R4 | Entry establishes one 120-second deadline: at most 90 seconds for admission/source checks, work and postprocessing; at most 30 seconds for finalization, bounded by the same absolute deadline. Hashing/traversal/coverage parsing check remaining time. Alarm covers work/finalization; guard defers it through ownership-critical sections. Future stop/join uses bounded waits. |
| R5 | Launcher requires the explicit SHA256 of the final admitted manifest. It hashes/parses one bounded byte buffer, checks the manifest again with source passes, and records the hash in ownership and receipts. Flags/output edits require a new admitted hash. |
| R6 | Manifest pins the machine-wide host registry; HostBudget receives that explicit directory. Unexpected inherited parent reservation refuses admission. Resolved ledger path is recorded. |
| R7 | Shared-helper patch adds bounded open-file absence before scratch deletion, preserving scratch on uncertainty. Exact child/group cleanup still precedes teardown. Unapplied. |
| R8 | Owned signal scope and allocation finalizer are armed before the first ownership/output write. Removed pre-finalizer headroom probe. Partial creation retains named external evidence and any charge. |
| R9 | Combined stdout/stderr uses a pipe drained into a capped 2 MiB TAP file. Excess data stops the child without writing the excess to disk. Failure retention avoids duplicating an already retained TAP. |

The pipe handles created by Popen close even if registration fails. The accepted guard's local-handle
cleanup, PID/start/group verification, deferred cancellation and retention on uncertainty remain.
Signal and cleanup code has only been source/AST checked; no cancellation or pipe fault was injected.

The alarm/deadline is supervision rather than an OS quota. Bounded stop/verification can finish
after a deadline signal was deferred in a critical section; that cannot produce a passing receipt
after the chunk deadline. Incomplete finalization leaves the previously persisted ownership and
pending/bound child charge for reconciliation. Scratch allocation is sampled, and a burst can exceed
its sampling threshold; no native filesystem quota is claimed.

## Exact coordinator patch and remaining shared-helper gap

[shared-resource-contract-review-repair-2026-11-06.patch](shared-resource-contract-review-repair-2026-11-06.patch)
targets only `_tools/test_resources.py`, exact base SHA256
`3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d`.
Its [receipt](shared-resource-contract-review-repair-2026-11-06.json) pins the patch and resulting
bytes. [author-resource-contract-patch.py](author-resource-contract-patch.py) constructs the delta
in memory, requires that exact baseline and AST-parses the result without importing it. The patch
uses zero-context unified hunks; a Git-based application requires `--unidiff-zero` and exact base
verification. No patch was applied to any shared helper.

The patch adds RESOURCE_REVIEW_CONTRACT 1, strict reservation operations and begin/bind/cancel-launch
methods. Dead-owner rows remain charged while scratch, a pending launch, a recorded child/group
or uncertain state remains. Comparing the complete row after outside-lock probes protects concurrent
bindings. Release requires the caller's ownership and resource absence. Legacy rows lacking the new
evidence remain charged for explicit reconciliation. The stable `reservations.lock` is retained across
atomic ledger replacement; the bounded ledger descriptor is opened/read under that lock.

The coordinator owns adoption and compatibility validation across shared callers/harnesses. An old
unpatched helper can still rewrite the common ledger. The generic helper's separate Popen-registration
gap remains outside this126 launcher, which uses its own cancellation-safe guard. Those limits are
listed in the patch receipt and must not be represented as a completed shared rollout.

The [replacement physical freeze](http-physical-candidate-review-repair-2026-11-06.json) still pins
the actual unchanged helper. Its required adopted-helper hash is null and the supervisor refuses
allocation without the new contract and a subsequently pinned adopted helper. Both admission flags
remain false and outputRoot is null. Coordinator adoption must be followed by a new exact source freeze
and independent review; this manifest does not substitute proposed patch bytes for physical files.

## Acceptance boundaries and future validation

The replacement pins 140 source/data/helper/reference files and all 1,975 installed dependency files,
267 literal edges and 29 statically classified read/import sites. The nine protected presenter/product
leaves, all44 canonical adoptions, dependency links and installed files retain their earlier identities.
The original freeze, authoring generator, accepted results and C5 proposal remain historical bytes.

The six cases continue to use actual HTTP/controller/service behavior with bootstrap-derived TEST
stock and preserved identity-only facts. Case 3 covers only its offered window. Case 6 covers actual
mechanical reset/cookie/context plus refusal by the same lifetime run-bound TEST provider; it proves
no positive new-run supply or business-preparation contract. C5 is separate and does not block the
six independent cases. Browser/native/full lanes, paused96 and the six business gates remain held.

Future validation must first establish the adopted helper's reservation survival, corrupt/unreadable
ledger preservation, failed/malformed ps handling, bounded join/deadline paths, open-file retention,
launch/registration cancellation, manifest/environment binding and capped output. These checks need
their own explicit admission and owned budgets. Then independently admit the six named HTTP cases;
require original TAP names/totals, actual V8 modules, source identity and independent resource cleanup.
No unchanged accepted matrix rerun or full-suite stamp is implied.

Current validation is limited to source/metadata hashes, exact patch reconstruction in memory,
Python AST/JSON, source graph and named-path whitespace. No Node/product import or syntax command,
test, process/ledger/lsof probe, browser, scratch or reservation occurred. Product UI bytes are
unchanged, so this checkpoint makes no new visual acceptance claim; the experience contract and
COMPONENTS.md remain binding for any future visible change.
