# Migration dev-poller kickoff prompt

Prepared for Gary on 13 November 2026. The migration priorities are in the published descriptions, but Jira's default priority does not encode their technical execution order. At authoring, `.claude/scaffolding.json` still names `gcsp-poc` as the poller integration base. The prompt below supplies the migration scope, required branch setup and conditional parallelism. Saving it does not start a dispatcher, claim Stories, change configuration or authorize an existing session to begin implementation.

Copy the following prompt into the new development session:

```text
Start the dev poller for the GCSP migration in:
/Users/garycarter/Code/GitHub/vehicle-matcher

Scope and authority
Implement the 49 child Stories of FUCQ-431, FUCQ-432 and FUCQ-433 (published as FUCQ-434–482). Fetch their current native descriptions, status and ownership before pickup; do not assume the publication snapshot is current readiness. This is fresh direction for this migration run, including use of story-leads and implementers under the installed dev-inbox workflow. Reconcile historical dispatcher/stand-down notices with current activity. Respect other collaborators' live claims; do not take over their work or resume unrelated retained Stories. Jira's project-wide write pause was explicitly lifted by Gary on 13 November 2026. Story-specific holds and source/access limits remain binding.

Read first
- AGENTS.md and the configured dev-inbox skill/procedure, including its harness adapter, claims, capacity, test-resource and merge rules.
- docs/gcsp/README.md
- docs/gcsp/demo-brief.md
- docs/gcsp/build-rules.md
- docs/gcsp/experience-quality.md and COMPONENTS.md
- docs/gcsp/technical-readiness-2026-11-05.md
- docs/gcsp/angular-java-migration-publication-2026-11-13.md (actual Jira/source-ID mapping)
- docs/gcsp/angular-java-story-refinement-2026-11-13.md (confirmed decisions and technical edges)
- docs/gcsp/angular-java-migration-stories-2026-11-13.md and angular-api-adapter-epic-proposals-2026-11-13.md in the same directory
- docs/gcsp/database-refactor-migration-alignment-2026-11-13.md

Integration branch — establish this before claiming or launching workers
All migration work, claims/checkpoints and automatic Story merges must use gcsp-poc-dev. The shared helper currently defaults to gcsp-poc through .claude/scaffolding.json. Configure and verify the migration checkout's actual helper integration base as gcsp-poc-dev before any operation that could write to the old base. This prompt authorizes the necessary branch-specific setup. Do not rely on merely being checked out on gcsp-poc-dev: inspect what claim/worktree/merge/push helpers will actually target. Keep every worker branch and worktree rooted in the dev integration branch, respecting current live work and ownership.

Commit and push coherent validated increments to gcsp-poc-dev throughout. Never merge or push migration changes into gcsp-poc, main or the running deployment. Gary performs the final merge into gcsp-poc after hosted-dev review. Treat the migration helper-base configuration as dev-only and account for it in the final handover so it is not accidentally retained as the final production workflow default. Preserve Used Cars and other supported shared consumers.

First Story and foundation order
1. Pick up FUCQ-434 first: record the actual kickoff SHA and implemented capability/route/job/visual baseline. Agree the replacement API, error, identity/role, provider and persistence responsibilities and named ownership of shared files. Record BMW standards still to be supplied without inventing compliance. This is engineering work; no interim human review gate is required.
2. Once the relevant contracts exist, progress FUCQ-439 (Angular shell) and FUCQ-454 (Java artifact) as separate workstreams where their files do not overlap. A shell or endpoint fixture can support implementation but cannot satisfy real sign-in/journey acceptance.
3. Progress FUCQ-455 (OIDC/JWT) with those foundations and integrate actual Angular browser login against the Java API. FUCQ-435/436/437 supply cross-origin transport, static deployment/runtime configuration and routing as their real Angular/Java interfaces become available. Assign a single owner for shared blueprint, build, public-config and API-contract files; do not launch every foundation Story simultaneously.
4. Settle FUCQ-456's PostgreSQL design early, then implement it when the Java build/repository contracts exist. It can progress alongside Angular work with separate files. Preserve atomic receipts, versions, exclusive authority, recovery and reset isolation. Prove native PostgreSQL behaviour before accepting transactional journeys.

Parallelism rules
Use actual interface readiness, file ownership, leases and available machine capacity, rather than Jira priority/key order or depends_on links alone. Declare each worker's scope/files and the shared interfaces before parallel pickup. Keep shared-file changes, integration merges and full-suite runs serialized under the installed workflow; perform its capacity/tier checks before every spawn. If a contract or common build/composition/schema file is still changing, establish it under one owner before dependent workers proceed. Carry current project policies and acceptance/visual references into every delegated brief.

After the foundation, independent Angular views and Java services may proceed in parallel against agreed contracts. Split work by distinct owned files/capabilities. If two Stories need the same files, serialize them. Completed backend work must retain its contract evidence and the outstanding Angular integration checks; component doubles never establish final integrated acceptance. Confirm concrete pickup scope and size before claiming oversized Stories; keep their original acceptance fixed and reconcile any necessary split through the authorized workflow.

First connected journey
Prioritize sign-in/account, then Buddy matching → actual test email → signed-in employee-owned offer acceptance → order/status, using local service substitutes first. Relevant Stories include Angular FUCQ-440/441/444/445 and applicable FUCQ-446 status work; Java FUCQ-457–462, FUCQ-464–466, FUCQ-468/469 and the required clock/scenario portions of FUCQ-479. This is a journey map, not a claim that every listed Story is immediately ready or can be closed after partial delivery. Preserve each Story's full acceptance, including remote cases where specified. Sequence the real dependencies from the agreed contracts; do not finish all frontend work before starting Java or vice versa.

Then cover the remaining manual, lifecycle, Greg/planning, presenter and comparison capabilities through their Angular/Java layers. Progress provider inventory/composition design early; complete FUCQ-467's missing remote offer acceptance/decline protocol and FUCQ-481's full provider-substitution proof before final migration acceptance. Later retirement/release Stories FUCQ-438/453/482 follow the required parity and integration evidence. Do not remove still-needed runtime paths early or claim Gary's final switch has already happened.

Database alignment
Read FUCQ-408 and relevant FUCQ-409–425 descriptions for overlap, particularly database Stories FUCQ-419–425. Use their objectives and cases in the Java design and affected journey implementations. Do not pick up the entire Node refactor first, duplicate optional tuning or treat Java implementation as acceptance of Node-specific Stories. Keep those original contracts and live claims intact. Optional performance work remains independently prioritized; only concrete correctness/capacity needs enter the migration's delivery path through the agreed scope process.

Fixed migration decisions and completion
Use Angular 21, Java 21 and Quarkus 3.x. Angular owns the frontend; business data/actions cross the API and external services sit behind selected backend adapters. Preserve the implemented visual/capability baseline and the explicit OIDC/presenter changes. Employees and Greg act through their own logins; presenter has controls and permitted read-only inspection, with no impersonation. Use real test OIDC, bearer access JWTs, correct roles/ownership and real test email under the agreed test-recipient arrangement. Complete local-first and remote transactional evidence; unavailable live BMW integration remains a declared later activation gap.

Use one repository/Render blueprint with independent frontend/API artifacts and deployment-supplied public frontend configuration. Gary creates the isolated dev environment with its own PostgreSQL database. Prepare and validate everything possible while external setup is outstanding; surface the precise missing setup and continue independent work. Minimize cost and present measured options; this prompt does not authorize an unselected paid tier, new paid service or production data access. Incorporate BMW standards when supplied; record what remains unverified.

Continue the complete scoped migration without interim human checkpoints or requests to approve routine engineering choices. Keep automated checks, rendered desktop/narrow/browser/accessibility inspection, independent review, native transaction tests and coherent commits. Record actual failures, skips, unavailable integrations and defects honestly. In Review means developed for review; do not infer collaborator acceptance or mark Done merely because an increment merged. Gary reviews the full hosted-dev build at the end and performs the final merge. Handover must distinguish implemented/validated work from unavailable environment checks and Gary's unrun final switch. Do not claim completion from builds, fixtures or source inspection alone.
```

This prompt is a proposed kickoff instruction for Gary to invoke in the new session. The [publication record](angular-java-migration-publication-2026-11-13.md) remains the verified source-ID map; the [database alignment](database-refactor-migration-alignment-2026-11-13.md) retains the existing Story boundaries and priority call.
