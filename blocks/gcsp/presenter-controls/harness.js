import './register.js';
import { mountPresenterConsole } from './console.js';
import { basicConsoleOptions } from './basic-console.js';
const host = document.querySelector('[data-presenter-console]');
const destroy = host ? mountPresenterConsole(host, basicConsoleOptions()).destroy : null;
globalThis.addEventListener('pagehide', () => destroy?.(), { once: true });
