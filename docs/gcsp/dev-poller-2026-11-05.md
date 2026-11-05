# Dev poller — restart, 5 November 2026

## Run direction and ownership

A collaborator explicitly restarted the dev poller and said that GC has both Claude and Codex pollers working. This supersedes this dispatcher's overnight stop. The current local directive is `.claude/dev-poller-directive.md`; active chat `01a1ab98-a3fe-76b3-b57a-825aeb57af9d` owns the reused `vehicle-matcher-dev-poller` heartbeat. The old chat remains retired. Normal scaffolding capacity and design rules apply; the previous overnight-only overrides have expired.

Startup read the [overnight handover](../HANDOVER-2026-11-05.md), live project instructions, the installed dev-inbox procedure and current GCSP context. Codex's live gateway guard passed on IBM Global, `api.servicesessentials.ibm.com`. The vendored inbox tools match the current scaffolding source; no tool refresh was required.

## First pass

- Pulled `gcsp-poc` through the project git wrapper, then checked local story posting and the pen. No unposted stories; no protected paths require a pen. The shared checkout stayed on its branch.
- Reconciled remote leases, member identity, worktrees and the paused old dispatcher. GC owns the live launcher FUCQ-33 and dashboard FUCQ-101 claims. This dispatcher preserved both, and retained the four blocked `usget` claims/checkpoints described in the handover. No story worker was started or duplicated.
- Completed both Jira searches: 29 delta records plus two open-Bug records, 31 unique records; both searches were complete and attachments were present. The two Rejected Bugs were skipped. The wrapper imported and pushed updates to FUCQ-71, FUCQ-72 and FUCQ-104, and marked changed acceptance/out-of-scope context on GC's FUCQ-101 without replacing its claimed content.
- Notified FUCQ-101's active owner/lead through Jira comment `132424`, as the dev-inbox sync procedure requires. Preserve its current native description and claim.
- Mail was `NOTHING`. The refreshed queue had 67 waiting, seven ready and 60 held. FUCQ-67 fails the required intake check because its Jira-authored `ui:` component plan is absent from the imported header; no claim or manual inbox edit was made. FUCQ-95 and FUCQ-94 pass intake. Recheck live ownership, current descriptions/comments and shared kit/gallery overlap before dispatching either.
- Live capacity moved from three available places to one, then two while other sessions were active. No three-place story-lead reservation was available at pass end. The next heartbeat reconciles again; shared-file edits, merges and full suites remain serial where required. Existing source/access, PostgreSQL and 13 November deferral gates remain binding.
- Outbound sync also listed GC-owned lifecycle operations. They were left unexecuted and unacknowledged by this dispatcher under the team ownership rule; no teammate assignment, status, branch or lease was changed.

## Validation and resources

This checkpoint changes run documentation, not application code. Validation is limited to the live gateway/tool/heartbeat/ownership checks, successful complete Jira import, story intake checks and local documentation links. Application and full test suites are excluded because this checkpoint changes no application behavior.

The Jira import registered an absolute owned scratch root and external manifest/finalizer before allocation, used one HostBudget reservation and a bounded supervisor, and removed **396,636 logical bytes**. The dispatcher independently verified the exact scratch root, supervisor, importer process group and reservation absent. No large output, compatibility exception or scratch leftover was created. Retained receipt: `.claude/test-runs/ownership/dev-poller-jira-20261105T120741-dispatcher-verify.json`; the adjacent manifest retains the bounded summary.

## Scaffolding maintenance limitation

`tools/doctor` found the managed installation at 0.6.5 and requested the 0.6.6 update. The required `tools/install` attempt refused an existing symlink at `/Library/Application Support/ClaudeCode/.claude/skills/add-brand` and applied nothing. No shared brand installation was changed. The current source's dev-inbox skill/procedure match the installed ones, and its vendored-tool check reports `stale: false`, so the poller can follow the current workflow. The separate Claude gateway diagnostic failed on its default endpoint; this is not the live Codex endpoint, which passed.
