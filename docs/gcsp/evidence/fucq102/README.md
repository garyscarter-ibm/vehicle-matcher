# FUCQ-102 independent access checkpoint

5 November 2026. Backend only; this is scoped development evidence. The original
story is not built: actual producer/expiry, current-car comparison, central host,
deployed cookie/origin/browser and authored full-suite acceptance remain open.

`python3 -B docs/gcsp/evidence/fucq102/scoped-supervisor.py` runs the named story
test with one Node worker, TAP reporting and an explicit read-only retained-pg
loader. Latest reviewed result: **22 tests, 22 pass, 0 fail, 0 skip**. The exact
underlying command is `node --test --test-reporter=tap --test-concurrency=1
server/test/gcsp-offer-access.test.js`, with the supervisor's source/dependency
injection arguments. No default/full/native environment is claimed.

The verifier/mint functions are the unchanged immutable local FUCQ-100 source at
`5d8b01fe16d4cd16b4ff124619f0efe3e099a260`, SHA-256
`325b699d7dfdb435cd8713015017aa68bf735582f127d7d64a0e0fc819f7b915`.
Only that self-contained module is materialised into owned scratch. No producer
implementation or foreign working tree is copied, merged or modified.

The real memory repository, PolicyService, DemoIdentity, DemoClock and recommendation
evaluator generate/read the pinned quote over explicit synthetic inputs. The
streamed HTTP checks create no listener. `representative.json` is the actual safe
DTO from those services, including leading-zero order number, typed points,
provenance and the deliberately unavailable current-car comparison. It contains
no link/session credential, token hash, employee identity, full brief or history.

Retained shared evidence (outside disposable scratch):

- `.claude/test-runs/fucq102/scoped-1793921533468934000/{plan,summary,process-checkpoints}.json`
- `.claude/test-runs/impact/fucq102-access.json`

The external ownership manifest records `/private/tmp/fucq102-<run-id>` before
allocation and the supervisor finalizer. The reviewed run used about 230 MB peak
RSS and 22 KB combined scratch/output, within 120 seconds / 768 MiB / 128 MiB /
2 MiB logs. All owned groups are absent, scratch is absent, reservation is released,
and the retained dependency identity is unchanged. No dependency links, profiles,
ports, native database, external email or browser were allocated. Successful
verbose logs were removed. OneDrive is unnecessary for this bounded small proof.

The first supervisor invocation returned zero but had no parseable test count;
it is not used as acceptance evidence. Explicit TAP reporting and a nonzero-check
guard now make that failure mode visible. Later successful runs above have counts
and source hashes. No full-suite stamp is claimed.
