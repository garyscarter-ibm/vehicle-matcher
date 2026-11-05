# FUCQ-94 representative body: scoped execution record

5 November 2026. Execute only the accepted representative scope in `ui-early-design-plan.md`, then stop for human review. Full-story acceptance remains incomplete. The dispatcher released one implementer and the consumed shared-control seam; shared navigation and backend/index/contracts remain frozen. FUCQ-95's frozen unmerged `ffc87ea` is not copied or used as an accepted design.

## Source, ownership and selection

Documentation commits `679ecf2` and `88140e9` were pushed. Wrapper/mutex reconciliation produced `363ee85548d2cf5fe7735cbefae15edab01d2daf` from clean base `4d1ec94fe6e0147ccac4d9fb51a38aeceb6b1ae9`. All ten frozen backend/controller/test/contract identities were compared before and after and preserved. No switch of the shared checkout occurred.

| Changed source / boundary | Regression and selected verification |
|---|---|
| `modes/question-ui.js`: single-slider update handle; option update handle; actual single-choice radio keyboard behaviour | New `gcsp-brief-controls.test.js` checks stable nodes/Set/focus, no callback/answer/default writes during update, explicit zero/unknown, disability, roving keys and unchanged retail/multiselect semantics. Existing `shared-kit-contracts.test.js` covers callback/legacy/default/order/card/gallery contracts. |
| `blocks/gcsp/brief/` mount, view, view-model, transport, layout and external harness; `gcsp-brief.html` | New `gcsp-brief-render.test.js` and `gcsp-brief-transport.test.js`, plus unchanged `gcsp-brief-controller.test.js`. Cover actual DOM controls and precise HTTP request/typed outcome boundary, independent values/importance/consent, typed practical input and cleanup. Fixture generator invokes real services, with source/snapshot identity recorded. |
| Explicit-member card, employee shell, gallery/catalogue and scoped styles | Existing `exact-listing-decision.test.js`, `gcsp-shell.test.js`, `render.test.js`, `ui-ratchet.test.js`; precise new-page CSP/copy/style coverage accompanies the consuming view. Shared shell/account/navigation implementations are read-only consumers. |
| First representative layout and interaction | Headless isolated Chrome capture at 1280x900 and 375x812; actual keyboard, stable focus, radios/ranges/consent, generated-preview limits, missing image/long name, reduced motion, console/request failures and overflow. One combined inspection/fix/confirm cycle, compared with approved FUCQ-64 `a7fc178`. |

The live affected-selector dry run reports no language plug-in and proposes `npm test`. That fallback is reviewed and excluded for this bounded early-design checkpoint. The final story's authored full-suite checkpoint and seven-state browser matrix remain pending after representative review. Frozen backend's 176 scoped checks are retained and not rerun for identical sources. Allocation, activity, offers, post-decline, Greg and unrelated large VIN/data checks are outside this source effect. Missing/stale impact observations are unknown, not proof of irrelevance.

Selected one-worker commands are registered in the supervisor:

```text
controls: node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-brief-controls.test.js server/test/shared-kit-contracts.test.js
ui: node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-brief-render.test.js server/test/gcsp-brief-transport.test.js server/test/gcsp-brief-controller.test.js
boundaries: node --test --test-concurrency=1 server/test/gcsp-shell.test.js server/test/exact-listing-decision.test.js server/test/render.test.js server/test/ui-ratchet.test.js
fixture: node docs/gcsp/evidence/fucq94/generate-representative.mjs
capture: node docs/gcsp/evidence/fucq94/capture-representative.mjs
```

Test commands run through `test_stamp.py --targeted gcsp-poc` with the explicit scoped reason. Code/test identity is recorded per command; changing a source or input invalidates only evidence that depends on it. Node file/function coverage is captured during the required new tests; no second broad run is used to populate the impact map. The shared impact record will name fixture/config/subprocess and unknown per-test-context boundaries.

## Resource ownership

Run: `fucq94-20261105-ui`. Before scratch allocation, registered:

- Manifest: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/ownership/fucq94-20261105-ui.json`.
- Supervisor/finalizer: adjacent `fucq94-20261105-ui-supervisor.py`.
- Exact disposable root: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/scratch/fucq94-20261105-ui`.
- Compact receipt destination: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/receipts/fucq94-20261105-ui/`.

One test/browser worker at a time, with initial chunk budget 256 MiB scratch, 1,536 MiB RAM and 600 seconds. The supervisor sets owned TMPDIR/TMP/TEMP, obtains a short-held HostBudget reservation, bounds logs, stops/joins child process groups in a finalizer, removes scratch and verifies filesystem absence plus released reservation. Reassess measured allocation and host headroom after each chunk; reduce/split before a retry. Preserve the 5 GiB emergency reserve. Installed dependencies and Git trees are retained environments, not disposable scratch.

Any archive or output expected to reach 256 MiB goes directly to `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq94-20261105-ui/`. None is expected. The browser's bounded active profile is a compatibility exception within this run's owned local scratch; record measured peak and teardown if used. Preserve the user's foreground app/tabs/focus; launch headless isolated Chrome only. No credentials are copied. Retain source hashes, counts and bounded useful failures; remove successful verbose logs after useful summaries are extracted.

## Checkpoints and agents

Pinned root `npm ci --ignore-scripts --no-audit --no-fund` restored the existing locked jsdom environment: 7.01 s, sampled peak RSS 151,011,328 bytes, peak scratch 6,997,984 bytes; scratch/groups/reservation absent afterward. No package/lock change is intended. Record final installed allocation and lock identity in the result.

Controls red ran before production edits: missing update-handle assertions, missing radio roving state and missing legacy keyboard mutation failed as expected. Supervisor receipt: `controls-1793885127671061000.json`; all scratch/groups/reservation absent. No success claim follows from the red run. The implementer owns its focused UI red/green sequence; the lead owns controls, gallery, final scoped boundaries and actual browser inspection.

Lead requested/selected `gpt-6.1-sol`/`high`. Implementer `/root/brief_editor_fucq94/representative_ui` requested/selected `gpt-6.1-sol`/`medium`, `fork_turns:none`, no fallback or descendants. Live tiers/date/capacity checked at 13:23 GMT, 5 November. Configured capacity reported zero under the explicitly advisory human session override; actual tree had two running agents before this authorized slot. Effective runtime settings remain to be independently checked. Child brief includes AGENTS, experience/reference, exact owned paths, selected checks, manifest/root, one-worker sequencing and teardown duties. No runner/reviewer/descendant is allocated.

Final representative result: `representative-result.md`. Scoped controls 21/21, UI 28/28 and boundaries 125/125 passed without skips. The real-browser startup defect received its own red/green upgrade regression. Fixture and seven representative/interaction/reduced-motion captures passed; final static detector returned `[]`. The complete desktop/375px renders were inspected after one bounded layout correction, then work stopped for human review. No full-suite or wider-state acceptance is claimed. The restored root lock stayed unchanged. Source key `3bf040bc643e94ff9f16d8b73ad3c4ecb0996f1345eb505d09d2c6fa11813851` pins final source/test bytes, while the browser matrix pins actual rendered inputs. Shared impact evidence records measured file/function coverage and unknown per-test contexts.

Final cleanup retained compact receipts and bounded failure excerpts at the registered destination. It verified twelve nested roots plus outer scratch absent, no live groups/reservation and no leftovers, and removed 299,008 measured allocated bytes of verbose logs/six owned log directories. The active headless browser profile was the sole declared local working-data exception; successful capture peak scratch 9,763,836 bytes, sampled peak RSS 161,087,488 bytes, removed afterward. Effective final-child runtime model/effort was not independently verified; requested selections above remain the reported selections.
