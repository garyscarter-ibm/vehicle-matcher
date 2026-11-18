# Russell's dev poller hand-over, 17 Nov 2026 (FUCQ-433 reopen run)

## Goal
Russell's request: "Fix the in-progress stories which were re-opened due to not being completed properly. But complete them
properly this time." Scope: every reopened story under Epic FUCQ-433 that is still open, plus FUCQ-435. The bar is each
story's original ACs, met by the started app (real beans, RS256 JWTs against the loopback JWKS, native PostgreSQL, no test
alternatives). Where an item is external (hosted dev, a real OIDC provider, real email, BMW), the story is reported `partial`.

## Done (merged to gcsp-poc-dev, Jira In Review)
- Built: 460, 462, 464, 466, 468, 471, 472, 473, 474, 475, 479, 480, 507.
- Partial, external gaps only: 435, 454, 455, 456 (hosted dev); 458 (hosted dev); 463 (real stock system, hosted dev);
  469 (real email to an agreed recipient, hosted dev); 465 (real OIDC, real email, hosted dev; 02355accf);
  467 (real BMW remote, hosted dev, real OIDC, real email; 96dc7361b, test-only proofs).
- Bugs fixed: FUCQ-516 (in 464), FUCQ-506 (in 479), FUCQ-510 (in 466), FUCQ-518 and FUCQ-519 (4290a3bdc).
- Each Jira story has a merge comment with its AC evidence, the scoped test counts and any hosted settings needed.

## Not done
- FUCQ-478: merged partial, In Progress. Its planner inputs, `PlanningDemand` and `PlanningSupply` (FUCQ-477), are unbound.
- FUCQ-477 and FUCQ-476: not started. Waiting on Gary's answer (FUCQ-477 comment 3629825; learnings 9f6be11e2) on whether
  his lane binds the planning ports and whether Russell's lane may build 476 first.
- The ONE full verify on gcsp-poc-dev: not run (Russell, 18 Nov: finish the in-flight stories, then stop). Run it next, in a fresh detached worktree, under
  `/tmp/vm-poller-java-verify.lock`. Any In Review story it breaks goes back to In Progress, with the failure in a comment.
  - Known failures on base: PresenterFaultsJourneyHttpTest, ManualDraftHttpTest and ManualStockHttpTest.
  - FUCQ-517: about 21 profiles need a database called `gcsp_test_dev`.
  - ComparisonJobFullSizeTest is env-gated (`GCSP_COMPARISON_E2E_OUT`): leave it unset.

## Hosted dev (Gary owns `render.gcsp.yaml`)
Every setting is proposed in `services/gcsp-api/render-service.proposed.yaml`. Gary was told on FUCQ-481 (comments 3629763,
3629788, 3629832, 3629853, 3629856) and in `docs/gcsp/dispatcher-learnings.md`. The key ones:
- `GCSP_ACCOUNT_PROVIDER=repository`, `GCSP_SCENARIO_PROVIDER=demo`, `GCSP_ALLOCATION_CANDIDATES_PROVIDER=recommendation`;
- `GCSP_SUPPLY_PROVIDER=demo`;
- ordering, approvals, documents, appointments and returns providers all `synthetic`;
- `GCSP_POLICY_VERSION=gcsp-policy-v1+offer-journey-v1`;
- optional `GCSP_REQUIRED_PROVIDERS`;
- never `GCSP_RESET_ALLOWED=true` on gcsp-poc;
- about 4 GB for comparison jobs.

Still external: register the OIDC test provider (`docs/gcsp/oidc-test-provider-2026-11-13.md`) and agree the Brevo test
sender and recipient.

## Decisions made today
- Russell, 12:00: no full verify per story. Each story runs a scoped set; one full verify runs once all are merged.
- Russell, 19:00: once merged, a story goes to In Review when its ACs are met locally or only external items remain. The
  full verify is no longer a gate. A failure sends the story back.
- After the 17:50 memory crash: honour `can_start`, including for lane replacements. At most about 3 story-leads, each with
  one implementer, and one Java JVM at a time under the lock.
- Bug branches: `scaffold_git merge` only takes `dev/*` branches. Merge `bug/*` branches from a temporary detached
  worktree with `git merge --no-ff`.

## Read first
`.claude/poller/state-2026-11-17.md` (the full log), `.claude/poller/brief-2026-11-17.md` (the story-lead brief),
`.claude/poller/lanes-2026-11-17.md`, `docs/gcsp/dispatcher-learnings.md` (entries from 17 Nov).
