import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBmwDriversGuideAdapter } from '../../server/vehicle-evidence/bmw-drivers-guide-provider.js';

const safeLocale = (value) => typeof value === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(value) ? value : null;
const states = new Set(['unknown', 'available', 'unavailable', 'invalid', 'source-unavailable']);
const status = (value) => states.has(value) ? value : 'unknown';
const limits = Object.freeze(['offline-injected-only', 'live-unexercised', 'provisional-pdf-mapping',
  'metadata-only-no-delivery', 'illustration-fidelity-unverified', 'transport-logging-caller-owned']);
const verificationDate = (clock = () => new Date()) => {
  try { const value = clock(); return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null; }
  catch { return null; }
};
const emptyReport = (clock) => ({ provider: 'bmw-drivers-guide', version: '1', date: verificationDate(clock),
  httpOutcome: { handbook: 'not-attempted', pdf: 'not-attempted', illustration: 'not-attempted' },
  applicationOutcome: { handbook: 'not-attempted', pdf: 'not-attempted', illustration: 'not-applicable' },
  locale: { requested: null, resolved: null }, linkStatus: 'unknown', imageStatus: 'unknown', limits: [...limits] });

/** Inject private provider dependencies; this harness never supplies a network transport. */
export async function verifyVinGuide({ request, context, dependencies } = {}) {
  const report = emptyReport(dependencies?.clock);
  if (!dependencies || typeof dependencies.transport !== 'function') return report;
  try {
    const result = await createBmwDriversGuideAdapter({ ...dependencies, content: { pdf: true, illustration: true } }).resolve(request, context);
    report.locale = { requested: safeLocale(result.requestedLocale), resolved: safeLocale(result.resolvedLocale) };
    report.httpOutcome.handbook = ['http-error', 'transport-error', 'timeout'].includes(result.failureDetail) ? 'error'
      : ['partial', 'available', 'no-guide', 'no-match', 'unsupported-locale'].includes(result.status) ? 'ok' : 'not-established';
    report.applicationOutcome.handbook = result.failureDetail === 'application-error' ? 'error'
      : ['partial', 'available'].includes(result.status) ? 'ok'
        : ['no-guide', 'no-match', 'unsupported-locale'].includes(result.status) ? 'unavailable' : 'not-established';
    report.httpOutcome.pdf = result.guide.pdf.httpOutcome; report.httpOutcome.illustration = result.illustration.httpOutcome;
    report.applicationOutcome.pdf = result.guide.pdf.applicationOutcome; report.applicationOutcome.illustration = result.illustration.applicationOutcome;
    report.linkStatus = status(result.guide.pdf.status); report.imageStatus = status(result.illustration.status);
  } catch {
    report.httpOutcome.handbook = 'not-established'; report.applicationOutcome.handbook = 'not-established';
  }
  return report;
}

/** Activation/use/retention and privately supplied authorised real input remain unapproved. */
export function runCli({ argv = [], write = (line) => process.stdout.write(line) } = {}) {
  const report = emptyReport();
  report.limits.push(argv.includes('--live') ? 'live-refused-unapproved' : 'inject-offline-dependencies-to-verify');
  write(`${JSON.stringify(report)}\n`);
  return argv.includes('--live') ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli({ argv: process.argv.slice(2) });
