# Vehicle offer concept · FUCQ-380

Static screens for design discussion. Start at `index.html`; ordinary links open the accept/decline drawers, gallery views and outcome screens. `accept-validation.html`, `decline-validation.html` and `expired.html` show separate fixed states. No scripts, countdown, saving, submission or decision logic. The declaration boxes, reason selection and comment are painted states. The initial acceptance drawer has three unchecked declarations and a disabled final Accept; the accepted screen is separately accessible in the state navigation. Documents are short layout copy, not approved scheme wording.

- Timer is **2:00 = two hours**, shown in hours:minutes. Expired is **0:00**. The deadline is illustrative.
- Uses the shared Density heading font, palette and slim portal shell. Drawer sizing/padding follow the current Your cars View record component. The offer uses the full available content width, capped at 1680px.
- Current vehicle is a BMW 320i M Sport Touring; offered vehicle is a BMW 330e M Sport Touring. Car identity, 295/320 points, collection, fitted options and personal details are illustrative visual content. The plug-in hybrid's 410L boot versus 500L makes the drawback clear. These are not verified exact vehicle specifications.
- Options shown side by side are candidates for discussion: heated seats, parking assistance, head-up display, panoramic roof, audio and towbar. The user has not selected which options or differences matter most. Decide those priorities before specification or implementation.
- The concise contact, return and declaration content lives in the acceptance fly-out. Accept and decline are directly visible before the gallery on narrow screens.

## Images

All views show the BMW 3 Series Touring model family. They do not establish the fitted options or appearance of an exact offered vehicle.

- Front: existing local `assets/gcsp-vehicle-evidence/07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp`. Provenance: `server/data/gcsp/vehicle-evidence/display-images.sources.json`, G21, Alpine White P0300, BMW configurator FRONTLEFT render, retained 10 November 2026. This is a genuine front three-quarter view.
- Rear: `assets/rear.jpg`, BMW UK product imagery, `https://bmw.scene7.com/is/image/BMW/g21_ice_touring_ext_open-rear-window:3to2?fmt=jpg&wid=1000&fit=constrain%2C1`. Genuine rear three-quarter with rear window open.
- Interior: `assets/interior.jpg`, BMW UK product imagery, `https://bmw.scene7.com/is/image/BMW/g21_ice_touring_int_dashboard:3to2?fmt=jpg&wid=1000&fit=constrain%2C1`. Genuine cockpit/dashboard view.
- Source page: `https://www.bmw.co.uk/en/all-models/3-series/3-series-touring/3-series-touring-g21-ice-lci.html`, retrieved 11 November 2026. BMW UK product imagery, no explicit reuse licence stated; static design discussion only.

The local display corpus contained only FRONTLEFT/HEROFRONT images. Rear and interior were sourced separately instead of relabelling the same view.

Review corrections: all three incumbent declarations are preserved. The old contract ends 1 December 2026 and recorded mileage is 5,200 miles; expected return mileage is unknown and shown separately as To confirm in the validation state. Actual driver/licence details and expected mileage must be provided before a real acceptance can be completed. Paint/upholstery and all vehicle facts remain visible below the gallery on narrow screens. Decision consequences stay beside their confirmation buttons.
