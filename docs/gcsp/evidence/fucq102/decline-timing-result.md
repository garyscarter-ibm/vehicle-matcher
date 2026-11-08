# Quote and hold decision deadlines

Root's review of authored FUCQ-106 criteria confirmed: quote validity gates accept;
an expired quote does not prevent decline while the exact eligible offer and hold
remain active before the persisted hold deadline. This authorised follow-up starts
after the frozen producer proof published at `e64acf1236ab24c5746f479c472b6a9023df0f9d`.

The access projection now returns `['accept','decline']` before quote expiry,
`['decline']` from quote expiry until hold expiry, and `[]` at the exact hold deadline.
Existing authentication, current-run, owner, pinned quote/hold alignment, eligibility
and pending/final-state guards remain. Reads neither extend the hold nor reprice,
change credential lifetime or mutate business authority. FUCQ-100 owns hold expiry;
FUCQ-106 still owns transactional command validation and actual decision integration.

`python3 -B docs/gcsp/evidence/fucq102/scoped-supervisor.py --producer --strict`
passed **32/32**, with zero failures/skips. A focused boundary regression checks the
second before quote expiry, exact quote expiry, second before hold expiry and exact
hold expiry, then compares all business tables with their original contents. The
actual producer regression also advances the real DemoClock and ticks registered
handlers to prove decline-only presentation with unchanged active hold authority.
The remaining access, authorization, privacy, actual allocation/expiry/reset and
in-process central-routing checks all passed under the same immutable composition.

The approved 35-source map remains unchanged, including the six exact a7fc858
overlays; all 35 identities and all six overlays were observed. The strict receipt
contains 49 source/loader/map/input identities. Changed access source SHA-256:
`134e9d39253e934618f6cf38b334bb7cf0f8912443ee159e6167b949d4fdb34a`.

Actual producer safe DTOs:

- `producer-representative.json`: SHA-256 `e50f3c56f3df4d3437a6fd2ec91e62fd713e0c1c5a42ce0d44753110a5535080`.
- `producer-decline-representative.json`: SHA-256 `c9a63f5b6dacfeb0c3720904ee218c085039903f55a74b551fb463fd70a626f5`.

Both retain partial current-car model/provenance and unknown specification/points.
Neither includes internal comparison binding/sourceRef or employee/credential data.

Shared run: `.claude/test-runs/fucq102/producer-1793922979495635000/`, containing
`plan.json`, `summary.json`, `observed-modules.json`, `process-checkpoints.json`,
external ownership manifest and independent `parent-audit.json`. Strict targeted
receipt: `strict/targeted-26c2f214597d73f39d76ece2da0dd435698b4fc86badbc73958eaed7ac0db365-default-1793922982986477000.json`.
The shared impact file is `.claude/test-runs/impact/fucq102-access.json`.

The fresh one-worker reservation allowed 120 seconds, 768 MiB RAM, 128 MiB combined
scratch/output and 2 MiB logs. Actual process wall time was 2.146 seconds, peak RSS
239,468,544 bytes and scratch/output 201,285 bytes. Database aliases, NODE_OPTIONS
and debug tracing were unset. No listener, browser, native DB, external transport,
dependency link or profile was allocated. Supervisor and parent independently
verified all owned groups/scratch absent, reservation released, retained dependency
identities and policy seed unchanged. Successful verbose logs were deleted.

This remains scoped memory evidence. Normal runtime bootstrap/deployment, deployed
cookie/origin/browser behavior, complete current-car facts, actual remote uncertainty,
actual FUCQ-106 integration and authored full-suite acceptance remain open.
