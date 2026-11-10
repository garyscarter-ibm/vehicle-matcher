import './register.js';
import { startPresenterConsole } from './console.js';
const destroy = startPresenterConsole()?.destroy;
globalThis.addEventListener('pagehide', () => destroy?.(), { once: true });
