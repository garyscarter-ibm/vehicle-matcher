import { el, button } from '../../vehicle-matcher/ui.js';
import { labelledField, errorSummary } from './form-controls.js';

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
  body.append(summary.root, field.root, validate, reset); scope.append(body); section.append(scope); return section;
}
