import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { matchCard } from '../../vehicle-matcher/modes/result-card.js';
import { labelledField, errorSummary, checkboxField } from '../kit/form-controls.js';
import { stageList } from '../kit/stage-list.js';
import { dataTable } from '../kit/data-table.js';
import { orderIdentityRows } from '../kit/order-identity.js';
import { viewStatus } from '../kit/view-status.js';
import { ACCESS_LAPSED_TITLE, RUN_RESTARTED_TITLE, accessLapsedScreen, runRestartedScreen } from '../kit/run-restarted.js';
import { followupHandle } from './followup-entry.js';

const titles = { pending: 'Your car offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired',
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
function disclosure(title, ...content) {
  const node = el('details', 'gcsp-details');
  node.append(el('summary', 'gcsp-details-summary', title), ...content);
  return node;
}
const cell = (value, missingLabel) => value === null ? { label: missingLabel, missing: true } : value;

function comparison(member, currentCar) {
  const section = el('section', 'gcsp-offer-current'); section.dataset.offerComparison = '';
  if (!currentCar) {
    section.append(el('p', 'gcsp-note', 'Current-car details not supplied. Equipment is unknown.'));
    return section;
  }
  const name = currentCar.display?.name || 'Current car not supplied';
  const columns = [{ key: 'label', label: 'Detail' }, { key: 'offer', label: 'This offer', detail: member.display?.name },
    { key: 'current', label: 'Your current car', detail: currentCar.configuration ? `${name}, ${currentCar.configuration}` : name }];
  const all = currentCar.facts.map((row) => ({ differs: offeredValue(member, row) !== row.value, label: row.label,
    offer: cell(offeredValue(member, row), 'Not supplied'), current: cell(row.value, row.missingLabel || 'Unknown') }));
  const differing = all.filter((row) => row.differs);
  // Only the rows that differ stay in view; the full table sits behind a disclosure.
  if (differing.length) section.append(dataTable({ caption: 'What differs from your current car', compare: true, columns, rows: differing }));
  else section.append(el('p', 'gcsp-note', 'Nothing differs from your current car on the details compared.'));
  section.append(disclosure('Full comparison', dataTable({ caption: 'Compared with your current car', compare: true, columns, rows: all })));
  if (currentCar.status === 'partial') section.append(el('p', 'gcsp-note', currentCar.facts.some((row) => row.value !== null)
    ? 'Partial comparison. Some current-car facts are unknown.' : 'Partial comparison. Current-car specifications and points are unknown.'));
  return section;
}

function handoffGroup(model, id, tick) {
  const handoff = model.handoff; const section = el('section', 'gcsp-offer-current');
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
  section.append(factList(rows), disclosure('Scheme terms', el('p', 'gcsp-note', handoff.wording)), declarations);
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
export function createOfferView(root, { refresh, decide, tickDeclaration, selectReason, cancelDecline, refreshReasons, mountFollowup, links } = {}) {
  const page = el('div', 'vm gcsp-offer-body');
  page.id = `gcsp-offer-${++sequence}`;
  const content = el('div', 'gcsp-offer-content');
  // FUCQ-234: screen-reader only, and silent when the offer first lands because the heading already shows the state.
  const status = viewStatus(); status.root.dataset.offerAnnouncement = '';
  page.append(content, status.root); root.replaceChildren(page);
  let previousState; let previousIdentity; let structure;
  let messageNode; let clockNode; let reasonNode; let decisionGroup;
  let reasonForm; let reasonSelect; let reasonStatus; let reasonField; let reasonSummary;
  let confirmButton; let cancelButton; let reasonsRefresh; let optionsKey; let wasOpen = false; let lastError = '';
  let followupRoot; let followupKey; let cleanupFollowup; let accepting = false;
  const clearFollowup = () => {
    const cleanup = cleanupFollowup; cleanupFollowup = undefined; followupKey = undefined;
    try { cleanup?.(); } catch { /* Teardown cannot prevent the offer from updating. */ }
  };
  const announce = (text) => status.announce(text);
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
    content.replaceChildren(); if (!checking) showCheck('');
    optionsKey = undefined; wasOpen = false; lastError = '';
    const state = model.state;
    if (state === 'restarted' || state === 'access-lapsed') {
      // The offer page sits outside the access gate, so a lapsed key needs the access form, not a reload.
      const screen = state === 'restarted' ? runRestartedScreen() : accessLapsedScreen();
      messageNode = el('p'); messageNode.hidden = true; content.append(screen);
      if (focused || followupFocused) screen.querySelector('.vm-btn')?.focus(); return;
    }
    const refused = isRefused(model);
    if (refused) {
      const actions = [links?.help && button({ label: 'Contact scheme support', variant: 'primary', href: links.help }),
        links?.cars && button({ label: 'Back to Your cars', variant: 'ghost', href: links.cars })].filter(Boolean);
      const screen = statusScreen({ title: REFUSED_TITLE, level: 1, message: messageFor(model, links?.help), actions, role: null });
      messageNode = screen.querySelector('.vm-lede'); content.append(screen);
    } else {
      content.append(screenIntro({ title: titleFor(model), level: 1 }));
      // The deadline leads, directly under the heading, so it is not found below the declarations.
      if (state === 'pending') { clockNode = el('p', 'gcsp-countdown'); content.append(clockNode); }
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
    if ((['pending', 'superseded', 'uncertain'].includes(state) || refused) && model.card?.members?.length === 1) {
      const columns = el('div', 'gcsp-offer-comparison');
      const offer = el('section', 'gcsp-offer-exact');
      offer.setAttribute('aria-label', 'The offered car');
      const card = structuredClone(model.card); const member = card.members[0]; member.actions = [];
      // Compared specs live in the table, so the card keeps identity facts only (when there is a current car).
      if (model.currentCar) { const shared = new Set(model.currentCar.facts.map((row) => row.label)); member.facts = member.facts.filter((row) => !shared.has(row.label)); }
      offer.append(matchCard(null, { view: card, big: true, showScore: false, factsClass: 'vm-facts-pair', hideMissing: 'More details not supplied', headingLevel: 2 }));
      // A bare "Eligible" label adds nothing; other gate states still show.
      offer.querySelector('.vm-card[data-gate="eligible"] .vm-card-gate')?.remove();
      columns.append(offer, comparison(model.card.members[0], model.currentCar)); content.append(columns);
    }
    const summary = state === 'declined' ? declinedLine(model.card, Boolean(followupHandle(model.followup, state))) : '';
    if (summary) { const line = el('p', 'gcsp-note', summary); line.dataset.offerDeclinedSummary = ''; content.append(line); }
    if (state === 'pending') {
      decisionGroup = el('div', 'gcsp-offer-content');
      if (model.handoff) decisionGroup.append(handoffGroup(model, page.id, tickDeclaration));
      const actions = el('div', 'gcsp-offer-actions');
      const reason = el('p', 'gcsp-note', decisionReason(model));
      reason.id = `${page.id}-decision-reason`;
      reasonNode = reason;
      for (const [kind, label, enabled] of [['accept', 'Accept this offer', model.canAccept], ['decline', 'Decline this offer', model.canDecline]]) {
        const control = button({ label, variant: kind === 'accept' ? 'primary' : 'ghost', disabled: !enabled,
          describedBy: reason.id, onClick: () => { accepting = kind === 'accept'; decide?.(kind); } });
        control.dataset.offerAction = kind; control.hidden = kind === 'accept' && Boolean(model.handoff?.blocker); actions.append(control);
      }
      decisionGroup.append(reason, actions); content.append(decisionGroup);
      reasonForm = el('section', 'gcsp-offer-content'); reasonForm.setAttribute('aria-label', 'Decline this offer');
      reasonStatus = el('p', 'gcsp-note'); reasonStatus.tabIndex = -1;
      reasonSelect = el('select'); reasonSelect.required = true; reasonSelect.dataset.offerReason = '';
      reasonSelect.addEventListener('change', () => {
        selectReason?.(reasonSelect.value);
        // Choosing a reason must leave focus on the select, never on the page body.
        if (root.ownerDocument.activeElement !== reasonSelect && !reasonSelect.disabled) reasonSelect.focus();
      });
      const fieldId = `${page.id}-decline-reason`;
      reasonField = labelledField({ id: fieldId, label: 'Reason for declining', control: reasonSelect });
      reasonSummary = errorSummary({ id: `${page.id}-reason-errors` });
      const confirmation = el('div', 'gcsp-offer-actions');
      confirmButton = button({ label: 'Confirm decline', variant: 'primary',
        onClick: () => decide?.('decline', { reasonCode: reasonSelect.value }) });
      confirmButton.dataset.offerAction = 'decline-confirm';
      cancelButton = button({ label: 'Keep this offer', variant: 'ghost', onClick: () => cancelDecline?.() });
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
    if (state !== 'loading' && !exit) {
      const control = button({ label: state === 'error' ? 'Try again' : 'Check current state', variant: 'ghost', onClick: refreshCurrent });
      if (state !== 'error') control.classList.add('gcsp-offer-quiet');
      control.dataset.offerAction = 'refresh'; content.append(control, checkNode);
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
    // Decline takes the place of the declarations and Accept, so only one primary shows.
    reasonForm.hidden = !reason.open; decisionGroup.hidden = reason.open;
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
    reasonsRefresh.hidden = reason.status !== 'unavailable';
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
    lastModel = model;
    const nextStructure = JSON.stringify([model.state, model.card, model.currentCar, model.fixtureNotice, model.handoff, model.selection, model.orderUuid]);
    // Keep the kit's own decision live region and keyboard controls mounted across clock reads.
    if (structure !== nextStructure) { draw(model); structure = nextStructure; }
    messageNode.textContent = messageFor(model, links?.help) || '';
    messageNode.hidden = !messageNode.textContent;
    if (model.state === 'pending') accepting = false;
    updateFollowup(model);
    if (model.state === 'pending') {
      clockNode.textContent = model.countdown || 'Time remaining unavailable';
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
    else if (!checking && previousState !== undefined && previousState !== 'loading' && (model.state !== previousState || key !== previousIdentity)) announce(titleFor(model));
    previousState = model.state; previousIdentity = key;
  }
  return { update, destroy() { clearFollowup(); page.remove(); } };
}
