# Actual local producer → access checkpoint

The root-approved frozen proof plan at `17074a383a03c3b7e1da9b48039108fd07d4b30a`
was executed against published FUCQ-100 `a7fc8580efba36c329b2479711d6b66db53962bd`
and the current FUCQ-102 access implementation. No producer or shared source was
patched. The unchanged validation base is `b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96`.

`python3 -B docs/gcsp/evidence/fucq102/scoped-supervisor.py --producer --strict`
passed **31/31**, with zero failures/skips. The 28 prior checks were rerun using
the same six-overlay composition; central host routing used the actual buildServer
request listener in process, with no port allocation. Three integration checks cover
actual allocation/current-state access/custody/replay, actual expiry/reset, and the
then-published quote-expiry/no-actions presentation. A subsequently authorised
decline-only timing change is a separate checkpoint.

The real BriefService, manual context seeding, PolicyService, DemoIdentityAdapter
and DemoClock feed the published BuddyHoldService. Tests derive actual employee,
slot and stock revisions, use the committed outbox's link solely in memory, and
verify exact quote facts/terms/hold binding, partial current-car projection, account
and durable-cookie parity. Real producer expiry registration and DemoClock tick
expire the offer/hold and release stock at the persisted deadline. Repeated reads
do not mutate business rows. A real reset returns minimal earlier-run information
only for authenticated old links. Unknown/tampered links remain generic not-found.
Custody assertions are boolean only; no raw link or cookie is retained in evidence.

## Identity and evidence

`producer-source-plan.json` remains byte-identical to the approved plan, SHA-256
`103999b51420bd3845e42bfe6047debf2f34055d0de6efae19be907884e02e30`.
The six source overlay hashes are in that manifest and `producer-proof-plan.md`.
The loader SHA-256 is `3e7fb18629c2731351dd9ee19d0b97cbe687cd7df972f1e353bd390aca7a1c63`.
All 35 declared module identities and all six overlays were observed; the journal
contains 126 load records across the two sequential test files. The strict receipt
captures 49 source/loader/map/input identities, plus code and environment identity.

Retained shared run directory:
`.claude/test-runs/fucq102/producer-1793922823586098000/`

- `plan.json`, `summary.json`, `observed-modules.json`, `process-checkpoints.json`
- `parent-audit.json` and the external ownership manifest named in `summary.json`
- `strict/targeted-35a76cba5a48e4ed00d8021e432571802febcd28b5741f6327be1d185d6c3afa-default-1793922827524209000.json`
- Safe `producer-representative.json`; a formatted copy is committed beside this file.
- Shared impact map `.claude/test-runs/impact/fucq102-access.json`

The first attempt `producer-1793922784097202000` passed 30/31. It expected the raw
pinned display to equal its safe projection, overlooking intentional `photo:null`
and `images:[]` defaults. The test now compares pinned typed facts, stock identity,
display name and revision directly. Product code was unchanged. That failed run is
not acceptance evidence; its bounded failure log and separate parent cleanup audit
are retained. Its initial dependency flag meant the post-check audit was not reached;
the parent independently verified retained dependency identities afterward. The
supervisor now performs that retained-dependency audit even when checks fail.

## Parent resource receipt and remaining gates

Fresh HostBudget reservation: 120 seconds, 768 MiB RAM, 128 MiB combined
scratch/output, 2 MiB logs, one worker. The successful process completed in 2.238
seconds with peak RSS 229,064,704 bytes and scratch/output 192,837 bytes. Database
aliases, NODE_OPTIONS and debug tracing were unset. There were no listeners,
profiles, dependency links, native databases, browsers or external transports.

The supervisor and independent parent audit verified owned process groups absent,
scratch deleted, reservation released, pg inode/content unchanged, all 29 retained
source identities unchanged, and unchanged policy seed. Successful verbose logs
were deleted. No cleanup leftovers remain for either attempt. Small bounded output
does not require OneDrive.

This proves the declared memory producer/local-expiry boundary. Actual remote
uncertainty, complete current-car specifications/points, normal runtime bootstrap,
deployment, browser/origin/cookie behavior, actual FUCQ-106 integration and the
authored full suite remain separate open gates. No story acceptance or Jira
transition is inferred from this scoped result.
