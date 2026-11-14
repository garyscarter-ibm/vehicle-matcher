// ESM loader hook for order-plan-service-parity.mjs: records each value the plain expressed-forecast provider returns, so Java can replay it.
export async function load(url, context, next) {
  const out = await next(url, context);
  if (!url.endsWith('/gcsp/predict/plan/forecast.js')) return out;
  const source = String(out.source).replace('export function createExpressedOrderForecastProvider(', 'function innerForecastProvider(')
    + `\nexport function createExpressedOrderForecastProvider(args) {
  const inner = innerForecastProvider(args);
  return Object.freeze({ async readForecast(context, read) {
    const result = await inner.readForecast(context, read);
    if (!args?.predictionContext) (globalThis.__forecastSpy ??= []).push({ read: structuredClone(read), out: structuredClone(result) });
    return result;
  } });
}\n`;
  return { ...out, source };
}
