import { el, button } from '../../vehicle-matcher/ui.js';
import { svgIcon } from '../shell/portal-shell.js';
let sequence = 0;

/** Caller owns command effects and calls root.destroy() before unmounting. */
export function actionMenu({ label = 'Actions', items = [] } = {}) {
  const root = el('div', 'gcsp-action-menu');
  const trigger = button({ label: '', variant: 'ghost' });
  trigger.classList.add('gcsp-action-trigger'); trigger.setAttribute('aria-label', label);
  trigger.append(svgIcon(['M5 12h.01', 'M12 12h.01', 'M19 12h.01']));
  const popup = el('div', 'gcsp-action-popup'); popup.id = `gcsp-action-menu-${++sequence}`;
  popup.hidden = true; popup.setAttribute('role', 'menu'); popup.setAttribute('aria-label', label);
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-controls', popup.id); trigger.setAttribute('aria-expanded', 'false');
  const controls = items.map((item, index) => {
    const control = button({ label: item.label, variant: 'ghost' });
    control.setAttribute('role', 'menuitem'); control.tabIndex = -1;
    if (item.disabled) control.setAttribute('aria-disabled', 'true');
    popup.append(control);
    if (item.reason) {
      const reason = el('p', 'gcsp-action-reason', item.reason); reason.id = `${popup.id}-reason-${index}`;
      control.setAttribute('aria-describedby', reason.id); popup.append(reason);
    }
    control.addEventListener('click', () => { if (!item.disabled) { close(); item.onSelect?.(); } });
    return control;
  });
  let destroyed = false;
  function close(restore = true) {
    if (popup.hidden) return;
    popup.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', leave);
    if (restore && trigger.isConnected) trigger.focus();
  }
  function outside(event) { if (!root.contains(event.target)) close(); }
  function leave(event) { if (!root.contains(event.target)) close(false); }
  function open(last = false) {
    if (destroyed || !controls.length) return;
    popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    delete popup.dataset.align;
    if (popup.getBoundingClientRect().left < 0) popup.dataset.align = 'start';
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', leave);
    controls[last ? controls.length - 1 : 0].focus();
  }
  trigger.addEventListener('click', () => { if (popup.hidden) open(); else close(); });
  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowUp'); }
  });
  popup.addEventListener('keydown', (event) => {
    const at = controls.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') { close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (at + (event.key === 'ArrowUp' ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    }
  });
  root.append(trigger, popup); root.destroy = () => { close(false); destroyed = true; };
  return { root, trigger, destroy: root.destroy };
}
