# C4 exclusive initialization ownership repair

6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Author-only repair from
`e0a0ecc695d7fda86c4bc9fbdc8c4624f9e8bf7e`; independent narrow review of the
new checkpoint and admission is required. C4 remains unexecuted.

## Decided: current diagnosis

Barney McGrew's independent static review held one MAJOR at `e0a0ecc`, admission
`74f3d50cb95e5d02751e44f72a9f336578bba1bc12386201a1534f5875d410fb`.
`Processes.initialize()` refused an existing run directory, but the outer
supervisor called `fail()` unconditionally. Its `save()` reached a nonexclusive
registry replacement in that unowned run. The check followed by
`mkdir(exist_ok=True)` also did not exclusively claim the run directory.

Review receipt, read only and excluded from this commit:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq122-helper-repair-static-review-0942.json`.
The same review passed static causal inspection of retained helper handles and
sticky failures, strict complete telemetry including all reported zombie RSS,
and pinned cleanup authority through inode-bound deletion. Those mechanisms
remain intact. Their earlier diagnosis and pins remain historical in
[case-release-probe-cleanup-repair.md](case-release-probe-cleanup-repair.md).

Basis: direct source/control-flow reading of the initialization, failure, save,
writer/readback and teardown paths and their callers. No runtime reproduction
or syntax/AST check was authorized. The defects skill remains applicable at
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/defects/SKILL.md`.
The existing GCSP build, experience and technical-readiness constraints remain
binding; this repair changes owned harness evidence only. No screen, product,
Jira, map, claim, source adoption or integration acceptance changes are made.

## Repair and static acceptance mapping

1. Initialization opens and binds the retained OUT directory, then uses
   descriptor-relative exclusive `mkdir` for the run and its ownership
   directory. Existing run names fail without opening or adopting the run.
   Held directory descriptors must match their named device/inode/UID/mode
   identities and remain physical directories owned by the current UID.
   Symlinks and changed bindings refuse ownership.
2. The initial process manifest uses an exclusive link from an exclusively
   created staging file inside the bound ownership directory. Directory fsync
   and exact bounded readback must succeed before `initialized` becomes true.
   The provisional manifest records the directory bindings before any monitor,
   shared helper or Scratch-constructor probe may launch.
3. Every subsequent registry save requires successful initialization, complete
   physical directory bindings and the last accepted single-link regular
   manifest identity. Replacement checks that target identity immediately
   before replacement. Staging, replacement, cleanup, fsync and readback use
   the held directory descriptor. Readback must match the exact staging inode
   and payload, with unchanged file identity around the read. There is no
   fallback pathname registry writer.
4. `fail()` retains sticky in-memory failure and cancellation. Before successful
   initialization, or after physical/manifest ownership is lost, it performs
   no registry write. An initialization collision reaches only the existing
   bounded external stderr diagnostic; it cannot replace the collision's
   manifest. Teardown closes held directory descriptors when initialization
   failed without helpers, or after final sealing. The normal pre-seal stop
   retains descriptors for the final proof and receipt.

The writer retains the existing encoding, structure, allocation, staging and
cleanup limits. Every helper remains gated by initialized ownership. No new
probe, process, allocation or command is introduced by this authoring work.

## Exact pins and preserved contract

Admission SHA-256:
`b3d1f7817e19aee5b9b7997535715e64af8c10815a7833fa84ed473c960f871b`.
Only the bounds and supervisor nodes change from `e0a0ecc`; there are still
25 admission nodes. The supervisor change explains the guarded outer failure
path; the ownership implementation is in the bounds helper.

| Owned helper | Bytes | SHA-256 |
| --- | ---: | --- |
| `case-release-bounds.py` | 45148 | `f0ef1df955b2163c385aed84a61c3e51476528081c0dbde32aacfe3a0bdf7bc2` |
| `case-release-supervisor.py` | 30764 | `f9f0d287331b2734f3b2c2ce803e96ba82fd947497295fcbce54b3f09c73b116` |
| `case-release-resources.py` (unchanged) | 20893 | `ec90d203ae61f0fab4f0a8b3d1ec0b81b595f5b18b1375e1d772427ecd3ef080` |
| `case-release-ledger.py` (unchanged) | 17133 | `8b9ef3ad344931700060ad769ed8cbc71f59d932f5dc0c5c29bfcd7398d42d8b` |

Source plan SHA-256 remains
`5daaae85cf909de78c4ec31dadd426f379902ed821597a38a14fcb768878f827`;
the original four-case test remains
`8250cf300944ef07f0a091fa46ba212b78fd854b32a3501e5703da8540898cd9`.
All other admission values and node identities are unchanged, including the
selected child/supervisor command templates, environment, source identities
and references, and complete numeric accounting contract. The reviewed
121 blobs/298 edges/138 installed files/18 source pins remain fixed; their
source review is not rerun here. Limits remain 120 seconds, 768MiB aggregate
RAM, 128MiB scratch plus retained outputs, 2MiB TAP plus journal, one worker
and a 30-second completion reserve, with full reservation and zero used/RSS
credit retained through final release.

## Validate and remaining gate

Performed: static text/control-flow inspection, independent stdlib file/hash
metadata authoring, comparison of all other admission values and frozen input
hashes, and named-path Git publication. The audit retains earlier receipts
without claiming they were re-executed. Agents: requested and selected
`gpt-6.1-sol/high`; no fallback or descendants.

No syntax/AST checks, C4 imports/helper/test execution, probes, live ledger
access, mirrors, test allocations or product/runtime edits occurred. No runtime
result or independent approval is claimed. Next is independent narrow review
at the exact new HEAD and admission. Execution still requires a fresh exact
C4 grant, then actual four-case evidence and an independent post-exit audit.
The prior accepted 81/81 proof and later live/browser/native/full gates remain
separate and unchanged.
