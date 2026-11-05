# GCSP visual references

Russell clarified the visual direction on 1 November 2026: use these supplied GCSP screenshots for the **header, sidebar and palette**, consider retaining breadcrumbs, and redesign the body toward the consumer-facing Used Cars experience. No further screenshot upload is required. All eight files were inspected directly for this clarification.

| Reference | What it shows |
|---|---|
| [00 · Employee account](00-employee-account.webp) | Portal header, account control, narrow icon sidebar, active navigation and neutral/teal palette. |
| [01 · Replace vehicle](01-replace-vehicle.webp) | Persistent shell, breadcrumb, legacy step indicator and dense current-car/account panels. |
| [02 · New order](02-new-order.png) | Active teal controls, breadcrumb and legacy form layout. |
| [03 · Vehicle series](03-vehicle-series.png) | Shell/navigation around series selection; legacy progression and eligibility display. |
| [04 · Vehicle models](04-vehicle-models.png) | Persistent shell around a dense listing table. |
| [05 · Vehicle details](05-vehicle-details.webp) | Vehicle image, details and legacy form arrangement. |
| [06 · Summary](06-summary.png) | Legacy summary and confirmation requirements. |
| [07 · Order confirmation](07-order-confirmation.webp) | Persistent shell and final legacy journey state. |

## Retain and redesign

- **Header:** the slim white portal header, brand marks/title on the left and account context on the right. Browser tabs, bookmarks and operating-system chrome are outside the application reference.
- **Sidebar:** the narrow vertical icon navigation, recognisable positioning and selected-state treatment. Supply accessible names, visible focus and usable narrow-screen navigation.
- **Palette:** the white/light-grey surfaces, neutral text/dividers and teal/cyan accents visible in the portal. Express them through scenario-scoped semantic tokens so the existing Used Cars brand themes remain stable. Screenshot colours are a visual reference, not verified official token values.
- **Breadcrumbs:** optional where they help orientation. Their presence does not require retaining the separate seven-step wizard/stepper or the old body sequence.
- **Body:** redesign the content hierarchy, page composition, cards, forms, controls, imagery and interactions. Use the consumer-facing Used Cars experience and shared kit as the design direction: strong vehicle imagery, clear headings and next actions, useful spacing, understandable preference controls, and grounded fit/trade-off explanations. Preserve relevant business information and working behaviour through the new design.

This direction is agreed; the earlier missing-reference blocker is cleared. A representative redesigned employee body should still be reviewed early and recorded as the implementation reference for later surfaces. That is normal design/experience QA, not a requirement for Russell to provide another existing design or upload. Greg can use a denser body while retaining the same shell and component language.

The captures were supplied from INT with junk data. They establish visible shell treatment and historical journey evidence, not authoritative prices, employee facts, scheme policy or offer timing. The [experience quality contract](../experience-quality.md) governs implementation and acceptance. The IBM Carbon service blueprint is a separate explanatory artifact and does not override this application direction.

The [5 November Density comparison](../density/gcsp-screenshot-review.md) records the current shell differences and typography limits, with visual evidence. Matching public RIS/Aftersales Density rules does not establish an exact match to these GCSP screenshots.
