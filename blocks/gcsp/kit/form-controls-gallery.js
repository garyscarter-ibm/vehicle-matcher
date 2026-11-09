import { el, button, factList } from '../../vehicle-matcher/ui.js';
import { labelledField, errorSummary, checkboxField } from './form-controls.js';
import { stageList } from './stage-list.js';
import { rangeBar } from './range-bar.js';
import { showMore } from './show-more.js';
import { runRestartedScreen, runRestartedNotice, accessLapsedScreen } from './run-restarted.js';

export function formControlsExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-form-controls';
  section.append(el('h2', 'vm-gallery-title', 'GCSP native forms'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  const control = el('input', ''); control.type = 'date';
  const field = labelledField({ id: 'gallery-requested-date', label: 'Requested collection date', control,
    hint: 'A requested date, not a confirmed appointment.' });
  const summary = errorSummary({ id: 'gallery-form-errors', errors: [] });
  const validate = button({ label: 'Show validation example', onClick: () => {
    field.setError('Choose a permitted date.');
    summary.update([{ id: control.id, message: 'Choose a permitted date.' }]); summary.focus();
  } });
  const reset = button({ label: 'Clear validation example', variant: 'ghost', onClick: () => { field.setError(''); summary.update([]); } });
  const declaration = checkboxField({ id: 'gallery-declaration', label: 'The nominated driver and licence details are correct.' });
  body.append(summary.root, field.root, declaration.root, validate, reset); scope.append(body); section.append(scope); return section;
}

export function stageListExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-stage-list';
  section.append(el('h2', 'vm-gallery-title', 'GCSP stage list'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  const sets = [['Acknowledged', [['selection received', 'complete'], ['HR approval', 'waiting'], ['sales-manager approval', 'not-started']]],
    ['Sending', [['selection received', 'pending'], ['sales-manager approval', 'not-started']]],
    ['Not accepted', [['selection received', 'failed'], ['sales-manager approval', 'not-started']]]];
  for (const [heading, stages] of sets) body.append(stageList({ heading, level: 3, stages: stages.map(([name, state]) => ({ name, state })) }));
  scope.append(body); section.append(scope); return section;
}

export function rangeBarExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-range-bar';
  section.append(el('h2', 'vm-gallery-title', 'Range bar'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm'); const share = (value) => `${Math.round(value * 100)}%`;
  body.append(
    rangeBar({ label: 'Coverage before renewal', format: share, scale: { min: 0, max: 1 }, rows: [
      { label: "Today's release route", mean: 0.62, min: 0.58, max: 0.66 },
      { label: 'Buddy route', mean: 0.74, min: 0.70, max: 0.79 }] }),
    rangeBar({ label: 'Retries before release', rows: [
      { label: "Today's release route", mean: 12, min: 9, max: 15 },
      { label: 'Buddy route', mean: 10, min: 8, max: 14 }] }),
    rangeBar({ label: 'Fit of accepted cars', format: share, scale: { min: 0, max: 1 }, rows: [
      { label: "Today's release route", mean: 0.81, min: 0.77, max: 0.86 },
      { label: 'Buddy route', mean: null, min: null, max: null }] }));
  scope.append(body); section.append(scope); return section;
}

export function runRestartedExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-run-restarted';
  section.append(el('h2', 'vm-gallery-title', 'GCSP demo restarted'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  body.append(runRestartedScreen({ reload: () => {} }), runRestartedNotice({ reload: () => {} }).root, accessLapsedScreen());
  scope.append(body); section.append(scope); return section;
}

export function showMoreExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-show-more';
  section.append(el('h2', 'vm-gallery-title', 'GCSP show more and narrow values'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm'); const list = el('ul', ''); const total = 14; const page = 5; let limit = page;
  const paging = showMore({ onShowMore() { const first = limit; limit += page; draw(); list.children[first]?.focus(); } });
  function draw() {
    list.replaceChildren(...Array.from({ length: Math.min(limit, total) }, (_, i) => { const row = el('li', '', `Example car ${i + 1}`); row.tabIndex = -1; return row; }));
    paging.update({ shown: Math.min(limit, total), total });
  }
  draw();
  body.append(list, paging.root, factList([{ label: 'Contact email', value: 'employee-paula@example.invalid' }, { label: 'Licence number', value: 'FICTIONAL-NOMINEE' },
    { label: 'Collection point', value: 'Fictional collection centre' }, { label: 'Requested collection date', value: '13 November 2026' }]));
  scope.append(body); section.append(scope); return section;
}
