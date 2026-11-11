# FUCQ-398: Presenter Allocation

Approved reference: `docs/gcsp/mockups/buddy-allocation-2026-11-11/presenter-allocation-options.html`, Option A, 11 November 2026.

The Presenter adds an Allocation section below release stats, labelled **Buddy offers · this run**. It reuses `factList`, `loadingSkeleton`, `statusScreen` and Density tokens. The existing five stock counters remain separate. No new kit primitive, dependency, policy assumption or inline script is introduced.

## Authoritative source

`GET /api/gcsp/presenter/releases/latest` adds `value.allocation`: `{ pending, declined, accepted }`, or `null` when the source cannot be read. Reads remain presenter-only and run-scoped; no offer, employee or decision identifiers leave the route.

- Pending: an active Buddy offer and active Buddy hold, before the hold deadline on DemoClock. At the exact deadline it no longer counts, even before expiry processing.
- Accepted: offer state `accepted`, hold state `allocated`. The actual acceptance writer in `server/gcsp/offers/decision.js` writes these together. A requested decision, `selected` projection or reconciliation state never implies Accepted.
- Declined: offer state `rejected` or `declined`, released hold with `releaseReason: offer-declined`. The current employee-decline writer uses `rejected`; an expiry or system rejection does not count.

All offers in the current run count, independently of the latest stock release. Missing/malformed aggregate data paints **Allocation unavailable**, without numeric zeros. Valid zero values remain visible. The existing Release and readback/reset lifecycle rereads the same adapter, including before the first release and after a run change.

## Scoped validation

Selected before running: offer/hold projection and route mixture/error/isolation/deadline checks; actual memory/loopback HTTP release tests; Presenter release section, console and Basic flow tests; UI ratchet. One worker, bounded `test_stamp.py --targeted` chunks, no full suite. Parent owns desktop/narrow rendered review and integration acceptance.

First run: 182/185 checks passed. Two backend test modules could not import the existing declared `pg` installation; an ignored `server/node_modules` symlink to the main checkout's existing installation resolved this environment prerequisite. The third failure is the unchanged Presenter console CSS ratchet drift (44 lines, cap 39), already tracked by **FUCQ-387**, Low. This Story does not repair it. Allocation CSS's final ratchet count is 17, matching the existing cap.

Backend retry: 12/12 passed, including actual Main journey release (100 stock cars, 99 unallocated, Buddy Allocated 1, Allocation Pending 1). A new route-mixture test was added during that run, so the runner correctly declined a stable-tree stamp. Final backend/UI run: **56/56 passed**, base `b3d4c33e7129`, 103.7s, checkpoint `ef88bf3ddbdef8a5de4a36527b23b88ccb3687d720b3c5e86d3dec77e73f5673`; retained targeted evidence `targeted-a4df11c477dc700e95b5a51218178c93c301777c783cc9cd2907fbcf7bfd6fcb-default-1794419730235763000.json`.

A subsequent integration inspection found that the existing Advanced **Refresh readback** button refreshed only the strip. The controls now expose optional `onReadback(state)`, and the console uses it to repaint its read models after that actual read. The regression test clicks the real Last tick tab and Refresh readback button, then verifies changed run counts and reset zeros. Backend code stayed unchanged.

Final UI/caller run: **137/137 passed**, 5.6s, checkpoint `45aa2f6556054e59825b299d52c4bcdb307c8d37b920f13e8c5820e83727d3d3`; retained targeted evidence `targeted-7997bc5362bb036c3923d1dfed0f66d2ecefc49ff67d337da8bcfaf3059f580f-default-1794420751581912000.json`. Command: `node --test --test-concurrency=1 server/test/gcsp-presenter-controls-render.test.js server/test/gcsp-presenter-release-section.test.js server/test/gcsp-presenter-console.test.js server/test/gcsp-presenter-basic-console.test.js` through `_tools/test_stamp.py --targeted HEAD --reason ...`.

The same final UI files plus `server/test/ui-ratchet.test.js` gave **276/277 passed** (6.1s); its only failure is the unchanged FUCQ-387 console cap. Allocation CSS growth/shrink checks both passed. Bounded failure log: shared `.claude/test-runs/logs/20261111-175601-2kccbyrf/chunk-0001.log`. `git diff --check` passed. These are scoped checks, not a full-suite stamp or rendered acceptance.

## Integrated-base checkpoint

Merged the agreed `gcsp-poc` base **d3a768d3** without conflicts. Final tested HEAD: **e89982c5**; base includes the retained synthetic-stock repair and current allocation/runtime changes. The original six-file functional scope reran through `_tools/test_stamp.py --targeted d3a768d3 --reason ...`: **150/150 passed**, one worker, 105.6s. No failed, skipped or cancelled tests in that scope. Command:

```sh
node --test --test-concurrency=1 server/test/gcsp-presenter-allocation.test.js server/test/gcsp-presenter-releases.test.js server/test/gcsp-presenter-controls-render.test.js server/test/gcsp-presenter-release-section.test.js server/test/gcsp-presenter-console.test.js server/test/gcsp-presenter-basic-console.test.js
```

Checkpoint: `d1af2d0409151083f5b257c3837da45f2f8028953f65ea1da09daadfa731773b`. Targeted receipt: `targeted-e11acf9d0ada9467f5ab91cbb1381cbd4c1284a8400d13e0640cd9898bb6b0cb-default-1794424887606380000.json`. Shared runner log: `.claude/test-runs/logs/20261111-184846-pkgccpkf/chunk-0001.log`. The code/tree identity is recorded in that receipt. Peak owned scratch **2,400,544 bytes** (2.29 MiB), peak process RSS **992,395,264 bytes**; no large generated output. Runner shard removal and filesystem absence were verified. The 0-byte worker scratch root was also removed and verified absent. Existing FUCQ-387 ratchet drift remains recorded above; parent owns rendered review and final acceptance.

## Repeatable review

Use the normal trusted local demo startup documented in `docs/gcsp/README.md`, then `/gcsp-presenter.html`. Start again into Main successful journey, confirm, then release cars. The first real Buddy offer gives Pending 1, Declined 0, Accepted 0. Open the portal and complete an offer decision, then use Advanced / Last tick / Refresh readback on Presenter; an explicit decline increases Declined, an accepted offer increases Accepted. Start again confirms a new run and returns all three to 0. Repeat at desktop and 320px; keyboard access to existing controls and release stats remains unchanged.

For deterministic visual states only, intercept `/api/gcsp/presenter/releases/latest` in the browser harness and retain the real response envelope while replacing `value.allocation` with `{pending:14,declined:9,accepted:37}`, `{pending:0,declined:0,accepted:0}`, or `null`. Delay that response to inspect the three-label loading skeleton. These are presentation fixtures, not evidence of real producer outcomes.

## Ownership and cleanup

Agent Yosemite Sam (they/them): requested and selected `gpt-6.1-sol` / `medium`, no fallback, no descendants. Desktop title set and tool-confirmed as Yosemite Sam. IBM gateway check PASS.

Owned scratch: `/Users/garycarter/Documents/Codex/2026-11-11/oka/work/buddy-allocation-build/yosemite_sam`; ownership manifest is the sibling `yosemite-sam-manifest.json`. Test runner separately registers subprocess/scratch manifests and removes each shard. Budget: below 256 MiB scratch, one worker, chunks below ten minutes. Runner checkpoint receipts verify every owned shard removed; sampled scratch peaks were 0–2.29 MiB. The worker root remained 0 bytes and was removed with absence verified. No owned child process remains. The ignored server dependency symlink is retained for repeatable local checks; no installation or source dependency was changed. No browser process was launched by this worker.


## Parent rendered and real-command review

Merged source at `834c733c`, integrated with Buddy at `56117eee`. Actual local memory runtime, HTTP adapters and browser UI on 11 November 2026: before release all Allocation counts were0; first release produced Pending1. An actual employee decline followed by **Advanced / Last tick / Refresh readback** produced Pending0, Declined1, Accepted0. **Start again / Confirm** returned all counts to0 and restored focus to Release. A second fresh runtime reproduced Pending1 after the Buddy integration. Accepted outcome is covered by the scoped authoritative projection tests; a final accepted decision was not repeated in-browser.

Desktop1440 and narrow375 layouts were inspected; all three Allocation values remained readable, with document scroll width375 at viewport375. Saved chat outputs: `presenter-allocation-built-desktop.png`, `presenter-allocation-built-mobile.png`. Existing narrow header overlap is separately captured Low **FUCQ-400**, linked to original console Story FUCQ-360, with its screenshot attached. FUCQ-360 explicitly validated desktop only. The Allocation composition does not change that header.

Combined CSS ratchet after both merges:141/142 passed. Its only failure remains FUCQ-387 (unchanged console44/cap39); Allocation/release17 and Buddy15 pass. Source review and real-command checks used actual readbacks, not synthetic event injection. Neither a full suite nor production/PostgreSQL deployment smoke was run.
