# BMW Density reference

Verified 5 November 2026. Gary reports that the client has authorised use of Density but cannot supply it. Public BMW applications provide enough real visual tokens to implement its look and feel through our existing shared kit.

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
- [`density-reference.css`](../../../blocks/gcsp/shell/density-reference.css): 37 source tokens and 19 local semantic aliases, scoped to opted-in GCSP shells. No vendor JavaScript, fonts, artwork, global reset or remote runtime dependency is added.
- [`preview.html`](preview.html): the existing representative employee fixture, using that theme and the same shared components and harness.
- [`responsive-check.html`](responsive-check.html): the same preview in a 320 CSS pixel iframe for repeatable narrow-layout inspection.

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

BMW Type Next in our retail assets is not evidence for Density's base font. The live RIS Login button resolves to Density's system stack, a 2px radius, 32px height and 12px text.

## Component plan and boundaries

**Reuse:** `portalShell`, account navigation, the employee representative body, `button`, `screenIntro`, `factList`, `mediaWell` and the existing fixture loader. **Extend:** shared shell theming through an opt-in semantic mapping. **New components:** none. The main component gallery links to the reference preview.

Follow [the experience contract](../experience-quality.md), [the supplied shell screenshots](../screens/README.md) and the existing consumer-oriented representative body. Keep the approved 56px header, 48px sidebar and 48px touch controls. Those dimensions and the body composition are local choices, rather than an exact copy of RIS's compact controls. The source's full typography and spacing scales remain available in the snapshot for further shared-kit refinement. This reference does not change the application's default theme or introduce product behavior or backlog scope.

Browser verification found the shared ghost hover rule overriding a selected button's background while leaving white text. The kit now excludes pressed buttons from that hover treatment so the selected fill stays legible, with either theme.

## Run and apply

From the repository root:

```sh
PORT=3087 node scripts/serve.js
```

Open `http://localhost:3087/docs/gcsp/density/preview.html`. Named existing fixtures still work, for example `?fixture=representative-no-images` or `?fixture=representative-unavailable`.

To use the theme on another GCSP page, load `blocks/gcsp/shell/density-reference.css` **after** its shared styles. Add `.density-reference` to an ancestor such as the body, or to the `.gcsp` shell itself. Reuse the semantic `--gcsp-*` values through the kit; keep the extracted source tokens out of view-specific rules.

To reproduce the snapshot, save the pinned RIS stylesheet locally, then run:

```sh
python3 scripts/extract-density-reference.py /path/to/styles-PIBQ3WXW.css
```

The extractor checks the pinned hash, parses the core block, excludes artwork and its aliases, checks references/cycles and generates both outputs deterministically. A changed upstream asset requires review rather than silently replacing the source.

## Verification

- Live source CSSOM and computed styles confirmed the token block and Login button values; [source observation](evidence/source-observation.json).
- Independent stylesheet comparison: all 1,473 retained RIS tokens occur unchanged in Aftersales.
- Local desktop rendering: 1280×720, actual primary `rgb(3, 116, 147)`, page `rgb(245, 246, 246)`, 2px button corners and 48px touch height. [Desktop capture](evidence/employee-desktop.jpg).
- Narrow rendering: iframe viewport 320×740, document scroll width 320; long names wrap, missing imagery is explicit, menu opens/closes and selection updates the points summary. [Narrow capture](evidence/employee-320px.jpg). The browser viewport override did not take effect, so a real fixed-width iframe supplied this CSS viewport check; this is not mobile-device certification.
- Keyboard Tab exposes a 2px focus outline in `#0291b7` with a 2px offset. Over-allowance selection and Reserve remain disabled. [Selected hover retains the primary fill](evidence/selected-hover-320px.jpg). The unavailable fixture and gallery preview link were also checked in the browser; no console errors were reported.
- Contrast ratios: primary/white **5.35:1**, text/page **14.59:1**, muted text/page **7.05:1**, focus/white **3.66:1**, focus/page **3.38:1**. These are selected palette checks, not a full accessibility audit.
- `node --test server/test/ui-ratchet.test.js server/test/gcsp-shell.test.js`: **68 passing**, including token isolation, CSP and representative fixture behavior. No new runtime dependency or ratchet baseline increase.

The remaining integration work is applying this shared theme across the intended product surfaces during the agreed UI pass and checking their specific states. The missing official library no longer blocks use of Density's observed visual values.
