# Live catalogue verification runbook (FUCQ-48)

Date: 9 November 2026. Status: harness built and proved offline only. **The live run has not been executed.**

Harness: `scripts/gcsp/verify-live-catalogue.mjs` (version `fucq-48-verify.v1`). Offline tests:
`server/test/verify-live-catalogue.test.js`. The route it exercises is the unsupported demo route described in
[README.md](README.md): BMW UCP reads with the public configurator website key. It is not a BMW-supported API or a
production entitlement. What each kind of evidence can claim is in [claims.md](claims.md).

## What the harness does

- Builds the provider with `createBmwCatalogueProvider`, the same path application callers use, and resolves one request once.
  The default target is the exact identity of the bundled snapshot (`bmw-gb-i5-2026-11-01.v1`: T5MJ, G61E / G61, AG 72HH, trim
  S0337, 47 options, 1 accessory). `--target <file>` takes another request as JSON; the request holds no secret.
- Selection and access come only from backend env: `GCSP_CATALOGUE_PROVIDER=bmw-ucp-live` and `GCSP_BMW_UCP_API_KEY`. Any argument
  containing `key`, `token` or `=` is refused (exit 2). The report records only `credential: present|absent`.
- Without `--live` it prints the plan and exits 0. It builds no transport and sends nothing.
- With `--live --out <dir>` it requires the live selection and the credential (else exit 3, nothing sent), writes a fresh
  `ledger.jsonl` (0600; an existing ledger is refused) and `report.json` (0600) into `<dir>` (0700).

## Bounds and stop conditions

| Bound | Value | Enforced by |
| --- | --- | --- |
| Hosts | `prod.ucp.bmw.cloud` over HTTPS only | Guard refuses any other host |
| Methods and paths | GET only; never `/garage`, `anonymous-configurations`, `configuration-state`, `marketing-texts`, `pricing` | Guard |
| Ledger | One entry written through the provider's `trace` request event before each call; a request with no entry is refused | Guard |
| Request cap | 8 by default and at most 8 (`--max-requests 1..8`); one resolve needs 4, at most 8 with single retries | Guard |
| Concurrency | 1 | Provider gate (FUCQ-47) |
| Stop | 401 or 403, 429, a challenge (non-JSON 200, markup, a non-JSON content type, or a captcha or challenge marker), or 3 failures in a row | Guard; every later request is refused |

Exit codes: 0 pass, 1 not pass (including stopped), 2 usage, 3 preconditions missing.

## What a pass requires

All of: no stop and no refused request; live status `ok` or `partial`; exact identity (model, range, raw range, AG model, trim and
all five dates field by field); the complete sorted option list and the accessories equal; constructible; at least one mapped OTD
measurement known; every known mapped measurement equal to the value read independently from the held OTD body. Anything else is
`identity-mismatch`, `source-unavailable`, `stopped` or `fail`, with reason codes. `satisfiesLivePositive` is true only for a
`--live` run that passes; offline runs are labelled `offline-mock` and never satisfy it.

The report holds only normalised comparisons, fixed presentation strings, provider, version, policy version, retrieved date, hosts,
request count and the limitations list. Raw bodies stay in memory and are discarded. Every ledger entry and the report pass
`assertRedacted` (no key, URL, `x-api-key`, markup or UUID-shaped token) before they are kept.

## Preconditions for a live run (all unmet on 9 November 2026)

1. **The user's direct go-ahead in the session that runs it.** Launching the live run was refused by this machine's permission
   controls on 9 November, so it needs that decision directly, not one relayed through an agent.
2. Gary's 9 November conditions for the public website key (chain rules, "Yes, env only"): obtained only from BMW's anonymous public
   settings JSON as the page does; written to a 0600 file in run-owned scratch and loaded into env in the same shell; never printed,
   put in an argument or URL, or allowed into logs, evidence, fixtures, git or Jira; deleted at the end and its absence verified.
   No key-handling script ships with this story.
3. The request budget share for the run is recorded in the receipt (the chain budget is 500 requests across FUCQ-46/47/48; FUCQ-48
   needs at most 8).
4. A run-owned scratch directory for `--out`, outside the repository.

## Steps (for the session that has the go-ahead)

1. `node scripts/gcsp/verify-live-catalogue.mjs` with the env set: check the plan shows `Provider selection: live`, `Credential:
   present` and the target.
2. `node scripts/gcsp/verify-live-catalogue.mjs --live --out <run-owned scratch dir>` once. Do not rerun on a stop; report it.
3. Check the key is absent from both files by reading it from the 0600 key file (`grep -c -F -f <key file> <dir>/*`, which must
   print 0 for each), never from an argument.
4. Review `report.json`, then copy `report.json` and `ledger.jsonl` into `docs/gcsp/evidence/fucq-16/live-<date>/` with a receipt:
   hosts, request count, stop reason, verdict, the run's date and limitations.
5. Unset both env values, delete the key file and the scratch directory by absolute path, and verify both are gone.

If BMW refuses or rotates the key, stop and report. Do not look for another way in.
