# Render existing-store restore diagnostic — 11 November 2026

FUCQ-392 is related to verified Story FUCQ-62. This repairs a missing diagnostic;
the actual Render publication rejection remains unresolved until a new build
provides its underlying failure. No successful deployment is claimed.

## Observed failure and bounded investigation

Gary supplied a Render build log for `gcsp-poc` at
`cd7a965ebe9272e8f48ab817b0df3a8480120507`, Node 20.20.2. Dependency installation
completed, then `fleet-artifacts.mjs restore` reported `publish-existing` /
`store-rejected`. This branch is reached after the approved release's exact-byte
cache checks and cached full validation. The existing-store publisher's failure
result was discarded, and caught publication exceptions also lost their details.

The requested release is `3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30`
(`2026-11-07.12`). Only its 5,759,517-byte identity inventory was downloaded for
comparison, with the descriptor's exact size and SHA-256 verified. All 2,425
configuration record digests retained by the failed checkout agree with that
inventory, and its physical identities match. No configuration/VIN conflict was
found for those retained records. This does not prove a complete restore or
exclude filesystem, staging, concurrent-writer or damaged-existing-version errors.

A separate request to the configured vehicle-evidence health endpoint returned
HTTP 502. A retained corpus selection is not proof of a healthy running service.
Live Render logs could not be inspected with the available browser connection.

## Change and next build

`restoreFleetRelease` now includes the bounded publisher status, failure and
diagnostic under `validation`, with stage `existing`, while retaining the original
`store-rejected` code and message. Caught publication errors retain the existing
safe corpus diagnostic, including errno/syscall for filesystem failures. Public
presentation continues to omit diagnostics. Approval, checksums, source/history
validation, transfer behavior, release pins and retained data are unchanged.

On the next failed build, inspect `validation.failure.code` and
`validation.diagnostic` in the same JSON line. These identify the responsible
rejection instead of the previous generic wrapper. Preserve the existing store
and cache while diagnosing it; no cache purge or store replacement was performed.

## Scoped validation

Base: `d5f4002ea2ab089b9ea140ee2c3997bf6473136a`. Local macOS / Node 26.5.0.

Command: `python3 -B _tools/test_stamp.py --targeted origin/gcsp-poc --command
'node --test --test-concurrency=1 server/test/gcsp-fleet-artifacts.test.js
server/test/gcsp-vin-registry.test.js server/test/gcsp-fleet-build-entry.test.js'`
with an explicit diagnostic/CLI/retained-selection boundary rationale.

- 35 tests passed, zero failures/skips, 8.1 seconds through the supervisor.
- The real offline CLI uses two independently valid small corpora with the same
  dataset/version. It now reports `dataset-version-conflict` and leaves both the
  active pointer and inventory byte-identical; the previous corpus reloads.
- An injected `ENOSPC` publication exception retains errno/syscall, omits the
  private path, and preserves the previous pointer/inventory and public response.
- Both new regressions fail against unchanged upstream production code because
  the expected diagnostic fields are absent. The fixed source bytes were restored
  in a supervisor `finally` block; this is expected negative proof, not a passing
  upstream suite.
- The first fresh-worktree attempt could not import `pg`. The successful run reused
  the existing installed dependencies through an ignored local symlink; no package
  inputs or shared installed environment changed.

Targeted passing receipt:
`.claude/test-runs/targeted-a862674a1669b62805e502268029aefe8f0abb6f5a83805fa5f51d7a62bc11d6-default-1794411043154845000.json`.
The shared impact record maps the changed functions to the three boundary modules.
All supervised test scratch was removed after every run. The inventory comparison
used memory only. No full artifact pack, source collection, UI change or full test
suite was run. Render/Linux/Node 20 and live deployment remain unverified.
