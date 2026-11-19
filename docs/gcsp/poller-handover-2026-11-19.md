# Russell's dev poller: handover, 19 Nov 2026 ~18:00 UTC

## Goal
Close Russell's lane's 26 merged GCSP stories in the dev inbox (step C in the dev-inbox `code-poller.md`), so none stays as an open claim.

## Where things stand
- All 26 files in `_dev/in-progress/` (DEV-2026-11-13-003 … -048, DEV-2026-11-16-026, -049) are merged into `gcsp-poc-dev`, and every branch is an ancestor of the base. No merge commit names DEV-2026-11-13-003 (FUCQ-435) or -037 (FUCQ-469), but both branches are already ancestors of the base.
- Jira: all 26 are In Review. FUCQ-476 moved there on 19 Nov (merged 7ab1f9b47, rendered AC1 from Gary's FUCQ-531 proof c531a2, `docs/gcsp/evidence/fucq531/README.md`). FUCQ-529 is Done as a duplicate. FUCQ-483 is Done as superseded.
- Gary's poller agreed every point on dev_mail MSG-2026-11-19-russmain-001 (closed). His lane holds no claims. Neither lane knows of any other story "still with us".

## What's left: step C for each of the 26
1. Give every "not done" line an owner, and write its key into the line. Agreed owners:
   - hosted Render dev → **FUCQ-533** (gcsp-buddy / gcsp-buddy-dev Blueprints; Gary is creating the services now);
   - hosted sign-in → **FUCQ-532** (demo sign-in issuer); lapsed refresh re-sign-in → **FUCQ-534**;
   - real registered test OIDC provider, real email delivery to an agreed recipient, live BMW providers: no owner on either side. Each is an original shared-contract item, so file **one follow-up per shared cause** (three in all), each naming the stories it covers, not one per story. Live BMW catalogue already has Epic FUCQ-17;
   - in-codebase gaps (for example 462 generated stock not ported, 466 `ready`/`no-match`, 463 the ManualSelectionPort binding, 468 converters, 479 handler slots, 480 route replay → FUCQ-507): name an existing open story or Bug, or file a follow-up in the item's own words;
   - "covering batch run": not an owner line. The batch run is step E, and **both Russell (18 Nov) and Gary (19 Nov 17:56) said not now**. Don't run it unless Russell asks.
2. Take each story file from its branch, write it to `_dev/done/2026-11/<id>.md` with `closed: 2026-11-19 merged <sha>`, `cleanup: pending` and `cleanup_client:`, and remove the `in-progress/` copy. Commit both paths by name and push.
3. Run `scaffold_git.py drop-branch --id <id>`, then set `cleanup: complete`, commit and push. The worktrees hold only tracked `.claude/test-runs/impact/` files, so no evidence is lost.
4. Partial stories stay as they are in Jira (In Review). Leave the status alone.

## Notes
- `export SCAFFOLD_POLLER=russmain SCAFFOLDING_HARNESS=claude-code`; poller lease `usget-russmain` runs until 2026-11-20T05:43Z.
- dev_mail 1.13: a chat body is limited to 400 characters (`max_counter_question_chars`). Longer material goes in a thread, and a question needs `--reply-format`.
- Gary's note: Node 26 fails 25 apps/gcsp-web specs, which pass on Node 24.22.3. Pin Node 24 for the web suite.
- Constraints: never touch any OneDrive path; don't edit Gary's `render.gcsp.yaml`, the greg-planning page files, or `blocks/gcsp` / `COMPONENTS.md` / `ui-ratchet.json`; send no real email; no force-push.
