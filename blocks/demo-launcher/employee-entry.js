import { employeeEntryUrl } from './entry-context.js';

export function createEmployeeCapability({ enabled = true, frontendUrl, navigate } = {}) {
  const destination = employeeEntryUrl(frontendUrl);
  const available = enabled === true && destination !== null;
  return {
    enabled: available,
    frontendUrl: available ? new URL('/gcsp/', destination).href : null,
    mount(root, context, { signal } = {}) {
      if (!available || signal?.aborted || context.brand !== 'bmw') return undefined;
      const win = root.ownerDocument.defaultView;
      if (navigate) navigate(destination);
      else win.location.replace(destination);
      return undefined;
    },
  };
}
