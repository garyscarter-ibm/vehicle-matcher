# Handover: presenter console revamp, 10 November 2026

**Goal:** build Gary's approved presenter console: a standalone, user-agnostic admin page for releasing cars,
with Basic (two buttons) and a hidden Advanced mode, and no presenter overlay anywhere in the app.

**Read first:** `docs/gcsp/presenter-revamp-spec.md` (approved; its "Revision: user agnostic" section
overrides the per-employee funnel and offer card earlier in it), `docs/gcsp/mockups/presenter-console.html`
(approved at 00ddf9fe), then `docs/gcsp/presenter-controls-contract.md`, `blocks/gcsp/presenter-controls/`,
`blocks/gcsp/shell/portal-shell.js`, `server/gcsp/stock/run-stock.js`.

**Decisions (Gary, 10 November 2026):**
- Basic has two buttons, **Release tomorrow's cars** and **Start again**, plus a link to the portal.
- Releases are on weekdays at 11:30am UK time, 100 cars each.
- The main journey moves onto generated stock **before** 12 November (FUCQ-363), so every release and
  every Start again brings a different set of cars.
- The console is user agnostic: matches and offers show only in each employee's journey.
- No passphrase on the console for the demo.
- Concepts are quick visual screens only (AGENTS.md, "Concepts and mockups").

**Stories (To Do, label `presenter-revamp-20261110`):** FUCQ-360 console page, Basic and Advanced (M);
FUCQ-361 remove the presenter rail item and flyout from the portal (M); FUCQ-362 friendly time and the
Release button (M); FUCQ-363 100 different cars every weekday (M, 8 points, the riskiest);
FUCQ-364 read of the latest release (S); FUCQ-365 release visual (S); FUCQ-366 What happened feed (C).
GCSP work merges into `gcsp-poc`.

**Notes:**
- A worktree's `server/node_modules` lacks `pg`. Symlink it to the main checkout's
  `server/node_modules` to run `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory`; it's git-ignored.
- A stale `<tmpdir>/gcsp-stock-inventory/*.json` makes generated stock fall back to demo stock
  (`retained-stock-request-mismatch`). Test FUCQ-363 against a restart.
- The mockup preloads full images. The build needs small thumbnails for the 100-tile grid.
