import { el, button, factList } from '../../vehicle-matcher/ui.js';
import { renderOptionList } from '../../vehicle-matcher/modes/question-ui.js';
import { sideDrawer } from '../kit/side-drawer.js';
import { checkboxField, labelledField, errorSummary } from '../kit/form-controls.js';

let sequence = 0;
const missing = 'To confirm';
const mileage = (value) => Number.isFinite(value?.value) ? `${value.value.toLocaleString('en-GB')} ${value.unit}` : missing;
const date = (value) => /^\d{4}-\d\d-\d\d$/.test(value || '') && Number.isFinite(Date.parse(value))
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : missing;
const blockers = { 'contact-required': 'Confirm your contact details with scheme support.',
  'driver-review-required': 'Confirm the driver and licence details with driver support.',
  'return-data-required': 'Confirm the old contract and expected return mileage before accepting.',
  'ordering-terms-unavailable': 'Scheme terms are unavailable. Check the offer again.' };
const section = (title, ...nodes) => {
  const root = el('section', 'gcsp-offer-drawer-section'); root.append(el('h3', 'gcsp-h3', title), ...nodes); return root;
};

/** One offer decision review, composed from the shared modal and controlled form primitives. */
export function createDecisionDrawer({ host, decide, tickDeclaration, setExpectedReturnMileage, selectReason, cancelDecline, refreshReasons, refresh, announce, announcement, opener } = {}) {
  const id = `gcsp-offer-decision-${++sequence}`;
  let drawer; let kind; let current; let submitted = false; let body; let footerNote; let confirm; let cancel;
  let feedback; let summary; let choices; let choicesKey; let choiceRoot; let reasonStatus; let reasonRetry;
  let boxes = []; let lastError = ''; let sourceKey; let mileageInput; let mileageField; let mileageTouched = false; let reasonPhase;
  const close = (restore = true) => drawer?.close(restore);
  function decision() {
    if (submitted || !current) return;
    if (current.state === 'uncertain') { void refresh?.(); return; }
    if (current.state !== 'pending') return;
    if (kind === 'accept' && !current.canAccept) return;
    if (kind === 'decline' && current.declineReason?.status !== 'ready') return;
    if (kind === 'decline' && !current.declineReason?.selectedCode) {
      void decide?.('decline', { reasonCode: '' }); return;
    }
    submitted = true; update(current);
    Promise.resolve(decide?.(kind, kind === 'decline' ? { reasonCode: current.declineReason.selectedCode } : undefined))
      .catch(() => {}).finally(() => { submitted = false; if (drawer) update(current); });
  }
  function documents(handoff, driverSection, returnSection) {
    const list = el('div', 'gcsp-offer-document-links');
    const terms = el('details', 'gcsp-details'); terms.id = `${id}-terms`;
    const title = el('summary', 'gcsp-details-summary', 'Scheme terms');
    terms.append(title, el('p', 'gcsp-note', handoff.wording || 'Scheme terms are unavailable.'));
    const rows = [[terms, title, 'Read scheme terms'], [driverSection, driverSection.querySelector('h3'), 'View driver and licence record']];
    if (returnSection) rows.push([returnSection, returnSection.querySelector('h3'), 'View old contract and return mileage']);
    for (const [target, focus, label] of rows) {
      if (!target.id) target.id = `${id}-${list.children.length}-record`;
      const link = el('a', null, label); link.href = `#${target.id}`;
      link.addEventListener('click', (event) => {
        event.preventDefault(); if (target.tagName === 'DETAILS') target.open = true;
        focus.tabIndex = -1; focus.focus(); target.scrollIntoView?.({ block: 'nearest' });
      }); list.append(link);
    }
    return section('Documents', list, terms);
  }
  function acceptance(model) {
    const handoff = model.handoff || {}; const contact = handoff.contact; const driver = handoff.driver;
    const driverSection = section('Driver and licence', factList([
      { label: 'Nominated driver', value: driver?.name || missing }, { label: 'Licence number', value: driver?.licence?.displayNumber || missing },
      { label: 'Valid until', value: date(driver?.licence?.validUntil) },
      { label: 'Car entitlement', value: driver?.licence?.categories?.includes('car') ? 'Car' : missing }]));
    const car = handoff.returnCar;
    const returnSection = handoff.mode === 'replacement' ? section('The car you will return',
      el('p', 'gcsp-note', car?.model || missing), factList([
        { label: 'Contract ends', value: date(car?.contractEndDate) }, { label: 'Recorded mileage', value: mileage(car?.currentOdometer) }]),
      el('p', 'gcsp-note', 'Arrange its return after your new car is confirmed.')) : null;
    if (returnSection) {
      mileageInput = el('input'); mileageInput.type = 'text'; mileageInput.inputMode = 'numeric'; mileageInput.pattern = '[0-9]*'; mileageInput.required = true;
      mileageInput.maxLength = 16; mileageInput.value = model.expectedReturnMileage || ''; mileageInput.dataset.offerExpectedMileage = '';
      mileageInput.addEventListener('input', () => setExpectedReturnMileage?.(mileageInput.value));
      mileageInput.addEventListener('blur', () => { mileageTouched = true; update(current); });
      mileageField = labelledField({ id: `${id}-expected-mileage`, label: 'Expected return mileage (miles)', control: mileageInput,
        hint: 'The mileage your current car will have when you return it.' });
      returnSection.append(mileageField.root);
    }
    const declarations = section('Before you accept');
    declarations.setAttribute('role', 'group'); declarations.setAttribute('aria-label', 'Declarations');
    boxes = (handoff.declarations || []).map((row, index) => {
      const field = checkboxField({ id: `${id}-declaration-${index}`, label: row.label,
        checked: model.ticked?.[row.id] === true, onChange: (checked) => tickDeclaration?.(row.id, checked) });
      field.input.dataset.offerDeclaration = row.id; declarations.append(field.root); return field.input;
    });
    body.append(section('Your contact details', factList([{ label: 'Email', value: contact?.email || missing }, { label: 'Phone', value: contact?.phone || missing }])),
      driverSection, ...(returnSection ? [returnSection] : []), documents(handoff, driverSection, returnSection), declarations);
  }
  function decline() {
    choiceRoot = el('div'); choiceRoot.id = `${id}-reasons`; choiceRoot.tabIndex = -1;
    reasonStatus = el('p', 'gcsp-note'); reasonStatus.tabIndex = -1;
    reasonRetry = button({ label: 'Check reasons again', variant: 'ghost', onClick: () => refreshReasons?.() });
    reasonRetry.dataset.offerAction = 'reasons-refresh';
    body.append(section('Why are you declining?', el('p', 'gcsp-note', 'Your feedback helps your car buddy look again.'), reasonStatus, choiceRoot, reasonRetry));
  }
  function vehicle(model) {
    const member = model.card?.members?.[0];
    const car = section(member?.display?.name || 'Your offered car'); car.classList.add('gcsp-offer-drawer-vehicle');
    const finishes = member?.facts?.filter((row) => ['Paint', 'Colour', 'Interior', 'Upholstery'].includes(row.label) && row.value).map((row) => row.value);
    if (finishes?.length) car.append(el('p', 'gcsp-note', finishes.join(' · ')));
    const points = member?.terms?.find((row) => row.kind === 'points-monthly');
    car.append(el('p', 'gcsp-note', Number.isFinite(points?.value) ? `${points.value.toLocaleString('en-GB')} points a month` : 'Points not supplied'));
    return car;
  }
  function open(nextKind, model) {
    if (!['accept', 'decline'].includes(nextKind) || model.state !== 'pending'
      || !(nextKind === 'accept' ? model.canReviewAccept : model.canDecline)) return;
    if (drawer) close(false);
    current = model; kind = nextKind; boxes = []; mileageInput = undefined; mileageField = undefined; mileageTouched = false; choices = undefined; choicesKey = undefined; lastError = ''; sourceKey = undefined; reasonPhase = undefined;
    body = el('div', 'gcsp-offer-drawer-content');
    feedback = el('p', 'gcsp-note'); feedback.tabIndex = -1; feedback.hidden = true;
    summary = errorSummary({ id: `${id}-errors`, title: 'Check before continuing' });
    body.append(vehicle(model), feedback, summary.root);
    if (kind === 'accept') acceptance(model); else decline();
    footerNote = el('p', 'gcsp-note gcsp-offer-decision-note');
    confirm = button({ label: kind === 'accept' ? 'Accept offer' : 'Confirm decline', variant: 'primary', onClick: decision });
    confirm.classList.add('gcsp-offer-decision-button');
    confirm.dataset.offerAction = kind === 'accept' ? 'accept-confirm' : 'decline-confirm';
    cancel = button({ label: kind === 'accept' ? 'Keep reviewing' : 'Keep this offer', variant: 'ghost', onClick: () => close() });
    cancel.classList.add('gcsp-offer-decision-button');
    cancel.dataset.offerAction = `${kind}-cancel`;
    drawer = sideDrawer({ host, context: 'Your vehicle offer', title: kind === 'accept' ? 'Accept your offer' : 'Decline your offer',
      body: [body], footer: [footerNote, confirm, cancel, ...announcement ? [announcement] : []], opener: () => opener?.(kind), onClose: () => {
        const previousKind = kind; drawer = undefined; kind = undefined; submitted = false;
        if (announcement) host.append(announcement);
        if (previousKind === 'decline') cancelDecline?.();
      } });
    drawer.root.dataset.offerDecisionDrawer = nextKind;
    update(model);
    if (kind === 'decline' && !model.declineReason?.open) void decide?.('decline');
  }
  function update(model) {
    const previous = current;
    current = model;
    if (!drawer) {
      if (model.state === 'pending' && model.declineReason?.open) open('decline', model);
      return;
    }
    if (!['pending', 'uncertain'].includes(model.state)) { close(false); return; }
    if (previous?.reference && model.reference && ['offerId', 'runId'].some((key) => previous.reference[key] !== model.reference[key])) { close(); return; }
    drawer.setDismissible(!submitted); cancel.disabled = submitted;
    const pending = submitted || model.state === 'uncertain';
    const nextSource = JSON.stringify([model.reference, model.handoff]);
    if (!sourceKey) sourceKey = nextSource;
    else if (model.state === 'pending' && sourceKey !== nextSource) {
      sourceKey = nextSource;
      body.firstElementChild.replaceWith(vehicle(model));
      if (kind === 'accept') { while (body.children.length > 3) body.lastElementChild.remove(); acceptance(model); }
      announce?.('The offer details changed. Review them before deciding.');
    }
    for (const box of boxes) { box.checked = model.ticked?.[box.dataset.offerDeclaration] === true; box.disabled = pending; }
    let errors = [];
    if (kind === 'accept') {
      const handoff = model.handoff;
      const missingReturn = handoff?.mode === 'replacement' && Boolean(model.returnMileageError);
      const missingDriver = !handoff?.driver?.name || !handoff.driver?.licence?.displayNumber;
      const text = handoff?.blocker ? blockers[handoff.blocker] : model.actions?.accept !== true ? 'Acceptance is currently unavailable. Check the current offer again.' : missingDriver ? 'Confirm the driver and licence details before accepting.'
        : missingReturn ? 'Confirm the expected return mileage before accepting.' : '';
      if (mileageInput) {
        mileageInput.disabled = pending;
        if (mileageInput.value !== model.expectedReturnMileage) mileageInput.value = model.expectedReturnMileage || '';
        mileageField.setError(mileageTouched || model.expectedReturnMileage ? model.returnMileageError || '' : '');
      }
      if (text && (!missingReturn || mileageTouched || handoff?.blocker || model.actions?.accept !== true)) errors.push({ id: missingReturn && mileageInput && !handoff?.blocker && model.actions?.accept === true ? mileageInput.id : boxes[0]?.id || `${id}-terms`, message: text });
      confirm.disabled = pending || !model.canAccept || missingReturn || missingDriver;
      footerNote.textContent = 'Accepting sends your selection for scheme checks. Confirm each declaration to continue.';
    } else {
      const reason = model.declineReason || {};
      const active = host.ownerDocument.activeElement;
      const ownedFocus = active === reasonStatus || active === drawer.panel.querySelector('h2') || choices?.list.contains(active);
      const key = JSON.stringify(reason.choices || []);
      if (key !== choicesKey) {
        choices = renderOptionList({ id: `${id}-reason`, label: 'Reason for declining', options: (reason.choices || []).map(({ code, label }) => ({ value: code, label })) }, null,
          { value: reason.selectedCode || null, variant: 'rows', disabled: pending || reason.status !== 'ready', onValueChange: (code) => selectReason?.(code) });
        [...choices.list.querySelectorAll('[role="radio"]')].forEach((control, index) => { control.id = `${id}-reason-${index}`; control.dataset.offerReason = reason.choices[index].code; });
        choices.list.id = `${id}-choice-list`; choices.list.setAttribute('aria-required', 'true');
        choiceRoot.replaceChildren(choices.list); choicesKey = key;
      }
      choices.update({ value: reason.selectedCode || null, disabled: pending || reason.status !== 'ready' || !model.canDecline });
      choices.list.setAttribute('aria-invalid', String(Boolean(reason.error)));
      reasonStatus.textContent = reason.status === 'loading' ? 'Loading reasons.' : reason.status === 'unavailable' ? 'Reasons are unavailable. Check again.' : '';
      reasonStatus.hidden = !reasonStatus.textContent; reasonRetry.hidden = reason.status !== 'unavailable'; reasonRetry.disabled = pending;
      confirm.disabled = pending || reason.status !== 'ready' || !model.canDecline;
      if (reason.error) errors.push({ id: choices.list.querySelector('[role="radio"]')?.id || choiceRoot.id, message: reason.error });
      footerNote.textContent = 'Declining releases your reserved car. Your buddy will use your feedback to look again.';
      if (ownedFocus && !pending) {
        if (!model.canDecline) cancel.focus();
        else if (reason.status === 'loading') reasonStatus.focus();
        else if (reason.status === 'unavailable') reasonRetry.focus();
        else if (reason.status === 'ready' && reasonPhase !== 'ready') choices.list.querySelector('[role="radio"][tabindex="0"]')?.focus();
      }
      reasonPhase = reason.status;
    }
    summary.update(errors);
    const error = errors.map((row) => row.message).join(' ');
    if (error && error !== lastError) { announce?.(error); if (kind === 'decline') summary.focus(); }
    lastError = error;
    const text = pending ? model.message || 'Checking your decision. Please wait.' : model.message || '';
    feedback.textContent = text; feedback.hidden = !text;
    if (pending && !submitted) {
      confirm.disabled = false; confirm.textContent = 'Check current state';
      cancel.textContent = 'Close';
    }
    else { confirm.textContent = submitted ? (kind === 'accept' ? 'Accepting offer' : 'Declining offer') : kind === 'accept' ? 'Accept offer' : 'Confirm decline';
      cancel.textContent = kind === 'accept' ? 'Keep reviewing' : 'Keep this offer'; }
  }
  return { open, update, close, destroy() { close(false); } };
}
