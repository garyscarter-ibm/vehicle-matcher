# Exact retail listing decisions · FUCQ-23

5 November 2026. This is the bounded R1 correction specified by the [shared recommendation design](shared-recommendation-design.md). It does not extract the evaluator or recalibrate retail scoring. The approved current card at `27cf841`, [experience contract](experience-quality.md) and [shared component catalogue](../../COMPONENTS.md) remain the visual reference.

`rankCars()` still calculates every exact decision before grouping. `groupListings()` retains that decision with its exact listing in an additive `decision` object: `score`, `stretch`, `reasons`, `tradeOffs`, and internal `fit`/`taste`. The group retains its existing representative fields, count, price range, feature availability union and sample limit. The exact selected car never inherits that union as fitted equipment.

The shared `matchCard()` paints the selected listing's price, photo, equipment, gearbox, mileage, link and explanation together. A medium card keeps a stretch warning even when it trims positive reasons. Local equipment/colour/gearbox refinement promotes the first surviving listing's server decision and sorts the remaining results by those decisions. Feedback actions, whole-group rejection, undo and reset retain their existing meaning. A different surviving listing cannot retain a taste-leader claim derived from the original member.

With an older compatible backend, an unchanged representative can still use the old top-level decision. Switching or refining to another member without its decision clears unsupported score, reasons, trade-offs and stretch claims. The card states that score and reasons are unavailable. Refinement shows an unscored shortlist without claiming equally good fit or discarding the surviving car. No browser scoring weights or reconstruction are introduced.

## Corrected R1 expectation

The saved [R1 probe](evidence/fucq-7/reuse-probes.mjs) uses two fictional estate listings costing £30,000 and £39,000 with a £25,000–£35,000 budget. Independent existing evaluation gives **96% / within budget** and **87% / stretch**. Selecting the second car must show **£39,000 / 87% / stretch**, its own parking camera, manual gearbox, image state and link; it must not retain the first car's 96% or within-budget reason. Aggregate availability still describes both cars. Filtering to the parking camera produces the same exact result; undo restores the original group.

This intentional behavioral correction is separate from FUCQ-27/28's later evaluator extraction and parity work. Frozen v1 retail expected fixtures remain immutable. Compatibility validation projects only new additive member fields out of the old wire contract and independently tests the new decision payload and corrected R1 behavior; it does not rewrite v1 to conceal a scoring change.

## Repeatable local display trial

Start the existing static server from the repository root with `npm run serve`, then open `http://localhost:3000/components.html`. The **Exact listing decisions** section uses explicitly fictional display data and a labelled representative first photograph. It performs no evaluation, HTTP writes, saved-brief change or reservation. The automated regression separately uses the actual evaluator for the same R1 input.

1. Reset the listing trial. The first car shows £30,000 / 96% and heated seats; the availability summary describes two cars and £30,000–£39,000.
2. Tab to the Chili Red listing and press Enter or Space. Its button remains focused and pressed; the card shows £39,000 / 87% / stretch, parking camera, manual gearbox, its link and the missing-image placeholder.
3. Choose **Parking camera only**. The selected exact decision and equipment remain consistent. Toggle the refinement off or reset to restore both cars.
4. Choose **Older backend**, then select Chili Red or refine to parking camera. Score and reasons become unavailable, while £39,000 and exact facts remain visible. Selecting the original representative restores its supported old fields. Reset returns the new-contract starting state.
5. Repeat at desktop and narrow widths. The long vehicle name wraps; picker controls, focus rings and missing-image fallback remain usable. Existing feedback/rejection/undo and employee fixture examples remain independently available.

The implementation Result records actual browser captures, source identity, inspected states and remaining evidence gaps. A local test or screenshot is not deployment or real-provider verification. The canonical draw.io topology remains unchanged; status recolouring/rendering remains unverified while no existing background diagram tab is available. No foreground or raw-XML workaround is used.
