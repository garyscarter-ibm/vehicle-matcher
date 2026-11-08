# C4 probe ownership, telemetry and cleanup HOLD repair

6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Author-only repair from
`379c31977adc9bd4dcc0dfcf75a5e1f979f8d2b6`, published as
`e0a0ecc695d7fda86c4bc9fbdc8c4624f9e8bf7e`. This is a historical receipt.
Barney's subsequent review held initialization ownership only; its current
diagnosis, repair and pins are in
[case-release-initialization-repair.md](case-release-initialization-repair.md).
No execution or success is claimed.

## Decided: current diagnosis

The dispatcher relayed Dibble's independent static HOLD at `379c319`:

1. The first monitor query and both Scratch-constructor identity queries
   preceded any durable external run/owner/probe intent. Captured helpers
   remained local, and a failed monitor-probe join could be overwritten by the
   next snapshot. Final absence covered only the Node tree/groups.
2. Aggregate telemetry discarded stderr, accepted duplicate PIDs, treated any
   five-token start as valid and used an unchecked state prefix to omit RSS.
3. Cleanup released the ledger lock after authorizing the row, then performed
   further OS proof, writes and inode work before deletion. The owned-row and
   dependent binding did not remain protected through `rmtree`.

Basis: direct source/control-flow reading of those paths and their callers at
that exact checkpoint. The prior accounting, foreign-row preservation and
bounded final-write improvements were otherwise confirmed by the review. No
reproduction, import, syntax/AST check, helper or test execution, probe, live
ledger read, source mirror, allocation or descendant is authorized here.
This note is the current diagnosis for the narrow repair, not a reproduced
runtime verdict. The defects skill was re-read at
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/defects/SKILL.md`.

Current worktree/shared `AGENTS.md`, `docs/gcsp/build-rules.md`,
`docs/gcsp/experience-quality.md` and
`docs/gcsp/technical-readiness-2026-11-05.md` were re-read. This changes only
owned harness evidence, with no screen or product behavior change; visual and
live-integration acceptance is not claimed. The shared assumptions/product
source remains unchanged. Jira links, source/access limits, pauses, claims and
file ownership remain binding; no Jira/map/claim changes are made.

Gary's further budget check reports that the earlier exhausted-credit HTTP422
was false. The current IBM-422 rule remains: preserve exact errors and existing
checkpoints, use the configured gateway/credentials, and continue authorized
work while the launcher can make necessary calls. No fallback, key rotation,
gateway change, credit monitoring or extra run is authorized by that diagnostic.
Agents: requested `gpt-6.1-sol/high`, selected `gpt-6.1-sol/high`; no fallback,
no descendants. Local coordination/polling state is not part of this commit.

## Repair and static acceptance mapping

### 1. Durable ownership before every query

`Processes.initialize()` writes an exclusive external provisional
`<run>/ownership/processes.json` before `Aggregate.start()` and any shared
resource import or Scratch constructor. It records the run/admission/grant,
provisional supervisor PID with explicit unknown start, exact probe intent and
new-session policy. The constructor intent is persisted before calling
`make_scratch`; its result binds the scratch root and ownership-manifest path.
Constructor failure is inside the protected scope. The outer main cleanup owns
all already-launched helpers even if no Scratch object returns.

Both monitor queries and every `Captures.run` use one process registry. A
bounded planned command record precedes Popen. The exact handle is retained
before persistence; PID, requested isolated group and known/unknown normalized
start remain explicit. Strict complete queries fill observed starts and all
recursive descendant/group identities. A join closes pipes and records the
actual return code; file fsync, directory fsync and exact bounded manifest
readback precede dropping the retained handle. No ownership failure silently
forgets a handle. Malformed query output preserves bounded relevant partial
PID/parent/group/start observations, with unknown fields and truncation explicit,
before recording sticky failure; the stricter parser preserves cancellation
recovery evidence. Teardown attempts every retained direct handle, even if one
join or persistence attempt fails. Signals use direct Popen handles, not an
inferred persisted numeric PID/group.

A failed launch/intent write, capture, query, telemetry or join sets sticky
failure and blocks every new helper/probe. A monitor event ID remains retained
on failure and cannot be overwritten by another snapshot. The loop stops
probing after failure; cleanup can stop already-retained handles while uncertain
resources/reservations remain. The existing Node Popen/cancellation handoff is
preserved.

Before deletion, new queries are quiesced. One declared complete proof query
runs alone, and its exact producer is joined and durably recorded before the
proof is used. The proof covers every captured helper PID/group, observed
descendant and any remaining direct supervisor child; the Node tree proof uses
the same rows without launching another query. The query's own row is exempt
only for that exact directly joined producer; any other member of its group
still refuses absence. Unknown starts are never presented as known. Direct
join plus complete numeric PID/group absence is required for a short helper
whose start was not observed. Reused/uncertain groups conservatively refuse.

After postverification and bounded summary/checkpoint writes, the monitor and
all active handles join. A final complete query and the same Node/helper proof
seal a permanent launch barrier. The terminal receipt hashes both the scratch
and process manifests after the last ownership write. Final aggregate checks
use self/reaped-child high water, cached conservative RSS and the same fixed
transient allowances while the barrier is closed. Final ledger release uses
that exact sealed owner start rather than launching another identity helper.
Any stale final query, incomplete proof, cancellation, unknown accounting or
mutation refuses successful completion. Actual exit and independent post-exit
audit remain required; stored receipts remain pending.

### 2. Strict complete telemetry, all reported RSS

One parser is used by Aggregate and the owned resource helper. The combined
stdout/stderr capture is bounded; nonzero query status, any stderr, missing final
newline, malformed/empty output, absent supervisor/producer, duplicate PID or
unknown field/state refuses the entire query. Numeric identity/RSS fields must
be ASCII nonnegative integers with positive PID/group. Full start syntax,
calendar date, weekday and year are checked and normalized to one identity
representation. Invalid or unknown state suffixes refuse; state never suppresses
reported RSS. Aggregate sums all selected reported RSS, including a reported
zombie value, then takes the maximum with self/reaped-child high water and adds
the existing fixed transient allowance.

### 3. OS proof followed by one held cleanup authority

Open-file and Node stop/join checks precede the quiescent complete OS proof.
Only then does `cleanup_authority` open the pinned physical directory/lock,
read the current complete ledger, compare the complete owned row and exact
sealed/proven owner/root binding, and reject dependent reservations. It holds
the same lock across scratch sampling, the last exact device/inode/type check,
`rmtree` and scratch absence verification. A complete-ledger comparison follows
inside that same context. No owner query, manifest write or second unlocked
authority interval intervenes between the final inode check and deletion.
Postverification may resume probes only after the deletion context exits;
uncertain proof/cleanup failure is sticky and retains resources for recovery.

## Preserved boundaries and exact pins

The four-case file is unchanged: SHA-256
`8250cf300944ef07f0a091fa46ba212b78fd854b32a3501e5703da8540898cd9`.
The source plan is unchanged: SHA-256
`5daaae85cf909de78c4ec31dadd426f379902ed821597a38a14fcb768878f827`.
The reviewed 121 blobs/298 edges/138 installed files/18 source pins remain fixed.
Selected four-case child/supervisor command templates, environment and all
numeric accounting/budget contracts are byte-for-byte equivalent as JSON values
to the preceding admission. Limits remain 120s/768MiB aggregate RAM/128MiB
scratch plus retained/2MiB TAP plus journal/one worker, with the same 30-second
completion reserve, finite capture/output/identity/structure limits and fixed
allowances. No fresh source adoption, product/runtime edits or budget expansion.

Admission SHA-256: `74f3d50cb95e5d02751e44f72a9f336578bba1bc12386201a1534f5875d410fb`.
Only these four existing helper pins change; there are still 25 admission nodes.
The freeze collector, loader and launcher are unchanged and were not executed.

| Owned helper | Bytes | SHA-256 |
| --- | ---: | --- |
| `case-release-bounds.py` | 37562 | `dfd8eb0f940057715df4d104cac17965715962f07f6a91542e30afa1d6d23519` |
| `case-release-ledger.py` | 17133 | `8b9ef3ad344931700060ad769ed8cbc71f59d932f5dc0c5c29bfcd7398d42d8b` |
| `case-release-resources.py` | 20893 | `ec90d203ae61f0fab4f0a8b3d1ec0b81b595f5b18b1375e1d772427ecd3ef080` |
| `case-release-supervisor.py` | 30580 | `157dec2fa8ac3732e93e993bf28f1529165ecd8efcff66014722f2db002a2f50` |

## Validate and remaining gate

Performed: static text/control-flow reading, bounded independent stdlib metadata
and hash authoring, original admission-field comparison and named-path Git
publication. The updated audit retains the historical first-repair/source-freeze
receipts. No syntax/AST checks, C4 imports/helpers/tests, probes, live ledger
access, mirrors, allocations or descendants ran. No result from the new paths
is asserted. Independent narrow review at the new exact HEAD/admission is next;
any execution still requires a fresh exact C4 grant, followed by all original
case/module assertions and independent post-exit ownership/resource absence.
The earlier accepted 81/81 proof remains unchanged and was not rerun.
