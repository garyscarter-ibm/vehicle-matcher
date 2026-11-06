# FUCQ-36 static package and release checklist

Prepared 6 November 2026. This is a proposed, separately authorised GCSP release
procedure. No provisioning, publishing, external source access or mail is implied.
Local results and final revision identities are recorded in `fucq36-validation.md`.

## Build and route contract

The GCSP Render static site uses branch `gcsp-poc`, repository root, a current
Node release compatible with the backend's ES modules (the package was checked
with the recorded local Node version), and publish directory `_site-gcsp`:

```sh
node scripts/assemble-site.mjs --output _site-gcsp --environment deployed --api https://GCSP-BACKEND --revision EXACT-FRONTEND-SHA --require-demo-pages
```

Use a clean checkout/output for each release. The command refuses a nonempty
output rather than deleting files. Preserve `site-manifest.json` with the release.
Supply the actual API URL and immutable frontend SHA through the authorised build
configuration. Do not paste a credential into an argument or URL. This command
does not change Render or invoke deployment APIs. A documented configuration is
preferred here to an auto-discovered second blueprint that might alter retail.

For a local package, `node scripts/assemble-site.mjs --output _site-gcsp` uses
`http://localhost:8787`. The deployed setting requires HTTPS and refuses localhost,
credentials, query and fragment. Both launcher API defaults and `block.html`'s
authored default are bound to the chosen API in the output only. An incompatible
source default fails with the filename and expected boundary. Existing runtime
`?api=` override/normalisation and shared-key behaviour remain supported.

`--employee-disabled` configures the actual launcher capability to unavailable;
all six retail brands and five public modes remain registered. It is a route
availability switch, not employee authorisation. It does not remove the packaged
blocks or disable backend endpoints. Redeploy a rebuilt artifact to change it.

The manifest discovers all immediate GCSP directories, recursively includes their
public modules/styles/assets, and records digests and local dependency edges.
New literal import targets are covered; computed dynamic imports fail with their
block/file rather than silently escape validation. Finite template brand assets
are checked from the existing retail brand registry. Server/configuration files,
stock fixtures, dependencies and source documentation are excluded. Frontend
display fixtures required by existing harnesses remain labelled synthetic.

Pages use external modules and a `script-src 'self'` CSP. The assembler extracts
the existing standalone inline script into `block-entry.js` in the output;
source retail pages/workflows are untouched. Styles retain the existing inline
style allowance, external vehicle images remain permitted, and the selected API
origin is explicitly allowed by `connect-src`. No rewrite rules are required:

| Surface | Root URL | Repository-prefix URL |
|---|---|---|
| Launcher | `/index.html` | `/vehicle-matcher/index.html` |
| Retail picker | `/index.html?experience=used-cars` | `/vehicle-matcher/index.html?experience=used-cars` |
| Retail example | `/index.html?brand=mini&mode=swipe` | `/vehicle-matcher/index.html?brand=mini&mode=swipe` |
| Standalone retail | `/block.html?brand=bmw` | `/vehicle-matcher/block.html?brand=bmw` |
| Real employee entry | `/index.html?experience=employee-cars&brand=bmw` | `/vehicle-matcher/index.html?experience=employee-cars&brand=bmw` |
| Greg fixture dashboard | `/gcsp-greg.html` | `/vehicle-matcher/gcsp-greg.html` |
| Presenter fixture viewer | `/gcsp-outbox.html` | `/vehicle-matcher/gcsp-outbox.html` |
| Gallery | `/components.html` | `/vehicle-matcher/components.html` |

The direct offer page is currently absent from the integrated base. Its actual
GC-owned FUCQ-105 source is `blocks/gcsp/offer/preview.html` on
`65f4a911285161b7fc9d3ec303ecfea2175df2d4`. The assembler will discover it when
integrated, without a fixed block list; its preview/harness remains synthetic
unless the page's actual transport is configured and verified. Until integration,
`--require-demo-pages` must fail naming block `offer`. A source-pin trial cannot
satisfy the integrated release gate. Greg/outbox pages at this revision are
existing fixture harnesses, not proof of live dashboard/outbox composition.

## Compatible backend and state

Record exact frontend SHA/file digests, backend SHA/build identifier, API URL,
environment/run/scenario, policy version and schema ledger together. Matching
branch names are insufficient. The backend must expose the additive identity,
cookie/context and `/api/gcsp/manual/account`/`draft` contracts used by the real
entry, the retail `/api/*` contracts used by its six brands/five modes, and the
actual integrated offer/Greg/outbox transports for a live walkthrough. Retain
existing response versions, typed refusal/error states and source gates.

The frontend does not supply employee identity, policy, stock authority or
credentials. Separate static/API origins require the exact static origin in
`GCSP_ALLOWED_ORIGINS`, credentialed CORS, HTTPS and working HttpOnly session
cookies (`SameSite=None; Secure` under the canonical policy). Browser third-party
cookie restrictions still need a deployed check. The shared demo password does
not establish employee identity. No database URL is embedded in the static site.

Available migration order in this revision (not a claim that any is applied):

1. `0001_transaction_foundation.sql` — FUCQ-81 transaction/repository foundation.
2. `0002_policy_tables.sql` — FUCQ-83 dated policy storage/publication.
3. `0003_renewal_cases.sql` — additive FUCQ-112 renewal cases already present.

The existing `server/gcsp/migrations/index.js` discovers ordered migration files,
checks the schema-scoped ledger/checksums and applies them under its advisory
lock. Use its repository open/migration-status path; do not manually relabel
ledger rows. Keep all migrations present in the exact backend release; later
additions require a refreshed ledger/checklist.

FUCQ-83's `PostgresPolicyProvider` seeds on first run-scoped read from the shared
`FilePolicyProvider`, preserving its digest and idempotent retained version.
Canonical input is `server/gcsp/policy/seed-v1.json`, `schemaVersion: 1`,
`policyVersion: gcsp-policy-v1`, effective `2026-11-04T00:00:00.000Z`.
Capture the exact seed digest from the released revision and the active/pinned
policy projection; a version label alone cannot prove identical content.
Publishing later revisions goes through the trusted Greg/PolicyService path,
not a second frontend default table. Restore retained versions/ledger together.

Gary-owned provisioning facts still need verification: actual static/backend
service names/URLs, branch and build/start commands, managed PostgreSQL
instance/schema/backup ownership, secrets, allowed origins/cookies, custom domain,
access gate, retained data/corpus mount, mail readiness, revision rollback and
who performs the authorised release. Local memory is explicit disposable proof;
it is not a PostgreSQL durability check. Current live GCSP state is unknown.

## Later authorised release checks

- Record the immutable frontend/backend revisions, manifest, API setting,
  migration ledger/checksums, seed digest/policy version and run identity.
- Check `/health` and the backend's actual configured GCSP startup; verify
  database/policy/identity availability through supported application routes.
- Open the root launcher, every retail brand/mode and the real employee URL;
  inspect API request origins, cookies, CORS and password/session refusal states.
- Open offer, Greg and presenter viewer directly, then refresh each. Verify the
  actual current state and transport rather than a fixture's apparent success.
  Check the offer's sanctioned link/access contract without inventing a token.
- Exercise keyboard focus/navigation and desktop/narrow layouts. Inspect console,
  network, image/font failures, expiry/error/retry and the employee-disabled
  artifact. Preserve truthful source, representative-image and unavailable states.
- Serve a second copy under `/vehicle-matcher/` and repeat URL/asset/refresh checks.
  A missing URL must return 404; no fallback-to-index rewrite may hide it.
- Confirm retail Pages remains `main`/`workflow_dispatch`, existing retail Render
  and EDS triggers are unchanged, and GCSP has not been published to `main`/EDS.

Provisioning, publishing, native database acceptance, real BMW operational
readiness and actual mail delivery remain separately authorised evidence.
