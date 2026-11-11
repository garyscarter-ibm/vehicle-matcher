# FUCQ-396: offline fleet signature-policy validation

Gary's 11 November Render build log fails at `validate-cache`, before application startup. Both selected and previous manifests report `signature-policy-unavailable`. This is a distinct build blocker following the FUCQ-393 memory repair; FUCQ-392 made the underlying diagnostic visible.

## Diagnosis

`restoreFleetRelease` constructed `createPolicyService()` without a provider. When Render supplies `GCSP_DATABASE_URL`, the factory selects `PostgresPolicyProvider`. Signature validation can therefore connect, migrate and seed the runtime database, despite the cached artifact restore being offline. Database unavailability is translated into the exact manifest-policy failure Gary supplied.

The real offline CLI regression reproduces the same failure against valid, checksummed fixture assets using an unavailable loopback database URL. The remote provider's original outcome is not visible, so this proves the defective dependency and matching reproduction rather than the precise managed database event. `manifestDigestMatches:false` is produced because validation returned no active manifest; it does not independently demonstrate corrupt bytes.

## Repair

Explicitly compose the canonical `FilePolicyProvider` only inside artifact restore. Retained manifest policy pins still flow through `PolicyService` and the unchanged corpus validator. Runtime policy composition remains as configured. Release approval, exact bytes, signatures, source admission, immutable identities and prior-selection protection remain enforced. No configuration IDs, approved artifacts or policy contents change.

## Validation

Node 20.20.2, bounded synthetic fixtures, one worker, supervised scratch and no production database access:

- Original production composition fails the new real-CLI regression with `validate-cache / signature-policy-unavailable` (one selected failure, 12 name-filter exclusions), log `20261111-172615-6zrxf5s6`.
- Patched selection: **60 pass, zero failures/skips**, 9.8 seconds, log `20261111-172628-em4_iesz`. Includes real offline cold restore, idempotent existing-store restore under unavailable/empty database settings, unchanged corpus/VIN/inventory bytes, existing-store conflict preservation, build entry, registry/publication integrity and policy-service boundaries.
- Selected command: `node --test --test-concurrency=1 server/test/gcsp-fleet-artifacts.test.js server/test/gcsp-fleet-build-entry.test.js server/test/gcsp-vin-registry.test.js server/test/gcsp-vin-publication.test.js server/test/gcsp-policy-service.test.js`, via `_tools/test_stamp.py --targeted 364849374c453fde85875e611b039da7088c47a0` with the scoped impact reason.
- Supervisor and test scratch removed; receipts remain outside scratch. Full corpus download, full suite, Linux/Render deployment and live database recovery are unrun. No new memory saving is claimed for this small composition fix.

## Immediate build-command workaround

On the earlier code, prefix only the artifact restore invocation with `env -u GCSP_DATABASE_URL`:

```sh
cd server && GCSP_FLEET_BUILD_EXPLICIT=1 npm install && env -u GCSP_DATABASE_URL node scripts/fleet-artifacts.mjs restore --release 3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30 --store "$PWD/data/gcsp/vehicle-evidence/fleet-source.v1" --cache "$PWD/data/gcsp/vehicle-evidence/fleet-artifacts.v1" --network download
```

The unset applies to that child process only. Keep the runtime service's database setting configured. This removes the build dependency; it does not recover an unavailable PostgreSQL service. No Render command or service setting was changed here.
