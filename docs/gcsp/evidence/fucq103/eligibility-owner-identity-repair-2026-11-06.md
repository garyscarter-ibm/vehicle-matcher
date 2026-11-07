# FUCQ-103 owner identity compatibility repair — 6 November 2026

## Diagnosis

Source review at `821f62c075486468a8580278bc7d57db3afaa85a` confirms the
FUCQ-126 review's cross-launcher finding. `parse_snapshot` normalizes `lstart`
whitespace through `start_identity`; `Budget.acquire` and `make_scratch` store
that normalized text as the owner start. The unchanged shared helper's
`process_identity` strips only the outside whitespace and `process_alive`
compares the remaining text verbatim. For a single-digit day, raw
`Fri Nov  6 09:27:50 2026` therefore differs from normalized
`Fri Nov 6 09:27:50 2026`. A legacy launcher using that helper can incorrectly
classify a live F103 reservation as dead.

This is source-corroborated risk, not an observed reaping event. The completed
F103 runs, original logs, exits, cleanup receipts, prior failures and root
collections stay tied to their original commits and source-plan digests. No
existing ledger row is inspected, rewritten, pruned or repaired here.

Private source report inspected: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/results/claude-assist-fucq126-2026-11-06-02.md`,
9,395 bytes, SHA-256 `bcaddfcfbd0b9d3430d9c8f770b376a70115b87edfec94436f5735b541a70a08`.
The report stays under ignored `.claude`. This correction belongs to the existing
FUCQ-103 / DEV-2026-11-04-066 resource guard; it creates no claim or Jira change.

## Repair boundary

Preserve the raw five-token start substring from the already-required process
snapshot in a separate field, after the existing strict parser accepts the row.
Use it only for reservation/scratch `owner.start`. Keep normalized `start` for
owned PID/group comparison, signaling and absence proof. Unknown starts remain
unknown and cannot identify the supervisor. Add no query, import or dependency.

Only the owned guard and its two current source-plan pins are refrozen. The
shared `_tools/test_resources.py`, catalogue, supervisors, product/tests,
dependencies/executables, finite selections and resource limits stay unchanged.
Strict ALL-row validation/ancestry, no foreign pruning, fail-closed observations,
exact owned-row update/release and cleanup obligations remain binding.

This guard-only change affects no screen, response, user-visible behavior or
visual reference; no new screenshot applies. The GCSP build, experience,
COMPONENTS and technical-readiness contracts still govern later product acceptance.

## Validation boundary

Authoring and independent review are limited to source text, JSON, bytes, hashes
and Git metadata. No Python AST/syntax check, target import, resource helper execution,
OS/ledger/runtime probe, test, browser, native/database access, scratch allocation
or reservation is authorised. No completed mode may rerun. No credential file is
read. Whole-story acceptance remains open.

## Refrozen source

The repair retains the first five tokens' exact internal spacing as `rawStart`
from the existing successful snapshot. Normalized `start` and all its consumers
remain unchanged. Only `Budget.acquire` and `make_scratch` use `rawStart` when
writing the two-key owner identity; no ledger schema changes.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `scoped-resources.py` | 32,390 | `5e8038a102f5562b17809192b66320dbd3f96658925282a0a7decb8feddd1f06` |
| `eligibility-combined-source-plan.json` | 229,193 | `8a22070530176b6606c72751863b91adb019b8a13489e7e8ecc865b5bebe8e89` |
| `eligibility-browser-source-plan.json` | 223,665 | `68f7b90847f8b27313ab6f12576930b01f0da45368232af8a86bb1871a8badf1` |

Relative to `821f62c`, each plan changes only the guard's `sources` pin and its
matching `deltaFromPriorBrowser.after`. Previous plan digests
`edb1d09f9ab89ee23529cd60e67b3c30e51d15414ac001a3d857c18cb4e8acc9`
and `0fe25d3786ed4184af57d37fd5bc148e5ee7a748405401bb2a3b21f1638c3af8`
remain recoverable at that commit. Every other source pin, source membership,
edge, dependency, executable, directory inventory, resolver absence, physical
anchor, selected case/filter and limit is preserved. No catalogue regeneration
was run. Historical audits/evidence are preserved at their original identities;
they do not establish execution of this repaired guard.

## Minimum separately authorised validation proposal

No validation command is granted or executed by this checkpoint. Do not rerun
core25, registry16, default1, weighted1, runtime4, editor3, dashboard3, publish15
or activation9 to validate an owner-format change.

After independent source review, the narrow next proposal is one isolated
resource-only fixture run against these exact reviewed bytes, with no application
imports, product tests, machine-ledger access or foreign process signaling:

1. Feed synthetic single-digit and two-digit `lstart` rows into the parser;
   require raw spacing to survive and normalized identities to remain equal to
   their former values. Retain representative raw/normalized values.
2. Require invalid dates, malformed RSS, duplicate PIDs and unknown supervisor
   starts to remain fail-closed. Use a changed valid start to check that normalized
   PID-reuse comparison still refuses ownership of the replacement.
3. Exercise both owner writers with in-memory OS/accounting stand-ins, requiring
   the raw owner text, exact owned-row binding and preserved foreign accounting.
   Compare their stored owner through the unchanged shared `process_alive` with
   isolated fake process-identity/kill callbacks; require a matching raw start to
   remain live and a different valid start to be classified as a replacement.

Author/review the finite fixture runner and exact command separately before any
execution. Suggested cap: one worker, 30 seconds total, 128MiB aggregate RSS,
16MiB combined scratch/retained output, 256KiB whole log plus 64KiB receipts;
retain 5GiB host disk and 512MiB host RAM reserves. Use an absolute owned scratch
root and external manifest/finalizer, preserve original exit/log/byte/hash evidence,
stop at the first failure/unknown without retry, and prove owned-child, scratch
and reservation cleanup independently. Synthetic fixtures establish the format
contract only; actual cross-launcher/OS lifecycle proof needs its own admission.

Strict ALL-row/ancestry/current-pressure admission must preserve foreign rows and
charge their reserved/observed resources. No empty-global-ledger condition is
introduced. Existing fleet reaping/SIGKILL risks are outside this source correction
and remain open; the shared helper/fleet is not patched. Whole-story, rendered,
native/live/full and producer/consumer acceptance remain open.

## Independent source review

Mushu returned **PASS — no blocking or major issues found**, with no findings.
They independently verified the exact five guard text changes, both two-field
plan deltas, all 219 current source pins and unchanged shared helper, normalized
comparison, strict refusal, ALL-row/ancestry, accounting, release and cleanup code.
This is source-readiness evidence only; nothing was executed.

Requested/selected model and effort: `gpt-6.1-sol` / `high`, no fallback or
descendants. Parent verified their saved desktop title as `Mushu`. The full
bounded review receipt remains under ignored `.claude` at
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq103-owner-identity-source-review-2026-11-06.json`,
4,376 bytes, SHA-256 `12a66d4bcaeb7f848553b46464e81cb12697f2d51bd0305c422510ee30976a26`.
It binds the reviewed 6,595-byte diagnosis note before this review-reference
append, plus the exact guard, plans, README and corroborating private report.
Only this concise review conclusion and identity binding are published; raw
coordinator/reviewer reports remain ignored. No runtime or syntax-test grant is
issued, and no prior scoped result or failure is rewritten.

## Later fixture packet review

The subsequently authorized isolated fixture packet was authored and separately
reviewed, but its outer supervisor failed the exact source-readiness gate with
six MAJOR lifecycle/resource findings. No fixture or admission ran; the conditional
one-time grant remains unused. The [packet review and concrete revision proposal](eligibility-owner-identity-fixture-review-2026-11-06.md)
bind the unchanged source, private input/review identities, actual high-effort
reviewer provenance and remaining execution obligations. The source-repair PASS
above remains source-only and does not validate that rejected supervisor.
