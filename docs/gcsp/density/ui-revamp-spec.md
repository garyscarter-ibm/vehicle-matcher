# GCSP UI revamp spec, 10 November 2026

Gary's direction: match the current GCSP portal screens (`docs/gcsp/screens/*`) first. Where they don't show something, use Density tokens. This is a visual pass. Copy and behaviour stay as they are; the UX revamp comes later.

## What the screens show

- The page is light grey (`--gcsp-surface-page`). Content sits in white panels with a 1px `--gcsp-divider` border, a 2px radius and no shadow.
- Panel titles are small and semibold, in sentence case. Field labels are 12px muted. Values are 14px. The layout is dense, on a 4px grid.
- Buttons are compact: 32px high, 12px semibold text and 0 12px padding. Primary is a teal fill, secondary is a teal outline, and Cancel is a red outline.
- The header is slim and white, the left navigation is narrow and uses icons, and the selected item is tinted with a 2px bar.

## Tokens to use (all are defined on `.gcsp`)

| Role | Token |
|---|---|
| Page title (h1) | Shared rule already applied: BMW Condensed, uppercase, `--gcsp-font-size-title` (23px) / `--gcsp-font-line-title` |
| Section title (h2) | `--gcsp-font-size-heading` 16px / `--gcsp-font-line-heading` 24px, `--gcsp-font-strong-weight`, sentence case |
| Sub-section, card name, panel title (h3+) | `--gcsp-font-size-regular` 14px / `--gcsp-font-line-regular` 20px, strong weight |
| Body, values, table cells | `--gcsp-font-size-regular` 14px / 20px |
| Lede, long reading copy | `--gcsp-font-size-regular` (a lede is not larger than body) |
| Labels, hints, captions, kicker, table headers | `--gcsp-font-size-label` 12px / `--gcsp-font-line-label` 16px |
| Smallprint | `--gcsp-font-size-smallprint` 10px (rarely) |
| KPI figure / headline figure | `--gcsp-font-size-figure` 29px / `--gcsp-font-size-figure-lg` 37px |
| Weights | `--gcsp-font-weight` 400, `--gcsp-font-strong-weight` 600, `--gcsp-font-table-header-weight` 500. Never 300 or 700 |
| Spacing | `--gcsp-space-half` 2, `-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48 |
| Panel padding / stack gap | `--gcsp-space-4` inside panels, `--gcsp-space-4`–`--gcsp-space-6` between panels |
| Controls | `--gcsp-control-height` 32px, `--gcsp-input-height` 32px, `--gcsp-control-inline` 12px. Under 600px, interactive controls keep `min-height: 44px` |
| Surfaces | `--gcsp-surface`, `--gcsp-surface-page`, `--gcsp-surface-muted`, `--gcsp-hover`, `--gcsp-selected`, `--gcsp-selected-bar` |
| Text | `--gcsp-text`, `--gcsp-text-muted`, `--gcsp-link`, `--gcsp-link-hover`, `--gcsp-disabled-text` |
| Borders | `--gcsp-divider` (panels), `--gcsp-input-border`, `--gcsp-input-border-hover` (inputs) |
| States | `--gcsp-{success,warning,danger,info}` text with `-surface` and `-border` companions |
| Accent | `--gcsp-accent`, `--gcsp-accent-strong`, `--gcsp-accent-soft`, `--gcsp-ghost-hover`, `--gcsp-on-accent`, `--gcsp-focus` |
| Elevation | Not used on cards. Only floating overlays use `--gcsp-elevation-overlay` (menus, popovers, the presenter flyout) |
| Radius | `--gcsp-radius` (2px). `50%` only for avatars and dots; `999px` only for the range-bar track |

## Rules

- Use tokens only: no hex, rgb or rgba values, no raw px font sizes, and no raw spacing apart from 1px borders. Small fixed geometry, such as icon width/height and an 8px dot, may stay in px.
- Don't add shadows, gradients, glows, tinted shadow halos or coloured side-stripe borders. A selected card gets a 1px or 2px `--gcsp-accent` border all round.
- Don't use pill buttons or large radii.
- Don't set per-view font families. Weights come from the semantic tokens.
- `.vm-btn` and its variants are styled once in `blocks/vehicle-matcher/gcsp-kit.css`. Don't restyle the buttons per view, beyond layout properties such as width and alignment.
- Keep code comments to two lines or fewer, and don't put em dashes in user-facing strings.
- Every selector stays `.gcsp`-scoped. Retail `.vm` brand themes outside `.gcsp` must not change.
