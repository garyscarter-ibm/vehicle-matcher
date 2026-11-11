# Employee notification email, 11 November 2026

Gary reported that mail was not being delivered from the hosted presenter and requested recipients
from employee records, choosing a separate delivery address rather than changing sign-in emails.
He also paused every Jira write project-wide until explicitly unpaused. The pause is committed in
AGENTS.md and CLAUDE.md; this record holds the decision and findings without Jira writes.

## Diagnosis

The live presenter outbox contained three failed configured-transport jobs (two Greg, one Paula),
each at attempt 1 with `mail-configuration-invalid` and no scheduled retry. This code is emitted
before a Brevo request. It establishes local configuration refusal, not a Brevo rejection or inbox
problem. The precise invalid setting is unverified: visible Chrome inspection was authorised but
the browser controls failed, and Render environment values were not obtained. No live sends were made.
Related implementation: FUCQ-98, based on the transport contract and source, not a new Jira claim.

## Approved change and trial

Each employee opens **Your Cars → Your details → Notification email**, enters an inbox and selects
**Save email**. Sign-in remains at the generated `@gcsp-demo.com` address. Greg also has the employee
role and can use Your Cars for his own setting. Leave addresses unset until a collaborator enters
real recipients. Clear and save to stop new live emails. Do not populate addresses from source code.

Reload Your Cars to confirm persistence; presenter reset preserves the address for matching
employee/principal identities. Each browser session can edit only its own record. Stale edits require
reload. Ambiguous network responses retry the same command. A provider attempt already underway
keeps its original recipient and UUID even if the employee setting changes.

`GCSP_MAIL_RECIPIENTS` is removed from configuration and ignored. Brevo transport, API key, sender
and public base remain backend settings. Existing failed jobs stay failed; this change does not
silently resend them. A fresh notification after entering an address and correcting any remaining
configuration is needed for deliberate live verification. Provider acceptance alone does not prove
inbox delivery.

## Scoped validation plan

Use one test worker and small synthetic fixtures through `_tools/test_stamp.py --targeted`.
Route/UI tests cover save/clear/replay, cross-employee and origin/session/role refusal, identity
privacy, restart/reset retention, changed-principal isolation, validation, lost-response retry,
stale/access-lapsed handling, teardown and preservation across account redraws. Transport tests
cover record recipients, no-address refusal, obsolete-env independence and pinned retry, plus
existing provider, capture, canonical link and restart/concurrency cases.

Boundary checks cover identity, reset, repository, account, outbox, runtime, blueprint and UI rules.
Desktop/narrow browser inspection checks the actual account section and keyboard save/clear.
Retail matching, training and live PostgreSQL/provider acceptance are outside this scoped change.
No new shared component or runtime dependency: compose the existing labelledField and button kit.

No live address is included in test evidence. The original FUCQ-98 live-send acceptance remains
unverified by these tests.

## Rendered review and existing guard failure

Headless local Chrome at 1440 and 390 px passed keyboard save, invalid-email focus, clear and
horizontal-overflow checks. The actual account composition used the shared shell, tokens,
labelledField and button controls; synthetic adapter data was used instead of a live provider.
Agent inspection confirmed readable labels, wrapping, visible keyboard focus and aligned controls.
Retained captures: [desktop](evidence/employee-delivery-email-2026-11-11/desktop.png),
[narrow](evidence/employee-delivery-email-2026-11-11/narrow.png), and
[checks](evidence/employee-delivery-email-2026-11-11/visual-checks.json).

The initial wider run reported 372/374 passing. Its account-request expectation omitted the new
notification-email GET and has been corrected. Its other failure predates this work at baseline
08916a83: `blocks/gcsp/presenter-controls/presenter-console.css` has 44 counted lines against a 39-line
ratchet cap. This file and cap are untouched. Severity Low: stylesheet guard drift, with no observed
functional delivery impact. Separate backlog reconciliation is pending the explicit Jira unpause;
it is not represented as fixed or used to broaden this change.

## Final scoped results

- Final settings/transport/blueprint run: **69 passed, 0 failed**, including concurrent clear during
  an in-flight send, legacy unconfirmed attempts, separate Greg/Paula destinations and reset privacy.
  Local targeted evidence: `.claude/test-runs/targeted-c4ee1b70a87bdc9ccb728be73784c1b0fc703fc4e09bf9865beee01278b69092-default-1794436983408172000.json`.
- Account/outbox/repository/runtime/login/blueprint boundary run: **259 passed, 0 failed, 5 skipped**.
  Skips: two live PostgreSQL checks with no `GCSP_DATABASE_URL`; three existing F71 process-read proofs
  unsupported by those test fixtures. Log: `.claude/test-runs/logs/20261111-223841-hckkreqg`.
  This run completed successfully while the final concurrency change was being made; it is retained
  boundary evidence, not an unchanged-tree stamp. Final concurrency behavior is covered by the 69-test run.
- Final mail/settings/blueprint/painted-copy/UI run: **238 passed, 1 failed**. Only the pre-existing
  presenter stylesheet cap above failed; changed account styling and painted-copy checks passed.
  Log: `.claude/test-runs/logs/20261111-224153-wjsgopbm`. The requested test-name filter did not exclude
  that baseline check, so no filtered-ratchet pass is claimed.
- Desktop/narrow browser check: **1 passed**, with both viewports inspected. Browser/temporary
  scratch was supervisor-owned; all run-owned scratch roots were removed, including the roughly
  6.7 MiB browser working set. Captures retain roughly 107 KiB. No child process remains.

The selected scope excludes retail ranking, ML/training, the whole unrelated server suite and live
provider/inbox verification. The baseline was fast-forwarded to c5a20b12 (documentation changes only)
before final direct validation. No Jira changes or production employee-address writes were made.
