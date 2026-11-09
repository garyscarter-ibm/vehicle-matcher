import './register.js';
import { startPresenterWorkspace } from './workspace.js';
const destroy = startPresenterWorkspace();
globalThis.addEventListener('pagehide', () => destroy?.(), { once: true });
