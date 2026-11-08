# FUCQ-69 process snapshot diagnosis · 6 November 2026

State: author-only diagnosis and repair boundary. The consumed `0911` grants
authorised one invocation at `6b2b6a06fe157f7d1083b9dabab33db0f24bb665`.
They authorise no retry, parser execution, probe, import, allocation or cleanup
by this author. Root owns independent reconciliation of the failed run's
resources. Its original records remain untouched.

## Decided

`diagnosis: reproduction` — root's one actual supervisor invocation exited 1.
Its original receipt is `incomplete`, with no Node return code, root process
identity, TAP file or completed test. The mirror contains 57 recorded source
files; materialisation was partial. This is a supervisor preparation failure,
not a failed or passed product case.

`cause/evidence` — `hostIssues` records
`RuntimeError: Cannot parse process ownership telemetry.` The corresponding
source raises that message only when a decoded `ps` line has other than 11
fields, a non-decimal first four fields, or an unsupported state token. The
query requests PID, parent, group, RSS, state, start and unused command arguments.
`split(None, 10)` consequently makes an argument token part of identity admission.
The final inventory entry, command 234, is `/bin/ps`, exit 0, directly joined,
with unknown start; parsing failed before `observe_probe_rows` could bind it.

No original `ps` stdout or rejected-row diagnostic is retained. **The exact
original rejected row and which predicate rejected it are unknown.** An empty
argument, unexpected state, malformed row or other row-shape problem remains a
hypothesis; a later sample cannot reconstruct this original snapshot.

`affected writers/readers and existing data/cache` — preparation calls `meter`,
which samples resources and updates the strict reservation. Reservation binding
calls `current_owner`, which requires a complete `snapshot` before any mutation.
The parser failure is recorded by the lock context as a host issue. Scratch exit
then refuses deletion because host ownership is uncertain, retaining the named
scratch/reservation and reporting `Owned process cleanup uncertain`. All 234
probe/Git handles are directly joined, but complete session-absence coverage
ends at command 231. Neither direct joins nor the earlier complete snapshot
establish final cleanup. There is no product data/cache repair to make.

`next check/unknowns; code/data/environment basis` — compare the exact source
parser and all state consumers before changing the query. Establish any further
original capture with root; do not manufacture a row or run another probe.
Validation remains static authoring only until separately authorised. This note
does not claim that a prospective parser repair resolves the unknown original
predicate.

Origin: FUCQ-69 / `DEV-2026-11-04-068`, specifically its new host-journey
validation supervisor. `story_link_basis`: the consumed plan identifies FUCQ-69
and the same exact selected case/helper. This does not change backlog scope,
Jira relationships, story acceptance or the accepted history/Back evidence.

## Original evidence

All paths below are relative to the root checkout's
`.claude/test-runs/fucq69-host-journey/host-journey-181feb945bd6/`.

| Original | SHA-256 |
|---|---|
| `receipt.json` | `f10262fe11ac974839c87cc44cb449f732c777c6f608ca9b3f918e8bb3bb48b1` |
| `probe-ownership.json` | `cf2d111edb3e76a63c851d426b7688c18e81a0dcd45ff96b308780dc4f3827c2` |
| `checkpoint.json` | `8ae0cd253acba91c1ef7dd3b7b78381008eefcfeb4eff3aeee076c91ea086248` |
| `plan.json` | `466399cfeed999692607881c24543caf28931fcc535ab2b8db49393e43c360c4` |
| `provisional-ownership.json` | `5ba323718beb2daa6bfaf90bad0347609a30c45705159c4068b4f28044175944` |
| `ownership/a23483cdef704d6683c0a549cf4f707b.json` | `0f5ed7052955fff0a8b3faba2fba04ba1888e8eebfd041b7f93d15ba02c1f236` |

Root independently owns the scratch
`/private/tmp/test-stamp-shard-a23483cdef704d6683c0a549cf4f707b`, manifest token
`a23483cdef704d6683c0a549cf4f707b`, supervisor PID 58793 and exact observed start
`Fri Nov  6 09:19:15 2026`. These are historical evidence bindings, not this
author's permission to signal, inspect open files, delete or release resources.

Root subsequently completed independent cleanup, recorded in
`.claude/test-runs/ownership/fucq69-host-root-cleanup-0911.json`, SHA-256
`c5f62dbd880a1e663b11a59b29be851409ca600828c804e6c30540f7bb8dea44`.
That separate report is PASS with 1,932 checks: original supervisor/probe PIDs
and observed groups absent, no root open files, exact inode-bound scratch
removed and only the exact own reservation released under the existing
exclusive physical lock. Foreign values and originals were preserved. It
establishes later cleanup only, not execution success or the original row.

## FUCQ-134 comparison and repair constraints

The reviewed FUCQ-134 adapter in `DEV-2026-11-04-103` requests five fields:
`pid=,ppid=,pgid=,rss=,lstart=`. It removes only unused state and command data,
uses `line.rstrip(' ').split(None, 4)`, validates every required row and retains
one bounded first-rejection diagnostic. Only trailing ASCII column padding is
normalised. It preserves the spacing within the start identity.

FUCQ-69 currently has four state consumers: probe-session absence, live-owned
selection, owned-group absence and group signalling. Each distinguishes
zombies from other processes. Removing state here would require an explicit
conservative protocol change treating every present row as present; copying the
five-field parser alone would leave those consumers broken. The independent
FUCQ-134 later sample's `?` row is not FUCQ-69's original failing row.

Any repair must retain complete-row/identity admission, duplicate/PID/group
validation, strict unknown ownership, direct-handle cleanup, exact reservation
binding and no new process after release. It must not skip malformed rows,
whitelist foreign PIDs, infer absence from unknown state, fabricate starts or
reuse a consumed grant. The 146 immutable source/test rows, installed dependency
closure, first-case name/Node argv, all resource limits and the held second
quoted-reload case remain unchanged. No later F100 repair is adopted.

## Authorised six-field repair

Root confirmed that no additional FUCQ-69 raw snapshot exists and authorised
the six-field no-args design. The revised query is exactly
`/bin/ps -axo pid=,ppid=,pgid=,rss=,stat=,lstart=`. It uses
`line.rstrip(' ').split(None, 5)` and validates all six fixed fields. Decimal
fields must be ASCII; PID and group must be positive; duplicate PIDs fail.
The unchanged state grammar still rejects `?`. The start is a full ASCII
weekday/month/day/time/year match, with exact internal spacing preserved.
Trailing column padding is the only normalisation. No row is skipped.

All four state consumers and all code outside the parser plus bounded inventory
diagnostic remain unchanged. On rejection, the first diagnostic is retained in
`probe-ownership.json` as `firstSnapshotRejection`: command key, capped 1-based
line number, at most 256 fixed-field characters, truncation flag and fixed
reason. The query never requests command arguments. Later cleanup preserves
the first diagnostic. Its protected write cannot bypass retained-handle cleanup.
The original generic failure remains a failure; no fallback probe is launched.

This repairs the unnecessary command-argument dependency and missing causal
diagnostic. It does not establish which predicate failed in the original run,
or prove compatibility with a presently unknown state. No repair execution,
syntax/AST/compile/import check, process probe, test, allocation, cleanup or
ledger access was performed by this author. Independent static review and
current admission are required; both old grants are consumed. Any future
combined invocation requires two new separately assessed permissions and
original actual-wait capture. The first-case and held second-case boundaries
remain unchanged.

## New review freeze and validation

These current pins supersede the historical admission handoff's consumed pins.
All four files are under `docs/gcsp/evidence/fucq69/` in the owned `068`
worktree. They confer no execution permission.

| Current input | SHA-256 |
|---|---|
| `host-journey-supervisor.py` | `9f03afbb92d2b7cea2213de33e8081c3654e001b6e4b2d1f8f83ce1b0547d782` |
| `host-journey-closure.json` | `beb5bad0286805802085954e95cf09421d3f975fcc151e9de4ffae8a7a793683` |
| `host-journey-plan.md` | `9d1530462d91bd65f8503490654393299f6a110da341aed1d7600e3e9f3149f7` |
| `host-journey-source-proposal.json` | `88e6d18185b65c53c8e1d4b10c205dd4bb555d78d4fd144fd62b77ae5bbd7612` |

The closure's three changed guard rows retain device `16777232` and mode `420`.
Supervisor inode `173299724` now has size 79,112; plan inode `173294921` has size
27,259; proposal inode `173294214` has size 168,333. Their former SHA-256 values
were respectively `61069a537637d6672dec79183384290a42872b19ac4364e0311dac6249d53f08`,
`1f5d6ea8890a02fed5a7dce2a9fd44a4c4854fd850747147da9f05900088f1fa`
and `595aa166dadd15d64c12fef07ddc9e6a304fb5ce93790da4e5d6c03795b95eda`.
The old closure SHA-256 was
`b83638eff79babee03a6ea7c3d6f61f18c7b04954a3be80da8415090d55d302d`.
The three other guard identities and all eight tool identities remain unchanged.

Static carried-field checks passed against `6b2b6a0`: source changes are confined
to `snapshot` and the first-rejection inventory field/global; all four state
consumers and the state regex are byte-for-byte unchanged. Every other closure
field is identical except the three refreshed guard identities, current
validation text and additive parser-repair record. The entire proposal graph
is unchanged outside helper/state metadata. The selected test remains SHA-256
`29f6f1d5b99472283d0d8586949d625476127ccf7ad28fb983ad8044acb4ae65`.
Whitespace/diff and original-evidence hash checks accompany publication. These
are static checks, not parser execution or product/regression evidence.
