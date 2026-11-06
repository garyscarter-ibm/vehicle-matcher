// In-process transport for the future actual-runtime proof. No socket or business DTO substitution.
import { Readable } from 'node:stream';

export function createPresenterHttpProofTransport(server, { origin } = {}) {
  const host = new URL(origin);
  if (host.origin !== origin || host.protocol !== 'https:' || server.listeners('request').length !== 1) {
    throw new TypeError('Supply one actual server request listener and an explicit HTTPS test origin.');
  }
  const cookies = new Map();
  const exchanges = [];
  let lostReply = null;

  function acceptSetCookie(values, requestPath = '/api/gcsp/') {
    for (const value of [values].flat().filter((row) => typeof row === 'string')) {
      const [pair, ...attributes] = value.split(';').map((part) => part.trim());
      const separator = pair.indexOf('=');
      if (separator < 1) throw new TypeError('Invalid issued cookie.');
      const name = pair.slice(0, separator);
      const data = pair.slice(separator + 1);
      const options = Object.fromEntries(attributes.map((attribute) => {
        const split = attribute.indexOf('=');
        return split < 0 ? [attribute.toLowerCase(), true]
          : [attribute.slice(0, split).toLowerCase(), attribute.slice(split + 1)];
      }));
      if (options.domain && options.domain.replace(/^\./, '') !== host.hostname) {
        throw new TypeError('Issued cookie is outside the selected test host.');
      }
      const path = typeof options.path === 'string' && options.path.startsWith('/')
        ? options.path : requestPath.slice(0, requestPath.lastIndexOf('/') + 1);
      const key = `${name}\n${path}`;
      // This is a scoped test jar, not a browser implementation. Actual identity cookies use Max-Age.
      if (data === '' || options['max-age'] !== undefined && Number(options['max-age']) <= 0) cookies.delete(key);
      else cookies.set(key, { name, data, path });
    }
  }

  function cookieHeader(path) {
    return [...cookies.values()].filter((cookie) => path === cookie.path
      || path.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`))
      .sort((a, b) => b.path.length - a.path.length).map(({ name, data }) => `${name}=${data}`).join('; ');
  }

  async function fetchImpl(input, options = {}) {
    const url = new URL(input, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/gcsp/')) throw new TypeError('Unplanned HTTP proof target.');
    if (options.credentials !== 'include') throw new TypeError('Presenter proof must include actual session cookies.');
    options.signal?.throwIfAborted();
    const method = options.method ?? 'GET';
    if (!['GET', 'POST'].includes(method) || options.body !== undefined && typeof options.body !== 'string') {
      throw new TypeError('Use the unchanged adapter GET/POST and JSON-string body.');
    }
    const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (['cookie', 'host', 'origin'].some((key) => Object.hasOwn(headers, key))) {
      throw new TypeError('The proof transport supplies its selected host, origin and issued cookies.');
    }
    const request = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
    Object.assign(request, { url: url.pathname + url.search, method,
      headers: { ...headers, host: url.host, origin, cookie: cookieHeader(url.pathname) } });
    let ended = false;
    const response = { headers: {}, statusCode: 200, body: '',
      setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      getHeader(key) { return this.headers[key.toLowerCase()]; },
      writeHead(status, values = {}) { this.statusCode = status; for (const [key, value] of Object.entries(values)) this.setHeader(key, value); },
      end(body = '') { this.body = String(body); ended = true; } };
    await server.listeners('request')[0](request, response);
    if (!ended) throw new Error('The actual HTTP handler did not complete its response.');
    acceptSetCookie(response.headers['set-cookie'], url.pathname);
    // Do not retain cookies, tokens or request/response business bodies in the transport journal.
    exchanges.push(Object.freeze({ path: url.pathname, method, status: response.statusCode,
      requestBytes: Buffer.byteLength(options.body ?? ''), responseBytes: Buffer.byteLength(response.body) }));
    options.signal?.throwIfAborted();
    if (lostReply?.path === url.pathname && lostReply.method === method) {
      lostReply = null;
      throw new Error('Proof transport discarded the reply after the actual handler completed.');
    }
    let consumed = false;
    return { status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
      async json() {
        if (consumed) throw new TypeError('Response body already consumed.');
        consumed = true;
        return JSON.parse(response.body);
      } };
  }

  return Object.freeze({ fetchImpl,
    // Call only with cookies returned by actual server-side identity issuance/bootstrap.
    acceptIssuedCookies: (values) => acceptSetCookie(values),
    loseNextReply(path, method = 'POST') {
      if (!path.startsWith('/api/gcsp/') || method !== 'POST' || lostReply) throw new TypeError('Select one deliberate POST reply loss.');
      lostReply = { path, method };
    },
    get exchanges() { return [...exchanges]; },
    clear() { cookies.clear(); exchanges.length = 0; lostReply = null; },
  });
}
