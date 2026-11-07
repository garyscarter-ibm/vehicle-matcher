import { el } from '../../vehicle-matcher/ui.js';

export function labelledField({ id, label, control, hint = '', error = '' }) {
  if (!id || !control) throw new TypeError('A unique field id and native control are required.');
  const root = el('div', 'gcsp-field');
  const name = el('label', 'gcsp-field-label', label); name.htmlFor = id; control.id = id;
  const note = el('p', 'gcsp-field-hint', hint); note.id = `${id}-hint`; note.hidden = !hint;
  const failure = el('p', 'gcsp-field-error'); failure.id = `${id}-error`;
  root.append(name, control, note, failure);
  const described = control.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
  function setError(value = '') {
    failure.textContent = value; failure.hidden = !value;
    control.setAttribute('aria-invalid', String(!!value));
    const ids = [...new Set([...described, ...(hint ? [note.id] : []), ...(value ? [failure.id] : [])])];
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' ')); else control.removeAttribute('aria-describedby');
  }
  setError(error);
  return { root, setError };
}

export function errorSummary({ id, title = 'Check your choices', errors = [], onSelect } = {}) {
  if (!id) throw new TypeError('A unique summary id is required.');
  const root = el('section', 'gcsp-error-summary'); const heading = el('h2', 'gcsp-h2', title);
  heading.id = `${id}-title`; heading.tabIndex = -1;
  root.setAttribute('aria-labelledby', heading.id); const items = el('ul', 'gcsp-error-links');
  root.append(heading, items);
  function update(values = []) {
    items.replaceChildren();
    for (const value of values) {
      const row = el('li', ''); const link = el('a', '', value.message ?? value.reason ?? 'Review this choice');
      link.href = `#${value.id}`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        if (onSelect) onSelect(value.id, value.selectionId); else root.ownerDocument.getElementById(value.id)?.focus();
      });
      row.append(link); items.append(row);
    }
    root.hidden = values.length === 0;
  }
  update(errors);
  return { root, update, focus: () => { if (!root.hidden) heading.focus(); } };
}
