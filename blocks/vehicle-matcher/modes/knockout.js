/*
 * MINI Knockout — the matcher, played as a championship "This or That".
 *
 * One of several interchangeable interface "modes" over the shared engine (see
 * ../modes/index.js and the shell in ../vehicle-matcher.js). Its premise is the
 * same as the swipe game's, in one line: the head-to-head picks silently answer
 * the same questionnaire the `questions` mode asks, and the REAL engine does the
 * matching. See docs/mini-knockout-requirements.md.
 *
 * The flow:
 *   1. A tiny "set your bracket" SEED step (budget + what's it for) — identical to
 *      the swipe game's seed: the two answers a game can't read, and budget is the
 *      engine's one hard filter, so the field is affordable from the first round.
 *   2. A FIELD of the retailer's real stock (POST /api/preview, scoped by the
 *      seed), shuffled and snapped to the largest power of two it can fill (16 → 8
 *      → 4). The field plays a knockout bracket: lean two-card head-to-heads
 *      whittle it to a single champion. Each pick nudges the *taste* answer keys,
 *      weighted by how far a car advances (bracketToAnswers()).
 *   3. A RESULT: the assembled brief goes to the real /api/match (the identical
 *      call the questionnaire mode makes). The player's CHAMPION is the hero of the
 *      reveal — always honoured — and the engine supplies its real "why" and the
 *      honest note when the numbers don't back the crown ("champion, engine
 *      validates"). So the celebration is the player's; the truth is the engine's.
 *
 * This mode owns its own copy, cards and state. It shares only the signal helpers
 * (./match-signal.js) with the swipe game and el/gbp (../ui.js) — the two games
 * read taste and build the engine brief the same way, but look and read
 * differently (a versus, not a swipe stack).
 *
 * The scoring engine and car dataset live behind an API (see server/ and
 * ../engine.js); this mode never sees the dataset — only the public display
 * fields the API returns.
 */

import {
  apiGetQuestions, apiField, apiMatch, apiPreview,
} from '../engine.js';
import { el, cardinal, centreOnPage } from '../ui.js';
import {
  WEAK_SCORE,
  budgetBandsFromQuestion, useTilesFromQuestion,
  shuffle, photosFirst, swatchFor, priceLabel, cap,
  bracketToAnswers, idOf, celebrate, ageInYears,
} from './match-signal.js';
import { matchCard, setRrmcAnswers } from './result-card.js';
import {
  renderOptionList, renderBudgetDrawer, renderRangeSlider, visibleQuestions, formatSliderValue,
} from './question-ui.js';

/* The most cars we'll ever field, even when stock is deep — four rounds
 * (16 → 8 → 4 → 2 → 1) is already a long-ish sitting for a promo. The field is
 * snapped DOWN to the largest power of two ≤ min(pool, this). */
const MAX_FIELD = 16;

/* Below this many feasible cars there isn't a game — treat as an empty pool and
 * send the player back to the seed to widen the budget. Exactly two still makes a
 * one-match "final", which is a legitimate (if short) tournament. */
const MIN_FIELD = 2;

// RRMC seed: how many high-end suggestions sit in the provenance strip beneath the questions.
const TAIL_MAX = 6;

/* ------------------------------ copy ------------------------------ */

/*
 * Display copy, keyed by brand with a `bmw` fallback (every read is
 * KNOCKOUT_COPY[brand] || KNOCKOUT_COPY.bmw). MINI is the primary, fully written
 * voice — this is a MINI campaign; the BMW register is a lighter fallback so a
 * future skin isn't blank. Functions take a single args object, matching the
 * questions- and swipe-mode copy convention. Round names are computed from the
 * live field size (roundName), not written here, so an adaptive bracket labels
 * itself correctly whether it starts at 16, 8 or 4.
 */
const KNOCKOUT_COPY = {
  mini: {
    wordmark: 'MINI Knockout',
    // Seed step (mirrors the swipe seed; the tiles themselves come from the engine)
    seedTitle: 'Draw up your bracket.',
    seedLede: 'Two quick things and we’ll seed the field. Then it’s head-to-head, all the way to the final whistle.',
    budgetLabel: 'How much are you looking to spend?',
    useLabel: 'And what’s it for?',
    seedCta: 'Kick it off',
    // Rounds. "VS" (not "or") so the two cars read as a fight, not a menu.
    versus: 'VS',
    pickHint: 'Two cars, one goes through. Tap the one you’re backing.',
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `Tie ${done} of ${total}`,
    // Between-round ceremony: a banner naming the round you’re entering, and a
    // bigger interstitial when you reach the Final.
    roundAdvance: ({ round, survivors }) => `${round} · ${survivors} still in the running`,
    finalKicker: 'Down to the last two',
    finalTitle: 'The Final.',
    finalLede: 'Two left on the pitch. One trophy. Back your winner.',
    finalCta: 'Bring it on',
    // The per-tie verdict from the engine's own score of the two cars — did the
    // player back the form pick, or send an underdog through? One concrete beat
    // per tie (replaced the abstract "form" meter, which didn't move within a round).
    verdictForm: ({ model }) => `The ${model} was the form pick. Good shout.`,
    verdictUpset: ({ model }) => `The ${model} goes through. The underdog’s upset the odds!`,
    // Tale of the tape — MINI has no honest per-car performance figure, so the
    // listing rows are mileage + age (both real per-listing; the fresher, newer
    // car wins), with 0-62 as a labelled model supporting row and engine cc
    // where the feed carried it. Each row nulls out when its metric is missing,
    // so a thin listing simply shows fewer rows.
    taleTitle: 'Tale of the tape',
    statRows: (a, b) => [
      lowerBetterRow('Mileage', a, b, mileageOf, milesText),
      ageRow(a, b),
      higherBetterRow('Engine', a, b, ccOf, (n) => `${n.toLocaleString('en-GB')}cc`),
      zeroTo62Row(a, b),
    ],
    // Result — the champion is always the hero (decision: champion, engine validates)
    matchKicker: 'Your champion',
    matchTitle: ({ model }) => `The ${model} lifts the trophy.`,
    matchLede: 'Saw off everything you put in its way.',
    whyIntro: 'Why it went all the way:',
    crownCallback: ({ beaten }) => `It knocked out ${beaten} on the run to the title.`,
    // When the engine can't fully back the crown (weak / not in the feasible set)
    weakNote: 'For the record, though: the numbers don’t *quite* make this the standout. '
      + 'Stock changes every week, so it’s worth another run soon.',
    alsoNote: ({ model }) => `If you fancy a replay, the numbers make the ${model} the one to beat.`,
    // CTAs + share
    testDriveCta: 'Book a test drive',
    detailsCta: 'See full details',
    shareCta: 'Share your champion',
    shareCopied: 'Link copied',
    againCta: 'New tournament',
    shareText: ({ model, retailer }) => `My champion is a ${model} at ${retailer}. `
      + 'Reckon you’d pick a different winner?',
    // Empty pool at the seed
    emptyPoolTitle: 'Not enough in that range for a bracket.',
    emptyPoolLede: ({ retailer }) => `${retailer} hasn’t got enough under that to run a knockout. `
      + 'Nudge your budget up and we’ll seed a fresh field.',
    emptyPoolCta: 'Adjust budget',
    // Errors
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the matcher',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  bmw: {
    wordmark: 'Head to Head',
    seedTitle: 'Set up your bracket.',
    seedLede: 'Two quick things and we’ll seed the field, then it’s head-to-head to a winner.',
    budgetLabel: 'Budget',
    useLabel: 'What’s it for?',
    seedCta: 'Seed the bracket',
    versus: 'VS',
    pickHint: 'Two cars go head to head. Pick the one you’d rather have.',
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `Match ${done} of ${total}`,
    roundAdvance: ({ round, survivors }) => `${round} · ${survivors} remaining`,
    finalKicker: 'Down to two',
    finalTitle: 'The Final.',
    finalLede: 'Two cars left. Pick the one you’d take.',
    finalCta: 'Continue',
    verdictForm: ({ model }) => `The ${model} was the higher-rated of the two.`,
    verdictUpset: ({ model }) => `The ${model} goes through. The lower-rated pick.`,
    // Tale of the tape — mileage + age lead (real per-listing; fresher and newer
    // win), engine cc where the feed carried it, and 0-62 as a labelled model
    // supporting row. Each nulls out when absent, so a thin listing shows fewer.
    taleTitle: 'Tale of the tape',
    statRows: (a, b) => [
      lowerBetterRow('Mileage', a, b, mileageOf, milesText),
      ageRow(a, b),
      higherBetterRow('Engine', a, b, ccOf, (n) => `${n.toLocaleString('en-GB')}cc`),
      zeroTo62Row(a, b),
    ],
    matchKicker: 'Your winner',
    matchTitle: ({ model }) => `The ${model} takes it.`,
    matchLede: 'It beat every car you put against it.',
    whyIntro: 'Why it stands out:',
    crownCallback: ({ beaten }) => `It saw off ${beaten} to win the bracket.`,
    weakNote: 'For the record, the numbers don’t fully back this one. Stock changes '
      + 'weekly, so it’s worth another run soon.',
    alsoNote: ({ model }) => `On the numbers, the ${model} is the closest fit if you’d reconsider.`,
    testDriveCta: 'Book a test drive',
    detailsCta: 'See full details',
    shareCta: 'Share this winner',
    shareCopied: 'Link copied',
    againCta: 'New tournament',
    shareText: ({ model, retailer }) => `My pick is a ${model} at ${retailer}.`,
    emptyPoolTitle: 'Not enough in that range for a bracket.',
    emptyPoolLede: ({ retailer }) => `${retailer} hasn’t got enough under that to run a knockout. `
      + 'Raise your budget and we’ll seed a fresh field.',
    emptyPoolCta: 'Adjust budget',
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the matcher',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Honda's register: plain and straightforward, no em dashes (house rule). The
  // bracket framing is kept, but the words stay unshowy. Its own wordmark so the
  // mode reads as Honda's rather than a BMW skin.
  honda: {
    wordmark: 'Head to Head',
    seedTitle: 'Set up your bracket.',
    seedLede: 'Two quick things and we’ll seed the field, then it’s head-to-head to a winner.',
    budgetLabel: 'Budget',
    useLabel: 'What’s it for?',
    seedCta: 'Seed the bracket',
    versus: 'VS',
    pickHint: 'Two cars go head to head. Pick the one you’d rather have.',
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `Match ${done} of ${total}`,
    roundAdvance: ({ round, survivors }) => `${round} · ${survivors} remaining`,
    finalKicker: 'Down to two',
    finalTitle: 'The Final.',
    finalLede: 'Two cars left. Pick the one you’d take.',
    finalCta: 'Continue',
    verdictForm: ({ model }) => `The ${model} was the higher-rated of the two.`,
    verdictUpset: ({ model }) => `The ${model} goes through, the lower-rated pick.`,
    // Tale of the tape - mileage + power (bhp) + age, all real per-listing (Honda
    // carries a genuine per-car bhp and reg year). Each nulls out when its metric
    // is missing, so a thin listing shows fewer rows.
    taleTitle: 'Tale of the tape',
    statRows: (a, b) => [
      lowerBetterRow('Mileage', a, b, mileageOf, milesText),
      higherBetterRow('Power', a, b, powerOf, (n) => `${n} bhp`),
      ageRow(a, b),
    ],
    matchKicker: 'Your winner',
    matchTitle: ({ model }) => `The ${model} takes it.`,
    matchLede: 'It beat every car you put against it.',
    whyIntro: 'Why it stands out:',
    crownCallback: ({ beaten }) => `It saw off ${beaten} to win the bracket.`,
    weakNote: 'For the record, the numbers don’t fully back this one. Stock changes '
      + 'weekly, so it’s worth another run soon.',
    alsoNote: ({ model }) => `On the numbers, the ${model} is the closest fit if you’d reconsider.`,
    testDriveCta: 'Book a test drive',
    detailsCta: 'See full details',
    shareCta: 'Share this winner',
    shareCopied: 'Link copied',
    againCta: 'New tournament',
    shareText: ({ model, retailer }) => `My pick is a ${model} at ${retailer}.`,
    emptyPoolTitle: 'Not enough in that range for a bracket.',
    emptyPoolLede: ({ retailer }) => `${retailer} hasn’t got enough under that to run a knockout. `
      + 'Raise your budget and we’ll seed a fresh field.',
    emptyPoolCta: 'Adjust budget',
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the matcher',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Ford's register: friendly and confident, with a touch of competitive spirit
  // (Ford's ST/Mustang heritage earns the light bracket framing). No em dashes
  // (house rule). Its own wordmark so the mode reads as Ford's.
  ford: {
    wordmark: 'Head to Head',
    seedTitle: 'Set up your bracket.',
    seedLede: 'Two quick things and we’ll seed the field, then it’s head-to-head to a winner.',
    budgetLabel: 'Budget',
    useLabel: 'What’s it for?',
    seedCta: 'Seed the bracket',
    versus: 'VS',
    pickHint: 'Two cars go head to head. Pick the one you’d rather have.',
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `Match ${done} of ${total}`,
    roundAdvance: ({ round, survivors }) => `${round} · ${survivors} remaining`,
    finalKicker: 'Down to two',
    finalTitle: 'The Final.',
    finalLede: 'Two cars left. Pick the one you’d take.',
    finalCta: 'Continue',
    verdictForm: ({ model }) => `The ${model} was the higher-rated of the two.`,
    verdictUpset: ({ model }) => `The ${model} goes through, the lower-rated pick.`,
    // Tale of the tape - the full-service-history trust duel leads (real per-
    // listing, Ford only: a documented history beats a partial/absent one, and
    // it nulls when the two are level so it never crowds a non-verdict), then
    // mileage + age. Ford carries no per-listing power/cc, so those rows aren't
    // offered. Each nulls out when absent.
    taleTitle: 'Tale of the tape',
    statRows: (a, b) => [
      fshRow(a, b),
      lowerBetterRow('Mileage', a, b, mileageOf, milesText),
      ageRow(a, b),
    ],
    matchKicker: 'Your winner',
    matchTitle: ({ model }) => `The ${model} takes it.`,
    matchLede: 'It beat every car you put against it.',
    whyIntro: 'Why it stands out:',
    crownCallback: ({ beaten }) => `It saw off ${beaten} to win the bracket.`,
    weakNote: 'For the record, the numbers don’t fully back this one. Stock changes '
      + 'weekly, so it’s worth another run soon.',
    alsoNote: ({ model }) => `On the numbers, the ${model} is the closest fit if you’d reconsider.`,
    testDriveCta: 'Book a test drive',
    detailsCta: 'See full details',
    shareCta: 'Share this winner',
    shareCopied: 'Link copied',
    againCta: 'New tournament',
    shareText: ({ model, retailer }) => `My pick is a ${model} at ${retailer}.`,
    emptyPoolTitle: 'Not enough in that range for a bracket.',
    emptyPoolLede: ({ retailer }) => `${retailer} hasn’t got enough under that to run a knockout. `
      + 'Raise your budget and we’ll seed a fresh field.',
    emptyPoolCta: 'Adjust budget',
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the matcher',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Motorrad's register: rider-first and competitive (the sportiest sub-brand, so
  // the bracket framing has real bite). Every car word becomes a bike word: two
  // bikes go head to head, it beats every bike, you book a test ride. No em dashes
  // (house rule). Its own wordmark so the mode reads as Motorrad's.
  motorrad: {
    wordmark: 'Head to Head',
    seedTitle: 'Set up your bracket.',
    seedLede: 'Two quick things and we’ll seed the field, then it’s head-to-head to a winner.',
    budgetLabel: 'Budget',
    useLabel: 'What’s it for?',
    seedCta: 'Seed the bracket',
    versus: 'VS',
    pickHint: 'Two bikes go head to head. Pick the one you’d rather ride.',
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `Match ${done} of ${total}`,
    roundAdvance: ({ round, survivors }) => `${round} · ${survivors} remaining`,
    finalKicker: 'Down to two',
    finalTitle: 'The Final.',
    finalLede: 'Two bikes left. Pick the one you’d take.',
    finalCta: 'Continue',
    verdictForm: ({ model }) => `The ${model} was the higher-rated of the two.`,
    verdictUpset: ({ model }) => `The ${model} goes through, the lower-rated pick.`,
    // Tale of the tape - power in kW + engine size in cc + age, all real per-
    // listing (Motorrad carries a genuine per-bike kW, cc and reg year). Power is
    // labelled kW (never a bare number). Each row nulls out when its metric is
    // missing, so a thin listing shows fewer rows.
    taleTitle: 'Tale of the tape',
    statRows: (a, b) => [
      higherBetterRow('Power', a, b, powerOf, (n) => `${n} kW`),
      higherBetterRow('Engine', a, b, ccOf, (n) => `${n.toLocaleString('en-GB')}cc`),
      ageRow(a, b),
    ],
    matchKicker: 'Your winner',
    matchTitle: ({ model }) => `The ${model} takes it.`,
    matchLede: 'It beat every bike you put against it.',
    whyIntro: 'Why it stands out:',
    crownCallback: ({ beaten }) => `It saw off ${beaten} to win the bracket.`,
    weakNote: 'For the record, the numbers don’t fully back this one. Stock changes '
      + 'weekly, so it’s worth another run soon.',
    alsoNote: ({ model }) => `On the numbers, the ${model} is the closest fit if you’d reconsider.`,
    testDriveCta: 'Book a test ride',
    detailsCta: 'See full details',
    shareCta: 'Share this winner',
    shareCopied: 'Link copied',
    againCta: 'New tournament',
    shareText: ({ model, retailer }) => `My pick is a ${model} at ${retailer}.`,
    emptyPoolTitle: 'Not enough in that range for a bracket.',
    emptyPoolLede: ({ retailer }) => `${retailer} hasn’t got enough under that to run a knockout. `
      + 'Raise your budget and we’ll seed a fresh field.',
    emptyPoolCta: 'Adjust budget',
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the matcher',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Ferrari's register: a thoroughbred face-off, spare and reverent, never
  // shouty. The bracket becomes a grid: cars line up, the quicker and more
  // storied goes through. This is the brand with the richest per-listing data
  // (real bhp, cc, and, on a fresh capture, top speed), so its tale of the tape
  // leads on the numbers that actually separate two Ferraris. No em dashes
  // (house rule). Its own wordmark so the mode reads as Ferrari's.
  ferrari: {
    wordmark: 'Head to Head',
    seedTitle: 'Set your grid.',
    seedLede: 'Two quick things and we’ll line up the field, then it’s a straight fight to the flag.',
    budgetLabel: 'Budget',
    useLabel: 'What’s it for?',
    seedCta: 'Line them up',
    versus: 'VS',
    pickHint: 'Two cars on the grid. Send the one you’d drive through.',
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `Duel ${done} of ${total}`,
    roundAdvance: ({ round, survivors }) => `${round} · ${survivors} still in it`,
    finalKicker: 'Down to two',
    finalTitle: 'The Final.',
    finalLede: 'Two thoroughbreds left. Pick the one you’d take home.',
    finalCta: 'Bring it on',
    verdictForm: ({ model }) => `The ${model} was the form car. Well judged.`,
    verdictUpset: ({ model }) => `The ${model} goes through, the outside bet.`,
    // Tale of the tape - power (bhp), engine size (cc) and top speed (mph) are
    // real per-listing here, so they lead; 0-62 rounds it out as a labelled model
    // row. Top speed only paints once a fresh capture carries it (the mapper
    // surfaces it, the row nulls out until then). Every row real, every row honest.
    taleTitle: 'Tale of the tape',
    statRows: (a, b) => [
      higherBetterRow('Power', a, b, powerOf, (n) => `${n} bhp`),
      higherBetterRow('Engine', a, b, ccOf, (n) => `${n.toLocaleString('en-GB')}cc`),
      higherBetterRow('Top speed', a, b, topSpeedOf, (n) => `${n} mph`),
      zeroTo62Row(a, b),
    ],
    matchKicker: 'Your winner',
    matchTitle: ({ model }) => `The ${model} takes the flag.`,
    matchLede: 'It saw off everything you lined up against it.',
    whyIntro: 'Why it stands out:',
    crownCallback: ({ beaten }) => `It saw off ${beaten} on the way to the win.`,
    weakNote: 'For the record, the numbers don’t quite make this the standout. Stock '
      + 'moves fast at this level, so it’s worth another run soon.',
    alsoNote: ({ model }) => `On the numbers, the ${model} is the one to beat if you’d reconsider.`,
    testDriveCta: 'Book a test drive',
    detailsCta: 'See full details',
    shareCta: 'Share this winner',
    shareCopied: 'Link copied',
    againCta: 'New tournament',
    shareText: ({ model, retailer }) => `My pick is a ${model} at ${retailer}.`,
    emptyPoolTitle: 'Not enough in that range for a grid.',
    emptyPoolLede: ({ retailer }) => `${retailer} hasn’t got enough under that to line up a field. `
      + 'Raise your budget and we’ll set a fresh grid.',
    emptyPoolCta: 'Adjust budget',
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the matcher',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Rolls-Royce: the podium's voice (measured, assured, no contest language, no em dashes).
  // Names arrive as "<year> <Model>" via nameOf; CSS sets the case, as on podium.
  rrmc: {
    wordmark: '',
    seedTitle: 'Some choices are clearer side by side.',
    seedLede: 'Answer these simple questions to the best of your ability. We will set choices from our Provenance '
      + 'collection beside one another, two at a time, until the one that is yours remains.',
    budgetLabel: 'Is there an ideal price range?',
    useLabel: 'Where will you go?',
    seedCta: 'Find my perfect match',
    tailHeading: 'Explore the full range of Rolls-Royce provenance',
    versus: 'or',
    pickHint: 'Two choices from our Provenance collection. Choose the one you would rather own.',
    pickCta: 'Choose this one',
    pickLabel: ({ model }) => `Choose the ${model}`,
    roundName: (entrants) => ({
      2: 'The Final Choice', 4: 'The Last Four', 8: 'The Last Eight', 16: 'The First Sixteen',
    }[entrants] || `The First ${entrants}`),
    roundKicker: ({ round }) => round,
    matchupProgress: ({ done, total }) => `${done} of ${total}`,
    roundAdvance: ({ survivors }) => `${cap(cardinal(survivors))} remain`,
    finalKicker: '',
    finalTitle: 'Two remain.',
    finalLede: 'Each has held its place so far. Choose the one that is yours.',
    finalCta: 'Continue',
    verdictForm: ({ model }) => `The ${model} was the closer match to your brief.`,
    verdictUpset: ({ model }) => `You chose the ${model}.`,
    // Mileage reads MOA as MOA (never "0 miles", never crowned); year is per listing; 0 to 62 supports.
    taleTitle: 'Side by side',
    showTally: false,
    statRows: (a, b) => [
      rrmcMileageRow(a, b),
      yearRow(a, b),
      zeroTo62Row(a, b),
    ],
    matchKicker: 'Your Choice',
    matchTitle: () => 'The one that is yours.',
    matchLede: 'Set beside every option you considered, it held its place.',
    rankOther: 'Another Option',
    whyIntro: '',
    crownCallback: ({ beaten }) => `You preferred it to ${beaten}.`,
    rivalWords: ['', 'one other', 'two others', 'three others', 'four others'],
    weakNote: 'On the numbers alone, it is not the closest match to your brief. Our collection '
      + 'changes often, so it is worth returning soon.',
    alsoNote: ({ model }) => `On the numbers, the ${model} sits closest to what you asked for.`,
    testDriveCta: 'Arrange a viewing',
    detailsCta: null,
    shareCta: 'Share your choice',
    shareCopied: 'Link copied',
    againCta: 'Begin again',
    shareText: ({ model, retailer }) => `My choice from ${retailer}: the ${model}.`,
    retailerFallback: 'Rolls-Royce Approved',
    emptyPoolTitle: 'Too few options within that brief.',
    emptyPoolLede: ({ retailer }) => `${retailer} holds too few within that brief to set side by side. `
      + 'Widen the regions or the price range, and we will begin again.',
    emptyPoolCta: 'Adjust my answers',
    errKicker: '',
    errTitle: "We couldn't reach the matcher",
    errLede: "The matching service didn't respond. Check your connection and try again.",
    retryLabel: 'Try again',
  },
};

/* ------------------------------ helpers ------------------------------ */

/** Copy for the active brand, BMW as the fallback (matches ctx.brand shape). */
const copyFor = (brand) => KNOCKOUT_COPY[brand] || KNOCKOUT_COPY.bmw;

/** Largest power of two ≤ n (0 for n < 1). Used to snap the shuffled pool to a
 * clean bracket size so every round is a full set of pairings, no byes. */
function largestPowerOfTwo(n) {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return n >= 1 ? p : 0;
}

/** Human name for a round given how many cars ENTER it: 2 → Final, 4 → Semi-
 * final, 8 → Quarter-final, else "Round of N". Adaptive: a bracket that starts
 * at 4 opens on "Semi-final", one that starts at 16 opens on "Round of 16". */
function roundName(entrants) {
  if (entrants <= 2) return 'The Final';
  if (entrants <= 4) return 'Semi-final';
  if (entrants <= 8) return 'Quarter-final';
  return `Round of ${entrants}`;
}

/** Pair a flat list into [[a,b],[c,d],...]. Assumes an even length (the field is
 * snapped to a power of two before this); a stray odd tail car is dropped by the
 * caller, never faked into a bye. */
function pairUp(list) {
  const pairs = [];
  for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  return pairs;
}

/* ------------------------- stat-row helpers ------------------------- */

/*
 * The head-to-head "tale of the tape": up to THREE brand-appropriate REAL
 * metrics compared across the two contenders, the better value highlighted, so
 * the duel shows WHY one car might edge it rather than being a pure look-and-
 * price pick. Still a duel, not a spreadsheet — buildStatPanel caps it at three.
 *
 * Each brand's statRows(a, b) hook returns an ARRAY of row objects, in priority
 * order; buildStatPanel drops the nulls and keeps the first three that survive.
 * A row is:
 *   { label, aText, bText, winner: 'a' | 'b' | null, tier: 'listing' | 'model' }
 * winner names the side to highlight; null means "no winner / tie" (both plain).
 * A row builder returns null whenever its metric is missing on EITHER car, so a
 * broken or half-empty row never paints.
 *
 * tier records whether the figure describes the individual LISTING (mileage,
 * power, cc, age — the honest default) or the MODEL (0-62, shared by every
 * listing of a line). Model rows are allowed only as SUPPORTING rows: they carry
 * an unambiguous label ("0 to 62") and buildStatPanel drops them if no listing
 * row survives, so a matchup is never described purely by a model figure.
 *
 * These small builders keep each brand's hook terse and guarantee the same
 * honest discipline (return null when a value is absent on either car).
 */

/** A "lower is better" numeric duel (mileage). null if either value is missing.
 *  `opts` may carry { tier } (defaults to 'listing'). */
function lowerBetterRow(label, a, b, valueOf, fmt, opts = {}) {
  const av = valueOf(a);
  const bv = valueOf(b);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
  const winner = av === bv ? null : (av < bv ? 'a' : 'b');
  return {
    label, aText: fmt(av), bText: fmt(bv), winner, tier: opts.tier || 'listing',
  };
}

/** A "higher is better" numeric duel (power, cc). null if either is missing.
 *  `opts` may carry { tier } (defaults to 'listing'). */
function higherBetterRow(label, a, b, valueOf, fmt, opts = {}) {
  const av = valueOf(a);
  const bv = valueOf(b);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
  const winner = av === bv ? null : (av > bv ? 'a' : 'b');
  return {
    label, aText: fmt(av), bText: fmt(bv), winner, tier: opts.tier || 'listing',
  };
}

/*
 * The one permitted MODEL-level row: 0-62, lower (quicker) wins. Always labelled
 * so it reads as the model's figure, and always tier:'model' so buildStatPanel
 * treats it as supporting-only (dropped when no listing row survives). Wraps
 * lowerBetterRow so the compare/format logic stays in one place.
 */
function zeroTo62Row(a, b) {
  return lowerBetterRow('0 to 62', a, b, zeroTo62Of, secsText, { tier: 'model' });
}

/*
 * A per-listing AGE duel: the younger car wins. Reads whatever registration
 * signal the listing carries (year / firstReg / plate) via the shared
 * ageInYears helper, so it is real per-listing across every brand. null when
 * either car's age can't be decoded, so it never guesses. `now` is injectable
 * for testing.
 */
function ageRow(a, b, now = new Date()) {
  const av = ageInYears(a, now);
  const bv = ageInYears(b, now);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
  const winner = av === bv ? null : (av < bv ? 'a' : 'b');
  return {
    label: 'Age', aText: ageText(av), bText: ageText(bv), winner, tier: 'listing',
  };
}

/** UK-grouped mileage text, e.g. "24,000 miles". */
const milesText = (n) => `${n.toLocaleString('en-GB')} miles`;
/** 0-62 seconds, e.g. "3.5s". */
const secsText = (n) => `${n}s`;
/** Whole-year age, e.g. "3 yrs"; under a year reads plainly, no em dash. */
const ageText = (n) => (n <= 0 ? 'Under a year' : `${n} ${n === 1 ? 'yr' : 'yrs'}`);
const mileageOf = (car) => (Number.isFinite(car?.mileage) ? car.mileage : NaN);
/** Real per-listing engine figures. The UNIT is the caller's job (bhp for Honda,
 * kW for Motorrad), so these only read the raw number; NaN when absent. */
const powerOf = (car) => (Number.isFinite(car?.power) ? car.power : NaN);
const ccOf = (car) => (Number.isFinite(car?.cc) ? car.cc : NaN);
/** Real per-listing top speed (mph), Ferrari only; NaN when absent. */
const topSpeedOf = (car) => (Number.isFinite(car?.topSpeed) ? car.topSpeed : NaN);
/** Model-level 0-62 (seconds), from MODEL_SPECS; near-universal but describes
 * the line, not the listing — hence its rows are always tier:'model'. */
const zeroTo62Of = (car) => (Number.isFinite(car?.zeroTo62) ? car.zeroTo62 : NaN);

/*
 * Ford's full-service-history duel (real per-listing, Ford only). "Full service
 * history" beats "Partial or none". Returns null when neither car carries a
 * fullServiceHistory flag (nothing to compare) AND when the two are level (both
 * documented, or both not) so the caller can fall back to a more separating
 * metric like mileage. A real contrast (one has it, the other doesn't) is the
 * standout trust duel and is always shown, with the documented side highlighted.
 */
function fshRow(a, b) {
  const has = (car) => typeof car?.fullServiceHistory === 'string' && car.fullServiceHistory !== '';
  if (!has(a) && !has(b)) return null;
  const yes = (car) => car?.fullServiceHistory === 'Yes';
  const av = yes(a);
  const bv = yes(b);
  if (av === bv) return null; // level on history — let the caller fall back
  const text = (car) => (yes(car) ? 'Full service history' : 'Partial or none');
  return {
    label: 'History', aText: text(a), bText: text(b), winner: av ? 'a' : 'b', tier: 'listing',
  };
}

// Under this many miles a reading reads as new, as on the RRMC tiles (result-card.js).
const RRMC_NEGLIGIBLE_MILES = 50;
const rrmcMilesText = (car) => {
  if (car.moa) return 'MOA';
  return car.mileage < RRMC_NEGLIGIBLE_MILES ? 'Mileage Negligible' : `${car.mileage.toLocaleString('en-GB')} Miles`;
};

/* RRMC mileage duel. An MOA car (no published reading) arrives as mileage 0, so it is shown as
 * MOA and never crowned; two negligible readings are level too. null when neither side has a reading. */
function rrmcMileageRow(a, b) {
  const known = (car) => Boolean(car?.moa) || Number.isFinite(car?.mileage);
  if (!known(a) || !known(b) || (a.moa && b.moa)) return null;
  const level = a.moa || b.moa || a.mileage === b.mileage
    || (a.mileage < RRMC_NEGLIGIBLE_MILES && b.mileage < RRMC_NEGLIGIBLE_MILES);
  return {
    label: 'Mileage',
    aText: rrmcMilesText(a),
    bText: rrmcMilesText(b),
    winner: level ? null : (a.mileage < b.mileage ? 'a' : 'b'),
    tier: 'listing',
  };
}

/** Registration year duel, the newer wins. null when either year is missing (the feed's 0). */
function yearRow(a, b) {
  const av = Number(a?.year);
  const bv = Number(b?.year);
  if (!(av > 0) || !(bv > 0)) return null;
  const winner = av === bv ? null : (av > bv ? 'a' : 'b');
  return {
    label: 'Year', aText: String(av), bText: String(bv), winner, tier: 'listing',
  };
}

/** "Rolls-Royce Cullinan" as RRMC's tiles print it: "2021 Cullinan". */
const rrmcName = (car) => {
  const base = (car?.name || '').replace(/^Rolls-Royce\s+/i, '');
  return car?.year ? `${car.year} ${base}` : base;
};

// Answered = a value that reaches the engine (podium's rule); sliders persist on render, so count.
const isAnswered = (v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

/* A single-value slider (RRMC's mileage), mirroring podium.js renderValueSlider: the start value
 * is persisted at once, the readout and aria-valuetext follow every move. */
function renderValueSlider(list, q, answers, { onChange } = {}) {
  const stored = answers[q.id];
  const start = typeof stored === 'number' ? stored : (typeof q.default === 'number' ? q.default : q.min);
  answers[q.id] = start;
  const readout = el('output', 'vm-slider-value', formatSliderValue(start, q));
  const input = el('input', 'vm-slider-input');
  input.type = 'range';
  input.min = String(q.min);
  input.max = String(q.max);
  input.step = String(q.step);
  input.value = String(start);
  input.setAttribute('aria-label', q.title);
  input.setAttribute('aria-valuetext', formatSliderValue(start, q));
  input.addEventListener('input', () => {
    const value = Number(input.value);
    answers[q.id] = value;
    const text = formatSliderValue(value, q);
    readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
    onChange?.();
  });
  const bounds = el('div', 'vm-slider-bounds');
  bounds.append(
    el('span', 'vm-slider-min', formatSliderValue(q.min, q)),
    el('span', 'vm-slider-max', formatSliderValue(q.max, q)),
  );
  list.append(readout, input, bounds);
}

/* A short filter helper: keep the first `n` non-null rows from a list. */
function firstRows(rows, n) {
  const out = [];
  for (const r of rows) {
    if (r) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/* ------------------------------ mount ------------------------------ */

function mount(root, ctx) {
  const copy = copyFor(ctx.brand);
  // RRMC plays on the podium's tiles, questions and progress; every other brand is untouched.
  const rrmc = ctx.brand === 'rrmc';
  const nameOf = (car) => (rrmc ? rrmcName(car) : car?.name);
  const roundLabel = (entrants) => (copy.roundName ? copy.roundName(entrants) : roundName(entrants));

  // Per-run state — a fresh local object, NOT hung on the shared ctx, so a mode
  // swap and re-mount (the switcher re-calls mount with the same ctx) starts
  // clean. The mode owns its own state and its own hash key.
  const state = {
    questions: [], // the engine's per-brand questions (seeds the budget/use tiles)
    seed: null, // { budget, primaryUse }
    // Bracket:
    round: [], // cars entering the CURRENT round (a power of two, then halving)
    pairings: [], // pairUp(round) — the current round's matchups
    matchIndex: 0, // which matchup in `pairings` is on screen
    winners: [], // winners collected so far THIS round (seed the next round)
    rounds: [], // bracket log: { roundIndex, winner, loser } per head-to-head
    fieldSize: 0, // the starting field size (for round naming + weighting)
    roundIndex: 0, // 0 = first round
    // The engine's own per-card score (0–100) from /api/field, keyed by idOf.
    // The GAME plays with display cars (score is never a visible verdict), but
    // we use it for a per-tie beat: after each pick we compare the winner's score
    // to the loser's and tell the player whether they backed the engine's form
    // pick or sent an underdog through. This surfaces the engine signal the mode
    // used to discard — as a concrete moment, not an abstract meter.
    scoreById: new Map(),
    // The field's own match objects, keyed by idOf: RRMC tiles need their listings and tradeOffs.
    matchById: new Map(),
    lastVerdict: null, // { kind: 'form'|'upset', winner } — shown on the next paint, once
    busy: false, // pick lock while a matchup transitions out
  };

  const reducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* RRMC: is this run still the mounted mode? The shell swaps modes in place, so late fetches and
   * timers must stand down. A locked page has no switcher; the token catches a remount of this mode. */
  const mountToken = {};
  if (rrmc) root.vmKnockoutMount = mountToken;
  const isMounted = () => {
    if (!rrmc) return true;
    const select = root.parentElement?.querySelector(':scope > .vm-switcher .vm-switcher-select');
    return root.vmKnockoutMount === mountToken && (!select || select.value === 'head-to-head');
  };

  /* RRMC: the podium's rose-gold bar, in the switcher row beside the dropdown (or above the stage
   * when locked). Outside the stage so repaints keep it; removed when the mode is switched away. */
  const mountProgress = () => {
    root.parentElement?.querySelectorAll(':scope > .vm-knockout-progress, :scope > .vm-switcher > .vm-knockout-progress')
      .forEach((node) => node.remove());
    const track = el('div', 'vm-knockout-progress');
    track.setAttribute('aria-hidden', 'true');
    track.append(el('div', 'vm-knockout-progress-bar'));
    const switcher = root.previousElementSibling;
    if (switcher?.classList.contains('vm-switcher')) {
      switcher.prepend(track);
      // Never touch .has-progress: podium's own listener and the next mount share it.
      switcher.querySelector('.vm-switcher-select')
        ?.addEventListener('change', () => {
          track.remove();
          // The stage is the next mode's too: don't leave it a held scroll height.
          root.style.minHeight = '';
        }, { once: true });
    } else {
      root.before(track);
    }
    return track;
  };
  const progress = rrmc ? mountProgress() : null;
  const setProgress = (fraction) => {
    if (!progress || !isMounted()) return;
    progress.firstChild.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
  };
  // "Why this one?" reads module-wide answers; only the mounted run may set them.
  const setPanelAnswers = (answers = state.seed) => { if (isMounted()) setRrmcAnswers(answers, state.questions); };

  // The field's match for a car (listings, tradeOffs against the seed); matchCard needs `reasons`.
  const fieldMatch = (car, fallback) => {
    const m = state.matchById.get(idOf(car)) || fallback || { car };
    return { ...m, reasons: m.reasons || [] };
  };

  // An open RRMC panel describes a card about to be repainted away, so close it first.
  const closeRrmcPanel = () => {
    root.closest('.vm')?.querySelector(':scope > .vm-rrmc-why-panel.is-open .vm-rrmc-why-close')?.click();
  };

  // A status screen's head: RRMC in the podium's tagline register, everyone else as before.
  const appendHead = (screen, { kicker, title, lede }) => {
    if (rrmc) {
      screen.append(el('p', 'vm-rrmc-tagline', title), el('p', 'vm-rrmc-tagline-sub', lede));
      return;
    }
    if (kicker != null) screen.append(el('p', 'vm-kicker', kicker));
    screen.append(el('h2', 'vm-title', title), el('p', 'vm-lede', lede));
  };

  /* ---- error screen (local reimplementation of the renderStatus pattern) ---- */
  const showError = (onRetry) => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-status');
    appendHead(screen, { kicker: copy.errKicker, title: copy.errTitle, lede: copy.errLede });
    const retry = el('button', 'vm-btn vm-btn-primary', copy.retryLabel);
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    screen.append(retry);
    root.append(screen);
  };

  /* --------------------------- seed skeleton --------------------------- */
  // Painted synchronously by mount() while apiGetQuestions is in flight (reuses
  // the swipe seed's skeleton/tile classes — the seed step is deliberately
  // identical between the two games).
  const renderSeedSkeleton = () => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-mingle-seed');
    screen.setAttribute('aria-busy', 'true');
    screen.setAttribute('aria-label', 'Loading');
    screen.append(
      el('div', 'vm-skel vm-skel-kicker'),
      el('div', 'vm-skel vm-skel-title'),
      el('div', 'vm-skel vm-skel-lede'),
      el('div', 'vm-skel vm-mingle-skel-tiles'),
      el('div', 'vm-skel vm-mingle-skel-tiles'),
    );
    root.append(screen);
  };

  /* ---------------------------- seed step ----------------------------
   * Identical in shape to the swipe game's seed: budget (the engine's hard
   * filter) + what the car's for, both built from the engine's own per-brand
   * questions (state.questions), never local copy. Reuses the .vm-mingle-seed /
   * .vm-mingle-tile classes so the two games' seed steps look the same. */
  const renderSeed = (preset) => {
    if (rrmc && renderRrmcSeed(preset)) return;
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-mingle-seed vm-knockout-seed');
    screen.append(el('p', 'vm-kicker vm-mingle-wordmark', copy.wordmark));
    screen.append(el('h2', 'vm-title', copy.seedTitle));
    screen.append(el('p', 'vm-lede', copy.seedLede));

    const budgetQ = state.questions.find((q) => q.id === 'budget');
    const useQ = state.questions.find((q) => q.id === 'primaryUse');
    const budgetBands = budgetBandsFromQuestion(budgetQ);
    const useTiles = useTilesFromQuestion(useQ);

    const chosen = { budget: preset?.budget || null, primaryUse: preset?.primaryUse || null };
    const cta = el('button', 'vm-btn vm-btn-primary vm-mingle-seed-cta', copy.seedCta);
    cta.type = 'button';
    const refreshCta = () => { cta.disabled = !(chosen.budget && chosen.primaryUse); };

    // Budget bands — ceilings and open-top scale to the brand's slider max.
    screen.append(el('p', 'vm-mingle-seed-label', budgetQ?.title || copy.budgetLabel));
    const budgetRow = el('div', 'vm-mingle-tiles vm-mingle-tiles-budget');
    budgetBands.forEach(({ label, range }) => {
      const tile = el('button', 'vm-mingle-tile', label);
      tile.type = 'button';
      const isSel = chosen.budget && chosen.budget[0] === range[0] && chosen.budget[1] === range[1];
      if (isSel) tile.classList.add('is-selected');
      tile.addEventListener('click', () => {
        chosen.budget = range;
        budgetRow.querySelectorAll('.vm-mingle-tile').forEach((t) => t.classList.remove('is-selected'));
        tile.classList.add('is-selected');
        refreshCta();
      });
      budgetRow.append(tile);
    });
    screen.append(budgetRow);

    // What's it for — the engine's primaryUse options, brand labels + subs.
    screen.append(el('p', 'vm-mingle-seed-label', useQ?.title || copy.useLabel));
    const useRow = el('div', 'vm-mingle-tiles vm-mingle-tiles-use');
    useTiles.forEach(({ value, label, sub }) => {
      const tile = el('button', 'vm-mingle-tile vm-mingle-tile-use');
      tile.type = 'button';
      tile.append(el('span', 'vm-mingle-tile-label', label));
      if (sub) tile.append(el('span', 'vm-mingle-tile-hint', sub));
      if (chosen.primaryUse === value) tile.classList.add('is-selected');
      tile.addEventListener('click', () => {
        chosen.primaryUse = value;
        useRow.querySelectorAll('.vm-mingle-tile').forEach((t) => t.classList.remove('is-selected'));
        tile.classList.add('is-selected');
        refreshCta();
      });
      useRow.append(tile);
    });
    screen.append(useRow);

    refreshCta();
    cta.addEventListener('click', () => {
      state.seed = { budget: chosen.budget, primaryUse: chosen.primaryUse };
      loadField();
    });
    screen.append(cta);
    root.append(screen);
  };

  /* RRMC's seed: every podium question, in its order, wording and controls; budget rides in the
   * gate's drawer, never its own block. Returns false with no questions, so the generic seed paints. */
  const renderRrmcSeed = (preset) => {
    const asked = state.questions.filter((q) => q.id !== 'budget');
    if (!asked.length) return false;
    root.replaceChildren();
    setProgress(0);
    const screen = el('div', 'vm-screen vm-mingle-seed vm-knockout-seed');
    screen.append(el('p', 'vm-rrmc-tagline', copy.seedTitle), el('p', 'vm-rrmc-tagline-sub', copy.seedLede));

    const chosen = { ...(preset || {}) };
    const budgetQ = state.questions.find((q) => q.id === 'budget');
    const cta = el('button', 'vm-btn vm-btn-primary vm-mingle-seed-cta', copy.seedCta);
    cta.type = 'button';
    const blocks = new Map();
    const wrap = el('div', 'vm-knockout-qs-list');

    // Podium's buildControl: range or value slider, else the option pills.
    const buildControl = (q, onChange) => {
      if (q.type === 'slider') {
        const box = el('div', 'vm-options vm-slider');
        if (q.range) renderRangeSlider(box, q, chosen, { onChange });
        else renderValueSlider(box, q, chosen, { onChange });
        return box;
      }
      return renderOptionList(q, chosen, { onChange }).list;
    };
    const buildBlock = (q) => {
      const block = el('div', 'vm-knockout-q');
      // data-qid picks up the podium's per-question title tracking.
      block.dataset.qid = q.id;
      block.append(el('h3', 'vm-question', q.title));
      const drawer = q.id === 'budgetGate' && budgetQ
        ? renderBudgetDrawer(budgetQ, chosen, { onChange: () => sync() }) : null;
      block.append(buildControl(q, () => { drawer?.sync(); sync(); }));
      if (drawer) block.append(drawer.drawer);
      return block;
    };
    // Podium's syncQuestions: splice conditional blocks in and out in place, keep the rest untouched.
    function sync() {
      const visible = visibleQuestions(asked, chosen);
      const wanted = new Set(visible.map((q) => q.id));
      [...wrap.children].forEach((node) => {
        if (!wanted.has(node.dataset.qid)) { node.remove(); blocks.delete(node.dataset.qid); }
      });
      visible.forEach((q, i) => {
        if (!blocks.has(q.id)) blocks.set(q.id, buildBlock(q));
        const node = blocks.get(q.id);
        if (wrap.children[i] !== node) wrap.insertBefore(node, wrap.children[i] || null);
      });
      cta.disabled = !visible.every((q) => isAnswered(chosen[q.id]));
      refreshTail();
    }

    /* The provenance strip in podium's own tail markup (so its RRMC tail styling applies): the
     * highest-value stock until a price range is set, then the closest to the answers so far. */
    const tail = el('div', 'vm-podium-tail');
    tail.hidden = true;
    const tailGrid = el('div', 'vm-podium-tail-grid');
    tail.append(el('h3', 'vm-subhead vm-podium-tail-head', copy.tailHeading), tailGrid);
    // Wider than the seed column and centred on the page, with equal space either side.
    centreOnPage(tail);
    let tailKey = null;
    let tailTimer = 0;
    let tailSeq = 0;
    function refreshTail() {
      const query = chosen.budgetGate === 'yes' ? { ...chosen } : { budgetGate: 'no' };
      const key = JSON.stringify(query);
      if (key === tailKey) return;
      const first = tailKey === null;
      tailKey = key;
      clearTimeout(tailTimer);
      tailTimer = setTimeout(async () => {
        if (!tail.isConnected || !isMounted()) return;
        tailSeq += 1;
        const seq = tailSeq;
        const matches = await apiPreview(ctx.api, query, ctx.retailer, ctx.brand, ctx.scope, true);
        // Gone once the field loads (the seed screen is replaced), and a newer request wins.
        if (seq !== tailSeq || !tail.isConnected || !isMounted()) return;
        const shown = matches.filter((m) => m?.car).slice(0, TAIL_MAX);
        setPanelAnswers(query);
        tailGrid.replaceChildren(...shown.map((m) => matchCard(
          { ...m, reasons: m.reasons || [] }, { compact: true, brand: ctx.brand },
        )));
        tail.hidden = !shown.length;
      }, first ? 0 : 400);
    }
    sync();

    cta.addEventListener('click', () => {
      state.seed = { ...chosen };
      loadField();
    });
    const list = el('div', 'vm-knockout-qs');
    list.append(wrap, cta);
    screen.append(list, tail);
    root.append(screen);
    return true;
  };

  /* --------------------------- field loading --------------------------- */
  const loadField = async () => {
    renderFieldSkeleton();
    // apiField resolves-empty (never throws), so no try/catch needed here. We
    // ask for a full MAX_FIELD roster (up to 16) rather than the questions
    // drawer's top-9 shortlist — a big-range brand like BMW fills a Round of 16,
    // a thinner one like MINI returns fewer and largestPowerOfTwo snaps down. No
    // enrich: painting all 16 would fetch a PDP per round-one loser, so the
    // face-off card falls back to a neutral swatch (swatchFor handles absent colour).
    const matches = await apiField(
      ctx.api, state.seed, ctx.retailer, ctx.brand, ctx.scope, MAX_FIELD,
    );
    if (!isMounted()) return;
    // Field returns match objects { car, score, ... }; the game plays with the
    // display cars, exactly as the swipe game does with match.car — but we no
    // longer THROW AWAY the engine's per-car score. Stash it (keyed by stable
    // identity) so each tie can say whether the winner was the engine's form pick
    // or an underdog. This is the engine signal the mode used to discard.
    state.scoreById = new Map();
    state.matchById = new Map();
    for (const m of matches) {
      if (m?.car && typeof m.score === 'number') {
        state.scoreById.set(idOf(m.car), m.score);
      }
      if (m?.car) state.matchById.set(idOf(m.car), m);
    }
    // Shuffle for a fresh draw, then float the real-photo cars to the front (a
    // photo-less or shared-placeholder contender doesn't read as a head-to-head —
    // §3.5) before snapping to a power of two. We over-fetch MAX_FIELD and usually
    // play 8, so the weak-image cars fall into the discarded tail; only a thin or
    // photo-poor feed lets them onto the pitch as filler.
    const cars = photosFirst(shuffle(matches.map((m) => m.car).filter(Boolean)), (c) => c?.photo);
    const size = largestPowerOfTwo(Math.min(cars.length, MAX_FIELD));
    if (size < MIN_FIELD) {
      renderEmptyPool();
      return;
    }
    // Seed the field: take the snapped power-of-two off the top of the shuffle.
    state.fieldSize = size;
    state.round = cars.slice(0, size);
    state.roundIndex = 0;
    state.winners = [];
    state.rounds = [];
    startRound();
  };

  const renderFieldSkeleton = () => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-knockout-stage');
    screen.setAttribute('aria-busy', 'true');
    screen.setAttribute('aria-label', 'Seeding the bracket');
    const faceoff = el('div', 'vm-knockout-faceoff');
    faceoff.append(
      el('div', 'vm-skel vm-knockout-skel-card'),
      el('div', 'vm-skel vm-knockout-skel-card'),
    );
    screen.append(faceoff);
    root.append(screen);
  };

  const renderEmptyPool = () => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-status');
    appendHead(screen, {
      title: copy.emptyPoolTitle,
      lede: copy.emptyPoolLede({ retailer: ctx.retailerLabel || copy.retailerFallback || 'this retailer' }),
    });
    const back = el('button', 'vm-btn vm-btn-primary', copy.emptyPoolCta);
    back.type = 'button';
    back.addEventListener('click', () => renderSeed(state.seed));
    screen.append(back);
    root.append(screen);
  };

  /* ----------------------------- rounds ----------------------------- */
  // Begin a round from state.round (the entrants). One entrant → champion.
  const startRound = () => {
    if (state.round.length <= 1) {
      showResult(state.round[0]);
      return;
    }
    state.pairings = pairUp(state.round);
    state.matchIndex = 0;
    state.winners = [];
    renderMatchup();
  };

  /*
   * The per-tie verdict, from the engine's own scores: did the winner the player
   * just picked out-rate the loser ('form' pick), or did an underdog go through
   * ('upset')? Returns null when either car is unscored or they're level — no
   * scored comparison to make, so we stay quiet rather than invent a verdict.
   * This is the engine signal the mode used to discard, surfaced as one concrete
   * beat per pick instead of an abstract meter.
   */
  const verdictFor = (winner, loser) => {
    const w = state.scoreById.get(idOf(winner));
    const l = state.scoreById.get(idOf(loser));
    if (typeof w !== 'number' || typeof l !== 'number' || w === l) return null;
    return { kind: w > l ? 'form' : 'upset', winner };
  };

  // Render the verdict from the LAST pick as a small tag at the top of the next
  // matchup (state.lastVerdict is set in pick(), cleared once shown). Null → the
  // matchup just paints without one (first tie, or an unscored/level pair).
  const renderVerdict = () => {
    const v = state.lastVerdict;
    state.lastVerdict = null;
    if (!v) return null;
    const model = nameOf(v.winner) || 'your pick';
    const tag = el('div', `vm-knockout-verdict vm-knockout-verdict-${v.kind}`);
    tag.setAttribute('role', 'status');
    tag.append(el('span', 'vm-knockout-verdict-text',
      v.kind === 'form' ? copy.verdictForm({ model }) : copy.verdictUpset({ model })));
    return tag;
  };

  /* RRMC: a pick holds the page where it is. The stage keeps its height through the swap (and any
   * round banner), the scroll is put back once the next pair paints, and the hold lifts when its
   * photos have loaded, so choosing never jumps the page. */
  let heldScroll = null;
  const holdScroll = () => {
    heldScroll = window.scrollY;
    root.style.minHeight = `${root.offsetHeight}px`;
  };
  const releaseScroll = ({ restore = false } = {}) => {
    if (heldScroll === null) return;
    const y = heldScroll;
    heldScroll = null;
    if (restore) window.scrollTo({ top: y, behavior: 'instant' });
    const photos = [...root.querySelectorAll('img')].map((img) => (img.complete
      ? Promise.resolve() : new Promise((done) => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); })));
    const lift = () => { if (heldScroll === null) root.style.minHeight = ''; };
    Promise.race([Promise.all(photos), new Promise((done) => { setTimeout(done, 2000); })]).then(lift);
  };

  const renderMatchup = () => {
    root.replaceChildren();
    const [a, b] = state.pairings[state.matchIndex];
    const entrants = state.round.length;

    const screen = el('div', 'vm-screen vm-knockout-stage');
    if (rrmc) {
      setProgress(state.rounds.length / Math.max(1, state.fieldSize - 1));
      // "Why this one?" phrases each tile against what the seed actually asked.
      setPanelAnswers();
    }

    // Progress rail — where we are in the tournament (round name + match n of m).
    const rail = el('div', 'vm-knockout-rail');
    rail.append(el('span', 'vm-knockout-round', roundLabel(entrants)));
    rail.append(el('span', 'vm-knockout-count',
      copy.matchupProgress({ done: state.matchIndex + 1, total: state.pairings.length })));
    screen.append(rail);
    // The verdict from the tie the player just settled (engine's form pick, or an
    // upset) — a concrete per-pick beat where the abstract "form" meter used to be.
    const verdict = renderVerdict();
    if (verdict) screen.append(verdict);

    screen.append(el('p', 'vm-lede vm-knockout-hint', copy.pickHint));

    const faceoff = el('div', 'vm-knockout-faceoff');
    faceoff.append(buildContender(a, 'a'));
    faceoff.append(el('div', 'vm-knockout-vs', copy.versus));
    faceoff.append(buildContender(b, 'b'));
    screen.append(faceoff);

    // The "tale of the tape" panel — up to three REAL, brand-appropriate metrics
    // compared side by side, the better value highlighted, so the duel shows a
    // reason rather than being pure looks-and-price. Driven by the per-brand
    // statRows(a, b) hook; when nothing honest survives (metrics missing on
    // either car) it returns null and nothing paints, so a broken or empty panel
    // can never appear.
    const tale = buildStatPanel(a, b);
    if (tale) screen.append(tale);

    root.append(screen);
    // The next pair is on the page: put the scroll back where the pick left it.
    if (rrmc) releaseScroll({ restore: true });

    // Arrow-key a11y: ← picks the left contender, → the right.
    screen.tabIndex = -1;
    screen.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); pick(a, b, 'a'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pick(b, a, 'b'); }
    });
  };

  /* RRMC contender: the podium's white tile (matchCard, so its links and panels work) with a
   * pick button beneath. Not a <button> wrapper, which can't hold the tile's own buttons. */
  const buildRrmcContender = (car, side) => {
    const wrap = el('div', `vm-knockout-card vm-knockout-card-${side} vm-knockout-tile`);
    wrap.append(matchCard(fieldMatch(car), { compact: true, brand: ctx.brand, fitName: 'line' }));
    const choose = el('button', 'vm-btn vm-btn-primary vm-knockout-pick', copy.pickCta);
    choose.type = 'button';
    choose.setAttribute('aria-label', copy.pickLabel({ model: nameOf(car) }));
    const [pa, pb] = state.pairings[state.matchIndex];
    const other = car === pa ? pb : pa;
    choose.addEventListener('click', () => pick(car, other, side));
    wrap.append(choose);
    return wrap;
  };

  // One contender card — a lean face-off card (not the swipe stack). `side` is
  // 'a'|'b' for the fly-out direction of the loser.
  const buildContender = (car, side) => {
    if (rrmc) return buildRrmcContender(car, side);
    const card = el('button', `vm-knockout-card vm-knockout-card-${side}`);
    card.type = 'button';
    card.style.setProperty('--vm-mingle-swatch', swatchFor(car));
    card.append(el('div', 'vm-mingle-card-colour'));

    // Corner side badge (A / B) — the light-touch "opposing corners" framing that
    // helps the pair read as a versus, not a two-item list. Bold on MINI, quiet on
    // BMW (both via CSS); aria-hidden, the button label already carries the model.
    const badge = el('span', 'vm-knockout-corner', side === 'a' ? 'A' : 'B');
    badge.setAttribute('aria-hidden', 'true');
    card.append(badge);

    const media = el('div', 'vm-mingle-card-media');
    if (car.photo) {
      const img = el('img', 'vm-mingle-card-photo');
      img.src = car.photo; img.alt = car.name || ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); media.classList.add('no-photo'); });
      media.append(img);
    } else {
      media.classList.add('no-photo');
      media.append(el('span', 'vm-mingle-card-initial', (car.name || '?').charAt(0)));
    }
    card.append(media);

    const body = el('div', 'vm-mingle-card-body');
    if (car.name) body.append(el('h3', 'vm-mingle-card-name', car.name));
    if (car.line) body.append(el('p', 'vm-mingle-card-spec', car.line));
    body.append(el('p', 'vm-mingle-card-price', priceLabel(car)));
    const pills = el('div', 'vm-mingle-pills');
    if (car.fuel) pills.append(el('span', 'vm-mingle-pill', cap(car.fuel)));
    if (car.body) pills.append(el('span', 'vm-mingle-pill', cap(car.body)));
    body.append(pills);
    card.append(body);

    // Clicking the card picks it; the OTHER card is the loser.
    const [pa, pb] = state.pairings[state.matchIndex];
    const other = car === pa ? pb : pa;
    card.addEventListener('click', () => pick(car, other, side));
    return card;
  };

  // The "tale of the tape" panel for the current pair, from the per-brand
  // statRows(a, b) hook. Returns a framed DOM panel or null (nothing to show).
  // The hook returns an array of row objects, in priority order:
  //   { label, aText, bText, winner: 'a' | 'b' | null, tier: 'listing' | 'model' }
  // buildStatPanel is the honest-data gatekeeper for the whole panel:
  //   1. call the hook under a throw guard (a bad hook shows nothing, never crashes);
  //   2. keep only well-formed rows (label + both texts present);
  //   3. enforce the model-tier rule: a tier:'model' row (0-62, shared by every
  //      listing of a line) may only SUPPORT a real per-listing row, so if no
  //      listing row survives the model rows are dropped and the panel with them;
  //   4. cap at the first three survivors (a duel, not a spec sheet);
  //   5. tally how many rows each side wins, for the "A wins N of M" chip.
  // Each row's winning side gets the is-winner class the CSS highlights; a tie
  // (winner null) leaves both plain, so no side is ever falsely crowned.
  const buildStatPanel = (a, b) => {
    if (typeof copy.statRows !== 'function') return null;
    let rows;
    try {
      rows = copy.statRows(a, b);
    } catch {
      return null;
    }
    // Tolerate a hook that returns a single row object instead of an array.
    if (rows && !Array.isArray(rows)) rows = [rows];
    if (!Array.isArray(rows)) return null;

    const valid = rows.filter((r) => r && r.label && r.aText != null && r.bText != null);
    // Model rows are supporting-only: drop them all if no real per-listing row
    // survives, so a matchup is never described purely by a shared model figure.
    const hasListing = valid.some((r) => r.tier !== 'model');
    const kept = firstRows(hasListing ? valid : valid.filter((r) => r.tier !== 'model'), 3);
    if (kept.length === 0) return null;

    const wins = { a: 0, b: 0 };
    for (const r of kept) if (r.winner === 'a' || r.winner === 'b') wins[r.winner] += 1;

    const panel = el('div', 'vm-knockout-tale');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', copy.taleTitle || 'Tale of the tape');

    const head = el('div', 'vm-knockout-tale-head');
    head.append(el('span', 'vm-knockout-tale-title', copy.taleTitle || 'Tale of the tape'));
    // Tally chip: only when there's a clear leader across at least two rows, so a
    // single-row panel or a level face-off doesn't get a redundant "wins 1 of 1".
    const leader = wins.a > wins.b ? 'a' : (wins.b > wins.a ? 'b' : null);
    // A brand without A/B corners (RRMC) has nothing for "A wins" to point at, so it opts out.
    if (leader && kept.length >= 2 && copy.showTally !== false) {
      const label = leader === 'a' ? 'A' : 'B';
      head.append(el('span', 'vm-knockout-tale-tally',
        `${label} wins ${wins[leader]} of ${kept.length}`));
    }
    panel.append(head);

    const sideEl = (text, side, winner) => {
      const cell = el('span', `vm-knockout-stat-side vm-knockout-stat-${side}`);
      if (winner === side) {
        cell.classList.add('is-winner');
        const tick = el('span', 'vm-knockout-stat-tick', '✓');
        tick.setAttribute('aria-hidden', 'true');
        cell.append(tick);
      }
      cell.append(el('span', 'vm-knockout-stat-val', String(text)));
      return cell;
    };

    for (const r of kept) {
      const row = el('div', 'vm-knockout-stat-row');
      row.setAttribute('aria-label', `${r.label} head to head`);
      row.append(sideEl(r.aText, 'a', r.winner));
      row.append(el('span', 'vm-knockout-stat-label', r.label));
      row.append(sideEl(r.bText, 'b', r.winner));
      panel.append(row);
    }
    return panel;
  };

  // Record a pick: winner advances, loser is logged (for the advancement-weighted
  // inference), the losing card flies out (gated on reduced-motion), and we move
  // to the next matchup or round. `busy` blocks a double-pick mid-transition.
  const pick = (winner, loser, side) => {
    if (state.busy) return;
    state.busy = true;
    if (rrmc) closeRrmcPanel();

    state.rounds.push({ roundIndex: state.roundIndex, winner, loser });
    state.winners.push(winner);
    // Read the engine's take on the tie just settled, to show on the next paint.
    state.lastVerdict = verdictFor(winner, loser);

    if (rrmc) holdScroll();
    const advance = () => {
      if (!isMounted()) return;
      state.busy = false;
      if (state.matchIndex + 1 < state.pairings.length) {
        state.matchIndex += 1;
        renderMatchup();
      } else {
        // Round complete — the winners become the next round's entrants. Make a
        // ceremony of it: a sweep banner naming the round we're entering, or the
        // big Final interstitial when it's down to the last two.
        state.round = state.winners;
        state.roundIndex += 1;
        advanceRound();
      }
    };

    if (reducedMotion) { advance(); return; }
    // Fly the loser's card out; the winner's card lifts. Loser side is the
    // opposite of the winner's side (the winner is `side`).
    // RRMC's tiles are divs, so their pick buttons are what get disabled.
    const cards = root.querySelectorAll('.vm-knockout-card, .vm-knockout-pick');
    const loserSel = side === 'a' ? '.vm-knockout-card-b' : '.vm-knockout-card-a';
    const winnerSel = side === 'a' ? '.vm-knockout-card-a' : '.vm-knockout-card-b';
    root.querySelector(loserSel)?.classList.add(side === 'a' ? 'is-out-right' : 'is-out-left');
    root.querySelector(winnerSel)?.classList.add('is-crowned');
    cards.forEach((c) => { c.disabled = true; });
    // RRMC: the leaving pair's own buttons (Why, View Options, links) go quiet for the fly-out.
    if (rrmc) root.querySelectorAll('.vm-knockout-tile').forEach((tile) => { tile.inert = true; });
    setTimeout(advance, 300);
  };

  /* --------------------------- round ceremony --------------------------- */
  // Between rounds we make "moving on" a moment. One survivor → the champion
  // reveal. Two survivors → the Final gets a dedicated interstitial (one tap, the
  // climax earns it). Otherwise a quick banner sweep names the round you're
  // entering, then the next matchup paints. Under reduced motion the sweep is
  // skipped (it would just flash) and we go straight to the round.
  const advanceRound = () => {
    const survivors = state.round.length;
    if (survivors <= 1) { startRound(); return; }
    if (survivors === 2) { renderRoundInterstitial(); return; }
    if (reducedMotion) { startRound(); return; }
    renderRoundSweep(survivors);
  };

  // A full-width banner that sweeps across the stage naming the round the player
  // is entering, then hands off to the round. Self-timed (~800ms) so it's a beat,
  // not a wait.
  const renderRoundSweep = (survivors) => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-knockout-stage vm-knockout-sweep-stage');
    const banner = el('div', 'vm-knockout-sweep');
    banner.append(el('span', 'vm-knockout-sweep-round', roundLabel(survivors)));
    banner.append(el('span', 'vm-knockout-sweep-sub',
      copy.roundAdvance({ round: roundLabel(survivors), survivors })));
    screen.append(banner);
    root.append(screen);
    window.setTimeout(() => { if (isMounted()) startRound(); }, 800);
  };

  // The Final gets its own screen: the two finalists as crests, the "The Final"
  // headline, and a single tap to begin. This is the one deliberate extra tap in
  // the flow, and only ever once. Reduced motion keeps the screen (it's content,
  // not motion) — the JS just doesn't animate the crest entrance.
  const renderRoundInterstitial = () => {
    // The Final is a new moment: no scroll to keep, so just let the stage size itself again.
    if (rrmc) releaseScroll();
    root.replaceChildren();
    const [a, b] = state.round;
    const screen = el('div', 'vm-screen vm-knockout-interstitial');
    if (!reducedMotion) screen.classList.add('is-revealing');
    if (!reducedMotion) celebrate(screen, { brand: ctx.brand });

    const crests = el('div', 'vm-knockout-crests');
    crests.append(buildCrest(a), el('div', 'vm-knockout-vs', copy.versus), buildCrest(b));
    if (rrmc) {
      screen.append(el('p', 'vm-rrmc-tagline', copy.finalTitle),
        el('p', 'vm-rrmc-tagline-sub', copy.finalLede), crests);
    } else {
      screen.append(el('p', 'vm-kicker vm-knockout-final-kicker', copy.finalKicker));
      screen.append(el('h2', 'vm-title', copy.finalTitle));
      screen.append(crests);
      screen.append(el('p', 'vm-lede', copy.finalLede));
    }

    const cta = el('button', 'vm-btn vm-btn-primary', copy.finalCta);
    cta.type = 'button';
    cta.addEventListener('click', startRound);
    screen.append(cta);
    root.append(screen);
    cta.focus();
  };

  // A small "crest" for a finalist on the interstitial — the paint colour, the
  // initial/photo, and the name. Lighter than a full contender card.
  const buildCrest = (car) => {
    const crest = el('div', 'vm-knockout-crest');
    crest.style.setProperty('--vm-mingle-swatch', swatchFor(car));
    const disc = el('div', 'vm-knockout-crest-disc');
    if (car.photo) {
      const img = el('img', 'vm-knockout-crest-photo');
      img.src = car.photo; img.alt = car.name || ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); disc.classList.add('no-photo'); });
      disc.append(img);
    } else {
      disc.classList.add('no-photo');
      disc.append(el('span', 'vm-mingle-card-initial', (car.name || '?').charAt(0)));
    }
    crest.append(disc);
    if (car.name) crest.append(el('span', 'vm-knockout-crest-name', nameOf(car)));
    return crest;
  };

  /* --------------------------- result --------------------------- */
  // The champion is the lone survivor of the bracket. We STILL call the real
  // engine (the same call the questionnaire mode makes) — not to pick the hero (the
  // champion is always the hero, decision "champion, engine validates") but to
  // attach its real "why" reasons and to know when to add the honest note.
  const showResult = async (champion) => {
    if (rrmc) releaseScroll();
    renderResultSkeleton();
    const inferred = bracketToAnswers(state.rounds, state.seed);
    // RRMC answered every question outright, so its own answers outrank anything the picks inferred.
    const answers = rrmc ? { ...inferred, ...state.seed } : inferred;
    let result;
    try {
      result = await apiMatch(ctx.api, answers, ctx.retailer, ctx.brand, ctx.scope);
    } catch {
      if (isMounted()) showError(() => showResult(champion));
      return;
    }
    if (!isMounted()) return;
    renderResult(champion, result);
  };

  const renderResultSkeleton = () => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-mingle-result');
    screen.setAttribute('aria-busy', 'true');
    screen.setAttribute('aria-label', 'Crowning your champion');
    screen.append(
      el('div', 'vm-skel vm-skel-title'),
      el('div', 'vm-skel vm-mingle-skel-hero'),
    );
    root.append(screen);
  };

  const renderResult = (champion, result) => {
    root.replaceChildren();
    const matches = result.matches || [];

    // Find the champion in the engine's feasible set (by stable identity) to
    // borrow its real reasons/score. If it isn't there, the engine didn't rank it
    // feasible for the assembled brief — that's precisely the honest-note case.
    const engineMatch = matches.find((m) => idOf(m.car) === idOf(champion));
    const reasons = engineMatch?.reasons || [];
    const weak = !engineMatch
      || (typeof engineMatch.score === 'number' && engineMatch.score < WEAK_SCORE)
      || hasUnmet(result.unmet);
    if (rrmc) {
      renderRrmcResult(champion, matches, weak);
      return;
    }

    const screen = el('div', 'vm-screen vm-mingle-result vm-knockout-result');
    if (!reducedMotion) celebrate(screen, { brand: ctx.brand });

    screen.append(el('p', 'vm-kicker vm-mingle-match-kicker', copy.matchKicker));
    screen.append(el('h2', 'vm-title', copy.matchTitle({ model: champion.name })));
    screen.append(el('p', 'vm-lede', copy.matchLede));

    // Hero card — always the CHAMPION the player crowned (never swapped out).
    screen.append(buildHero(champion));

    // Why — the engine's real reasons for the champion, flirtily introduced, with
    // a crown callback. Only shown when the engine actually returned reasons.
    if (reasons.length) {
      const why = el('div', 'vm-mingle-why');
      why.append(el('p', 'vm-mingle-why-intro', copy.whyIntro));
      const list = el('ul', 'vm-mingle-why-list');
      reasons.forEach((r) => list.append(el('li', 'vm-mingle-why-item', r)));
      why.append(list);
      const beaten = beatenLabel();
      if (beaten) why.append(el('p', 'vm-mingle-callback', copy.crownCallback({ beaten })));
      screen.append(why);
    }

    // The one honest beat — when the engine can't fully back the crown (§6.2
    // pattern). Celebrate anyway; add a soft note, and (if there's a different
    // engine favourite) name it as a supportive aside, without swapping the hero.
    if (weak) {
      screen.append(el('p', 'vm-mingle-weak-note', copy.weakNote.replace(/\*(.+?)\*/g, '$1')));
      const top = matches[0];
      if (top && idOf(top.car) !== idOf(champion) && top.car?.name) {
        screen.append(el('p', 'vm-mingle-weak-note vm-knockout-also', copy.alsoNote({ model: top.car.name })));
      }
    }

    screen.append(buildResultCtas(champion));
    root.append(screen);
  };

  /* RRMC's result, laid out as the podium: tagline, the champion as the wide purple tile, the
   * finalist (and, when the numbers disagree, the engine's pick) as white "Another Option" tiles. */
  const renderRrmcResult = (champion, matches, weak) => {
    root.replaceChildren();
    setProgress(1);
    setPanelAnswers();
    const screen = el('div', 'vm-screen vm-mingle-result vm-knockout-result');
    if (!reducedMotion) celebrate(screen, { brand: ctx.brand });

    const beaten = beatenLabel();
    screen.append(
      el('p', 'vm-rrmc-tagline', copy.matchTitle({ model: nameOf(champion) })),
      el('p', 'vm-rrmc-tagline-sub', [copy.matchLede, beaten && copy.crownCallback({ beaten })]
        .filter(Boolean).join(' ')),
    );

    const step = (car, rank, match) => {
      const gold = rank === 'is-gold';
      const node = el('div', `vm-knockout-step ${rank}${gold ? '' : ' vm-knockout-tile'}`);
      node.append(
        el('p', 'vm-knockout-rank', gold ? copy.matchKicker : copy.rankOther),
        // Field matches carry tradeOffs against the seed, which is all "Why this one?" may claim.
        matchCard(fieldMatch(car, match && { ...match, tradeOffs: [] }), {
          compact: !gold, brand: ctx.brand, fitName: gold ? true : 'line',
        }),
      );
      return node;
    };
    const runnerUp = state.rounds[state.rounds.length - 1]?.loser;
    const top = matches[0];
    const engineAlt = weak && top?.car && ![champion, runnerUp].some((c) => c && idOf(c) === idOf(top.car));
    const steps = el('div', 'vm-knockout-steps');
    steps.append(step(champion, 'is-gold'));
    if (runnerUp) steps.append(step(runnerUp, 'is-silver'));
    if (engineAlt) steps.append(step(top.car, 'is-bronze', top));
    const podium = el('div', 'vm-knockout-podium');
    podium.append(steps);
    screen.append(podium);

    if (weak) {
      screen.append(el('p', 'vm-mingle-weak-note', copy.weakNote));
      if (engineAlt) {
        screen.append(el('p', 'vm-mingle-weak-note vm-knockout-also', copy.alsoNote({ model: nameOf(top.car) })));
      }
    }
    screen.append(buildResultCtas(champion));
    root.append(screen);
  };

  // A short human phrase for who the champion beat — "three rivals", or the name
  // of the finalist if we can read it. Powers the crown callback in the "why".
  const beatenLabel = () => {
    const wins = state.rounds.filter((r) => idOf(r.winner) === championId()).length;
    if (wins <= 0) return null;
    if (wins === 1) {
      const final = state.rounds[state.rounds.length - 1];
      const loserName = final?.loser?.name && nameOf(final.loser);
      return loserName ? `the ${loserName}` : 'its rival';
    }
    const words = copy.rivalWords || ['', 'one rival', 'two rivals', 'three rivals', 'four rivals'];
    return words[wins] || `${wins} rivals`;
  };
  const championId = () => {
    const final = state.rounds[state.rounds.length - 1];
    return final ? idOf(final.winner) : null;
  };

  const hasUnmet = (unmet) => unmet && Object.values(unmet).some((v) => Array.isArray(v) && v.length);

  const buildHero = (car) => {
    const card = el('article', 'vm-mingle-hero');
    // Entrance: a spring/precise settle as the champion is crowned (CSS).
    if (!reducedMotion) card.classList.add('is-revealing');
    card.style.setProperty('--vm-mingle-swatch', swatchFor(car));
    card.append(el('div', 'vm-mingle-card-colour'));
    const media = el('div', 'vm-mingle-card-media');
    if (car.photo) {
      const img = el('img', 'vm-mingle-card-photo');
      img.src = car.photo; img.alt = car.name || ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); media.classList.add('no-photo'); });
      media.append(img);
    } else {
      media.classList.add('no-photo');
      media.append(el('span', 'vm-mingle-card-initial', (car.name || '?').charAt(0)));
    }
    card.append(media);
    const body = el('div', 'vm-mingle-card-body');
    body.append(el('h3', 'vm-mingle-card-name', car.name));
    if (car.line) body.append(el('p', 'vm-mingle-card-spec', car.line));
    body.append(el('p', 'vm-mingle-card-price', priceLabel(car)));
    const pills = el('div', 'vm-mingle-pills');
    if (car.fuel) pills.append(el('span', 'vm-mingle-pill', cap(car.fuel)));
    if (car.body) pills.append(el('span', 'vm-mingle-pill', cap(car.body)));
    const shade = car.colour?.manufacturerColour;
    if (shade) pills.append(el('span', 'vm-mingle-pill', shade));
    body.append(pills);
    card.append(body);
    return card;
  };

  const buildResultCtas = (champion) => {
    const wrap = el('div', 'vm-mingle-ctas');
    const drive = el('a', 'vm-btn vm-btn-primary vm-mingle-drive', copy.testDriveCta);
    if (champion.link) { drive.href = champion.link; drive.target = '_blank'; drive.rel = 'noopener'; }
    wrap.append(drive);

    // RRMC's tile already links its listing twice, so it carries no separate details button.
    if (copy.detailsCta) {
      const details = el('a', 'vm-btn vm-btn-ghost', copy.detailsCta);
      if (champion.link) { details.href = champion.link; details.target = '_blank'; details.rel = 'noopener'; }
      wrap.append(details);
    }

    const share = el('button', 'vm-btn vm-btn-ghost vm-mingle-share', copy.shareCta);
    share.type = 'button';
    share.addEventListener('click', () => doShare(champion, share));
    wrap.append(share);

    const again = el('button', 'vm-mingle-link vm-mingle-again', copy.againCta);
    again.type = 'button';
    again.addEventListener('click', () => loadField()); // fresh reshuffled field, same seed
    wrap.append(again);
    return wrap;
  };

  const doShare = async (champion, btn) => {
    const text = copy.shareText({
      model: nameOf(champion), retailer: ctx.retailerLabel || copy.retailerFallback || 'MINI',
    });
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#knockout=1`;
    if (navigator.share) {
      try { await navigator.share({ text, url }); } catch { /* user dismissed — no-op */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      btn.textContent = copy.shareCopied;
    } catch { /* clipboard blocked — leave the label */ }
  };

  /* The champion-reveal confetti is the shared celebrate() helper
   * (match-signal.js) — the same crescendo the swipe game uses. */

  /* ------------------------------ boot ------------------------------
   * Same shape as the swipe game: the seed's tiles are per-brand and live behind
   * apiGetQuestions, so fetch that first. mount stays synchronous — it paints the
   * seed skeleton now and does the fetch in this detached boot(), so the shell
   * never awaits a cold backend. apiGetQuestions THROWS on failure, so guard it
   * and offer a retry that re-boots. */
  const boot = async () => {
    try {
      const { questions } = await apiGetQuestions(ctx.api, ctx.retailer, ctx.brand);
      state.questions = Array.isArray(questions) ? questions : [];
    } catch {
      if (isMounted()) showError(boot);
      return;
    }
    if (!isMounted()) return;
    renderSeed(state.seed);
  };

  renderSeedSkeleton();
  boot();
}

// A test barrel of the pure stat-row builders, so the honest-data discipline
// (return null when a value is absent on either car; younger/quicker/documented
// wins; model rows carry tier:'model') can be unit-tested DOM-free, the way
// age.test.js exercises the helpers in match-signal.js. Not used at runtime.
export const _stat = {
  lowerBetterRow,
  higherBetterRow,
  zeroTo62Row,
  ageRow,
  fshRow,
  rrmcMileageRow,
  yearRow,
  firstRows,
  // accessors + formatters, for asserting the exact rendered text
  mileageOf,
  powerOf,
  ccOf,
  topSpeedOf,
  zeroTo62Of,
  milesText,
  secsText,
  ageText,
};

// The switcher tab is brand-agnostic shell UI, so its label is neutral —
// "Head to head", not "MINI Knockout". The campaign name lives as the wordmark
// INSIDE the stage (KNOCKOUT_COPY[brand].wordmark), where it can vary by brand;
// the mode's static `label` can't. The key mirrors that label, slugified
// ('head-to-head'), so ?mode=head-to-head and the authored "Mode" value read the
// same as the tab — the file is still knockout.js, but the mode a visitor
// addresses is "head-to-head".
export default { key: 'head-to-head', label: 'Head to head', mount };
