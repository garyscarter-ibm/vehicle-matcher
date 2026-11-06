# C4 pinned system-launcher admission repair

6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Narrow author-only repair from
`3f3362f484661ea3b5fad94065eb2162fc5ab896`. No retry or new runtime grant.

## Decided: current diagnosis

Root reports that the one-use grant `fucq122-c4-3f3362f-1016` was consumed at
that checkpoint with admission
`b3d1f7817e19aee5b9b7997535715e64af8c10815a7833fa84ed473c960f871b`.
The supervisor exited 2 after 0.44 seconds, stdout was empty, and the exact
stderr was `C4 failure: BoundError\n`. No more detailed runtime error was
captured. Both recorded ps helpers joined with return code 0; the retained
manifest is uncertain with `scratchConstructor=not-started`, no scratch root
and no Node PID. No C4 test ran, and this consumed grant cannot authorize a retry.

The independent root audit is retained locally at
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq122-root-audit-1016.json`,
SHA-256 `86a88de3f51d2c8fa3bee3d21edafe2b254494fdfbf9d18e8cf7d9d07c8f98fb`.
Its disposition is PASS for absence of the supervisor/probes/groups/open files
and own reservation; runtime acceptance remains incomplete. The original
failure manifest and streams remain untouched and outside this commit.

Static causal evidence: `physical()` uses `BOUNDS.read_bytes()` for every
hashed physical input. That reader rejects `st_nlink != 1`. Initial
`admit(source_required=False)` reaches the pinned `/usr/bin/python3` before
scratch construction. Current read-only metadata confirms that `/usr/bin/python3`
and `/usr/bin/git` are two names for the same root-owned regular macOS launcher
inode, each with 78 links. This explains the observed boundary without claiming
a detailed exception message or rerunning the failure.

The repair must admit only those exact read-only system-launcher paths against
frozen physical/content/link metadata, checked before and after bounded reads.
Owned mutable outputs, ledger, registry, scratch and all other input readers
retain their single-link requirements. Existing source/input/command/environment,
count and budget scope remains fixed. The current AGENTS, defects skill, GCSP
build/experience/readiness and resource contracts were re-read. No product or
screen behavior changes, Jira/map/claim changes or descendants are authorized.

## Repair and static acceptance mapping

The supervisor and authoring collector now have a dedicated system-launcher
reader restricted to exactly `/usr/bin/python3` and `/usr/bin/git` on macOS.
The paths must resolve to themselves and be physical regular executable files
owned by root/root, without group/other write permission. Each admission node
adds a `systemLauncher` record binding device, inode, permission mode, UID/GID,
link count, byte size, nanosecond modification/change times and filesystem flags.
The observed record is identical for both paths: device 16777232, inode
1152921500312571586, mode 0755, UID/GID 0, 78 links, 118928 bytes,
mtime/ctime 1779353822000000000 ns and flags 524320. Their existing content hash
is unchanged:
`179301dcb41ea78accc3fa0048a7e6f6710d891945a751a34addd622020c1818`.

Both readers open with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`. The opened descriptor
and named path must match that full record before and after the bounded read;
the existing 4MiB input ceiling and exact byte size apply. Runtime admission
compares the full record with the frozen node before reading, then retains the
existing SHA-256 and complete physical-row equality checks. The collector
authors the same metadata with the same before/after checks. It was edited
but was not imported or run for this repair; current pins were authored through
an independent stdlib metadata read instead.

All other physical inputs still use the unchanged `BOUNDS.read_bytes()`;
that reader continues to require one link. The bounds, resources and ledger
helpers are byte-for-byte unchanged, preserving the single-link output,
registry, ledger and scratch checks, exclusive initialization, retained process
handles/sticky failure, complete telemetry/all reported RSS and held cleanup
authority. No generic reader parameter or blanket hard-link allowance was added.

Future outer stderr adds only one fixed source-authored phase label to the
exception type, under the same 4096-byte and deadline bounds. The phases are
bootstrap, registry initialization, monitor start, initial admission, shared
imports and execution. No exception text, input values, paths, credentials or
helper output are included. This cannot retrospectively reveal more about the
retained failure's type-only diagnostic.

## Exact pins and preserved scope

Admission SHA-256:
`75e3f80e749d184b6e749ec899e0125b669cf91c68681ea560bb4f8852aa373b`.
There are still 25 nodes. Only the two helper pins below change, and only the
two existing launcher nodes gain `systemLauncher` metadata. All existing
executable physical/content fields and all other admission values are unchanged.

| Changed owned helper | Bytes | SHA-256 |
| --- | ---: | --- |
| `case-release-freeze.py` | 18529 | `16192e1263c74ca9d8d64669be5954ccddee6bf52c3912e75f961c9c319e0223` |
| `case-release-supervisor.py` | 33294 | `f13ea15ace4075eb72ec1a22f85810b419c865859d574a0324c50fb6dfa72adf` |

Unchanged bounds/resources/ledger pins remain, respectively:
`f0ef1df955b2163c385aed84a61c3e51476528081c0dbde32aacfe3a0bdf7bc2`,
`ec90d203ae61f0fab4f0a8b3d1ec0b81b595f5b18b1375e1d772427ecd3ef080`,
`8b9ef3ad344931700060ad769ed8cbc71f59d932f5dc0c5c29bfcd7398d42d8b`.
The source plan remains
`5daaae85cf909de78c4ec31dadd426f379902ed821597a38a14fcb768878f827`,
and the four-case test remains
`8250cf300944ef07f0a091fa46ba212b78fd854b32a3501e5703da8540898cd9`.
The 121 blobs/298 edges/138 installed files/18 source pins, argv/environment,
four selected cases, full accounting contract, 120-second/768MiB/128MiB/2MiB/
one-worker ceilings and 30-second completion reserve remain unchanged.

## Validate and remaining gate

Performed during this repair: static text/control-flow inspection of the
affected readers and their admission callers; independent bounded stdlib
physical/content/hash metadata authoring; comparison of every other admission
field/node and the frozen source-plan/test hashes; read-only hash comparison
of the original failed evidence against the root audit; named-path Git
publication. Historical receipts remain historical. Agents: requested and
selected `gpt-6.1-sol/high`; no fallback or descendants.

No syntax/AST checks, C4 imports, collector/helper/test execution, probes, live
ledger access, mirrors, test allocations or runtime retry occurred during this
repair. No runtime result for the new paths is claimed. Independent narrow
review, fresh current admission and a new scoped C4 grant remain required.
The consumed grant stays consumed. Earlier 81/81 and real-corpus/default-reset/
native/browser/full acceptance boundaries remain unchanged.
