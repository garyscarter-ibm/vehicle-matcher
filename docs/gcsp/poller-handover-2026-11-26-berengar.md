# Poller hand-over: berengar, 26 November 2026, 10:57 UTC

Gary's Claude dev poller, registered as `garyscarter-ibm-berengar` (released at hand-over). Retiring at about 300k
tokens. Russell's pollers `usget-velko` and `usget-baymax` are live.

## Goal
Run the dev poller per the `scaffolding:dev-inbox` skill: the generic `references/code-poller.md`, plus step E from
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`. Read `AGENTS.md`
first (OneDrive ban, Story test set, Shared local test stack). Shared checkout stays on `gcsp-poc-dev`.

## Done this session
- The aurelio hand-over's due web-e2e batch had already been run: velko's 03:26 UTC line (base 7ab69ffda), all 18
  families green incl. f520, covers e919a2784 (F520) and F513/F515/F516. java (05:05, 08:07) and web (05:39) lines
  cover them too. Those four Bugs have their covering lines and await acceptance only.
- **FUCQ-546 (DEV-2026-11-22-vesper-021), 8 points: built, merged at 73b493c42, closed with `cleanup: complete`,
  Jira In Review with evidence comment 5069300.** AC1: submissions carry optional `changes`, stored in new column
  `production_submissions.constraint_changes` (Flyway **V546_1**) and returned as `replan.changes`. AC2: @Order(9)
  supply-side fault test. Poller reran the story set on the base-merged tree: 419/0 (needed `--heap 2g`; 1g OOMed).
  For Gary: is the optional `changes` field on POST /greg/production/requests the intended contract? Angular
  doesn't send it yet (not this story's scope).
- Mail: acked velko-001/002/003/005. Coordinated F559 file overlap with velko (GC-berengar-002/003/004): F546
  merged first; F559 refreshes onto it (overlap ProductionService, ProductionStore).
- Learning DL-20261126-BERENGAR-01 (hand-over's due batch already run; this Mac can't dispatch CI).

## Left to do
- **java batch is due now** (V546_1 is a migration, a named full-suite reason; FUCQ-546 acceptance waits on it).
  Claim it before any other full suite: `python3 -B _tools/scaffold_git.py --poller <name> batch claim --suite java
  --base <sha> --ttl 14400`, run through a batch-tester under `heavy`. Check `_dev/batches.md` and `batch status`
  first; velko may take it in CI (Russell's `f555-java-ci.yml`).
- **web-e2e** has 8+ uncovered merges. Velko's CI run 45794511779 (base 68eacb337) failed on f340 1/1 with 17
  unrun; velko held the lease and was investigating. Check its line before claiming. Locally it needs 3.5 GiB, so
  after 00:00 GMT only, under `heavy`, never alongside java.
- node: 4 uncovered merges (below 5) + 73b493c42 if it matches; web: 1. Re-count after the java batch.
- Queue: nothing else claimable at hand-over. FUCQ-522/524 and FUCQ-334/335/337/339/336/338 are `design_impact: yes`
  with no recorded design agreement (B2). Most GC Stories from Jira fail check-story (missing description sections);
  queued ui Bugs lack a `ui:` line. vesper-011/012/013/015 need external access or collaborator agreement first.
- Jira attachment-field pull: don't retry until its inputs change.
- **This Mac's `gh` has no github.com auth** (expired github.ibm.com token only): workflow dispatch returns 401.

## Gotchas
- `scaffold_git.py refresh` aborts on `.product-map/work.json` append conflicts. Resolve in the story worktree:
  `git merge --no-commit gcsp-poc-dev`, take base's JSON and append the story's `stories[]` entry, then commit.
- `java-test` with a wide `-Dtest` set needs `--heap 2g`.
- Implementer hand-backs can arrive at the dispatcher, not the story-lead: relay them with SendMessage.
- `dev_mail.py open --story <id>` refuses a closed story; use `--story none`.
- Close records need `cleanup_client: 516ca3553159` (this clone).
