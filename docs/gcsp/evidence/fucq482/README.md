# FUCQ-482 local cutover rehearsal

Story DEV-2026-11-13-050, slice 5. Run `run1-074048` of `scripts/gcsp/fucq482-cutover-rehearsal.mjs`, 2026-11-19T07:40:49Z to 07:41:13Z (24 s), overall **PASS** on the first heavy run.

It runs the Java API in the `gcsp-java-api` demo composition of `render.gcsp.yaml` on an empty native PostgreSQL 17 database, with the built Angular site and a local test OIDC issuer, and proves retained-input startup, an ordinary restart, the authorised reset, sign-in and one journey. The product code is unchanged.

Repository policy keeps only Markdown here. The compact JSON receipt (SHA-256 `61c48600d5a96f53703bd656260117e9a36dedd006924fdb4aee24f204fde474`, 30,801 bytes) stays local and git-ignored at `.claude/test-runs/fucq482/rehearsal-compact-run1-074048.json` in the worktree.

- Tested commit: `20d6b3a3944e44b027bb58611e0ec639cc2e7fa8` (tree `538dd49ab08c3b07f1f49552ff6085c07034bbcd`), branch `dev/DEV-2026-11-13-050`, clean tree. It is `7a53a7c20` plus the script and its refusal test only; the API and web trees are those of `7a53a7c20`.
- Capacity line before the run: `can_start=6 running=2: 12.0 GB free less 3 GB reserve leaves room for 6 at 1.5 GB each`.

| Build | Identity |
| --- | --- |
| API (`services/gcsp-api` tree `af2c1b3bd1d531d1ceea9b948eafbafdc815aa98`, built uncached for this run) | `quarkus-run.jar` SHA-256 `76dda5b32720a2203e3624011da25475cfbc59801319eff6f96757cb4c98edd4`; app jar `gcsp-api-0.1.0-SNAPSHOT.jar` `5ea772885eedc72d19566f92d2b23c5a665364f7a8e62dc3f0cc360b5b85a6ca` |
| Web (apps/gcsp-web + shell tree key `ec484aaa52db8ea621d6328f97d96ee3e1a30356`, built uncached for this run) | `main-HHQRBLF7.js` SHA-256 `59e6b757c6491e653b5d088b3b0b7b089b4f8bc3be480d2360ca300d81359a8a`, assembled with `scripts/build-gcsp-static.mjs --environment deployed` |
| Tools | Java 21.0.13, native PostgreSQL 170012 (shared test stack), Google Chrome 159.0.8154.13 headless, Node v26.5.0 (harness only) |

## Composition

All values are those of `render.gcsp.yaml` for `gcsp-java-api`; the `sync: false` keys carry local values.

- Identity: `GCSP_IDENTITY_PROVIDER=oidc` against the local issuer (code + PKCE, signed RS256 JWTs); accounts `sub-paula` (employee, `employee-paula`), `sub-presenter`, `sub-greg`.
- `GCSP_REQUIRED_PROVIDERS=identity,persistence,account,scenario,supply,allocation-candidates,ordering,approvals,documents,appointments,returns,production,evidence`.
- `GCSP_SCENARIO_PROVIDER=demo`, `GCSP_SUPPLY_PROVIDER=demo`, `GCSP_ACCOUNT_PROVIDER=repository`, `GCSP_ALLOCATION_CANDIDATES_PROVIDER=recommendation`; `GCSP_ORDERING`, `APPROVALS`, `DOCUMENTS`, `APPOINTMENTS`, `RETURNS` and `PRODUCTION` providers `synthetic`; `GCSP_VEHICLE_EVIDENCE_PROVIDER=lookup`, `GCSP_VEHICLE_IMAGES_PUBLIC=false`.
- Retained store, read in place and read-only from the worktree: `GCSP_VEHICLE_EVIDENCE_STORE=server/data/gcsp/vehicle-evidence/fleet-source.v1`, `GCSP_VEHICLE_EVIDENCE_REFERENCE_DIR=server/data/gcsp/vehicle-evidence`, `GCSP_VEHICLE_ASSETS_ROOT=<worktree>`.
- Persistence: owned database `t_fucq482_rehearsal_487d3a` (dropped afterwards), `GCSP_EXPECTED_DATABASE` the same name, `GCSP_ENVIRONMENT_ID=f482-run1-074048`, `GCSP_RUN_ID=run-1`, `GCSP_POLICY_VERSION=gcsp-policy-v1+offer-journey-v1`, `GCSP_RESET_ALLOWED=true`, pool 10, JVM `-Xmx768m` serial GC.
- Mail stays captured (`GCSP_MAIL_TRANSPORT` unset); `GCSP_PUBLIC_BASE_URL` is the local web origin `https://gcsp-web.example.test:7482`; `GCSP_CODE_REVISION` is the tested commit. The learned model is off (no `+learned-model-v1`, `GCSP_LEARNING_ACTIVE_MODEL` unset) and comparison reruns are off.

## Phases

| Phase | Result | Checks | Key observed values |
| --- | --- | ---: | --- |
| P1 fresh start | PASS | 9 | Database empty before start. `/q/health/ready` 200, overall UP, `required-providers` UP with `required` listing all 13 providers and no `unconfigured`. `/q/health/live` 200. Flyway in `gcsp_app`: 25 SQL migrations plus its schema row (26 successful rows), latest version 480.2, equal to the 25 files on disk. Identity row `f482-run1-074048`, reset allowed. `GET /context` without a token 401 `bearer-missing`. `/gcsp/runtime-config.json` names the API base and the issuer. Startup 3.3 s. |
| P2 retained inputs | PASS | 7 | Read as presenter and Paula. See the identities table. |
| P3 create state | PASS | 5 | Paula signed in through the browser (code + PKCE), site made authenticated reads, landed on `/gcsp/account`. Preference saved through the API (comfort 50, body estate, sportiness 50), Buddy engaged, presenter release then tick: offer `buddy-offer:f1b4743f...cca54`, state `pending` (database row `active`), quote `buddy-quote:f1b4743f...cca54` (hash `7aecd450...b509`), policy `gcsp-policy-v1+offer-journey-v1`, run `run-1`, captured link `https://gcsp-web.example.test:7482/gcsp/offers/buddy-offer%3Af1b4743f...cca54`. The link opened in the signed-in browser and rendered "YOUR OFFER ... BMW 3 Series Touring 320i". |
| P4 ordinary restart | PASS | 8 | New process (pid 81386 to 81485) on the same jar and database, ready in 2.8 s. Readiness UP with all 13 providers. Flyway history unchanged. Same runs, no table lost a row. The step 3 snapshot is identical (no differing key). Retained identities unchanged. The same link signed in (fresh browser context) and rendered the same offer. |
| P5 authorised reset | PASS | 16 | See below. |
| P6 no Node runtime | PASS | 3 | Scan of 668 processes: 5 `node` processes visible, none running `server/index.js`, `gcsp/runtime.js`, `gcsp/host.js` or `gcsp-demo.mjs`. This run's only node process was the script itself (static host and issuer in-process). Java processes: api-1, api-2, api-isolation. Only `127.0.0.1:55663/t_fucq482_rehearsal_487d3a` was ever targeted (API URL, expected database and every psql call). |

### P5 detail

- Active run before: `run-1`. A reset with a wrong `expectedRunId` was refused `409 stale-run`; no table lost a row and the active run was unchanged.
- A second API process with `GCSP_ENVIRONMENT_ID` changed against the same database exited with code 1 in 0.8 s: `EnvironmentMismatchException: Database belongs to environment 'f482-run1-074048' but GCSP_ENVIRONMENT_ID is 'f482-run1-074048-other'`. The database identity was unchanged. The `GCSP_EXPECTED_DATABASE` variant was not run.
- `POST /presenter/clock/reset` (mechanics scenario `gcsp-clock-scenario-v1`, `expectedRunId=run-1`): retired `run-1`, activated `demo-085b98e7fb13f3321b1ffe287fe2a6aa`, `replayed: false`. Replaying the same `commandId` returned the same receipt with `replayed: true`. Run history: `run-1|retired`, `demo-085b...|active`.
- Old offer in the new run: `GET /offers/current` for Paula is empty; `GET /offers/<old>` answers `409 offer-from-earlier-run` ("This offer is from an earlier demo run. Open your latest offer from your account."). The old link in the signed-in browser shows "OFFER OUT OF DATE Use your latest offer email or open the offer from your account." The old offer row is kept in the database under the retired run (nothing deleted).
- A new allocation in the new run (presenter release then tick) issued offer `buddy-offer:2e745a1e...d3e3` with a different link; it signed in from a fresh browser context and rendered. The row is in `demo-085b...`.
- Retained identities after the reset equal those before (below). The active policy version read through comparison stayed `gcsp-policy-v1`.

## Retained identities as read

| Identity | Observed | Result |
| --- | --- | --- |
| Active policy version (comparison read, run clock as-of) | `gcsp-policy-v1`; the context and offers carry the configured `gcsp-policy-v1+offer-journey-v1`. Unchanged across the restart and the reset | recorded |
| Stored comparison result digest, `/comparison/process/latest` | `d388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027`, resultId `process-comparison-94c7760154fa5a05d5d6dc9b7c768fa0`, origin `retained`; other experiments not stored | equals expected |
| Learned model artifact `sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d` | **Not served while off**: no endpoint exposes it. Packaged in the app jar as `gcsp/learning/artifacts/2ce1109d...c7d.json`, 155,035 bytes, resource SHA-256 `a2ee4271a91a2a02182fa9d5797acd7723a9bc776207aad19f5190cb223ddd86`, equal to the repository file (the file name is the artifact id; the id is not the file hash) | present in the jar |
| Vehicle evidence corpus | Readiness `vehicle-evidence` UP: `lookup`, `gcsp-source-fleet`, version `2026-11-07.9`, manifestDigest `28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884`. One read through `EvidenceResource` for the corpus's first configuration (`MlBCQzpGRVBN...`): 200, contract 1.0.0, `partial`, vehicle carries the configuration id | selected corpus served from the retained store |
| Reference files | `display-images.v1.json` `f12e588c...b694`, `configuration-definitions.v1.json` `7327f922...b939`, `process-only.json` `c2175ec4...a5` | match README identities; every retained file hashed before and after the run is unchanged |

## Rerun

```sh
export TMPDIR=/private/tmp/<owned>; mkdir -p $TMPDIR/own-<token>
python3 -B _tools/test_stack.py pg up
eval "$(python3 -B _tools/test_stack.py pg db create --run fucq482-rehearsal)"
SCRATCH=$TMPDIR/own-<token> PROOF_RUN_TOKEN=<token> PROOF_SOURCE_REVISION=<40-hex commit> \
PROOF_API_JAR=$(python3 -B _tools/test_stack_build.py build api --worktree $PWD | sed -n 's/^PROOF_API_JAR=//p') \
PROOF_WEB_BROWSER=$(python3 -B _tools/test_stack_build.py build web --worktree $PWD | sed -n 's/^PROOF_WEB_BROWSER=//p') \
GCSP_TEST_DATABASE_URL=$GCSP_TEST_DATABASE_URL PROOF_COMPACT_RECEIPT=$PWD/.claude/test-runs/fucq482/<name>.json \
python3 -B _tools/test_stack.py heavy --label fucq482-rehearsal --ram-gib 3 -- node scripts/gcsp/fucq482-cutover-rehearsal.mjs
python3 -B _tools/test_stack.py pg db drop --run fucq482-rehearsal
```

The script refuses without `SCRATCH`, `PROOF_RUN_TOKEN`, a 40-hex `PROOF_SOURCE_REVISION`, `PROOF_API_JAR`, `PROOF_WEB_BROWSER` and a local `GCSP_TEST_DATABASE_URL`; it never runs git. `node --test server/test/fucq482-rehearsal-refusal.test.js` covers the refusals.

## Limits

- The issuer is a local labelled test issuer, not the hosted OIDC provider; real provider registration is unrun.
- Mail is captured in the outbox, not delivered; the captured link is the producer output.
- Chrome only, one desktop viewport. The static host emulates the Render rewrites; it is not Render and no hosted check is claimed.
- Offer decisions are never submitted; the learned model and comparison reruns are off.
- The reset used the mechanics scenario, the only one with a reviewed start loader.
- The old-link observation is the API's `offer-from-earlier-run` refusal and the site's out-of-date screen.
