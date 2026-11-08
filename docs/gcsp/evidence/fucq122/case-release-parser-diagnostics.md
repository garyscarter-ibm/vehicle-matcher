# C4 process-row rejection diagnostics

6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Author-only diagnosis and
bounded diagnostic repair from `45a32d932efd2db728b0671cf9063a284aef43c2`.
No product/runtime execution or retry is authorized. No descendants.

## Decided: current diagnosis before repair

Origin: the existing FUCQ-122 C4 owned harness and its retained parser diagnosis,
not a newly claimed product defect. The dispatcher returned this exact writer
lane in `.claude/coordination/fucq122-parser-diagnostics-1304.md`. The project
AGENTS, defects skill, GCSP purpose/adapter boundaries, build rules, experience
contract and technical-readiness direction were re-read. All collaborators have
equal authority; claim, lease, worktree and paused/foreign writer lanes remain
retained. This repair affects only test-harness diagnostics and evidence; no
screen, user-visible product behavior or visual acceptance changes.

Reproduction evidence: the already consumed grant
`fucq122-c4-45a32d9-1251`, recorded in
`.claude/test-runs/ownership/fucq122-once-grant-1303.json`, launched the reviewed
supervisor once. The original wait receipt records PID 5873 directly joined,
exit 2 after 8.305319458 seconds, both stdout/stderr empty. Original run:
`.claude/test-runs/fucq122-c4/case-http-03c1bde584804923bdee92ec63752bd7`.
Its scratch manifest says `launchAttempted: false`. No Node worker or C4 case
ran; the four case outcomes remain unknown. This run establishes no result for
the prior `hatchback` correction.

The original `firstFailure` is `BoundError`, stage `process-query-parse`, helper
129, reason `Duplicate or invalid process identity/state`; its frames identify
`capture:519` and `process_rows:217`. The last query helper was directly joined
with return code 0. The source condition combines nonpositive PID/group,
identity/RSS range, duplicate PID, empty state, unsupported leading state and
unsupported state modifier. The rejected row and predicate are absent from the
original record. The exact cause is **UNKNOWN**. Busy/transient process creation
is a hypothesis; the two uncertain child observations do not identify the
rejected row or prove a platform syntax defect. No parser contract change is
justified by this evidence.

Affected readers/writers: `process_rows` is used by `Processes.capture` and the
supervisor's shared guard binding. Complete accepted rows feed `observe`, all-row
RSS accounting and ownership/absence proofs. `remember_failure` retains the
first caught failure before `remember_partial`/existing guarded persistence.
The original finalizer then refused with `New helper/probe refused by sticky
ownership state` and retained the reservation. Existing records are historical
and will not be rewritten to manufacture the missing predicate.

The worker later reconciled only token `4697a18e6e9d40de83f2cdbda6e9df76`;
receipt `.claude/test-runs/ownership/fucq122-02-reconcile-1306.json`, SHA-256
`50718dd2d3b438996ca8c80c442372b4995db48613d363aa05982eb82b437912`.
Root's later independent combined collection is PASS on 20 checks overall,
`.claude/test-runs/ownership/dispatcher-collections-1304.json`, SHA-256
`dd650dd394c07558a0a2cd232424e658c0e4533452b8ca924c6d497108a70277`.
Its FUCQ-122 cleanup section records 131 PIDs and 41 groups checked and the exact
scratch/token. That collection preserves the original parser and finalizer
failures and incomplete behavior acceptance. This authoring step compared the
seven FUCQ-122 original hashes in that retained receipt; it performed no new
cleanup, probes or live-ledger access.

## Acceptance and intended repair

Keep the complete-query rejection, exact parser acceptance sets, numeric/date
checks, all-row RSS, sticky cancellation/ownership state, earliest overall
failure and every process/cleanup/ledger authority unchanged. Add only bounded,
redacted diagnostic metadata to the existing manifest: the precise first
rejected predicate, row index, PID/PPID/PGID/RSS/STAT/start fields, duplicate
previous-row evidence when applicable and conservative accounting/recorded
ownership-link context. Never retain raw lines, arguments, environment,
credentials or arbitrary exception text. Truncation/redaction is explicit.

Retain the earliest parser-specific rejection independently, so an earlier TAP
failure cannot mask a later parser rejection. This is memory-only retention
until an existing legal guarded save; failed ownership, initialization or sealing
still prevents fallback writes. Do not skip, filter, relax or retry any rejected
row. No successful partial accounting or cleanup proof may follow rejection.

## Authored diagnostic contract and exact pins

`process_query_error` attaches only source-constructed JSON metadata to the same
`BoundError` class and existing constant reason. `process_rows` still rejects
the complete query on the first failing condition. It now labels that predicate
and its one-based row index; start-date exceptions retain their original error.
The accepted output remains the same PID-keyed metadata dictionary with RSS
converted from KiB to bytes. No new accepted state/flag/date/numeric syntax,
partial result, row filtering or retry is introduced.

Numeric metadata is retained as at most 19 ASCII decimal digits per field;
missing, non-decimal, non-ASCII or longer values become null with fixed field
labels. The unit is explicit as `rssKiB`. STAT is limited to 32 characters from
the existing state/flag alphabet; other characters are `?`, with redaction and
truncation flags and original length. A state rejection retains only its first
rejected character's index and Unicode code point. Start text is retained only
when it has the existing date lexical shape; whitespace is canonicalized and
other text becomes null with a redaction flag. Original length is recorded.
No raw line, stderr, args, environment, arbitrary exception text or unknown
start string is retained. Duplicate evidence contains the earlier accepted row's
same finite metadata, with its STAT capped at 32 characters.

The ordinary earliest `firstFailure` remains first-writer-wins. A separate
first-writer-wins `firstProcessQueryRejection` retains the earliest parser-specific
rejection even when an earlier TAP/runtime failure occupies `firstFailure`.
Both use only the existing legal guarded saves. The new method makes no save,
probe, cancellation or cleanup decision. At most two row snapshots and six
fixed metadata-link labels are retained per parser record. Existing JSON,
manifest, allocation and accounting caps still apply without increases;
exhausting a cap continues to fail closed. Retention cannot promise persistence
after initialization/ownership/sealing has forbidden writes.

Recorded metadata links compare PID/parent/group numbers with the already
retained owner, helper, observed and Node references. They are explicitly
**candidates**, not start-identity or ownership proof. A row without such a link
is `unresolved-no-recorded-link`, never classified safe/foreign or ignored.
Every rejection states `complete-query-rejected; no partial RSS accepted`.
Neither current nor duplicate row diagnostics feed `observe`, aggregate RSS,
process signalling, absence proofs, scratch deletion or ledger release.

| Current pin | Bytes | SHA-256 |
| --- | ---: | --- |
| `case-release-bounds.py` | 53788 | `6a4cc6c958bc460fccc2b5604c8728172b2ed96599a3372ad0d60c36b93a94da` |
| `case-release-admission.json` | 16835 | `2eea1f29e5155dfcf84448063295abc6e5f6a82d1c6f4b08eefba93c90e8bf21` |
| unchanged `case-release-source-plan.json` | 2485861 | `e509ec368b0f5888e3623e9cb17f75af5f351653351a7c0d5b5979262f8d5d87` |
| unchanged corrected C4 test | 15654 | `54a1798996b607a8dc3af154fb38429a6ac6ed84c3fb1cd6de252d740ad56c03` |

Only the bounds node's physical/content metadata changes in the 25-node
admission. Both system-launcher records, all other nodes/values, command
vectors, environment, limits, completion/ledger contract and all six other owned
helpers remain exact. Source rows, edges, assets, installed inventory, profile,
composition, test revision `1a20692f2f31ecf2f2a88864c64e1fa89b5e0d1c` and four
names remain unchanged. The exact preceding audit object is retained inside the
current `case-release-freeze-audit.json`; original run artifacts stay ignored
and untouched.

## Validate: deferred finite parser-boundary selection

The next proposed selection is **one separately authored and pinned stdlib
parser-boundary driver**, with these nine named groups, at most 160 assertions
and no product/runtime cases. This plan is for review; the executable driver,
its exact command/input pins, admission/resource receipt and explicit assignment
must be prepared before it can run. No new execution grant exists here.

| Proposed group | Required boundary evidence |
| --- | --- |
| Query completeness | Existing nonzero exit, stderr, output type/empty/final-newline refusals retain the same reason and exact predicate, without retaining stream contents. |
| Numeric boundaries | Each PID/PPID/PGID/RSS lexical rejection; nonpositive PID/group, each identity overflow, RSS byte overflow; adjacent accepted limits, PPID 0 and RSS 0. |
| Duplicate identity | Duplicate PID fails even for an unrelated row; retain bounded current/previous metadata and precedence without merging RSS or selecting either row. |
| State alphabet | Every existing leading state and modifier is accepted at its original position; invalid leading/modifier and non-ASCII code points reject; long diagnostic STAT truncates without changing parser acceptance. |
| Start identity | Valid normalized date; syntax, impossible date and weekday/year refusals; unknown text redacted and whitespace bounded in retained start metadata. |
| Complete-row limits | Supervisor absence and exact 4096/4097 row boundary; every malformed/unrelated row rejects the query, with no partial RSS result. The finite input remains below the existing 1 MiB capture cap. |
| Earliest records | Earlier synthetic TAP failure then parser failure preserves both earliest records; later parser/join failures overwrite neither. Parser-first also preserves its original BoundError reason/stage/helper. |
| Accounting/link context | Current and duplicate PID/parent/group links are bounded candidate labels; no-recorded-link stays unresolved. Diagnostic data grants no ownership, RSS credit or absence authority. |
| Persistence/structure | In-memory recording makes no I/O; initialization, lost binding, sealing and existing cap failures permit no fallback write. Serialized diagnostic shape stays inside existing JSON bounds. In-memory boundary checks do not prove actual OS cleanup. |

Proposed ceiling for that future isolated selection: 10 seconds, 64 MiB aggregate
RSS, 1 MiB retained artifacts, 16 KiB terminal output, one worker; stdlib only,
no subprocess/probe/listener/browser/native/database/ledger access. Those are
proposal bounds, not a reservation or approval. Actual runtime/all-row/process
integration would still need its own separately reviewed, authorized selection
and independent completion audit after the boundary evidence.

Performed here: static retained-source/control-flow reading, bounded text edits,
independent stdlib metadata/hash authoring, named-path Git whitespace checks,
unchanged-region/helper/source/admission comparisons and publication. No helper
imports/execution, syntax/AST checks, ordinary ps observation, probes, cleanup,
live-ledger access, allocations, scratch/source mirrors, product tests,
listener/browser/native/full runs or descendants. No credentials or gateway
changes. Agents: requested/selected `gpt-6.1-sol/high`, no fallback.

Both revised allowances are consumed. A fresh exact assignment is required for
any next validation/execution selection; refreezing gives none. Grants 1016,
1029, 1220 and 1251 remain consumed. Earlier first-run setup failure/0 passed/
1 failed/3 not reached, root PASS721 cleanup, the retained C1 zero-fit body
tradeoff and all prior source identities remain separate. Earlier 81/81,
F77/F78 real corpus, default/reset, alternative fixture, browser/native/full-build
and whole-story acceptance gaps remain open. The exact helper-129 cause remains
UNKNOWN until authentic rejected metadata establishes it.
