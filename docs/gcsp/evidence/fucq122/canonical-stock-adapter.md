# FUCQ-122 canonical stock adapter checkpoint, 6 November 2026

The case service now consumes canonical released stock through the existing
`createRepositoryManualPorts.releasedStock` port. This is a scoped implementation
and unit-validation checkpoint for DEV-2026-11-04-084, not completion of FUCQ-122.
The [original diagnosis](runtime-stock-contract-2026-11-06.md) remains historical
evidence at its recorded source pins. Its proposed case-side adaptation was
subsequently authorised, including binding eligibility from persisted drivers.

The related-story basis is FUCQ-122's existing feasible alternative-car remedy.
Canonical `released` rows previously failed the legacy `available` state check;
their normalized `facts` also differed from the old nested recommendation fixture.
The current persisted manual-context fixture has driver eligibility on
`drivers[].eligible`, without `employeeFacts.driverEligible`. Copying that latter
object alone left eligibility unknown. These case-side causes are addressed here;
central runtime/Greg producer composition remains FUCQ-100's responsibility.

## Implemented contract

- A candidate must be `released`, explicitly `available === true`, neither held
  nor allocated, and free of every canonical occupying hold/claim state. The case
  imports the repository's `OCCUPYING_STATES` rather than maintaining another list.
- The existing released-stock port supplies exact normalized snapshots,
  configuration identity and versioned availability. Its company, scheme and
  employee visibility rules apply to the persisted case employee. There is no
  fallback to legacy `available` rows or nested recommendation candidates.
- The port's repository facade delegates reads to the current reader's `get` and
  `list`. During a command these are the transaction's methods; no global service
  repository read/query occurs inside the case transaction.
- Employee/company/scheme/grade/slot come from the current persisted case employee.
  Run, environment, prepared policy and clock remain server-owned. Port scope and
  employee repository version must agree with the employee being evaluated.
- Exactly one current contract must match that employee, scheme and slot, and its
  `contractId` must equal the current entitlement slot's binding. Exactly one
  persisted driver must match its `driverId` and employee. The evaluator receives
  that driver's actual provenance-bearing `eligible` fact, overwriting any
  contradictory cloned `employeeFacts.driverEligible`. A nominated driver can be
  bound; array order does not select a driver. Nothing invents eligibility.
- The shared recommendation evaluator retains policy, essential, points, charging
  and timing gates. Missing/unknown evidence or a source failure remains
  `unavailable`; known unsuitable, invisible or occupied stock is refused. The
  existing brief charging projection is retained, including unresolved evidence.
- Updating a case rechecks current evidence inside its transaction. A successful
  remedy remains only `{ type: 'alternative-car', orderUuid }`. It updates the
  case/history and notification outbox, plus repository command receipts. It does
  not claim, hold, allocate or change the stock or entitlement inputs.

Only `server/gcsp/cases/index.js`, its two owned test suites, and this unique
contract record changed. Common ports, runtime, recommendation core, policy and
kit stayed read-only. No shared contract, Jira relationship, claim or product-map
record was edited.

## Scoped verification

The explicit targeted selector dry run succeeded against source base
`4296a9a4156665bf42c7dd4d5a99f7b5c5fa8f57`. Actual checks ran through the previously
authorised bounded supervisor:

```sh
env -u NODE_OPTIONS python3 -B docs/gcsp/evidence/fucq122/scoped-supervisor.py \
  --name canonical-stock-adapter-unit --rss-mib 768 -- \
  node --test --test-concurrency=1 \
  server/test/gcsp-case-options.test.js server/test/gcsp-renewal-case.test.js
```

Run `canonical-stock-adapter-unit-5967bf8358` passed **81/81**, with zero skipped or
cancelled checks. Positive projection uses employee-restricted visibility; the
proposal test guards against global repository access during the transaction and
compares every unaffected domain table. Regressions cover explicit availability,
legacy shapes, each visibility exclusion, all four occupying states in both holds
and claims, state/visibility/suitability changes after projection, expired/future
timing, missing snapshot identity/version/source/facts, unknown availability and
driver evidence, contradictory copied facts, nominated drivers, ambiguous or
mismatched contracts/drivers and changed eligibility. Existing renewal, policy,
notification rollback and authenticated HTTP cases run in the same two suites.

The first run, `canonical-stock-adapter-unit-2372ce00db`, passed 78/81. Three failing
test nodes represented two new test mistakes: selecting an unrelated seeded row
by array position, and making an expired interval end before it began. The tests
were corrected to select the exact UUID and use a valid expired interval. No
product repair was needed for those failures. Its identities, log and cleanup
receipt are preserved.

The final tested worktree had the source-base HEAD above plus these exact edits:

| Path | SHA-256 |
| --- | --- |
| `server/gcsp/cases/index.js` | `a080a47479444a94f041de1b0c094974c3eea655a8076f771ec33f82ecb43379` |
| `server/test/gcsp-case-options.test.js` | `b0bce6aae0cf4c265ed907f24bbc056868c153c5d5c49106b8d522219ad47cf9` |
| `server/test/gcsp-renewal-case.test.js` | `3f47209fdacd59464613620a27f4a2b630e73a3cc107c47777da3efb7ee83669` |

A finite static import/fixture graph hashes 87 own-checkout files, including
literal dynamic imports, literal URL assets, policy/fixture inputs, package locks
and supervisor code. Directory assets are bounded and hashed, not copied or run.
External packages are covered by locks and adopted installed identities. Dynamic
nonliteral edges are not claimed as observed coverage. Before/after source and
dependency identities matched. This is scoped evidence; no full/native or strict
same-source full-suite stamp was created.

Shared machine-local records, under
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/`:

- Plan/checkpoint: `fucq122-options/canonical-stock-adapter-plan.json`.
- Impact/function-to-test selection: `impact/fucq122-canonical-stock-adapter.json`.
- Final run: `fucq122-options/canonical-stock-adapter-unit-5967bf8358/`, containing
  `summary.json`, `source-before.json`, `source-after.json`, bounded `check.log` and
  `independent-cleanup.json`.

## Resource receipt and remaining acceptance

Both launches used a fresh HostBudget reservation/finalizer, one worker, 120s,
768 MiB aggregate RSS, 128 MiB owned scratch and 2 MiB logs, with database/PG
environment removed. The final run took 5.520s, peaked at 305,872,896 RSS bytes and
allocated zero scratch bytes; its retained log is 6,450 bytes. The scratch root was
removed. Independent checks found the owned process group 23234 strictly absent
(`False`, not an uncertain query), the supervisor owner gone, reservation absent
and manifest `removed`. The failed run's group 22559 and other resources were also
independently verified absent before rerunning.

Adopted dependency targets stayed unchanged: root `node_modules`, device 16777232,
inode 149213145, 27,138,292 allocated bytes; shared `server/node_modules`, device
16777232, inode 172770727, 858,816 allocated bytes. The exact borrowed worktree
`server/node_modules` symlink (inode 172924312) is excluded from commits and removed
when parking after publication; target directories are preserved. No browser,
native database, full suite or foreign immutable producer graph was launched.

These tests use **canonical-shaped synthetic rows**, not output exercised through
the actual FUCQ-92 release producer. That producer-to-options-to-proposal proof
still needs its reviewed frozen integration plan/grant. Actual FUCQ-106 decisions
and lifecycle exceptions, delivered FUCQ-100 runtime/Greg/activity/order-progress
composition, the remaining desktop/narrow options/deadline/resilience/preview
matrix, authored full suite and strict same-source stamp remain open.

This backend response change affects what can appear as an alternative and how
unknown data is reported. It adds no screen/control/style. Follow
`docs/gcsp/experience-quality.md`, the supplied shell references and current shared
components at the next authorised rendered check. All earlier 54 personally
inspected browser captures retain their original source identities; they do not
validate this changed adapter. The old browser source guard is intentionally
unchanged and requires a reviewed refreeze before any future browser grant.

Dispatcher handoff: record this as a validated case-adapter checkpoint with live
producer/rendered/full-suite acceptance outstanding. Preserve Jira dependencies,
existing claims and shared writer ownership; no Story completion is implied.
