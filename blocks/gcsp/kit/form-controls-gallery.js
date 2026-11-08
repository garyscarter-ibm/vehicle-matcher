import { el, button } from '../../vehicle-matcher/ui.js';
import { labelledField, errorSummary, checkboxField } from './form-controls.js';
import { stageList } from './stage-list.js';
import { runRestartedScreen, runRestartedNotice } from './run-restarted.js';

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

export function runRestartedExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-run-restarted';
  section.append(el('h2', 'vm-gallery-title', 'GCSP demo restarted'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  body.append(runRestartedScreen({ reload: () => {} }), runRestartedNotice({ reload: () => {} }).root);
  scope.append(body); section.append(scope); return section;
}
