# Paint to colour-family mapping — 11 November 2026

The shared machine-readable table is `stock.paintColourFamilies.v1` in `server/gcsp/policy/seed-v1.json`, available through `PolicyService.getAssumption`. This document is its readable projection. It covers **183 retained paint identifiers**: 29 ordinary/named paint codes and 154 specific `PI…` Individual shade identifiers. Upstream `optionType: other` does not make a named `PI…` shade colourless.

**Individual is not a colour family.** For example, `P0C5A` is BMW Individual Frozen Pure Grey → **Grey**, `P0C6R` is Frozen Portimao Blue → **Blue**, and `PIP8X` is Frozen Brooklyn Grey → **Grey**. Preserve the full named paint and finish for display; use the broad family for a future preference.

All family assignments are explicit, revisable **assumptions**, not an official BMW taxonomy. Most follow a single colour word in the source name. “Curated” marks marketing names, translated names or mixed hues that require a judgement; alternatives flag the most ambiguous choices. The shade table includes currently unselected catalogue choices. Their availability alone does not establish selection, fitment or applicability to every model.

## Resolving P0490

`P0490` is the generic BMW Individual Paintwork selection. Resolve it using a **specific actually selected `PI…` shade code**, when retained. That code takes precedence over the generic label. If its specific selection is missing or conflicting, leave the family unknown and record the evidence gap; never pick a colour from the available dictionary. The other named Individual paints (`P0C5A`, `P0C64`, `P0C6R`, etc.) resolve directly.

The exact 10,000-cohort audit contains 22 primary paint codes, including 761 `P0490` selections. The “10k primary selections” column below comes from that audit; zero means no primary selection in that cohort, not proof that the shade is unavailable or absent from companion data. Source-matrix counts cover a different 4,863-record inventory and are deliberately not mixed into these counts.

The sealed cohort's canonical IDs and original retained payload byte ranges were inspected for all 761 `P0490` rows. **None retains another paint/shade identifier from this 183-code catalogue** in its canonical factory selection, `selectedElements` or `resolvedOptions`; all record the generic `paint.value.code: P0490`. This is a limitation of the retained selections, not a claim that BMW never supplies a companion shade code. Named `PI…` entries exist in the available dictionaries but cannot be promoted to selected equipment merely because they appear there.

The audited selection manifest is `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-retained-coverage-20261107/selection-manifest.json` (SHA-256 `216359c111a5169d15a98de1c476a5c62714a3b3a7ee71431c325a45c90f096f`); the committed closeout reference register pins it. Example source payload: `.agent-output/f70-optional-axis-suffix3623-20261107-once/sessions/session078/accepted.jsonl:5` under the same OneDrive project root. The manifest carries its original byte offsets. Existing source files were streamed/read by range, with no copies or new source requests.

Consequently, the initial table supplies families for 9,239 of the cohort's primary paint selections; 761 await the actual specific Individual shade. If a later adapter supplies that selected code, the table already includes the 154 retained `PI…` identifiers needed to resolve it.

**Live sample check, 11 November:** an exact i5 Touring and iX1 `P0490` selection both restored successfully in BMW's current configurator, preserving every factory code and showing the generic Individual label with a rainbow swatch. Neither resolved to a named shade or requested one in the inspected colour panel. An Alpine White control restored its named paint correctly. This confirms the public configurator permits a generic selection; it does not establish how a production order records the eventual shade. Keep the family unknown. See the [sample evidence and limits](evidence/paint-live-sample-2026-11-11/README.md).

## Mapping table

| Code | Retained paint name | Family | Basis / alternative | 10k primary selections |
|---|---|---|---|---:|
| `P0300` | Alpine White | White | Name | 1,402 |
| `P0416` | Carbon Black | Black | Name | 22 |
| `P0475` | Black Sapphire | Black | Name | 1,229 |
| `P0490` | BMW Individual Paintwork | Unknown | Generic; selected companion required | 761 |
| `P0668` | Jet Black | Black | Name | 152 |
| `P0A90` | Sophisto Grey | Grey | Name | 23 |
| `P0A96` | Mineral White | White | Name | 343 |
| `P0C1M` | Phytonic Blue | Blue | Name | 23 |
| `P0C31` | Portimao Blue | Blue | Name | 676 |
| `P0C36` | Dravit Grey | Grey | Name | 0 |
| `P0C3N` | Storm Bay | Grey | Curated | 419 |
| `P0C3Z` | Tanzanite Blue | Blue | Name | 444 |
| `P0C4A` | Oxide Grey | Grey | Name | 24 |
| `P0C4F` | Arctic Race Blue | Blue | Name | 0 |
| `P0C4P` | Brooklyn Grey | Grey | Name | 610 |
| `P0C4W` | Skyscraper Grey | Grey | Name | 656 |
| `P0C56` | Thundernight | Purple | Curated | 649 |
| `P0C5A` | BMW Individual Frozen Pure Grey | Grey | Name | 675 |
| `P0C5Y` | Cape York Green | Green | Name | 443 |
| `P0C64` | BMW Individual Frozen Deep Grey | Grey | Name | 21 |
| `P0C67` | Space Silver | Silver | Name | 0 |
| `P0C68` | Fire Red | Red | Name | 672 |
| `P0C6E` | Zandvoort Blue | Blue | Name | 88 |
| `P0C6R` | BMW Individual Frozen Portimao Blue | Blue | Name | 645 |
| `P0C7A` | Dune Grey | Grey | Name | 0 |
| `P0C7R` | Night Dusk Blue | Blue | Name | 0 |
| `P0X1E` | Frozen Portimao Blue | Blue | Name | 23 |
| `P0X1F` | Frozen Pure Grey | Grey | Name | 0 |
| `P0X1G` | Frozen Tanzanite Blue | Blue | Name | 0 |
| `PI071` | Agave solid | Green | Curated | 0 |
| `PI138` | Vermillion red solid | Red | Name | 0 |
| `PI266` | Laguna Green metallic | Green | Name | 0 |
| `PI275` | Boston Green metallic | Green | Name | 0 |
| `PI276` | Avus Blue metallic | Blue | Name | 0 |
| `PI283` | Daytona Violet metallic | Purple | Name | 0 |
| `PI287` | Mauritius Blue metallic | Blue | Name | 0 |
| `PI299` | Techno-Violet | Purple | Name | 0 |
| `PI303` | Cosmos Black Metallic | Black | Name | 0 |
| `PI312` | British Racing Green solid | Green | Name | 0 |
| `PI314` | Bright Red | Red | Name | 0 |
| `PI327` | Santorini Blue II solid | Blue | Name | 0 |
| `PI336` | Aegean Blue metallic | Blue | Name | 0 |
| `PI337` | Dakar Yellow | Yellow | Name | 0 |
| `PI359` | Mora metallic | Purple | Curated | 0 |
| `PI375` | Fire Red | Red | Name | 0 |
| `PI379` | Velvet Blue | Blue | Name | 0 |
| `PI381` | Le Mans Blue | Blue | Name | 0 |
| `PI405` | Imola Red | Red | Name | 0 |
| `PI406` | Orinoco Metallic | Green | Curated | 0 |
| `PI416` | Carbon Black | Black | Name | 0 |
| `PI430` | Oxford Green II | Green | Name | 0 |
| `PI440` | Stratus Grey | Grey | Name | 0 |
| `PI448` | Laguna Seca Blue | Blue | Name | 0 |
| `PI453` | Midnight Blue metallic | Blue | Name | 0 |
| `PI621` | Brass metallic | Gold | Curated | 0 |
| `PIA15` | Maldives Blue | Blue | Name | 0 |
| `PIA30` | Interlagos Blue | Blue | Name | 0 |
| `PIA31` | Indianapolis Red | Red | Name | 0 |
| `PIA32` | Sepang Bronze | Bronze | Name | 0 |
| `PIA39` | Barbera Red | Red | Name | 0 |
| `PIA43` | Deep Green | Green | Name | 0 |
| `PIA53` | Platinum Bronze | Bronze | Name | 0 |
| `PIA73` | Jerez Black metallic | Black | Name | 0 |
| `PIA90` | Sophisto Grey | Grey | Name | 0 |
| `PIA96` | Mineral White | White | Name | 0 |
| `PIB51` | San Marino Blue | Blue | Name | 0 |
| `PIB53` | Sparkling Brown | Brown | Name | 0 |
| `PIB65` | Jatoba | Brown | Curated | 0 |
| `PIC17` | Brands Hatch Grey | Grey | Name | 0 |
| `PIC1A` | Sonic Speed Blue | Blue | Name | 0 |
| `PIC1K` | Marina Bay Blue | Blue | Name | 0 |
| `PIC1M` | Phytonic Blue | Blue | Name | 0 |
| `PIC31` | Portimao Blue | Blue | Name | 0 |
| `PIC36` | Dravit Grey | Grey | Name | 0 |
| `PIC38` | Barcelona Blue | Blue | Name | 0 |
| `PIC39` | Lime Rock Grey metallic | Grey | Name | 0 |
| `PIC3D` | Manhattan Green | Green | Name | 0 |
| `PIC3E` | Bernina Grey | Grey | Name | 0 |
| `PIC3N` | Storm Bay | Grey | Curated | 0 |
| `PIC3Z` | Tanzanite Blue | Blue | Name | 0 |
| `PIC49` | BMW Individual Citrine Black metallic | Black | Name | 0 |
| `PIC4A` | Oxide Grey | Grey | Name | 0 |
| `PIC4E` | Sanremo Green | Green | Name | 0 |
| `PIC4F` | Arctic Race Blue | Blue | Name | 0 |
| `PIC4G` | Isle of Man Green | Green | Name | 0 |
| `PIC4H` | Sao Paulo Yellow | Yellow | Name | 0 |
| `PIC4P` | Brooklyn Grey | Grey | Name | 0 |
| `PIC4W` | Skyscraper Grey metallic | Grey | Name | 0 |
| `PIC55` | Sparkling Copper Grey | Grey | Curated; also Copper | 0 |
| `PIC56` | Thundernight | Purple | Curated | 0 |
| `PIC57` | Aventurine Red III metallic | Red | Name | 0 |
| `PIC5L` | BMW Individual Blue Bay Lagoon Metallic | Blue | Name | 0 |
| `PIC67` | Space Silver | Silver | Name | 0 |
| `PIC7A` | Dune Grey metallic | Grey | Name | 0 |
| `PIC7R` | Night Dusk Blue | Blue | Name | 0 |
| `PIL38` | Fame Green metallic | Green | Name | 0 |
| `PIL74` | Velvet Orchid II metallic | Purple | Curated | 0 |
| `PIP28` | Twilight Purple Pearl Effect metallic | Purple | Name | 0 |
| `PIP56` | Signal Green | Green | Name | 0 |
| `PIP5C` | Riviera Blue solid | Blue | Name | 0 |
| `PIP5N` | Verde Mantis solid | Green | Curated | 0 |
| `PIP5T` | BMW Individual Frozen Marina Bay Blue metallic | Blue | Name | 0 |
| `PIP5W` | Miami Blue solid | Blue | Name | 0 |
| `PIP60` | Grey Black solid | Grey | Curated; also Black | 0 |
| `PIP6E` | Verde British Racing solid | Green | Curated | 0 |
| `PIP6F` | Violet Blue II solid | Blue | Curated; also Purple | 0 |
| `PIP6H` | Fashion Grey solid | Grey | Name | 0 |
| `PIP6K` | Nardo Grey solid | Grey | Name | 0 |
| `PIP6L` | Thunder metallic | Grey | Curated | 0 |
| `PIP6M` | Grigio Telesto Pearl Effect Metallic | Grey | Curated | 0 |
| `PIP78` | Burgundy Red Pearl Effect metallic | Red | Name | 0 |
| `PIP79` | Frozen Dark Grey II metallic | Grey | Name | 0 |
| `PIP7B` | Chalk solid | Grey | Curated; also White | 0 |
| `PIP7E` | Fire Orange III solid | Orange | Name | 0 |
| `PIP7G` | Irish Green solid | Green | Name | 0 |
| `PIP7K` | Rosso Corsa non-metallic | Red | Curated | 0 |
| `PIP7L` | Voodoo Blue | Blue | Name | 0 |
| `PIP7P` | Maritime Blue solid | Blue | Name | 0 |
| `PIP7U` | Mahogany II metallic | Brown | Curated | 0 |
| `PIP7V` | Java Green | Green | Name | 0 |
| `PIP80` | BMW Individual Frozen Deep Green metallic | Green | Name | 0 |
| `PIP81` | Stone Grey solid | Grey | Name | 0 |
| `PIP85` | BMW Individual Malachite Green metallic | Green | Name | 0 |
| `PIP86` | Pyrite Brown metallic | Brown | Name | 0 |
| `PIP8T` | BMW Individual Liquid Copper metallic | Copper | Name | 0 |
| `PIP8W` | Daytona Beach Blue solid paint | Blue | Name | 0 |
| `PIP8X` | BMW Individual Frozen Brooklyn Grey metallic | Grey | Name | 0 |
| `PIP8Y` | Atlas Grey metallic | Grey | Name | 0 |
| `PIP92` | Frozen Isle of Man Green metallic | Green | Name | 0 |
| `PIP93` | Sakhir Orange III metallic | Orange | Name | 0 |
| `PIP94` | Singapore Grey metallic | Grey | Name | 0 |
| `PIP9A` | Frozen Purple metallic | Purple | Name | 0 |
| `PIP9B` | Frozen Tampa Bay Green metallic | Green | Name | 0 |
| `PIP9C` | Frozen Preciosa Red metallic | Red | Name | 0 |
| `PIP9D` | BMW Individual Deep Sea Green metallic | Green | Name | 0 |
| `PIP9E` | Borusan Turkish Blue | Blue | Name | 0 |
| `PIP9F` | BMW Individual Frozen Pure Red metallic | Red | Name | 0 |
| `PIP9G` | BMW Individual Frozen Aquamarine metallic | Turquoise | Curated; also Blue, Green | 0 |
| `PIP9L` | Ruby Star (Neo) solid | Pink | Curated; also Purple | 0 |
| `PIP9M` | Petrol Mica metallic | Turquoise | Curated; also Blue, Green | 0 |
| `PIP9P` | Urban green solid | Green | Name | 0 |
| `PIP9R` | Anglesey Green metallic | Green | Name | 0 |
| `PIP9Y` | Frozen Urban Green | Green | Name | 0 |
| `PIR20` | Madeira Red metallic | Red | Name | 0 |
| `PIR61` | Purple Silk metallic | Purple | Name | 0 |
| `PIR71` | Midnight Sapphire II metallic | Blue | Curated | 0 |
| `PIR94` | Dark Emerald metallic | Green | Curated | 0 |
| `PIR95` | Belladonna Purple metallic | Purple | Name | 0 |
| `PIR9D` | Monteverde metallic | Green | Curated | 0 |
| `PIR9L` | Mustique Blue metallic | Blue | Name | 0 |
| `PIS03` | Ruby Red II Pearl Effect metallic | Red | Name | 0 |
| `PIS0A` | Smyrna Green solid | Green | Name | 0 |
| `PIS0F` | Desert Sand | Beige | Curated | 0 |
| `PIS0G` | Midnight Amethyst metallic | Purple | Curated | 0 |
| `PIS0H` | Aventurine Green metallic | Green | Name | 0 |
| `PIS0K` | Viola metallic | Purple | Curated | 0 |
| `PIS0M` | Aurora Diamond Green II metallic | Green | Name | 0 |
| `PIS0N` | Sepia III metallic | Brown | Curated | 0 |
| `PIS0P` | Chilli Red III | Red | Name | 0 |
| `PIS0R` | Legend Grey II metallic | Grey | Name | 0 |
| `PIS0V` | Macao Blue II metallic | Blue | Name | 0 |
| `PIS10` | Malachite Green Dark metallic | Green | Name | 0 |
| `PIS1B` | Fjord Green | Green | Name | 0 |
| `PIT09` | Wildberry metallic | Purple | Curated | 0 |
| `PIT42` | Brewster Green solid | Green | Name | 0 |
| `PIU21` | BMW Individual Brilliant White metallic | White | Name | 0 |
| `PIU80` | Macadamia metallic | Brown | Curated; also Beige | 0 |
| `PIU86` | Nero Fuoco metallic | Black | Curated | 0 |
| `PIU91` | BMW Individual Frozen Black metallic | Black | Name | 0 |
| `PIU96` | Speed Yellow solid | Yellow | Name | 0 |
| `PIW24` | Gunmetal II metallic | Grey | Curated | 0 |
| `PIW32` | Black Blue solid | Blue | Curated; also Black | 0 |
| `PIW37` | Gentian Blue solid | Blue | Name | 0 |
| `PIW65` | St James Red | Red | Name | 0 |
| `PIW67` | Goodwood Green Pearl Effect metallic | Green | Name | 0 |
| `PIW69` | Venezia Violet Pearl Effect metallic | Purple | Name | 0 |
| `PIW81` | Peridot Green metallic | Green | Name | 0 |
| `PIW90` | Chestnut Brown metallic | Brown | Name | 0 |
| `PIW97` | Mint Green solid | Green | Name | 0 |
| `PIX03` | Ruby Black | Black | Name | 0 |
| `PIX16` | Frozen Brilliant White | White | Name | 0 |
| `PIX1E` | Frozen Portimao Blue metallic | Blue | Name | 0 |
| `PIX1G` | Frozen Tanzanite Blue | Blue | Name | 0 |

## Provenance and boundary

- Names, source types, model contexts and description variants: `docs/gcsp/option-preference-matrix-2026-11-11.json`; its SHA-256 is pinned in the policy entry. The original retained BMW observations and archive pointers are linked by that matrix.
- Exact cohort counts: `docs/gcsp/evidence/fucq61/exact10000-closeout-2026-11-07/coverage.json`, `selected10000.dimensions.paint`. All 22 primary codes are mapped.
- The collaborator's supplied screenshot confirms named Individual shade examples and their exact codes; the retained matrix supplies the machine-readable labels.

This change adds the shared lookup data and this review table. It does not add a colour preference, change ranking, rewrite immutable configurations or deploy an application. A future consumer must obtain the mapping through PolicyService and resolve only actual selected codes.

## Validation

Scoped validation passed: **21/21 existing policy-service tests**, with no failures or skips, using bundled Node 24.22.1 and one worker. A real PolicyService read verified the new assumption; source-hash, exact-code-set, allowed-family, Markdown-label/family/count parity and selected-10k accounting checks passed. All pre-existing policy data remains semantically identical. The affected selector could not select this Node/data scope automatically, so the explicit source/service checks were chosen. No new consumer, UI, database write, source refresh or deployment was introduced; a full application suite and browser pass were outside this data-only scope.

Independent data review: Pinky, requested/selected `gpt-6.1-sol` / `high`, no fallback, passed with no blocking or major findings. Exact selected-companion investigation: Melissa Duck, requested/selected `gpt-6-luna` / `high`, no fallback. Both reviews were read-only with no scratch or descendants.

Machine-local evidence is retained under `.claude/test-runs/paint-family-20261111/` (selection plan, validation summary and final receipt), plus the compact impact record in `.claude/test-runs/impact/`. The supervisor removed its one owned test root, `/private/tmp/test-stamp-shard-cef467c5c10944e8aa218781505c3969`, with 966,784 bytes observed peak allocation and 152,780,800 bytes peak process-group RAM. Filesystem absence and process-group teardown were checked after completion. Successful verbose logs were removed; concise summaries remain. No large output, archive, cloud copy, compatibility exception or cleanup leftover was created.
