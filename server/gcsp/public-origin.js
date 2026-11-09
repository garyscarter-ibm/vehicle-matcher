// Exact public origin: https, or http only for localhost/127.0.0.1. Anything else is null.
export function publicOrigin(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    return url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:' && local) ? url.origin : null;
  } catch { return null; }
}
