# Offer email image and styling, 11 November 2026

Gary requested a car image and restrained styling from the newly pushed Your offer page.
The builder confirmed build `11c19a6e`, integrated into `gcsp-poc` as `ad275af8`, is the intended
reference. This change uses its whole-car image treatment, white bordered facts panel, deadline
divider, 16/24 px spacing and Density teal `#037493` for one **View offer** button. It retains a
small copyable link and the existing plain-text alternative. The email does not add a gallery,
comparison table, countdown or decision controls.

## Image and transport behaviour

The dispatcher uses the offer page's existing `withVehicleDisplayImages` projection, including
older pinned quotes without a stored photo. Projection does not update the saved quote or its
signed inputs. The renderer selects the approved primary gallery image, falling back to another
approved entry, and uses the vehicle name as escaped alternative text. Missing or unsupported
images are omitted. The image keeps its natural aspect ratio.

Captured and Brevo transports resolve the image against their validated public base. Image URLs
contain no employee, run, offer or access-token parameters. The existing catalogue whitelist
rejects external, unknown, query-bearing and fragment-bearing image sources. No runtime
dependency, address setting or schema was added. Provider capture, idempotency and recipient
pinning retain their existing behaviour; already captured messages are not rewritten or resent.

## Validation and rendered review

- Before the final white-panel refinement, the scoped notification, mail transport, route/viewer,
  buddy-runtime producer, car-name, painted-copy and browser run passed **161 tests, 0 failed,
  0 skipped** at base `4115f4ea`. Receipt:
  `.claude/test-runs/targeted-16986b37ae95ae0e40130f464f3f794e3648a0dd220e09db513654d9b02410da-default-1794439366443258000.json`.
  Its presenter painted-copy fixture emitted two `clockVersion` console diagnostics while its
  assertion passed. This output is retained in the log, not represented as repaired by this change.
- After fast-forwarding to integrated `ad275af8`, final outbox, Brevo transport, display-projection
  and browser checks passed **96 tests, 0 failed, 0 skipped**. This includes actual dispatcher
  enrichment of an older quote and verification that the saved quote remains unchanged. Receipt:
  `.claude/test-runs/targeted-ef19bdeb7fff5cd1ad9f9fcf3d5a16d9fa18ff1da2cffa753846cd572bf3d493-default-1794439434848816000.json`.
- A concurrent paint-family policy update advanced the shared branch to `43da30f4` during publish.
  The email commit was rebased without conflicts and the same final selection repeated:
  **96 passed, 0 failed, 0 skipped** at code commit `5a3e0162`. Receipt:
  `.claude/test-runs/targeted-65c90331c1aca726cdc07f4c88c362a5fe4b0a779abb292361aead9246e4bb0e-default-1794439552613745000.json`.
  Only this documentation receipt changed afterwards.
- Local Chrome inspected at 1440 and 390 px: loaded image, natural aspect ratio, readable facts,
  keyboard action/focus, no horizontal overflow, expired state, missing image and blocked-image
  readability. Both final captures were visually inspected. Preview fixture values are illustrative;
  production values continue to come from the saved quote and offer.
- All supervised runs used one worker and removed their owned scratch. `git diff --check` passed.

Retained local captures and checks are under
`/Users/garycarter/Documents/Codex/2026-11-11/emai/outputs/`:
`offer-email-1440.png`, `offer-email-390.png`, `offer-email-visual-checks.json`.
The local visual check is `../work/offer-email-visual.test.mjs` relative to that output directory.

These checks use a local renderer and stubbed provider. No new live email was sent; fresh inbox
appearance in Outlook/Gmail and live Render deployment are unverified. Mail clients can block
remote images; vehicle name, points, deadline and action remain readable without the photo.
No Jira writes were made while the project-wide pause remains in effect.
