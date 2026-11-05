# Fleet qualification and authorised bounded pilot

`fleet-plan.v1` retains the complete configuration identity and full-collection refusal contract. The additive `fleet-pilot.v1` plan selects a small source-qualification pilot. Both commands are offline and make zero outbound requests:

```sh
node scripts/gcsp/fleet-plan.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --offline
node scripts/gcsp/fleet-plan.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --pilot-plan
```

The first exits 1 until actual scheme/profile coverage qualifies. The second exits 0 only for the exact bounded pilot contract below; this does not qualify a corpus or activate a VIN profile. Invalid arguments/JSON exit 2. All real-run argument forms still refuse before loading configuration. These commands write nothing, allocate no VIN, access no database and change no policy.

## Selected source and authority

Gary Carter's [5 November decision](fucq-58-source-authorisation-2026-11-05.md) authorises read-only collection from BMW's public UK configurator and this bounded pilot. Gary reports BMW approval to retain and display the configuration data and images for this project for as long as needed. The three permission records point to that decision. No further source, retention, display or pilot approval is outstanding. This is recorded human authority, not an independently verified BMW-supported API agreement.

Select the public UK configurator route already observed in [interface research](bmw-interface-research.md), labelled **unsupported public-website provider**. Fetch the anonymous page and its same-origin public settings; hold the website-supplied application header only in process memory. Never print/persist its value, raw settings, request headers, cookies or raw provider bodies. No account login, browser page execution, garage/save/order operation, private VIN/plate data or live writes are needed. Avoid loading the configurator application itself because its normal startup creates an anonymous garage record.

## Finite pilot limits — recorded before requests

Run identity: `fucq58-20261105-authorised-pilot`. One serial worker; initial hard process-group allowance 256 MiB RAM, 32 MiB scratch, 120 seconds per chunk. Fresh machine-wide HostBudget reservation and supervisor/finalizer registration precede every test or live chunk. Keep at least 5 GiB disk free; below the preferred 30 GiB, use these small chunks and measure. Oversize, timeout or exhausted budgets stop the pilot and become evidence gaps; do not raise limits silently.

| Limit | Selected value |
|---|---|
| Bootstrap GETs | 2: public page, discovered same-origin settings JSON |
| Catalogue GETs | 2: selected G61E model tree, T5MJ option definitions |
| Rule-solver GETs | At most 3, the three retained seed lists |
| OTD GETs | At most 3, only exact resolved selections |
| COSY manifest GETs | At most 1 |
| Image downloads | At most 1 representative view; no view variants |
| Total HTTP attempts, including bootstrap | At most 12; redirects refused and charged as failed attempts |
| Per response, decoded stream | At most 1 MiB for HTML/JSON; 2 MiB for image |
| Aggregate downloaded/decoded bytes | At most 16 MiB, including bootstrap and failures |
| Retry/backoff | 0 retries, 0 backoff, no retry statuses |
| Concurrency | 1 |
| Timeout / wall limit | 10,000 ms per complete request/body; 120,000 ms total |
| Cache | Cold; zero credited hits; at most 12 entries/12 MiB; TTL 86,400,000 ms |

`candidateRequests: 4` includes the two bootstrap and two catalogue reads. The projection charges 4 candidate + 3 solver + 3 OTD + 1 manifest + 1 image = 12 attempts, 2 image requests and a conservative serial 120,000 ms bound. Cache entry allowance is 1 MiB; image allowance is separately 2 MiB. The reported 200/10,000 shortfalls remain 197/9,997; this pilot is neither bulk run.

The pinned comparison context is GB/RHD/en-GB, configurator `G61E/T5MJ`, AG `72HH`, generation `G61`, order/catalogue 1 November 2026 and effect 5 January 2027. Recheck the selected model in the live model tree, including steering and dates; differences are recorded as a mismatch, not relabelled to make a fixture pass. A date is not a production/model year. The 31 model lines/individual M lines are enumerated from both retained October 2024 scheme matrices; this eligibility list is not a current catalogue mapping. This pilot samples only G61 i5. F44/G01 and other historical contexts remain unresolved rather than silently substituted with newer generations.

Before execution inspect `--pilot-plan`, register exact owned paths and a finalizer, and reserve host resources. Use a supervised read-only native client through the assigned runner; no foreground app, selected tab or keyboard-focus changes. Follow the source-specific paths/profile names in retained FUCQ-4 evidence. Abort on any HTTP failure, redirect, auth requirement, unexpected shape, byte/time/resource limit, permission revocation, identity substitution, profile mismatch, retention violation or full destination. Record attempted category/status/bytes/timing even on failure. Never save a provider error body or opaque image URL. Do not retry 401/403/429 or change source.

Persist only sanitised reusable selected facts: source/date, exact resolved model/AG/range/context, sorted complete selections/accessory classification, constructibility and requested-element preservation, explicit technical units/status and representative image identity/view/fidelity. HTTP 200 alone does not establish a constructible complete configuration. Compare full resolved identity and selections; metadata/date aliases and duplicated old builds do not increase distinct counts. A new observation of an existing configuration refreshes corroboration only. Retain an image only when its manifest identity and associated selection are proved; otherwise record image unavailability. Unknown values remain unknown.

The machine-readable plan specifies absolute non-public local evidence/image destinations under this story's `docs/gcsp/evidence/fucq-58/authorised-pilot-2026-11-05/`, bounded at 12 MiB and 2 MiB respectively. These are useful approved artifacts, not browser/raw-response caches. Stage named sanitised files only. Disposable logs/responses/profiles belong under the owned scratch root and are deleted with verified absence. All archives or expected outputs at least 256 MiB go directly to `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq58-20261105-authorised-pilot/`; this bounded pilot needs no archive or browser profile. Placement does not prove upload or deployment.

## Recorded pilot outcome — 5 November 2026

The [sanitised pilot evidence](evidence/fucq-58/authorised-pilot-2026-11-05/README.md) records 3 of 12 permitted GET attempts: public page, settings and G61E model tree, all HTTP 200; 777,995 decoded bytes and 724 ms client time. It stopped at `catalogue-steering-unconfirmed`, before solver/OTD/manifest/image calls. No new configuration, image, profile activation or write resulted. Full collection remains unqualified.

The selected compact model subtree lacked parser-recognised `RL`/`RHD`. This does not establish that the complete source lacks RHD. Historical retained evidence contains `RL`; two zero-request offline checks demonstrate the historical fact and a synthetic shortest-node counterexample. Raw live bodies were discarded, so their hierarchy cannot be recovered. A revised extractor needs a bounded allowlisted relational model/context projection and offline tests before any later pilot. This checkpoint grants no additional request budget; the dispatcher owns any subsequent collection step. Source/retention/display/pilot permission is already cleared.

## Completed steering diagnostic — 5 November 2026

Following checkpoint `327cec4`, the dispatcher authorised a separate [diagnostic plan](evidence/fucq-58/steering-diagnostic-2026-11-05/plan.json) within Gary's existing source authority: at most three GETs (page/settings/G61E tree), 1 MiB per decoded response/2 MiB aggregate, 10 seconds per complete request/45 seconds wall, concurrency 1, zero retries/backoff and no solver/OTD/manifest/images. Only validated allowlisted model/AG/market/date/steering facts, safe paths and explicit parent relationships may persist; raw bodies/credentials remain memory-only. The new owned run is `fucq58-20261105-steering-diagnostic`. Nine scoped offline extraction checks pass, including parent/cross-reference relations, unrelated steering and conflicting identifiers. This extends diagnostic observation only and leaves the previous stopped run immutable.

The [actual diagnostic outcome](evidence/fucq-58/steering-diagnostic-2026-11-05/README.md) completed three GETs/777,995 decoded bytes/467 ms client time and retained a 60,031-byte allowlisted projection. Full `models/T5MJ` records under groups `5` and `I` contain same-object AG `72HH`, steering literal `RL`, order date `2026-11-01` and effect date `2027-01-05`. Compact `lines/S0337/defaultModel` references contain the identifiers without that context. The ancestor range key is `G61E`; the model record's own range field is `G61`. These are preserved separately. Duplicate group appearances add no configurations. The next scoped offline step is a full-record path selector with exact context checks and separate source-code/profile semantics review. No additional network is in this diagnostic plan; the profile/coverage gaps remain engineering work under existing source authority.

## Remaining evidence and identity boundaries

The separate [F70/F44 catalogue discovery](evidence/fucq-58/scheme-catalogue-2026-11-05/README.md), observed 5 November at 23:31 UTC, advances candidate coverage only. Its recorded finite plan completed exactly four serial read-only GETs (page/settings/F70 tree/F44 tree), all HTTP 200, 751,670 decoded bytes and 638 ms client time; zero retries, solver/OTD/image calls or writes. F70 returned six full model records, codes `1F7A`–`1F7F`, with AG `82GE`/`62GE`/`22GE`, source literal `RL`, order date 1 November 2026 and model effect date 5 January 2027. The same dated F44 request returned a two-byte empty JSON object. This bounded result proves neither global unavailability nor discontinued production, and no newer generation substitutes for F44. Exact derivative/body/powertrain, constructibility and compatible profile remain unqualified. No new configuration or profile activation is counted; the historical distinct total remains three.

The trusted full-plan loader reads the FUCQ-52 registry, dated BMW GB snapshot and the three retained FUCQ-4 solver records. Exact context, complete selections and requested model/options must match. The current retained proof remains three configurations, each including `SE000001`: 48/48/49 selected elements are not factory-option counts or verified fitted equipment. Rim classification, model year, plant, production era/date and compatible GB profile remain unknown. Record new pilot observations separately; extend trusted evidence only after review, never through self-asserted booleans.

Corpus identity is standard padded Base64 of `vgModelCode:sorted,complete,resolved,base-option-codes`, excluding every selected accessory. The target example uses `T5MJ`; BMW's VSS code uses AG `72HH` without Base64, leaving the target-code-base uncertainty visible. Configurator range, AG code, chassis and VIN descriptor remain distinct. Exact stock uses per-run Postgres order identifiers separately; VIN belongs only to delivered/current cars. No VIN is minted for a corpus configuration.

All five enabled WBA/WBS/WBY/5UX/5YM profiles are US/LHD structural references. They cannot validate a GB/RHD build. The UK single observations remain unactivated candidates; private VIN/plate/advert research is outside this pilot. No shared registry/profile change is authorised implicitly. Required five-WMI multi-build distribution and every-scheme-model current/historical catalogue joins remain unqualified. Additional 3MW/3MF/WB5/WBX references remain labelled. The agreed demo route is at least 200 real constructible configurations across every scheme model line; FUCQ-61's 10,000 run remains deferred until 13 November or later.

Full-plan synthetic five-WMI tests prove the contract only: `contractOnly: true`, `sourceKind: synthetic`, `qualified: false`. Proved observed configurations, synthetic test records and profile-qualified counts remain separate. Presentation exposes source/date, unsupported profiles, representative-image fidelity and unknown fitted equipment. No screen is added, so new screenshots and layout reviews are unnecessary.

## Scoped verification

```sh
node --test server/test/gcsp-fleet-plan.test.js
```

Use strict targeted evidence with the explicit command; inspect the affected selector's plan and decline unsupported-JavaScript full fallback. Cover approved source/retention inputs, exact finite pilot limits, invalid/missing contexts, private fields, original full-plan refusals, request arithmetic, full selection identity and CLI zero-egress/exit statuses. Existing profile/catalogue boundary results may be reused only for unchanged source/input/environment identity. Runtime routes, retail, SQL and UI are unchanged; no full suite is admitted merely to finish this story. Record code/test/input/environment hashes, measured resources, bounded failure logs and teardown receipts outside scratch.
