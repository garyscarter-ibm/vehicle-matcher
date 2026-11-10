import { portalShell } from '../shell/portal-shell.js';
import { createSessionHttpAdapter } from './http-adapter.js';
import { createLoginController } from './login-controller.js';
import { loginView } from './login-view.js';
import { announceSessionChange } from '../shell/session-lifecycle.js';

export function mountLogin(root, { fetchImpl, adapter = createSessionHttpAdapter({ fetchImpl }),
  navigate } = {}) {
  const shell = portalShell({ account: { status: 'signed-out' } });
  shell.root.classList.add('gcsp-login-shell');
  const view = loginView({ onSubmit: (credentials) => controller.submit(credentials) });
  const controller = createLoginController({ adapter, navigate, onChange: (state) => {
    view.update(state);
    if (state.status === 'success') announceSessionChange(root.ownerDocument.defaultView);
  } });
  shell.main.append(view.root); root.replaceChildren(shell.root);
  return { destroy() { controller.destroy(); view.destroy(); shell.destroy(); } };
}
