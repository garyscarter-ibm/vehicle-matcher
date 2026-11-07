# Exact .12 deployment: one failed local readback

Executed once on 7 November 2026 against successful Render deployment `dep-dbnf8g3hf81s73b22ee0`, code `e7cf50acd58bda6b0f2b3738c4408f1f374682f8`. `deployment-success.json` retains the success observation. The sealed `plan.json` and `results.json` retain the actual identities and execution result.

The first `/health` GET timed out after 30 seconds with zero bytes received. Execution stopped at one GET; readiness and configuration lookup were not requested. The cause is unknown. This is a failed application-readback result, despite the independently successful deployment. Scratch, owned processes and reservations were verified absent; the retained result includes cleanup evidence. The prior .10 packet remains unchanged. A separate Linux diagnostic will preserve this failure and test a different execution environment.

The earlier requirement to pass every Linux phase before deploying was removed because it was not a strict BUILD dependency. The actual successful full Linux check is run `42361586991`; its success does not retroactively change this failed readback.

The target is `https://gcsp-api.onrender.com`, exact .12 manifest `3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30`. The expected first DTO SHA256 is `82712c8d703e6546d6c4298fa3a168b2ea48f09c73931ee9eb061ee36f98e2e4`, derived from the retained actual .12 HTTP receipt: 632,368 bytes, SHA256 `d5518728f7c6d84f331c242d4b5ed5499998ae6f5ec3e43d8e3ef14bcd1a4929`. Its first request key is `d72c05557861bb646f57484e60d26c3f1f35df5c20b0dd18e01256188c7d0ca2`; direct, HTTP and consumer checks passed there. The raw configuration ID and expected hash also match the frozen .12 boundary record. No local lookup or replay derives the expected hash.

The finite unauthenticated sequence is `GET /health`, `GET /health/vehicle-evidence`, then the exact first configuration GET only after readiness reports HTTP200, `ok:true`, nested `vehicleEvidence.status:ready` and the exact .12 manifest. Maximum three new GETs, 30 seconds/request, 90 seconds total, zero retries or redirects. Any failure stops immediately; consumed or uncertain requests are never automatically replayed. Another attempt needs a separately reviewed packet and grant.

Each request reserves its ordinal in a durable checkpoint before fetching. Bounded raw bodies (1MiB each) and headers (16KiB total, 2KiB/value; credential/cookie headers redacted), status, timing and hashes are retained. Failure checkpoints preserve pending reservations and partial received bytes when available. Only exact first DTO equality passes. The agent sends no SQL, source/provider or image request; public application requests can use the server's policyDB internally.

The builtins-only probe uses no ordinary local store, dependency installation, link change, browser or foreground interaction. The supervisor checks the exact deployment dependency blobs with `git show`; the baseline must be reviewed and all resulting hashes filled before sealing. One worker has 320MiB Node heap, 448MiB group RSS plus 64MiB supervisor headroom, 512MiB host reservation, 64MiB cloud scratch/disk reservation and 90 seconds. Ownership metadata is external to scratch and the finalizer is registered before allocation. It stops/joins owned children, proves groups absent, checks open files, deletes scratch and verifies reservations and immutable inputs. Compact evidence goes directly to the named OneDrive output; there is no compatibility exception.

The execution entrypoint used was:

```sh
/usr/bin/python3 -B -I docs/gcsp/evidence/fucq62/fleet-dot12-live-three-get-plan/supervise.py \
  --reviewed-plan-sha256 EXACT_SEALED_PLAN_SHA256 --root-release /absolute/exact-grant.json
```

The example grant is unauthorized, with success booleans false and null identities. Preparation checks are static syntax, fail-closed control inspection and local provenance/pin checks only. No deployment readback, Linux acceptance, source collection, SQL, native proof, full 10,002-reference replay, full Story acceptance or Done is claimed. The original public cold attempt cause remains unresolved. Preparation created no scratch; the actual failed execution and cleanup are recorded in `results.json`.

Agent: Mike Wazowski, requested/selected `gpt-6.1-sol` / `medium`; runtime unverified; no fallback or descendants. Root owns deployment, final seal, grant and execution.
