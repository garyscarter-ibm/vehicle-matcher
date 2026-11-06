# C4 accounting HOLD repair — static authoring only

Historical first accounting repair published at
`379c31977adc9bd4dcc0dfcf75a5e1f979f8d2b6`. The subsequent independent review
held three probe/telemetry/cleanup paths. Current exact pins and the follow-up
diagnosis are in [case-release-probe-cleanup-repair.md](case-release-probe-cleanup-repair.md).
The admission and helper hashes below identify that historical checkpoint.


6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Repair base
`4ede3ea203f88c7457f5172aef0a30b429b9c9e0`. This repairs only owned C4
accounting, ledger and output. It requests narrow independent static review;
it does not assert runtime success or grant execution.

## Decided: diagnosis and evidence

The dispatcher's current diagnosis is the independent C4 static-review HOLD:

1. Supervisor sampling covered only the child loop; admission, imports, source
   audit/materialization, cleanup and postverification were uncharged.
2. Probe accounting selected direct children and supplied no fixed transient
   allowance.
3. The lock opened before descriptor type/identity validation without
   `O_NONBLOCK`; ledger reads used an unbounded pathname after a separate check.
4. Owned-row checks omitted `used`/`rss`; acquire/update readback did not compare
   the complete ledger or rigorously preserve foreign rows.
5. Finalizer release preceded final manifest, verification, summary/checkpoint
   and stdout. Final OUT checking followed writes and lacked finite prewrite
   structure, encoding and staging allowances.

Reproduction basis is source/control-flow inspection at the named base. No
reproduction, syntax, AST, harness/helper/test execution, resource probe, live
ledger access or allocation is authorized or performed for this repair. The
prior accepted 81/81 proof is unchanged and is not selected again. The diagnosis
remains current for this exact delta; actual runtime behavior remains unverified.
The defects skill was read at
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/defects/SKILL.md`.
The updated shared `AGENTS.md` IBM-422 direction was read; configured gateway and
credentials were unchanged, and no gateway/capacity/resource probes were run.
No subagents were started.

## Reviewed pattern and bounded adaptation

Read-only FUCQ-105 references, with exact source identities:

- `followup-consumer-bounds.py`: `250d99217547301126161e66c25b67d5b4cc9fb295e1b86fcb0a62f0e21ac41f`.
- `decision-mixed-ledger.py`: `14726d310da350b3d8e0b8b2c5e410d9f93167c841e52c9e4ede974a37870f69`.
- `followup-consumer-supervisor.py`: `d383b76421cad91efbe8a0933c2707dbb6d11bb13ace8f61924d1b94ac0fee2d`.

The new bounds and ledger helpers derive from those reviewed files. The C4
adaptation is newly authored and remains unexecuted/unreviewed. The original
cancellation handoff remains: defer signals through Popen/direct-handle
retention; stop/join the direct handle even when registration fails; incomplete
registration refuses destructive cleanup/release. Accounting adds finite identity
counts and remaining-time ceilings without opening a registration gap.

- Startup monotonic time covers the whole 120-second chunk. Finite admission
  and helper-hash bootstrap reads precede the first sample; bootstrap/self and
  reaped-child high water plus fixed transients are included. The continuous
  monitor starts before shared imports. Recursive descendants, observed
  PID/start identities and owned groups count throughout all phases.
- The 768MiB grant includes always-charged probe 32MiB, encoding 64MiB and
  ledger 32MiB allowances. Probe captures are at most 1MiB/2s; helper captures
  at most 1MiB/5s, both limited by the same absolute deadline. Handles are
  retained directly and stopped/joined. Failed/stale telemetry fails closed.
- Allocation includes all C4 retained output plus owned scratch. The 128MiB
  ceiling includes ledger staging 4MiB, atomic staging 1MiB+8192 bytes,
  stream growth 2MiB, terminal 64KiB and audit 64KiB. Output observation
  serializes atomic writes and traversal; concurrent owned deletion may only
  conservatively overcount. Retained output has an additional 8MiB ceiling.
- JSON depth/nodes/collections/string totals are bounded before incremental
  encoding; encoded bytes are bounded before joining/writing. JSON, summary,
  terminal, checkpoint and stdout have separate caps. The immutable 2.5MiB
  source plan is read under its explicit 4MiB input cap, not the smaller
  generic JSON/output structural limits.
- Independent writer limits are TAP 1.5MiB and the unchanged loader journal
  0.5MiB. Their sum cannot race past 2MiB. Worker launch requires time before
  startup+90s; the remaining 30 seconds belong to cleanup and completion
  inside the same 120s grant. This is sampled accounting with bounded
  operations, not an OS-level RSS or filesystem sandbox.

## Ledger and final-completion protocol

The accounting directory and existing lock retain their previously frozen
physical identities. UID is authored from the current process identity; this
repair never reads the live ledger or lock contents. Future locked access opens
`reservations.lock` relative to the held physical directory using
`O_NOFOLLOW|O_NONBLOCK`, then validates regular/single-link descriptor identity,
mode and UID. The ledger is opened relative to that directory with the same
nonblocking/no-follow policy; type, link count, UID and 4MiB bound precede any
read, and descriptor/named identities are compared afterward. Duplicate,
malformed, missing and cyclic state refuses mutation. There is no pruning.

Owned-row authority compares the complete deep-copied row including `used` and
`rss`, exact owner PID/start, root and parent. Every mutation compares the whole
original again before replace, preserves every foreign row, and reads back the
entire expected ledger. Normal staging paths and actual identities are recorded
in the bounded ownership manifest. A failed acquisition/update intent remains
uncertain and cannot authorize cleanup or another row's release.

The reservation grants the full 128MiB/768MiB and keeps `used`/`rss` credit zero
through completion. This prevents conservative charged peaks/transients from
reducing pending host reservations for other launchers; actual measured/charged
peaks remain in output evidence. Source materialization starts only after strict
acquisition. No shared source is patched: bounded subprocess/writer adapters are
attached only to the loaded module instances.

The finalizer proves process/group absence and deletes only the exact owned
scratch, then leaves the row held. Main performs pin/source postverification,
records a unique planned final-release staging path, writes the bounded
summary/checkpoint/terminal bundle, and checks actual postwrite allocation/RAM.
It joins monitor and captured telemetry handles while the reservation is held,
performs synchronous final accounting, emits a finite nonblocking stdout record
within the absolute deadline, and checks again. The final strict ledger
release/readback/staging removal is the last operation: it writes no manifest,
summary, checkpoint or stdout after removing the row. The release intent remains
explicitly planned in the immutable manifest until an external audit establishes
actual absence; it never invents an observed removal.

Stored receipts say `pending-final-release-and-independent-audit`, with a
`candidatePassed` field rather than a stored passed result. Completion requires
actual exit 0 and independent verification of terminal/summary/manifest hashes,
preserved pins, process/group/scratch/ledger and all declared staging absence.
Any incomplete bundle/proof, failed accounting/join/stdout, cancellation, stale
final sample or uncertain ledger mutation produces failure and retains any
uncertain ownership for explicit recovery. No uncharged post-release success
receipt is written.

## Exact new pins and validation boundary

Admission SHA-256: `22f52533b3b342cfedc6d9c8beb781e3a256395969388812992c53f016e32d00`.
Source plan SHA-256 unchanged:
`5daaae85cf909de78c4ec31dadd426f379902ed821597a38a14fcb768878f827`.
There are 25 admission nodes: three changed existing harness pins and two new
helpers; all other original nodes are preserved. Loader, launcher and four-case
file bytes are unchanged. The source review's 121 blobs, 298 edges, 138 installed
files and 18 reviewed pins remain fixed. Historical author/source freeze evidence
is retained separately inside the updated freeze audit.

| Owned harness path | Bytes | SHA-256 |
| --- | ---: | --- |
| `case-release-freeze.py` | 16554 | `dafff573796c4412931bac6ad7d2897e361adb8d52d149cbe50250308e539bda` |
| `case-release-resources.py` | 22200 | `75dc6a2769919ae304e2d5d0415940a4f1132dde07ce1121ee6e06a1429be43b` |
| `case-release-supervisor.py` | 28334 | `932363de4407a5ac8e0a9988bc888f43d8aa36e62d94edc2c5b0d38c655d06ec` |
| `case-release-bounds.py` | 22796 | `5403919eebcb9c1cf7158b26f6a0d9d3be5a09cd0989bb1b7085da4ffbac5771` |
| `case-release-ledger.py` | 15929 | `05b4f244ded5e36ffe57fbc0848b7f71753cb0efe44733bed18110d984f2e8a9` |

Validation performed here is text/control-flow reading and independent stdlib
metadata/hash comparison only. The collector was edited for future inclusion of
the two helpers and accounting/ledger contract; it was not run. No syntax checks,
AST parsing, helper imports/execution, tests, probes, ledger access or allocations
ran. Product/runtime, source plan, C1/test/product references, historical authoring
snapshot, Jira, map and claims were not changed. Independent narrow review and a
fresh exact execution grant remain required. The four synthetic TEST cases do
not establish renderer/account-resume/reset/default-source, F77/F78 real corpus,
paused96 producer, browser/native or full-suite acceptance.
