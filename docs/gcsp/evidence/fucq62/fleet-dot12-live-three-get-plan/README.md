# Exact .12 deployment: three GETs, unsealed and unexecuted

This fresh packet has no execution authority. The deployment commit, actual deployment ID, completion time, retained success evidence and 48 dependency hashes are deliberately unset. Both entrypoints reject `executionSeal:unsealed`, missing commit/deployment identity or incomplete dependency pins before any network request or allocation. The prior .10 packet and actual results remain unchanged.

The root first runs the reviewed Linux fresh public cold/offline/boundary checks. Render remains on .10 until those pass. After the actual .12 deployment succeeds, the root must supply the exact commit, actual successful deployment ID and completion time, review the inherited 48-path dependency baseline against that commit and extend it as needed, populate every `requiredDeploymentPinPaths` hash, mark `deploymentDependencyReviewComplete:true`, set `executionSeal:sealed`, recompute the exact plan SHA and issue a separate exact grant with retained deployment success evidence. Preparation, placeholders, an old deployment or a Blueprint sync does not authorize a GET. A changed script also requires refreshed script pins and plan SHA.

The target is `https://gcsp-api.onrender.com`, exact .12 manifest `3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30`. The expected first DTO SHA256 is `82712c8d703e6546d6c4298fa3a168b2ea48f09c73931ee9eb061ee36f98e2e4`, derived from the retained actual .12 HTTP receipt: 632,368 bytes, SHA256 `d5518728f7c6d84f331c242d4b5ed5499998ae6f5ec3e43d8e3ef14bcd1a4929`. Its first request key is `d72c05557861bb646f57484e60d26c3f1f35df5c20b0dd18e01256188c7d0ca2`; direct, HTTP and consumer checks passed there. The raw configuration ID and expected hash also match the frozen .12 boundary record. No local lookup or replay derives the expected hash.

The finite unauthenticated sequence is `GET /health`, `GET /health/vehicle-evidence`, then the exact first configuration GET only after readiness reports HTTP200, `ok:true`, nested `vehicleEvidence.status:ready` and the exact .12 manifest. Maximum three new GETs, 30 seconds/request, 90 seconds total, zero retries or redirects. Any failure stops immediately; consumed or uncertain requests are never automatically replayed. Another attempt needs a separately reviewed packet and grant.

Each request reserves its ordinal in a durable checkpoint before fetching. Bounded raw bodies (1MiB each) and headers (16KiB total, 2KiB/value; credential/cookie headers redacted), status, timing and hashes are retained. Failure checkpoints preserve pending reservations and partial received bytes when available. Only exact first DTO equality passes. The agent sends no SQL, source/provider or image request; public application requests can use the server's policyDB internally.

The builtins-only probe uses no ordinary local store, dependency installation, link change, browser or foreground interaction. The supervisor checks the exact deployment dependency blobs with `git show`; the baseline must be reviewed and all resulting hashes filled before sealing. One worker has 320MiB Node heap, 448MiB group RSS plus 64MiB supervisor headroom, 512MiB host reservation, 64MiB cloud scratch/disk reservation and 90 seconds. Ownership metadata is external to scratch and the finalizer is registered before allocation. It stops/joins owned children, proves groups absent, checks open files, deletes scratch and verifies reservations and immutable inputs. Compact evidence goes directly to the named OneDrive output; there is no compatibility exception.

Once sealed and separately authorized, the root can invoke:

```sh
/usr/bin/python3 -B -I docs/gcsp/evidence/fucq62/fleet-dot12-live-three-get-plan/supervise.py \
  --reviewed-plan-sha256 EXACT_SEALED_PLAN_SHA256 --root-release /absolute/exact-grant.json
```

The example grant is unauthorized, with success booleans false and null identities. Preparation checks are static syntax, fail-closed control inspection and local provenance/pin checks only. No deployment readback, Linux acceptance, source collection, SQL, native proof, full 10,002-reference replay, full Story acceptance or Done is claimed. The original public cold attempt cause remains unresolved. This packet creates no scratch or execution result during preparation.

Agent: Mike Wazowski, requested/selected `gpt-6.1-sol` / `medium`; runtime unverified; no fallback or descendants. Root owns deployment, final seal, grant and execution.
