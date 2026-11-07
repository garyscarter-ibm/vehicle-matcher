# Authorised finite source pilot — 5 November 2026

The [authorised plan](../../../fleet-collection-runbook.md) permitted at most 12 read-only GET attempts. This run used **3 attempts**, received three HTTP 200 responses and downloaded **777,995 decoded bytes** in **724 ms** of client time. It stopped at `catalogue-steering-unconfirmed`, before solver, OTD, manifest or image requests. It produced **zero new configurations**, no images, no profile activation and no writes. The three previously proved configurations remain the only constructibility evidence.

| Retained file | Purpose |
|---|---|
| [evidence.json](evidence/evidence.json) | Sanitised actual request categories, status, bytes, timings and stop reason |
| [pilot-client.mjs](evidence/pilot-client.mjs) | Exact executed bounded client, retained for review; contains no credential values |
| [schema-review.json](evidence/schema-review.json) | Zero-request historical review and explicitly synthetic counterexample |
| [offline-schema-review.mjs](evidence/offline-schema-review.mjs) | Exact executed offline review source; archived output paths are already populated |

The live client chose the smallest matching model/AG subtree. It did not recognise `RL` or `RHD` there. **That is not evidence that the complete live source lacks RHD.** Raw settings and model-tree bodies were memory-only and discarded, so the actual live hierarchy cannot be reconstructed from this run.

The retained [1 November observation](../../fucq-4/observations-2026-11-01.json) contains `T5MJ`, AG `72HH` and `steering: "RL"`. The offline synthetic example shows that a shorter model/AG cross-reference can be selected instead of its fuller parent record and omit steering. It demonstrates a parser weakness, not the discarded live tree's actual shape. Its two assertions passed without network requests; it supplies no new source or profile evidence.

The next engineering check is a bounded allowlisted model-tree projection that preserves the relation between exact model/AG identifiers, ancestor paths, market/steering and date context. Review contradictory or missing values and test the extractor against synthetic nested cross-references before any revised pilot. Do not infer steering merely from the presence of an unrelated literal elsewhere in a tree. No further HTTP budget, retry, collection or profile edit is authorised by this evidence checkpoint.

The [source decision](../../../fucq-58-source-authorisation-2026-11-05.md) clears source, retention, display and pilot permission. Remaining gaps are UK profile/year/plant/era corroboration, all 31 scheme-line catalogue mappings, multiple actual configurations for each required WMI, and eventual constructible corpus coverage. HTTP 200 establishes access only. The full collection command continues to refuse.

Plan SHA-256: `7eee9fbc7636d61e83fd93192f1003fac0f711233f0d459b372fabdec3547b0e`.
Executed-client SHA-256: `5fa2142e2e1faac2286b52795f7ed2c891adbd99fe4a2d07781d736feb911efe`.
Offline-review source SHA-256: `aadd57f022de83a78334141212aad2e87c7a4ca871f8c2814c77e7d1fafb9ade`.

No browser/account session, raw response, request header, private VIN/plate/serial, image URL or credential value is retained. The scripts are historical execution evidence; rerunning them would require a new supervised execution plan. Local disposable scratch and successful verbose test logs were removed with filesystem absence verified; concise receipts remain under the shared test-runs directory named in the story Result.
