# FUCQ-134 causal repair: changed consumers and validation proposal

6 November 2026. Root authorized bounded repair authoring after Barney McGrew's independent Sol/high static proposal review passed at `10b2db389654dfec5d68e15a2ca0d7fdfc601e7b`. Root's local receipt is `.claude/test-runs/ownership/fucq134-proposal-static-review-0942.json`. No fallback or descendants. The [diagnosis](fucq134-current-route-failure-proposal.md) remains the historical account of the failed run; this document records the subsequent authored repair. **Implementation review and fresh root runtime admission remain required. No test or probe ran, and no execution grant follows.**

## Exact changed consumers

| Owned consumer | Authored change | Preserved boundary |
| --- | --- | --- |
| `server/gcsp/comparison/harness.js:2,205` | Import and enumerate `FOUNDATION_TABLES` in the repository sentinel. | Same default memory repository; every supported query must succeed. The separately injected PolicyService remains authoritative for policy reads; no policy persistence or table-capability override. |
| `server/test/fixtures/gcsp-comparison-current-outcomes.json` | Select `F70 Sports Hatch\|120`; declare one fictional configuration, its structural signature and three necessary typed facts: petrol, five seats, insurance group 25. Bump the selected policy suffix to `+fucq134-mechanics-v2`. | Same seed, cohort two, two stock cars, release/renewal/need inputs and expected outcomes. Factory codes and gate facts are explicitly synthetic; unspecified specifications remain unknown. |
| `server/test/gcsp-comparison-current.test.js:26` | Extend the already selected, cloned test policy variant with that configuration and its fact entry. Mark the affected assumption rows with fixture source/date/basis and variant versions. Refuse a non-fixture configuration set or duplicate model. | Canonical eligibility, price plans, allowances, grade distribution and generator overlay restrictions are untouched. Only the variant's configuration set and comparison record adapter gain the F70 entry. No fallback registry. |
| Same test, `browseDiagnostic` / `claimFirst` | Add actual generated grade plus existing decision gate statuses and blocker/unknown codes to the expected-car-count assertion message. | Expected-two assertion and subsequent real claim/review/allocation/expiry assertions remain. Diagnostics contain at most two decisions, eight codes of each kind per decision, 64 UTF-16 units per code, 32 per grade/status, plus counts. No full contexts, facts, payloads or identity dumps. |
| `docs/gcsp/evidence/fucq134/first-chunk-supervisor.py:226` | Insert `--test-reporter=tap` between the pinned Node executable and the gated launcher. | Byte-identical supervisor after removing that one argument; exact TAP parser and all setup, accounting, timeouts, signaling, joining, finalization and completion behavior remain. |

The new configuration signature is the base64 encoding of `CMPF70:REFPAINT,REFTRIM`. These codes are fictional. The canonical FS&UK F70 rule includes all four generated grade bands and its canonical monthly cost is 800 points, below the unchanged minimum allowance of 1,000. This establishes static fixture compatibility; it does not establish a runtime browse, quote or lifecycle result. Only the selected mechanics variant appends the configuration/facts. Canonical seed data, the base generator, actual66 producer code, the inactive outcome proposal, launcher, offline guard and shared helpers remain unchanged.

There are no new import specifiers, source files, dynamic imports, installed packages or executable modes. The source graph refresh records current authored hashes and the reviewed scope while preserving historical review and failed-run facts. Product-map and Jira states are unchanged. This changes harness/test preparation only, with no application screen or user-visible product behavior; no new visual acceptance claim is made.

Impact selection: `isolation` exercises the first repository sentinel and cross-run separation; all three cases use the selected fixture, preparation and `claimFirst` diagnostic. Allocation and expiry cases also consume the repaired snapshot for their persisted assertions. The launch argument affects reporting for those same three cases and their exact completion parser. The common PolicyService/recommendation/manual-context/claim producers are unchanged and are exercised at those integration boundaries rather than repeated in upstream suites. Later route/cache/outcome, corpus, native/live and application UI consumers remain outside this authoring chunk and receive no validation claim.

## Replacement freeze and static evidence

- Admission: `docs/gcsp/evidence/fucq134/first-chunk-admission.json`, SHA-256 **`40b01c34dc43163f2c31cbb8668088489d6062875a0c5385bbfcd5cf449f75da`**.
- Composed source identity: **`4305c000e321ceb67bd9d4cbecdf6440f1aca038f09815a71eade92339b0b311`**.
- Same 45 source files, now 975,827 bytes; same 72 accepted import edges and 236 physical nodes. Only harness, test and fixture embedded source hashes change; all other 42 embedded sources match the prior freeze. The supervisor's flag and source graph are covered by physical/content pins.
- Base remains `034b56d08fb742d31478218b670552805d5840ab`; actual66 remains `eb5a677b37c486e3da7c4547803f739e22df8ac3`. Prior admission `07300f741f8eebc19a8baa68c571a924de4daa8429cbb1e693fdb51e6ba76079` is preserved at published `09aa1c85a22bc6cd1361c1a0a34fa71198bde48c`.
- Static checks: exact allowed consumer delta against the prior publication; reconstruct original test bytes after removing only variant preparation/diagnostic additions; fixture-only JSON delta; structural signature and canonical rule/price/allowance compatibility; unchanged local import specifiers; four Python ASTs; all authored closure and embedded source hashes; pinned helper preservation; unchanged selection, limits, exact parser and safety suffixes; bounded retained evidence hashes and documentation/diff checks.
- The unchanged static freezer was invoked with `/usr/bin/python3 -I -B`. It imports only the pinned Git adapter, reads/hashes inputs and writes the replacement admission. No edited runtime helper, product or JavaScript module was imported. No supervisor plan/execution, generator draw, OS probe, native database, service, browser, reservation, scratch or test worker was allocated.

## Fresh-admission proposal, not an execution grant

Root first reviews the exact publication, changed consumers and replacement freeze. If admitted, the plan-only command is:

```sh
/usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-supervisor.py --plan --admission-sha 40b01c34dc43163f2c31cbb8668088489d6062875a0c5385bbfcd5cf449f75da
```

Only after a fresh explicit once-only execution grant may root use the existing parent/controller/audit protocol with this replacement identity:

```sh
if fucq134_completion_ticket="$(/usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-supervisor.py --execute --admission-sha 40b01c34dc43163f2c31cbb8668088489d6062875a0c5385bbfcd5cf449f75da --dispatcher-grant fucq134-first-chunk-40b01c34dc43163f2c31cbb8668088489d6062875a0c5385bbfcd5cf449f75da)"; then
  fucq134_controller_exit=0
else
  fucq134_controller_exit=$?
fi
printf '%s\n' "$fucq134_completion_ticket" | /usr/bin/env -i HOME=/Users/garycarter USER=garycarter LOGNAME=garycarter PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=Europe/London /usr/bin/python3 -I -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-103/docs/gcsp/evidence/fucq134/first-chunk-completion.py --audit --controller-exit "$fucq134_controller_exit" --admission-sha 40b01c34dc43163f2c31cbb8668088489d6062875a0c5385bbfcd5cf449f75da
```

The supplied argument records a grant; knowing it provides none. No command above ran during authoring. Root retains both actual exit statuses, bounded complete stdout and the final tool wait, then performs its independent cleanup audit. A provisional receipt, cleanup PASS, a parser-only success or a later retry cannot substitute for completion.

Selection remains exactly `isolation`, `real-claim-review-allocate`, `untaken-expiry`. Required runtime evidence is three exact TAP names, tests3/pass3/fail0/cancelled0/skipped0/todo0, Node/controller/audit exit0, non-vacuous two-car browse, unchanged sentinel, persisted allocation and exact-deadline expiry/returned stock. The explicit reporter argument's compatibility with this pinned Node26/direct-import route remains unproved until that authorized run. Any failure preserves its original evidence and stops this once-only opportunity; it grants no retry or broader mode.

Limits remain one worker, 120 seconds whole / 110 execution, 768 MiB aggregate RSS, 128 MiB combined scratch/retained output, 2 MiB log, 5 GiB host reserve and existing internal completion margins. Every reservation's strict binding/accounting and the owned process/scratch lifecycle stay unchanged. No full suite, upstream repeat, native/live integration, route/cache/outcome/comparison result or story acceptance is included.

The newest actual result remains **0/3 passed, controller2/audit1/Node1**. Its failed-run grade remains **UNKNOWN**; bounded diagnostics in a different fixture run cannot reconstruct discarded inputs. Its retained log/manifests/receipt and root cleanup **PASS19** remain unchanged and distinct. The original pre-Node unknown row and earlier captured `?` state failure/uncertain group remain preserved. Agents: requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants.
