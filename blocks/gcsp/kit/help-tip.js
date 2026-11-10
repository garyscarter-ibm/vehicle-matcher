import { el } from '../../vehicle-matcher/ui.js';

const PLACEMENTS = ['below-start', 'above-end'];

/** Hoverable, focusable help for native controls. `host` must be a positioning context; `text` is set as textContent only.
 * Returns { root, show(), hide(), dismiss(), setText(text), destroy() }; dismiss() holds it shut until pointer and focus both leave `host`. */
export function helpTip({ host, triggers = [], text = '', id, placement = 'below-start', dismissOnActivate = true } = {}) {
  const root = el('p', `gcsp-help-tip gcsp-help-tip-${PLACEMENTS.includes(placement) ? placement : 'below-start'}`, text);
  root.id = id; root.setAttribute('role', 'tooltip'); root.hidden = true; host.append(root);
  const doc = host.ownerDocument; const undo = [];
  const on = (node, type, run) => { node.addEventListener(type, run); undo.push(() => node.removeEventListener(type, run)); };
  const added = triggers.map((trigger) => {
    const ids = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean); const had = ids.includes(id);
    if (!had) trigger.setAttribute('aria-describedby', [...ids, id].join(' '));
    return had;
  });
  let dismissed = false; let pointerIn = false; let focusIn = false; let keyFocus = false; let pointerFocus = false; let listening = false;

  const outside = (event) => { if (!host.contains(event.target)) dismiss(); };
  function show() {
    if (!root.hidden) return;
    root.hidden = false;
    if (!listening) { doc.addEventListener('pointerdown', outside); listening = true; }
  }
  function hide() {
    root.hidden = true;
    if (listening) { doc.removeEventListener('pointerdown', outside); listening = false; }
  }
  function dismiss() { dismissed = true; hide(); }
  const maybeShow = () => { if (!dismissed) show(); };
  const release = () => { if (dismissed && !pointerIn && !focusIn) dismissed = false; };

  for (const trigger of triggers) {
    on(trigger, 'pointerenter', (event) => { if (event.pointerType !== 'touch') maybeShow(); });
    on(trigger, 'pointerdown', () => { pointerFocus = true; });
    on(trigger, 'keydown', () => { pointerFocus = false; });
    on(trigger, 'focus', () => {
      if (pointerFocus) { pointerFocus = false; return; }
      keyFocus = true; maybeShow();
    });
    on(trigger, 'blur', () => { keyFocus = false; pointerFocus = false; });
    on(trigger, 'click', () => {
      pointerFocus = false;
      if (dismissOnActivate) dismiss(); else { dismissed = false; show(); }
    });
  }
  on(host, 'pointerenter', (event) => { if (event.pointerType !== 'touch') pointerIn = true; });
  on(host, 'pointerleave', () => { pointerIn = false; if (!keyFocus) hide(); release(); });
  on(host, 'focusin', () => { focusIn = true; });
  on(host, 'focusout', (event) => {
    if (host.contains(event.relatedTarget)) return;
    focusIn = false; keyFocus = false; hide(); release();
  });
  on(host, 'keydown', (event) => { if (event.key === 'Escape' && !root.hidden) dismiss(); });

  return {
    root, show, hide, dismiss,
    setText(next) { root.textContent = next; },
    destroy() {
      undo.forEach((off) => off()); hide(); root.remove();
      triggers.forEach((trigger, at) => {
        if (added[at]) return;
        const rest = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((one) => one && one !== id);
        if (rest.length) trigger.setAttribute('aria-describedby', rest.join(' ')); else trigger.removeAttribute('aria-describedby');
      });
    },
  };
}
