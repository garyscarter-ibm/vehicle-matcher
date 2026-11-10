import { el, button, screenIntro } from '../../vehicle-matcher/ui.js';
import { labelledField } from '../kit/form-controls.js';

let uid = 0;
export function loginView({ onSubmit }) {
  const id = `gcsp-login-${++uid}`;
  const root = el('section', 'gcsp-login-panel vm');
  const intro = screenIntro({ level: 1, title: 'Sign in', lede: 'Your cars, your choices, all in one place.' });
  const form = el('form', 'gcsp-login-form'); form.noValidate = true;
  form.setAttribute('aria-busy', 'false');
  const email = el('input'); email.name = 'email'; email.type = 'email'; email.autocomplete = 'username'; email.required = true;
  email.spellcheck = false; email.autocapitalize = 'none';
  const password = el('input'); password.name = 'password'; password.type = 'password'; password.autocomplete = 'current-password'; password.required = true;
  const emailField = labelledField({ id: `${id}-email`, label: 'Email address', control: email });
  const passwordField = labelledField({ id: `${id}-password`, label: 'Password', control: password });
  const failure = el('p', 'gcsp-login-error'); failure.setAttribute('role', 'alert'); failure.tabIndex = -1; failure.hidden = true;
  const status = el('p', 'gcsp-login-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const submit = button({ label: 'Sign in' }); submit.type = 'submit';
  form.append(emailField.root, passwordField.root, failure, submit, status);
  root.append(intro, form);
  let busy = false;
  function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    email.value = email.value.trim();
    const emailError = !email.value ? 'Enter your email address.' : !email.validity.valid ? 'Enter a valid email address.' : '';
    const passwordError = !password.value ? 'Enter your password.' : '';
    emailField.setError(emailError); passwordField.setError(passwordError);
    failure.hidden = true; failure.textContent = '';
    if (emailError || passwordError) { (emailError ? email : password).focus(); return; }
    onSubmit({ email: email.value, password: password.value });
  }
  form.addEventListener('submit', handleSubmit);
  return {
    root,
    update(state) {
      busy = state.status === 'pending' || state.status === 'success';
      submit.disabled = busy; email.disabled = busy; password.disabled = busy;
      form.setAttribute('aria-busy', String(state.status === 'pending'));
      submit.textContent = state.status === 'pending' ? 'Signing in…' : 'Sign in';
      if (state.status !== 'pending') password.value = '';
      failure.hidden = state.status !== 'error'; failure.textContent = state.status === 'error' ? state.message : '';
      status.hidden = state.status === 'error'; status.textContent = state.status === 'error' ? '' : state.message;
      if (state.status === 'error') failure.focus();
    },
    destroy() { password.value = ''; form.removeEventListener('submit', handleSubmit); root.remove(); },
  };
}
