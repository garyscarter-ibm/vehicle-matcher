import { CapturedTransport } from './captured.js';
import { BrevoMailTransport } from './brevo.js';

// Only trusted backend composition supplies options; browser input never selects a transport.
export function createMailTransport({ repository, env = process.env, fetchImpl, wallNow, timeoutMs } = {}) {
  if (!env.GCSP_MAIL_TRANSPORT) return new CapturedTransport({ repository });
  let recipients;
  try { recipients = JSON.parse(env.GCSP_MAIL_RECIPIENTS); } catch { /* Invalid settings become a captured, safe refusal. */ }
  return new BrevoMailTransport({ repository, apiKey: env.GCSP_BREVO_API_KEY,
    sender: { email: env.GCSP_MAIL_FROM, name: env.GCSP_MAIL_FROM_NAME }, recipients,
    publicBaseUrl: env.GCSP_PUBLIC_BASE_URL, configurationValid: env.GCSP_MAIL_TRANSPORT === 'brevo',
    ...(fetchImpl ? { fetchImpl } : {}), ...(wallNow ? { wallNow } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
}
