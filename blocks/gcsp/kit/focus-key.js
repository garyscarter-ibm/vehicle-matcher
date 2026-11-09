// Quiet repaints: remember the focused control by role, label and section, then refocus its equal.
export const focusKeyOf = (control, scope = '') => ({ tag: control.tagName, label: control.textContent.trim(), scope: (scope && control.closest(scope)?.className) || '' });
export const findByFocusKey = (root, key, selector, scope = '') => [...root.querySelectorAll(selector)].find((node) => !node.disabled
  && node.tagName === key.tag && node.textContent.trim() === key.label && ((scope && node.closest(scope)?.className) || '') === key.scope);

// Swaps content and puts the window scroll back if it moved; focus afterwards may still scroll a target into view.
export function keepScroll(win, repaint) {
  const top = win?.scrollY ?? 0; const left = win?.scrollX ?? 0;
  repaint();
  if (win && (win.scrollY !== top || win.scrollX !== left)) win.scrollTo(left, top);
}
