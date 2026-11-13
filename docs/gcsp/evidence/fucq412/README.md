# FUCQ-412 connected evidence

Actual local memory-backed HTTPS application, captured mail only, no deployment. Tested executable checkpoint: `33c1661b2974919c63be0a61a573336284157e45`. Browser: installed Google Chrome, headless, 1440×900 and 375×812, reduced motion. Local TLS verification is disabled for the owned test server. Raw PNG/JSON evidence is retained in this directory locally and ignored by the repository's existing evidence policy; this index preserves its identity and review findings.

## Settled release and offer

Scenario `main-successful-journey`, fixture `main-successful-journey-inputs-v2`, policy `gcsp-policy-v1+offer-journey-v1`, run `demo-7321a8d034be2b72297ce85e977b5933`. Start at 5 November 2026, 09:00; apply the scenario's saved preferences and run the real 11:30 release. The small owned stock contains 100 cars; the eligibility path checks 100 and finds 44 suitable. Open the offer through the captured outbox link. Public pending/awaiting-decision state agrees with the active backend offer and hold.

Lead directly inspected:

- `main-release-presenter-image-verified-1440.png`
- `main-release-presenter-image-verified-375.png`
- `main-offer-email-link-image-verified-1440.png`
- `main-offer-email-link-image-verified-375.png`

Release images loaded 101/101 and offer images 9/9 at both widths. No unavailable images, image timeouts, page errors, blocked external origins or horizontal overflow were recorded. Offer points, allowance, deadline and decision controls are readable. At 375px the Presenter header overlaps brand marks and labels: the exact existing Low Bug FUCQ-400 remains unresolved. Reference review used `docs/gcsp/screens/00-employee-account.webp` and `docs/gcsp/screens/03-vehicle-series.png`; the standalone Presenter is the existing FUCQ-360 surface.

`image-verified-release-offer.json` retains readback and cleanup evidence with captured-mail token redacted. Initial loading screenshots established only capture timing and are superseded by the settled captures above.

## No-match and activity history

Lead directly inspected `no-match-presenter-no-match-{1440,375}.png`, `no-match-history-no-match-{1440,375}.png` and `no-match-release-offer.json`. Scenario `no-suitable-match`, fixture `no-suitable-match-inputs-v1`, run `demo-5bd02d322f59a170a04651dc0f4990a2`, same pinned policy. Reset at 09:00 and release at 09:30. Paula's nine-seat preference yields five checked, zero suitable, no current offer and zero Paula offers. The actual page says “No released car has 9 seats,” keeps the search/review controls visible and displays Preferences confirmed in activity history at both widths. The Presenter correctly counts the whole release of six cars, including a different employee's pending offer; its narrow FUCQ-400 header overlap persists. All seven Presenter images and the activity brand image load, without page errors or overflow.

Release command replay returned an identical successful receipt. Reusing its command ID with changed input returned HTTP 409 / `idempotency-input-changed`; clock version advanced only once, from 1 to 2.

## Conflict, replay and declined history

Lead directly inspected all final `conflict-replay-offer-conflict-{1440,375}.png` and `conflict-replay-history-{1440,375}.png` files after the last overwrite. The authoritative receipt for these current image bytes is **`header-probe-release-offer.json`**, run `demo-50f894822030caf1dba1ec68f25690f7`, same main-journey scenario/fixture. `conflict-replay-release-offer.json` records a superseded earlier run.

To trigger a deterministic conflict, the browser increases its outgoing expected offer version by 100 and submits the actual decline form. The server's actual HTTP 409 / `stale-version` response renders the warning and refreshed reason choices. No response is mocked. Warning, choices, close/confirm/keep controls and consequences are readable at both widths. A subsequent valid decline returns HTTP 200, identical command replay returns the identical receipt, and changed-reason reuse returns HTTP 409 / `idempotency-input-changed`. Current readback is declined/rejected/released and activity `offer-closed`; the visible declined BMW X2 card agrees. The final last-check display is 100 checked/40 suitable. The activity list displays Preferences confirmed; a decline timeline event is not claimed. All nine offer images and both history images load, with no page errors or overflow.

Lead also directly inspected the temporary settled narrow pending-offer probe before removal. It shows one header at the top and no lower branded strip. DOM evidence records one sticky `.gcsp-header` at y=0–56, scroll position zero, no running animations and nine loaded images. The earlier strip is a capture-state/compositor artifact, not an established product defect. Probe metadata/hash remain in `header-probe-release-offer.json`.

All required states have been independently inspected. Original AC4 remains **unchecked and unmet** because existing Low FUCQ-400 is unresolved; no completion waiver or Done status is claimed. FUCQ-484 separately tracks the existing Medium migration-test assertion failure, and four native PostgreSQL checks remain skipped. Under `docs/gcsp/build-rules.md`, “Demo delivery and scope control,” neither below-High defect blocks review/merge or creates a dependency: the coherent checkpoint is ready for dispatcher-serialized integration after FUCQ-409 while full acceptance/claim lifecycle remains open. No UI repair or interim human checkpoint is requested. The dispatcher subsequently supplied post-F409 and F423 bases; the revalidation below preserves the same open-acceptance disposition.

## Retention and cleanup

Eight superseded loading/original PNGs and the temporary header probe were removed. Twelve final PNGs remain. The ignored raw files also have a verified backup outside the worktree at `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq412/retained-connected-evidence`, owned by the adjacent `retained-connected-evidence.json` manifest. PNG/JSON bytes total 1,452,980. This preserves evidence through dispatcher worktree cleanup without changing the repository ignore policy. Original loading JSON and the first conflict JSON remain historical receipts; use the authoritative settled/final receipts identified above.

Final resource audit: 26 allocations removed, scratch roots absent, no live owned process groups/reservations; peak scratch 8,340,921 bytes, peak RSS 1,210,155,008 bytes. TLS/profile scratch and both temporary dependency links were removed, installed dependency targets preserved. Audit: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq412/final-cleanup-audit.json`. No deployment, native PostgreSQL acceptance or full-suite stamp is claimed.

## Retained raw file identities

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `conflict-replay-history-1440.png` | 209,271 | `2925eb550325e6ef9a7d3981eece8bbc57c8329d8b624ccc1dee7d0560576fcc` |
| `conflict-replay-history-375.png` | 87,563 | `f50b8fdfcc02927de73829f05dce832f8efb0b7fb06b141eb3205b3458ccd881` |
| `conflict-replay-offer-conflict-1440.png` | 207,569 | `ff1d5925dfb5e97e54ef056d592aba75222115ac2f894bc941c2c16f1facb782` |
| `conflict-replay-offer-conflict-375.png` | 51,763 | `ab247e87c47c4d46b052373b45e9585755d5678462045037935c312d2ce67f1a` |
| `conflict-replay-release-offer.json` | 9,287 | `82dbf9dbd3fd80726a387c62daf1ffe53a965befb94195685e1f1a056a1dbc8d` |
| `header-probe-release-offer.json` | 16,290 | `45b5a8a4e5d9b31c45d14eac501e1ffbdd452b1c037f71984328f60b025f8578` |
| `image-verified-release-offer.json` | 8,365 | `3ec54ae4aba2f7dd970868583fe93338b4f511328cd0e73739f2b9fb94c90982` |
| `main-offer-email-link-image-verified-1440.png` | 237,655 | `6b22575c41ad20bb52fb825d3b9efcb82f35a68c80a49757b713b8e0fad0ab12` |
| `main-offer-email-link-image-verified-375.png` | 53,142 | `46afdd09699affee77059b67c6f7e88ec63cda19cf6d7ad639130e9d48f253bd` |
| `main-release-offer-early-loading.json` | 7,643 | `ac4e00461aeed4fcc314fbf4b3d8fe3f21ef256cdc1ef83666281b95930eaf6b` |
| `main-release-offer.json` | 7,643 | `ac4e00461aeed4fcc314fbf4b3d8fe3f21ef256cdc1ef83666281b95930eaf6b` |
| `main-release-presenter-image-verified-1440.png` | 276,044 | `2a3ce782df2d4104b2a05415e05e8c0c016f1194308510bd7a874180b7ca0020` |
| `main-release-presenter-image-verified-375.png` | 67,430 | `d073aa70457d3dfd55cfc5483938e947f54ceec05dcd61269c7c5b448b7101ad` |
| `no-match-history-no-match-1440.png` | 45,536 | `7cf668e9acb5adc112d3e6bf66404971f99f32262bf8ed47083ca62a357798c1` |
| `no-match-history-no-match-375.png` | 35,899 | `1da1c68d628117709450e8391f3c0de44a3d3e3314f589394e0f692632019a41` |
| `no-match-presenter-no-match-1440.png` | 78,763 | `abb3c5d82abf47b934cb49a2ce37f2b1a0ca5fe5ac78bb1900a93257391ae3ff` |
| `no-match-presenter-no-match-375.png` | 45,116 | `50a3172ff7e62c31cc6b46f4330f0cbf4a4a1e9daa3bb7930a5bd7767d97ab42` |
| `no-match-release-offer.json` | 8,001 | `cf712b4081b306c82aa74db8e1364d2459566ada4554e83c2274b24317942ff6` |

## Post-F409/F423 evidence reuse

Latest tested worker merge `2f16eba47599db21dd71979ee1477fcc6822b67a` includes dispatcher base `0ab125ae952ab026476213dbcb06711235f049c6`. Six scoped modules on post-F409 `262a278d` returned 55 pass/one existing F484 failure/four native PostgreSQL skips. After F423 changed the core journal metadata and PostgreSQL flush/cache path, three freshly selected modules (journal, disconnect/uncertain commit, composed allocation runtime) returned **22 pass/zero fail/one native skip**. Five unaffected earlier module results remain tied to their actual tested SHA; no complete passing suite or native SQL proof is claimed. See the delivery record for both identities and selection.

All 292 selected visual/fixture identities and 30 helpers remain unchanged; the twelve PNGs/six JSON receipts still match the 1,452,980-byte outside-worktree backup. The screenshots above remain historical `33c1661b` captures, reused after input/source comparison and fresh composed-runtime checks, not new captures on this merge. AC4 remains unchecked/unmet, F400 Low and F484 Medium unresolved, four distinct native skips retained. Integration checkpoint ready; full acceptance open.

Both new phases removed all nine scratch allocations, stopped/joined owned process groups, released reservations and removed exact-owned dependency links with installed targets preserved. Latest audit: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq412/post-f423/final-cleanup-audit.json`; first-phase audit: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq412/post-f409/final-cleanup-audit.json`. Dispatcher retains publication/integration/Jira/lifecycle/cleanup.
