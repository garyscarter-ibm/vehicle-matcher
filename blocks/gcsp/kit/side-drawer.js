// sideDrawer: a modal panel on the right for one record. Escape, the Close button and the scrim close it; focus returns to the opener.
import { el, button } from '../../vehicle-matcher/ui.js';

let uid = 0;
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, iframe, [tabindex]:not([tabindex="-1"])';

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
  let closed = false; let dismissible = true;
  const background = [];
  const previousOverflow = doc.body.style.overflow;
  const visible = (node) => {
    if (node.closest('[hidden], [inert]')) return false;
    for (let parent = node.parentElement; parent && parent !== panel; parent = parent.parentElement) {
      if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(node)) return false;
    }
    return true;
  };
  const api = { root, panel, close(restoreFocus = true) {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusin', onFocus);
    root.remove();
    for (const [node, inert] of background) if (!inert) node.removeAttribute('inert');
    doc.body.style.overflow = previousOverflow;
    if (restoreFocus) { const target = typeof opener === 'function' ? opener() : opener; if (target?.isConnected) target.focus(); }
    onClose?.();
  }, setDismissible(value) { dismissible = Boolean(value); closeButton.disabled = !dismissible; } };
  const closeButton = button({ label: closeLabel, variant: 'ghost', onClick: () => { if (dismissible) api.close(); } });
  head.append(titles, closeButton);
  const content = el('div', 'gcsp-side-drawer-body');
  content.append(...body);
  panel.append(head, content);
  if (footer.length) { const foot = el('div', 'gcsp-side-drawer-foot'); foot.append(...footer); panel.append(foot); }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); if (dismissible) api.close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!items.length) { event.preventDefault(); heading.focus(); return; }
    const active = doc.activeElement; const inside = panel.contains(active);
    if (event.shiftKey && (!inside || active === items[0] || active === heading)) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && (!inside || active === items.at(-1))) { event.preventDefault(); items[0].focus(); }
  }
  function onFocus(event) { if (!closed && !panel.contains(event.target)) heading.focus(); }
  scrim.addEventListener('click', () => { if (dismissible) api.close(); });
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', onFocus);
  root.append(scrim, panel);
  host.append(root);
  for (let node = root; node.parentElement && node.parentElement !== doc.documentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) if (sibling !== node) {
      background.push([sibling, sibling.hasAttribute('inert')]); sibling.setAttribute('inert', '');
    }
  }
  doc.body.style.overflow = 'hidden';
  heading.focus();
  return api;
}
