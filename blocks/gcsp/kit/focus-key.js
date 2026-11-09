// Quiet repaints: remember the focused control by role, label and section, then refocus its equal.
// A control may carry data-focus-key when its text alone is not unique (a time button on each day).
const labelOf = (control) => control.dataset?.focusKey || control.textContent.trim();
export const focusKeyOf = (control, scope = '') => ({ tag: control.tagName, label: labelOf(control), scope: (scope && control.closest(scope)?.className) || '' });
export const findByFocusKey = (root, key, selector, scope = '') => [...root.querySelectorAll(selector)].find((node) => !node.disabled
  && node.tagName === key.tag && labelOf(node) === key.label && ((scope && node.closest(scope)?.className) || '') === key.scope);

// Swaps content and puts the window scroll back if it moved; focus afterwards may still scroll a target into view.
export function keepScroll(win, repaint) {
  const top = win?.scrollY ?? 0; const left = win?.scrollX ?? 0;
  repaint();
  if (win && (win.scrollY !== top || win.scrollX !== left)) win.scrollTo(left, top);
}
