// GCSP portal shell: header with account context, icon navigation, breadcrumbs, main.
// Built with el() and createElementNS, never innerHTML.
import { el, button } from '../../vehicle-matcher/ui.js';
import { createSessionHttpAdapter } from '../login/http-adapter.js';
import { isRunRestarted } from '../kit/run-restarted.js';
import { installArrivalFocus } from '../kit/arrival-focus.js';
import { notificationBell } from '../kit/notification-bell.js';
import { announceSessionChange, installSessionLifecycle } from './session-lifecycle.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_REASON = 'Not available yet';
const LOGO = (name) => new URL(`../../../assets/brand-logos/${name}.svg`, import.meta.url).href;
const CHEVRON = ['M9 6l6 6-6 6'];
const MENU = ['M4 7h16', 'M4 12h16', 'M4 17h16'];
let uid = 0;

/** A 24px stroke icon from path data strings. Decorative: the label is the name. */
export function svgIcon(paths = [], className = 'gcsp-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/**
 * Narrow icon navigation. Items: { key, label, icon, available, unavailableReason }.
 * Returns { root, setActive(key), setExpanded(bool), destroy() }.
 */
export function accountNavigation({ items = [], active = null, expanded = false, onNavigate, onToggle } = {}) {
  const id = `gcsp-nav-${++uid}`;
  const root = el('nav', 'gcsp-nav');
  root.id = id;
  root.setAttribute('aria-label', 'Portal');
  const list = el('ul', 'gcsp-nav-list');
  const buttons = new Map();

  for (const item of items) {
    const li = el('li', 'gcsp-nav-item');
    const btn = el('button', 'gcsp-nav-btn');
    btn.type = 'button';
    btn.dataset.key = item.key;
    btn.append(svgIcon(item.icon), el('span', 'gcsp-nav-label', item.label));
    const tip = el('span', 'gcsp-nav-tip');
    tip.setAttribute('aria-hidden', 'true');
    if (item.available === false) {
      tip.append(el('span', 'gcsp-nav-tip-label', `${item.label}: `));
      const reason = el('span', 'gcsp-nav-tip-reason', item.unavailableReason || DEFAULT_REASON);
      reason.id = `${id}-${item.key}-reason`;
      tip.append(reason);
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-describedby', reason.id);
    } else {
      tip.classList.add('gcsp-nav-tip-available');
      tip.append(el('span', 'gcsp-nav-tip-label', item.label));
    }
    li.append(btn, tip);
    list.append(li);
    buttons.set(item.key, btn);
  }

  const toggle = el('button', 'gcsp-nav-toggle');
  toggle.type = 'button';
  const toggleLabel = el('span', 'gcsp-nav-label');
  toggle.append(svgIcon(CHEVRON), toggleLabel);
  root.append(list, toggle);

  function setActive(key) {
    for (const [k, btn] of buttons) {
      if (k === key && btn.getAttribute('aria-disabled') !== 'true') btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }
  function setExpanded(next) {
    const on = Boolean(next);
    root.dataset.expanded = String(on);
    toggle.setAttribute('aria-expanded', String(on));
    toggle.title = on ? 'Hide labels' : 'Show labels';
    toggleLabel.textContent = toggle.title;
  }

  const onClick = (event) => {
    const target = event.target.closest?.('button');
    if (!target || !root.contains(target)) return;
    if (target === toggle) {
      setExpanded(root.dataset.expanded !== 'true');
      onToggle?.(root.dataset.expanded === 'true');
    } else if (target.dataset.key && target.getAttribute('aria-disabled') !== 'true') {
      onNavigate?.(target.dataset.key);
    }
  };
  root.addEventListener('click', onClick);
  setExpanded(expanded);
  setActive(active);

  return {
    root,
    setActive,
    setExpanded,
    destroy() {
      root.removeEventListener('click', onClick);
      root.remove();
    },
  };
}

function initialsOf(name) {
  const words = String(name).replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Account menu shortcuts: rail keys the host routes through onNavigate, shown above Sign out.
function accountLinks(items) {
  if (!items.length) return null;
  const list = el('ul', 'gcsp-account-links');
  for (const item of items) {
    const link = el('button', 'gcsp-account-link', item.label);
    link.type = 'button'; link.dataset.key = item.key;
    const li = el('li'); li.append(link); list.append(li);
  }
  return list;
}

function accountContent(state, retryButton, signOutButton, menuItems = [], failureInPage = false) {
  const status = state?.status;
  if (status === 'signed-out') return { label: null, busy: false, signedOut: true, nodes: [] };
  if (status === 'ready' && state.name) {
    const details = el('details', 'gcsp-account-details');
    const summary = el('summary', 'gcsp-account-summary');
    summary.setAttribute('aria-label', `Account details for ${state.name}`);
    const name = el('span', 'gcsp-account-name', state.name);
    name.title = state.name;
    summary.append(el('span', 'gcsp-avatar', state.initials || initialsOf(state.name)), name, svgIcon(CHEVRON, 'gcsp-icon gcsp-account-chevron'));
    const panel = el('div', 'gcsp-account-panel');
    panel.append(el('span', 'gcsp-account-detail-name', state.name));
    if (state.email) panel.append(el('span', 'gcsp-account-email', state.email));
    if (state.context) panel.append(el('span', 'gcsp-account-context', state.context));
    const links = accountLinks(menuItems);
    if (links) panel.append(links);
    if (signOutButton) panel.append(signOutButton);
    details.append(summary, panel);
    return {
      label: `Account: ${state.name}`,
      busy: false,
      nodes: [details],
    };
  }
  // After a restart there is no account to show, and the page's own Reload is the one action that works.
  if (isRunRestarted(state)) return { label: null, busy: false, restarted: true, nodes: [] };
  // A page that draws its own failure region says it once, with its own Refresh, so the header stays quiet.
  if (status === 'unavailable' && failureInPage) return { label: null, busy: false, nodes: [] };
  if (status === 'unavailable' || status === 'ready') {
    const message = (status === 'unavailable' && state.message) || 'Your account could not be loaded.';
    const unavailable = el('span', 'gcsp-account-unavailable');
    const label = el('span', '', 'Account unavailable');
    label.setAttribute('aria-hidden', 'true');
    unavailable.title = message;
    unavailable.append(label, el('span', 'gcsp-vh', message));
    return {
      label: 'Account unavailable',
      busy: false,
      nodes: [unavailable, retryButton],
    };
  }
  const nodes = [el('span', 'gcsp-skel gcsp-skel-avatar'), el('span', 'gcsp-skel gcsp-skel-name')];
  const vh = el('span', 'gcsp-vh', 'Loading your account');
  return { label: 'Loading your account', busy: true, nodes: [...nodes, vh] };
}

/**
 * The shell. Returns { root, main, setAccount, setActive, setBreadcrumbs, setNotifications, bell, destroy }.
 * notifications (optional) adds the header bell: { connect(update) -> disconnect } or a static model; omitted, there is no bell.
 * navigation is an item list for accountNavigation; onNavigate(key) is called for available items only.
 * arrivalFocus focuses the main h1 on arrival, until the first user input.
 * accountFailure 'page' keeps the header quiet on a failed read, for a page body that shows the failure itself.
 */
export function portalShell({
  title = 'Group Car Schemes Portal', account = { status: 'loading' }, navigation = [], active = null,
  breadcrumbs = [], onNavigate, onRetryAccount, arrivalFocus = false, accountMenu = [],
  signOut = true, notifications, sessionAdapter = createSessionHttpAdapter(), navigate, reload, accountFailure = 'header',
} = {}) {
  const id = `gcsp-shell-${++uid}`;
  const mainId = `${id}-main`;
  const root = el('div', 'gcsp');

  const skip = el('a', 'gcsp-skip', 'Skip to content');
  skip.href = `#${mainId}`;

  const header = el('header', 'gcsp-header');
  const menuToggle = el('button', 'gcsp-menu-toggle');
  menuToggle.type = 'button';
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Menu');
  menuToggle.append(svgIcon(MENU));
  const marks = el('div', 'gcsp-marks');
  const logo = el('img', 'gcsp-mark');
  logo.src = LOGO('bmwgroup-bmw-mini');
  logo.alt = 'BMW GROUP, BMW and MINI';
  logo.width = 139;
  logo.height = 22;
  marks.append(logo);
  const accountBox = el('div', 'gcsp-account');
  accountBox.setAttribute('role', 'group');
  accountBox.setAttribute('aria-live', 'polite');
  const bell = notifications ? notificationBell({ id: `${id}-bell`, onOpen: closeAccountMenu }) : null;
  header.append(menuToggle, marks, el('div', 'gcsp-title', title), ...(bell ? [bell.root] : []), accountBox);
  const disconnectBell = typeof notifications?.connect === 'function' ? notifications.connect(bell.update) : (notifications && bell.update(notifications), null);

  const nav = accountNavigation({
    items: navigation,
    active,
    onNavigate: (key) => {
      closeMenu();
      onNavigate?.(key);
    },
  });
  menuToggle.setAttribute('aria-controls', nav.root.id);

  const content = el('div', 'gcsp-content');
  const crumbsHost = el('div', 'gcsp-crumbs-host');
  const main = el('main', 'gcsp-main');
  main.id = mainId;
  main.tabIndex = -1;
  content.append(crumbsHost, main);
  root.append(skip, header, el('div', 'gcsp-body'));
  root.lastChild.append(nav.root, content);

  function closeAccountMenu() {
    const details = accountBox.querySelector('details[open]'); if (details) details.open = false;
  }
  function closeMenu() {
    root.classList.remove('gcsp-menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
  const onMenuClick = () => {
    const open = !root.classList.contains('gcsp-menu-open');
    root.classList.toggle('gcsp-menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  };
  const onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const accountDetails = accountBox.querySelector('details[open]');
    if (bell && bell.root.contains(event.target)) return;
    if (accountDetails) {
      accountDetails.open = false;
      accountDetails.querySelector('summary').focus();
    } else if (root.classList.contains('gcsp-menu-open')) {
      closeMenu();
      menuToggle.focus();
    }
  };
  const onSkip = (event) => {
    event.preventDefault();
    main.focus();
  };
  let signingOut = false;
  let destroyed = false;
  let invalidated = false;
  function clearSession() {
    invalidated = true; setAccount({ status: 'signed-out' });
    main.replaceChildren(); closeMenu(); disconnectBell?.(); bell?.destroy();
    content.hidden = true; root.inert = true;
  }
  const onAccountClick = async (event) => {
    if (event.target.closest?.('.gcsp-account-retry')) onRetryAccount?.();
    const shortcut = event.target.closest?.('.gcsp-account-link');
    if (shortcut) {
      const details = shortcut.closest('details'); if (details) details.open = false;
      closeMenu(); onNavigate?.(shortcut.dataset.key); return;
    }
    const action = event.target.closest?.('.gcsp-account-signout');
    if (!action || signingOut) return;
    signingOut = true; action.disabled = true; action.textContent = 'Signing out…';
    const panel = action.closest('.gcsp-account-panel');
    panel.querySelector('[role="alert"]')?.remove();
    let result;
    try { result = await sessionAdapter.signOut(); } catch { result = { status: 'unavailable' }; }
    if (destroyed) return;
    if (result?.status === 'ok') {
      clearSession();
      announceSessionChange(root.ownerDocument.defaultView);
      if (navigate) navigate('/gcsp/login');
      else root.ownerDocument.defaultView.location.replace('/gcsp/login');
      return;
    }
    signingOut = false; action.disabled = false; action.textContent = 'Sign out';
    const error = el('p', 'gcsp-account-signout-error', 'Sign-out is unavailable. Please try again.');
    error.setAttribute('role', 'alert'); panel.append(error);
  };
  menuToggle.addEventListener('click', onMenuClick);
  root.addEventListener('keydown', onKeydown);
  skip.addEventListener('click', onSkip);
  accountBox.addEventListener('click', onAccountClick);
  // Opening the account menu closes the bell; the bell closes the account menu through onOpen.
  const onAccountToggle = (event) => { if (event.target.open) bell?.close(false); };
  if (bell) accountBox.addEventListener('toggle', onAccountToggle, true);

  function setAccount(state) {
    if (invalidated && state?.status !== 'signed-out') return;
    const retry = el('button', 'gcsp-account-retry', 'Retry');
    retry.type = 'button';
    const logout = signOut ? button({ label: 'Sign out', variant: 'ghost', disabled: signingOut }) : null;
    if (logout) logout.classList.add('gcsp-account-signout');
    const view = accountContent(state, retry, logout, accountMenu, accountFailure === 'page');
    if (view.label) accountBox.setAttribute('aria-label', view.label); else accountBox.removeAttribute('aria-label');
    accountBox.setAttribute('aria-busy', String(view.busy));
    accountBox.dataset.status = view.signedOut ? 'signed-out' : view.restarted ? 'restarted'
      : view.busy ? 'loading' : (view.label?.startsWith('Account:') ? 'ready' : 'unavailable');
    accountBox.replaceChildren(...view.nodes);
  }

  function setBreadcrumbs(list = []) {
    const labels = list.map((c) => (typeof c === 'string' ? c : c?.label)).filter(Boolean);
    if (labels.length < 2) {
      crumbsHost.replaceChildren();
      return;
    }
    const navEl = el('nav', 'gcsp-crumbs');
    navEl.setAttribute('aria-label', 'Breadcrumb');
    const ol = el('ol', 'gcsp-crumb-list');
    labels.forEach((label, i) => {
      const li = el('li', 'gcsp-crumb', label);
      if (i === labels.length - 1) li.setAttribute('aria-current', 'page');
      ol.append(li);
    });
    navEl.append(ol);
    crumbsHost.replaceChildren(navEl);
  }

  setAccount(account);
  setBreadcrumbs(breadcrumbs);
  const stopSession = signOut ? installSessionLifecycle({ win: root.ownerDocument.defaultView,
    active: () => accountBox.dataset.status !== 'signed-out', clear: clearSession,
    reload: () => { if (reload) reload(); else root.ownerDocument.defaultView.location.reload(); },
  }) : () => {};
  const stopFocus = installArrivalFocus({ root, main, arrive: arrivalFocus });

  return {
    root,
    main,
    setAccount,
    setActive: (key) => nav.setActive(key),
    setBreadcrumbs,
    bell: bell?.root ?? null,
    setNotifications: (model) => bell?.update(model),
    destroy() {
      destroyed = true;
      disconnectBell?.(); bell?.destroy();
      accountBox.removeEventListener('toggle', onAccountToggle, true);
      menuToggle.removeEventListener('click', onMenuClick);
      root.removeEventListener('keydown', onKeydown);
      skip.removeEventListener('click', onSkip);
      accountBox.removeEventListener('click', onAccountClick);
      stopFocus();
      stopSession();
      nav.destroy();
      root.remove();
    },
  };
}
