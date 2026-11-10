import { mountLogin } from './gcsp-login.js';

const host = document.querySelector('[data-gcsp-login]');
if (host) mountLogin(host, { navigate: (path) => globalThis.location.replace(path) });
