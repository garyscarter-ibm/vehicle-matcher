import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { matchCard } from '../../vehicle-matcher/modes/result-card.js';
import { labelledField, errorSummary, checkboxField } from '../kit/form-controls.js';
import { stageList } from '../kit/stage-list.js';
import { dataTable } from '../kit/data-table.js';
import { orderIdentityRows } from '../kit/order-identity.js';
import { syntheticNote } from '../kit/synthetic-note.js';
import { viewStatus } from '../kit/view-status.js';
import { ACCESS_LAPSED_TITLE, RUN_RESTARTED_TITLE, accessLapsedScreen, runRestartedScreen } from '../kit/run-restarted.js';
import { followupHandle } from './followup-entry.js';

const titles = { pending: 'Your car offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired',
  superseded: 'Offer superseded', 'earlier-run': 'Offer from an earlier demo run', 'not-found': 'Offer not found', refused: 'Offer unavailable',
  restarted: RUN_RESTARTED_TITLE, 'access-lapsed': ACCESS_LAPSED_TITLE, loading: 'Loading your offer', error: 'Your offer could not be loaded', uncertain: 'Checking your decision' };
const messages = { accepted: 'Your selection is recorded. Ordering and approval are separate steps.',
  declined: 'Your decline is recorded.', expired: 'This offer is no longer available to accept. Open your account to check for a new offer.',
  superseded: 'This offer has been replaced and cannot be changed.',
  'earlier-run': 'This link is from an earlier demo run. Use your latest offer email or open the offer from your account.',
  'not-found': 'Check the offer link or open the offer from your account.', refused: 'Open the offer from your account or use its original email link.',
  loading: 'Please wait.', uncertain: 'The current outcome is being checked. Actions are unavailable.' };
const blockerText = { 'contact-required': 'A valid contact phone and email are needed before you can accept.',
  'driver-review-required': 'Your driver details need review before you can accept.',
  'return-data-required': 'The details of the car you return are incomplete.',
  'ordering-terms-unavailable': 'The ordering terms are unavailable right now.' };
const REFUSED_TITLE = 'Your selection was not sent to ordering';
const isRefused = (model) => model.state === 'accepted' && model.selection?.selectionState === 'handoff-failed';
const titleFor = (model) => isRefused(model) ? REFUSED_TITLE : titles[model.state] || titles.error;
// Without a help link the support pointer stays plain text, never a dead link.
const refusedMessage = (selection, help) => {
  const ref = selection.orderReference; const base = 'The car stays reserved for you. Nothing has been ordered.';
  if (help) return ref ? `${base} Quote order reference ${ref} when you contact scheme support.` : base;
  return `${base} Contact scheme support${ref ? ` and quote order reference ${ref}` : ''}.`;
};
const selectionHeadline = (selection, hostsOrder, help) => selection.selectionState === 'acknowledged'
  ? (hostsOrder ? 'Selection received. Your order is with ordering.'
    : `Selection received. Waiting for ${selection.stages.find((stage) => stage.state === 'waiting')?.name ?? selection.current}.`)
  : selection.selectionState === 'handoff-pending' ? 'Sending your selection to ordering. Ordering owns the next step. You do not need to do anything.'
    : refusedMessage(selection, help);
// One line from the projected card, so a declined offer needs no second copy of the car.
function declinedSummary(card) {
  const member = card?.members?.length === 1 ? card.members[0] : null; const name = member?.display?.name;
  if (!name) return '';
  const points = member.terms?.find((term) => term.kind === 'points-monthly')?.value;
  return `You declined the ${name}${Number.isFinite(points) ? `, ${points.toLocaleString('en-GB')} points a month` : ''}.`;
}
const messageFor = (model, hostsOrder, help) => model.message || (model.state === 'accepted' && model.selection ? selectionHeadline(model.selection, hostsOrder, help) : messages[model.state]);
const longDate = (value) => /^\d{4}-\d\d-\d\d$/.test(value ?? '') && Number.isFinite(Date.parse(value))
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : value;
// Readable demo time such as "6 Nov 2026, 11:30 UTC"; anything unparsable shows as given.
const demoTime = (value) => Number.isFinite(Date.parse(value ?? '')) ? `${new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : value;
let sequence = 0;

const decisionReason = (model) => model.decisionUnavailable ? 'Decisions are unavailable on this page.'
  : model.checkingExpiry ? 'Checking availability. Actions are unavailable.'
    : model.declineReason?.open ? 'Choose a reason to decline this offer.'
      : model.declineUnavailable ? 'Declining is unavailable. Check the current offer again.'
        : model.actions?.accept === true && !model.canAccept ? 'Tick each declaration to accept this offer.'
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
const cell = (value, missingLabel) => value === null ? { label: missingLabel, missing: true } : value;

function comparison(member, currentCar) {
  const section = el('section', 'gcsp-offer-current'); section.dataset.offerComparison = '';
  if (!currentCar) {
    section.append(el('p', 'gcsp-note', 'Current-car details not supplied. Equipment is unknown.'));
    return section;
  }
  const name = currentCar.display?.name || 'Current car not supplied';
  section.append(dataTable({ caption: 'Compared with your current car', compare: true,
    columns: [{ key: 'label', label: 'Detail' }, { key: 'offer', label: 'This offer', detail: member.display?.name },
      { key: 'current', label: 'Your current car', detail: currentCar.configuration ? `${name}, ${currentCar.configuration}` : name }],
    rows: currentCar.facts.map((row) => ({ label: row.label, offer: cell(offeredValue(member, row), 'Not supplied'),
      current: cell(row.value, row.missingLabel || 'Unknown') })) }));
  if (currentCar.status === 'partial') section.append(el('p', 'gcsp-note', currentCar.facts.some((row) => row.value !== null)
    ? 'Partial comparison. Some current-car facts are unknown.' : 'Partial comparison. Current-car specifications and points are unknown.'));
  return section;
}

function handoffGroup(model, id, tick) {
  const handoff = model.handoff; const section = el('section', 'gcsp-panel gcsp-offer-current');
  section.setAttribute('aria-label', 'Before you accept');
  section.append(el('h2', 'gcsp-h2', 'Before you accept'));
  if (handoff.blocker) {
    section.append(el('p', 'gcsp-note', `${blockerText[handoff.blocker]} Contact scheme support.`)); return section;
  }
  const rows = [{ label: 'Contact phone', value: handoff.contact.phone }, { label: 'Contact email', value: handoff.contact.email }];
  if (handoff.returnCar) {
    const odometer = handoff.returnCar.currentOdometer;
    rows.push({ label: 'Car to return', value: handoff.returnCar.model }, { label: 'Contract end date', value: longDate(handoff.returnCar.contractEndDate) },
      { label: 'Recorded odometer', value: odometer ? `${odometer.value.toLocaleString('en-GB')} ${odometer.unit}` : null });
  }
  const declarations = el('div', 'gcsp-offer-current'); declarations.setAttribute('role', 'group'); declarations.setAttribute('aria-label', 'Declarations');
  handoff.declarations.forEach((declaration, index) => {
    const field = checkboxField({ id: `${id}-declaration-${index}`, label: declaration.label, checked: model.ticked?.[declaration.id] === true,
      onChange: (checked) => tick?.(declaration.id, checked) });
    field.input.dataset.offerDeclaration = declaration.id; declarations.append(field.root);
  });
  section.append(factList(rows), el('p', 'gcsp-note', handoff.wording), declarations);
  return section;
}

function selectionGroup(selection) {
  const section = el('div', 'gcsp-offer-current');
  section.append(stageList({ heading: 'Your selection', stages: selection.stages }));
  if (selection.orderNumber || selection.orderReference) section.append(factList(orderIdentityRows(selection.orderReference, selection.orderNumber)));
  return section;
}

/** Compose shared primitives only; server projection owns vehicle facts, terms and decisions. */
export function createOfferView(root, { refresh, decide, tickDeclaration, selectReason, cancelDecline, refreshReasons, mountFollowup, mountOrder, links } = {}) {
  const page = el('div', 'vm gcsp-offer-body');
  page.id = `gcsp-offer-${++sequence}`;
  // Once ordering holds the order its tracker is the one source of progress, so selection stages give way.
  const hostsOrderFor = (model) => model.state === 'accepted' && !isRefused(model) && typeof model.orderUuid === 'string' && typeof mountOrder === 'function' && model.card?.members?.length === 1;
  const content = el('div', 'gcsp-offer-content');
  // FUCQ-234: screen-reader only, and silent when the offer first lands because the heading already shows the state.
  const status = viewStatus(); status.root.dataset.offerAnnouncement = '';
  page.append(content, syntheticNote(), status.root); root.replaceChildren(page);
  let previousState; let previousIdentity; let structure;
  let messageNode; let clockNode; let asOfNode; let reasonNode;
  let reasonForm; let reasonSelect; let reasonStatus; let reasonField; let reasonSummary;
  let confirmButton; let cancelButton; let reasonsRefresh; let optionsKey; let wasOpen = false; let lastError = '';
  let followupRoot; let followupKey; let cleanupFollowup; let cleanupOrder; let accepting = false;
  const clearFollowup = () => {
    const cleanup = cleanupFollowup; cleanupFollowup = undefined; followupKey = undefined;
    try { cleanup?.(); } catch { /* Teardown cannot prevent the offer from updating. */ }
  };
  const clearOrder = () => {
    const cleanup = cleanupOrder; cleanupOrder = undefined;
    try { cleanup?.(); } catch { /* Teardown cannot prevent the offer from updating. */ }
  };
  const refreshCurrent = () => { clearFollowup(); refresh?.(); };
  const announce = (text) => status.announce(text);
  const followupUnavailable = (spoken = true) => {
    const text = 'Follow-up unavailable. Check the current offer again.';
    followupRoot.replaceChildren(el('p', 'gcsp-note', text)); if (spoken) announce(text);
  };
  function draw(model) {
    const focused = root.ownerDocument.activeElement?.dataset?.offerAction;
    const followupFocused = followupRoot?.contains(root.ownerDocument.activeElement);
    const inPage = content.contains(root.ownerDocument.activeElement);
    clearFollowup(); clearOrder(); followupRoot = undefined;
    content.replaceChildren();
    optionsKey = undefined; wasOpen = false; lastError = '';
    const state = model.state;
    if (state === 'restarted' || state === 'access-lapsed') {
      // The offer page sits outside the access gate, so a lapsed key needs the access form, not a reload.
      const screen = state === 'restarted' ? runRestartedScreen() : accessLapsedScreen();
      messageNode = el('p'); messageNode.hidden = true; content.append(screen);
      if (focused || followupFocused) screen.querySelector('.vm-btn')?.focus(); return;
    }
    const hostsOrder = hostsOrderFor(model); const refused = isRefused(model);
    if (refused) {
      const actions = [links?.help && button({ label: 'Contact scheme support', variant: 'primary', href: links.help }),
        links?.cars && button({ label: 'Back to Your cars', variant: 'ghost', href: links.cars })].filter(Boolean);
      const screen = statusScreen({ title: REFUSED_TITLE, level: 1, message: messageFor(model, hostsOrder, links?.help), actions, role: null });
      messageNode = screen.querySelector('.vm-lede'); content.append(screen);
    } else {
      content.append(screenIntro({ title: titleFor(model), level: 1 }));
      // The deadline leads, directly under the heading, so it is not found below the declarations.
      if (state === 'pending') { clockNode = el('p', 'gcsp-countdown'); asOfNode = el('p', 'gcsp-note'); content.append(clockNode, asOfNode); }
      messageNode = el('p', 'gcsp-note', messageFor(model, hostsOrder));
      messageNode.hidden = !messageFor(model, hostsOrder); content.append(messageNode);
    }
    if (model.fixtureNotice) content.append(el('p', 'gcsp-note', model.fixtureNotice));
    if (state === 'accepted' && !refused && (links?.orderProgress || links?.cars)) {
      const leadOn = el('div', 'gcsp-offer-actions');
      if (links.orderProgress) leadOn.append(button({ label: 'View order progress', variant: 'primary', href: links.orderProgress }));
      if (links.cars) leadOn.append(button({ label: 'Back to Your cars', variant: 'ghost', href: links.cars }));
      content.append(leadOn);
    }
    if (state === 'accepted' && model.selection && !hostsOrder) content.append(selectionGroup(model.selection));
    if (['pending', 'accepted', 'superseded', 'uncertain'].includes(state) && model.card?.members?.length === 1) {
      const columns = el('div', 'gcsp-offer-comparison');
      const offer = el('section', 'gcsp-offer-exact');
      offer.setAttribute('aria-label', 'The offered car');
      const card = structuredClone(model.card); const member = card.members[0]; member.actions = [];
      // Compared specs live in the table, so the card keeps identity facts only (when there is a current car).
      if (model.currentCar) { const shared = new Set(model.currentCar.facts.map((row) => row.label)); member.facts = member.facts.filter((row) => !shared.has(row.label)); }
      offer.append(matchCard(null, { view: card, big: true, showScore: false, factsClass: 'vm-facts-pair', hideMissing: 'More details not supplied', headingLevel: 2 }));
      columns.append(offer, comparison(model.card.members[0], model.currentCar)); content.append(columns);
    }
    const summary = state === 'declined' ? declinedSummary(model.card) : '';
    if (summary) { const line = el('p', 'gcsp-note', summary); line.dataset.offerDeclinedSummary = ''; content.append(line); }
    if (state === 'pending' && model.handoff) content.append(handoffGroup(model, page.id, tickDeclaration));
    if (hostsOrder) {
      const section = el('section', 'gcsp-offer-order'); section.setAttribute('aria-label', 'Your order progress');
      const { display, media } = model.card.members[0];
      const cleanup = mountOrder(section, { orderUuid: model.orderUuid, car: { name: display?.name, photo: media?.src || undefined }, announce });
      if (typeof cleanup === 'function') cleanupOrder = cleanup;
      content.append(section);
    }
    if (state === 'pending') {
      const actions = el('div', 'gcsp-offer-actions');
      const reason = el('p', 'gcsp-note', decisionReason(model));
      reason.id = `${page.id}-decision-reason`;
      reasonNode = reason;
      for (const [kind, label, enabled] of [['accept', 'Accept this offer', model.canAccept], ['decline', 'Decline this offer', model.canDecline]]) {
        const control = button({ label, variant: kind === 'accept' ? 'primary' : 'ghost', disabled: !enabled,
          describedBy: reason.id, onClick: () => { accepting = kind === 'accept'; decide?.(kind); } });
        control.dataset.offerAction = kind; control.hidden = kind === 'accept' && Boolean(model.handoff?.blocker); actions.append(control);
      }
      content.append(reason, actions);
      reasonForm = el('section', 'gcsp-offer-content'); reasonForm.setAttribute('aria-label', 'Decline this offer');
      reasonStatus = el('p', 'gcsp-note'); reasonStatus.tabIndex = -1;
      reasonSelect = el('select'); reasonSelect.required = true; reasonSelect.dataset.offerReason = '';
      reasonSelect.addEventListener('change', () => selectReason?.(reasonSelect.value));
      const fieldId = `${page.id}-decline-reason`;
      reasonField = labelledField({ id: fieldId, label: 'Reason for declining', control: reasonSelect });
      reasonSummary = errorSummary({ id: `${page.id}-reason-errors` });
      const confirmation = el('div', 'gcsp-offer-actions');
      confirmButton = button({ label: 'Confirm decline', variant: 'primary',
        onClick: () => decide?.('decline', { reasonCode: reasonSelect.value }) });
      confirmButton.dataset.offerAction = 'decline-confirm';
      cancelButton = button({ label: 'Cancel', variant: 'ghost', onClick: () => cancelDecline?.() });
      cancelButton.dataset.offerAction = 'decline-cancel';
      reasonsRefresh = button({ label: 'Check reasons again', variant: 'ghost', onClick: () => refreshReasons?.() });
      reasonsRefresh.dataset.offerAction = 'reasons-refresh';
      confirmation.append(confirmButton, cancelButton, reasonsRefresh);
      reasonForm.append(reasonStatus, reasonSummary.root, reasonField.root, confirmation); content.append(reasonForm);
    }
    if (state === 'declined') {
      const section = el('section', 'gcsp-offer-content'); section.setAttribute('aria-label', 'Your next offer');
      followupRoot = el('div'); followupRoot.dataset.offerFollowup = '';
      section.append(followupRoot); content.append(section);
      // After Decline the change question is the next step, so focus goes to it rather than the last control.
      if (inPage && previousState !== 'declined') { followupRoot.tabIndex = -1; followupRoot.focus(); }
    }
    if (state !== 'loading') {
      const control = button({ label: state === 'error' ? 'Try again' : 'Check current state', variant: 'ghost', onClick: refreshCurrent });
      control.dataset.offerAction = 'refresh'; content.append(control);
    }
    if (state === 'accepted' && accepting) {
      // The accept button is gone, so the outcome heading takes focus once, never on a later poll.
      accepting = false; const heading = content.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); return; }
    }
    if ((focused || followupFocused) && !(state === 'declined' && followupRoot === root.ownerDocument.activeElement)) {
      const target = content.querySelector(`[data-offer-action="${['accept', 'decline', 'refresh'].includes(focused) ? focused : 'refresh'}"]`);
      (target && !target.disabled ? target : content.querySelector('[data-offer-action="refresh"]'))?.focus();
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
  function updateReasons(model) {
    const reason = model.declineReason || { open: false, status: 'idle', choices: [], selectedCode: '', error: '' };
    reasonForm.hidden = !reason.open;
    content.querySelector('[data-offer-action="decline"]').hidden = reason.open;
    const key = JSON.stringify(reason.choices);
    if (optionsKey !== key) {
      const placeholder = el('option', null, 'Choose a reason'); placeholder.value = '';
      reasonSelect.replaceChildren(placeholder);
      for (const choice of reason.choices) { const option = el('option', null, choice.label); option.value = choice.code; reasonSelect.append(option); }
      optionsKey = key;
    }
    reasonSelect.value = reason.selectedCode;
    const active = root.ownerDocument.activeElement;
    const rereading = active === reasonSelect && reason.status !== 'ready' && model.canDecline;
    reasonSelect.disabled = reason.status !== 'ready' || !model.canDecline;
    confirmButton.disabled = reasonSelect.disabled;
    reasonStatus.textContent = reason.status === 'loading' ? 'Loading reasons.'
      : reason.status === 'unavailable' ? 'Reasons are unavailable. Check again.' : '';
    reasonsRefresh.hidden = reason.status === 'loading';
    reasonField.setError(reason.error);
    reasonSummary.update(reason.error ? [{ id: reasonSelect.id, message: reason.error }] : []);
    // A poll re-reads the reasons and disables the select; park focus on the status line until it is ready again.
    if (rereading) reasonStatus.focus();
    if (reason.open && !wasOpen) (reason.status === 'ready' ? reasonSelect : reasonStatus).focus();
    else if (reason.open && active === reasonStatus) {
      if (reason.status === 'ready') reasonSelect.focus();
      else if (reason.status === 'unavailable') reasonsRefresh.focus();
    } else if (!reason.open && wasOpen) {
      content.querySelector('[data-offer-action="decline"]:enabled, [data-offer-action="refresh"]')?.focus();
    }
    if (reason.open && reason.error && reason.error !== lastError) reasonSummary.focus();
    lastError = reason.error; wasOpen = reason.open;
  }
  function update(model) {
    const nextStructure = JSON.stringify([model.state, model.card, model.currentCar, model.fixtureNotice, model.handoff, model.selection, model.orderUuid]);
    // Keep the kit's own decision live region and keyboard controls mounted across clock reads.
    if (structure !== nextStructure) { draw(model); structure = nextStructure; }
    messageNode.textContent = messageFor(model, hostsOrderFor(model), links?.help) || '';
    messageNode.hidden = !messageNode.textContent;
    if (model.state === 'pending') accepting = false;
    updateFollowup(model);
    if (model.state === 'pending') {
      clockNode.textContent = model.countdown || 'Time remaining unavailable';
      asOfNode.textContent = model.now ? `Demo time at last check: ${demoTime(model.now)}` : 'Demo time unavailable';
      reasonNode.textContent = decisionReason(model);
      content.querySelector('[data-offer-action="accept"]').disabled = !model.canAccept;
      for (const box of content.querySelectorAll('[data-offer-declaration]')) box.checked = model.ticked?.[box.dataset.offerDeclaration] === true;
      content.querySelector('[data-offer-action="decline"]').disabled = !model.canDecline;
      updateReasons(model);
      const focused = root.ownerDocument.activeElement;
      if (focused?.disabled && content.contains(focused)) {
        (model.declineReason?.open ? cancelButton
          : content.querySelector('[data-offer-action="decline"]:enabled, [data-offer-action="accept"]:enabled, [data-offer-action="refresh"]'))?.focus();
      }
    }
    const key = `${titleFor(model)}:${model.reference?.offerId || ''}`;
    if (model.state === 'pending' && model.checkingExpiry) announce('The deadline has been reached. Checking the current offer state.');
    else if (model.state === 'pending' && model.seconds !== null && model.seconds <= 300) announce('Less than five minutes remain on this offer.');
    else if (previousState !== undefined && previousState !== 'loading' && (model.state !== previousState || key !== previousIdentity)) announce(titleFor(model));
    previousState = model.state; previousIdentity = key;
  }
  return { update, destroy() { clearFollowup(); clearOrder(); page.remove(); } };
}
