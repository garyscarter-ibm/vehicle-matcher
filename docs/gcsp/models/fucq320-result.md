# FUCQ-320 dataset and offline evaluation

26 November 2026. Dataset slice only; application activation and Java integration remain with the story lead.

Data strategy: specified — existing offline synthetic data → digest-pinned artifact → dated PolicyService `choice.model.reference` publication/readback. PI held: none. No store, schema, eligibility, forecasting rule or model math changes.

Run from the tested story checkout with its shared Node dependencies linked. Supply a new local directory owned by the resource supervisor:

```sh
node scripts/gcsp/retrain-hatchback-choice-model.mjs --output "$TMPDIR/fucq320"
```

The recipe actually advances DemoClock to `2026-11-26T09:00:00.000Z`, adopts `offer-decline-reasons-v1`, `fucq113-learning-v1` and `fucq115-choice-model-v1` one second apart, then publishes `fucq320-dataset-80x4-v1` at `09:00:03.000Z`. It uses the existing generator CLI with `--snapshot --allow-fixtures`, then the existing training CLI with explicit current and retained policy files and actual FUCQ-99/FUCQ-29 baselines. It never publishes a model reference.

The isolated successor sets cohort 80, cycles 4, record bound 320, alternative bound 40,000, start at the publication instant, and narrows the reviewed evaluation cycles to `[2,3]`. Its sole additional demand assumption appends hatchback weight 25 to existing saloon 35 / estate 40 / SUV 25. Equal weight to SUV is explicitly assumed, not measured BMW prevalence. All other needs, learning/noise, held-out cohorts, canonical policy and eligibility values stay unchanged.

The current canonical four structural configurations include `F70 Sports Hatch|120` with 8 November review provenance. The full prepared snapshot is retained in the dataset manifest, labelled `reviewed-fixtures`; no vehicle corpus or observed employee-choice claim is made. Historical `choice-training-dataset.json` and artifact `2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d` are preserved.

| Identity | Value |
| --- | --- |
| Seed | `fucq320-canonical-80x4-v1` |
| Artifact | `sha256:e5205f65966d87d6895509bda13fa861e87476d843aabecce7bd76bf0e4fffc2` |
| Dataset content hash | `3a7fe8264fd267f339d0dd352ff9fece35bc6cccd3b248c95b1d6dc4e1f1a9bc` |
| Dataset file SHA-256 (1,739,908 bytes) | `bb29d17b0178972c4380a3858816eaeee9dea0d4d25c99f27c2e97833226f94c` |
| Prepared snapshot hash | `bf40be06bb8b4d51461cbbf9104812962fd83a12b2d89a145bcc42b44f438f50` |

320 records contain 293 waits, 27 offers, 14 selections, 14 acceptances, 2 declines and 11 expiries; event counts overlap. Projection excludes 13 censored outcomes. Training excludes the earlier G8-10 cohort (38 records); there is no temporal/cohort leakage repair or seed reroll.

| Partition | Records | Estate chosen | Saloon chosen | Hatchback chosen | Wait chosen |
| --- | ---: | ---: | ---: | ---: | ---: |
| Training | 116 | 2 | 1 | 4 | 109 |
| Later | 153 | 2 | 1 | 4 | 146 |
| Later familiar | 115 | 2 | 1 | 4 | 108 |
| Later unseen G8-10 | 38 | 0 | 0 | 0 | 38 |

Latest earlier-cycle baseline population: 59 employees; confirmed body demand is saloon 16, estate 16, SUV 13, hatchback 14.

| Model, later 153 records | Log loss | Multiclass Brier |
| --- | ---: | ---: |
| learned | 0.136802827824 | 0.0435281173542 |
| expressedDemand | 0.159073664071 | 0.0443184430002 |
| deterministicFit | 0.149564718112 | 0.0440328228219 |

Learned minus expressed-demand deltas: log loss −0.0222708362470, Brier −0.000790325646029. Learned minus deterministic-fit: −0.0127618902875 and −0.000504705467729. All overall zero-probability-outcome counts are zero.

| Learned class | Exposed records | Observed choices | Binary log loss | Binary Brier | Thin |
| --- | ---: | ---: | ---: | ---: | --- |
| estate | 3 | 2 | 0.0719238783823 | 0.00659177075598 | True |
| hatchback | 7 | 4 | 0.0739711080117 | 0.00915489464386 | True |
| saloon | 3 | 1 | 0.0491447037929 | 0.0023030775049 | True |
| wait | 153 | 146 | 0.00358585148381 | 0.000427535053698 | False |

| Later cohort | Support | Learned loss / Brier | Δ loss / Brier vs expressed | Δ loss / Brier vs fit | Thin |
| --- | ---: | ---: | ---: | ---: | --- |
| G1-6 | 58 | 0.1874288394 / 0.06501458191 | -0.0008357616719 / +9.787103082e-05 | -0.0008357616719 / +9.787103082e-05 | False |
| G11-14 | 18 | 0.369236686 / 0.1068111087 | -0.1246706669 / -0.004644316187 | -0.07455501972 / -0.003203269806 | True |
| G7 | 39 | 0.08753075963 / 0.02477836532 | -0.02858696832 / -0.001102529545 | -0.01441294056 / -0.0006471179447 | False |
| G8-10 | 38 | 0 / 0 | +0 / +0 | +0 / +0 | False |

Positive deltas above are adverse and retained. Full baseline class/cohort/reliability and both holdout reports remain in the immutable artifact. Familiar 115-record learned loss/Brier: 0.182007240497 / 0.0579113213495. All 38 unseen-cohort outcomes are wait-only, yielding zero loss for every model; they do not establish useful unseen vehicle-choice generalisation.

| Learned reliability band | Alternative events | Mean predicted | Observed rate |
| --- | ---: | ---: | ---: |
| 0–0.1 | 249 | 0.0267249878917 | 0.0281124497992 |
| 0.1–0.2 | 2 | 0.172739007481 | 0 |
| 0.9–1 | 146 | 1 | 1 |

The seven bands from 0.2–0.9 have no events. Reliability is one binary event per alternative. All non-wait classes are thin under the existing descriptive minimum 20; this is not an activation cutoff. The optimizer reached `iteration-limit` at 1,500 iterations, gradient norm 0.000365949039513 versus requested 0.000001; objective 0.197415091701 from 0.235828489108. No optimizer/seed tuning followed. This engineering dataset is wait-heavy and not calibrated to BMW behaviour.

Validation is scoped. The new hatchback forecast test failed against the historical artifact as `outside-coverage`, while its 15 peers passed. The final forecast file passes 17/17 with the successor, including the historical hatchback refusal, genuinely unseen coupe whole-cohort refusal, held-out/unknown/wait exclusions and baseline-only submit contract. `node --test --test-concurrency=1 server/test/gcsp-choice-model.test.js` passes 14/14. Its new reproduction test changes mocked wall time by one day with identical policy input, compares actual baseline provenance and verifies identical artifact bytes.

That reproduction test failed before a one-line repair: the offline baseline repository omitted its existing `now` port, so row wall timestamps changed Greg’s projection version and artifact digest. `baselines.js` now supplies `now: () => read.asOf`. Future offline preparation becomes deterministic; published artifacts and runtime repositories are untouched. Rejected candidate identities `b1852f1400140d8bf3a832b159c299559643d575199f6f00a61308806e65db8b` and `094034f1c4ee9f581764ed000ecf0bcd242b7b38c61b3ec81fd96a3d65ca82d3` differed only in expressed-demand provenance versions and their enclosing digests; owned rejected copies were removed.

Prior setup evidence: missing `pg` prevented the first load; shared cache links resolved it without installation. Before reviewed decline-reason adoption the actual trainer returned `baseline-unavailable/FUCQ-99.readDemand`; that first raw failure log was overwritten, so only its observed code/field is retained. With decline reasons adopted but original needs, it returned `baseline-unavailable/FUCQ-99.exact-body-count`: the training population had saloon 19 / estate 22 / SUV 18 / hatchback 0. The approved isolated hatchback assumption resolved that source gap without weakening baseline refusal.

Resource supervisor used one worker, 120-second chunks, 1 GiB RAM target and 64 MiB scratch bound. Final generation: 1.17 s, peak RSS 237,207,552 bytes; full forecast file: 21.35 s, 317,014,016 bytes; full model file: 2.42 s, 305,299,456 bytes. Peak sampled disposable data was 10,546,684 bytes. Every owned command joined; `captain-flack-scratch` was removed and absence verified. The root and `server/` shared dependency links created for this slice were unlinked and their absence verified; no database, browser, Java, OneDrive access or full suite ran. Full suite: deferred to batch. No new screenshots: this changes offline data/provenance and preserves the existing response presentation contract.

Tested checkout: story branch `dev/DEV-2026-11-16-029`; final committed source identity is recorded by the parent’s story result. The following are selected source hashes, not a complete transitive source closure:

| Selected source | SHA-256 |
| --- | --- |
| `scripts/gcsp/retrain-hatchback-choice-model.mjs` | `d20302e1aba15f4b6bc9c9bd9c928af498ef3485020774dea5282f0c7b9b8110` |
| `server/gcsp/policy/seed-v1.json` | `23ce0fef1d65e9e54c3b6ddc65361f2abd92e0bb8071c05b4f9797daafad4591` |
| `server/gcsp/policy/reviewed-definitions.js` | `67bdb16022dadc033c60702f8facd13b3b5adfc58b2e6ad84e0c35677e74a787` |
| `server/gcsp/predict/records/policy-definitions.json` | `c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143` |
| `server/gcsp/policy/reviewed/fucq115-choice-model-v1.json` | `89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987` |
| `server/gcsp/policy/reviewed/offer-decline-reasons-v1.json` | `1f1b632be83ddef1a5656288b4e40c0378736cda5c21fcf03de68544dfbe688f` |
| `server/gcsp/predict/model/baselines.js` | `25685d4067d5ea187130e31bcb5ea5af9d3dbf387f3a44788a7501e05cf195ce` |

Agents: Captain Flack, requested/selected Sol (`gpt-6.1-sol`) / medium, no fallback or descendants. Title verified. Parent owns activation decision/publication, Java/OIDC/PG integration, independent review and commits; this report does not mark those acceptance obligations complete.
