import { createHash, timingSafeEqual } from 'node:crypto';
import { ok, result } from '../repository/index.js';

const digest = (value) => createHash('sha256').update(value).digest();
const emailPart = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const words = (value) => typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : [];

// Existing full names win. Older first-name-only records adopt their configured
// surname; a stable fictional surname also covers newly configured single names.
export function demoLoginProfile(principal, stored = {}) {
  const existing = words(stored.name);
  const configured = words(principal.name);
  const name = existing.length > 1 ? existing : configured;
  const firstName = stored.firstName || name[0];
  const lastName = stored.lastName || (name.length > 1 ? name.slice(1).join(' ') : 'Taylor');
  return { firstName, lastName, name: `${firstName} ${lastName}`,
    email: `${emailPart(firstName)}.${emailPart(lastName)}@gcsp-demo.com` };
}

// Login port: authenticate(credentials, { principals }) -> Result<{principalId}>.
// A future BMW sign-on adapter supplies only the stable subject. The application
// resolves employee, scheme and roles itself and never trusts adapter role claims.
export class DemoLoginAdapter {
  async authenticate({ email, password }, { principals }) {
    const passwordMatches = timingSafeEqual(digest(password), digest('fucq'));
    const principal = principals.find((person) => person.email === email && !person.roles.includes('presenter'));
    return passwordMatches && principal ? ok({ principalId: principal.principalId })
      : result('invalid-credentials', { reason: 'Email or password did not match.' });
  }
}
