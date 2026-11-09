# How it works

The whole system on one page. Everything else in `docs/` is the record of *why*
a decision was made; this is *what it does now*. If the two disagree, this file
is wrong — fix it.

## The idea in one sentence

Ask about someone's life, rule out the cars that can't work, rank what's left
on how well it suits them, and be honest about the rest.

## The six steps

**1. Nine questions.** Budget, body style, fuel, charging, use, people,
mileage, style and priorities. (MINI swaps mileage/style for doors and a "vibe"
question.) The question set lives on the server so the copy and count can
change without touching the block.

**2. Rule out what can't work.** Over budget by more than 15%, too few seats
for the family, too small a boot for a crew. This is elimination, not scoring:
these cars never appear.

**3. Score what's left, out of 100.** Two halves, blended **80/20**:

- **Fit (80%)** — does it actually suit them: budget, body, fuel, practicality,
  economy, size.
- **Taste (20%)** — would they like it: character, performance, trim. Driven by
  the `priorities` answer.

The split exists because a single blended score couldn't tell a *requirement*
("must be a convertible") from a *preference* ("I like comfort"), and kept
failing in one direction or the other. The 20% is fixed so preferences can't be
squeezed out when a constraint is made to bind harder.

**4. Collapse repeat listings.** Four identical iX2s are one car the retailer
has four of, not four choices. They become one card carrying the spread:
"4 available · £31,498–£36,890 · Portimao Blue, Brooklyn Grey or Alpine White".

**5. Say which situation this is.** One ranked list, in two groups: the
retailer's own cars, then everyone else's, sorted by score inside each. Each
card also says where it is ("At Grassicks Garage", "23 miles away · Arnold
Clark Kirkcaldy").

The groups are labelled by **place** and never by quality — "AT GRASSICKS BMW",
"AT OTHER RETAILERS". That rule is what keeps the page honest: a place label
can't contradict a score, so a 99% in the second group contradicts nothing in
the first. A caption that ranked ("Close, but not level with the cars above")
could, and did.

The page has one honest thing to say per situation, derived from the
**retailer's** cars, re-derived every time the buyer narrows:

| Situation | What the page says |
|---|---|
| One car clearly wins | "Your perfect BMW is the X7." |
| Several tie, their priorities favour one | "We'd go for the Countryman C. A few of these fit just as well." |
| Several genuinely tie | "It's a six-way tie." — then chips to narrow by colour, kit, gearbox |
| The best car misses something they asked for | "The closest matches at Grassicks." — and each card says what it misses |
| **…and isn't close either** | **"Nothing at Grassicks BMW is close to what you asked for."** — the cards stay, nothing above them calls one a match |
| That thing exists, but not here | "No convertibles at Grassicks. The nearest is 18 miles away." |
| Nothing fits at all | "No matches found." — plus what's nearby |

The low-confidence state is the one that decides what kind of tool this is. It
fires only over a leader that already misses a stated want (saying "nothing
matches your brief" about a car that meets every stated want would be false) and
only below `WEAK_SCORE`. The working note then carries the arithmetic — "the
best of them reached 67%" — so the headline is the verdict and the note is the
evidence, rather than the two saying the same thing twice.

The headline names the retailer **only when a car elsewhere actually beats the
best one here** ("Your perfect MINI at Sytner Luton is…"), and then a line
above the cards names that car and how far away it is. A tie doesn't trigger
it: ties break local-first, so an equal car hasn't earned the qualification.
Distance is not, and never will be, in the score — see
`results-page-review.md`.

The chips sit **above** the cards (a control belongs next to what it controls)
and the running brief sits **below** them (a summary belongs after).

**6. Pick the actual car.** Once it's down to one model, the buyer chooses
which of the retailer's copies — colour, price, mileage. The spec line follows
that choice, because gearbox and paint are properties of one car rather than of
the model: it states body, fuel, **gearbox**, paint, price, **seats**, **boot
in litres with the seats up**, 0-62 and economy. The boot qualifier is
deliberate — an unqualified litre figure is the kind of claim buyers discount.

That's it. Constraints eliminate, fit ranks, taste chooses the model, the buyer
chooses the car.

## The numbers you can turn

Six, all in the retail policy `server/scenarios/retail/used-retail-v1.js` (`server/engine.js` re-exports them; `STRETCH_FACTOR` lives in `server/scenarios/retail/dimensions.js`):

| Constant | Now | What it does |
|---|---|---|
| `STRETCH_FACTOR` | 1.15 | How far over budget a car may still appear |
| `TASTE_SHARE` | 0.2 | How much of the score is preference rather than suitability |
| `CLUSTER_PTS` | 3 | Within how many points cars count as "tied" |
| `TASTE_PTS` | 6 | How far ahead on taste before we'll name a winner inside a tie |
| `TOP_MATCHES` | 3 | Cards shown when one car clearly wins |
| `MAX_SHOWN` | 6 | Cap on cards shown in a tie |
| `GRACE_MS` | 1500 | How long the first paint waits for the nearby search (block-side) |

The page holds its own copy of `CLUSTER_PTS` (blocks/bmw-matcher), because it
re-decides which situation it is in after every chip and rejection rather than
trusting the server's first verdict. Keep the two in step.

Three more live only in the page, because they are about what it is willing to
show and say rather than about scoring. Each is measured, and each carries its
measurement in a comment above it:

| Constant | Now | What it does |
|---|---|---|
| `RELEVANT_PTS` | 10 | How far behind the best car on the page a car may be and still be worth showing |
| `WEAK_SCORE` | 68 | Below this, and missing something asked for, the page says nothing here is close (`npm run audit conf`) |
| `KIT_SHOWN` | 6 | Equipment named on a card before the rest is counted |

Per-brand weights and thresholds live in `server/brands.js`.

## How to check you haven't broken it

```sh
npm run audit stick    # do the questions change the answer?
npm run audit fuel     # does a named fuel actually bind?
npm run audit sens     # diversity and body-style honesty
npm run audit taste    # is TASTE_PTS set anywhere useful?
npm run audit conf     # where does "nothing here is close" begin?
npm run personas       # all eight personas end to end
cd server && npm test  # 61 unit tests
```

The audits replay the real engine over a national stock snapshot. Any tuning
change should be measured with them before and after — that's how every change
in this repo was justified, and how two of them were caught being wrong.

## Where the code lives

| File | Job |
|---|---|
| `server/scenarios/retail/` | The used-retail-v1 policy: scoring, grouping, clustering, over the shared pure core in `server/recommendation/`. `server/engine.js` is its compatibility facade. The whole brain. |
| `server/brands.js` | Per-brand weights and tuning. BMW and MINI differ only here. |
| `server/questions.js` | The question set. |
| `server/stock.js` | Live retailer feed, plus paint fetched per shown car. |
| `server/mapping.js` | Feed vehicle → the shape the engine scores. |
| `blocks/bmw-matcher/` | The EDS block: quiz, results, refine, reject. |

## Which doc to read when

Most of `docs/` is history. The ones worth opening:

- **This file** — what it does.
- `personas.md` — who it's for.
- `same-car-investigation.md` — why the engine works the way it does now.
- `results-page-states.md` — why the page says what it says.
- `tone-style-guide.md` — how each brand speaks.

The rest are decision records: useful when you want to know *why* something is
the way it is, not what it currently does.
