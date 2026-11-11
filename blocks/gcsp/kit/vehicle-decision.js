import { el } from '../../vehicle-matcher/ui.js';
import { matchCard, SWATCH_HEX } from '../../vehicle-matcher/modes/result-card.js';
import { NEUTRAL_SWATCH } from '../../vehicle-matcher/modes/match-signal.js';

/** A finish stays readable; only a supported supplied shade paints its decorative swatch. */
export function finishLabel({ label, value, shade } = {}) {
  const root = el('p', 'gcsp-finish');
  const swatch = el('span', 'gcsp-finish-swatch'); swatch.setAttribute('aria-hidden', 'true');
  const colour = SWATCH_HEX[typeof shade === 'string' ? shade.toLowerCase() : ''];
  swatch.style.backgroundColor = colour || NEUTRAL_SWATCH;
  swatch.classList.toggle('is-unknown', !colour);
  root.append(swatch, el('span', null, value || `${label} not supplied`));
  return root;
}

/** Shared exact-card feature layout; actions precede media in the reading order. */
export function vehicleDecisionCard({ view, media, actions, note, finishes = [], pointsDifference } = {}) {
  const card = matchCard(null, { view, showScore: false, factsClass: 'vm-facts-pair', hideMissing: 'More details not supplied', headingLevel: 2 });
  card.classList.add('gcsp-vehicle-decision');
  const body = card.querySelector('.vm-card-body'); const mediaNode = media || card.querySelector('.vm-card-media');
  const summary = el('div', 'gcsp-vehicle-summary');
  summary.append(body.querySelector('.vm-card-head'));
  const summaryFinishes = el('div', 'gcsp-finishes'); summaryFinishes.append(...finishes.map(finishLabel));
  summary.append(summaryFinishes);
  const terms = body.querySelector('.vm-card-terms');
  const monthly = view.members[0].terms?.find((term) => term.kind === 'points-monthly');
  if (Number.isFinite(monthly?.value)) {
    const line = el('p', 'gcsp-points'); line.append(el('strong', 'gcsp-points-n', monthly.value.toLocaleString('en-GB')), ' points a month');
    terms.firstElementChild?.replaceWith(line);
    if (Number.isFinite(monthly.allowance)) terms.append(el('p', 'vm-specs', `${monthly.allowance.toLocaleString('en-GB')} points a month allowance`));
  }
  summary.append(terms);
  if (pointsDifference) summary.append(el('p', 'gcsp-vehicle-saving', pointsDifference));
  if (actions) summary.append(actions);
  if (note) summary.append(note);
  const details = el('div', 'gcsp-vehicle-details');
  const finishList = el('div', 'gcsp-finishes'); finishList.append(...finishes.map(finishLabel));
  details.append(el('h3', 'gcsp-h3 gcsp-vehicle-details-title', 'Vehicle details'), finishList, body.querySelector('.vm-card-facts'), body.querySelector('.vm-card-decision'));
  card.replaceChildren(summary, mediaNode, details);
  card.querySelector('.vm-card[data-gate="eligible"] .vm-card-gate')?.remove();
  if (card.dataset.gate === 'eligible') card.querySelector('.vm-card-gate')?.remove();
  return card;
}

/** Individually bounded cards; empty grid positions retain the page's neutral background. */
export function decisionHighlights({ benefits = [], tradeoffs = [] } = {}) {
  const root = el('div', 'gcsp-decision-highlights');
  for (const [key, title, entries] of [['benefits', 'Benefits', benefits], ['tradeoffs', 'Tradeoffs', tradeoffs]]) {
    const group = el('section', `gcsp-highlight-group gcsp-highlight-${key}`);
    group.append(el('h3', 'gcsp-h3', title));
    const cards = el('div', 'gcsp-highlight-cards');
    for (const entry of entries) {
      const card = el('div', 'gcsp-highlight'); const heading = el('p', 'gcsp-highlight-heading');
      if (entry.number !== undefined) heading.append(el('strong', 'gcsp-highlight-number', String(entry.number)), ' ');
      heading.append(entry.title); card.append(heading);
      if (entry.detail) card.append(el('p', 'gcsp-highlight-detail', entry.detail));
      cards.append(card);
    }
    if (!entries.length) cards.append(el('p', 'gcsp-note gcsp-highlight-empty', `No ${key === 'benefits' ? 'benefits' : 'tradeoffs'} confirmed.`));
    group.append(cards); root.append(group);
  }
  return root;
}
