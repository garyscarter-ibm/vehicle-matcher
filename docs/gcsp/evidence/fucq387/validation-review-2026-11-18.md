# FUCQ-387 — presenter stylesheet ownership and ratchet

Observed 18 November 2026, claim/base `841ddce886b0`. Scope is the original CSS validation defect related to FUCQ-365; no functional release, allocation, date, DOM or event contract changed.

## Diagnosis and repair

The ratchet deliberately counts `readFileSync(...).split("\n").length`, including the trailing empty item. The console was 44 / cap 39. The historical release 15 / cap 17 symptom was already removed by FUCQ-398 (`94eae706f`); at this base it is 17 / cap 17. Lowering that cap to its physical 16 lines would introduce a failure.

The five appended clock/day/week lines moved byte-for-byte into specifically capped `blocks/gcsp/kit/presenter-time.css`, beside the existing component styles. The actual standalone entry links it immediately after the remaining console sheet and before release-section.css, preserving the former declaration order. Console is 39 / cap 39; the new owned sheet is 7 / cap 7; release remains 17 / cap 17. Existing caps, baselines, counters and declarations are unchanged. The existing `dayBar` factory/date logic is reused rather than moved or copied. Its catalogue entry documents this ownership, and the actual component gallery reuses its update handle for past/current/weekend and unavailable-clock examples.

Exact supporting paths are enumerated in the claimed Bug's Delivery plan/Result. `release-section.css` and `ui-ratchet.test.js` require no edit because the current source contracts are correct.

## Scoped validation

Strict automatic affected selection refused the unsupported unspecified-language runner with exit2 and ran no tests. The explicit scoped dry-run selected exactly:

```sh
node --test --test-concurrency=1 server/test/ui-ratchet.test.js server/test/gcsp-presenter-console.test.js server/test/gcsp-presenter-basic-console.test.js server/test/gcsp-presenter-release-section.test.js
```

Result: **202/202 passed**, 0 failed/skipped/cancelled, 4.419 s test duration (4.597 s supervised wall), installed Node 26.7.0, one worker. Existing runtime dependencies were linked from the primary checkout; nothing was installed. Added regression assertions cover actual stylesheet adjacency and gallery reuse/marker/hidden states. The original ratchet counter is unmodified. These are jsdom/factory checks and stylesheet composition proof, not backend acceptance or a covering full suite. **Full suite: deferred to the parent's covering batch; no acceptance is inferred before that green run.**

The final source pin key is `7ef26e72361cadf3aca684412b1016df1ab6b3b5655c49ff34615a2567669350`. Local per-file hashes, measured worker/module/function V8 contexts and reviewed ownership/boundary map are retained in `.claude/poller/run-20261117-2335/resources/f387/source-pins.json`, `module-coverage.json` and shared `.claude/test-runs/impact/f387-7ef26e72361cadf3.json`. V8 worker contexts do not claim per-test attribution; reviewed module ownership supplies the conservative mapping. Missing observation excludes no tests.

## Rendered proof and limitations

Dedicated headless Chromium used the real final static stylesheet chain and real console/basic/dayBar/release factories with small synthetic input adapters. It did not touch the foreground app, existing browser, credentials, OneDrive, Render or an external service. At 1365 and 390 px the final 18 captures cover pre-release, loaded release/charts, long content and disabled reason, Advanced selected tab/keyboard focus, hidden clock/week, initial loading, inline confirmation/focus return, release loading and the gallery. Reduced-motion state also preserved the existing animation/transition suppression. No module, stylesheet, image or font request failed, and there were no browser runtime errors.

All 16 console cases compared against the exact pre-extraction HEAD console stylesheet with its original declaration position: computed styles, layout, marker state, focused control and screenshot pixels were identical. The two new gallery captures use actual `components.html` styles, normal gallery body and `.vm.vm-bmw.vm-component-gallery` ancestry. Local evidence is retained in `.claude/poller/run-20261117-2335/resources/f387/browser-summary.json` and its 18 SHA-pinned `captures/` images.

A first proof attempt stopped on an incorrect harness selector, after seven complete identical desktop pairs. The original failing log/receipt is retained as `browser-attempt1.log`/`receipt-attempt1.json`; the corrected run resumed incomplete cases only and reused the unchanged 202-test proof. Two initially isolated gallery captures lacked their actual gallery ancestor/body; those were superseded by corrected gallery-only captures, with `browser-summary-attempt2.json` preserving the earlier observation. Product source did not change during these proof corrections.

Independent review found the new gallery inherited the shell's full-screen minimum height. It now reuses existing `vm-gallery-gcsp` styling, with no new CSS or cap. The final four-file check passed 202/202 again after that source change; only the two affected gallery captures were repeated. Sulley independently reinspected both corrected widths and passed the final scoped review at 02:26:25 UTC, rehashing all 334 source/input pins and all 18 captures. The durable report is `independent-review-2026-11-18.md` alongside this receipt. The unchanged console CSS/factories/inputs retain their sixteen prior comparisons.

Preexisting observations for separate defect triage: the 390 px console header's brand/time content overlaps, and the loaded release grid reserves substantial blank vertical space. Both are pixel-identical before and after this repair. They are not newly introduced by extraction and were not silently folded into this Bug's CSS ownership contract. The final narrow/desktop loaded captures provide reproduction evidence; no native Jira item or status has been invented.

## Resource and cleanup receipt

One worker, serialized lane, shared HostBudget, owned local `/private/tmp/vm-poller-20261118-f387`, external ownership manifests and registered signal/atexit finalizer before allocation, owned TMPDIR/TMP/TEMP. Limits: 2 GiB scratch/RAM and ten-minute chunks, 5 GiB emergency disk reserve. Peak observed across attempts: 9,969,920 B working allocation and 1,036,926,976 B RSS. Local browser profile/tool data is a bounded compatibility exception under the explicit OneDrive prohibition; no OneDrive path was accessed.

All four finalizers stopped/joined their complete owned process group even on normal exit, removed only identity-checked dependency links/scratch, released lane/reservations and verified exact root/links absent with no living owned identities or cleanup issues. Finalizer checkpoints measured 384 B removed; raw V8 coverage and Chromium internal files were removed earlier without a separate removed-byte measurement. Retained evidence is small summaries/scripts/logs and final 18 captures (about 1.1 MiB), outside disposable scratch. Installed dependencies, source and worktree remain. Receipt JSON files preserve exact observation times and ownership. No leftovers.


## Refresh proof — 18 November 2026

Normal helper refresh merge `614c122c5` brought shared base `e8fe731c1` into the Story before Result commit `4a0def170`. The base delta changed Story metadata and dispatcher learnings only. All **334/334** source/input pins still match the independently reviewed source key `7ef26e72361cadf3aca684412b1016df1ab6b3b5655c49ff34615a2567669350`; the 18 final browser captures and review therefore remain applicable. No browser rerun or product edit was made.

The required refreshed four-file serial command passed **202/202**, 0 failed/skipped/cancelled, 4.449 s test / 4.908 s supervised wall at exact HEAD `4a0def170e35b10ead3776a5ba69ea9f95ebe812`, tree `e70a0d3025cac11b3d05159acc68968131127919`. Post-refresh measured coverage and receipts are preserved separately under primary `.claude/poller/run-20261117-2335/resources/f387/postrefresh/`; original proof receipts were not overwritten. This remains scoped, with full suite deferred to parent covering batch.

The new manifest/finalizer preceded allocation of `/private/tmp/vm-poller-20261118-f387-postrefresh`. Peak scratch 9,969,920 B / RSS 294,076,416 B; finalizer removed 64 B after raw coverage was removed earlier without a separate measurement. Exact owned process group, temporary root and two dependency links are absent; lane and reservation released; cleanupIssues `[]`, no leftovers or OneDrive access. Aggregate measured finalizer deletion across the original four attempts plus refresh is 448 B; earlier inner deletion remains unmeasured.


## Parent final metadata refresh

Normal final refresh to shared `5131f2728` (F392 documentation reconciliation plus dispatcher metadata) produced `c3a3f84b5`. Parent independently rehashed **334/334** recorded source/test/style/font/image inputs with no mismatch. The refreshed **202/202** four-file regression at `4a0def170` and all18 independently critiqued final render cases therefore remain applicable; no changed runtime input or new visual finding justifies another duplicate run. The postrefresh ownership receipt reports exact scratch/links/processes absent and no cleanup issue. Full Node→Java coverage and acceptance remain with the parent batch.
