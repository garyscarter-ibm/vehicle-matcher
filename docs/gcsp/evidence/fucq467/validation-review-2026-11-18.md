# FUCQ-467 scoped validation and review — 18 November 2026

**Result: partial; Story remains In Progress.** Original acceptance and external proof requirements are unchanged. This increment adds proof tools and test-only composition; it changes no production Java or Angular source. Java checkpoint `28d91680de3509cd044722fb4cf1e57cc074d896` is published. Browser03 recorded pre-checkpoint HEAD `d085c7e0e6d1cce235f7bcbd10841edc78eba6dc`; browser04 recorded the checkpoint. The exact working-file hashes below bind the tested inputs across that documentation/test commit. Shared later docs-only updates do not alter these inputs.

## Selection and local results

Changed paths: six `RemoteDecision*` test/resource/profile/support files in `services/gcsp-api/src/test/java/gcsp/api/offers/`, `_tools/gcsp-offer-link-proof.mjs` and `_tools/gcsp-remote-decision-scenarios.mjs`. The opt-in `PROOF_STORY=467` seam preserves the existing 465/466 paths. Existing source preparation creates real allocation/claim/quote/hold/offer records from retained facts; no fabricated offer or custody record is inserted. The selected remote acknowledgement is the controlled substitute. Real RSA-signed bearer HTTP cases use native PostgreSQL 17. The browser uses actual Angular, local OIDC code/PKCE/signature validation, Java and native PostgreSQL with ordinary Java process restart on the same database/run. Captured outbox links are opened, with no actual email send.

Java validation is scoped: **224 unique checks across 40 classes, zero final failures/errors/skips**. Offers/remote contributes **171/30**; prescribed startup/wiring contributes **53/10**. Reconciliation is **31 completed checks/13 classes** from the resource-bounded `f467-offers-remote` attempt + **139/16** from `f467-offers-remaining` + **one** `RemoteDecisionRejectedDeclineHttpTest` from `f467-http-02`. Its accept/decline classes already occur in the 31 and are counted once. The bounded attempt itself is incomplete and is not labelled a package pass. The table below is the class/test-count identity ledger; raw receipts retain suite counts rather than individual method execution IDs.

All Java commands use `./mvnw -B test -Dtest=<selected classes/packages>` in `services/gcsp-api`, with the README native test/running-database URLs. The remaining-class run used one fresh fork per class, `-DforkCount=1 -DreuseForks=false`, and `-Xmx1024m`. Exact selectors and timings remain in the pinned raw validation JSON. No Node product module or Angular source changed. Node syntax checks passed for both proof modules. The repository affected-test selector and coverage-context collector support Python/unittest only; explicit Java ownership/boundary selection was used. The atomic local map `.claude/test-runs/impact/f467-remote-decision-composition.json` retains fixture/config/subprocess edges, hashes, results and timings; missing Java function contexts remain unknown. No extra suite was run to populate the map.

Callers/boundaries reviewed: OfferDecisions/OffersResource → RemoteOfferDecisions → HttpRemoteBuddy/transport; accept → OrderingService/RemoteSelectionConversion; policy/source adoption, generated allocation, persistence, OIDC/JWKS and startup/tick registration. Existing remote component cases cover contention, authority changes, expiry and retired-run guards. The new profile pins retained clock metadata to existing `DecisionEnv.NOW`, preserving scenario offsets; it does not prove wall-clock progression.

| Class (`gcsp.api.` prefix) | Checks | Completed evidence |
| --- | ---: | --- |
| `DefaultProfileTest` | 9 | `f467-wiring` |
| `IdentitySelectionTest` | 4 | `f467-wiring` |
| `OidcContextTest` | 24 | `f467-wiring` |
| `OidcIdentityTest` | 6 | `f467-wiring` |
| `appointments.AppointmentsWiringTest` | 3 | `f467-wiring` |
| `claims.ClaimWiringTest` | 2 | `f467-wiring` |
| `notify.NotificationDrainWiringTest` | 1 | `f467-wiring` |
| `offers.GeneratedClaimInputVariationHttpTest` | 1 | `f467-offers-remote` |
| `offers.GeneratedClaimRemoteOfferHttpTest` | 1 | `f467-offers-remote` |
| `offers.GeneratedClaimRemoteOrderingHttpTest` | 1 | `f467-offers-remote` |
| `offers.GeneratedClaimRemoteOrderingRecoveryHttpTest` | 1 | `f467-offers-remote` |
| `offers.HttpRemoteOfferDecisionPgTest` | 5 | `f467-offers-remaining` |
| `offers.OfferAcceptJourneyHttpTest` | 1 | `f467-offers-remote` |
| `offers.OfferAcceptPgTest` | 21 | `f467-offers-remaining` |
| `offers.OfferAccessTest` | 15 | `f467-offers-remaining` |
| `offers.OfferBrowserDecisionJourneyHttpTest` | 1 | `f467-offers-remote` |
| `offers.OfferBrowserDecisionPgTest` | 4 | `f467-offers-remaining` |
| `offers.OfferBrowserDecisionTest` | 2 | `f467-offers-remaining` |
| `offers.OfferClockTest` | 4 | `f467-offers-remaining` |
| `offers.OfferDecisionParityTest` | 1 | `f467-offers-remaining` |
| `offers.OfferDecisionRaceTest` | 3 | `f467-offers-remaining` |
| `offers.OfferDecisionsPgTest` | 17 | `f467-offers-remaining` |
| `offers.OfferDeclineJourneyHttpTest` | 1 | `f467-offers-remote` |
| `offers.OfferJourneyPolicyTest` | 3 | `f467-offers-remaining` |
| `offers.OfferLinkHttpTest` | 1 | `f467-offers-remote` |
| `offers.OfferRunIdQueryHttpTest` | 1 | `f467-offers-remote` |
| `offers.OfferViewTest` | 8 | `f467-offers-remaining` |
| `offers.OffersHttpTest` | 19 | `f467-offers-remote` |
| `offers.OidcRemoteOfferHttpTest` | 1 | `f467-offers-remote` |
| `offers.PostgresOfferRecordsTest` | 9 | `f467-offers-remaining` |
| `offers.RemoteDecisionAcceptHttpTest` | 1 | `f467-offers-remote` |
| `offers.RemoteDecisionDeclineHttpTest` | 1 | `f467-offers-remote` |
| `offers.RemoteDecisionRejectedDeclineHttpTest` | 1 | `f467-http-02` |
| `offers.RemoteOfferAcceptPgTest` | 13 | `f467-offers-remaining` |
| `offers.RemoteOfferDeclinePgTest` | 14 | `f467-offers-remaining` |
| `ordering.RemoteOrderingStartupTest` | 1 | `f467-wiring` |
| `persistence.NotConfiguredReadinessTest` | 1 | `f467-wiring` |
| `persistence.PersistenceWiringTest` | 2 | `f467-wiring` |
| `remote.OperationHttpTransportTest` | 13 | `f467-offers-remaining` |
| `remote.RemoteOperationProvidersTest` | 7 | `f467-offers-remaining` |

New test profiles/support trigger the full validation rule. **Full suite: deferred to the parent’s single covering batch** for the merged FUCQ-466/FUCQ-476/FUCQ-467 inputs. This local result cannot substitute for that batch.

## Rendered scenarios and precise boundary

All **three browser scenarios / 14 explicit checks / 16 captures** pass with isolated headless Chrome/CDP. The user’s foreground application, tabs and focus were undisturbed. This is the existing CDP harness, not a Playwright result. HTTPS/CORS and bearer traffic use the actual local composition; no interception or product fallback supplies the result.

| Scenario | Checks | Observed boundary |
| --- | ---: | --- |
| `remote-accept-refusal-loss-restart` | 6 | Refused selection restores the active offer; an explicit later acceptance loses one applied reply, presents decision-pending, then ordinary restart reconciles once. Stable original 202 receipt/replay and distinct refusal command. |
| `remote-decline-loss-restart` | 4 | Lost applied release reply presents release-pending, then restart confirms decline once; no order or duplicate execute and stable original receipt. |
| `remote-decline-refused` | 4 | Fresh Alex composition retains release-pending custody before/after restart; one POST, zero remote effects/orders, stable original receipt. |

At each remote execute the substitute SQL-read verifies one committed pending intent, one command receipt, expected pending hold/offer states and zero final decision/order before I/O. Original operation IDs are checked against SQL and actual same-command202 replay. The public owner GET intentionally omits operationId; the proof does not invent that contract.

**FUCQ-466 boundary remains distinct.** These captures concern the upstream Buddy offer-decision selection/release acknowledgement. Acceptance confirmation then creates its one selection order. They do not inject downstream RemoteOrdering pending or definitive-refusal responses after an accepted decision with allocated hold; they do not close FUCQ-466’s rendered downstream ordering gap. Parent/Hugh retain that proof.

Angular source reuse: all 227 source/config inputs match worktree `DEV-2026-11-13-033` byte for byte; its 36 compiled browser files are hash-pinned. No rebuild or new Angular test claim is made. Full mappings are in the pinned local browser-input manifest. Source/build mapping aggregates below use SHA256 of sorted `path SHA256` lines with final newline.

## Independent review and limitations

Mater (`gpt-6.1-sol/high`, no fallback) independently reviewed the Java/proof source and security boundary: **passed, no actionable finding**. Mater then inspected every actual 1280×800 and 390×844 capture and both proof/supervisor receipts: **passed, no actionable in-scope visual/usability finding**. The critique covered hierarchy/proportions, record identity and long 1 Series wrapping, refusal/recovery, pending custody, disabled decisions, available recovery action, confirmed outcomes and narrow action readability. This is an independent artifact review under Impeccable guidance, not a completed dual-agent/detector audit or new browser run. No UI correction was justified.

Open original gates: hosted Render topology/deployment, real configured provider registration/login, agreed recipient and actual test-email delivery, live BMW integration where unavailable, the parent covering batch and final collaborator acceptance. Captured outbox is not delivery; local issuer is not the external provider. Safari/private browsing, keyboard/focus and screen-reader/CSP-accessibility evidence are not newly established here. Loaded imagery and arbitrary maximum text extremes are also not proved; the actual unavailable-image fallback and realistic long model name were inspected. No unmatched prior evidence is silently credited. Original AC boxes stay unchecked.

Failed authored attempts are retained: first Java decline assertion used accept’s decision-pending instead of the existing release-pending contract; browser01 expected public operationId instead of original receipt/replay; browser02 expected mixed-case headings instead of the rendered uppercase. Those proof expectations were corrected. A sequential third Jordan allocation was unavailable; the successful refused-decline case uses a separate fresh Alex composition. No product defect or Jordan success is claimed.

## Resource and artifact receipt

Final observation `2026-11-18T01:31:36.933229+00:00`: `/private/tmp/vm-poller-20261118-sulley-467` absent; **138 owned process identities checked, zero live matches**; `/tmp/vm-poller-java-verify.lock` absent; zero owned HostBudget reservations. Nine external supervisor receipts report cleanup without issues for successful and failed attempts. The owned nativePG17/browser/Maven active-working-set compatibility exception stayed local; no OneDrive access occurred. Existing installed dependencies and ignored compiled build outputs are retained.

Browser03 measured peak scratch 115,006,976B / inclusive RSS 1,909,211,136B; browser04 measured 66,632,960B / 1,761,492,992B. The broad Java attempt was stopped after sampled RSS 2,432,237,568B crossed the 2304MiB limit; the replan used smaller fresh forks. Largest successful Java scratch peak was 1,312,430,528B. No successful chunk exceeded ten minutes.

Outer browser finalizers measured **removedBytes=0** because the inner harness had already deleted browser scratch. Inner receipts verify database stopped/scratch absent, without a measured deletion byte count. Java receipts retain peak allocation and verified removal/absence, without a separate deletion total. Peaks are not reported as deleted bytes.

The local ignored manifest pins **50 artifacts / 1,946,767 retained bytes**: JSON/PNG including failed attempts, nine supervisor receipts, both reviews and final cleanup. Raw JSON/PNG are intentionally ignored by repository policy and are not force-added. The tracked Markdown retains compact durable results and identities; raw artifacts remain retrievable at this worktree and the external poller paths below.

## Exact identities

| Input/artifact | SHA256 |
| --- | --- |
| `services/gcsp-api/src/test/java/gcsp/api/offers/RemoteDecisionAcceptHttpTest.java` | `32226761ce70e48b4bf0b7fbf9eea01e2cdbc1a30f673cd470d5a0f2fa3a4377` |
| `services/gcsp-api/src/test/java/gcsp/api/offers/RemoteDecisionDeclineHttpTest.java` | `df807691b6b77772aa396610c9e81f731c45f00a06dff6db4a1f8274fbe4a70a` |
| `services/gcsp-api/src/test/java/gcsp/api/offers/RemoteDecisionJourneyProfiles.java` | `8330ac0cf316cd5f67b9e1f85de74672e57c37aed2c70d894cb7aa5ef2288583` |
| `services/gcsp-api/src/test/java/gcsp/api/offers/RemoteDecisionJourneyResource.java` | `923a8e1ae0b030f2fbc09c20f129fea7e5231f46666dceed2044f4fc1fcfb718` |
| `services/gcsp-api/src/test/java/gcsp/api/offers/RemoteDecisionJourneySupport.java` | `a34b045edc3bcd4b3a9ea651d16e76da2512ffbddd2b8e23cb8293215ffcfaca` |
| `services/gcsp-api/src/test/java/gcsp/api/offers/RemoteDecisionRejectedDeclineHttpTest.java` | `8374b5840da053a0295ed359b51fd77fc3a046c7cf54588e67240ab66e47566b` |
| `_tools/gcsp-offer-link-proof.mjs` | `789d88ce5a1163d79c922f33843380e2aae41f0d2fc94b7edace48d41690842d` |
| `_tools/gcsp-remote-decision-scenarios.mjs` | `b94aa9916570803c9e59c497a905b14e77cfb0d56a74acc773e6f9efda2be857` |
| `services/gcsp-api/src/main/java/gcsp/api/offers/RemoteOfferDecisions.java` (unchanged production) | `f8f527208c54204b46b49539bf576c11f4fb17a8975b5adbfaa9694063d1b7f9` |
| `services/gcsp-api/src/main/java/gcsp/api/offers/RemoteSelectionConversion.java` (unchanged production) | `8a453bac1bfe474778558ea0e735389ac08319c51d7e95d41d1773191ac74863` |
| 73 Java source/test/config input mapping aggregate | `99d613179ca6c11c9a75445488ddc7cd1738a92e5f1180be4bfeae42a4f59c9d` |
| 227 Angular source/config input mapping aggregate | `d4c85fabfda5be184e4b97ed639ac45afc07e7f6f91b13861881ce406089112e` |
| 36 reused Angular build input mapping aggregate | `ee3b5ef575b3996ca25234bb702d070a87fc9cace360d36956e3565e756235d8` |
| `docs/gcsp/evidence/fucq467/java-validation-2026-11-18.json` | `1d8722ce2c119aef0f33d921a40354f3d4607b1601d863592f79f004bda97270` |
| `docs/gcsp/evidence/fucq467/browser-inputs-2026-11-18.json` | `0f58dbab296346873ff628291e9640e83388137eb0fb01e4c2378bf2b1936aaa` |
| `docs/gcsp/evidence/fucq467/artifact-manifest-2026-11-18.json` | `9f3d9f828a5160a5e378f282bc0eec8967eb71cf3322a72fad0d54fd8ecde90b` |
| `docs/gcsp/evidence/fucq467/browser/offer-link-proof.json` | `9665035909a64cc965836df5e44ff4b204b3c856aa9d417e8439c2d9875f71cf` |
| `docs/gcsp/evidence/fucq467/browser-refused/offer-link-proof.json` | `08ea2c94bde0145d72cb47ff93165343f3f95c47b02bbe1beb76603a1406f36b` |
| `docs/gcsp/evidence/fucq467/final-cleanup-2026-11-18.json` | `3d15db1d35be1c32ad9329993684e3778d398cea1ef554fd9037c9bb1f0bd7f0` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/f467-independent-review.md` | `fbc8d261c3a117e6bd76ec41315d11e52278d722ed1ad77c8781edff3fa68fac` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/f467-visual-review.md` | `67194425e47f179de53eb8cffaa156e61f0b90f37d5b149ab7e5cfe3b852161b` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/sulley467-supervisor.py` | `fbd7347c2142965e6c3df9bd820d8fa97dd7e7e48e3ea63ae348a70032a232e8` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/sulley467-browser-supervise.py` | `2bc69386eccc3917da79b7a4f3076a74d7b461d1086e3e29609944ff96a74e6d` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-browser-01-receipt.json` | `63d6d4803fd21186c843d44f8e92bb85f298d26b831be7f632b79ab9796397d5` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-browser-02-receipt.json` | `799551e5b39a4c5e1b92779aca235855a1e282c9be8b0b96ccba5fe66930b82c` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-browser-03-receipt.json` | `d3bed1dd6a7e689dfe0f383bc412d3baeac23603a144baf54e58b40d2a3b4050` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-browser-04-receipt.json` | `17c208334a3b6dc69bebc84b24e4542ab2a87556a45f2e10ad423ad17929cd4f` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-http-01-receipt.json` | `70f15607b7586cb339a783c202a5cc753e3ab86cce1bedcf292942f73d67e9df` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-http-02-receipt.json` | `9ae2576db80966743771199e0be6e870ef41bd2feccef1f80cf1db6b7ff7aaad` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-offers-remaining-receipt.json` | `3e39a4a0121cec800c2d65fe191389733d9c34e510d0f5240d161103e4bd890e` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-offers-remote-receipt.json` | `9b7a34f89b4033991cca09699bad6bf4c73457e132e354e8860805599b99110e` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f467-wiring-receipt.json` | `ebf8ead4b6c5eddfee19de01a4075540c7adbe9f41c4db14b8d90c0984d9b70c` |

All 16 PNG aggregate (same sorted relative-path/hash rule, relative to `docs/gcsp/evidence/fucq467/`): `4e48bb3bff2e1690ae2452efb8e149428ac12019bdcefb983713dddc47ed377b`. Individual image hashes and bytes are in the artifact manifest.

Agents: Sulley lead requested/selected/effective `gpt-6.1-sol/high`; Mater reviewer requested/selected/runtime-confirmed `gpt-6.1-sol/high`; no fallback or Sulley descendants. Parent owns shared integration, lifecycle and covering batch. No release, Done, acceptance, claim release, email or hosted provisioning is performed by this increment.
