import { el, screenIntro, button, factList, statusScreen } from '../../vehicle-matcher/ui.js';
import { renderRangeSlider, renderOptionList } from '../../vehicle-matcher/modes/question-ui.js';
import { matchCard, previewTile, SPEC_LABELS, FUEL_SPEC } from '../../vehicle-matcher/modes/result-card.js';
import { createBriefController } from './brief-controller.js';
import { decisionView, previewSummary } from './brief-view-model.js';

let sequence = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const titleCase = (v) => v[0].toUpperCase() + v.slice(1);
const stateText = (state, context) => state === 'confirmed' ? 'Confirmed' : state === 'inferred' ? 'Inferred, please review' : context.unconfirmedLabel;

/** Mount one controller-owned draft. Async updates patch controls and never replace the editing form. */
export function mountBriefBody(main, adapters = {}) {
  const abort = new AbortController();
  let alive = true; let controller; let unsubscribe; let generation = 0;
  const prefix = `gcsp-brief-${++sequence}`;
  const cleanup = () => { alive = false; abort.abort(); unsubscribe?.(); controller?.destroy(); main.replaceChildren(); };
  const loading = el('p', 'gcsp-note', 'Loading your brief.'); loading.setAttribute('role', 'status'); main.replaceChildren(loading);
  const externalAbort = () => cleanup();
  adapters.signal?.addEventListener('abort', externalAbort, { once: true });
  const finish = () => { adapters.signal?.removeEventListener('abort', externalAbort); cleanup(); };
  function unavailable() {
    main.replaceChildren(statusScreen({ title: 'Your brief could not be loaded', message: 'Your account and brief are unavailable. Try loading them again.',
      actions: [button({ label: 'Try again', onClick: () => load() })] }));
  }
  function draw(editor) {
    if (!alive) return;
    const context = editor.context;
    try {
      const transport = Object.fromEntries(['preview', 'saveDraft', 'confirm'].map((key) => [key, (input) => adapters.transport[key](input, { signal: abort.signal })]));
      if (!adapters.transport || !['preview', 'saveDraft', 'confirm'].every((key) => typeof adapters.transport[key] === 'function')) throw new TypeError('Missing transport');
      controller = createBriefController({ ...editor, transport,
        createCommandId: adapters.createCommandId || ((kind) => `${kind}:${globalThis.crypto.randomUUID()}`) });
    } catch { unavailable(); return; }
    const page = el('div', 'vm gcsp-brief');
    page.append(screenIntro({ title: 'Your car brief', level: 1, lede: 'Tell us what you would enjoy and what your next car needs to do. See how the cars compare before you save.' }));
    if (adapters.notice) page.append(el('p', 'gcsp-brief-notice', adapters.notice));
    const jump = button({ label: 'Go to your preview', href: `#${prefix}-preview`, variant: 'ghost' });
    page.append(jump);
    const current = el('details', 'gcsp-brief-known');
    current.append(el('summary', null, 'What your scheme already knows'));
    const facts = context.knownFacts || {};
    const contract = facts.currentContract?.value;
    current.append(factList([
      { label: `Current car · ${facts.currentContract?.source || 'Source not supplied'}`, value: contract?.model },
      { label: 'Contract ends', value: contract?.contractEndDate },
      { label: `Drivers · ${facts.drivers?.source || 'Source not supplied'}`, value: facts.drivers?.value?.map((d) => d.name).join(', ') },
      { label: `Annual mileage · ${facts.annualMileage?.source || 'Source not supplied'}`, value: facts.annualMileage?.value?.value, unit: facts.annualMileage?.value?.unit },
    ]));
    current.append(el('p', 'gcsp-note', 'These are supplied account facts. You cannot change them in this brief.'));
    page.append(current);
    const layout = el('div', 'gcsp-brief-layout');
    const form = el('form', 'gcsp-brief-form'); form.addEventListener('submit', (event) => event.preventDefault());
    const preferences = el('section', 'gcsp-brief-section');
    preferences.append(el('h2', null, 'What matters to you'), el('p', 'gcsp-note', 'Choose a preference, then say how much it matters. Comfort and sportiness can both be high.'));
    const handles = new Map();
    for (const [key, definition] of Object.entries(context.preferences)) {
      const initial = controller.snapshot().brief.preferences[key];
      const field = el('fieldset', 'gcsp-brief-preference');
      field.append(el('legend', null, definition.label));
      const help = el('p', 'gcsp-note'); help.id = `${prefix}-${key}-source`; field.append(help);
      const axes = el('div', 'gcsp-brief-axes');
      const valueWrap = el('div', 'gcsp-brief-axis'); const importanceWrap = el('div', 'gcsp-brief-axis');
      valueWrap.append(el('p', 'gcsp-brief-axis-label', 'What you prefer')); importanceWrap.append(el('p', 'gcsp-brief-axis-label', 'How much it matters'));
      const valueState = el('p', 'gcsp-note'); const importanceState = el('p', 'gcsp-note');
      const range = (host, value, label, onValueChange) => renderRangeSlider(host, { id: `${prefix}-${key}-${label}`, min: context.slider.minimum, max: context.slider.maximum, step: 1 }, null,
        { single: true, value, disabled: !definition.editable, ariaLabel: `${definition.label}: ${label}`, onValueChange });
      let value;
      if (definition.type === 'slider') value = range(valueWrap, initial?.value, 'what you prefer', (v) => controller.updatePreference(key, { value: v }));
      else {
        value = renderOptionList({ id: key, options: definition.values.map((v) => ({ value: v, label: SPEC_LABELS[v] || FUEL_SPEC[v] || titleCase(v) })) }, null,
          { value: initial?.value, disabled: !definition.editable, ariaLabel: `${definition.label}: what you prefer`, onValueChange: (v) => controller.updatePreference(key, { value: v }) });
        valueWrap.append(value.list);
      }
      const importance = range(importanceWrap, initial?.importance, 'how much it matters', (v) => controller.updatePreference(key, { importance: v }));
      const indifferent = button({ label: "I don't mind", variant: 'ghost', disabled: !definition.editable, onClick: () => controller.updatePreference(key, { importance: context.slider.minimum }) });
      indifferent.dataset.indifference = key;
      valueWrap.append(valueState); importanceWrap.append(importanceState, indifferent);
      axes.append(valueWrap, importanceWrap); field.append(axes); preferences.append(field);
      field.setAttribute('aria-describedby', help.id);
      handles.set(key, { value, importance, indifferent, valueState, importanceState, help });
    }
    form.append(preferences);
    const practical = el('section', 'gcsp-brief-section');
    practical.append(el('h2', null, 'What your car needs to do'), el('p', 'gcsp-note', 'Not sure yet is a valid answer. It may leave some cars needing confirmation. Your scheme requirements still apply.'));
    const questions = new Map();
    for (const [key, question] of Object.entries(context.practicalQuestions)) {
      const field = el('fieldset', 'gcsp-brief-question'); field.append(el('legend', null, question.label));
      let chargingOpen = false;
      const choices = renderOptionList({ id: key, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Not sure yet' }] }, null,
        { value: null, ariaLabel: question.label, disabled: !context.essentials[key]?.editable, onValueChange: (v) => {
          chargingOpen = key === 'charging' && v === 'yes';
          controller.updateEssential(key, chargingOpen ? null : question[v]);
        } });
      field.append(choices.list);
      let subchoices; let subwrap;
      if (key === 'charging') {
        subwrap = el('div', 'gcsp-brief-subchoice'); subwrap.dataset.chargingChoices = ''; subwrap.hidden = true;
        subwrap.append(el('p', 'gcsp-note', 'Where can you charge? Choose a place to complete Yes.'));
        subchoices = renderOptionList({ id: 'charging-place', options: question.yes.map((v) => ({ value: v, label: v === 'either' ? 'Home or work' : titleCase(v) })) }, null,
          { value: null, ariaLabel: 'Charging place', onValueChange: (v) => controller.updateEssential(key, v) });
        subwrap.append(subchoices.list); field.append(subwrap);
      }
      const note = el('p', 'gcsp-note'); note.id = `${prefix}-${key}-answer`; field.append(note); choices.list.setAttribute('aria-describedby', note.id);
      questions.set(key, { update(essential) {
        const value = essential?.value;
        const isYes = key === 'charging' ? question.yes.includes(value) : same(value, question.yes);
        const isNo = same(value, question.no);
        const representable = value === null || value === undefined || isYes || isNo;
        choices.update({ value: isYes || chargingOpen ? 'yes' : isNo ? 'no' : value === null || value === undefined ? 'unknown' : null });
        if (subwrap) { subwrap.hidden = !(chargingOpen || isYes); subchoices.update({ value: isYes ? value : null }); }
        note.textContent = !representable ? `Current answer ${JSON.stringify(value)} needs review with an updated question.` : value === null ? 'Not confirmed. This requirement remains unknown.' : `${stateText(essential?.state, context)} · Source: ${essential?.source || 'Not supplied'}`;
      } });
      practical.append(field);
    }
    form.append(practical);
    const permission = el('fieldset', 'gcsp-brief-section'); permission.append(el('legend', null, 'What your buddy may do'));
    const consent = renderOptionList({ id: 'brief-consent', multi: true, options: [{ value: 'search', label: 'Search for cars for me' }, { value: 'hold', label: 'Hold a suitable car for me' }] }, null,
      { value: [], ariaLabel: 'Buddy permissions', onValueChange: (v) => controller.setConsent({ search: v.includes('search'), hold: v.includes('hold') }) });
    permission.append(consent.list, el('p', 'gcsp-note', 'Holding needs search permission too. Saving without search permission leaves your buddy off.')); form.append(permission);
    const savePanel = el('section', 'gcsp-brief-section');
    savePanel.append(el('h2', null, 'Ready to save?'), el('p', 'gcsp-note', 'Save confirms the displayed preferences, including any starting positions you have left in place. Unknown requirements stay unknown.'));
    const saveButton = button({ label: 'Save this brief', onClick: () => controller.save() }); saveButton.dataset.saveBrief = '';
    const saveNote = el('p', 'gcsp-note');
    if (adapters.saveUnavailableReason) savePanel.append(el('p', 'gcsp-note', adapters.saveUnavailableReason));
    const refresh = button({ label: 'Refresh and review', variant: 'ghost', onClick: () => { replacement.hidden = false; } }); refresh.hidden = true;
    const replacement = el('div', 'gcsp-brief-refresh'); replacement.hidden = true;
    replacement.append(el('p', 'gcsp-note', 'Loading the current server brief will replace your displayed edits and permissions.'), button({ label: 'Replace draft with current server brief', onClick: () => load() }));
    savePanel.append(saveButton, saveNote, refresh, replacement); form.append(savePanel);
    const preview = el('section', 'gcsp-brief-preview'); preview.id = `${prefix}-preview`; preview.tabIndex = -1;
    preview.append(el('h2', null, 'Preview of your current draft'), el('p', 'gcsp-note', 'Unsaved preview. Starting positions may still be unconfirmed. This does not give your buddy permission.'));
    const status = el('p', 'gcsp-brief-preview-status');
    const cards = el('div', 'gcsp-brief-cards');
    const retry = button({ label: 'Retry preview', variant: 'ghost', onClick: () => controller.requestPreview() }); retry.hidden = true;
    const live = el('p', 'gcsp-brief-live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
    preview.append(status, retry, cards); layout.append(form, preview); page.append(layout, live); main.replaceChildren(page);
    let lastPreview;
    const patch = (state) => {
      for (const [key, h] of handles) {
        const p = state.brief.preferences[key]; if (!p) continue;
        h.value.update({ value: p.value, valueState: p.valueState === 'confirmed' ? 'confirmed' : 'unconfirmed' });
        h.importance.update({ value: p.importance, valueState: p.importanceState === 'confirmed' ? 'confirmed' : 'unconfirmed' });
        h.indifferent.setAttribute('aria-pressed', String(p.importance === context.slider.minimum));
        h.valueState.textContent = stateText(p.valueState, context); h.importanceState.textContent = p.importance === context.slider.minimum ? "I don't mind" : stateText(p.importanceState, context);
        h.help.textContent = `Source for both axes: ${p.source}`;
      }
      for (const [key, q] of questions) q.update(state.brief.essentials[key]);
      consent.update({ value: ['search', 'hold'].filter((k) => state.consent[k]) });
      saveButton.disabled = state.save.state === 'saving' || Boolean(adapters.saveUnavailableReason);
      saveButton.textContent = state.save.state === 'saving' ? 'Saving your brief...' : 'Save this brief';
      saveNote.textContent = state.save.state === 'saved' ? `Brief version ${state.briefVersion} saved. ${state.dirty ? 'Newer edits are still unsaved.' : state.consent.search ? 'Your selected buddy permissions apply.' : 'Your buddy is off.'}`
        : state.save.state === 'refresh-required' ? 'A newer saved version needs review. Your edits and permissions are still here.'
          : state.save.state === 'failed' ? 'Your brief could not be saved. Your edits and permissions are still here. Try Save again.' : state.dirty || adapters.initialEdited ? 'You have unsaved changes.' : 'Nothing has been saved from this screen.';
      refresh.hidden = state.save.state !== 'refresh-required';
      preview.setAttribute('aria-busy', String(state.preview.state === 'loading'));
      const summary = previewSummary(state.preview); status.textContent = `${summary}${state.preview.state === 'unavailable' && adapters.previewUnavailableReason ? ` ${adapters.previewUnavailableReason}` : ''}`;
      retry.hidden = state.preview.state !== 'unavailable';
      const identity = JSON.stringify(state.preview);
      if (identity !== lastPreview) {
        lastPreview = identity;
        cards.replaceChildren();
        if (state.preview.outcome?.status === 'ok') {
          for (const decision of state.preview.outcome.value.decisions) {
            const view = decisionView(decision);
            const card = decision.gateStatus === 'eligible' ? matchCard(null, { view }) : previewTile(null, { view });
            card.querySelectorAll('[aria-live]').forEach((node) => node.removeAttribute('aria-live'));
            cards.append(card);
          }
          live.textContent = summary;
        } else if (state.preview.state === 'unavailable') live.textContent = `${summary}${adapters.previewUnavailableReason ? ` ${adapters.previewUnavailableReason}` : ''}`;
      }
      if (state.save.state !== 'idle' && state.save.state !== 'saving') live.textContent = saveNote.textContent;
    };
    unsubscribe = controller.subscribe(patch); patch(controller.snapshot()); controller.requestPreview();
  }
  function load(useInitial = false) {
    const current = ++generation;
    unsubscribe?.(); controller?.destroy(); unsubscribe = undefined; controller = undefined;
    main.replaceChildren(loading);
    if (useInitial && adapters.editor) { draw(adapters.editor); return; }
    if (typeof adapters.loadEditor !== 'function') { unavailable(); return; }
    Promise.resolve().then(() => alive && current === generation ? adapters.loadEditor({ signal: abort.signal }) : null).then((outcome) => {
      if (alive && current === generation) { if (outcome?.status === 'ok') draw(outcome.value); else unavailable(); }
    }).catch(() => { if (alive && current === generation) unavailable(); });
  }
  if (adapters.signal?.aborted) { finish(); return finish; }
  load(true);
  return finish;
}
