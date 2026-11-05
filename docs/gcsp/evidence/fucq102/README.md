# FUCQ-102 development checkpoint

5 November 2026. Backend only; this is scoped development evidence. The original
story is not built: actual producer/expiry, complete current-car facts, runtime
bootstrap/deployment, deployed cookie/origin/browser and authored full-suite
acceptance remain open.

`python3 -B docs/gcsp/evidence/fucq102/scoped-supervisor.py --strict` runs the named
story test with one Node worker, TAP reporting and an explicit read-only retained-pg
loader. Latest reviewed result: **28 tests, 28 pass, 0 fail, 0 skip**. The exact
underlying command is `node --test --test-reporter=tap --test-concurrency=1
server/test/gcsp-offer-access.test.js`, with the supervisor's source/dependency
injection arguments. No full/native/deployed environment is claimed.

The verifier/mint functions are the unchanged immutable FUCQ-100 source at
`5d8b01fe16d4cd16b4ff124619f0efe3e099a260`, SHA-256
`325b699d7dfdb435cd8713015017aa68bf735582f127d7d64a0e0fc819f7b915`.
That token checkpoint is published in FUCQ-100 ancestry at
`a7fc8580efba36c329b2479711d6b66db53962bd`. Only that self-contained module is
materialised into owned scratch. No producer implementation or foreign working
tree is copied, merged or modified. The unchanged validation base is
`b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96`; exact tested source hashes are in
`summary.json` and the strict receipt.

The real memory repository, PolicyService, DemoIdentity, DemoClock and recommendation
evaluator generate/read the pinned quote over explicit synthetic inputs. In addition
to streamed HTTP checks, one owned ephemeral loopback `buildServer` listener proves
central offer-route registration, preflight, shared gate, origins, anonymous exchange,
cookie reload, account parity, existing identity route and real reset/stale reads.
This does not prove normal runtime bootstrap or deployed browser composition.

The account decision regression records calls delegated to the real identity adapter:
views use `read`, `authorizeOffer(..., 'decide')` rechecks `write`, revoked ownership
is denied, and private token capabilities never fabricate an employee identity.
The published guard already had these semantics; its port is unchanged.

`representative.json` is the actual safe DTO from the services, including leading-zero
order number, typed points and provenance. `comparison-representative.json` exercises
the reviewed DISPLAY-only pinned model/source metadata with explicit synthetic input.
Its specifications/current points remain unknown and `comparisonAvailable:false`;
this is not complete comparison or actual producer integration evidence. Both samples
exclude link/session credentials, token hashes, employee identity, full brief and history.

Retained shared evidence (outside disposable scratch):

- `.claude/test-runs/fucq102/scoped-1793922270567388000/{plan,summary,process-checkpoints,ports}.json`
- `.claude/test-runs/fucq102/scoped-1793922270567388000/strict/targeted-e3b07b1950af5cc8b3bc0642367e3875cb862a0b204c4407011ab1cdfe28e3e1-default-1793922273528398000.json`
- `.claude/test-runs/impact/fucq102-access.json`

The external ownership manifest records `/private/tmp/fucq102-<run-id>` before
allocation and the supervisor finalizer. The reviewed run used 238,239,744 bytes
peak RSS and 35,708 bytes combined scratch/output, completing its test process in
1.672 seconds within 120 seconds / 768 MiB / 128 MiB / 2 MiB logs. Listener PID
59051, port 61958, closed and independently absent. All owned groups and scratch
are absent, reservation released, and retained dependency identity unchanged.
No dependency links, profiles, native database, external email or browser were
allocated. Successful verbose logs were removed. OneDrive is unnecessary for this
bounded small proof.

The first supervisor invocation returned zero but had no parseable test count;
it is not acceptance evidence. Explicit TAP reporting and a nonzero-check guard
make that failure mode visible. The successful run above has counts and source
hashes. Its strict targeted receipt is not a full-suite stamp.
