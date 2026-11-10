import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const pg = '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules/pg/lib/index.js';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'pg' ? { url: pathToFileURL(pg).href, shortCircuit: true } : nextResolve(specifier, context);
} });
