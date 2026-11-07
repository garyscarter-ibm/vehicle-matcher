# FUCQ-103 single keyboard type-ahead attempt — 6 November 2026

**INCOMPLETE / exit 1. No retry.** The [one selected proposal](keyboard-selection-source-proposal-2026-11-06.md) was executed once at 320×900. Keyboard type-ahead plus Tab changed the native selector from `price:price.choices-fs-uk.001` to `.002`, projecting 800 points. It did **not** select the requested `.015`/1100 target. The assertion stopped the scenario before the 1200 edit, Preview or intentional Greg Publish/readback. No employee replay, remaining narrow scenarios or fallback key sequence ran.

## Observation and limit

The initial row differed from the target, and the full target label `choices-fs-uk · eligibilityModelKey: G21 Touring|320i` occurred exactly once among the saved/current projection's 147 price options. Actual Tab reached the selector with recorded solid 2px visible focus. The sole input was `page.keyboard.type(targetLabel, { delay: 20 })` followed by Tab; no mouse, `selectOption`, assigned value or synthetic change event selected the observed row.

| Observation | Actual value |
| --- | --- |
| Before | `.001`, F70 Sports Hatch / 120, 800 points |
| Requested | `.015`, G21 Touring / 320i, 1100 points |
| After | `.002`, F70 Sports Hatch / M135, 800 points |
| Candidate result | Failed target-row assertion; intended 1100 projection unverified |
| Subsequent selected actions | 1200 edit, Preview and Publish/readback not reached |

The [capture](keyboard-typeahead-1813/keyboard-row-selection.png) was inspected directly: focus is visibly on the exact input at 800; the slider metadata identifies F70 Sports Hatch / M135. The long selector label is clipped within its native control. Document/body width stayed 320, with no measured document overflow, and capture preserved focus. The value 800 matches **both** `.001` and `.002`; that number alone does not distinguish row projection, while the visible M135 metadata supports it.

This adds limited evidence of a native keyboard row change and matching selected-row metadata. It does not establish selecting the intended row by this type-ahead input, or a continuous keyboard row-selection/edit/Preview/Publish path. The exact error is retained in the [receipt summary](keyboard-typeahead-1813/receipt-summary.json): `Type-ahead did not establish the target native row; no retry`, actual `.002`, expected `.015`, runner line 454. No platform-level cause or product defect is confirmed by this observation; no repair or new closure gate follows from the failed candidate.

Reuse the completed [desktop](current-presenter-1727.md), [narrow connected observations](current-presenter-narrow-1725.md) and [service/HTTP/kit evidence](README.md). The prior failed Home/ArrowDown/Enter and Space/ArrowDown/Enter originals, the scoped desktop pass and the narrow incomplete result remain unchanged. This attempt is a separate receipt and does not overwrite them.

## Frozen variant and actual execution

The only runner changes were the selected unique-label type-ahead input and its recorded row/value assertions/capture, reporting that input honestly, and the agreed early stop before `actualEmployee` with `narrowRemaining` omitted. Existing fixture/runtime/host, session, keyboard edit and publication code stayed unchanged. Those later edit/publication steps were selected but not reached after the assertion. Unchanged synthetic memory setup still prepared the canonical five-subject cohort and pinned quote/hold/offer; it is not evidence of native persistence or actual producers. No intentional Greg policy publication occurred in this attempt.

- Selected shared revision: `1c91c7872b56cc18ec621a44ad627d93e2d2b276`. All 290 selected product/input files matched the actual read-only F100 runtime source, retaining product basis `52ec27f`/F100 `55d0831`.
- Original runner SHA256: `5dbda91a016c68aad4f1b4b3bcb04e13750b21c8a4d83bb94b5d3e7f142b2990`; separate variant: `095a43f352103c762b65a9f4a36458fe07d78340e137e85bcc48676c68fe5e58`.
- Unmodified retained supervisor SHA256: `463f77973463dae1420074effd27013f9c0798096601a66e26a857e2632e58bd`. A small launch input configured its existing `HERE`/`SHARED` paths, called the same `Supervisor.execute`/`finalize` and retained a capped log copy. No supervisor class, budget, ownership, strict registry logic or finalizer was replaced.
- Frozen source/helper/input/dependency/executable plan: 987 files, SHA256 `ee95e2a696383abf790b100a4233d75cda3374089abb6a3591dd9f770648828b`; before/after identities equal. The plan adds the 290 shared parity pins and four separate variant input files to the unchanged original 693-file plan.

Local retained base, relative to the shared checkout: `.claude/test-runs/fucq103/current-presenter-1718/keyboard-typeahead-1813/`. The exact `variant.diff`, `selection.json`, `launch-input.py`, `browser-runner.mjs`, `source-plan.json` and compact `checkpoint.json` are available there. The run is `journey-narrow320-6b0b331ea71e493c985d7dd61655cc6d/`; its `receipt.json` SHA256 is **`f90a37fe1675e73b04a1da0227f5507205eefc1ad2e9812ccf72a62a37877a6c`**. Original `output/results.json`, screenshot, process ledger, owned identities and external removed-state manifest remain independently readable. The published [78-byte log](keyboard-typeahead-1813/run.log) is byte-identical to the retained log. The summary binds artifact hashes and exact cleanup fields.

## Resources and disposition

Immediately before allocation, fresh capacity reported can_start 2/running 2/6.9 GB free, raw host registry `{}`. The existing strict locked HostBudget admission charged every raw row, observed zero, and reserved the selected 2560MiB recursive RSS, 128MiB combined scratch/output and 2MiB log limits, minimum RSS 2048MiB, one Chrome/worker and 120 seconds. The external manifest and registered finalizer preceded scratch allocation.

Manifest creation to final receipt took **10.627 seconds**. Peak recursive RSS **1,710,915,584 bytes**; peak combined allocation **10,642,776 bytes**; disposable scratch **10,335,448 bytes removed**. Receipt retained allocation was 663,680 bytes. Monitor/readers joined; owned PID/start identities, groups, profile references and open files were absent; ports **51182/51186** closed; scratch absent; token released. Identity/group/port/scratch/token absence was independently rechecked after completion. No dependency links were created. Local Chrome profile/IPC was the existing bounded compatibility exception; OneDrive remained unavailable and no archive/large output was generated.

F103 remains **In Review**, full acceptance incomplete. Required npm validation stays **1569 passed / 16 failed / 5 skipped, exit 1**; F144/F146 remain independent unrepaired backlog defects. Six original ACs and the story Result are untouched. No Done, full-suite pass, new feature/AC, native-F96/producer gate, product edit, install, new claim or agent is asserted. The single execution grant is consumed; no further runtime followed.
