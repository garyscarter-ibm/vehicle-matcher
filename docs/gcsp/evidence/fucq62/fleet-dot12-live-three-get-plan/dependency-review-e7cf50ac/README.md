# Exact deployment dependency review — .12 three-GET plan

This is a static dependency and byte-pin review for `e7cf50acd58bda6b0f2b3738c4408f1f374682f8`, the candidate commit reported by the parent for Render deployment `7619569590` (created 2026-11-07 at 09:50:50Z). Deployment success was not verified by this review. The original plan remains unchanged, unsealed and unauthorised for execution.

`deployment-code-pins.json` provides the root-ready `code`, `requiredDeploymentPinPaths`, `deploymentCodePins` and `deploymentDependencyReviewComplete` fields. Its actual deployment ID and completion time remain null. The parent must select the real successful deployment, retain its success evidence, reconcile the deployment-gate text, fill the deployment identity and seal separately before any exact execution grant. A later commit needs a new exact-commit comparison, even when it changes documentation only.

## Scope and dependency selection

The selected boundary is the deployment build/restore entrypoint, process module linkage and startup, all-corpus readiness validation, and the already-planned three GETs: `/health`, `/health/vehicle-evidence`, then the exact first configuration only after ready status and the expected manifest. Static imports for other routes are included because Node links them through `server/index.js`; inclusion does not show that their business operations ran or passed.

The inherited 48 paths expand to 93 through literal relative imports and re-exports. Five build/configuration inputs, all three dynamically discovered migration SQL blobs, and seven runtime data/image inputs produce 108 selected paths. The JSON records every addition by reason and the sorted complete path/hash map. Every relative literal import resolved against the exact Git tree. The only external package in the selected import closure is `pg`; `server/package.json` and `server/package-lock.json` pin the repository's dependency specification and lockfile. The runtime/OS image, package delivery, environment values and live database state are outside this Git-blob proof.

The five build inputs cover the Render selector/build/start commands, npm start/postinstall scripts, direct restore CLI and its postinstall fallback. The migration loader enumerates all matching `NNNN_name.sql` files dynamically; all three present at this exact commit are hashed without executing SQL. `policy-definitions.json` is read with top-level await by `reviewed-definitions.js`. VIN profiles, the 1F7E technical supplement, the first-32 1F7E source JSONL, both approved published WebP images and the Alpine White adapter source image are read during the selected corpus validation path.

The remaining registered-source fallback JSONLs are not copied into this pin list: a present .12 artifact package supplies the release descriptor's exact source assets. The first-32 JSONL remains selected because image validation directly rereads its Git-owned bytes. The Black Sapphire image is not read by the active approved corpus image associations. Optional route business data, tests and unrelated frontend assets are outside this boundary.

## Byte identity and external artifacts

All 108 selected blobs are byte-identical between `566025315c54dbd7940e1791a09ba9278732b9a7` and `e7cf50acd58bda6b0f2b3738c4408f1f374682f8`. Each pin was calculated from `git show e7cf50acd58bda6b0f2b3738c4408f1f374682f8:<path>` bytes, never from mutable working files. The JSON also contains a canonical map digest and an explicit empty difference list.

The selected `fleet-releases.json` has SHA-256 `e13a5f99167bea65cc9a04e6eae41cec56b55caaa229b640e0e47b20f44301e0`. Its approved .12 descriptor binds downloaded artifact paths, sizes and SHA-256 hashes; `fleet-artifacts.js` checks these before restore and publication. External artifact bytes were not fetched or revalidated here. The expected manifest stays `3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30`; the frozen first DTO SHA-256 stays `82712c8d703e6546d6c4298fa3a168b2ea48f09c73931ee9eb061ee36f98e2e4`. No local lookup or replay was used to derive that DTO digest.

## Policy and deployment boundaries

Build restoration calls `createPolicyService()` in `fleet-artifacts.js`. With the Render blueprint's `GCSP_DATABASE_URL` present and no explicit provider override, that selects `PostgresPolicyProvider`. Connectivity, migrations and retained managed policy records therefore remain a genuine deployment/build boundary. Static hashes, fixture tests and a local file-policy check do not establish the managed database's state or compatibility.

Runtime local vehicle lookup has a narrower policy path: `server/index.js` calls `createLocalVehicleEvidenceLookup({ root, repository })` without a policy-service override, and that function explicitly defaults to `createPolicyService({ provider: new FilePolicyProvider() })`. The planned readiness/configuration GETs do not prove that managed PostgreSQL policy reads succeeded. This nuance does not remove the build-restore database boundary.

Parent-reported Linux run `42360886351` completed the fresh public BUILD in 121 seconds with 62 HTTPS fetches. Its later offline phase timed out at 90 seconds; verify and boundary phases were unrun. These are reported existing outcomes, not checks executed in this review. The collaborator's current BUILD-only direction supersedes the original plan's broader Linux cold/offline/boundary deployment gate; the parent must reconcile that stale gate text before sealing. No full Linux pass, live probe pass, successful deployment, Story acceptance or Done transition is claimed.

## Verification and resource receipt

This documentation-only review selects JSON parse/readback, equality of path and pin sets, recomputation of every exact-commit SHA-256, the 108-path cross-commit byte comparison, output-size inspection and `git diff --check`. Tests and deployment probes are excluded because no executable code changes and this task authorises static review only. The affected boundary is the new evidence packet; existing source, plan, supervisor and status files are unchanged.

No probes, source HTTP calls, SQL, browsers, credentials or deployment actions were used. No test worker, scratch directory, browser profile, archive or large generated input/output was allocated. Only this small retained packet was created. There are no owned scratch paths or child processes to remove; the pre-existing unowned `_tools/__pycache__/test_resources.cpython-314.pyc` is preserved.
