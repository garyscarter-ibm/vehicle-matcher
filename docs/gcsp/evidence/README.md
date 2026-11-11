# GCSP delivery evidence

Historical screenshots, source captures, run outputs and one-off proof scripts were archived on 11 November 2026. Acceptance/provenance notes and files used by current tests, scripts, CI workflows, data and browser harnesses remain at their existing paths. Keeping those compatibility paths avoids unrelated application changes before the demonstration.

The [archive index](../evidence-archive-2026-11-11.json) records every removed main-checkout file, its SHA-256, byte count and Git blob. Historical links in the retained notes refer to those original paths; use the index to recover their targets. Archiving does not change any recorded pass, failure, skip, limitation or acceptance decision.

The complete external archive, including differing evidence versions in linked worktrees, is at:

```text
/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_archives/evidence-archive-2026-11-11-01a1ca5d/
```

`objects.tar.gz` stores each unique file once. `checkouts.json` maps the original paths in every checkout to those objects, including untracked variants. `verification.json` records the full object/hash verification. This is a verified local OneDrive copy; cloud upload and sharing were not verified.

## Retrieve a historical file

Run from the repository root. List a specific story's archived paths:

```sh
python3 -B _tools/evidence_archive.py list --prefix docs/gcsp/evidence/fucq239/
```

Recover one file from Git history to a new output file:

```sh
python3 -B _tools/evidence_archive.py restore \
  --path docs/gcsp/evidence/fucq239/results-1280.json \
  --output /tmp/fucq239-results-1280.json
```

To read the same bytes from the external archive instead, add `--archive /absolute/path/to/objects.tar.gz`. The helper checks both size and SHA-256 and refuses to overwrite an existing destination. Git-based retrieval works for other collaborators without access to this machine's OneDrive folder while the historical objects remain in Git.

## New evidence

Keep a concise Markdown result here, naming the tested code, selected checks, outcomes, limitations and external artifact location. Save bulky captures and generated outputs directly outside the repository under the project's OneDrive output area, with hashes and a retrieval route. New test fixtures belong in `server/test/fixtures/`; reusable verification scripts belong in `_tools/` or `scripts/`. Existing tracked dependencies remain version controlled even though new bulk files here are ignored.

Linked worktrees use local sparse-checkout exclusions for the archived files. Their branches and commits are preserved. `git sparse-checkout disable` in a linked worktree materialises its historical tracked evidence again; only do that when those copies are needed. The main checkout uses a committed removal instead. No Git history rewrite or worktree removal was performed.
