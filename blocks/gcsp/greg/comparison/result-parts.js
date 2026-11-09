// Shared pieces of a stored comparison: the process-only body (as FUCQ-138) and the what-if body. Display only; the stored result owns every figure.
import { el, factList } from '../../../vehicle-matcher/ui.js';
import { dataTable } from '../../kit/data-table.js';
import { rangeBar } from '../../kit/range-bar.js';
import * as copy from './comparison-copy.js';

export const heading = (text, level = 3) => el(`h${level}`, 'gcsp-comparison-h3', text);

export function measureBlock(m, level = 3) {
  const block = el('article', 'gcsp-comparison-measure');
  const verdict = el('p', 'gcsp-comparison-verdict');
  verdict.append(el('span', 'gcsp-comparison-verdict-text', m.verdictText), el('span', 'gcsp-note', m.hint));
  block.dataset.verdict = m.verdict;
  block.append(heading(m.label, level), rangeBar({ label: copy.BAR_LABEL, rows: m.rows, scale: m.scale, format: m.format, level: level + 1 }),
    el('p', 'gcsp-comparison-difference', m.differenceText), verdict);
  return block;
}

// A what-if measure: today's value first in the bar, then one difference and plain verdict per tried value.
export function armsBlock(m, level) {
  const block = el('article', 'gcsp-comparison-measure'); const list = el('ul', 'gcsp-comparison-arms');
  for (const arm of m.arms) {
    const row = el('li', 'gcsp-comparison-arm'); row.dataset.verdict = arm.verdict;
    row.append(el('span', 'gcsp-comparison-difference', arm.differenceText), ' ', el('span', 'gcsp-comparison-verdict-text', arm.verdictText)); list.append(row);
  }
  block.append(heading(m.label, level), rangeBar({ label: copy.BAR_LABEL, rows: m.rows, scale: m.scale, format: m.format, level: level + 1 }), el('p', 'gcsp-note', m.hint), list);
  return block;
}

export function details(view, open, onToggle) {
  const node = el('details', 'gcsp-comparison-details'); node.open = open;
  node.addEventListener('toggle', () => onToggle(node.open));
  const p = view.provenance;
  node.append(el('summary', 'gcsp-comparison-summary', copy.DETAILS), dataTable({ caption: 'Assumptions used', emptyText: 'No assumptions were stored',
    columns: [{ key: 'key', label: 'Key' }, { key: 'value', label: 'Value' }, { key: 'unit', label: 'Unit' }, { key: 'status', label: 'Status' }, { key: 'basis', label: 'Basis' }],
    rows: view.assumptions }),
  factList([{ label: 'Seeds', value: p.seeds }, { label: 'Policy version', value: p.policyVersion }, { label: 'Policy hash', value: p.policyHash },
    { label: 'Generator version', value: p.generatorVersion }, { label: 'Code revision', value: p.codeRevision }, { label: 'Result id', value: p.resultId },
    { label: 'Made', value: p.made }, { label: 'Stored', value: p.stored }], { className: 'gcsp-comparison-facts' }));
  return node;
}

const notice = (text) => {
  const node = el('div', 'gcsp-comparison-notice'); node.setAttribute('role', 'status');
  node.append(heading(copy.OLD_POLICY_TITLE), el('p', '', text)); return node;
};
const metaFacts = (m) => factList([{ label: 'Seeds', value: m.seeds }, { label: 'Policy version', value: m.policyVersion }, { label: 'Made', value: m.made },
  { label: 'Employees', value: m.employees }, { label: 'Code revision', value: m.codeRevision }].filter((f) => f.value != null), { className: 'gcsp-comparison-facts' });
function leavesOut(view) {
  const leaves = el('section', 'gcsp-comparison-omits'); leaves.append(heading(copy.LEAVES_OUT));
  const list = el('ul', 'gcsp-comparison-list'); list.append(...view.limitations.map((t) => el('li', '', t))); leaves.append(list);
  return leaves;
}

/** The process-only body below the screen intro: older-policy notice, facts, caveat, measures, what it leaves out, details. */
export function processParts(view, detailsOpen, onToggle) {
  const parts = view.oldPolicy ? [notice(view.oldPolicy)] : [];
  const grid = el('div', 'gcsp-comparison-measures'); grid.append(...view.measures.map((m) => measureBlock(m)));
  parts.push(metaFacts(view.meta), el('p', 'gcsp-note gcsp-comparison-caveat', view.caveat), grid, leavesOut(view), details(view, detailsOpen, onToggle));
  return parts;
}

const sentence = (parts) => parts.filter(Boolean).join(' ');
function changeFacts(change) {
  const was = change.baseline;
  return factList([{ label: 'What changes', value: change.key }, { label: 'Unit', value: change.unit },
    { label: "Today's value", value: sentence([was.text, was.status ? `(${copy.statusLabel(was.status)})` : '']) }, { label: "Basis for today's value", value: was.basis },
    { label: 'Tried', value: change.texts.join(', ') }, { label: 'Why try these', value: change.basis }].filter((f) => f.value), { className: 'gcsp-comparison-facts' });
}

/** The what-if body: the change, caveat, one section per route (buddy first), what it leaves out, details. */
export function experimentParts(view, detailsOpen, onToggle) {
  const parts = view.oldPolicy ? [notice(view.oldPolicy)] : [];
  parts.push(changeFacts(view.change), el('p', 'gcsp-note', copy.WHAT_IF), metaFacts(view.meta), el('p', 'gcsp-note gcsp-comparison-caveat', view.caveat));
  for (const route of view.routes) {
    const section = el('section', 'gcsp-comparison-route'); const grid = el('div', 'gcsp-comparison-measures');
    grid.append(...route.measures.map((m) => armsBlock(m, 4))); section.append(heading(route.label), grid); parts.push(section);
  }
  parts.push(leavesOut(view), details(view, detailsOpen, onToggle));
  return parts;
}
