import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { matchCard } from '../../vehicle-matcher/modes/result-card.js';
import { vehicleDecisionCard, decisionHighlights } from '../kit/vehicle-decision.js';
import { mediaGallery } from '../kit/media-gallery.js';
import { createDecisionDrawer } from './decision-drawer.js';
import { stageList } from '../kit/stage-list.js';
import { dataTable } from '../kit/data-table.js';
import { orderIdentityRows } from '../kit/order-identity.js';
import { viewStatus } from '../kit/view-status.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';
import { ACCESS_LAPSED_TITLE, RUN_RESTARTED_TITLE, accessLapsedScreen, runRestartedScreen } from '../kit/run-restarted.js';
import { followupHandle } from './followup-entry.js';

const titles = { pending: 'Your offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired',
  superseded: 'Offer superseded', 'earlier-run': 'Offer out of date', 'not-found': 'Offer not found', refused: 'Offer unavailable',
  restarted: RUN_RESTARTED_TITLE, 'access-lapsed': ACCESS_LAPSED_TITLE, loading: 'Loading your offer', error: 'Your offer could not be loaded', uncertain: 'Checking your decision' };
const messages = { accepted: 'Your selection is recorded. Ordering and approval are separate steps.',
  declined: '', expired: 'This offer is no longer available to accept. Open your account to check for a new offer.',
  superseded: 'This offer has been replaced and cannot be changed.',
  'earlier-run': 'This link is out of date. Use your latest offer email or open the offer from your account.',
  'not-found': 'Check the offer link or open the offer from your account.', refused: 'Open the offer from your account or use its original email link.',
  loading: 'Please wait.', uncertain: 'The current outcome is being checked. Actions are unavailable.' };
const blockerText = { 'contact-required': 'A valid contact phone and email are needed before you can accept.',
  'driver-review-required': 'Your driver details need review before you can accept.',
  'return-data-required': 'The details of the car you return are incomplete.',
  'ordering-terms-unavailable': 'The ordering terms are unavailable right now.' };
const stateWords = { pending: 'open for your decision', accepted: 'accepted', declined: 'declined', expired: 'expired',
  superseded: 'replaced by a newer offer', 'earlier-run': 'out of date', 'not-found': 'not found', refused: 'unavailable', uncertain: 'waiting for your decision to be confirmed' };
const REFUSED_TITLE = 'Your selection was not sent to ordering';
const isRefused = (model) => model.state === 'accepted' && model.selection?.selectionState === 'handoff-failed';
const titleFor = (model) => isRefused(model) ? REFUSED_TITLE : titles[model.state] || titles.error;
// Without a help link the support pointer stays plain text, never a dead link.
const refusedMessage = (selection, help) => {
  const ref = selection.orderReference; const base = 'The car stays reserved for you. Nothing has been ordered.';
  if (help) return ref ? `${base} Quote order reference ${ref} when you contact scheme support.` : base;
  return `${base} Contact scheme support${ref ? ` and quote order reference ${ref}` : ''}.`;
};
const selectionHeadline = (selection, help) => selection.selectionState === 'acknowledged'
  ? `Selection received. Waiting for ${selection.stages.find((stage) => stage.state === 'waiting')?.name ?? selection.current}.`
  : selection.selectionState === 'handoff-pending' ? 'Sending your selection to ordering. Ordering owns the next step. You do not need to do anything.'
    : refusedMessage(selection, help);
// The one declined line: the car's name once, plus the next step when a change question follows.
function declinedLine(card, withChange) {
  const name = card?.members?.length === 1 ? card.members[0]?.display?.name : '';
  return `${name ? `You declined the ${name}.` : 'You declined this offer.'}${withChange ? ' Change one thing and your buddy looks again.' : ''}`;
}
const messageFor = (model, help) => model.message || (model.state === 'accepted' && model.selection ? selectionHeadline(model.selection, help) : messages[model.state]);
const longDate = (value) => /^\d{4}-\d\d-\d\d$/.test(value ?? '') && Number.isFinite(Date.parse(value))
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : value;
let sequence = 0;

const decisionReason = (model) => model.decisionUnavailable ? 'Decisions are unavailable on this page.'
  : model.checkingExpiry ? 'Checking availability. Actions are unavailable.'
    : model.declineUnavailable ? 'Declining is unavailable. Check the current offer again.'
        : model.canReviewAccept ? 'Review your details and declarations before accepting.'
    : model.canDecline && model.actions?.accept !== true ? 'Acceptance is unavailable. You can still decline this offer.'
      : 'Actions depend on current server availability.';

// The offered value for a shared row: points from the term, the rest from the card fact with the same shared label.
function offeredValue(member, row) {
  if (row.key === 'points') {
    const points = member.terms?.find((term) => term.kind === 'points-monthly')?.value;
    return Number.isFinite(points) ? `${points.toLocaleString('en-GB')} points` : null;
  }
  const fact = member.facts?.find((entry) => entry.label === row.label);
  if (fact?.value === null || fact?.value === undefined || fact?.value === '') return null;
  return `${typeof fact.value === 'number' ? fact.value.toLocaleString('en-GB') : fact.value}${fact.unit ? ` ${fact.unit}` : ''}`;
}
function disclosure(title, ...content) {
  const node = el('details', 'gcsp-details');
  node.append(el('summary', 'gcsp-details-summary', title), ...content);
  return node;
}
const cell = (value, missingLabel) => value === null ? { label: missingLabel, missing: true } : value;

const comparableNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = typeof value === 'string' && value.match(/^([\d,]+(?:\.\d+)?) (?:points|litres)$/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
};
function comparedRows(member, currentCar) {
  return (currentCar?.facts || []).map((row) => {
    const offered = offeredValue(member, row); const current = row.value;
    const [one, two] = [offered, current].map(comparableNumber);
    // Only the agreed points cost and boot capacity have a general winning direction.
    const direction = row.key === 'points' ? -1 : row.key === 'boot' ? 1 : 0;
    const winner = direction && one !== null && two !== null && one !== two ? (one - two) * direction > 0 ? 'offer' : 'current' : null;
    return { ...row, offered, current, winner, delta: winner ? Math.abs(one - two) : null };
  });
}
function differences(member, currentCar) {
  const benefits = []; const tradeoffs = [];
  const measured = comparedRows(member, currentCar).filter((row) => row.winner);
  for (const row of measured) {
    const good = row.winner === 'offer';
    const title = row.key === 'points' ? `${good ? 'fewer' : 'more'} points` : `litres ${good ? 'more' : 'less'}`;
    (good ? benefits : tradeoffs).push({ number: row.delta.toLocaleString('en-GB'), title,
      detail: row.key === 'points' ? 'Every month, compared with your current car' : 'Boot space compared with your current car' });
  }
  const checks = new Set(['driver-eligible', 'policy-include', 'allowance-sufficient', 'essential-met']);
  for (const [entries, target] of [[member.decision?.reasons, benefits], [member.decision?.tradeOffs, tradeoffs]]) {
    for (const entry of entries || []) {
      if (checks.has(entry?.code) || measured.some((row) => row.key === entry?.field)) continue;
      const title = typeof entry === 'string' ? entry : entry?.text;
      if (title) target.push({ title });
    }
  }
  return { benefits, tradeoffs };
}
function comparison(member, currentCar) {
  const section = el('section', 'gcsp-offer-current'); section.dataset.offerComparison = '';
  if (!currentCar) {
    section.append(el('h2', 'gcsp-h2', 'What matters for your decision'), decisionHighlights({ ...differences(member, null), layout: 'list' }), el('p', 'gcsp-note', 'Current-car details not supplied. Equipment is unknown.'));
    return section;
  }
  section.append(el('h2', 'gcsp-h2', 'What matters for your decision'), decisionHighlights({ ...differences(member, currentCar), layout: 'list' }));
  const name = currentCar.display?.name || 'Current car not supplied';
  const columns = [{ key: 'label', label: '' },
    { key: 'current', label: 'Your current car', detail: currentCar.configuration ? `${name}, ${currentCar.configuration}` : name },
    { key: 'offer', label: 'This offer', detail: member.display?.name }];
  const rows = comparedRows(member, currentCar).map((row) => ({ label: row.label,
    current: row.winner === 'current' ? { label: row.current, winner: true } : cell(row.current, row.missingLabel || 'Unknown'),
    offer: row.winner === 'offer' ? { label: row.offered, winner: true } : cell(row.offered, 'Not supplied') }));
  section.append(dataTable({ caption: 'Compared with your current car', captionHidden: true, equalColumns: true, compare: true, columns, rows }));
  if (currentCar.status === 'partial') section.append(el('p', 'gcsp-note', currentCar.facts.some((row) => row.value !== null)
    ? 'Partial comparison. Some current-car facts are unknown.' : 'Partial comparison. Current-car specifications and points are unknown.'));
  return section;
}

function selectionGroup(selection) {
  const section = el('div', 'gcsp-offer-current');
  section.append(stageList({ heading: 'Your selection', stages: selection.stages }));
  if (selection.orderNumber || selection.orderReference) section.append(factList(orderIdentityRows(selection.orderReference, selection.orderNumber)));
  return section;
}

// The short accepted confirmation: the car once and its order number once, no tracker and no comparison.
function acceptedFacts(model) {
  const name = model.card?.members?.length === 1 ? model.card.members[0]?.display?.name : '';
  const number = model.selection?.orderNumber ?? model.card?.members?.[0]?.display?.line?.match(/\d{7}/)?.[0];
  const rows = [...(name ? [{ label: 'Your new car', value: name }] : []), ...(number ? orderIdentityRows(null, number) : [])];
  return rows.length ? factList(rows) : null;
}

/** Compose shared primitives only; server projection owns vehicle facts, terms and decisions. */
export function createOfferView(root, { refresh, decide, tickDeclaration, setExpectedReturnMileage, selectReason, cancelDecline, refreshReasons, mountFollowup, links, openDecision } = {}) {
  const page = el('div', 'vm gcsp-offer-body gcsp-vehicle-page');
  page.id = `gcsp-offer-${++sequence}`;
  const content = el('div', 'gcsp-offer-content');
  // FUCQ-234: screen-reader only, and silent when the offer first lands because the heading already shows the state.
  const status = viewStatus(); status.root.dataset.offerAnnouncement = '';
  page.append(content, status.root); root.replaceChildren(page);
  let previousState; let previousIdentity; let structure;
  let messageNode; let clockNode; let reasonNode; let decisionWasOpen = false;
  let followupRoot; let followupKey; let cleanupFollowup; let accepting = false;
  let gallery; let vehicleCard;
  const clearFollowup = () => {
    const cleanup = cleanupFollowup; cleanupFollowup = undefined; followupKey = undefined;
    try { cleanup?.(); } catch { /* Teardown cannot prevent the offer from updating. */ }
  };
  const announce = (text) => status.announce(text);
  const drawer = createDecisionDrawer({ host: page, decide: (kind, options) => { if (kind === 'accept') accepting = true; return decide?.(kind, options); }, tickDeclaration, setExpectedReturnMileage, selectReason, cancelDecline, refreshReasons, refresh, announce, announcement: status.root,
    opener: (kind) => content.querySelector(`[data-offer-action="${kind}"]`) });
  const reviewDecision = (kind) => typeof openDecision === 'function' ? openDecision(kind, lastModel) : drawer.open(kind, lastModel);
  // FUCQ-332: a visible line under the check control; the result is spoken through the one view status.
  const checkNode = el('p', 'gcsp-note'); checkNode.dataset.offerCheck = ''; checkNode.hidden = true;
  let checking = false; let lastModel;
  const showCheck = (text) => { checkNode.textContent = text; checkNode.hidden = !text; };
  const identity = (model) => `${titleFor(model)}:${model?.reference?.offerId || ''}`;
  function finishCheck(before, beforeStructure) {
    checking = false; const model = lastModel;
    if (!model || !content.contains(checkNode)) { showCheck(''); if (model) announce(titleFor(model)); return; }
    const now = isRefused(model) ? 'accepted, selection not sent to ordering' : stateWords[model.state] || 'updated';
    const text = model.state === 'error' ? 'Check not completed. Try again in a moment.'
      : before.startsWith(`${titles.error}:`) || identity(model) !== before ? `Check complete. Current state: ${now}.`
        : structure !== beforeStructure ? 'Check complete. The offer details have been updated.'
          : model.state === 'uncertain' ? 'Check complete. Your decision is still being confirmed.' : 'Check complete. Nothing has changed.';
    showCheck(text); announce(text); checkNode.scrollIntoView?.({ block: 'nearest' });
  }
  const refreshCurrent = () => {
    if (checking || typeof refresh !== 'function') return;
    const before = identity(lastModel); const beforeStructure = structure;
    checking = true; clearFollowup(); status.clear(); showCheck('Checking the current offer state.');
    let pending; try { pending = refresh(); } catch { /* The read port reports failure through the model. */ }
    Promise.resolve(pending).catch(() => {}).then(() => finishCheck(before, beforeStructure));
  };
  const followupUnavailable = (spoken = true) => {
    const text = 'Follow-up unavailable. Check the current offer again.';
    followupRoot.replaceChildren(el('p', 'gcsp-note', text)); if (spoken) announce(text);
  };
  function draw(model) {
    const focused = root.ownerDocument.activeElement?.dataset?.offerAction;
    const followupFocused = followupRoot?.contains(root.ownerDocument.activeElement);
    const inPage = content.contains(root.ownerDocument.activeElement);
    clearFollowup(); followupRoot = undefined;
    vehicleCard?.destroy(); vehicleCard = undefined;
    gallery?.destroy(); gallery = undefined;
    content.replaceChildren(); if (!checking) showCheck('');
    const state = model.state;
    if (state === 'loading') {
      const heading = screenIntro({ title: 'Your offer', level: 1 }); heading.classList.add('gcsp-vh');
      content.append(heading, loadingSkeleton({ label: 'Loading your offer.', layout: 'offer' }));
      messageNode = el('p'); return;
    }
    if (state === 'restarted' || state === 'access-lapsed') {
      // The offer page sits outside the access gate, so a lapsed key needs the access form, not a reload.
      const screen = state === 'restarted' ? runRestartedScreen() : accessLapsedScreen();
      messageNode = el('p'); messageNode.hidden = true; content.append(screen);
      if (focused || followupFocused || decisionWasOpen) screen.querySelector('.vm-btn')?.focus(); return;
    }
    const refused = isRefused(model);
    if (refused) {
      const actions = [links?.help && button({ label: 'Contact scheme support', variant: 'primary', href: links.help }),
        links?.cars && button({ label: 'Back to Your cars', variant: 'ghost', href: links.cars })].filter(Boolean);
      const screen = statusScreen({ title: REFUSED_TITLE, level: 1, message: messageFor(model, links?.help), actions, role: null });
      messageNode = screen.querySelector('.vm-lede'); content.append(screen);
    } else {
      const intro = screenIntro({ title: titleFor(model), level: 1 });
      if (state === 'pending') {
        const header = el('div', 'gcsp-offer-header');
        header.append(intro);
        if (links?.cars) header.append(button({ label: '‹ Back to Your cars', variant: 'ghost', href: links.cars }));
        content.append(header);
      } else content.append(intro);
      const facts = state === 'accepted' ? acceptedFacts(model) : null; if (facts) content.append(facts);
      messageNode = el('p', 'gcsp-note', messageFor(model));
      messageNode.hidden = !messageFor(model); content.append(messageNode);
    }
    if (model.fixtureNotice) content.append(el('p', 'gcsp-note', model.fixtureNotice));
    if (state === 'accepted' && !refused && (links?.orderProgress || links?.cars)) {
      const leadOn = el('div', 'gcsp-offer-actions');
      if (links.orderProgress) leadOn.append(button({ label: 'Track your order', variant: 'primary', href: links.orderProgress }));
      if (links.cars) leadOn.append(button({ label: 'Back to Your cars', variant: 'ghost', href: links.cars }));
      content.append(leadOn);
    }
    const exit = state === 'expired' && (links?.activity || links?.cars);
    if (exit) {
      const exitRow = el('div', 'gcsp-offer-actions');
      if (links.activity) exitRow.append(button({ label: 'See buddy activity', variant: 'primary', href: links.activity }));
      if (links.cars) exitRow.append(button({ label: 'Back to Your cars', variant: 'ghost', href: links.cars }));
      content.append(exitRow);
    }
    if (refused && model.selection) content.append(selectionGroup(model.selection));
    let pendingActions; let handoffNote;
    if (state === 'pending') {
      const actions = el('div', 'gcsp-offer-actions');
      const reason = el('p', 'gcsp-note', decisionReason(model));
      reason.id = `${page.id}-decision-reason`;
      reasonNode = reason;
      for (const [kind, label, enabled] of [['accept', 'Review & accept', model.canReviewAccept], ['decline', 'Decline offer', model.canDecline]]) {
        const control = button({ label, variant: kind === 'accept' ? 'primary' : 'ghost', disabled: !enabled,
          describedBy: reason.id, onClick: () => reviewDecision(kind) });
        control.dataset.offerAction = kind; actions.append(control);
      }
      actions.dataset.offerDecisionActions = '';
      pendingActions = actions;
      handoffNote = reason;
    }
    if ((['pending', 'superseded', 'uncertain'].includes(state) || refused) && model.card?.members?.length === 1) {
      const columns = el('div', 'gcsp-offer-comparison');
      const offer = el('section', 'gcsp-offer-exact');
      offer.setAttribute('aria-label', 'The offered car');
      const card = structuredClone(model.card); const member = card.members[0]; member.actions = [];
      if (state === 'pending') {
        // The exact shared card keeps every supplied fact; only scheme and pending order identifiers are omitted.
        member.display.line = '';
        const finish = (labels, label) => {
          const fact = member.facts.find((row) => labels.includes(row.label));
          return { label, value: fact?.value == null ? null : String(fact.value), shade: fact?.shade };
        };
        const finishes = [finish(['Colour', 'Paint'], 'Paint'), finish(['Interior', 'Upholstery'], 'Upholstery')];
        member.facts = member.facts.filter((row) => !['Scheme', 'Colour', 'Paint', 'Interior', 'Upholstery', 'Order number'].includes(row.label));
        const decision = member.decision || {}; member.decision = { ...decision, reasons: [], tradeOffs: [] };
        const points = comparedRows(model.card.members[0], model.currentCar).find((row) => row.key === 'points' && row.winner === 'offer');
        const media = member.media || {};
        gallery = mediaGallery({ name: member.display.name, images: media.images?.length ? media.images : media.src ? [media] : [], presentation: 'picker', fit: 'contain' });
        const deadline = el('div', 'gcsp-decision-deadline');
        const held = el('div');
        const expires = Number.isFinite(Date.parse(model.expiresAt)) ? new Date(model.expiresAt) : null;
        held.append(el('strong', null, expires ? `Held until ${expires.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}` : 'Deadline unavailable'));
        if (expires) held.append(el('p', 'gcsp-decision-date', expires.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })));
        const clock = el('div', 'gcsp-decision-clock'); clockNode = el('p', 'gcsp-countdown');
        clockNode.setAttribute('aria-label', 'Time left to decide');
        clock.append(clockNode, el('p', 'gcsp-decision-date', 'left to decide')); deadline.append(held, clock);
        vehicleCard = vehicleDecisionCard({ view: card, media: gallery.root, actions: pendingActions,
          note: handoffNote, finishes, layout: 'focused', deadline, kicker: 'Your buddy found a car for you',
          pointsDifference: points ? `${points.delta.toLocaleString('en-GB')} fewer than your current car` : null });
        offer.append(vehicleCard);
      } else offer.append(matchCard(null, { view: card, showScore: false, factsClass: 'vm-facts-pair', hideMissing: 'More details not supplied', headingLevel: 2 }));
      columns.append(offer, comparison(model.card.members[0], model.currentCar)); content.append(columns);
    }
    const summary = state === 'declined' ? declinedLine(model.card, Boolean(followupHandle(model.followup, state))) : '';
    if (summary) { const line = el('p', 'gcsp-note', summary); line.dataset.offerDeclinedSummary = ''; content.append(line); }
    if (state === 'declined') {
      const section = el('section', 'gcsp-offer-content'); section.setAttribute('aria-label', 'Your next offer');
      followupRoot = el('div'); followupRoot.dataset.offerFollowup = '';
      section.append(followupRoot); content.append(section);
      // After Decline the change question is the next step, so focus goes to it rather than the last control.
      if ((inPage || decisionWasOpen) && previousState !== 'declined') { followupRoot.tabIndex = -1; followupRoot.focus(); }
    }
    if (!['loading', 'pending', 'accepted'].includes(state) && !exit) {
      const control = button({ label: state === 'error' ? 'Try again' : 'Check current state', variant: 'ghost', onClick: refreshCurrent });
      if (state !== 'error') control.classList.add('gcsp-offer-quiet');
      control.dataset.offerAction = 'refresh'; content.append(control, checkNode);
    }
    if (state === 'accepted' && accepting) {
      // The accept button is gone, so the outcome heading takes focus once, never on a later poll.
      accepting = false; const heading = content.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); return; }
    }
    if (decisionWasOpen && !['pending', 'uncertain', 'declined'].includes(state)) {
      const heading = content.querySelector('h1');
      if (heading) { heading.tabIndex = -1; heading.focus(); return; }
    }
    if ((focused || followupFocused || inPage) && !(state === 'declined' && followupRoot === root.ownerDocument.activeElement)) {
      const target = content.querySelector(`[data-offer-action="${['accept', 'decline', 'refresh'].includes(focused) ? focused : 'refresh'}"]`);
      const fallback = content.querySelector('[data-offer-action="refresh"]') || content.querySelector('h1');
      if (fallback?.tagName === 'H1') fallback.tabIndex = -1;
      (target && !target.disabled ? target : fallback)?.focus();
    }
  }
  function updateFollowup(model) {
    if (!followupRoot) return;
    const handle = followupHandle(model.followup, model.state);
    const key = JSON.stringify([model.reference?.runId, model.reference?.offerId, handle?.decisionId ?? null]);
    if (key === followupKey) return;
    const focused = followupRoot.contains(root.ownerDocument.activeElement);
    clearFollowup(); followupKey = key;
    const mountable = handle && typeof mountFollowup === 'function';
    followupUnavailable(!mountable);
    if (mountable) {
      try {
        const cleanup = mountFollowup(followupRoot, { ...handle, announce });
        if (typeof cleanup === 'function') cleanupFollowup = cleanup;
        else followupUnavailable();
      } catch { followupUnavailable(); }
    }
    if (focused && !followupRoot.contains(root.ownerDocument.activeElement)) content.querySelector('[data-offer-action="refresh"]')?.focus();
  }
  function update(model) {
    lastModel = model;
    page.setAttribute('aria-busy', String(model.state === 'loading'));
    decisionWasOpen = Boolean(page.querySelector('[data-offer-decision-drawer]'));
    drawer.update(model);
    if (decisionWasOpen && model.state === 'accepted') accepting = true;
    const nextStructure = JSON.stringify([model.state, model.card, model.currentCar, model.fixtureNotice, model.handoff, model.selection, model.orderUuid]);
    // Keep the kit's own decision live region and keyboard controls mounted across clock reads.
    if (structure !== nextStructure) { draw(model); structure = nextStructure; }
    messageNode.textContent = messageFor(model, links?.help) || '';
    messageNode.hidden = !messageNode.textContent;
    if (model.state === 'pending') accepting = false;
    updateFollowup(model);
    if (model.state === 'pending') {
      clockNode.textContent = model.countdown?.replace(/^(\d+):(\d\d)$/, '$1h $2m') || 'Time remaining unavailable';
      reasonNode.textContent = decisionReason(model);
      content.querySelector('[data-offer-action="accept"]').disabled = !(model.canReviewAccept);
      for (const box of content.querySelectorAll('[data-offer-declaration]')) box.checked = model.ticked?.[box.dataset.offerDeclaration] === true;
      content.querySelector('[data-offer-action="decline"]').disabled = !model.canDecline;
      const focused = root.ownerDocument.activeElement;
      if (focused?.disabled && content.contains(focused)) {
        content.querySelector('[data-offer-action="decline"]:enabled, [data-offer-action="accept"]:enabled, [data-offer-action="refresh"], .gcsp-vehicle-details-entry')?.focus();
      }
    }
    const key = `${titleFor(model)}:${model.reference?.offerId || ''}`;
    if (model.state === 'pending' && model.checkingExpiry) announce('The deadline has been reached. Checking the current offer state.');
    else if (model.state === 'pending' && model.seconds !== null && model.seconds <= 300) announce('Less than five minutes remain on this offer.');
    else if (!checking && previousState !== undefined && previousState !== 'loading' && (model.state !== previousState || key !== previousIdentity)) announce(titleFor(model));
    previousState = model.state; previousIdentity = key;
  }
  return { update, destroy() { drawer.destroy(); vehicleCard?.destroy(); gallery?.destroy(); clearFollowup(); page.remove(); } };
}
