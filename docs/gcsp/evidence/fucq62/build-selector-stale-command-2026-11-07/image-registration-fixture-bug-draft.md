# Queued Jira Bug: image CLI fixtures reject expanded approved image registry

This is a local intake payload, not a created Jira issue. Root reported Jira OAuth unavailable. Reconcile existing FUCQ Bugs before creating, verify the originating Story and native Relates link, then create or reuse a Bug independently of the current build selector change.

- Project: FUCQ
- Issue type: Bug
- Priority/severity: Medium
- Labels: backlog, kind:code
- Intake marker: `gcsp-image-cli-expanded-registry-fixture-20261107`
- Work item type: bug
- Evidence: [] (no screenshots)
- Depends on: []
- Pickup: held for Jira duplicate/origin reconciliation; no repair authorised in this build fix.

## Goal

Restore meaningful offline image CLI regression coverage when the code-owned approved image registry contains more than the fixture's single source-backed image.

## Acceptance criteria

- The existing cold/repeated offline restore test reaches the real CLI and verifies its current assertions.
- The existing operator active verifier test reaches the real CLI and verifies its current assertions.
- The fixture includes only images with matching admitted source/configuration data, without widening production image approval or injecting CLI approval options.

## Files or areas

`server/test/gcsp-fleet-image-cli.test.js`, `server/test/helpers/vin-corpus-fixture.js`, and the code-owned image registration boundary in `server/gcsp/vehicle-evidence/registered-corpus-images.js`.

## Decided

diagnosis: reproduced both tests failing at fixture line 35 with `invalid-corpus` / `unapproved-image`, before `fixture.cli` is invoked; the fixture passes all `APPROVED_CORPUS_IMAGES` to its one-image `sourceBackedInput`. The registry now contains the original i5 image and a second F70 1F7E image. Fixture, input helper, registry and corpus publisher are unchanged from base `df3f3f439ba0aa2c4f464beaded903709e970ea1` (`git diff --exit-code HEAD --` those four paths returned 0). A separate base checkout was not executed. This affects automated validation coverage; no production image-admission defect is established. Medium severity reflects lost integration signal without demonstrated user-visible failure. Root explicitly deferred repair outside the current build selector change.

## Related story

FUCQ-62 is the delivery context in which the failure was observed. Origin is unresolved pending Jira reconciliation; FUCQ-60's image expansion is a candidate, not a verified native origin link.

## Story link basis

`docs/gcsp/evidence/fucq62/fleet-2026-11-07-5-plan.md` explicitly owns real image-bearing CLI regressions. Jira issue type/link readback is unavailable while OAuth is blocked. Verify the existing issue and reuse any matching Medium image-registration fixture Bug before creating this payload.

## Steps to reproduce

Run the selected command captured in `receipt.json` phase `green2`: Node with `--max-old-space-size=256 --test --test-concurrency=1`, selecting build-entry, Blueprint and image CLI files. The image fixture copies about 2.5 MB and uses no source download or SQL. Both image tests fail at fixture creation, before CLI execution.

## Expected behaviour

The fixture admits its single source-backed image, then cold/repeated offline restore and operator verification execute.

## Actual behaviour

Both tests report `invalid-corpus` with `unapproved-image` at line 35. The 11-check run records 9 passed, 2 failed, 0 skipped. It does not prove either owning CLI integration assertion.

## Out of scope

Production approval, live corpus changes, the stale build-command selector fix, new Story acceptance, and a new merge/build dependency.

## Validate

After a separately authorised repair, run the two owning image CLI tests under bounded scratch/resource supervision and retain exact code/input identity, failures, skips and cleanup evidence. Reuse unchanged transfer checks; no full suite is implied.

## Environment

macOS worktree `DEV-2026-11-04-032`, base `df3f3f43`, 7 November 2026. The phase's exact command, hashes, log hash and resource receipt are in adjacent `receipt.json`; raw bounded failure log remains in the ignored run control directory.
