import { el, screenIntro, button, factList } from '../../vehicle-matcher/ui.js';
import { matchCard, mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { labelledField, errorSummary, checkboxField } from '../kit/form-controls.js';
import { stageList } from '../kit/stage-list.js';
import { followupHandle } from './followup-entry.js';

const titles = { pending: 'Your car offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired',
  superseded: 'Offer superseded', 'earlier-run': 'Offer from an earlier demo run', 'not-found': 'Offer not found', refused: 'Offer unavailable',
  loading: 'Loading your offer', error: 'Your offer could not be loaded', uncertain: 'Checking your decision' };
const messages = { accepted: 'Your selection is recorded. Ordering and approval are separate steps.',
  declined: 'Your decline is recorded.', expired: 'This offer is no longer available to accept.',
  superseded: 'This offer has been replaced and cannot be changed.',
  'earlier-run': 'This offer belongs to an earlier demo run. It cannot be changed.',
  'not-found': 'Check the offer link or open the offer from your account.', refused: 'Open the offer from your account or use its original email link.',
  loading: 'Please wait.', uncertain: 'The current outcome is being checked. Actions are unavailable.' };
const blockerText = { 'contact-required': 'A valid contact phone and email are needed before you can accept.',
  'driver-review-required': 'Your driver details need review before you can accept.',
  'return-data-required': 'The details of the car you return are incomplete.',
  'ordering-terms-unavailable': 'The ordering terms are unavailable right now.' };
const selectionHeadline = (selection) => selection.selectionState === 'acknowledged'
  ? `Selection received. Waiting for ${selection.stages.find((stage) => stage.state === 'waiting')?.name ?? selection.current}.`
  : selection.selectionState === 'handoff-pending' ? 'Sending your selection. Check again shortly.'
    : 'Your selection was not accepted for ordering. Contact scheme support.';
const messageFor = (model) => model.message || (model.state === 'accepted' && model.selection ? selectionHeadline(model.selection) : messages[model.state]);
const longDate = (value) => /^\d{4}-\d\d-\d\d$/.test(value ?? '') && Number.isFinite(Date.parse(value))
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : value;
let sequence = 0;

const decisionReason = (model) => model.decisionUnavailable ? 'Decisions are unavailable on this page.'
  : model.checkingExpiry ? 'Checking availability. Actions are unavailable.'
    : model.declineReason?.open ? 'Choose a reason to decline this offer.'
      : model.declineUnavailable ? 'Declining is unavailable. Check the current offer again.'
        : model.actions?.accept === true && !model.canAccept ? 'Tick each declaration to accept this offer.'
    : model.canDecline && model.actions?.accept !== true ? 'Acceptance is unavailable. You can still decline this offer.'
      : 'Actions depend on current server availability.';

function comparison(currentCar) {
  const section = el('section', 'gcsp-panel gcsp-offer-current');
  section.append(el('h2', 'gcsp-h2', 'Your current car'));
  if (!currentCar) {
    section.append(el('p', 'gcsp-note', 'Current-car details not supplied. Equipment is unknown.'));
    return section;
  }
  const name = currentCar.display?.name || 'Current car not supplied';
  section.append(el('h3', null, name));
  if (currentCar.status === 'partial') section.append(el('p', 'gcsp-note', currentCar.facts?.some((row) => row.value !== null)
    ? 'Partial comparison. Some current-car facts are unknown.' : 'Partial comparison. Current-car specifications and points are unknown.'));
  section.append(mediaWell(null, '', { placeholder: 'No image for this car yet', view: {
    display: { name }, media: currentCar.media || {} } }).media);
  section.append(factList(currentCar.facts || []));
  section.append(el('p', 'gcsp-note', currentCar.provenance || 'Source not supplied. Equipment is unknown unless confirmed.'));
  return section;
}

function handoffGroup(model, id, tick) {
  const handoff = model.handoff; const section = el('section', 'gcsp-panel gcsp-offer-current');
  section.setAttribute('aria-label', 'Before you accept');
  section.append(el('h2', 'gcsp-h2', 'Before you accept'));
  if (handoff.blocker) {
    const reason = el('p', 'gcsp-note', `${blockerText[handoff.blocker]} Contact scheme support.`);
    reason.setAttribute('role', 'status'); section.append(reason); return section;
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
  if (selection.orderNumber) section.append(factList([{ label: 'Order number', value: selection.orderNumber }]));
  return section;
}

/** Compose shared primitives only; server projection owns vehicle facts, terms and decisions. */
export function createOfferView(root, { refresh, decide, tickDeclaration, selectReason, cancelDecline, refreshReasons, mountFollowup, mountOrder } = {}) {
  const page = el('div', 'vm gcsp-offer-body');
  page.id = `gcsp-offer-${++sequence}`;
  const content = el('div', 'gcsp-offer-content');
  const announcement = el('p', 'gcsp-note'); announcement.setAttribute('role', 'status');
  announcement.dataset.offerAnnouncement = '';
  announcement.setAttribute('aria-live', 'polite'); announcement.setAttribute('aria-atomic', 'true');
  page.append(content, announcement); root.replaceChildren(page);
  let lastAnnouncement = ''; let previousState; let previousIdentity; let structure;
  let messageNode; let clockNode; let asOfNode; let reasonNode;
  let reasonForm; let reasonSelect; let reasonStatus; let reasonField; let reasonSummary;
  let confirmButton; let cancelButton; let reasonsRefresh; let optionsKey; let wasOpen = false; let lastError = '';
  let followupRoot; let followupKey; let cleanupFollowup; let cleanupOrder;
  const clearFollowup = () => {
    const cleanup = cleanupFollowup; cleanupFollowup = undefined; followupKey = undefined;
    try { cleanup?.(); } catch { /* Teardown cannot prevent the offer from updating. */ }
  };
  const clearOrder = () => {
    const cleanup = cleanupOrder; cleanupOrder = undefined;
    try { cleanup?.(); } catch { /* Teardown cannot prevent the offer from updating. */ }
  };
  const refreshCurrent = () => { clearFollowup(); refresh?.(); };
  const followupUnavailable = () => {
    const note = el('p', 'gcsp-note', 'Follow-up unavailable. Check the current offer again.');
    note.setAttribute('role', 'status'); followupRoot.replaceChildren(note);
  };
  const announce = (text) => { if (text !== lastAnnouncement) { announcement.textContent = text; lastAnnouncement = text; } };
  function draw(model) {
    const focused = root.ownerDocument.activeElement?.dataset?.offerAction;
    const followupFocused = followupRoot?.contains(root.ownerDocument.activeElement);
    clearFollowup(); clearOrder(); followupRoot = undefined;
    content.replaceChildren();
    optionsKey = undefined; wasOpen = false; lastError = '';
    const state = model.state;
    content.append(screenIntro({ title: titles[state] || titles.error, level: 1 }));
    messageNode = el('p', 'gcsp-note', messageFor(model));
    messageNode.hidden = !messageFor(model); content.append(messageNode);
    if (model.fixtureNotice) content.append(el('p', 'gcsp-note', model.fixtureNotice));
    if (state === 'accepted' && model.selection) content.append(selectionGroup(model.selection));
    if (['pending', 'accepted', 'declined', 'expired', 'superseded', 'uncertain'].includes(state) && model.card?.members?.length === 1) {
      const columns = el('div', 'gcsp-offer-comparison');
      const offer = el('section', 'gcsp-offer-exact');
      offer.setAttribute('aria-label', 'The offered car');
      const card = structuredClone(model.card); card.members[0].actions = [];
      offer.append(matchCard(null, { view: card, big: true, showScore: false }));
      columns.append(offer, comparison(model.currentCar)); content.append(columns);
    }
    if (state === 'pending' && model.handoff) content.append(handoffGroup(model, page.id, tickDeclaration));
    if (state === 'accepted' && typeof model.orderUuid === 'string' && typeof mountOrder === 'function' && model.card?.members?.length === 1) {
      const section = el('section', 'gcsp-offer-order'); section.setAttribute('aria-label', 'Your order progress');
      const { display, media } = model.card.members[0];
      const cleanup = mountOrder(section, { orderUuid: model.orderUuid, car: { name: display?.name, photo: media?.src || undefined } });
      if (typeof cleanup === 'function') cleanupOrder = cleanup;
      content.append(section);
    }
    if (state === 'pending') {
      clockNode = el('p', 'gcsp-countdown'); asOfNode = el('p', 'gcsp-note');
      content.append(clockNode, asOfNode);
      const actions = el('div', 'gcsp-offer-actions');
      const reason = el('p', 'gcsp-note', decisionReason(model));
      reason.id = `${page.id}-decision-reason`;
      reasonNode = reason;
      for (const [kind, label, enabled] of [['accept', 'Accept this offer', model.canAccept], ['decline', 'Decline this offer', model.canDecline]]) {
        const control = button({ label, variant: kind === 'accept' ? 'primary' : 'ghost', disabled: !enabled,
          describedBy: reason.id, onClick: () => decide?.(kind) });
        control.dataset.offerAction = kind; control.hidden = kind === 'accept' && Boolean(model.handoff?.blocker); actions.append(control);
      }
      content.append(reason, actions);
      reasonForm = el('section', 'gcsp-offer-content'); reasonForm.setAttribute('aria-label', 'Decline this offer');
      reasonStatus = el('p', 'gcsp-note'); reasonStatus.setAttribute('role', 'status'); reasonStatus.tabIndex = -1;
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
      section.append(el('h2', 'gcsp-h2', 'Your next offer'), followupRoot); content.append(section);
    }
    if (state !== 'loading') {
      const control = button({ label: state === 'error' ? 'Try again' : 'Check current state', variant: 'ghost', onClick: refreshCurrent });
      control.dataset.offerAction = 'refresh'; content.append(control);
    }
    if (focused || followupFocused) {
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
    followupUnavailable();
    if (handle && typeof mountFollowup === 'function') {
      try {
        const cleanup = mountFollowup(followupRoot, handle);
        if (typeof cleanup === 'function') cleanupFollowup = cleanup;
        else followupUnavailable();
      } catch { followupUnavailable(); }
    }
    if (focused) content.querySelector('[data-offer-action="refresh"]')?.focus();
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
    reasonSelect.disabled = reason.status !== 'ready' || !model.canDecline;
    confirmButton.disabled = reasonSelect.disabled;
    reasonStatus.textContent = reason.status === 'loading' ? 'Loading reasons.'
      : reason.status === 'unavailable' ? 'Reasons are unavailable. Check again.' : '';
    reasonsRefresh.hidden = reason.status === 'loading';
    reasonField.setError(reason.error);
    reasonSummary.update(reason.error ? [{ id: reasonSelect.id, message: reason.error }] : []);
    const active = root.ownerDocument.activeElement;
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
    const nextStructure = JSON.stringify([model.state, model.card, model.currentCar, model.fixtureNotice, model.handoff, model.selection]);
    // Keep the kit's own decision live region and keyboard controls mounted across clock reads.
    if (structure !== nextStructure) { draw(model); structure = nextStructure; }
    messageNode.textContent = messageFor(model) || '';
    messageNode.hidden = !messageNode.textContent;
    updateFollowup(model);
    if (model.state === 'pending') {
      clockNode.textContent = model.countdown || 'Time remaining unavailable';
      asOfNode.textContent = model.now ? `Demo time at last check: ${model.now}` : 'Demo time unavailable';
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
    const key = `${model.state}:${model.reference?.offerId || ''}`;
    if (model.state === 'pending' && model.checkingExpiry) announce('The deadline has been reached. Checking the current offer state.');
    else if (model.state === 'pending' && model.seconds !== null && model.seconds <= 300) announce('Less than five minutes remain on this offer.');
    else if (model.state !== previousState || key !== previousIdentity) announce(titles[model.state] || titles.error);
    previousState = model.state; previousIdentity = key;
  }
  return { update, destroy() { clearFollowup(); clearOrder(); page.remove(); } };
}
