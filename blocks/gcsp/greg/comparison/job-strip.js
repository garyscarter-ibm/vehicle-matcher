// The run strip above the picker: live progress from the server's counts, then the outcome. Display only.
import { el } from '../../../vehicle-matcher/ui.js';
import { jobLine } from './experiment-copy.js';

let sequence = 0;

/** { root, running(jobView), finished(jobView, outcome?), notice({ title?, lines }), clearNotice(), reset(), focus() }. */
export function createJobStrip() {
  const root = el('section', 'gcsp-comparison-job'); root.hidden = true; root.tabIndex = -1;
  const live = el('div', 'gcsp-comparison-job-live'); live.setAttribute('role', 'status');
  const line = el('p', 'gcsp-comparison-job-line'); const outcome = el('p', 'gcsp-note'); outcome.hidden = true;
  const bar = el('progress', 'gcsp-comparison-progress'); bar.id = `gcsp-comparison-progress-${++sequence}`;
  const label = el('label', 'gcsp-note'); label.htmlFor = bar.id;
  const alertBox = el('div', 'gcsp-comparison-notice'); alertBox.setAttribute('role', 'alert'); alertBox.hidden = true;
  live.append(line, label, bar, outcome); root.append(live, alertBox);
  const show = () => { root.hidden = false; };
  return {
    root,
    running(view) {
      show(); line.textContent = jobLine(view); outcome.hidden = true; label.hidden = false; bar.hidden = false;
      label.textContent = view.progressText; bar.max = Math.max(view.progress.stepsTotal, 1);
      if (view.progress.stepsTotal === 0) bar.removeAttribute('value'); else bar.value = view.progress.stepsDone;
    },
    finished(view, text = '') {
      show(); line.textContent = jobLine(view); label.hidden = true; bar.hidden = true; outcome.textContent = text; outcome.hidden = !text;
    },
    notice({ title = '', lines = [] }) {
      show(); alertBox.replaceChildren();
      if (title) alertBox.append(el('h3', 'gcsp-comparison-h3', title));
      for (const text of lines.filter(Boolean)) alertBox.append(el('p', '', text));
      alertBox.hidden = false;
    },
    clearNotice() { alertBox.hidden = true; alertBox.replaceChildren(); },
    reset() { root.hidden = true; alertBox.hidden = true; alertBox.replaceChildren(); line.textContent = ''; label.textContent = ''; outcome.hidden = true; },
    focus() { root.focus(); },
  };
}
