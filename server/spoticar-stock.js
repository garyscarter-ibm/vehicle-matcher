import { request } from 'node:https';
import { mapRamRaw } from './ram-mapping.js';

const ORIGIN = 'https://www.spoticar.com';
const AUTH_STATUSES = new Set([401, 403, 419]);
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';

export class SpoticarUnavailableError extends Error {
  constructor(message, status) {
    super(`RAM inventory unavailable: ${message}`);
    this.name = 'SpoticarUnavailableError';
    this.statusCode = 502;
    this.upstreamStatus = status;
  }
}

// Transport responses stay private: neither response bodies nor visitor credentials enter errors.
export function spoticarHttps(url, { method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let timer;
    const req = request(url, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new SpoticarUnavailableError('response exceeds byte bound'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', () => {
        clearTimeout(timer);
        reject(new SpoticarUnavailableError('response interrupted'));
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    timer = setTimeout(() => req.destroy(new SpoticarUnavailableError('request timed out')), timeoutMs);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof SpoticarUnavailableError ? error : new SpoticarUnavailableError('transport failed'));
    });
    req.end(body);
  });
}

function formEncode(value) {
  const params = new URLSearchParams();
  const add = (key, item) => {
    if (Array.isArray(item)) item.forEach((child) => add(`${key}[]`, child));
    else if (item !== null && typeof item === 'object') {
      Object.entries(item).forEach(([childKey, child]) => add(`${key}[${childKey}]`, child));
    } else if (item !== undefined && item !== null) params.append(key, String(item));
  };
  Object.entries(value).forEach(([key, item]) => add(key, item));
  return params.toString();
}

function visitorMeta(html, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)]
      .map((match) => [match[1].toLowerCase(), match[2]]));
    if (attrs.name === name && attrs.content) return attrs.content;
  }
  throw new SpoticarUnavailableError('visitor bootstrap missing metadata');
}

function updateCookies(jar, headers = {}) {
  const incoming = headers['set-cookie'] || headers['Set-Cookie'] || [];
  for (const cookie of Array.isArray(incoming) ? incoming : [incoming]) {
    const pair = cookie.split(';', 1)[0];
    const equals = pair.indexOf('=');
    if (equals <= 0) continue;
    const name = pair.slice(0, equals);
    if (/;\s*max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
    else jar.set(name, pair.slice(equals + 1));
  }
}

function range(value, field) {
  if (!value || !Number.isFinite(value.min) || !Number.isFinite(value.max)
    || value.min < 0 || value.max < value.min) {
    throw new SpoticarUnavailableError(`invalid ${field} range`);
  }
  return { min: value.min, max: value.max };
}

export function createSpoticarClient({
  transport = spoticarHttps,
  pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  zipcode = '12345', delayMs = 500, timeoutMs = 35000,
  maxBytes = 8 * 1024 * 1024, maxPages = 500, maxWalkMs = 10 * 60 * 1000,
} = {}) {
  if (!/^\d{5}$/.test(zipcode) || !Number.isInteger(maxPages) || maxPages < 1
    || !Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(maxWalkMs) || maxWalkMs <= 0) {
    throw new SpoticarUnavailableError('invalid client configuration');
  }
  const searchUrl = `${ORIGIN}/t1/search-inventory?zipcode=${zipcode}&brand=ram&refrel=ram`;

  async function walk(started) {
    const cookies = new Map();
    let csrf;
    let bearer;
    let requests = 0;
    async function call(path, form) {
      if (requests++) await pause(delayMs);
      if (Date.now() - started >= maxWalkMs) throw new SpoticarUnavailableError('walk deadline exceeded');
      const body = form === undefined ? undefined : formEncode(form);
      const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', Referer: searchUrl };
      if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
      if (form !== undefined) Object.assign(headers, {
        Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
        'X-CSRF-TOKEN': csrf, Authorization: `Bearer ${bearer}`,
      });
      let response;
      try {
        response = await transport(new URL(path, ORIGIN).href, {
          method: form === undefined ? 'GET' : 'POST', headers, body,
          timeoutMs: Math.min(timeoutMs, maxWalkMs - (Date.now() - started)), maxBytes,
        });
      } catch (error) {
        if (error instanceof SpoticarUnavailableError) throw error;
        throw new SpoticarUnavailableError('transport failed');
      }
      updateCookies(cookies, response.headers);
      if (response.status !== 200) throw new SpoticarUnavailableError('upstream HTTP failure', response.status);
      if (typeof response.body !== 'string' || Buffer.byteLength(response.body) > maxBytes) {
        throw new SpoticarUnavailableError('invalid response body');
      }
      if (form === undefined) return response.body;
      let result;
      try { result = JSON.parse(response.body); } catch {
        throw new SpoticarUnavailableError('invalid JSON');
      }
      if (!result || result.success !== true) {
        throw new SpoticarUnavailableError('search rejected', result?.status);
      }
      return result;
    }

    const html = await call(searchUrl);
    csrf = visitorMeta(html, 'csrf-token');
    bearer = visitorMeta(html, 'web-token');
    const dealers = await call('/api/zipcode', {
      zipcode, radius: { min: 0, max: 3000 }, dealerCityName: '', pagename: 'sni',
    });
    if (!Array.isArray(dealers.data) || !dealers.data.length
      || dealers.data.some((row) => typeof row?.dealer_code !== 'string' || !row.dealer_code)) {
      throw new SpoticarUnavailableError('missing national dealer coverage');
    }
    const dealerCode = [...new Set(dealers.data.map((row) => row.dealer_code))];
    const filters = await call('/api/sni', {
      recordType: 'filter', zipcode, dealerCode, sortBy: 'internetprice_asc', pagename: 'sni',
    });
    const options = filters.data?.sniFilter;
    const query = {
      brand: ['RAM'], vehicleType: ['cpo'],
      price: range(options?.priceRange, 'price'), mileages: range(options?.milesRange, 'mileage'),
      year: range(options?.yearRange, 'year'), dealerRadiusRange: { min: 0, max: 3000 },
      dealerCode, zipcode, dealerCityName: '', targetMonthlyPayment: '1000',
      termLengths: '72', creditRating: '800-850', sortBy: 'internetprice_asc',
    };
    const identities = new Set();
    const pageSignatures = new Set();
    const cars = [];
    let sourceRows = 0;
    let total;
    let pageSize;
    let pages;
    for (let page = 1; page <= (pages ?? 1); page += 1) {
      const result = await call('/sniLoadMore', { ...query, page });
      const rows = result.sniData;
      if (!Number.isInteger(result.total) || result.total < 0 || !Array.isArray(rows)) {
        throw new SpoticarUnavailableError('invalid pagination envelope');
      }
      if (page === 1) {
        total = result.total;
        if (!total && rows.length === 0) return [];
        pageSize = rows.length;
        pages = pageSize ? Math.ceil(total / pageSize) : Infinity;
        if (!pageSize || pages > maxPages) throw new SpoticarUnavailableError('declared inventory exceeds page bound');
      }
      if (result.total !== total || rows.length !== Math.min(pageSize, total - ((page - 1) * pageSize))) {
        throw new SpoticarUnavailableError('inventory changed or page missing');
      }
      const keys = rows.map((row) => {
        if (typeof row?.vin !== 'string' || !row.vin
          || typeof row?.dealer_code !== 'string' || !row.dealer_code) {
          throw new SpoticarUnavailableError('listing identity missing');
        }
        return `${row.vin}_${row.dealer_code}`;
      });
      const signature = JSON.stringify([...keys].sort());
      if (pageSignatures.has(signature)) throw new SpoticarUnavailableError('repeated inventory page');
      if (keys.every((key) => identities.has(key))) throw new SpoticarUnavailableError('page added no new listings');
      pageSignatures.add(signature);
      sourceRows += rows.length;
      for (const [index, row] of rows.entries()) {
        const identity = keys[index];
        if (identities.has(identity)) continue;
        identities.add(identity);
        const car = mapRamRaw(row);
        if (car) cars.push(car);
      }
    }
    // Source totals describe rows; non-atomic pagination may repeat individual listings.
    if (sourceRows !== total) throw new SpoticarUnavailableError('incomplete inventory coverage');
    return cars;
  }

  return {
    async fetchStock() {
      const started = Date.now();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { return await walk(started); } catch (error) {
          if (attempt === 0 && AUTH_STATUSES.has(error.upstreamStatus)) continue;
          if (error instanceof SpoticarUnavailableError) throw error;
          throw new SpoticarUnavailableError('unexpected response shape');
        }
      }
      throw new SpoticarUnavailableError('visitor authorization failed');
    },
  };
}

export const fetchRamStock = () => createSpoticarClient().fetchStock();
