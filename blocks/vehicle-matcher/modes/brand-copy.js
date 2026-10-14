/*
 * Brand voice for the result surfaces, shared by every mode that shows a car.
 *
 * Lifted out of modes/questionnaire.js when a second mode (podium) needed the
 * same vocabulary. This is the *card and results* voice: the marque name, the
 * intro/result headlines, and the words each brand uses for a fuel or a shape.
 * It is deliberately NOT a mode's own campaign copy: a mode's wordmark, seed
 * screen and reveal lines live in that mode's own table (MINGLE_COPY,
 * KNOCKOUT_COPY, PODIUM_COPY), because those are the parts that differ per
 * interface. Anything a card renders lives here, so two modes cannot drift into
 * describing the same car two different ways.
 *
 * Voices follow docs/tone-style-guide.md.
 */

import { cardinal } from '../ui.js';

/** Brand-specific display copy, keyed by brand. `name` is the marque, `title`
 * the intro headline, `cta` the intro button. `lede({ questions, retailer })`
 * builds the intro paragraph — a function because the two brands phrase it
 * differently, not just swap nouns.
 *
 * The question count is passed in rather than written into the copy (brands
 * have different totals, and a brand gaining a question needs no copy edit).
 * Deliberately no match count anywhere: results show one clear winner or the
 * whole tie, so any promised number would be wrong half the time.
 *
 * Voices follow docs/tone-style-guide.md: BMW is assured and understated (the
 * flat, unapologetic close borrowed from bmw.co.uk's register), MINI keeps the
 * warmth but smiles. Deliberately no "quiz" anywhere — this is a matcher, and
 * the word undersold it. */
export const BRAND_COPY = {
  bmw: {
    name: 'BMW',
    title: 'Find your perfect BMW.',
    cta: 'Find my BMW',
    // No promised count: results now show one clear winner or the whole tie
    // (up to MAX_SHOWN), so naming a number here would be wrong half the time.
    lede: ({ questions, retailer }) => `${questions} quick questions about your life, `
      + `your miles and your budget. We’ll match you with the `
      + `vehicles at ${retailer} that suit you best, and tell you why.`,
    // Approved Used's no-surprises register: state the fact, name the
    // retailer, don't dress it up (docs/tone-style-guide.md). No label —
    // BMW's copy states things rather than announcing them.
    unmet: ({ list, retailer }) => `No ${list} at ${retailer} or nearby right now. `
      + 'These are the closest matches to everything else you asked for.',
    // Shown instead of the "your perfect BMW is…" headline when the engine
    // can't separate the top cars (see matchCars: decisive/clusterSize).
    // Stated plainly, as a fact about the stock rather than an apology.
    tiedTitle: ({ count }) => `${cardinal(count)} of these fit you equally well.`,
    /*
     * The scoped headlines, used ONLY when the scope is load-bearing: a car at
     * another retailer genuinely outranks the best one here. Everywhere else
     * the unqualified line stands, because a qualification that isn't doing
     * work is just a smaller claim (docs/results-page-review.md).
     *
     * `retailer` names the pool that was actually searched — for BMW and MINI
     * the national approved-used programme, since stock.js walks the whole feed
     * rather than one dealer's slice. So "at BMW Approved Used" is not a hedge,
     * it's a more accurate statement of what was searched. A higher score in the
     * group below then contradicts nothing, because the headline never claimed
     * to be about that group.
     */
    tiedTitleHere: ({ count, retailer }) => `At ${retailer}, ${cardinal(count)} of these `
      + 'fit you equally well.',
    // Fit couldn't separate them, but what they told us matters could. Naming
    // the pick is honest here, and it's what finally makes the preference
    // questions capable of changing the recommendation.
    tasteTitle: ({ model }) => `Your best match is the ${model}.`,
    tasteTitleHere: ({ model, retailer }) => `Your best match at ${retailer} is the ${model}.`,
    tasteLede: () => 'Several of these suit you equally well on paper. This one lines up '
      + 'best with what you said matters.',
    // The retailer is named on every card (the dealer holding that car), so the
    // lede doesn't repeat it — and a brand plural appended to the pool label
    // reads "MINI Approved Used MINIs", which is why neither brand's copy
    // builds one.
    tiedLede: () => 'On your answers we can’t split them: each suits you as well as the next. '
      + 'The difference now is which you prefer the look of.',
    /*
     * The refine panel: BMW states the instruction, no exclamation, no
     * cheerleading (docs/tone-style-guide.md).
     *
     * The label names the effect AND the set it acts on. "So, what do you
     * fancy?" / "Narrow it down" were invitations that never said what a tap
     * would change, and the owner's report of the chips was exactly that: it's
     * "unclear what clicking them affects". That is a labelling problem as much
     * as a positioning one, so both were fixed.
     */
    refineLabel: ({ count }) => (count > 1 ? `Narrow these ${count} down` : 'Narrow this one down'),
    // Feedback at the control itself, the moment a chip goes on. The running
    // brief below the cars says the same thing at more length, but it is below
    // the cars — by the time you reach it you have already stopped wondering
    // whether the tap did anything.
    refineStatus: ({ shown, wants }) => (shown === 1
      ? `One car still matches, with ${wants}.`
      : `${shown} cars still match, with ${wants}.`),
    refineStatusPlain: ({ shown }) => (shown === 1
      ? 'One car still matches.'
      : `${shown} cars still match.`),
    refineEmpty: ({ wants }) => `Nothing here has ${wants} together. `
      + 'Drop one of those and we’ll show you what does.',
    refineEmptyHidden: 'That’s all of them ruled out. Bring one back, or start over.',
    tiedEmptyTitle: 'Nothing left to show.',
    // Rejection, in the retailer's plain register — a question, not a plea.
    rejectOpen: 'Not this one',
    rejectPrompt: 'What put you off?',
    rejectJust: 'Just not this one',
    pickLabel: 'Choose yours',
    kitLabel: 'What’s fitted',
    kitMore: ({ count }) => `, and ${count} more`,
    briefLabel: 'What I’ve picked up',
    hiddenChip: ({ count }) => `${count} ruled out`,
    // The "closest here" frame (docs/results-page-states.md): the local cars
    // miss something the buyer asked for, so no headline may crown one. First
    // paint must be true whether or not the nearby tier later finds the real
    // thing — this claims nothing beyond this retailer's stock.
    closestTitle: ({ retailer }) => `The closest matches at ${retailer}.`,
    closestLede: () => 'Nothing here ticks every box you gave us. Each card says what it '
      + 'gets right, and what it doesn’t.',
    closestSettled: ({ model }) => `Your closest match here is the ${model}.`,
    closestSettledHere: ({ model, retailer }) => `Your closest match at ${retailer} is the ${model}.`,
    /*
     * One step below `closest`: not "here is the nearest we have" but "we have
     * not got it" (see WEAK_SCORE). Approved Used's register does this well
     * without help — state the fact, name the retailer, don't soften it and
     * don't apologise for it. No `Here` variant: the sentence names the
     * retailer already, exactly as the closest frame's does.
     */
    weakTitle: ({ retailer }) => `Nothing at ${retailer} is close to what you asked for.`,
    weakLede: () => 'These are the nearest we hold, and each one misses something you '
      + 'said mattered. If none of them works, nothing here does.',
    // The rescue note: the want is missing HERE but met nearby — by owner
    // decision (2026-07-22) the local cards keep the lead and this note
    // carries the fact, so the buyer weighs proximity against fit themselves.
    // The rescue note points at the list, not at a section: nearby cars are
    // IN the list now, wherever their score puts them.
    rescueNote: ({ list, retailer, miles, where }) => `No ${list} at ${retailer} right now. `
      + `The nearest is ${miles} away at ${where}, and it’s in the list below.`,
    // Only `empty` survives: state 5, where the retailer had nothing and the
    // nearby cars are the results rather than a band beneath them.
    driveLede: {
      empty: ({ retailer }) => `Nothing at ${retailer} fits those answers, so these are the `
        + 'closest matches at other retailers instead.',
    },
    /*
     * The two group labels. They describe PLACE and nothing else.
     *
     * That is the whole rule the old banded page broke: "Close, but not level
     * with the cars above" and "two of these fit you equally well" were both
     * quality claims on the same scale, made by different sections, so one
     * could contradict the other. "At BMW Approved Used" asserts nothing about
     * fit, so it cannot contradict a higher score in the group below it. Same
     * reason the old "NEXT BEST" heading had to go: it ranked.
     */
    hereHeading: ({ retailer }) => `AT ${retailer.toUpperCase()}`,
    awayHeading: 'AT OTHER RETAILERS',
    rejectHint: 'Turned down? We’ll bring the next one up.',
    // The working. A verdict with no evidence behind it reads as thin stock
    // rather than as a clear winner, especially on a page holding one card.
    searchingNearby: 'Still checking other retailers within reach',
    workingLabel: 'HOW WE GOT HERE',
    working: ({ total, eligible }) => `We went through all ${total} BMWs in stock here. `
      + `${eligible} were in budget and big enough for you.`,
    workingMargin: ({ margin }) => ` Nothing else here came within ${margin} points.`,
    // The evidence for the weak headline, and the one number on the page a
    // reader can check against the badges on the cards.
    workingWeak: ({ top }) => ` The best of them reached ${top}%.`,
    // What the badge means, said once. It has been unexplained since fit and
    // taste were split, and several cards can carry the same number, which
    // reads as a bug rather than as a claim about how alike they are.
    workingScore: ' A match score is how well a car fits your answers, nothing else, '
      + 'so cars that suit you equally share one.',
    // The other half of a scoped headline: which car beat the one here, and
    // where it is. Shown exactly when the headline scopes, so the two read as
    // one statement rather than repeating each other.
    searchedWider: ({ model, miles, where }) => 'We looked further afield too. '
      + `The ${model} at ${where} scores higher, and it’s ${miles}.`,
  },
  mini: {
    name: 'MINI',
    title: 'Find your perfect MINI.',
    cta: 'Let’s find your MINI',
    lede: ({ questions, retailer }) => `${questions} quick questions about your life, `
      + `your miles and your money. We’ll find the vehicles at ${retailer} `
      + 'with your name on them, and tell you exactly why.',
    // Same fact, MINI's register: the UPPERCASE-with-a-full-stop beat as the
    // lead-in, then warm and plain. A shortage is a shrug, never a shrug-off.
    unmetLabel: 'SMALL SNAG.',
    unmet: ({ list, retailer }) => `No ${list} at ${retailer} or anywhere nearby right now. `
      + 'Here’s the closest we’ve got to the rest of your brief.',
    // Same fact in MINI's register: a tie is a nice problem, not a shortfall.
    tiedTitle: ({ count }) => `It’s a ${cardinal(count)}-way tie.`,
    // Scoped, same rule as BMW's: only when a car elsewhere actually outranks
    // the best one here.
    tiedTitleHere: ({ count, retailer }) => `At ${retailer}, it’s a ${cardinal(count)}-way tie.`,
    tasteTitle: ({ model }) => `We’d go for the ${model}.`,
    tasteTitleHere: ({ model, retailer }) => `At ${retailer}, we’d go for the ${model}.`,
    tasteLede: () => 'A few of these fit your brief just as well. This one’s the most you.',
    tiedLede: () => 'They all fit what you told us, just as well as each other. '
      + 'So it comes down to taste now. Which is the fun bit.',
    // MINI asks rather than instructs, and treats a dead end as a shrug. Same
    // change as BMW's: the label now names what a tap does and to how many.
    refineLabel: ({ count }) => (count > 1
      ? `Fancy narrowing these ${count} down?`
      : 'Fancy narrowing this one down?'),
    refineStatus: ({ shown, wants }) => (shown === 1
      ? `One left in the running, with ${wants}.`
      : `${shown} left in the running, with ${wants}.`),
    refineStatusPlain: ({ shown }) => (shown === 1
      ? 'One left in the running.'
      : `${shown} left in the running.`),
    refineEmpty: ({ wants }) => `Ah. Nothing here has ${wants} all at once. `
      + 'Let one of them go and we’ll show you what’s left.',
    refineEmptyHidden: 'Well, that’s the lot ruled out. Bring one back, or start over.',
    tiedEmptyTitle: 'That’s the lot, then.',
    rejectOpen: 'Not this one',
    rejectPrompt: 'Go on then, what’s wrong with it?',
    rejectJust: 'Just not feeling it',
    pickLabel: 'Which one, then?',
    kitLabel: 'What’s on it',
    kitMore: ({ count }) => `, and ${count} more`,
    briefLabel: 'So, what I know so far',
    hiddenChip: ({ count }) => `${count} ruled out`,
    // The "closest here" frame, MINI register: honest shrug, no apology.
    closestTitle: ({ retailer }) => `The closest we’ve got at ${retailer}.`,
    closestLede: () => 'None of these is the whole wish list, but they’re close. '
      + 'And each one owns up to what’s missing.',
    closestSettled: ({ model }) => `Closest to your brief: the ${model}.`,
    closestSettledHere: ({ model, retailer }) => `Closest to your brief at ${retailer}: `
      + `the ${model}.`,
    // The same "we have not got it" as BMW's, in MINI's register: a shrug that
    // still gives a straight answer, and a reason to come back rather than an
    // apology. See WEAK_SCORE for when it fires.
    weakTitle: ({ retailer }) => `We haven’t got your MINI at ${retailer} right now.`,
    weakLede: () => 'Here’s the nearest we’ve got anyway, but none of them is it. '
      + 'Stock turns over quickly, so it’s worth another look soon.',
    rescueLabel: 'NOT HERE, BUT NOT FAR.',
    rescueNote: ({ list, miles, where }) => `No ${list} at ours right now. `
      + `The nearest is ${miles} away at ${where}, and it’s in the list below.`,
    driveLede: {
      empty: () => 'Nothing at ours fits that brief. These nearby MINIs get closest.',
    },
    // Place, never quality — see the BMW pair above for why that rule exists.
    // MINI's headings carry the full stop; BMW's don't.
    hereHeading: ({ retailer }) => `AT ${retailer.toUpperCase()}.`,
    awayHeading: 'ALSO WITHIN REACH.',
    rejectHint: 'Not feeling it? We’ll bring the next one up.',
    searchingNearby: 'Still having a look further afield',
    workingLabel: 'HOW WE GOT THERE',
    working: ({ total, eligible }) => `We looked at all ${total} MINIs in stock here. `
      + `${eligible} were in budget and roomy enough.`,
    workingMargin: ({ margin }) => ` Nothing else here got within ${margin} points.`,
    workingWeak: ({ top }) => ` The best of the lot got to ${top}%.`,
    workingScore: ' A match score is how well a MINI fits your answers, nothing else, '
      + 'so ones that suit you equally share a number.',
    searchedWider: ({ model, miles, where }) => 'We had a look further afield, too. '
      + `The ${model} at ${where} comes out ahead, and it’s ${miles}.`,
  },
};

/*
 * Honda's voice: plain, warm and practical, sentence-case throughout. It sits
 * between BMW's terse authority and MINI's uppercase play — it talks about
 * running costs, space and reliability rather than driving pleasure or kerb
 * appeal, and it never oversells (see docs/tone-style-guide.md). Built on the
 * BMW base (spread first) so every key is present — the resolver is all-or-
 * nothing, BRAND_COPY[brand] || BRAND_COPY.bmw — then only the lines that carry
 * Honda's marque or register are overridden. No em dashes in any of it.
 */
BRAND_COPY.honda = {
  ...BRAND_COPY.bmw,
  name: 'Honda',
  title: 'Find the right Honda for you.',
  cta: 'Find my Honda',
  // Honda's plain, practical register: no superlative ("best"), lead on the
  // sensible fit (life, running, budget). The approved-used reassurance comes
  // from the retailer label itself, so the lede doesn't restate it.
  // See docs/tone-style-guide.md (Honda).
  lede: ({ questions, retailer }) => `${questions} quick questions about your days, `
    + 'your mileage and what you want to spend. We’ll find the '
    + `vehicles at ${retailer} that genuinely suit how you live, and show our working.`,
  unmet: ({ list, retailer }) => `No ${list} at ${retailer} or nearby right now. `
    + 'These are the closest to everything else you told us.',
  tiedTitle: ({ count }) => `${cardinal(count)} of these fit you just as well.`,
  tiedTitleHere: ({ count, retailer }) => `At ${retailer}, ${cardinal(count)} of these `
    + 'fit you just as well.',
  tasteTitle: ({ model }) => `Your best match is the ${model}.`,
  tasteTitleHere: ({ model, retailer }) => `Your best match at ${retailer} is the ${model}.`,
  tasteLede: () => 'A few of these suit you equally well on paper. This one lines up '
    + 'best with what you said matters most.',
  tiedLede: () => 'On your answers we can’t separate them: each suits you as well as '
    + 'the next. It comes down to which you prefer the look of.',
  refineLabel: ({ count }) => (count > 1 ? `Narrow these ${count} down` : 'Narrow this one down'),
  refineStatus: ({ shown, wants }) => (shown === 1
    ? `One car still fits, with ${wants}.`
    : `${shown} cars still fit, with ${wants}.`),
  refineStatusPlain: ({ shown }) => (shown === 1 ? 'One car still fits.' : `${shown} cars still fit.`),
  refineEmpty: ({ wants }) => `Nothing here has ${wants} together. `
    + 'Drop one of those and we’ll show you what does.',
  refineEmptyHidden: 'That’s all of them ruled out. Bring one back, or start over.',
  tiedEmptyTitle: 'Nothing left to show.',
  rejectOpen: 'Not this one',
  rejectPrompt: 'What put you off?',
  rejectJust: 'Just not this one',
  pickLabel: 'Choose yours',
  kitLabel: 'What’s fitted',
  briefLabel: 'What I’ve picked up',
  closestTitle: ({ retailer }) => `The closest matches at ${retailer}.`,
  closestLede: () => 'Nothing here ticks every box you gave us. Each card says what it '
    + 'gets right, and what it doesn’t.',
  closestSettled: ({ model }) => `Your closest match here is the ${model}.`,
  closestSettledHere: ({ model, retailer }) => `Your closest match at ${retailer} is the ${model}.`,
  weakTitle: ({ retailer }) => `Nothing at ${retailer} is close to what you asked for.`,
  weakLede: () => 'These are the nearest we hold, and each one misses something you '
    + 'said mattered. If none of them works, nothing here does.',
  rescueNote: ({ list, retailer, miles, where }) => `No ${list} at ${retailer} right now. `
    + `The nearest is ${miles} away at ${where}, and it’s in the list below.`,
  driveLede: {
    empty: ({ retailer }) => `Nothing at ${retailer} fits those answers, so these are the `
      + 'closest matches at other retailers instead.',
  },
  hereHeading: ({ retailer }) => `AT ${retailer.toUpperCase()}`,
  awayHeading: 'AT OTHER RETAILERS',
  rejectHint: 'Turned down? We’ll bring the next one up.',
  searchingNearby: 'Still checking other retailers within reach',
  workingLabel: 'HOW WE GOT HERE',
  working: ({ total, eligible }) => `We went through all ${total} Hondas in stock here. `
    + `${eligible} were in budget and big enough for you.`,
  workingMargin: ({ margin }) => ` Nothing else here came within ${margin} points.`,
  workingWeak: ({ top }) => ` The best of them reached ${top}%.`,
  workingScore: ' A match score is how well a car fits your answers, nothing else, '
    + 'so cars that suit you equally share one.',
  searchedWider: ({ model, miles, where }) => 'We looked further afield too. '
    + `The ${model} at ${where} scores higher, and it’s ${miles}.`,
};

/*
 * Ford copy. Built the same all-or-nothing way as Honda's: spread the complete
 * BMW base so every key resolves, then override only the lines that carry Ford's
 * marque or its register. Ford's voice is confident, friendly and plainly
 * British — proud of being the sensible, well-priced choice, but with a real
 * spirited streak (ST, Mustang) it's allowed to enjoy. No em dashes anywhere.
 */
BRAND_COPY.ford = {
  ...BRAND_COPY.bmw,
  name: 'Ford',
  title: 'Find the right Ford for you.',
  cta: 'Find my Ford',
  // Ford's confident, friendly, plainly-British register: upbeat and direct,
  // proud of being the sensible, well-priced choice with room for the spirited
  // side. See docs/tone-style-guide.md (Ford).
  lede: ({ questions, retailer }) => `${questions} quick questions about your life, `
    + 'your miles and your budget. We’ll pull together the '
    + `vehicles at ${retailer} that make real sense for you, and back it up with the reasons.`,
  unmet: ({ list, retailer }) => `No ${list} at ${retailer} or nearby right now. `
    + 'These are the closest to everything else you told us.',
  tiedTitle: ({ count }) => `${cardinal(count)} of these fit you just as well.`,
  tiedTitleHere: ({ count, retailer }) => `At ${retailer}, ${cardinal(count)} of these `
    + 'fit you just as well.',
  tasteTitle: ({ model }) => `Your best match is the ${model}.`,
  tasteTitleHere: ({ model, retailer }) => `Your best match at ${retailer} is the ${model}.`,
  tasteLede: () => 'A few of these suit you equally well on paper. This one lines up '
    + 'best with what you said matters most.',
  tiedLede: () => 'On your answers we can’t separate them: each suits you as well as '
    + 'the next. It comes down to which you prefer the look of.',
  refineLabel: ({ count }) => (count > 1 ? `Narrow these ${count} down` : 'Narrow this one down'),
  refineStatus: ({ shown, wants }) => (shown === 1
    ? `One car still fits, with ${wants}.`
    : `${shown} cars still fit, with ${wants}.`),
  refineStatusPlain: ({ shown }) => (shown === 1 ? 'One car still fits.' : `${shown} cars still fit.`),
  refineEmpty: ({ wants }) => `Nothing here has ${wants} together. `
    + 'Drop one of those and we’ll show you what does.',
  refineEmptyHidden: 'That’s all of them ruled out. Bring one back, or start over.',
  tiedEmptyTitle: 'Nothing left to show.',
  rejectOpen: 'Not this one',
  rejectPrompt: 'What put you off?',
  rejectJust: 'Just not this one',
  pickLabel: 'Choose yours',
  kitLabel: 'What’s fitted',
  briefLabel: 'What I’ve picked up',
  closestTitle: ({ retailer }) => `The closest matches at ${retailer}.`,
  closestLede: () => 'Nothing here ticks every box you gave us. Each card says what it '
    + 'gets right, and what it doesn’t.',
  closestSettled: ({ model }) => `Your closest match here is the ${model}.`,
  closestSettledHere: ({ model, retailer }) => `Your closest match at ${retailer} is the ${model}.`,
  weakTitle: ({ retailer }) => `Nothing at ${retailer} is close to what you asked for.`,
  weakLede: () => 'These are the nearest we hold, and each one misses something you '
    + 'said mattered. If none of them works, nothing here does.',
  rescueNote: ({ list, retailer, miles, where }) => `No ${list} at ${retailer} right now. `
    + `The nearest is ${miles} away at ${where}, and it’s in the list below.`,
  driveLede: {
    empty: ({ retailer }) => `Nothing at ${retailer} fits those answers, so these are the `
      + 'closest matches at other retailers instead.',
  },
  hereHeading: ({ retailer }) => `AT ${retailer.toUpperCase()}`,
  awayHeading: 'AT OTHER RETAILERS',
  rejectHint: 'Turned down? We’ll bring the next one up.',
  searchingNearby: 'Still checking other retailers within reach',
  workingLabel: 'HOW WE GOT HERE',
  working: ({ total, eligible }) => `We went through all ${total} Fords in stock here. `
    + `${eligible} were in budget and big enough for you.`,
  workingMargin: ({ margin }) => ` Nothing else here came within ${margin} points.`,
  workingWeak: ({ top }) => ` The best of them reached ${top}%.`,
  workingScore: ' A match score is how well a car fits your answers, nothing else, '
    + 'so cars that suit you equally share one.',
  searchedWider: ({ model, miles, where }) => 'We looked further afield too. '
    + `The ${model} at ${where} scores higher, and it’s ${miles}.`,
};

/*
 * Motorrad copy. Same all-or-nothing build as Honda/Ford: spread the BMW base so
 * every key resolves, then override the marque lines AND the ones that say "car"
 * or "drive" (a rider reads "bike" and "ride"). Motorrad's voice is rider-first
 * and technical, confident and a little adrenaline-forward. No em dashes.
 *
 * Note on "big enough for you" in `working`: for a bike that phrasing is wrong
 * (a bike isn't judged on space), so Motorrad re-voices it to "a match for your
 * licence and riding" - the real gate a rider cares about. No em dashes.
 */
BRAND_COPY.motorrad = {
  ...BRAND_COPY.bmw,
  name: 'BMW Motorrad',
  title: 'Find your perfect BMW Motorrad.',
  cta: 'Find my bike',
  // Motorrad's rider-first, technical, adrenaline-forward register ("Make Life
  // a Ride"): lead on the riding, not "your life", and on the machine under you
  // rather than a soft "suit you best". See docs/tone-style-guide.md (Motorrad).
  lede: ({ questions, retailer }) => `${questions} quick questions about your riding, `
    + 'your licence and your budget. We’ll match you to the '
    + `bikes at ${retailer} built for the road you ride, and tell you why.`,
  unmet: ({ list, retailer }) => `No ${list} at ${retailer} or nearby right now. `
    + 'These are the closest matches to everything else you asked for.',
  refineStatus: ({ shown, wants }) => (shown === 1
    ? `One bike still matches, with ${wants}.`
    : `${shown} bikes still match, with ${wants}.`),
  refineStatusPlain: ({ shown }) => (shown === 1
    ? 'One bike still matches.'
    : `${shown} bikes still match.`),
  working: ({ total, eligible }) => `We went through all ${total} BMW Motorrad bikes in stock here. `
    + `${eligible} were in budget and a match for your licence and riding.`,
  workingScore: ' A match score is how well a bike fits your answers, nothing else, '
    + 'so bikes that suit you equally share one.',
};

/*
 * Ferrari copy. Same all-or-nothing build as Honda/Ford/Motorrad: spread the BMW
 * base so every key resolves, then re-voice the lines that carry the marque or
 * its register. Ferrari's voice is Italian, romantic and heritage-proud, and it
 * speaks to a Ferrarista joining a family, not a shopper making a purchase (per
 * ferrari.com / preowned.ferrari.com: "Join the world of Ferraristi", "La nuova
 * dolce vita", "Configure your dreams", the Prancing Horse, Maranello, Italian
 * excellence since 1947). It leads on emotion and the drive, never on value or
 * spec, and it stays warm and unhurried rather than clipped. Where the honesty
 * frames (unmet / closest / weak) must stay plain and true, they keep their
 * candour but in Ferrari's fuller cadence. No em dashes anywhere.
 */
BRAND_COPY.ferrari = {
  ...BRAND_COPY.bmw,
  name: 'Ferrari',
  title: 'Find the Ferrari that’s yours.',
  cta: 'Find my Ferrari',
  // Romantic, insider, heritage-led: the car is a thoroughbred, the buyer is
  // joining a bloodline. Lead on the drive and the feeling, name the official
  // Ferrari Approved programme rather than "approved-used". See DECISIONS.md and
  // docs/tone-style-guide.md (Ferrari).
  lede: ({ questions, retailer }) => `${questions} quick questions about how you drive, `
    + 'the roads you love and your budget. We’ll match you with the '
    + `vehicles at ${retailer} that were made for you, and tell you why.`,
  unmet: ({ list, retailer }) => `No ${list} at ${retailer} or nearby just now. `
    + 'These are the closest to everything else you told us.',
  tasteTitle: ({ model }) => `The one for you is the ${model}.`,
  tasteTitleHere: ({ model, retailer }) => `The one for you at ${retailer} is the ${model}.`,
  tasteLede: () => 'A few of these suit you equally well on paper. This one speaks most '
    + 'to what you said matters.',
  tiedLede: () => 'On your answers we can’t choose between them: each suits you as well as '
    + 'the next. Now it comes down to the one that moves you.',
  closestLede: () => 'None of these is everything you asked for. Each card says what it '
    + 'gets right, and where it falls short.',
  weakLede: () => 'These are the nearest we hold, and each one misses something you '
    + 'said mattered. If none of them stirs you, nothing here will.',
  workingLabel: 'HOW WE GOT HERE',
  working: ({ total, eligible }) => `We went through every one of the ${total} Ferraris in stock here. `
    + `${eligible} were in budget and roomy enough for you.`,
  workingMargin: ({ margin }) => ` Nothing else here came within ${margin} points.`,
  workingWeak: ({ top }) => ` The best of them reached ${top}%.`,
  workingScore: ' A match score is how well a car fits your answers, nothing else, '
    + 'so cars that suit you equally share one.',
};

/*
 * Rolls-Royce voice: unhurried, understated and deeply assured. The brand never
 * shouts, never sells -- it states. The register is warm but formal: second person
 * singular ("you"), long unhurried sentences, no exclamation marks, no urgency.
 * No em dashes anywhere. The approved programme is "Rolls-Royce Approved".
 */
BRAND_COPY.rrmc = {
  ...BRAND_COPY.bmw,
  name: 'Rolls-Royce',
  kicker: "It doesn't have to take forever...",
  title: 'Find the Rolls-Royce that is yours.',
  cta: 'Begin your journey',
  lede: () => 'Answer these simple questions to the best of your ability. '
    + "We'll shortlist options from our Provenance collection, and match you "
    + 'to the one that is best suited to you.',
  ledeHtml: () => '<span style="letter-spacing:0.01em">Answer these simple questions to the best of your ability. '
    + "We'll shortlist options from</span> "
    + '<span style="letter-spacing:0.04em">our Provenance collection, and match you to the one that is best suited to you.</span>',
  unmet: ({ list, retailer }) => `No ${list} at ${retailer} or nearby right now. `
    + 'These are the closest to everything else you told us.',
  tiedTitle: ({ count }) => `${cardinal(count)} of these suit you equally well.`,
  tiedTitleHere: ({ count, retailer }) => `At ${retailer}, ${cardinal(count)} of these `
    + 'suit you equally well.',
  tasteTitle: ({ model }) => `The one for you is the ${model}.`,
  tasteTitleHere: ({ model, retailer }) => `The one for you at ${retailer} is the ${model}.`,
  tasteLede: () => 'A few of these suit your answers equally. This one aligns most '
    + 'closely with what you said matters.',
  tiedLede: () => 'On your answers we cannot separate them: each suits you as well as '
    + 'the next. The choice now is simply which one moves you.',
  refineLabel: ({ count }) => (count > 1 ? `Refine these ${count}` : 'Refine this one'),
  refineStatus: ({ shown, wants }) => (shown === 1
    ? `One car still matches, with ${wants}.`
    : `${shown} cars still match, with ${wants}.`),
  refineStatusPlain: ({ shown }) => (shown === 1
    ? 'One car still matches.'
    : `${shown} cars still match.`),
  refineEmpty: ({ wants }) => `Nothing here has ${wants} together. `
    + 'Remove one of those and we will show you what remains.',
  refineEmptyHidden: 'That is all of them considered. Bring one back, or begin again.',
  tiedEmptyTitle: 'Nothing left to show.',
  rejectOpen: 'Not this one',
  rejectPrompt: 'What gave you pause?',
  rejectJust: 'Simply not this one',
  pickLabel: 'Make it yours',
  kitLabel: 'What is fitted',
  kitMore: ({ count }) => `, and ${count} more`,
  briefLabel: 'What we have learned',
  hiddenChip: ({ count }) => `${count} set aside`,
  closestTitle: ({ retailer }) => `The closest matches at ${retailer}.`,
  closestLede: () => 'None of these answers every question you gave us. Each card '
    + 'is honest about what it gets right and what it does not.',
  closestSettled: ({ model }) => `Your closest match here is the ${model}.`,
  closestSettledHere: ({ model, retailer }) => `Your closest match at ${retailer} is the ${model}.`,
  weakTitle: ({ retailer }) => `Nothing at ${retailer} is close to what you described.`,
  weakLede: () => 'These are the nearest we hold, and each one misses something you '
    + 'said mattered. If none of them speaks to you, nothing here does.',
  rescueNote: ({ list, retailer, miles, where }) => `No ${list} at ${retailer} right now. `
    + `The nearest is ${miles} away at ${where}, and it is in the list below.`,
  driveLede: {
    empty: ({ retailer }) => `Nothing at ${retailer} fits those answers, so these are the `
      + 'closest matches at other retailers instead.',
  },
  hereHeading: ({ retailer }) => `AT ${retailer.toUpperCase()}`,
  awayHeading: 'AT OTHER RETAILERS',
  rejectHint: 'Set aside? We will bring the next one forward.',
  searchingNearby: 'Still checking other retailers within reach',
  workingLabel: 'HOW WE FOUND THIS',
  working: ({ total, eligible }) => `We considered all ${total} Rolls-Royce vehicles in stock here. `
    + `${eligible} were within your budget and suited to your needs.`,
  workingMargin: ({ margin }) => ` Nothing else here came within ${margin} points.`,
  workingWeak: ({ top }) => ` The best of them reached ${top}%.`,
  workingScore: ' A match score reflects how well a car answers your questions, nothing more, '
    + 'so cars that suit you equally share one.',
  searchedWider: ({ model, miles, where }) => 'We looked further afield. '
    + `The ${model} at ${where} scores higher, and it is ${miles}.`,
};

/*
 * How an unmet want is named in the results note, per brand — plural noun
 * phrases that drop into "No ___ at <retailer>…". Per-brand because MINI
 * names its own shapes (a Countryman, not an SUV) and calls its EVs
 * all-electric, exactly as the quiz options do. Keyed by question id then
 * answer value; an unrecognised value (an old shared link) falls back to the
 * raw value rather than dropping the warning.
 */
export const UNMET_PHRASES = {
  bmw: {
    fuel: {
      petrol: 'petrol cars', diesel: 'diesels', phev: 'plug-in hybrids', ev: 'fully electric cars',
    },
    bodyStyles: {
      hatchback: 'hatchbacks', saloon: 'saloons', estate: 'estates', suv: 'SUVs',
      coupe: 'coupés', convertible: 'convertibles', mpv: 'family carriers',
    },
  },
  mini: {
    fuel: {
      petrol: 'petrol cars', phev: 'plug-in hybrids', ev: 'all-electric cars',
    },
    bodyStyles: {
      hatchback: 'hatchbacks', estate: 'Clubman estates', suv: 'Countryman crossovers',
      convertible: 'convertibles',
    },
  },
  honda: {
    // Honda's self-charging hybrids score as petrol on the engine's fuel axis
    // (see hondaFuel in mapping.js), so the fuel warnings only ever name petrol,
    // diesel or fully electric — the values the quiz collects.
    fuel: {
      petrol: 'petrol cars', diesel: 'diesels', ev: 'fully electric cars',
    },
    bodyStyles: {
      hatchback: 'hatchbacks', suv: 'SUVs',
    },
  },
  ford: {
    // Ford's used range spans the full fuel spread (petrol/mHEV, diesel, the
    // Kuga PHEV, and the Mach-E / Explorer / Capri / Puma Gen-E EVs) and every
    // body from a supermini to a pickup.
    fuel: {
      petrol: 'petrol cars', diesel: 'diesels', phev: 'plug-in hybrids',
      ev: 'fully electric cars',
    },
    bodyStyles: {
      hatchback: 'hatchbacks', estate: 'estates', suv: 'SUVs', coupe: 'coupés',
      convertible: 'convertibles', mpv: 'people carriers', pickup: 'pickups',
    },
  },
  motorrad: {
    // Motorrad is petrol plus one electric (the CE 04); no diesel/PHEV. The
    // bodyStyles keys here are the bike categories the mapper emits as `body`
    // (see MODEL_SPECS_MOTORRAD), not car shapes.
    fuel: {
      petrol: 'petrol bikes', ev: 'electric bikes',
    },
    bodyStyles: {
      naked: 'naked bikes', roadster: 'roadsters', adventure: 'adventure bikes',
      tourer: 'tourers', sport: 'sports bikes', heritage: 'heritage bikes',
      scooter: 'electric scooters',
    },
  },
  ferrari: {
    // Ferrari's used range is petrol plus the 296/SF90 plug-in hybrids; no
    // diesel or fully electric. Its three bodies are named the way the quiz
    // names them: the Spider for a convertible, the Purosangue for the SUV.
    fuel: {
      petrol: 'petrol cars', phev: 'plug-in hybrids',
    },
    bodyStyles: {
      coupe: 'coupés', convertible: 'Spiders', suv: 'the Purosangue',
    },
  },
  rrmc: {
    // Rolls-Royce's own vocabulary: motor cars, not cars, and a convertible is a Drophead.
    fuel: {
      petrol: 'petrol motor cars', ev: 'fully electric motor cars',
    },
    bodyStyles: {
      saloon: 'saloons', suv: 'SUVs', coupe: 'coupés', convertible: 'Dropheads',
    },
  },
};

/*
 * How the hero card owns a want it doesn't meet — "Petrol, where you asked
 * for all-electric." Singular phrases (UNMET_PHRASES above are plurals for
 * the pool-level note), same per-brand vocabulary rules: MINI names its own
 * shapes and calls its EVs all-electric. `label` is the section eyebrow that
 * mirrors "Why it suits you"; the CSS uppercases it, so it's authored plain.
 */
export const TRADE_COPY = {
  bmw: {
    label: 'The trade-off',
    fuel: {
      petrol: 'petrol', diesel: 'diesel', phev: 'a plug-in hybrid', ev: 'fully electric',
    },
    bodyStyles: {
      hatchback: 'a hatchback', saloon: 'a saloon', estate: 'an estate', suv: 'an SUV',
      coupe: 'a coupé', convertible: 'a convertible', mpv: 'a family carrier',
    },
  },
  mini: {
    label: 'The trade',
    fuel: { petrol: 'petrol', phev: 'a plug-in hybrid', ev: 'all-electric' },
    bodyStyles: {
      hatchback: 'a hatchback', estate: 'a Clubman', suv: 'a Countryman',
      convertible: 'a convertible',
    },
    // The `got` side describes the car itself, not a quiz option — and MINI's
    // suv bucket holds the Aceman as well as the Countryman, so naming the
    // Countryman there would mislabel an Aceman on its own card. The want
    // side stays "a Countryman": that's the word the quiz option used.
    got: { bodyStyles: { suv: 'a crossover' } },
  },
  honda: {
    label: 'The trade-off',
    fuel: { petrol: 'petrol', diesel: 'diesel', ev: 'fully electric' },
    bodyStyles: { hatchback: 'a hatchback', suv: 'an SUV' },
  },
  ford: {
    label: 'The trade-off',
    fuel: {
      petrol: 'petrol', diesel: 'diesel', phev: 'a plug-in hybrid', ev: 'fully electric',
    },
    bodyStyles: {
      hatchback: 'a hatchback', estate: 'an estate', suv: 'an SUV', coupe: 'a coupé',
      convertible: 'a convertible', mpv: 'a people carrier', pickup: 'a pickup',
    },
  },
  motorrad: {
    label: 'The trade-off',
    fuel: { petrol: 'petrol', ev: 'electric' },
    bodyStyles: {
      naked: 'a naked bike', roadster: 'a roadster', adventure: 'an adventure bike',
      tourer: 'a tourer', sport: 'a sports bike', heritage: 'a heritage bike',
      scooter: 'an electric scooter',
    },
  },
  ferrari: {
    label: 'The trade-off',
    fuel: { petrol: 'petrol', phev: 'a plug-in hybrid' },
    bodyStyles: {
      coupe: 'a coupé', convertible: 'a Spider', suv: 'the Purosangue',
    },
  },
  rrmc: {
    // The "Why this one?" drawbacks, in the panel's own words ("It's petrol-powered", "a Drophead").
    label: 'Worth knowing',
    fuel: { petrol: 'petrol-powered', ev: 'fully electric' },
    bodyStyles: {
      saloon: 'a saloon', suv: 'an SUV', coupe: 'a coupé', convertible: 'a Drophead',
    },
  },
};

/** "a", "a or b", "a, b or c" — the natural spoken list. */
export function orList(items) {
  if (items.length < 2) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** The same, for things that hold at once: "a and b", "a, b and c". Applied
 * refinements are ANDed, and "with a pano roof or grey" would describe a
 * different, looser search than the one actually run. */
export function andList(items) {
  if (items.length < 2) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/*
 * The hero card's trade-off line(s): one short declarative per missed want,
 * in the engine's fuel-then-shape order — "Petrol, where you asked for fully
 * electric. A saloon, where you asked for an estate." Both brands share the
 * sentence shape (short, factual, full stop — the shared signature); the
 * vocabulary and the eyebrow above carry the brand difference. An
 * unrecognised value (an old shared link) falls back to the raw value rather
 * than dropping the admission.
 */
export function tradeLines(brandKey, trades) {
  const vocab = TRADE_COPY[brandKey] || TRADE_COPY.bmw;
  return trades.map(({ dim, wants, got }) => {
    const gotPhrase = vocab.got?.[dim]?.[got] || vocab[dim]?.[got] || got;
    const wantList = orList(wants.map((w) => vocab[dim]?.[w] || w));
    const line = `${gotPhrase}, where you asked for ${wantList}.`;
    return line.charAt(0).toUpperCase() + line.slice(1);
  });
}
