import { el, screenIntro, button, factList, statusScreen } from '../../vehicle-matcher/ui.js';
import { renderOptionList, renderRangeSlider } from '../../vehicle-matcher/modes/question-ui.js';
import { matchCard } from '../../vehicle-matcher/modes/result-card.js';
import { labelledField } from '../kit/form-controls.js';
import { dataTable } from '../kit/data-table.js';

let sequence = 0;
const label = (v) => String(v).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
const valueText = (v) => Array.isArray(v) ? v.length ? v.join(', ') : 'None listed' : v === null || v === undefined ? 'Not supplied' : String(v);
const requirementText = (row) => `${row.kind === 'essential' && row.operator === 'gte' ? 'At least ' : row.kind === 'essential' && row.operator === 'includes' ? 'Includes ' : ''}${valueText(row.value)}${row.unit ? ` (${row.unit})` : ''}`;
const factText = (v) => v?.status !== 'known' ? 'Not supplied'
  : `${valueText(v.value)}${v.unit ? ` (${v.unit})` : ''}`;
const messages = {
  idle: ['Your next offer', ''], loading: ['Checking your next offer', 'Please wait.'],
  'change-saved': ['Change saved', 'Check whether your next offer is ready.'],
  waiting: ['Waiting for the next release', 'Your change is saved. Your next offer is checked when more cars are released.'],
  'no-match': ['Nothing suitable yet', 'We will check again at the next release.'],
  unavailable: ['Next-offer status unavailable', 'Try checking again.'],
  'confirmation-uncertain': ['Check your change', 'The save could not be confirmed.'],
  'refresh-required': ['Your brief has changed', 'Check the current state before choosing again.'],
  'stale-run': ['Follow-up from an earlier demo run', 'Open your current account to continue.'],
  forbidden: ['Follow-up unavailable', 'Open the offer from your account to continue.'],
};

function requirementRows(comparison) {
  return comparison.requirements.flatMap((row) => Object.keys(row.previousFacts ?? {}).map((key) => ({
    requirement: `${label(row.key)}: ${requirementText(row)}`,
    fact: label(key), previous: factText(row.previousFacts[key]), next: factText(row.nextFacts?.[key]),
  })));
}

function sources(comparison) {
  const section = el('details', 'gcsp-followup-sources'); section.append(el('summary', null, 'Quote sources and confirmed requirements'));
  for (const [key, name] of [['previous', 'Declined offer'], ['next', 'Next offer']]) {
    const offer = comparison[key].offer; const quote = offer.quote;
    section.append(el('h3', null, name), factList([
      { label: 'Quote', value: quote.quoteId }, { label: 'Brief version at quote', value: quote.briefVersion },
      { label: 'Policy at quote', value: quote.policyVersion }, { label: 'Quoted at', value: quote.quotedAt },
    ]));
  }
  for (const row of comparison.requirements) {
    section.append(el('h3', null, label(row.key)), factList([
      { label: 'Your confirmed answer', value: requirementText(row) },
      ...(row.kind === 'preference' ? [{ label: 'Confirmed importance', value: row.importance, unit: '%' }] : []),
    ]));
    for (const [key, name] of [['previousFacts', 'Declined offer'], ['nextFacts', 'Next offer']]) {
      for (const [field, fact] of Object.entries(row[key] ?? {})) {
        section.append(el('h4', null, `${name}: ${label(field)}`), factList([
          { label: 'Quoted value', value: fact?.status === 'known' ? valueText(fact.value) : null, unit: fact?.unit },
          { label: 'Source', value: fact?.provenance?.sourceRef }, { label: 'Source version', value: fact?.provenance?.version },
          { label: 'Observed at', value: fact?.provenance?.observedAt }, { label: 'Assurance', value: fact?.provenance?.assurance },
        ]));
      }
    }
  }
  return section;
}

/** Shared controls remain mounted while an answer changes. projectOffer is FUCQ-105's public projector. */
export function createFollowupView(root, { choose, confirm, refresh, projectOffer, openOffer } = {}) {
  const prefix = `gcsp-followup-${++sequence}`;
  const page = el('div', 'vm gcsp-followup'); const content = el('div', 'gcsp-followup-content');
  const live = el('p', 'gcsp-followup-live'); live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  page.append(content, live); root.replaceChildren(page);
  let structure; let control; let field; let error; let reason; let confirmButton; let lastAnnouncement = '';
  const action = (name, text, onClick, variant = 'ghost') => {
    const node = button({ label: text, onClick, variant }); node.dataset.followupAction = name; return node;
  };
  function drawQuestion(model) {
    content.append(screenIntro({ title: 'One change to your brief', level: 1 }));
    const form = el('form', 'gcsp-followup-question'); form.addEventListener('submit', (event) => { event.preventDefault(); confirm?.(); });
    const question = model.question;
    const adding = question.currentValue === null;
    field = el('fieldset', 'gcsp-followup-field'); field.append(el('legend', null, question.prompt));
    if (adding) field.append(el('p', 'gcsp-note', 'Not in your brief yet. Your answer adds it.'));
    const host = el('div', 'gcsp-followup-control'); field.append(host);
    if (question.control.kind === 'options') {
      control = renderOptionList({ id: prefix, options: question.control.options }, null,
        { value: model.value, ariaLabel: question.prompt, onValueChange: (v) => choose?.(v) }); host.append(control.list);
    } else if (question.control.kind === 'slider') {
      control = renderRangeSlider(host, { id: prefix, min: question.control.minimum, max: question.control.maximum, step: 1 }, null,
        { single: true, unit: { kind: 'percent' }, value: model.value, ariaLabel: question.prompt, onValueChange: (v) => choose?.(v) });
    } else {
      const input = el('textarea'); input.rows = 4; input.value = model.value.join('\n');
      const wrapped = labelledField({ id: `${prefix}-equipment`, label: 'Required equipment', control: input,
        hint: `One name per line, up to ${question.control.maximumItems} names and ${question.control.maximumItemLength} characters per name.${adding ? '' : ' Leave empty if none is required.'}` });
      input.addEventListener('input', () => choose?.(input.value.split('\n').map((v) => v.trim()).filter(Boolean)));
      host.append(wrapped.root);
      control = { update({ value, disabled }) {
        if (root.ownerDocument.activeElement !== input) input.value = value.join('\n');
        input.disabled = disabled;
      }, setError: wrapped.setError };
    }
    error = el('p', 'gcsp-note'); error.id = `${prefix}-error`; error.setAttribute('role', 'alert');
    reason = el('p', 'gcsp-note', 'Choose a different answer, then confirm.'); reason.id = `${prefix}-confirm-reason`;
    field.setAttribute('aria-describedby', error.id);
    confirmButton = button({ label: 'Confirm this change', disabled: true, describedBy: reason.id,
      onClick: () => confirm?.() }); confirmButton.dataset.followupAction = 'confirm';
    form.append(field, error, reason, confirmButton); content.append(form);
    content.append(action('refresh', 'Check current state', () => refresh?.()));
  }
  function drawComparison(model) {
    const comparison = model.comparison; let previous; let next;
    try {
      previous = projectOffer?.({ status: 'ok', value: comparison.previous.offer });
      next = projectOffer?.({ status: 'ok', value: comparison.next.offer });
      if (previous?.status !== 'ok' || next?.status !== 'ok'
        || previous.value.card?.members?.length !== 1 || next.value.card?.members?.length !== 1) return false;
    } catch { return false; }
    content.append(screenIntro({ title: 'Your next car offer', level: 1, lede: 'Compare the quoted cars with your confirmed answers.' }));
    const columns = el('div', 'gcsp-followup-cars');
    for (const [name, presented] of [['Declined offer', previous], ['Next offer', next]]) {
      const section = el('section', 'gcsp-followup-car'); section.append(el('h2', null, name));
      const card = structuredClone(presented.value.card); card.members[0].actions = [];
      section.append(matchCard(null, { view: card, big: true, showScore: false }));
      section.querySelectorAll('[aria-live]').forEach((node) => node.removeAttribute('aria-live')); columns.append(section);
    }
    content.append(columns, el('p', 'gcsp-note', 'Each quote keeps its original brief and policy. No new match score is calculated.'));
    content.append(dataTable({ caption: `Your confirmed brief, version ${comparison.currentBriefVersion}`,
      columns: [{ key: 'requirement', label: 'Your answer' }, { key: 'fact', label: 'Quoted fact' },
        { key: 'previous', label: 'Declined offer' }, { key: 'next', label: 'Next offer' }],
      rows: requirementRows(comparison), emptyText: 'No confirmed requirements were supplied for comparison.' }), sources(comparison));
    if (typeof openOffer === 'function') content.append(action('open', 'Open this offer', () => openOffer(structuredClone(next.value.reference)), 'primary'));
    content.append(action('refresh', 'Check current state', () => refresh?.())); return true;
  }
  function draw(model) {
    const hadFocus = content.contains(root.ownerDocument.activeElement); content.replaceChildren();
    control = null; field = null; error = null; reason = null; confirmButton = null;
    let ready = false;
    if (model.state === 'ready') {
      try { ready = drawComparison(model); } catch { ready = false; }
      if (!ready) content.replaceChildren();
    }
    if (model.state === 'question') drawQuestion(model);
    else if (ready) { /* Exact public projection supplied. */ }
    else {
      const key = model.state === 'ready' ? 'unavailable' : model.state;
      const [title, message] = messages[key] || messages.unavailable;
      const actions = [];
      if (key === 'confirmation-uncertain') actions.push(action('retry', 'Retry the same change', () => confirm?.(), 'primary'));
      if (!['idle', 'loading', 'forbidden', 'stale-run'].includes(key)) actions.push(action('refresh', 'Check current state', () => refresh?.()));
      const checked = model.evaluation?.carsChecked;
      const head = checked === 1 ? 'The 1 car checked does not fit your updated brief.'
        : `None of the ${checked} cars checked fit your updated brief.`;
      const shown = key === 'no-match' && checked > 0 ? `${head} ${message}`
        : model.savedChange && key === 'unavailable' ? 'Your change is saved. The next-offer status could not be checked.' : message;
      content.append(statusScreen({ title, message: shown, actions }));
    }
    if (model.savedChange) {
      const note = el('p', 'gcsp-note', `Your change is saved in brief version ${model.savedChange.briefVersion}.`);
      note.dataset.followupSaved = ''; content.prepend(note);
    }
    if (hadFocus) { const heading = content.querySelector('h1, h2'); if (heading) { heading.tabIndex = -1; heading.focus(); } }
  }
  function update(model) {
    const next = JSON.stringify([model.state, model.question?.questionVersion, model.comparison, model.savedChange, model.evaluation]);
    if (next !== structure) { draw(model); structure = next; }
    page.setAttribute('aria-busy', String(model.busy));
    if (model.state === 'question' && control) {
      field.disabled = Boolean(model.busy); control.update({ value: model.value, disabled: Boolean(model.busy) });
      error.textContent = model.error || ''; error.hidden = !model.error; control.setError?.(model.error || '');
      reason.textContent = model.busy ? 'Saving your change.' : model.canConfirm ? 'Only this answer will change.'
        : model.question.currentValue === null ? 'Choose an answer, then confirm.' : 'Choose a different answer, then confirm.';
      confirmButton.disabled = model.busy || !model.canConfirm; confirmButton.textContent = model.busy ? 'Saving your change...' : 'Confirm this change';
    }
    content.querySelectorAll('[data-followup-action]').forEach((node) => { if (node !== confirmButton) node.disabled = Boolean(model.busy); });
    const announcement = model.state === 'question' ? model.busy ? 'Saving your change.' : model.error || model.question.prompt
      : model.state === 'ready' ? content.querySelector('h1')?.textContent || 'Next-offer status unavailable'
        : (messages[model.state] || messages.unavailable)[0];
    if (announcement !== lastAnnouncement) { live.textContent = announcement; lastAnnouncement = announcement; }
  }
  return { update, destroy() { page.remove(); } };
}
