// Shell focus helper: a quiet ring on script-focused headings, and first-arrival focus on the page h1.
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);
export const QUIET_FOCUS = 'data-gcsp-quiet-focus';
const isHeading = (node) => /^H[1-3]$/.test(node?.tagName || '') && node.getAttribute('tabindex') === '-1';

/** Focus a heading for an in-page outcome. The shell's quiet marker decides whether a ring shows. */
export function focusHeading(heading, options) {
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus(options);
}

/**
 * Track input modality for a shell. Script focus on a tabindex -1 heading is marked quiet unless the
 * last input was the keyboard. With arrive, also focuses the main h1 until the first user input.
 * Returns destroy().
 */
export function installArrivalFocus({ root, main, arrive = false } = {}) {
  const doc = root.ownerDocument;
  let modality = 'none';
  let arriving = Boolean(arrive);
  let arrived = null;
  const clear = (node) => node?.removeAttribute?.(QUIET_FOCUS);
  let observer = null;
  const stopArrival = () => { arriving = false; observer?.disconnect(); };
  const onKey = (event) => {
    if (MODIFIERS.has(event.key)) return;
    modality = 'keyboard';
    clear(doc.activeElement);
    stopArrival();
  };
  const onPointer = () => { modality = 'pointer'; stopArrival(); };
  const onFocusIn = (event) => { if (isHeading(event.target) && modality !== 'keyboard') event.target.setAttribute(QUIET_FOCUS, ''); };
  const onFocusOut = (event) => clear(event.target);
  const tryArrive = () => {
    if (!arriving || !main.isConnected) return;
    const active = doc.activeElement;
    if (active === arrived && arrived.isConnected) return;
    if (active && active !== doc.body && active !== doc.documentElement && active !== main) { stopArrival(); return; }
    const heading = main.querySelector('h1');
    if (!heading) return;
    focusHeading(heading, { preventScroll: true });
    if (doc.activeElement === heading) arrived = heading;
  };

  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('mousedown', onPointer, true);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  if (arriving) {
    const Observer = doc.defaultView?.MutationObserver;
    if (Observer) { observer = new Observer(tryArrive); observer.observe(main, { childList: true, subtree: true }); }
    tryArrive();
  }
  return function destroy() {
    stopArrival();
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('mousedown', onPointer, true);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
  };
}
