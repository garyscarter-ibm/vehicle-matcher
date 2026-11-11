# Stock derivative reference facts, 11 November 2026

FUCQ-399, originating in FUCQ-371. `server/gcsp/stock/demo-provider.js` supplies the existing model-reference inputs to generated synthetic stock. The retained `demo-fleet.v1` corpus has unknown catalogue acceleration for every mapped derivative except i5; it contains no MPG measurement. This repair fills the existing table rather than changing scoring or the better-than-current-car gate.

Native search was used first; Parallel Search resolved the two changed Coupe/Touring page paths and supplied the remaining full-table extracts when native snippets were insufficient. Sources are BMW's public UK technical pages, observed 11 November 2026, for the current F70/G42/G21/U11/U10/G26 range. The pages do not identify an exact production model year for every selector. Applying those derivative references to the retained 2026 scenario configurations is an explicit scenario assumption, not exact build-sheet evidence. Stock retains its existing `synthetic-scenario` provenance; insurance groups, tags and release facts remain scenario assumptions. Existing saloon/Touring 320i and i5 inputs are unchanged, including the retained authoritative i5 acceleration evidence.

BMW labels the PHEV discharged-battery row `l/100 mpg`; its displayed UK values are retained as MPG, consistent with the surrounding UK fuel data. Acceleration is BMW's 0–62 mph figure, in seconds. MPG is Imperial, using the **lowest published WLTP combined MPG across the current listed trim range** for a derivative (M240i uses the current 392 hp reference, 35.3, rather than the older 374 hp row). This conservative range endpoint is a reference convention, not a configuration-specific measurement. PHEVs use **WLTP combined with discharged battery**, not weighted combined consumption; the current Economy scorer already handles plug-in fuels separately. EV MPG remains absent. Unknown derivative keys still return no model facts.

| Eligibility derivative | 0–62 s | MPG input | BMW source |
| --- | ---: | ---: | --- |
| F70 Sports Hatch 120 | 7.8 | 48.7 | [1 Series technical data](https://www.bmw.co.uk/en/all-models/1-series/1-series-5doors/bmw-1-series-technical-data.html) |
| F70 Sports Hatch M135 xDrive | 4.9 | 34.4 | Same 1 Series page |
| G42 Coupe 220i | 7.5 | 41.5 | [2 Series Coupe technical data](https://www.bmw.co.uk/en/all-models/2-series/2-series-coupe/bmw-2-series-coupe-technical-data.html) |
| G42 Coupe 230i | 5.9 | 40.4 | Same 2 Series page |
| G42 Coupe M240i xDrive | 4.3 | 35.3 | Same 2 Series page |
| G21 Touring 330e | 6.0 | 37.7, discharged | [3 Series Touring technical data](https://www.bmw.co.uk/en/all-models/3-series/3-series-touring/bmw-3-series-touring-phev-technical-data.html) |
| G21 Touring M340i xDrive | 4.5 | 36.7 | [3 Series Touring M technical data](https://www.bmw.co.uk/en/all-models/3-series/3-series-touring/bmw-3-series-touring-phev-technical-data.html) |
| U11 X1 sDrive18d | 8.9 | 52.3 | [X1 technical data](https://www.bmw.co.uk/en/all-models/x-models/x1/bmw-x1-technical-data.html) |
| U11 X1 sDrive20i | 8.3 | 46.3 | Same X1 page |
| U11 X1 xDrive23d | 7.4 | 56.5 | Same X1 page |
| U11 X1 xDrive23i | 7.1 | 41.5 | Same X1 page |
| U11 X1 xDrive25e | 6.8 | 43.5, discharged | Same X1 page |
| U11 X1 xDrive30e | 5.6 | 43.5, discharged | Same X1 page |
| U11 X1 M35i xDrive | 5.4 | 35.8 | Same X1 page |
| U11 iX1 eDrive20 | 8.6 | Not applicable | [iX1 technical data](https://www.bmw.co.uk/en/all-models/x-models/x1/bmw-x1-technical-data.html) |
| U11 iX1 xDrive30 | 5.6 | Not applicable | Same X1 page, electric selectors |
| U10 X2 sDrive20i | 8.3 | 44.8 | [X2 technical data](https://www.bmw.co.uk/en/all-models/x-models/X2/bmw-x2-technical-data.html) |
| U10 X2 M35i xDrive | 5.4 | 34.4 | Same X2 page |
| U10 iX2 eDrive20 | 8.6 | Not applicable | [iX2 technical data](https://www.bmw.co.uk/en/all-models/x-models/X2/bmw-x2-technical-data.html) |
| U10 iX2 xDrive30 | 5.6 | Not applicable | Same X2 page, electric selectors |
| G26 i4 eDrive35 | 6.0 | Not applicable | [BMW UK comparison, eDrive35](https://www.bmw.co.uk/en/compare-bmw-models.html/4/G26/I4SF/A/content.q) |
| G26 i4 eDrive40 | 5.6 | Not applicable | [BMW UK comparison, eDrive40](https://www.bmw.co.uk/en/compare-bmw-models.html/i/G26E/I4ME/A/content.q) |

Coverage: these 22 repaired derivatives plus unchanged G21 320i and G61 i5 eDrive40 cover all 24 `stock.eligibilityModelKeys.v1` entries. No new fallback or family-wide acceleration is introduced. The regression reads real generated stock, checks every mapped derivative, proves positive-rating Sportiness/Economy gains through `createEmployeeRecommendationService`, and removes each input to prove the strict unknown-fact gate remains effective. Account-to-Offer presentation validation is recorded separately in the repair delivery evidence.
