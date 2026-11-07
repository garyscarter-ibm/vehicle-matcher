# Activity adapter upgrade checkpoint

5 November 2026. The Activity custom element now preserves an injected adapter assigned before its registration. Its constructor captures the own property, removes that shadowing property and stores the adapter before connection. Later adapter changes retain the existing remount and abort contract. No new API or styles.

The new regression failed first because the upgraded element discarded the adapter and could not load its account. After the constructor change, all six entry tests passed (no failures or skips), including ready-account gating, pause/resume focus, failed refresh and Retry, external abort, brand/account refusal, outside focus, subsequent adapter remount, refresh and disconnect. The selected scope is the constructor and its existing embedding boundary; the parent retains runtime and full-suite admission.

One worker, 512 MiB granted RAM, 256 MiB scratch cap, 120-second chunk cap. Red/green peaked at 250,724,352/269,484,032 bytes recursive RSS, zero measured scratch bytes and 4.52/0.73 seconds. Both allocation roots, owned process groups and reservations are absent. Exact dependency links were removed and their targets rehashed unchanged. The successful verbose log was removed; the concise receipt and useful failing log remain in the shared test-run record. No browser profile, large output or leftover. Machine-readable identity, mapping and cleanup evidence accompany this review.

The prepared live consumer remains unvalidated pending the parent-integrated FUCQ-94 base. Genuine check/source and canonical offer seams remain open; this checkpoint does not close FUCQ-95.
