# Source-backed configuration batches

7 November 2026. This records the selected engineering continuation under
`f58-63-delivery-2026-11-06.md`. It does not record a new source run or spent
allocation. Source access and retention remain the existing collaborator decision.

The next milestone is an actual source row in persisted collector `accepted`, then
the existing F60 enrichment and F54 publication ports. The pure binder's earlier
`records:[row]`, `accepted:[]` proof is not that milestone. Configuration admission
requires a complete actual solver selection; optional source facts, accessory
quantity and physical/VIN fields can remain explicitly unknown. F58/F61's original
profile, year, plant and five-WMI acceptance gaps remain open.

The actual dated T5MJ options report contains 15 paint, 8 fabric and 6 rim
definitions. Their product is 720 possible requests, before solver refusal,
ignored inputs, changed selections or duplicate resolved builds. It proves no
accepted capacity. Definition presence does not establish availability.

Extend the existing public-source and collector seams with an explicit versioned
model/context/candidate registration. Retain the existing v1 contract. A model
registration must pin the source's full model records and aliases, raw range versus
catalogue range, separate order/effect/query dates and dated option definitions.
Generalisation must not invent trim, production dates, accessory quantities or
VIN eligibility to satisfy the older v1 shape.

Use deterministic, diversified candidate requests drawn from actual paint, fabric
and rim definitions. Preserve S0337 as the selected mandatory request input, not a
source-confirmed independent trim fact. Only a successful, strictly decoded actual
solver response establishes a complete selection. Compare request and returned
codes, retain provider changes truthfully, and deduplicate the exact complete
factory selection through the canonical PolicyService configuration key. Accessory
codes and unknown quantities remain separate. Neither different dates nor another
VIN make a new configuration.

The first allocation is bounded as follows:

| Limit | Selected value |
| --- | --- |
| Candidate solver requests | 32 |
| Total GET attempts | 36: page 1, settings 1, tree 1, options 1, solver 32 |
| Concurrent source requests | 1 |
| Retries | 0 |
| Complete-request timeout | 10 seconds |
| Persisted wall deadline | 120 seconds |
| Decoded response limit | 1 MiB each, 8 MiB aggregate |
| Checkpoint limit | 8 MiB, reviewed against actual retained row/cache sizes |
| Images, browser, source writes | 0 |

The measured page/settings/tree/options bodies total 916,858 bytes. At the measured
4,064-byte known solver body, 32 additional solver bodies would bring the estimate
to 1,046,906 bytes, about 1 MiB. Actual bytes and timing govern; this is an estimate,
not a capacity promise or substitute for the limits.

Persist the exact plan, run identity and one-shot allocation before requests.
Checkpoint each outcome. Preserve the allocation's spent marker even after early
failure, and never reset or replay it. Stop on HTTP/auth refusal, redirect,
unexpected shape, substitution, timeout or budget exhaustion. Keep transient
bootstrap header values private and discard raw settings/bodies. Reuse qualified
tree/definition evidence within the selected allocation rather than bootstrapping
per row. Retain actual attempted, rejected, duplicate and newly accepted counts
separately, with canonical identity overlap against earlier batches.

Review the 32 outcomes and actual source rate/resource measurements before the next
allocation. The proposed next increment is at most 200 solver requests plus the
four bootstrap/model/definition requests, 16 MiB aggregate and a 300-second wall
deadline. That increment is not executed by this document. Keep per-batch state
within the common session's 16 MiB maximum; a single growing 10,000-row checkpoint
is not implied. Compose validated batch artifacts with a global canonical-key
deduplication step, preserving each row's source evidence.

Progress towards 10,000 also needs additional actual UK model contexts and/or
solver-proved option variations. Qualify each new context against the scheme's 31
eligibility targets and record exclusions or historical-era gaps. The failed F44
probe is not evidence of global absence. Do not label US/LHD references as GB
qualification. Report actual model/configuration coverage and the remaining
shortfall after every batch.

The F61 lead owns numerical live execution after the F59 source capability is
integrated. F59 owns this adapter/collector capability. F60 consumes the stable v2
envelope and source registration through the existing session/adapter ports.
Large expected outputs and all archives go directly to the authorised OneDrive
project output area; keep run-owned local scratch bounded and verify teardown.

## Implemented handoff

The existing collector now recognises `f59-batch-20261107.v1`. Its
`modelRegistration` is explicit data: full alias keys, VG/AG codes, raw and
catalogue range, GB/RL, and separate catalogue/order/effect dates. The shared
executor retains the exact finite candidate request list in its checkpoint
identity and permits only URLs derived from that registration. A later reviewed
model context uses this same interface; its full source aliases and all returned
literals must agree before candidate execution. Request inputs establish no
physical/VIN facts.

The committed first plan is
`plans/bmw-source-batch32-2026-11-07.json`, canonical plan digest
`758ec81958cb3471b55c24e2afed45cdafc3a0125b1c3f9228e13a9d6fbff6a2`.
The existing `buildCandidateQueue` enumerator selects 32 deterministic requests
covering all 15 paint, 8 fabric and 6 rim definitions in the retained dated report.
S0337 and S043L are request inputs. Fresh typed definitions must corroborate every
input before the first solver request. This plan has not been executed and is
neither an allocation receipt nor evidence of 32 distinct accepted configurations.

`createFleetCollector` takes the explicit `live` mode, matching source/HTTP
allocation and `batchBinding: {producerPins, snapshotVersion,
existingConfigurationIds}`. The prior canonical ID index must include previously
admitted configurations, including the original T5MJ row. The caller persists and
consumes its one-shot allocation marker before constructing/running the collector;
the common session pins that allocation and accounts all source attempts, bytes,
deadlines and per-operation budgets. No default invocation installs transport.

The collector returns its original common `session`, `run`, and additive
`catalogueRegistrations` array. Successful complete source selections enter
persisted `accepted` with `admission:true`; the retained `records` preserve the
pure binder's `admission:false` result. Fixture transport can populate only
`records`. Different requests that resolve to an existing canonical factory
selection count as duplicates, with provider changes and prior-batch overlap
retained. Actual attempts, processed outcomes, rejected candidates, duplicates
and newly accepted rows are reported separately. Paint and upholstery use fresh
typed definition evidence; unsupported quantities and physical fields stay
unknown.

Pass the returned registrations to the existing catalogue adapter and use each
accepted row's two-key `catalogueRequest` with its versioned lookup options. Later
enrichment stages can use the same `session`. The source runner exports the safe
`batchEvidence` and per-candidate `sourceCaptures` from that session alongside
accepted rows and the exact producer/plan/allocation pins. Completed checkpoints
requalify rows from retained source artifacts and resume without requests.
Interrupted batches stop rather than replay a spent settings request to recover
ephemeral headers. The explicit continuation API below consumes a separate finite
allocation; restarting the original checkpoint grants no fresh allowance.

Scoped validation is 8 batch tests plus 94 affected capture/binder/ingress/common
collector tests, all passing with zero skipped tests. The new behavior was first
observed failing against the old single-selection guard. Additional red/green
regressions cover explicit provider removals with an absent ignored map, and
escaped bootstrap-header text in another profile's safe projection. These are
scripted protocol fixtures, not actual source traffic or capacity evidence.
Detailed identities and teardown receipts are in
`evidence/fucq59/source-batch-capability-2026-11-07/validation.json`.

## Explicit interrupted-batch continuation

Keep the original plan, policy, source version, producer pins, snapshot version and
prior canonical index unchanged. Pass a new absolute `statePath`, fresh
`http.allocation.id`, and
`continuation: {checkpointPath, checkpointSha256, limits}` to the existing
`createFleetCollector`. The hash is SHA-256 of the predecessor's exact file bytes;
the predecessor is read under its normal writer lock and revalidated through the
existing session and source binder. It must contain complete retained tree/options
bootstrap evidence. Inherited records, admissions, captures, caches, spending and
configuration IDs remain intact; the predecessor file and original once marker
are never rewritten. Completed original checkpoints retain their zero-request
restart path.

Continuation permits only an unhalted interrupted process (`halted:null`),
`source-batch-interrupted`, `request-budget`, `source-attempt-budget`,
`source-byte-budget`, `response-byte-budget`, `deadline` or `operation-timeout`.
Every other durable halt is refused before creating a continuation allocation
marker or issuing HTTP. In particular, HTTP 401/403/429, redirect/endpoint refusal,
substitution, malformed source shape, sensitive projection and generic source
failure remain stopped. A fresh allowance is not authority to bypass these stops.

The caller explicitly budgets four fresh page/settings/tree/options GETs plus the
remaining unspent solver requests, finite combined attempts/bytes, response size,
timeout and new lifetime deadline, all within the original plan's ceilings. Live
projector capabilities and ephemeral headers cannot be reconstructed from cached
safe projections. Fresh tree/options reports and raw response hashes must match
the retained context before any new solver request. A source change stops the new
allocation without silently mixing contexts. The original qualification-day pin
still applies. This prerequisite means cross-allocation bootstrap cache reuse is
not established; it must not be described as full satisfaction of F59 AC4.

A chain-scoped exclusive allocation marker binds the new allocation to its exact
predecessor and destination. It refuses another destination, reused predecessor
allocation IDs, or a consumed allocation whose destination was lost. Preserve
these markers with the checkpoints. Another interruption requires another
explicit allocation and checkpoint; the chain supports at most 32 continuations.
The original checkpoint must remain frozen while its continuation is in use.
Known Medium defect FUCQ-152: different fresh allocation IDs can currently fork
from the same predecessor and repeat its pending work. The marker prevents reuse
of one allocation ID; it does not reserve a single successor per predecessor.
Root owns this separately linked FUCQ-59 backlog Bug; it is not repaired or made a
merge dependency here. Operationally keep one chosen successor chain and do not
start parallel continuations from the same predecessor.

Retained valid solver responses are strictly requalified and reused, including
expired transport-cache entries used as immutable evidence. A solver request
already started without a retained response is recorded as
`source-request-spent`, advances the queue and grants no admission; it is never
reissued. Prior accepted rows retain their exact identities. `counts` are
cumulative; `allocationCounts.prior` and `.fresh` expose the two contributions,
and `continuation.recoveredSolverResponses` identifies recovered evidence. A
shortfall remains incomplete.

The [continuation validation receipt](evidence/fucq59/batch-continuation-2026-11-07/validation.json)
records scripted offline protocol checks, unchanged producer module hashes,
selected session boundaries and scratch cleanup. It does not establish actual
LIVE interruption/continuation, global coverage or the full target.
