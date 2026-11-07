# Exact .10 deployment — three GETs, prepared only

The packet targets meaningful deployment `7617678535` at exact code `e3fd747dab2765e314633908e99d3c0c31283606`, restoring external release `0bfe3139491826c5605c0a22918ec58c687b7922bd00650d9dddeaf40860399a`. Deployment was in progress when this packet was prepared. No GET is authorized until the actual deployment succeeds and the parent supplies an exact grant plus retained success evidence. A Blueprint auto-sync, old deployment or preparation itself does not establish success.

The expected DTO is derived only from the actual frozen `.10` first HTTP receipt: 601,642 bytes, SHA256 `9fe6d85cbb4b60bf073c4ea8e20993d4762118235965c92779a0cfdb25bd8545`. Its first row key is `d72c05557861bb646f57484e60d26c3f1f35df5c20b0dd18e01256188c7d0ca2`; direct and HTTP checks passed there. The exact DTO SHA256 is `38b6c87f22a36b46bd380d3f9d45135389ced171cdf23990b6cddb82d4a065cb`. The `.9` DTO hash is never substituted.

The builtins-only Node probe performs no local lookup, offline/source replay, dependency installation or link change. Forty-eight dependency blobs are pinned and checked through `git show` against the actual deployment commit. The local ordinary store is not needed: it remains committed `.9` while the target deployment restores exact external `.10` assets.

The finite sequence is unauthenticated `GET /health`, `GET /health/vehicle-evidence`, then one exact first configuration GET only after nested `vehicleEvidence` reports `ok/ready` for the exact `.10` manifest. Maximum three new GETs, 30 seconds each and 90 seconds total. No retries, redirects, automatic replay, source/provider/database or image requests. Any failed request or readiness mismatch stops immediately. A failure remains consumed/uncertain evidence; a new attempt requires a separately reviewed packet and grant.

Each request reserves its ordinal in a durable checkpoint before fetch. Responses retain bounded raw bodies (1MiB each), redacted headers (16KiB total, 2KiB/value), status, timing and digest. Failure checkpoints preserve pending reservations and partial received bytes when available. Only exact first DTO equality passes; acceptance remains false and the original earlier timeout cause remains unresolved.

Use the exact plan SHA and a grant based on `parent-release.example.json`:

```sh
/usr/bin/python3 -I docs/gcsp/evidence/fucq62/fleet-dot10-live-e3fd-three-get-plan/supervise.py \
  --reviewed-plan-sha256 EXACT_PLAN_SHA256 --root-release /absolute/exact-grant.json
```

The example has `authorized:false`, `deploymentSucceeded:false` and `freshReadinessDeployment:false`. Actual execution requires all three true, exact phase/code/manifest/deployment ID, `sourceCalls:0`, `newGetCeiling:3`, and the actual retained deployment-evidence path/hash.

One worker uses at most 90 seconds, 320MiB Node heap, 448MiB process group RSS, 512MiB host reservation and 64MiB cloud scratch/disk reservation. An external ownership manifest and registered finalizer precede allocation. The destination is created before scratch. On handled exit, owned children are stopped/joined, group absence is proved, open files are checked, scratch is removed and reservation absence is verified. Compact evidence is retained directly in OneDrive. Dependency links are never touched; no inherited boolean claims that a dependency existed. There is no compatibility exception.

Preparation checks are syntax and exact pin validation only. Network/runtime, full 4,668-reference replay, native proof, full Story acceptance and Done remain excluded. Native packet's 167 code pins remain unchanged; this packet creates no dependency link or candidate execution.

Agent: Mike Wazowski, requested/selected `gpt-6.1-sol` / `medium`; runtime unverified; no fallback or descendants. Background-only work with no browser or foreground interaction.
