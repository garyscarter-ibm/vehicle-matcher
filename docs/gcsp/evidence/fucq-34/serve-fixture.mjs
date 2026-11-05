import { buildServer } from '../../../../server/index.js';
import { bmwPool, miniPool, fordPool, hondaPool, motorradPool, ferrariPool } from '../../../../server/test/helpers.js';

const sources = { bmw: bmwPool(12), mini: miniPool(8), ford: fordPool(12), honda: hondaPool(12), motorrad: motorradPool(12), ferrari: ferrariPool(12) };
const pools = Object.fromEntries(Object.entries(sources).map(([brand, cars]) => [brand, cars.map((car) => ({ ...car, photo: null }))]));
process.env.DEMO_ACCESS_KEY = '';
const server = buildServer({
  fetchRetailerStock: async (brand) => pools[brand] || pools.bmw,
  fetchNearbyStock: async () => [],
  enrichColours: async (_brand, cars) => cars,
  fetchDealerDirectory: async () => new Map(),
  geocodePostcode: async () => null,
});
server.listen(8787, '127.0.0.1', () => console.log('FUCQ-34 synthetic fixture API: http://127.0.0.1:8787'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
});
