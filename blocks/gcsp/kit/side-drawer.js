// sideDrawer: a modal panel on the right for one record. Escape, the Close button and the scrim close it; focus returns to the opener.
import { el, button } from '../../vehicle-matcher/ui.js';

let uid = 0;
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// { host, context?, title, body, footer, opener, closeLabel, onClose } -> { root, panel, close(restoreFocus = true) }.
// `host` is inside .gcsp; `opener` is an element or a function returning one, and is focused on close.
export function sideDrawer({ host, context, title, body = [], footer = [], opener, closeLabel = 'Close', onClose } = {}) {
  const doc = host.ownerDocument;
  const root = el('div', 'gcsp-side-drawer');
  const scrim = el('div', 'gcsp-side-drawer-backdrop');
  const panel = el('aside', 'gcsp-side-drawer-panel');
  const heading = el('h2', 'gcsp-side-drawer-title', title);
  heading.id = `gcsp-side-drawer-${++uid}`;
  heading.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', heading.id);
  const titles = el('div', 'gcsp-side-drawer-titles');
  if (context) titles.append(el('p', 'gcsp-side-drawer-context', context));
  titles.append(heading);
  const head = el('div', 'gcsp-side-drawer-head');
  let closed = false;
  const api = { root, panel, close(restoreFocus = true) {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onKey);
    root.remove();
    if (restoreFocus) { const target = typeof opener === 'function' ? opener() : opener; if (target?.isConnected) target.focus(); }
    onClose?.();
  } };
  head.append(titles, button({ label: closeLabel, variant: 'ghost', onClick: () => api.close() }));
  const content = el('div', 'gcsp-side-drawer-body');
  content.append(...body);
  panel.append(head, content);
  if (footer.length) { const foot = el('div', 'gcsp-side-drawer-foot'); foot.append(...footer); panel.append(foot); }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); api.close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)];
    if (!items.length) { event.preventDefault(); heading.focus(); return; }
    const active = doc.activeElement; const inside = panel.contains(active);
    if (event.shiftKey && (!inside || active === items[0] || active === heading)) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && (!inside || active === items.at(-1))) { event.preventDefault(); items[0].focus(); }
  }
  scrim.addEventListener('click', () => api.close());
  doc.addEventListener('keydown', onKey);
  root.append(scrim, panel);
  host.append(root);
  heading.focus();
  return api;
}
