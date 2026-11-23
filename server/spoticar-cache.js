import {
  closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fetchRamStock } from './spoticar-stock.js';

const CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'national-ram.json');
const MAX_BYTES = 16 * 1024 * 1024;
const COOLDOWN_MS = 60 * 1000;
const SCHEMA_VERSION = 1;
const MAPPED_FIELDS = new Set([
  'id', 'groupKey', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'currency', 'sizeClass',
  'seats', 'boot', 'zeroTo62', 'mpg', 'styleLine', 'doors', 'features', 'transmission',
  'tags', 'blurb', 'mileage', 'year', 'photo', 'retailerName', 'retailerId', 'dealerNumber',
  'link', 'vin', 'trim', 'cab', 'bed', 'engineDescription', 'driveType', 'colour',
  'power', 'powerUnit', 'certification',
]);

export class SpoticarCacheUnavailableError extends Error {
  constructor(message = 'live inventory refresh failed') {
    super(`RAM inventory unavailable: ${message}`);
    this.name = 'SpoticarCacheUnavailableError';
    this.statusCode = 502;
  }
}

function mappedCars(cars) {
  if (!Array.isArray(cars) || cars.length > 20000) throw new SpoticarCacheUnavailableError('invalid mapped inventory');
  const ids = new Set();
  return cars.map((car) => {
    if (!car || typeof car !== 'object' || typeof car.id !== 'string' || !car.id
      || ids.has(car.id) || typeof car.name !== 'string' || !/^RAM\s/.test(car.name)
      || !/^(?:1500(?: Classic)?|2500|3500)$/.test(car.line)
      || car.body !== 'pickup' || car.certification !== 'cpo' || car.currency !== 'USD'
      || !Number.isFinite(car.priceMin) || car.priceMin <= 0 || car.priceMin !== car.priceMax) {
      throw new SpoticarCacheUnavailableError('invalid mapped inventory');
    }
    ids.add(car.id);
    const out = {};
    for (const [key, value] of Object.entries(car)) {
      if (!MAPPED_FIELDS.has(key) || value === undefined) continue;
      if (key === 'colour') {
        if (!value || typeof value !== 'object') continue;
        out.colour = Object.fromEntries(['colour', 'manufacturerColour'].filter((field) =>
          typeof value[field] === 'string' && value[field].length <= 512).map((field) => [field, value[field]]));
      } else if (key === 'features' || key === 'tags') {
        if (!Array.isArray(value) || value.length > 256 || value.some((item) => typeof item !== 'string' || item.length > 128)) {
          throw new SpoticarCacheUnavailableError('invalid mapped inventory');
        }
        out[key] = [...value];
      } else if (value === null || typeof value === 'number' && Number.isFinite(value)
        || typeof value === 'string' && value.length <= 16384) out[key] = value;
      else throw new SpoticarCacheUnavailableError('invalid mapped inventory');
    }
    return out;
  });
}

export function createSpoticarCache({
  load = fetchRamStock, cachePath = CACHE_PATH, now = Date.now,
  ttlMs = 30 * 60 * 1000, maxAgeMs = 24 * 60 * 60 * 1000,
  log = (message) => console.warn(message),
} = {}) {
  if (typeof load !== 'function' || typeof now !== 'function' || typeof cachePath !== 'string'
    || !Number.isFinite(ttlMs) || ttlMs < 0 || !Number.isFinite(maxAgeMs) || maxAgeMs < ttlMs) {
    throw new SpoticarCacheUnavailableError('invalid cache configuration');
  }
  let snapshot = null;
  let inflight = null;
  let failedAt = null;
  const usable = () => snapshot && now() >= snapshot.updatedAt && now() - snapshot.updatedAt <= maxAgeMs;
  const fresh = () => usable() && now() - snapshot.updatedAt < ttlMs;
  const safeLog = (message) => { try { log(message); } catch { /* logging must not break inventory */ } };

  let readFd;
  try {
    readFd = openSync(cachePath, 'r');
    if (fstatSync(readFd).size > MAX_BYTES) throw new Error('size bound');
    const saved = JSON.parse(readFileSync(readFd, 'utf8'));
    if (saved.schemaVersion !== SCHEMA_VERSION || !Number.isFinite(saved.updatedAt)
      || saved.updatedAt < 0 || saved.updatedAt > now()) throw new Error('invalid snapshot');
    snapshot = { updatedAt: saved.updatedAt, cars: mappedCars(saved.cars) };
  } catch { snapshot = null; } finally { if (readFd !== undefined) closeSync(readFd); }

  function persist(next) {
    const body = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...next });
    if (Buffer.byteLength(body) > MAX_BYTES) throw new SpoticarCacheUnavailableError('mapped inventory exceeds cache size bound');
    let fd;
    const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, body, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, cachePath);
    } catch {
      safeLog('[ram-cache] completed inventory is fresh in memory; disk persistence failed');
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  function refresh() {
    if (inflight) return inflight;
    if (failedAt !== null && now() - failedAt < COOLDOWN_MS) {
      return Promise.reject(new SpoticarCacheUnavailableError('refresh retry cooling down'));
    }
    inflight = Promise.resolve().then(load).then((cars) => {
      const next = { updatedAt: now(), cars: mappedCars(cars) };
      persist(next);
      snapshot = next;
      failedAt = null;
      return next.cars;
    }).catch(() => {
      failedAt = now();
      safeLog('[ram-cache] live refresh failed; retaining any usable completed inventory');
      throw new SpoticarCacheUnavailableError();
    }).finally(() => { inflight = null; });
    return inflight;
  }

  return {
    get() {
      if (fresh()) return Promise.resolve(snapshot.cars);
      if (usable()) {
        void refresh().catch(() => {});
        return Promise.resolve(snapshot.cars);
      }
      return refresh();
    },
    refresh,
    status() {
      return {
        updatedAt: snapshot?.updatedAt ?? null,
        state: fresh() ? 'fresh' : usable() ? 'stale' : inflight ? 'warming' : 'unavailable',
        count: usable() ? snapshot.cars.length : 0,
      };
    },
  };
}

export const ramStockCache = createSpoticarCache();
export const fetchCachedRamStock = () => ramStockCache.get();
