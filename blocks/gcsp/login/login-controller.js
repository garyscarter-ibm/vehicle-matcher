const LANDINGS = new Set(['/gcsp-account.html', '/gcsp-greg.html']);
const FAILURES = {
  invalid: 'Enter your email address and password.',
  'invalid-credentials': 'Your email address or password is incorrect. Check them and try again.',
  forbidden: 'Your account does not have access to this portal. Contact the scheme team.',
  unavailable: 'Sign-in is unavailable. Please try again.',
};

export function createLoginController({ adapter, navigate, onChange }) {
  let pending = false;
  let active = true;
  return {
    async submit(credentials) {
      if (pending || !active) return;
      pending = true;
      onChange({ status: 'pending', message: 'Signing in…' });
      let result;
      try { result = await adapter.signIn(credentials); }
      catch { result = { status: 'unavailable' }; }
      if (!active) return;
      if (result?.status === 'ok' && LANDINGS.has(result.value?.redirectTo)) {
        onChange({ status: 'success', message: 'Signed in. Opening your account…' });
        navigate(result.value.redirectTo);
        return;
      }
      pending = false;
      onChange({ status: 'error', message: FAILURES[result?.status] || FAILURES.unavailable });
    },
    destroy() { active = false; },
  };
}
