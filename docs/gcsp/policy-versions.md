# Dated policy versions · FUCQ-83

Source checkpoint, 5 November 2026. This story remains blocked on the GCSP Render PostgreSQL instance Gary provisions. `GCSP_DATABASE_URL` is unset in this session; no alternate database is authorised. Memory contracts and SQL-driver checks cannot establish native SQL execution. Full validation is held for the FUCQ-56 integration checkpoint and the dispatcher’s admission.

## Implementation choices

The existing PolicyService typed reads and immutable activation-time pins keep their meanings. `createPolicyService()` selects PostgreSQL whenever `GCSP_DATABASE_URL` is configured, including an invalid/empty setting: failure stays unavailable. An explicit provider or file/retained-file input is a deliberate test/what-if source. No fallback follows a database failure. `close()` releases a factory-owned database pool; supplied pools remain caller-owned.

`MemoryPolicyProvider` is an explicit mutable test provider. `PostgresPolicyProvider` uses the existing migration runner and `pg` dependency. Additive `0002_policy_tables.sql` creates the six reserved policy tables; applied migrations 0001 and 0003 remain unchanged. Every table has run/version/effective-date columns, and child rows retain their complete typed seed provenance. Native constraints protect identifiers, version dates, command replay keys and links. Update/delete triggers keep all six policy tables append-only. Policy seeding can precede run bootstrap, so policy rows deliberately have no foreign key to a not-yet-created run. They never change mutable run/offer rows.

The reviewed `seed-v1.json` remains version 1’s origin, with all existing canonical assumptions retained. First-use seeding and publication serialize per schema/run; complete row sets commit together. Reopening reads persisted tables and checks the complete seed digest and schema. No SQL error, URL or credential appears in a returned outcome.

## Trusted publish command

Inject the existing `DemoIdentityAdapter` and `DemoClock` through `{ identity, clock }` when constructing a writable PolicyService. `publishPolicyVersion(context, changeSet)` checks the adapter-owned Greg context, obtains the current run/time from the clock, then rechecks Greg authority inside the serialized operation. Browser-copied roles cannot satisfy the identity adapter. No new screen, route, endpoint, role resolver or clock source is introduced.

The additive command shape is `{ commandId, expectedActiveVersion, policyVersion, effectiveFrom, changes: [{ table, key, patch }] }`. `table` names one existing seed collection. Each patch changes existing entry fields and supplies `basis`, `source`, `sourceDate` and `status`. IDs and dates cannot be patched, and entries cannot be inserted/deleted by this bounded operation. A full successor snapshot passes the existing seed validator before insertion. A price/allowance patch updates both `value` and `monthlyPoints` to keep the existing contract coherent.

The new effective date must be at or after the injected current instant and later than every retained version. This simple append order prevents conflicting scheduled versions; an already-scheduled version is not overwritten. `expectedActiveVersion` checks the version active at publish time. Replaying the same actor/command/input returns the original accepted outcome; changed input conflicts. The audit records publisher principal, DemoClock publication time, command/input digest and complete seed digest. Previous version rows, quotes and offer terms are never rewritten. Future versions become active only when subsequent unpinned reads use a DemoClock instant at/after their effective date. Existing consumers already provide `PolicyRead.asOf`; a pin always uses its retained activation-time terms.

## Selected validation and ownership

Changed source: policy/index.js, new publish/memory/PostgreSQL modules, additive 0002, one new policy-version test and response fixture. Existing `gcsp-policy-service.test.js` stays unchanged. No generic repository, clock, cases, notifications, startup, route, consumer, UI, seed or 0003 changes are selected.

First chunk: `node --test --test-concurrency=1 server/test/gcsp-policy-versions.test.js server/test/gcsp-policy-service.test.js`. Boundary chunks: repository-contract (migration discovery/immutability isolation), identity (trusted Greg authority), clock-reset (run bootstrap and historical time), employee-recommendation (typed/pinned reads) and comparison-generator (17 canonical comparison keys/pins). Canonical renewal-case keys and existing migration 0003 are preserved byte-for-byte. Automatic affected selection supports Python only, so reviewed explicit JavaScript commands are used rather than a full fallback. No second suite is run merely to populate coverage.

Native validation, only on the authorised configured target: use a unique isolated schema, run the real migration runner twice, seed/read/reopen, publish/replay/race, invalid rollback, pin/future activation and memory/provider equality; bypass the provider to prove native policy update/delete refusal and row/date counts. Drop only that test-owned schema. An unset URL is reported as a skip and an incomplete integration gate; a configured invalid or unreachable URL must fail. No doubles count as native proof.

The explicit final `npm test` requirement is preserved using `node --test --test-concurrency=1 server/test/**/*.test.js`; it remains held until the dispatcher admits it after FUCQ-56 integration. Scoped results cannot supply a full stamp.

Before every execution chunk, the supervisor writes its ownership manifest outside a unique absolute scratch root and registers final cleanup before allocation. Shared HostBudget reservations cover one actual Node worker, at most 128 MiB disposable scratch/cache and 512 MiB process-group RSS, with 120-second test and 180-second npm-ci limits. Root/server npm-ci run sequentially against their existing lockfiles; installed dependencies remain owned in this worktree, while cache/temp/log scratch is removed after each chunk. Node argv/fanout guards, bounded logs, process-group TERM/KILL/join and exact-root absence checks apply. Retain concise receipts/impact identities outside scratch. No archive or >=256 MiB generated output is expected; such output must go directly to OneDrive Claude with a 5 GiB emergency reserve.

## Experience and design

Backend presentation outcomes are asserted against `server/test/fixtures/gcsp-policy-version-outcomes.json` for the later C6 screen: accepted publication, invalid reasons, refresh conflict and forbidden access. This story adds no screen or component; screenshots are inapplicable. Future consumers follow the experience-quality contract, screens/README.md and COMPONENTS.md.

The canonical HLD already shows Greg → PolicyService → dated PostgreSQL policy tables. No topology change is needed. Its policy status/prose is updated to reflect source/scoped progress only. Background draw.io bridge/status recolouring/render verification remains unavailable; no foreground, raw XML or synthetic render workaround is used. Managed integration remains unverified and no built diagram status is claimed.
