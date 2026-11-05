import { el, screenIntro, button, factList } from '../../vehicle-matcher/ui.js';
import { matchCard, mediaWell } from '../../vehicle-matcher/modes/result-card.js';

const titles = { pending: 'Your car offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired',
  superseded: 'Offer superseded', 'earlier-run': 'Offer from an earlier demo run', 'not-found': 'Offer not found', refused: 'Offer unavailable',
  loading: 'Loading your offer', error: 'Your offer could not be loaded', uncertain: 'Checking your decision' };
const messages = { accepted: 'Your selection is recorded. Ordering and approval are separate steps.',
  declined: 'Your decline is recorded.', expired: 'This offer is no longer available to accept.',
  superseded: 'This offer has been replaced and cannot be changed.',
  'earlier-run': 'This offer belongs to an earlier demo run. It cannot be changed.',
  'not-found': 'Check the offer link or open the offer from your account.', refused: 'Open the offer from your account or use its original email link.',
  loading: 'Please wait.', uncertain: 'The current outcome is being checked. Actions are unavailable.' };
let sequence = 0;

function comparison(currentCar) {
  const section = el('section', 'gcsp-panel gcsp-offer-current');
  section.append(el('h2', 'gcsp-h2', 'Your current car'));
  if (!currentCar) {
    section.append(el('p', 'gcsp-note', 'Current-car details not supplied. Equipment is unknown.'));
    return section;
  }
  const name = currentCar.display?.name || 'Current car not supplied';
  section.append(el('h3', null, name));
  if (currentCar.status === 'partial') section.append(el('p', 'gcsp-note', 'Partial comparison. Current-car specifications and points are unknown.'));
  section.append(mediaWell(null, '', { placeholder: 'No image for this car yet', view: {
    display: { name }, media: currentCar.media || {} } }).media);
  section.append(factList(currentCar.facts || []));
  section.append(el('p', 'gcsp-note', currentCar.provenance || 'Source not supplied. Equipment is unknown unless confirmed.'));
  return section;
}

/** Compose shared primitives only; server projection owns vehicle facts, terms and decisions. */
export function createOfferView(root, { refresh, decide } = {}) {
  const page = el('div', 'vm gcsp-offer-body');
  page.id = `gcsp-offer-${++sequence}`;
  const content = el('div', 'gcsp-offer-content');
  const announcement = el('p', 'gcsp-note'); announcement.setAttribute('role', 'status');
  announcement.dataset.offerAnnouncement = '';
  announcement.setAttribute('aria-live', 'polite'); announcement.setAttribute('aria-atomic', 'true');
  page.append(content, announcement); root.replaceChildren(page);
  let lastAnnouncement = ''; let previousState; let previousIdentity; let structure;
  let messageNode; let clockNode; let asOfNode; let reasonNode;
  const announce = (text) => { if (text !== lastAnnouncement) { announcement.textContent = text; lastAnnouncement = text; } };
  function draw(model) {
    const focused = root.ownerDocument.activeElement?.dataset?.offerAction;
    content.replaceChildren();
    const state = model.state;
    content.append(screenIntro({ title: titles[state] || titles.error, level: 1 }));
    messageNode = el('p', 'gcsp-note', model.message || messages[state]);
    messageNode.hidden = !model.message && !messages[state]; content.append(messageNode);
    if (model.fixtureNotice) content.append(el('p', 'gcsp-note', model.fixtureNotice));
    if (['pending', 'accepted', 'declined', 'expired', 'superseded', 'uncertain'].includes(state) && model.card?.members?.length === 1) {
      const columns = el('div', 'gcsp-offer-comparison');
      const offer = el('section', 'gcsp-offer-exact');
      offer.setAttribute('aria-label', 'The offered car');
      const card = structuredClone(model.card); card.members[0].actions = [];
      offer.append(matchCard(null, { view: card, big: true, showScore: false }));
      columns.append(offer, comparison(model.currentCar)); content.append(columns);
    }
    if (state === 'pending') {
      clockNode = el('p', 'gcsp-countdown'); asOfNode = el('p', 'gcsp-note');
      content.append(clockNode, asOfNode);
      const actions = el('div', 'gcsp-offer-actions');
      const reason = el('p', 'gcsp-note', model.decisionUnavailable ? 'Decisions are unavailable on this page.'
        : model.checkingExpiry ? 'Checking availability. Actions are unavailable.' : 'Actions depend on current server availability.');
      reason.id = `${page.id}-decision-reason`;
      reasonNode = reason;
      for (const [kind, label, enabled] of [['accept', 'Accept this offer', model.canAccept], ['decline', 'Decline this offer', model.canDecline]]) {
        const control = button({ label, variant: kind === 'accept' ? 'primary' : 'ghost', disabled: !enabled,
          describedBy: reason.id, onClick: () => decide?.(kind) });
        control.dataset.offerAction = kind; actions.append(control);
      }
      content.append(reason, actions);
    }
    if (state !== 'loading') {
      const control = button({ label: state === 'error' ? 'Try again' : 'Check current state', variant: 'ghost', onClick: () => refresh?.() });
      control.dataset.offerAction = 'refresh'; content.append(control);
    }
    if (focused) {
      const target = content.querySelector(`[data-offer-action="${['accept', 'decline', 'refresh'].includes(focused) ? focused : 'refresh'}"]`);
      (target && !target.disabled ? target : content.querySelector('[data-offer-action="refresh"]'))?.focus();
    }
  }
  function update(model) {
    const nextStructure = JSON.stringify([model.state, model.card, model.currentCar, model.fixtureNotice]);
    // Keep the kit's own decision live region and keyboard controls mounted across clock reads.
    if (structure !== nextStructure) { draw(model); structure = nextStructure; }
    messageNode.textContent = model.message || messages[model.state] || '';
    messageNode.hidden = !messageNode.textContent;
    if (model.state === 'pending') {
      clockNode.textContent = model.countdown || 'Time remaining unavailable';
      asOfNode.textContent = model.now ? `Demo time at last check: ${model.now}` : 'Demo time unavailable';
      reasonNode.textContent = model.decisionUnavailable ? 'Decisions are unavailable on this page.'
        : model.checkingExpiry ? 'Checking availability. Actions are unavailable.' : 'Actions depend on current server availability.';
      content.querySelector('[data-offer-action="accept"]').disabled = !model.canAccept;
      content.querySelector('[data-offer-action="decline"]').disabled = !model.canDecline;
    }
    const key = `${model.state}:${model.reference?.offerId || ''}`;
    if (model.state === 'pending' && model.checkingExpiry) announce('The deadline has been reached. Checking the current offer state.');
    else if (model.state === 'pending' && model.seconds !== null && model.seconds <= 300) announce('Less than five minutes remain on this offer.');
    else if (model.state !== previousState || key !== previousIdentity) announce(titles[model.state] || titles.error);
    previousState = model.state; previousIdentity = key;
  }
  return { update, destroy() { page.remove(); } };
}
