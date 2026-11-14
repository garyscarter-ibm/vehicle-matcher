// Stub 'pg' for in-memory Node baseline runs only; never used against a database.
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'pg') return { url: 'data:text/javascript,export default {}; export const Pool = class {};', shortCircuit: true }; return n(s, c); }`));
