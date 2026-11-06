# C4 retained first-failure diagnostics

6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Author-only diagnosis from
`81b049f73a82a85b22d254c5dc577951e1001c8b`; no reproduction or retry.

## Decided: current diagnosis

The reviewed checkpoint and current static admission passed before the one-use
grant `fucq122-c4-81b049f-1029` was consumed. The retained wait receipt reports
supervisor PID 5655 joined with exit 2 after 7.945008375 seconds; both streams
were empty. The process manifest records 119 joined helper handles, sticky
`BoundError`, an uncertain state, and partial observations for PIDs 5802/5803.
The last helpers are query 118 and Git source verification 119 for
`server/gcsp/repository/memory.js`, both joined with return code 0.

The Scratch constructor returned an ownership object, root name and token, and
a reservation was acquired. The retained run contains only the checkpoint and
two ownership manifests: no plan, physical scratch source tree or Node launch.
These are retained evidence observations, not a reproduction or proof of the
specific failing invariant.

Original run:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122-c4/case-http-b2c4a1f4eca14a479f34cf36800306fb`.
Root's independent reconciliation receipt:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq122-root-reconcile-1029.json`,
SHA-256 `06533ec0583df17d8d32360938ab8feaad170b3e555bf81c0615c08fa27f1187`.
It records PASS for all recorded owner/helper PID/group/open-file absence,
scratch/staging absence and removal of only the exact dead owned reservation
token `781858c3b99f404c95902fdcadd3d60f`; originals and foreign rows were
preserved. Its first timestamp-whitespace audit issue was corrected only in the
root audit script. That audit-script issue does not diagnose this runtime failure.

Static causal boundary: `uncertainObservations` is written only by
`remember_partial()` in the process-query parse/producer/identity exception
path. The latest and only matching unobserved query is helper 118. Its stored
partial observations preserve PID/parent/group/normalized-start only; raw
status/RSS fields and the actual exception reason were not retained. Therefore
the strict row parser, producer check and `observe()` identity checks remain
possible rejection points. The detailed failing invariant is unresolved.
No parser, identity or source-content rule is relaxed on this evidence.

`execute()` catches the inner exception into a local failure value. If later
accounting/proof/output work also refuses, it can raise `SystemExit(2)` before
writing a summary or terminal artifact. The outer handler rethrows SystemExit,
so its phase/type stderr diagnostic is bypassed. The registry preserves only
the exception class. This is a verified diagnostic-loss path, independent of
the unknown original rejection reason.

The current project AGENTS and defects skill were re-read; GCSP build,
experience, readiness, resource, equal-collaborator authority and existing
source/access/claim/pause boundaries remain binding. No product or screen
behavior, Jira/map/claim edits or descendants are involved. Both grants 1016
and 1029 remain consumed.

## Repair and static acceptance mapping

The existing process manifest can now contain one `firstFailure` record. It
retains the first caught exception type, a fixed stage label, the declared
helper ID when available, an approved constant reason for selected process
query/identity/capture failures, and source location metadata. An unapproved
reason is null. There is no call to stringify arbitrary exceptions for this
record. Only frame metadata from the exact admitted bounds/supervisor source
paths is allowed; the stored filename is its fixed basename. At most 16
traceback links are traversed and eight frames retained, with truncation
explicit. Type/function names are capped at 80 characters; helper IDs remain
inside the existing finite registry cap. Traceback text, source lines, locals,
input values, raw process rows and full paths are excluded.

The query exception path remembers this record before the existing partial
observation save, so a later save/join error cannot replace the primary
diagnostic in memory. Helper launch/capture/join and aggregate failure paths
identify their stages. `execute()` remembers its first caught inner error
before local error formatting and cleanup; source verification has a fixed
phase label. Existing `fail()` and ownership saves persist that record. The
retention method itself changes only memory and adds no writer, probe,
cancellation, ownership or cleanup decision. Later SystemExit/cleanup failures
cannot overwrite an earlier record.

All existing initialization/physical/manifest guards, sealed-write barrier,
single-link checks, dedicated system-launcher reader, process/parser
acceptance rules, all-RSS accounting and pinned cleanup authority remain
unchanged. No extra runtime artifact or save is introduced. Existing finite
structure/encoding/allocation bounds still apply to the new small record;
lost ownership, failed persistence or sealing never authorize a fallback write.
Retention therefore does not promise a durable diagnostic after ownership is
lost or legal writes have ended. It cannot reconstruct the old rejection.

## Exact pins and preserved scope

Admission SHA-256:
`5f1a0973b8a22dc3858b340e36c76cc00c09ee44bae611a2ba0ecf680f38815f`.
Only these two existing helper nodes change; all 25 nodes and every other
admission value are preserved, including both launcher metadata records.

| Changed owned helper | Bytes | SHA-256 |
| --- | ---: | --- |
| `case-release-bounds.py` | 48095 | `2d52a83409a80278baff940c68e375d881e0631a1e0916bb28cb6c5925717100` |
| `case-release-supervisor.py` | 33444 | `f7ea65a2433bfaab1038a6ac6e0459aaa673a8242e5ccc9ec2cba91d4ec5d3d2` |

The freeze/resources/ledger helpers remain byte-for-byte unchanged. The source
plan remains `5daaae85cf909de78c4ec31dadd426f379902ed821597a38a14fcb768878f827`
and the original four-case test remains
`8250cf300944ef07f0a091fa46ba212b78fd854b32a3501e5703da8540898cd9`.
The 121 blobs/298 edges/138 installed files/18 source pins, argv/environment,
four selected cases, accounting contract, 120-second/768MiB/128MiB/2MiB/
one-worker ceilings and 30-second completion reserve remain unchanged.

## Validate and remaining gate

Performed: static source/control-flow and retained-evidence reads, independent
stdlib helper metadata/hash authoring, comparison of every other admission
field/node and frozen input hash, read-only comparison of all original 1016
and 1029 evidence hashes against their root audit/reconciliation receipts, and
named-path Git publication. Historical receipts and original artifacts remain
untouched. Agents: requested/selected `gpt-6.1-sol/high`; no fallback or
descendants. No new capacity or gateway probe was run.

No C4 imports, helper/test/collector execution, syntax/AST checks, process or
resource probes, live ledger reads, test allocations or runtime retry occurred
during this repair. The underlying rejection remains undiagnosed beyond the
parse-or-identity boundary. Independent narrow diagnostic review, fresh exact
current admission and a new scoped grant remain required. Both consumed
grants stay consumed. Earlier 81/81 and real-corpus/default-reset/native/
browser/full acceptance gaps remain unchanged.
