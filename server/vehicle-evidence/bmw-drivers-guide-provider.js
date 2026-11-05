import { constants, createPublicKey, publicEncrypt } from 'node:crypto';
import { createBmwVinGuideAdapter } from './bmw-vin-guide-adapter.js';

const ORIGIN = 'https://baonline.bmw.com';
const KEY_URL = `${ORIGIN}/digital/v4.0/key`;
const KEY_BYTES = 16384;
const MANUAL_BYTES = 262144;
const IMAGE_BYTES = 2097152;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = (failureDetail) => ({ status: 'source-unavailable', failureDetail });
const failures = new WeakMap();
const failure = (detail) => { const token = Object.freeze(Object.create(null)); failures.set(token, detail); return token; };
const fail = (detail) => { throw failure(detail); };
const DETAILS = new Set(['identity-denied', 'invalid-source', 'identity-mismatch', 'locale-mismatch', 'timeout',
  'http-error', 'application-error', 'response-too-large', 'transport-error', 'source-unavailable']);
const IDENTITY_FIELD = /^(?:vin|vin17|vinNumber|vin_number|vehicleIdentificationNumber)$/i;
const PRIVATE_FIELD = /vin|identif|token|url|href|(?:^|[_-])id$|Id$|uuid|assetRef/i;
const VIN_PATTERN = /[A-HJ-NPR-Z0-9]{17}/ig;
const METADATA_FIELDS = ['carName', 'derivative', 'brand', 'handbookDisclaimer', 'sections', 'links'];
const MANUAL_FIELDS = ['locale', 'availableLocales', ...METADATA_FIELDS];
const MANUAL_STATUSES = new Set(['OK', 'MANUAL_NOT_AVAILABLE', 'UNSUPPORTED_LOCALE', 'VEHICLE_NOT_FOUND', 'SERVICE_UNAVAILABLE']);
const defaultDecodeManual = (data) => Object.fromEntries(MANUAL_FIELDS.filter((name) => Object.hasOwn(data, name)).map((name) => [name, data[name]]));

function sensitiveValues(data, request, ciphertext, collect = () => {}) {
  const values = [request.vin, ciphertext];
  let identityMismatch = false; let nodes = 0; let bytes = 0;
  const visit = (value, name = '', depth = 0, privateParent = false) => {
    nodes += 1;
    if (depth > 16 || nodes > 16384) fail('invalid-source');
    const privateField = privateParent || PRIVATE_FIELD.test(name);
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > MANUAL_BYTES) fail('response-too-large');
      if (privateField) values.push(value);
      for (const match of value.matchAll(VIN_PATTERN)) values.push(match[0]);
      if (IDENTITY_FIELD.test(name) && value.toUpperCase() !== request.vin) identityMismatch = true;
    } else if (Array.isArray(value)) value.forEach((entry) => visit(entry, name, depth + 1, privateField));
    else if (object(value)) Object.entries(value).forEach(([key, entry]) => visit(entry, key, depth + 1, privateField));
  };
  try { visit(data); } finally { collect(values.filter((value) => typeof value === 'string' && value.length >= 4)); }
  if (identityMismatch) fail('identity-mismatch');
  return values.filter((value) => typeof value === 'string' && value.length >= 4);
}

function metadata(source, secrets) {
  const fragments = new Set();
  for (const secret of secrets) {
    const text = secret.toUpperCase();
    for (let i = 0; i <= text.length - 4; i += 1) fragments.add(text.slice(i, i + 4));
  }
  const safe = (value, max = 256) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max
      || /[<>\u0000-\u001f\u007f]|(?:[a-z][a-z0-9+.-]*:|[?#])/i.test(value)) return null;
    const text = value.toUpperCase();
    // Reject known private values and identifying fragments, without publishing or retaining them.
    for (let i = 0; i <= text.length - 4; i += 1) if (fragments.has(text.slice(i, i + 4))) return null;
    return value.trim();
  };
  const sections = Array.isArray(source.sections) ? source.sections.slice(0, 64)
    .map((section, index) => ({ id: `section-${index + 1}`, title: safe(section?.title) })).filter((section) => section.title) : [];
  const links = Array.isArray(source.links) ? source.links.slice(0, 16)
    .filter((link) => ['pdf', 'html'].includes(link?.format) && ['available', 'unavailable'].includes(link?.availability))
    .map((link, index) => ({ assetRef: `guide-${index + 1}`, label: safe(link.label), format: link.format, availability: link.availability }))
    .filter((link) => link.label) : [];
  return { title: safe(source.carName), derivative: safe(source.derivative), brand: safe(source.brand),
    disclaimer: safe(source.handbookDisclaimer, 2048), sections, links };
}

function privateLink(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    if (/[\s\\\u0000-\u001f\u007f]/.test(decodeURIComponent(value))) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === ORIGIN && !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}

function jpegStructure(data) {
  if (data[0] !== 255 || data[1] !== 216 || data.at(-2) !== 255 || data.at(-1) !== 217) return false;
  let position = 2; let dimensions = false;
  while (position < data.length - 2) {
    if (data[position++] !== 255) return false;
    while (data[position] === 255) position += 1;
    const marker = data[position++];
    if (position + 2 > data.length) return false;
    const length = data.readUInt16BE(position);
    if (length < 2 || position + length > data.length - 2) return false;
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || !data.readUInt16BE(position + 3) || !data.readUInt16BE(position + 5)) return false;
      dimensions = true;
    }
    if (marker === 218) return dimensions && length >= 6 && position + length < data.length - 2;
    position += length;
  }
  return false;
}

function raster(response) {
  const type = typeof response.contentType === 'string' ? response.contentType.split(';')[0].trim().toLowerCase() : '';
  const bytes = response.body;
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) fail('invalid-source');
  const data = Buffer.from(bytes);
  const jpeg = jpegStructure(data);
  if (!(['image/jpeg', 'image/jpg'].includes(type) && jpeg)) fail('invalid-source');
  return { contentType: type === 'image/jpg' ? 'image/jpeg' : type, byteLength: data.length };
}

const contentState = (status = 'unknown', failureDetail = null, httpOutcome = 'not-attempted', applicationOutcome = 'not-applicable') =>
  ({ status, failureDetail, httpOutcome, applicationOutcome });
const defaultDecodePdfManual = (data) => Object.fromEntries(['locale', 'links'].filter((name) => Object.hasOwn(data, name)).map((name) => [name, data[name]]));

function decodeKey(data) {
  if (Object.hasOwn(data, 'status') && data.status !== 'OK') fail('application-error');
  if (!object(data.publicKeyData)) fail('invalid-source');
  const algorithms = [data, data.publicKeyData].filter((part) => Object.hasOwn(part, 'algorithm')).map((part) => part.algorithm);
  if (!algorithms.length || algorithms.some((algorithm) => algorithm !== 'RSA')) fail('invalid-source');
  const encoded = data.publicKeyData.pem;
  if (typeof encoded !== 'string' || encoded.length > 2048 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('invalid-source');
  const der = Buffer.from(encoded, 'base64');
  if (!der.length || der.length > 1024 || der.toString('base64') !== encoded) fail('invalid-source');
  let key;
  try { key = createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { fail('invalid-source'); }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.asymmetricKeyType !== 'rsa' || !Number.isInteger(bits) || bits < 2048 || bits > 4096
    || !key.export({ format: 'der', type: 'spki' }).equals(der)) fail('invalid-source');
  return key;
}

/** Only this guarded adapter is exported. There is no fetch implementation or environment activation. */
export function createBmwDriversGuideAdapter({ transport, guard, clock = () => new Date(), keyHandling = {},
  decodeManual = defaultDecodeManual, decodePdfManual = defaultDecodePdfManual, content = {}, timeoutMs = 1500 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Supply a bounded guide timeout.');
  if (transport === undefined) return createBmwVinGuideAdapter();
  if (typeof transport !== 'function' || typeof clock !== 'function' || typeof decodeManual !== 'function' || typeof decodePdfManual !== 'function' || !object(content)
    || Object.keys(content).some((name) => !['pdf', 'illustration'].includes(name))
    || Object.values(content).some((value) => typeof value !== 'boolean')
    || (keyHandling.encrypt !== undefined && typeof keyHandling.encrypt !== 'function')) throw new TypeError('Supply guide dependencies.');
  const requestedContent = Object.freeze({ pdf: content.pdf === true, illustration: content.illustration === true });
  const encrypt = keyHandling.encrypt || ((key, bytes) => publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, bytes));
  const provider = Object.freeze({ id: 'bmw-drivers-guide', version: '1', sourceKind: 'authorised-live',
    async resolve(request, { signal, context }) {
      const controllers = new Set();
      const started = Date.now();
      const authorize = async (locale) => {
        if (signal.aborted) fail('timeout');
        const target = Object.freeze({ vin: request.vin, locale });
        try { if (typeof guard?.check !== 'function' || await guard.check(target, context) !== true) fail('identity-denied'); }
        catch { fail('identity-denied'); }
        if (signal.aborted) fail('timeout');
      };
      const get = async (url, maxResponseBytes, locale, binary = false, requestTimeout = timeoutMs, observe = () => {}) => {
        let guardTimer;
        try {
          await Promise.race([authorize(locale), new Promise((_, reject) => {
            guardTimer = setTimeout(() => reject(failure('timeout')), requestTimeout);
          })]);
        } finally { clearTimeout(guardTimer); }
        observe('error');
        const controller = new AbortController(); controllers.add(controller);
        const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
        let timer;
        try {
          const response = await Promise.race([
            Promise.resolve().then(() => transport({ method: 'GET', url, signal: controller.signal, redirect: 'error', maxResponseBytes })),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('timeout')); }, requestTimeout); }),
            new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(failure('timeout')), { once: true })),
          ]);
          if (signal.aborted || controller.signal.aborted) fail('timeout');
          if (!object(response) || !Number.isInteger(response.status)) fail('invalid-source');
          if (response.redirected === true || response.status !== 200 || (response.url !== undefined && response.url !== url)) fail('http-error');
          observe('ok');
          const body = response.body;
          if (typeof body !== 'string' && !(body instanceof Uint8Array)) fail('invalid-source');
          const bytes = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
          if (bytes > maxResponseBytes) fail('response-too-large');
          if (binary) return response;
          let data;
          try { data = JSON.parse(typeof body === 'string' ? body : Buffer.from(body).toString('utf8')); } catch { fail('invalid-source'); }
          if (!object(data)) fail('invalid-source');
          return data;
        } finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); controllers.delete(controller); }
      };
      try {
        const key = decodeKey(await get(KEY_URL, KEY_BYTES, request.locale));
        if (signal.aborted) fail('timeout');
        let ciphertext;
        try {
          const encrypted = await encrypt(key, Buffer.from(request.vin, 'ascii'));
          if (!(encrypted instanceof Uint8Array) || encrypted.byteLength !== key.asymmetricKeyDetails.modulusLength / 8) fail('invalid-source');
          ciphertext = Buffer.from(encrypted).toString('base64url');
        } catch { fail('invalid-source'); }
        const route = (operation, locale) => `${ORIGIN}/digital/v4.0/${operation}?encryptedVin=${ciphertext}&locale=${locale.toLowerCase()}`;
        let identity;
        for (const locale of [request.locale, 'en-GB']) {
          const url = route('manual', locale);
          const data = await get(url, MANUAL_BYTES, locale);
          if (!Object.hasOwn(data, 'status')) fail('invalid-source');
          if (!MANUAL_STATUSES.has(data.status)) fail('application-error');
          const secrets = sensitiveValues(data, request, ciphertext);
          let source;
          try { source = await decodeManual(data); } catch { fail('invalid-source'); }
          if (signal.aborted) fail('timeout');
          if (!object(source)) fail('invalid-source');
          secrets.push(...sensitiveValues(source, request, ciphertext));
          if (Object.hasOwn(source, 'locale') && source.locale !== locale.toLowerCase()) fail('locale-mismatch');
          const resolvedLocale = Object.hasOwn(source, 'locale') ? locale : null;
          const currentIdentity = Object.fromEntries(['derivative', 'brand'].map((name) => [name,
            typeof source[name] === 'string' && /^[a-z0-9 .-]{1,128}$/i.test(source[name]) ? source[name].trim().toUpperCase() : null]));
          if (identity && ['derivative', 'brand'].some((name) => identity[name] && currentIdentity[name]
            && identity[name] !== currentIdentity[name])) fail('identity-mismatch');
          identity ||= currentIdentity;
          if (['MANUAL_NOT_AVAILABLE', 'UNSUPPORTED_LOCALE'].includes(data.status)) {
            const offered = source.availableLocales;
            if (locale === request.locale && locale !== 'en-GB' && Array.isArray(offered) && offered.length <= 64
              && offered.includes('en-gb')) continue;
            return { status: data.status === 'MANUAL_NOT_AVAILABLE' ? 'no-guide' : 'unsupported-locale', resolvedLocale };
          }
          if (data.status === 'VEHICLE_NOT_FOUND') return { status: 'no-match', resolvedLocale };
          if (data.status === 'SERVICE_UNAVAILABLE') fail('source-unavailable');
          if (!METADATA_FIELDS.some((name) => Object.hasOwn(source, name))) fail('invalid-source');
          const observed = clock();
          if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) fail('invalid-source');
          let pdfLinks = null;
          const retainSecrets = (values) => secrets.push(...values);
          const pdf = contentState();
          const illustration = { ...contentState(), assetRef: null };
          const runContent = async (operation, target, work) => {
            if (!requestedContent[operation]) return;
            const budget = Math.min(Math.floor(timeoutMs / 6), Math.floor((timeoutMs - (Date.now() - started) - 25) / 4));
            if (budget < 1 || signal.aborted) { Object.assign(target, contentState('source-unavailable', 'timeout')); return; }
            let httpOutcome = 'not-attempted'; let applicationOutcome = operation === 'pdf' ? 'unknown' : 'not-applicable';
            try {
              const raw = await get(route(operation === 'pdf' ? 'pdfManual' : 'cosy', locale),
                operation === 'pdf' ? MANUAL_BYTES : IMAGE_BYTES, locale, operation === 'illustration', budget,
                (outcome) => { httpOutcome = outcome; });
              await work(raw, (outcome) => { applicationOutcome = outcome; });
              Object.assign(target, { httpOutcome, applicationOutcome });
            } catch (error) {
              const detail = failures.get(error);
              Object.assign(target, contentState(detail === 'invalid-source' || detail === 'identity-mismatch'
                || detail === 'locale-mismatch' ? 'invalid' : 'source-unavailable', DETAILS.has(detail) ? detail : 'transport-error',
              httpOutcome, applicationOutcome));
            }
          };
          await runContent('pdf', pdf, async (raw, application) => {
            const privateValues = sensitiveValues(raw, request, ciphertext, retainSecrets);
            if (!Object.hasOwn(raw, 'status')) fail('invalid-source');
            if (!['OK', 'MANUAL_NOT_AVAILABLE'].includes(raw.status)) { application('error'); fail('application-error'); }
            application(raw.status === 'OK' ? 'ok' : 'unavailable');
            if (raw.status === 'MANUAL_NOT_AVAILABLE') { pdf.status = 'unavailable'; return; }
            let decoded; let decoderTimer;
            const decoderBudget = Math.max(1, Math.min(Math.floor(timeoutMs / 6), timeoutMs - (Date.now() - started) - 25));
            try {
              decoded = await Promise.race([Promise.resolve().then(() => decodePdfManual(raw)),
                new Promise((_, reject) => { decoderTimer = setTimeout(() => reject(failure('timeout')), decoderBudget); })]);
            } catch (error) { if (failures.get(error) === 'timeout') throw error; fail('invalid-source'); }
            finally { clearTimeout(decoderTimer); }
            if (signal.aborted) fail('timeout');
            privateValues.push(...sensitiveValues(decoded, request, ciphertext, retainSecrets));
            if (!object(decoded)) fail('invalid-source');
            if (Object.hasOwn(decoded, 'locale') && decoded.locale !== locale.toLowerCase()) fail('locale-mismatch');
            if (!Array.isArray(decoded.links) || decoded.links.length > 16) fail('invalid-source');
            const links = decoded.links.map((link, index) => {
              if (!object(link) || !privateLink(link.url) || link.contentType !== 'application/pdf') fail('invalid-source');
              const label = metadata({ carName: link.label }, [...secrets, ...privateValues]).title;
              if (!label) fail('invalid-source');
              return { assetRef: `pdf-${index + 1}`, label, format: 'pdf', availability: 'available', contentType: 'application/pdf' };
            });
            pdfLinks = links;
            pdf.status = links.length ? 'available' : 'unavailable';
          });
          await runContent('illustration', illustration, async (raw) => {
            const image = raster(raw);
            Object.assign(illustration, image, { status: 'available', assetRef: 'vin-illustration' });
          });
          const finalGuide = metadata(source, secrets);
          if (pdfLinks) finalGuide.links = [...pdfLinks.filter((link) => metadata({ carName: link.label }, secrets).title),
            ...finalGuide.links.filter((link) => link.format !== 'pdf')].slice(0, 16);
          return { status: 'partial', observedDate: observed.toISOString().slice(0, 10), resolvedLocale,
            guide: { ...finalGuide, pdf }, illustration, completeness: { handbook: 'partial', sections: 'partial', links: 'partial' } };
        }
        return unavailable('invalid-source');
      } catch (error) {
        const detail = failures.get(error);
        return unavailable(DETAILS.has(detail) ? detail : 'transport-error');
      } finally { for (const controller of controllers) controller.abort(); }
    } });
  return createBmwVinGuideAdapter({ provider, guard, timeoutMs });
}
