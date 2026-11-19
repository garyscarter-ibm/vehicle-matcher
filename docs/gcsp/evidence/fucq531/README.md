# FUCQ-531 connected proof c531a2: Greg's plan page with the learned model active

Rendered AC1 evidence for FUCQ-531, and for FUCQ-476 (learned=available on the page).

- **Run:** c531a2, 19 Nov 2026 09:47:58 to 09:48:31 UTC, source revision 6ce3823dc (merged into gcsp-poc-dev at 9c5263d62).
- **Command:** `scripts/gcsp/fucq449-connected-planning-proof.mjs` in `_tools/test_stack.py heavy --label fucq531`.
  - Settings: `PROOF_LEARNED_MODEL=1`, `GCSP_LEARNING_ACTIVE_MODEL=sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d` and policy version `gcsp-policy-v1+learned-model-v1`.
  - Stack: the real Java API jar, PostgreSQL 17 and headless Chrome.
- **Result:** overall PASS, 45 checks, 0 failed.
- **Learned-state checks (all true):**
  - A direct `GET /greg/order-plan` as Greg answers learned `available`, labelled "Learned model", not recommended and not submittable, with the retained model id.
  - The page shows the learned section the API reports: the heading, the model id and the advisory sentence, plus one class row per forecast entry with expected, low and high.
  - At 1280x900, with real Tab key events and no mouse, focus reaches the "Expected demand by vehicle class" table region, with a visible focus indicator.
  - The learned section with the focused table region is captured as a PNG.
- **Screenshot:** `ac1-learned-available-1280x900.png` (175,599 bytes, sha256 `47c3562beef82406bf5faddded561024452dbbbbf6f2c996a4312bf0107c079c`). Not committed, because the repo's `.gitignore` excludes evidence images.
- **Where the files are:** the screenshot, the full receipt `connected-planning-proof.json` and the other screenshots are kept git-ignored at `.claude/test-runs/fucq531/connected-20261119T094840Z-c531a2/` on Gary's Mac.
