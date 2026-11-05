import { mountAccount } from '../account/gcsp-account.js';
import { mountManualSetup } from './gcsp-manual-setup.js';

export function mountManualJourney(root, options = {}) {
  let teardown; let disposed = false;
  const account = () => { if (!disposed) { teardown?.(); teardown = mountAccount(root, options); } };
  const start = (event) => {
    if (disposed || event.target !== root) return;
    const hint = event.detail; teardown?.();
    teardown = mountManualSetup(root, { ...options, hint, onBack: account });
  };
  root.addEventListener('gcsp:journey-start', start); account();
  return () => { disposed = true; root.removeEventListener('gcsp:journey-start', start); teardown?.(); };
}
