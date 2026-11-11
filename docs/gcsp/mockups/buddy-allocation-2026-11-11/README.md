# Buddy tile and Presenter Allocation · 11 November 2026

Visual concepts for Gary to refine or approve. No application behavior or data wiring is implemented.

- [Buddy options](buddy-tile-options.html): A replaces the existing header Buddy chip with a compact tile beside the preserved preferences; two latest events, visible Pause/Resume, full history and relevant detail in the existing flyout pattern. B uses a slim summary above preferences. Active, paused, setup/empty, held-offer and drawer snapshots are included. Accepted and inactive states remain distinct; pausing does not release a held car. Removing the separate Buddy destination is proposed only in these mockups.
- [Presenter options](presenter-allocation-options.html): A adds a separate Allocation section; B groups the three figures beneath the release totals. A is recommended because stock occupancy and employee offer outcomes differ.

Figures, timestamps, vehicle context and deadlines are illustrative. For the metric concept, Pending provisionally means an active Buddy offer awaiting response, with Declined and Accepted counting offer outcomes during this run. Confirm Buddy-only versus all routes and treatment of expired/reconciling decisions before build. The current Buddy Allocated measure combines occupying holds and accepted allocations; it is not accepted-only.

Sources: account `gcsp-account.js`, shared category preferences, `activity-body.js`, `buddy-status.js`, `side-drawer.css`, Presenter `release-section.js`, `presenter-releases/http.js`, and `greg/index.js`. Static markup and embedded assets inspected; parent did a quick browser look at both options and Buddy flyouts. No functional/browser test passes were run for concepts.

Parallel agents: Heihei (Buddy) and Cuthbert (Presenter), each requested/selected `gpt-6.1-sol` with `medium` effort by the repository tiers tool; no fallback. Their child chat titles were set and reported verified. Parent added the compact comparison and shared shell branding. Child attempts to open a local file were blocked by the browser file-URL policy; the parent used the permitted local HTTP preview without granting filesystem access to the browser. No descendants. No Stories or acceptance criteria were added.
