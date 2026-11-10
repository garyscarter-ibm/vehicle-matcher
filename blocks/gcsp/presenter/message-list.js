// Kit component messageList: rows of messages plus a detail pane. Built with el(), never HTML strings.
// The HTML body sits in a sandboxed iframe (no scripts, no same-origin) and is set via srcdoc only.
import { el, button, factList } from '../../vehicle-matcher/ui.js';
import { svgIcon } from '../shell/portal-shell.js';
import { statusOf, explain, formatDemoTime, recipientName, isSafeOfferLink, errorSentence, plural } from './outbox-copy.js';

const NO_SUBJECT = 'Email not created yet';

function statusChip(message) {
  const status = statusOf(message.state, message.transport);
  const chip = el('span', `gcsp-mail-status is-${status.tone}`);
  chip.append(svgIcon(status.icon), el('span', undefined, status.label));
  return chip;
}

function rowButton(message, selected) {
  const li = el('li', 'gcsp-mail-item');
  const btn = el('button', 'gcsp-mail-row');
  btn.type = 'button';
  btn.dataset.id = message.jobId;
  if (selected) btn.setAttribute('aria-current', 'true');
  const meta = el('span', 'gcsp-mail-meta');
  meta.append(el('span', 'gcsp-mail-time', formatDemoTime(message.time) || 'No time yet'), statusChip(message));
  btn.append(el('span', 'gcsp-mail-to', recipientName(message)), el('span', 'gcsp-mail-subject', message.subject || NO_SUBJECT), meta);
  if (message.state === 'retrying' || message.state === 'failed') {
    btn.append(el('span', 'gcsp-mail-hint', `${plural(message.attempts ?? 0, 'attempt')}. ${errorSentence(message.error) || ''}`.trim()));
  }
  li.append(btn);
  return li;
}

function offerLink(message) {
  const wrap = el('div', 'gcsp-mail-offer');
  if (!isSafeOfferLink(message.offerLink)) {
    wrap.append(el('p', 'gcsp-note', 'Offer link not available'));
    return wrap;
  }
  const link = button({ label: 'Open the offer', variant: 'ghost', href: message.offerLink });
  link.target = '_blank';
  link.rel = 'noopener';
  link.append(el('span', 'gcsp-vh', ' (opens in a new tab)'));
  wrap.append(link);
  return wrap;
}

function bodyFrame(message) {
  const frame = el('iframe', 'gcsp-mail-frame');
  frame.setAttribute('sandbox', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = `Email as received: ${message.subject}`;
  frame.srcdoc = message.htmlBody;
  return frame;
}

function fold(label, ...nodes) {
  const node = el('details', 'gcsp-mail-fold'); node.append(el('summary', undefined, label), ...nodes);
  return node;
}

export function messageDetail(message) {
  const heading = el('h2', 'gcsp-mail-heading', message.subject || NO_SUBJECT);
  heading.tabIndex = -1;
  // To, sent and subject sit on one line; attempts and problems wait in a disclosure.
  const status = statusOf(message.state, message.transport).label;
  const line = el('p', 'gcsp-mail-line', `To ${recipientName(message)}. ${status}, ${formatDemoTime(message.time) || 'no attempt yet'}.`);
  const attempts = [{ label: 'Attempts', value: String(message.attempts ?? 0) }];
  if (message.state === 'retrying') attempts.push({ label: 'Next attempt', value: formatDemoTime(message.nextAttemptAt) || 'Not scheduled' });
  if (message.state === 'retrying' || message.state === 'failed') attempts.push({ label: 'Problem', value: errorSentence(message.error) });
  const rendered = typeof message.htmlBody === 'string' && typeof message.subject === 'string';
  const nodes = [heading, line];
  if (rendered) {
    nodes.push(offerLink(message), bodyFrame(message));
    if (typeof message.textBody === 'string') nodes.push(fold('Plain-text version', el('pre', 'gcsp-mail-text', message.textBody)));
    nodes.push(fold('Delivery attempts', factList(attempts, { className: 'gcsp-mail-facts' })));
  } else {
    nodes.push(factList(attempts, { className: 'gcsp-mail-facts' }), el('p', `gcsp-mail-explain is-${statusOf(message.state).tone}`, explain(message)));
  }
  return { heading, nodes };
}

/**
 * messageList({ messages, selectedId, onSelect, label }) -> { root, select(id, { focus }), update(messages), getSelected(), destroy() }.
 * Rows keep the order given (newest first is the server's job). Selecting moves focus to the detail heading.
 */
export function messageList({ messages = [], selectedId = null, onSelect, label = 'Captured emails' } = {}) {
  let items = [...messages];
  let selected = selectedId;
  const root = el('div', 'gcsp-mail');
  const list = el('ul', 'gcsp-mail-list');
  list.setAttribute('aria-label', label);
  const detail = el('section', 'gcsp-mail-detail');
  detail.setAttribute('aria-label', 'Selected email');
  root.append(list, detail);

  function drawDetail(focus) {
    const message = items.find((m) => m.jobId === selected);
    detail.hidden = !message;
    if (!message) { detail.replaceChildren(); return; }
    const view = messageDetail(message);
    detail.replaceChildren(...view.nodes);
    if (focus) view.heading.focus();
  }
  function drawRows() {
    list.replaceChildren(...items.map((m) => rowButton(m, m.jobId === selected)));
  }
  function select(id, { focus = false } = {}) {
    if (!items.some((m) => m.jobId === id)) return;
    selected = id;
    for (const btn of list.querySelectorAll('.gcsp-mail-row')) {
      if (btn.dataset.id === id) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
    drawDetail(focus);
  }
  const onClick = (event) => {
    const btn = event.target.closest?.('.gcsp-mail-row');
    if (!btn || !list.contains(btn)) return;
    select(btn.dataset.id, { focus: true });
    onSelect?.(items.find((m) => m.jobId === btn.dataset.id));
  };
  list.addEventListener('click', onClick);

  // The newest email (first row) opens by default.
  if (!items.some((m) => m.jobId === selected)) selected = items[0]?.jobId ?? null;
  drawRows();
  drawDetail(false);

  return {
    root,
    select,
    update(next = []) {
      items = [...next];
      if (!items.some((m) => m.jobId === selected)) selected = items[0]?.jobId ?? null;
      drawRows();
      drawDetail(false);
    },
    getSelected: () => selected,
    destroy() {
      list.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
