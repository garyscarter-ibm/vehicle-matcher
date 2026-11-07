# Immutable offer preview observation for FUCQ-105

6 November 2026. This is a read-only source integration observation, not an
offer implementation change or a live offer/access/decision result.

Source: GC commit `65f4a911285161b7fc9d3ec303ecfea2175df2d4`,
`blocks/gcsp/offer/preview.html` and its public offer files, over the existing
FUCQ-36 package inputs in disposable scratch. File hashes are retained in
`fucq36-offer-browser/report.json`. No cherry-pick or GC-owned source edit occurred.

The directory-discovered assembler includes the real nested preview without
special block registration. Its own URL and refresh work at both
`/blocks/gcsp/offer/preview.html` and
`/vehicle-matcher/blocks/gcsp/offer/preview.html`, at 1440 and 375 pixels.
`?fixture=pending` remains explicitly synthetic; the unconfigured default says
“Offer not found.” All eight route/module checks pass, with no JavaScript errors,
failed requests, HTTP asset errors or missing images. Removing the packaged
`offer-view.js` produces a failure naming GCSP block `offer`.

Visual acceptance remains incomplete in this source combination. The pending
fixture has `scrollWidth: 1614` at both viewport widths and an unstyled shell with
an oversized navigation icon. Its preview links only `gcsp-offer.css`, which
imports employee composition CSS and the kit tokens; the graph never requests
`blocks/vehicle-matcher/vehicle-matcher.css` or
`blocks/gcsp/shell/gcsp-shell.css`. The existing root employee harness explicitly
links both shared styles. This is an omitted stylesheet composition, not a missing
file in the assembled artifact. The unconfigured unavailable view does not
overflow, but retains the same unstyled shell.

Inspected captures:

- `fucq36-offer-browser/offer-root-1440-pending.png`
- `fucq36-offer-browser/offer-root-375-pending.png`
- `fucq36-offer-browser/offer-prefix-375-unavailable.png`

An earlier harness served SVG as `application/octet-stream`, making the logo
appear broken. Correct MIME types removed that harness defect; it is not a
source finding. The remaining stylesheet/layout observation belongs to the offer
preview's source owner. FUCQ-36's native Decided adds no dependency on later block
stories; this qualified source trial does not turn the absent integrated offer
into a story gate or claim offer acceptance.
