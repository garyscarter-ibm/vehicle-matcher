# FUCQ-413 price and allowance compilation

Lightning McQueen owns DEV-2026-11-13-GC-006 on `dev/DEV-2026-11-13-GC-006`, admitted at `a5dd9630` (published F414 integration). The dispatcher owns publication, shared-base integration, claims, native Jira, acceptance lifecycle and cleanup. The helper resolves `gcsp-poc-dev`. No new source, UI, policy values, points rules or acceptance criteria are introduced.

## Contract and plan

The original four criteria remain fixed: exact configuration and match-field equality prices with ambiguity/missing outcomes; first effective context/grade allowance and provenance across activation/history; bounded repeated work without full price/allowance scans per candidate; connected release/offer/accepted-history review at desktop and narrow widths, including no-match and conflict/replay.

Stable map slices are `prices`, `allowances` and `integration`. The verified `policy` component already associates FUCQ-413. Implementation is additive to the F412 immutable snapshots, pinned-row reuse and effective-interval eligibility compiler in `server/gcsp/policy/index.js`. A pin still resolves at version activation; unpinned reads still discover the canonical current provider versions and respect dated row boundaries. Existing F412 AC4 and separate Low F400, Medium F484 and Medium F486 remain open and unfixed.

The actual read boundary is `resolved.rows(table)`, backed by validated immutable seeds. Compile equality lookups per seed and finite effective interval, preserving exact own-property equality, model/configuration ambiguity and first effective allowance order. Returned rows retain complete provenance and clone isolation. Price and allowance source values remain unchanged.

## Selected validation and resources

Run each with `node --test --test-concurrency=1`:

- `server/test/gcsp-policy-price-allowance-compiled.test.js` (new independent scan-oracle equivalence and bounded operation proof).
- `server/test/gcsp-policy-service.test.js` (original typed contracts and pinned reads).
- `server/test/gcsp-policy-versions.test.js` (publication/activation/reopen, including isolated native PostgreSQL).
- `server/test/gcsp-policy-adoption.test.js` (existing publication facade and activation).
- `server/test/gcsp-policy-eligibility-compiled.test.js` (preserve F412).

Select actual affected caller checks from inspected interfaces; no whole-suite/load run is justified by this internal equality change. Targeted evidence cannot establish a full stamp. Restricted/unset `FUCQ106_MODULE_MAP` remains unavailable; fixtures establish no hosted Java/OIDC or inaccessible native-offer acceptance. Preserve failed/skipped/unrun checks and every unmet original gate.

Shared resource receipts live at `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq413/`. `manifest.json` selects the checks and boundaries before allocation. Each child owns its scratch manifest/finalizer, scoped temporary variables and bounded output. Start one worker, at most 2 GiB scratch and ten minutes per chunk, keep a 5 GiB reserve and adapt near 30 GiB. Large output above 256 MiB goes directly to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq413`; none is planned. Preserve installed dependencies. Stop/join owned process groups, remove only owned scratch and verify filesystem absence before return.

Native PostgreSQL 16.15 binaries exist locally. The dispatcher reserved the next isolated native window after source readiness; no shared database, credentials or pre-existing cluster/process is used. A uniquely named manifest-owned local cluster may be allocated only in that window, bound to loopback/socket with bounded memory and teardown proof.

## Agents and current state

- Lead Lightning McQueen: requested/selected/effective `gpt-6.1-sol` / `high`, saved rollout line 8, sidebar title verified, no fallback.
- Price implementer Heihei: requested/selected/effective `gpt-6.1-sol` / `medium`, saved rollout line 8 and own title verified; one child at a time, no fallback.

Implementation and independent review are in progress. Original acceptance remains open; no Built, Done, waiver or closure is claimed. Visual references remain `docs/gcsp/screens/README.md`, `COMPONENTS.md` and frozen baseline `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, under `docs/gcsp/experience-quality.md` and the scope rules in `docs/gcsp/build-rules.md`.

## Price delivery checkpoint

The price compiler groups effective rows by scheme, field and exact value, keeping row/count cells so simultaneous model/configuration matches and generic `configurationId` equality remain ambiguous. The seed-keyed cache is bounded by effective starts/ends. The new regression compares complete outcomes with the old scan across primitives, inherited facts, arbitrary fields, scheme/context errors, dated intervals, active successors, historical pins, run reset and mutation isolation.

Heihei passed five new cases, 21 service cases and five eligibility cases. Lead review read the stat/diff, complete new oracle tests and actual recommendation callers, then reran the five focused and 21 service cases: **26 pass, zero fail/skip**. First compilation visits 23 price rows across instrumentation; 64 repeated pinned/unpinned calls leave that at 23. The next interval raises it to 39; 32 more calls and a historical pin leave it at 39. This measures collection work, not a wall-clock speedup. Tested policy SHA-256: `e1ce7e6de7c2d475d7783833672a1183799d2f29612076fc9d6a4c07a1ae1690`.

The first attempt failed before tests with `ERR_MODULE_NOT_FOUND` for `pg`; it remains in `heihei-initial-price.log` and the initial receipt. Successful checks used a manifest-owned temporary worker dependency link to the installed root `server/node_modules`. Both implementer and lead receipts verify scratch/link absence and unchanged `pg/package.json` target. Implementer peak sampled scratch was 965,561 bytes and direct-child RSS 178,782,208 bytes. Retained receipts are `heihei-receipt.json` and `lead-price-receipt.json` under the shared resource directory. No native/browser allocation occurred in this checkpoint.

## Allowance delivery checkpoint

Maximus the Horse (requested/selected/effective `gpt-6.1-sol` / `medium`, rollout line 8 and sidebar title verified, no fallback) added company → scheme → grade Maps, retaining the first effective row and immutable-seed/effective-interval boundaries. Context/read validation remains ahead of lookup. Lead read the complete source/test diff and reran ten combined focused cases plus 21 service cases: **31 pass, zero fail/skip**. Maximus also passed the five unchanged eligibility cases, for 36 scoped passes on the same final code.

Allowance collection visits remain 11 after 64 repeated contextual reads, then 19 after compiling the next interval, another 32 reads and a historical pin. Instrumentation counts filter, find and iteration. Complete typed/provenance oracle tests cover malformed contexts, unavailable/invalid source, prototype-like identifiers, missing rows, dates/gaps/source order, activation/reset and mutation isolation. Final policy SHA-256 is `bcb722c43b687d00f571a1508ff34238189072605cd05b4e28fadcabf54f4042`; focused regression SHA-256 is `a8cce9518916c8a51c61dff2aee4154e123221396cd041ad9317827d540a23ed`.

`maximus-receipt.json` and `lead-allowance-receipt.json` retain commands, source identities and cleanup. Independently checked: dependency link and scratch absent; installed pg package unchanged. Lead sampled scratch peak 965,561 bytes and direct-child RSS 185,532,416 bytes; sampling does not prove a total process-tree peak. Dispatcher explicitly reserved the isolated native window after this checkpoint. Original connected/native acceptance remains open.

## Native and connected validation checkpoint

On checkpoint `92139ae9`, the selected policy versions command ran against an isolated PostgreSQL 16.15 Homebrew cluster: **23 pass, one known FUCQ-484 Medium failure, zero skips**. The failure is the unchanged assertion expecting migrations 0001–0008 when 0009 is present. It remains unfixed and separately linked; native typed rows, dated activation, retained pins, concurrent publication, rollback and reopen passed.

The scoped helper command was `_tools/test_stamp.py --targeted a5dd9630 --reason <reviewed policy/caller boundary> --command 'node --test --test-concurrency=1 server/test/gcsp-policy-adoption.test.js server/test/gcsp-allocation-runtime.test.js server/test/gcsp-generated-configuration-offer.test.js'`. It passed **13 tests, zero fail/skip**: five adoption, seven allocation (including actual native six-release persistence) and one generated-configuration offer. The actual recommendation boundary reads an allowance once and price per candidate. Native SQL maximum tick JSON was 5,342 bytes and clock receipt/command JSON 5,517 bytes. Targeted evidence is `targeted-0daee9df0d190b7962ef2c0ad3f5d79ba04778eb96ef78855c46a6920c3620f9-default-1794614374428988000.json`; no full stamp is claimed.

An additional actual `PostgresPolicyProvider` proof published price and allowance together through the trusted policy facade, checked before/at activation, compared complete values/provenance, retained original pins and reopened a new provider/service. **Six checks passed.** The first owned proof attempt incorrectly expected predecessor `effectiveFrom` on changed successor rows. Canonical publication sets their activation date; only that proof expectation was corrected. The original script/error remain in `native-proof-initial.mjs`/`native-3.log`, with retry basis and corrected identity retained separately. This was not a production defect or repair. Identity/clock used the real in-process memory repository; this proof does not establish hosted OIDC/Java integration.

`native-receipt.json`, `native-retry-receipt.json` and `native-independent-cleanup.json` verify both supervised phases stopped the exact owned cluster, no test schemas remained, and `/private/tmp/fucq413-pg-01a1d74d` data/socket/root and worker dependency link are absent. No owned PostgreSQL process remains; source and installed pg package hashes are unchanged. Sampled disk peaks were 84,868,433 and 44,461,108 bytes; direct-child maximum RSS was 527,269,888 and 142,868,480 bytes. These are sampled disk/direct-child measurements, not a total concurrent process-tree peak. The bounded local database working-data exception was declared and removed; native window released to dispatcher.

The actual existing hosted memory application ran from an exact current-worker mirror with no historical source overrides or API response fixtures. Release/allocation, no-match history, pending offer, API acceptance/replay/changed-input conflict and current accepted offer/history produced **39 passing checks and ten PNGs** at 1440×1000 and 375×812. No browser faults or horizontal page overflow were recorded; reduced motion and a Tab sample were used. The lead inspected pending-offer desktop/narrow PNGs; independent reviewer Sniffles (`gpt-6.1-sol` / `high` requested/selected, runtime verification pending) is inspecting all outcomes against references.

Browser evidence is under shared `fucq413/browser/`: `manifest.json`, `connected.mjs`, `result.json`, `receipt.json`, `independent-cleanup.json`, and `captures/`. Decisions were API-driven and captures show resulting accepted state after replay/conflict; an interactive conflict UI is not proven. Browser scratch/profile and owned profile processes are independently absent. Copied source was 17,861,554 bytes, sampled scratch peak 32,961,013 bytes and direct-child maximum RSS 725,008,384 bytes; source/dependencies remained unchanged. Immutable large fixtures were linked read-only; no large retained output/archive was created. Safari/private browsing, a full accessibility audit, real OIDC/Java and deployed hosted-dev review remain unrun. Restricted `FUCQ106_MODULE_MAP` was neither inspected nor fabricated. These limits remain distinct from the passed Node/native boundary checks.
