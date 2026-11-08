# FUCQ-103 desktop smoke: incomplete

One dispatcher-admitted `smoke-desktop` ran on 6 November 2026 at published
`7dcee90ed65463832a9a757b211ffccf49e7e33a`, plan SHA-256
`d2545e4494d3c6e61fcae19d08bc4124a22f1a3b836825556bc9b1f7ba3b6abb`.
Grant: `fucq103-smoke-7dcee90-20261106`. No retry or journey followed.

Command: `FUCQ103_FROZEN_REVISION=7dcee90ed65463832a9a757b211ffccf49e7e33a /usr/bin/python3 -B docs/gcsp/evidence/fucq103/browser-supervisor.py smoke-desktop`.

The actual runtime/HTTP path reached all three smoke checkpoints: five explicitly
synthetic persisted subjects and the calculated 1100-point quote; presenter,
dashboard, independent custom elements, unique IDs and disconnect/remount; and
Paula's ordinary employee brief preview with 1100-point terms. Retained quote,
hold and offer rows remain identical. The final resource guard correctly failed
on three HTTP 503 responses from `/api/gcsp/presenter/scenarios`. There were no
page errors, external requests or desktop document overflow. Overall state is
**incomplete**, not a passing browser gate.

Diagnosis: the delivered runtime at this revision supplies no `gcspScenarios`
dependency. `server/index.js` passes it to `createScenarioRoutes`, while the real
presenter adapter requests the catalogue on page load. The central FUCQ-100/126
composition lane is implementing the actual service with the original policy
instance used by DemoClock. This branch supplies no stand-in or suppressed error.
That later integration needs its own source-matched executable/browser evidence.

Shared retained root:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq103-browser/smoke-desktop-fb26fd0c291e4207b22c11a523365812/`.
It contains `receipt.json`, `process-ledger.json`, bounded failure `run.log`, and
`output/results.json`. External manifest:
`../ownership/smoke-desktop-fb26fd0c291e4207b22c11a523365812.json`.

The parent and dispatcher inspected all original 1280x900 captures:
`output/draft-desktop.png`, `output/custom-elements.png` and
`output/employee-1100.png`. Logos and fonts load; shell spacing and controls render;
the synthetic employee car has an explicit absent-image fallback. These capture
the top viewport: the dashboard image does not show the lower publish panel, and
the employee image does not show the lower 1100-point term. Future captures must
scroll to those actual surfaces. These images do not close full visual acceptance
or prove 320px/keyboard/publication journeys. Component prose and raw policy-row
labels remain subjects for the later UI pass.

Requested/minimum RAM: 2560/2048MiB; duration cap 120 seconds; combined allocation
128MiB; logs 2MiB; one worker/browser. Peak RSS: 1,861,517,312 bytes. Peak combined
allocation: 11,728,280 bytes. Final retained allocation: 1,515,712 bytes, matched to
the actual filesystem. Before/after source identities match, and the dispatcher
independently rehashed all 426 repository/dependency/executable identities.

The exact scratch root `/private/tmp/test-stamp-shard-6e451e6a701c4d458c9b816872e471a0`
is absent. All 17 recorded PID/start identities and their group are absent; owned
ports 64349/64351 are closed; monitor/readers joined; open files are clear; the
reservation is absent. The owned dependency link was removed and its shared
target preserved. Driver cleanup reports no error. Parent and dispatcher checked
actual scratch/process/group/port/reservation/link absence, not only exit status.
Independent reviews are shared ownership files
`fucq103-smoke-parent-review-20261106.json` and
`fucq103-smoke-dispatcher-20261106.json`.

Runner: Wile E. Coyote; requested/selected/effective `gpt-6-luna` / `high`, no
fallback or descendants. Saved title and effective session settings independently
verified. The dispatcher released the browser lane and executable freeze after
review. The approved FUCQ-106/115 registry work follows; any browser successor
requires a new finite source catalogue, preparation and explicit admission.
