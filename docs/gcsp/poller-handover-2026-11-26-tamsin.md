# Poller hand-over: tamsin, 26 November 2026, 20:40 UTC

Gary's Claude dev poller, registered as `garyscarter-ibm-tamsin` (released at hand-over). Retiring at about 300k
tokens. Russell's poller `usget-velko` was stopped by Russell at 12:51Z (hand-over
`docs/gcsp/poller-handover-2026-11-26-velko.md`); no Russell poller was live at hand-over.

## Goal
Run the dev poller per the `scaffolding:dev-inbox` skill: the generic `references/code-poller.md`, plus step E from
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`. Read `AGENTS.md`
first (OneDrive ban, Story test set, Shared local test stack). Shared checkout stays on `gcsp-poc-dev`.

## Done this session
- **node batch** at 1b787c559: red, 4285/4181 pass/38 fail/66 skip. 37 are FUCQ-555's exact known set; the 38th,
  `gcsp-current-car-baseline-cache`, fails to load on Node v26.5.0 (`vm.SourceTextModule` needs
  `--experimental-vm-modules`; alone with the flag 5/5). No new failure identity. Line in `_dev/batches.md`.
- **java**: velko's CI line at bce44883b is green and covers 73b493c42 (FUCQ-546 + migration V546_1).
- Learning DL-20261126-TAMSIN-01 (node link misses `server/node_modules`; Node 26 VM flag).
- Agent-scaffolding updated to 0.17.0 on this Mac (policy applied, Desktop pinned). Russell refreshed the repo's kit
  tools; **keep `_tools/test_stack.py` as is**: run `inbox_setup.py update --except _tools/test_stack.py` until
  SCAF-77 to 81 land (the kit version breaks the e2e runner).
- **FUCQ-599** created (Story, parent FUCQ-432, C): skeleton loading on every Angular GCSP screen, as Node does.
  Not yet imported into `_dev/code-inbox/` (the Jira pull is skipped; see below).

## Left to do
- **web-e2e is due and unleased** (uncovered: bce44883b, 2ed7b5a64, 73b493c42; FUCQ-546 acceptance waits on it).
  Velko released the lease before dispatch. This Mac's `gh` has no github.com auth, so no CI dispatch. Run it
  locally **after 00:00 GMT only**, under `heavy` (3.5 GiB), never alongside another full suite: claim with
  `batch claim --suite web-e2e --base <sha> --ttl <2 x ttl x 60>`, through a batch-tester. Russell confirmed they
  won't swap `test_stack.py` tonight. In the batch worktree link both `node_modules` and `server/node_modules`.
- Queue: nothing claimable at hand-over. FUCQ-522/524 and FUCQ-334 to 339 are `design_impact: yes` with no
  agreed design. Most GC Stories from Jira fail check-story (missing description sections). DEV-046 (FUCQ-255) is a
  proposal needing review. Bugs 051/050 (FUCQ-390/391) are already delivered or target retired Node code.
- FUCQ-599 import: the attachment-field Jira pull is still broken; a single-issue import or the next working pull
  brings it in. Its `ui:` line is in the description.

## Gotchas
- Close records need `cleanup_client: 516ca3553159` (this clone).
- `dev_mail.py ack` on a `note` closes it; reply in a new thread if needed.
- Batch testers on this Mac: Node is v26.5.0, Russell's machines run Node 24.
