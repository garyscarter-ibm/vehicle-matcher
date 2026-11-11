# Your cars: "Model not supplied" in Order history (11 Nov)

**Cause:** the seeded returned PCS contract (`historic:<employee>` in `server/gcsp/manual-context/fixtures.js`)
had no `model`, so the history row and its record title fell back to "Model not supplied".

**Fix:** the seed now carries the real car (BMW 1 Series Sports Hatch 120, 120 M Sport, petrol, with the
F70 display image); the client fixture mirrors it. If a model is ever unknown, the row and record say
"Your previous car", "Your current car" or "Your new car" instead (FUCQ-316). Tests:
`gcsp-account-render.test.js` (FUCQ-316 case) and `gcsp-manual-context.test.js` (every seeded history car named).

**Check at 1280** (hosted demo, offline, memory repository, signed in as Paula):

| | Order history row 2 | Record drawer title |
|---|---|---|
| Before (`origin/gcsp-poc` at 3bc0b0eb) | Model not supplied | Model not supplied |
| After | BMW 1 Series Sports Hatch 120 | BMW 1 Series Sports Hatch 120 |

The screenshots and the capture script are outside git, per the evidence rule in `.gitignore`.
Existing runs keep their stored seed; **Start again** reseeds and shows the named car.
