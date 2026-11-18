import { ramStockCache } from '../server/spoticar-cache.js';

try {
  const cars = await (process.argv.includes('--refresh') ? ramStockCache.refresh() : ramStockCache.get());
  console.log(JSON.stringify({ programme: 'Spoticar RAM CPO', ...ramStockCache.status(), trucks: cars.length }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
