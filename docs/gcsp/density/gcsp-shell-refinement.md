# GCSP shell reference refinement

Authorised by Gary, 5 November 2026, following the [screenshot comparison](gcsp-screenshot-review.md). Follow the [experience contract](../experience-quality.md), [supplied shell references](../screens/README.md), [demo boundaries](../demo-brief.md) and [build rules](../build-rules.md).

## Decided and component plan

- **Reuse** the shared `portalShell`, `accountNavigation`, semantic Density tokens, keyboard focus treatment, navigation disclosure and account loading/unavailable/Retry states. Keep the agreed consumer-oriented body, source-derived font families and accessible target sizes.
- **Extend** `portalShell` branding with the BMW GROUP/BMW/MINI artwork already embedded in the pinned public Density CSS, packaged as a local SVG with provenance. This preserves the supplied reference's mark proportions without drawing a substitute wordmark.
- **Extend** the ready account state with a compact single-row native details/summary control: smaller avatar, regular name, chevron. Its disclosure shows the full name and existing scheme context; Enter/Space and Escape work. This gives the chevron an actual purpose without inventing account actions.
- **Extend** `accountNavigation` styling with the reference's pale cyan selected fill, teal icon and teal left edge, in both collapsed and expanded modes. Use the existing semantic tokens and preserve disabled states.
- **New components:** none. Shared CSS, the catalogue, existing gallery and shell checks change together. No view-specific shell overrides or new product/backend scope.

## Acceptance

The employee, account, brief, Greg and outbox inherit the same updated shell. The branded header stays slim; the ready account name/context occupy one row plus a disclosure instead of two permanent rows. Long names remain accessible without horizontal overflow. Loading and unavailable states retain their existing meaning and Retry action. The selected sidebar treatment matches capture 00's visual pattern and remains visible when labels are shown. Narrow layouts retain usable menu/account controls and visible keyboard focus. GCSP continues to have no inline scripts, event attributes or eval.

## Validate

Run the shell and UI ratchet suites plus relevant consumer render/interaction suites. Inspect the employee and another shared-shell consumer at desktop, the gallery's ready/loading/unavailable states and collapsed/expanded navigation, and a real 320px viewport. Exercise the account disclosure, Escape and narrow navigation by keyboard. Save rendered evidence and computed measurements; compare the result directly with the supplied capture. Record the outcomes below before committing.

## Result and evidence

The shared shell now uses the reference's branding composition, compact account presentation and pale selected navigation. The combined logo is decoded verbatim from `--ds-asset-logo-bmwgroup-bmw-mini-default` in the pinned RIS CSS and matches the Aftersales asset byte for byte; [provenance and checksum](evidence/shell-logo-provenance.json). It is served locally, without a new runtime dependency. The theme generator still excludes embedded artwork; this explicitly packaged header image is a separate asset.

Header geometry remains 56px, with 22px-high branding at desktop and 18px on narrow screens. The portal title is regular 14px at desktop. The account name is regular 13px with a neutral 20px avatar and a 44px-high summary target; its full name and scheme context are available in the disclosure. A narrow-state check found the full unavailable message wrapping to five lines; the visible status now reads **Account unavailable**, retaining the full message for assistive technology and the tooltip, alongside Retry. Ready, loading and unavailable headers each remain 56px high at 320px.

Selected navigation now uses `#e0f2ff`, a `#037493` icon/label and a 3px teal left border. It extends to the rail edge. The existing guard against decorative side stripes has a bounded exception for this reference-derived navigation marker; other components retain the guard. The shell stylesheet cap falls from 307 to 298 lines, with no component-debt increase.

Inspected the actual employee app at 1280×900, Greg and the gallery at 1280×720, and the employee ready/account-open/menu-open/unavailable/loading states at 320×740. Each narrow document's scroll width is 320px. The viewport override worked for the main tab in this run, so no iframe workaround was needed; temporary overrides were reset and inspection tabs closed.

Enter opens the account disclosure; Escape closes it and returns focus to its summary. The summary has the existing 2px `#0291b7` keyboard focus outline. The rendered accessibility snapshot exposes the full account name and scheme context when open. Escape closes narrow navigation and returns focus to Menu. Retry takes the unavailable fixture through loading and back to its actual unavailable state. Gallery inspection covers the unusually long name, loading, open details and unavailable states, plus collapsed and expanded navigation. Disabled navigation remains explained and unavailable.

- [Employee desktop](evidence/shell-refinement-desktop.jpg), [Greg desktop](evidence/shell-refinement-greg.jpg), [long account name](evidence/shell-refinement-long-name.jpg).
- [Account details at 320px](evidence/shell-refinement-320px-account.jpg), [navigation at 320px](evidence/shell-refinement-320px-menu.jpg), [unavailable at 320px](evidence/shell-refinement-320px-unavailable.jpg).
- [Computed measurements and interaction record](evidence/shell-refinement-browser.json).

**190 checks pass** across UI ratchet, shell/source/CSP/gallery, brief rendering/controls, account rendering, outbox, Greg and launcher rendering/context/navigation. `git diff --check` passes. The source-derived font families and agreed consumer-oriented body hierarchy continue unchanged; the [screenshot review's font-identification limits](gcsp-screenshot-review.md) still apply. This implementation closes the identified shell gaps without claiming pixel-identical original CSS or an exact GCSP font-family identification.
