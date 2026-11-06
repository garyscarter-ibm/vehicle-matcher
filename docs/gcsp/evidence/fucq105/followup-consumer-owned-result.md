# FUCQ-105 owned follow-up consumer result

6 November 2026. **Scoped consumer PASS; parent functional audit FAIL; independent cleanup PASS. Whole-story acceptance remains open.**

The tested and pushed revision is `d9a2c04f40d0bfb263e1c3bfb71b7e7ace455226`, source-plan SHA256 `19af2c40040919e88ed082a484fbb68997964b90be232b2e68e374d64189a243`. The root standing delivery envelope SHA256 is `319a5cf1ec640b5daa998cd79b87191250624ccb2ac7c9c56a267d0e89a78563`; grants name the actual delegated issuer. Root delta review is `.claude/test-runs/ownership/fucq105-owned-delta-review-1055.json`. Unchanged reviews were reused; no descendants or unchanged retry ran.

## Delivered account-to-offer source boundary

Source inspection on 6 November 2026, 11:17 UTC; remote heads were read back through the scaffold Git wrapper. These are available sources, not a running combined host:

| Source | Exact revision |
|---|---|
| Shared `gcsp-poc` host | `32baef82dba3b92eea14830e89473f3d80892597` |
| 100 / DEV-060 producer and newer runtime | `280db3ac3756b91e8674c46751df2694040e9423` |
| 102 / DEV-061 access | `3a0860f1ee4c987d492c09086cde3b75f74bf9ef` |
| 106 / DEV-074 decision | `b84a34a51a85486ce4339234765ca9f56cdfd289` |
| 107 / DEV-085 follow-up | `869d3947a810079577b5dee4c90310c3200ae0d3` |
| 103 / DEV-066 reviewed policy registry | `4c0cbcfcab52da9f6cf54a5cba743390dc1f7c7e` |

105 source at `b66a729cf88539a8dbf366df040242d46cb89844` is unchanged from the passing packet. The selected 100 producer, 102 access, 106 decision and 107 client/service modules at the heads above match that packet's individual SHA256 pins. This comparison does not admit their complete branch trees as an already-tested union.

| Required input | Available source and actual delivery limit |
|---|---|
| Account-to-offer entry | Shared `blocks/demo-launcher/employee-entry.js` loads the manual account journey only. Shared `server/gcsp/runtime.js` composes account/brief services, without offer services. Its `server/index.js` has the existing `gcspRoutes` extension, without offer access/decision dispatch. No delivered `/gcsp/offer` mount was found. |
| HTTP dispatch | 100's newer `server/gcsp/runtime.js:91–99` composes buddy, access and notification services; `server/index.js:926–959` dispatches access behind the actual shared gate. It does not compose 106 decisions or 107 follow-up. Its access module SHA256 `134e9d39253e934618f6cf38b334bb7cf0f8912443ee159e6167b949d4fdb34a` predates the durable lookup. The required 102 module is `63fac0a89e50b8b4bd5c8bed581dd49bed42519c76b2b6232de155533d37fb3c`. |
| HTTPS and employee session | 100's `scripts/gcsp-demo.mjs` provides an HTTP loopback host and account/brief/activity session pages, without `/gcsp/offer`. 105 defaults to HTTPS; 102 defaults to a Secure, HttpOnly offer cookie scoped to `/api/gcsp/offers`. The existing ordinary employee loader is `blocks/gcsp/shell/account-runtime.js`; 107 independently authenticates employee routes. No delivered HTTPS origin, normal employee cookie or second-browser receipt is established here. A client localhost option does not change the server cookie contract. |
| Persisted decline | Current 102 verifies the native completed decision, released hold, event receipt, revisions and query/clock consistency before returning `{decisionId}`. The passing case exercises actual 106 write/lost response and 102 reload through this source. No live/native persisted decline was read in this pass. |
| Registered question policy | **Registration is now available:** 103's `reviewed-definitions.js` registers `offer-followup-questions-v1`; its definitions equal 107's bundle. The registered file SHA256 is `2b634e30a65f8fce6a3cfef67e10b04e9dff72ecb4fe296c51330e98efe86d5d`, digest `bb05e490f85e9f6fd9aa1c424c849740ad2884cc62e9d9a2b98ee8f739f8b7ed`. 100 carries those same registry/file bytes. `PolicyService.adoptReviewedAssumptions` supplies the intentional server operation; runtime startup does not call it. The passing case supplies explicit question-policy input, so run adoption/activation and pinned PolicyService readback remain unproved. |

The smallest remaining composition is in the central host/runtime owners' files: serve the produced offer path on the approved origin; bind current 102 access to the same repository/policy/clock/identity used by 100 and 106; dispatch 106 through its real access resolver and 107 through the employee middleware; supply the actual run's adopted question policy. Presented invalid offer cookies must retain the existing refusal precedence. The host can already bind `mountOffer(root, {account, ...createOfferHttpAdapter({fetch: gatedFetch, enableDecisions: true}), followup: {loadAccount, mount}})`; its mount closure calls the existing `mountFollowupBody` with the opaque selector, abort signal and trusted fetch/projector/navigation. The initial account display comes from the real loader; 105 still performs its fresh readiness check before follow-up mounting. No missing owned105 port or justified product change was found. Enabling the standalone preview would leave these central edges absent.

The existing renderer is `offer/preview.html` → `harness.js` → `mountOffer`/`createOfferView`; its named fixtures remain synthetic and its default HTTP adapter is non-actionable. The passing `gcsp-offer-view-followup-consumer.test.js` already mounts the real 107 body; render/decision/followup-entry tests cover DOM states and focus. `gcsp-offer-view-render.test.js` checks scoped embed CSP, and `ui-ratchet.test.js` supplies the existing component checks. They do not measure browser layout. The 35-asset preview graph contains no 107 assets: the combined render also needs 107's `gcsp-offer-followup.css` (SHA256 `be31a68a28e64735ffa93a5a3037d7705d8fea25d0fc0caaff2c8815cd4b8d0d`) after the existing base → shell → offer styles, preserving relative kit/font/image paths. Actual 375/1280px keyboard/reduced-motion rendering remains unallocated.

Only source/text/hash inspection was performed for this boundary. No test rerun, product/helper execution, browser, listener, native database, live request or resource allocation occurred. The prior audit failure and all acceptance/claim states remain unchanged.

## Diagnosis and correction

The actual1042 run failed at the confirmation checkpoint after reaching the first two checkpoints. Its selected test HTTP shim emitted string chunks from `Readable.from([body])`, while real `server/gcsp/identity/http.js:readBody` combines native request byte chunks with `Buffer.concat`. This rejected the confirmation body before the real107 service could save it. The correction is `Readable.from([Buffer.from(body)])`. Production105/100/102/106/107 modules, the100turn wait, assertions and input semantics are unchanged; there is no evidence of timing flakiness or a107 product defect.

The only helper-body change is the exact envelope-preapproved `fields[5].strip()` at bounds telemetry identity ingestion. It produces SHA256 `be8176354fb6b17792171be7cc88f5bc76f35100195932dd571e4809ef5d5890`, correcting future padded helper-owner start values without rewriting old evidence. Necessary source-plan/parent pin references were refreshed. Membership remains73 product modules/137 product edges/24 test edges/12 file inputs/10 harness members.

## Selected actual result

Run `fucq105-followup-20261106-105614-owned1` used the existing finite supervisor and selected only `server/test/gcsp-offer-view-followup-consumer.test.js`:

- Tests1, pass1, fail0, skipped0, cancelled0; all four named checkpoints completed. Actual supervisor exit0 and worker exit0.
- Native decline and lost-response reload; fresh employee account and mounted real107 question; confirmed brief3/public receipt and original-coordinate saved reload; malformed/raced-source refusal, read-only refresh and teardown all passed.
-74 observed unique identities are73 product modules plus the test. Strict targeted key `22aa8e0926e843a654d32cf34955c32e969ee090d1527ee70ec58b42dc909446`, default variant/base `b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96`.
- Worker4.929s, preparation17.307s, supervisor36.600s at summary. Aggregate charged peak475,676,672B; peak combined7,154,368B. The actual reservation was the full805,306,368B RAM/134,217,728B disk. Limits remained worker120s/supervisor240s, retained8MiB and one worker.
- Supervisor recorded direct joins, removed scratch and released its exact row; the final helper journal closed with406/406 joins, no issue or pending handle. Original summaries, strict receipt, manifest, journal and source/input bytes were retained.

The complete original outputs are under shared `.claude/test-runs/fucq105/fucq105-followup-20261106-105614-owned1`. The delegated result receipt is `.claude/test-runs/ownership/fucq105-owned-selected-result-20261106-105614.json`, SHA256 `7a021c14c84dc55f9e59768476f8b9885406a2bd2522ab424667e09d0701f8f7`.

## Parent failure and evidence limits

The separately reserved existing parent/auditor ran once: actual auditor exit1, parent exit1. Parent stdout reported `ResourceError`, retained scratch/row and no postwrite verification; stderr retained both Python atexit traces ending in `BoundError: Helper direct join or durable ownership is unresolved`. Complete tool output is preserved in `.claude/test-runs/ownership/fucq105-owned-parent-wait-20261106-105614.json`, SHA256 `b8b8e667184fdab5faf76706058769ba6513a6c5f31ffe09669501863f09fb3f`.

The auditor journal closed cleanly with16/16 helper joins. The parent journal recorded17/17 direct joins but sticky `HelperOperationFailed` and capture17/PID19777 still pending in state `joined`; the parent child19741 was directly joined but its lifecycle stayed unresolved. The auditor recorded `BoundError` after18 true checks, before any retained-dependency verification result was recorded. Progress inside the immutable-source loop is not retained. Its parent-captured stdout/stderr were empty and both EOF-complete flags false; these are incomplete audit captures, not passing streams.

The initiating error cannot be identified from these saved diagnostics. `HelperOwnership.capture` retains a generic operation-failure flag; the auditor stores an exception type; scratch cleanup can replace the earlier exception with `ResourceError`. Neither the original helper command nor its first error message is retained. This is an explicit first-cause evidence gap, not proof of a leak or a specific traversal/timing defect. No further helper-body change or retry was made. A focused review of this failure is the next validation step.

The execution tool exposes merged stdout/stderr. The sole supervisor JSON and the parent leading JSON/atexit diagnostics are source-attributed in the retained wait receipts; no separate OS-pipe capture or independent root observation by this lead is claimed. The root also retained its observed parent wait.

## Independent cleanup and remaining acceptance

Root independently reconciled exactly the failed parent run: cleanup-only PASS1826, `.claude/test-runs/ownership/fucq105-parent-root-reconcile-1055.json`, SHA256 `55d31ebe297bfa18db18df9245b7a6f39b55086f6cde441fc0715d2cd9a1e0e6`. All retained owner/consumer/auditor/helper PIDs/groups/open paths were absent. Root removed only the inode-bound empty parent scratch and its exact dead full reservation row, preserving every foreign row and original consumer/audit byte hash. This lead performed no parallel cleanup mutation or retry. Journals retain counts/current/last helper identities, not a complete historical helper PID list; the independent receipt states that limit.

Root additionally verified all17 protected original directory/file identities and byte hashes against the before-audit snapshot: `.claude/test-runs/ownership/fucq105-protected-originals-root-1101.json`, SHA256 `af2dff94e0c191e56b883c185467d0e54e8a6bc3a6c9e08ce1b002cd218a134c`. The passing consumer evidence is preserved and is not rerun to clear the parent-audit failure.

Cleanup success does not convert the parent functional audit to PASS. Delivered host/gate/HTTPS-cookie entry, actual-run question-policy adoption/readback, desktop/375px rendered keyboard/reduced-motion and second-browser evidence, native DB, full-suite lane and final collaborator acceptance remain open. The later source boundary above establishes registration only. No visual/component/style change was made; the agreed shell/FUCQ64/shared-kit references remain binding. Story and slice acceptance are not advanced.

Agents: Hippety Hopper; requested/selected `gpt-6.1-sol` / `high`; no fallback or descendants.
