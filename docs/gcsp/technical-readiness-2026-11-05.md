# Technical readiness for story pickup

Gary Carter directed on 5 November 2026 that the dispatcher assess actual technical blockers rather than use Jira
`depends_on` links as automatic pickup gates. The links may express functional journey order. This instruction
supersedes the dev-inbox procedure's dependency-only admission rule for this project.

For each candidate, inspect its acceptance criteria, the current implementation, agreed interfaces and active file
ownership. Record the API, event, data shape or shared component that makes independent implementation possible,
the files it can own, and any missing technical edge. A concrete missing interface, unresolved incompatible contract,
or conflicting writer can still block that scope. Another ticket's unfinished status alone does not.

Keep implementation readiness distinct from completion readiness. Build independent capability against an agreed
interface and validate it meaningfully. Retain any unexercised producer, live-service or end-to-end acceptance as
outstanding; synthetic fixtures and mock success do not satisfy those checks. Do not mark a ticket built until its
acceptance is met.

Explicit pauses and date holds, source/access permissions, existing claims and leases, safe resource ownership,
and serial full-suite and merge coordination remain in force. FUCQ-27/28 and FUCQ-61 retain their agreed post-demo
timing. Do not take another collaborator's active claim through this readiness change.

Keep the Jira links as context. This instruction changes execution admission; it does not request Jira relationship
edits or add backlog scope. Record the assessment in each claimed story's `decided`/Result and in the dispatcher's
current-run state. Pass the rule and relevant interface evidence to every story chat and descendant.

## First code-based assessment

Read-only review on 5 November, after FUCQ-83 integration. These are implementation assessments, not completion claims.

| Ticket | Existing executable boundary | Independent work and remaining integration |
|---|---|---|
| FUCQ-126 / DEV-096 | Clock, scenario and identity HTTP services; separate presenter capability while acting as another principal | Build presenter controls and a server-owned configuration projection. Real release counts and complete scenario resets still require their producers. |
| FUCQ-100 / DEV-060 | Repository transactions, conditional claims, holds/offers/outbox schema, notification consumer, BriefService and DemoClock | Build the atomic buddy hold/offer operation and publish its allocation-candidate input contract. Validate actual allocator invocation and manual/buddy exclusivity when integrated. |
| FUCQ-69 / DEV-068 | ManualContextService.browseStock and GET /api/gcsp/manual/stock already return exact decisions, terms and revisions | Build the visual browser and details. Preserve claimInput from FUCQ-66; real release metadata and browse-to-claim proof remain. |
| FUCQ-122 / DEV-084 | Existing help/case/update routes and Greg dashboard caseQueue region | Build employee help/case and Greg queue modules; add a server-owned feasible-remedy projection. Activity/order-progress placement and lifecycle-trigger trials remain. |
| FUCQ-103 / DEV-066 | Merged PolicyService publishing and Greg dashboard publish region | Build preview/publish and explicit policy activation/context refresh. Existing contexts pin run.policyVersion; appending a policy alone does not update subsequent ordinary previews. Preserve held quote pins. |
| FUCQ-113 / DEV-088 | Repository/Greg observed vocabulary and deterministic comparison generator conventions | Build learning-record capture/schema/generation independently. Historical exposure stays unknown without captured evidence; the actual corpus and outcome-producer proof remain. |

DEV suffixes in this table mean `DEV-2026-11-04-<suffix>`. The current physical `jira:` field is authoritative; old
descriptions may retain previous numbering. Recheck actual source before dispatch, since other work can change it.

The review also identified a compatibility edge for FUCQ-70: review contact edits currently increment draftVersion,
while FUCQ-66 revalidates the quote's draftVersion. Verify and agree the review-save/readback protocol with that
story's active worker before modifying its files. This observation is not a reproduced production-defect verdict.

Coordinate central server route registration and Greg host composition as short serial integration steps. Independent
feature modules and tests can proceed in their own working copies. Shared component catalogue/gallery/ratchet changes
must be additive and retain all other stories' entries; no branch may overwrite another capability at integration.

Reviewer requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants. No tests, services, native database calls
or browsers were allocated during this assessment.
