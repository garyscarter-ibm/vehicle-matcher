# BMW Density theme and source reference

Verified 5 November 2026. Gary reports that the client has authorised use of Density but cannot supply it. Public BMW applications provide enough real visual tokens to implement its look and feel through our existing shared kit.

Gary subsequently instructed us to fetch the correct fonts and make Density the main app's default. Every GCSP consumer now inherits the theme through `gcsp-tokens.css`, without a class or page-specific stylesheet. The separate retail brand themes retain their existing styling.

## What we found

The [BMW RIS portal](https://www.ris.bmw.com/) publicly serves [this stylesheet](https://www.ris.bmw.com/styles-PIBQ3WXW.css). It contains Density tokens, `.ds-button` styles and `.ag-theme-density`; the rendered page uses `ds-header` and `ds-navigation-bar`. Its core `:root,:host` block has 1,640 declarations, also counted independently in the live browser CSSOM.

The [BMW Aftersales portal](https://aos.bmwgroup.com/) serves [a second stylesheet](https://aos.bmwgroup.com/styles-I5NKBANU.css). All **1,473 retained RIS tokens match exactly** in that deployment. This gives two first-party sources for the reference values.

| Source | Bytes | SHA-256 |
|---|---:|---|
| RIS CSS | 1,932,716 | `49f8e1938e1cca36b7dd76d37c016fd91ef1774b6a24802def9ef049569a4777` |
| Aftersales CSS | 3,119,844 | `cb85f1c25d8e9c2788e2108f8c8546759be5bd33ab77e7b31bda402b80a4471e` |

These are deployed default-light-theme values, not a versioned Density package. We have not obtained the official Figma library, Angular component source, private documentation or complete interaction specifications. No authenticated access was needed. No package version or certified Density conformance is claimed.

## Usable result

- [`tokens.json`](tokens.json): the 1,473 non-artwork core tokens, provenance and resolved GCSP aliases. The extractor excludes 167 declarations containing embedded artwork or depending on it.
- [`density-theme.css`](../../../blocks/gcsp/shell/density-theme.css) and [`density-typography.css`](../../../blocks/gcsp/shell/density-typography.css): 52 source tokens and 27 local semantic aliases, scoped to all GCSP shells and imported by the shared tokens. Typography has its own generated layer for families and role weights. No vendor JavaScript, artwork, global reset or remote runtime dependency is added.
- [`density-fonts.css`](../../../blocks/gcsp/shell/fonts/density-fonts.css): locally served WOFF2 and WOFF for BMW Group TN Condensed Pro Medium, weight 500. [Font source URLs, sizes and SHA-256 hashes](evidence/font-provenance.json). Both formats match byte for byte across RIS and Aftersales, and their internal name tables confirm the family.
- [`preview.html`](preview.html): the existing representative employee fixture, using that theme and the same shared components and harness.
- [`responsive-check.html`](responsive-check.html): the main employee screen in a 320 CSS pixel iframe for repeatable narrow-layout inspection.
- [`typography-check.html`](typography-check.html): employee, brief, account, Greg, outbox and launcher in independent 320px iframes for the full typography audit.

| Observed Density value | Default light theme |
|---|---|
| Primary / hover | `#037493` / `#035970` |
| Soft action | `#e0f2ff` |
| Page / surface / muted surface | `#f5f6f6` / `#ffffff` / `#f2f3f4` |
| Text / muted text | `#1f2328` / `#4e545d` |
| Divider / focus | `#dcdee1` / `#0291b7` |
| Critical / caution / positive text | `#aa0014` / `#744b00` / `#185f28` |
| Corner radius / spacing unit / quick motion | `2px` / `4px` / `133ms` |
| Base type | System font stack, recorded verbatim in the snapshot |
| Large page titles | `BMWGroupTNCondensedPro-Medium`, weight `500` |

BMW Type Next in our retail assets is not evidence for Density's typography. The live RIS Login button resolves to Density's system stack, a 2px radius, 32px height and 12px text. Density's `title-lg`/`heading-lg` family instead resolves to BMW Group TN Condensed Pro Medium; medium and smaller titles use the system stack. The first reference preview omitted that large-title face. The main theme now applies the downloaded face to the kit's `h1.vm-title` and `h1.gcsp-page-title`, with system fallback and the source weight, avoiding a synthetic bold face.

## Component plan and boundaries

**Full typography audit, 5 November:** reuse the existing shell, form controls, result cards, metric/table kit, message list and launcher. Extend the shared Density layer with role-specific regular/strong/button/input/table/code mappings; apply them to the existing primitives, including smaller headings and fieldset legends. No new UI component or product behaviour is required. Keep the agreed responsive sizes, line heights, sentence case and touch targets. Verify employee, brief, account, Greg, outbox, launcher and the component gallery in the browser, including selected/disabled states and a 320px viewport. Captured email documents retain their transport-safe fonts as a separate content boundary.

**Reuse:** `portalShell`, account navigation, the employee representative body, `button`, `screenIntro`, `factList`, `mediaWell` and existing fixture loaders. **Extend:** make the shared Density mapping the default and add semantic large-title font/weight mappings with locally packaged font faces. **New components:** none. The main component gallery links to the reference preview. Employee, Greg, outbox, account and brief screens, and the shared launcher inherit the same default through the shared kit.

Follow [the experience contract](../experience-quality.md), [the supplied shell screenshots](../screens/README.md) and the existing consumer-oriented representative body. Keep the approved 56px header, 48px sidebar and 48px touch controls. Those dimensions, responsive title sizes and body composition are local choices, rather than an exact copy of RIS's compact controls. The source's full typography and spacing scales remain available in the snapshot for further shared-kit refinement. This changes the default presentation without introducing product behavior or backlog scope.

Browser verification found the shared ghost hover rule overriding a selected button's background while leaving white text. The kit now excludes pressed buttons from that hover treatment so the selected fill stays legible, with either theme.

## Run and apply

From the repository root:

```sh
PORT=3087 node scripts/serve.js
```

Open `http://localhost:3087/gcsp-employee.html` for the main employee screen or `http://localhost:3087/gcsp-greg.html` for Greg. The [reference preview](preview.html) uses exactly the same default. Named existing fixtures still work, for example `?fixture=representative-no-images` or `?fixture=representative-unavailable`.

Existing GCSP pages need no markup change. `gcsp-shell.css` and `gcsp-kit.css` import the shared tokens, which import the Density theme and local font definitions. Reuse the semantic `--gcsp-*` values through the kit; keep source tokens and font declarations out of view-specific rules.

To reproduce the snapshot, save the pinned RIS stylesheet locally, then run:

```sh
python3 scripts/extract-density-reference.py /path/to/styles-PIBQ3WXW.css
```

The extractor checks the pinned hash, parses the core block, excludes artwork and its aliases, checks references/cycles and generates both outputs deterministically. A changed upstream asset requires review rather than silently replacing the source.

## Verification

### Comparison with supplied GCSP screenshots

The [5 November screenshot review](gcsp-screenshot-review.md) finds a **partial visual match**. The palette is consistent, but header branding/account composition and the selected navigation treatment differ from the supplied shell. The screenshots show a more compact, lighter-looking body text hierarchy and do not establish the exact font family or confirm our condensed large H1. The source typography audit below verifies RIS/Aftersales Density; it must not be presented as proof of an exact GCSP screenshot match. The review includes [detail comparisons](evidence/gcsp-screenshot-comparison.jpg), a fresh current-app capture and computed styles. Application styling was not changed by this review.

### Full typography audit

The [source role record](evidence/typography-source.json) preserves the relevant rules and resolved values from the pinned BMW stylesheet. The [browser audit](evidence/typography-browser.json) groups computed styles by element/class, family, weight, style, size, line height and disabled state, across the full rendered DOM of each fixture, including disclosure descendants. It covers employee, brief, account, Greg, selected outbox messages, launcher and all GCSP gallery sections at desktop size; all six app screens were also inspected in real 320px iframe viewports. Each narrow document has a 320px scroll width. This is fixture/browser evidence, not certification of unrendered live-service data or other operating systems.

| Role | Verified family and weight |
|---|---|
| Large page titles | Locally downloaded BMW Group TN Condensed Pro Medium, 500 |
| Body, ledes, notes, fact labels, navigation labels, radio/checkbox options, input/select values | Exact Density system stack, 400 |
| Smaller headings, legends, buttons, accordion summaries, emphasized values, card names/scores | Density system stack, 600 |
| Table column headings | Density system stack, 500 |
| Plain-text viewer and code | Exact Density mono stack, 400 |

The audit corrected browser-default 700 section headings, retail 700 option labels/slider values/card annotations, retail 300 card titles, table headers at 600, the launcher's 700 wordmark and the outbox's different mono stack. Unselected message recipients now use regular 400, with selected recipients at strong 600. A more specific decision-card rule needed a semantic weight with a retail fallback. All audited GCSP gallery and app text now resolves without those inherited 300/700 weights. The browser normalizes `BlinkMacSystemFont` to `system-ui` in computed output; the generated token retains BMW's exact source stack.

The isolated **Email as received** document retains its captured Arial styling, also used by the notification template. Applying app fonts would misrepresent the captured content. Its surrounding UI uses Density, and its plain-text view uses the correct mono stack. AG Grid's Density font is an icon font; this app uses SVG icons and does not require that font.

Existing responsive sizes, line heights, sentence case, emphasized KPI/row/status text, italic missing-data cues and touch-target sizes remain local adaptations. This audit aligns families and role weights with the observed system without claiming a complete vendor component implementation. [Brief desktop](evidence/typography-brief-desktop.jpg), [brief at 320px with selected option and keyboard focus on the slider thumb](evidence/typography-brief-320px.jpg), [employee](evidence/typography-employee-desktop.jpg), [Greg](evidence/typography-greg-desktop.jpg). Native inputs, selected/disabled controls and expanded facts were included; the BMW WOFF2 resource request was observed. Retail still resolves to BMW Type Next and `#1c69d4` outside GCSP.

Final checks: 188 tests passing across the shell/source provenance, ratchet, brief rendering/controls, account, outbox, Greg and launcher suites. The theme cap falls from 84 to 67 lines; the generated typography layer receives a new 50-line cap. No existing cap or component-debt baseline rises. The extractor reproduces the snapshot and both generated CSS files deterministically.

- Live source CSSOM and computed styles confirmed the token block and Login button values; [source observation](evidence/source-observation.json).
- Independent stylesheet comparison: all 1,473 retained RIS tokens occur unchanged in Aftersales.
- Default app rendering: employee at 1113×1087 and Greg/launcher at 1280×720. Primary is `rgb(3, 116, 147)`, page `rgb(245, 246, 246)`, with 2px button corners and 48px touch height. Large titles resolve to the downloaded family at weight 500; the browser asset inventory confirms a local WOFF2 resource request. [Observed values](evidence/default-theme-browser.json), [employee capture](evidence/employee-desktop.jpg), [Greg capture](evidence/greg-desktop.jpg), [launcher capture](evidence/launcher-desktop.jpg). None requires an opt-in class. The retail gallery still resolves to BMW Type Next and `#1c69d4` outside `.gcsp`.
- Narrow rendering: iframe viewport 320×740, document scroll width 320; long names wrap, missing imagery is explicit, menu opens/closes and selection updates the points summary. [Narrow capture](evidence/employee-320px.jpg). The browser viewport override did not take effect, so a real fixed-width iframe supplied this CSS viewport check; this is not mobile-device certification.
- Keyboard Tab exposes a 2px focus outline in `#0291b7` with a 2px offset. Over-allowance selection and Reserve remain disabled. [Selected hover retains the primary fill](evidence/selected-hover-320px.jpg). The unavailable fixture and gallery preview link were also checked in the browser; no console errors were reported.
- Contrast ratios: primary/white **5.35:1**, text/page **14.59:1**, muted text/page **7.05:1**, focus/white **3.66:1**, focus/page **3.38:1**. These are selected palette checks, not a full accessibility audit.
- `node --test server/test/ui-ratchet.test.js server/test/gcsp-shell.test.js server/test/launcher-render.test.js server/test/launcher-context.test.js server/test/launcher-navigation.test.js`: **114 passing**, including default-theme import and token isolation, exact font hashes, CSP, representative fixture behavior and launcher/retail continuity. The GCSP token stylesheet cap falls from 57 to 30 lines; new theme/font stylesheets receive initial caps. No existing cap or component-debt baseline increases, and no runtime dependency is added.

Density is now the shared default. Further UI refinement can reuse these values and fonts through the kit. The missing official library no longer blocks use of Density's observed visual values.
