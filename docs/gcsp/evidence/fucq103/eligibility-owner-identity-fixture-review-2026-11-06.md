# Owner identity fixture packet — source review, 6 November 2026

The isolated fixture packet is **not admitted for execution**. Its outer
supervisor does not establish the required resource and process ownership proof.
No fixture, application case, runtime admission, reservation or scratch allocation
was executed. The conditional one-time grant remains unused.

The reviewed product/resource source remains published at
`ba1cf318ea1c19503b5e95e0cd5687a71a819738`. This document adds source-review
evidence; it does not validate execution of the repaired guard or revise any
historical result.

## Finite selection

The private driver defines twelve positive cases covering single-digit and
two-digit raw/normalized starts; refusal of malformed dates, malformed RSS,
duplicate PIDs and an unknown supervisor start; normalized PID replacement;
both reservation and scratch owner writers; unchanged legacy `process_alive`
matching/replacement comparisons; and foreign-row accounting, preservation on
update/release and invalid ancestry refusal.

The fixture loads the exact guard/helper bytes only after its outer admission.
Its OS calls, locks, ledger streams, headroom and writes are private in-memory
stand-ins. It does not call legacy `_dead_owners` or `HostBudget` against the
machine ledger. These assertions would establish synthetic format compatibility;
they cannot establish an actual cross-launcher lifecycle event.

## Exact packet

All runner, plan and raw review artifacts remain under ignored `.claude`.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Local plan | 34,185 | `c5ac7e0a1a8046e3c8aca733062f99ca87af9ae6706322fcb78cf207fcbd85ae` |
| Outer supervisor | 18,917 | `49f88f5ad5059374a952e4f2b9956c0351bade00779e07c6ec0933fd53d937ea` |
| Fixture driver | 8,753 | `ba9ff03d2b9c03e7f92f172647717842e52b3519310db9d2c090600504cbb023` |

Independent and parent byte comparisons found all 102 local file pins and all
219 published source pins matching. Local HEAD, upstream and the live remote
matched the published revision before this evidence edit. Matching bytes do not
remedy the supervisor defects.

## Execution gate

Mr Potato Head returned **FAIL**, with six MAJOR findings:

1. Query handles bypass the reused process tree. Its empty PID/group sets cannot
   prove recursive query absence before scratch deletion and reservation release;
   an exited leader can leave an untracked helper or descendant running.
2. RSS sampling only before/after inline fixtures omits query lifetimes and
   transient fixture allocation, so it cannot establish the aggregate limit.
3. The whole-run SIGALRM can interrupt child creation before handle registration;
   the reused creation window defers only SIGTERM/SIGINT.
4. The pinned Git entry point does not freeze the effective HTTPS transport,
   included configuration or helper execution under the real HOME.
5. Python `-I -B` permits global site initialization, `.pth` code and
   `sitecustomize` before the driver's admission and imported-module checks.
6. The driver hashes files, discards those bytes and later reopens sources for
   execution, leaving the executed buffers unbound to the admitted reads.

Requested, selected and independently verified effective model/effort were
`gpt-6.1-sol` / `high`, with no fallback or descendants. Parent verified the saved
reviewer title and the session's `turn_context`. The full source review remains
private at
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/reviews/fucq103-mr-potato-head-owner-identity-fixture-2026-11-06.md`,
7,204 bytes, SHA-256
`0b8f72db2ba15c0321f5e14544fd65fd64951d34285268d1ea8d3176963a5ac0`.
Its binding receipt is
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq103-owner-identity-driver-review-2026-11-06.json`,
4,860 bytes, SHA-256
`5161b610a5a837df698dfd45d5d5f9594b6a72bdb5e506ce31f05f29b0a23880`.
This is a failed source-readiness gate, not a failed runtime attempt.

The allowed envelope remains one worker, 30 seconds for the whole run including
cleanup/output, 128MiB aggregate RSS, 16MiB combined allocation, 256KiB logs and
64KiB receipts, with 5GiB disk and 512MiB physical RAM reserves. No measured fit,
runtime exit, case pass count or cleanup success is claimed. The authored output
contains only its five planned input files; the review gate, grant-consumed marker
and planned scratch root are absent.

## Concrete revision proposal

Reduce the outer execution surface before another exact source review. Move the
read-only HEAD/upstream/status/live-remote verification into an immediately
preceding recorded parent preflight, leaving Git and its transport helpers outside
the measured fixture command. Bind that preflight to the exact frozen packet and
refuse a changed worktree or source identity. The parent must own the preflight's
process lifecycle, resource receipt and fresh result binding; moving it does not
remove its costs or ownership obligations.

Every remaining real query must participate in the same ownership, aggregate
resource accounting and teardown proof as the fixture supervisor. Preserve direct
handles and PID/start/group identities, track descendants, cover their complete
lifetimes and cleanup, and refuse unknown observations. Register the all-outcome
finalizer before the first possible child creation; complete query teardown before
scratch deletion and exact-token release/readback. Retain the exact first failure
and bounded original output, and include final output/cleanup in the whole clock.

The existing story supervisor provides a gated child and process-tree observation
pattern. A single gated fixture child could reuse that pattern so the supervisor
can observe fixture allocation while it runs; both processes and every query count
against the same aggregate limit. This is a source-only design proposal, with no
measured time or memory fit established.

Close Python startup before the first statement, for example through a reviewed
no-site launch with explicit resolver closure. Execute retained verified source
buffers. Defer the whole-run alarm during child creation/registration and deliver
any pending timeout only after the direct handle has been retained.

### Exact command and accounting deltas proposed

The rejected command is the pinned Python with `-I -B`, the rejected `outer.py`,
and `--plan-sha` / `--review-sha` arguments. A revised candidate would add `-S`,
use separately authored supervisor/worker paths and a new frozen plan, and bind a
parent preflight receipt through an explicit `--preflight-sha` argument. No revised
executable or digest is admitted by this proposal. Preserve the rejected five-file
packet and failed review verbatim; do not revise them in place or create a PASS
gate from this document.

| Boundary | Proposed treatment |
| --- | --- |
| Selected assertions | Same twelve synthetic cases, once total; no additional application or actual lifecycle category. |
| Worker | One gated fixture worker; supervisor, worker, pre-exec broker and every query count in aggregate RSS. |
| Git commands | Same four read-only checks: HEAD, upstream, clean status and exact branch live remote. Parent owns their handles, descendants, inputs, output and receipt. |
| Whole clock | Keep the existing 30-second allowance across the combined preflight, admission, fixtures, cleanup and final output. Moving preflight outside that clock would be a resource-contract change and is not selected here. |
| Allocation/output | Same 16MiB combined, 256KiB logs and 64KiB receipts, including preflight receipts/output and all new protocol files. |
| Reserves/accounting | Same 5GiB disk and 512MiB physical RAM reserves; locked strict seven-key ALL-row admission with no pruning. |

Relocation alone does not solve Git's executable/configuration closure. A revised
plan must identify and freeze that effective non-secret closure without reading
credentials, or retain it as a concrete admission blocker. No assumption that an
ordinary parent Git invocation satisfies this proof is made.

There is also a concrete query-bootstrap constraint: `Tree.register` and
`Tree.observe` call `process_snapshot`, which invokes the query facade. Wrapping
each `ps` query in another unmodified tree registration would recurse. The narrow
adapter must therefore define a finite bootstrap for the exact native resource
queries, retain their real direct handles before cancellation/timeout delivery,
and bind their identity, descendants, aggregate memory and final joins without
recursive query creation. A registration/checkpoint abstraction by itself is
insufficient. Until that mechanism and Git closure are authored and exactly
reviewed, there is no complete corrected supervisor to admit under this envelope.

Keep the twelve-case synthetic selection and all existing limits. A revised
packet requires a new exact independent review and fresh strict locked seven-key
ALL-row admission, counting every stale, foreign or unresolved reservation without
pruning. If that narrower adaptation cannot demonstrate the existing envelope,
return its concrete remaining requirement before execution. This proposal does
not authorize a broader supervisor framework, a larger envelope, a second fixture
selection or application reruns.

The source repair's previous independent PASS remains source-only. All 77 prior
scoped application cases and their original evidence remain unchanged; all 38
listener-parser design fixtures remain unexecuted. Whole-story, rendered,
native/live/full and producer/consumer acceptance remain open.
