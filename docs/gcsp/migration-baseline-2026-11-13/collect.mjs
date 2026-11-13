// FUCQ-434 source-only inventory. Imports route factories; never starts runtime/services.
// Run from the repository root. No network, database, browser, mail or corpus copy.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
// A clean worker tree can reuse the launcher's already installed pg package.
// Only import resolution is redirected; no connection or repository is opened.
if (process.env.GCSP_INVENTORY_PG_IMPORT) registerHooks({ resolve(specifier, context, next) {
 return next(specifier === 'pg' ? pathToFileURL(process.env.GCSP_INVENTORY_PG_IMPORT).href : specifier, context);
} });
const root = process.cwd();
const out = 'docs/gcsp/migration-baseline-2026-11-13/inventory.json';
const sha = async (path) => { const h = createHash('sha256'); for await (const b of createReadStream(resolve(root, path))) h.update(b); return h.digest('hex'); };
const walk = async (path) => { const rows = []; for (const e of await readdir(path, { withFileTypes: true })) {
  if (e.name.startsWith('.') || ['node_modules', 'test', '__pycache__'].includes(e.name)) continue;
  const p = `${path}/${e.name}`; if (e.isDirectory()) rows.push(...await walk(p)); else if (e.isFile()) rows.push(p);
} return rows; };
const digestFile = async (path) => ({ path, bytes: (await stat(path)).size, sha256: await sha(path) });
const factorySpecs = [
 ['recommendation/http.js','createEmployeeRecommendationRoutes',['FUCQ-461','FUCQ-444']],
 ['clock/http.js','createClockRoutes',['FUCQ-479','FUCQ-450']],
 ['notify/http.js','createOutboxRoutes',['FUCQ-469','FUCQ-451']],
 ['notify/delivery-email.js','createDeliveryEmailRoutes',['FUCQ-458','FUCQ-440']],
 ['scenarios/http.js','createScenarioRoutes',['FUCQ-479','FUCQ-450']],
 ['presenter-controls/http.js','createPresenterControlsRoutes',['FUCQ-479','FUCQ-450']],
 ['presenter-releases/http.js','createPresenterReleaseRoutes',['FUCQ-479','FUCQ-450']],
 ['presenter-suitability/http.js','createPresenterSuitabilityRoutes',['FUCQ-475','FUCQ-450']],
 ['brief/http.js','createBriefRoutes',['FUCQ-460','FUCQ-441']],
 ['brief/activity-http.js','createActivityRoutes',['FUCQ-464','FUCQ-444']],
 ['cases/http.js','createCaseRoutes',['FUCQ-474','FUCQ-447']],
 ['manual-context/http.js','createManualContextRoutes',['FUCQ-458','FUCQ-440','FUCQ-442']],
 ['manual-claims/http.js','createManualClaimsRoutes',['FUCQ-463','FUCQ-443']],
 ['manual-order/http.js','createManualOrderRoutes',['FUCQ-468','FUCQ-443']],
 ['manual-review/http.js','createManualReviewDetailsRoutes',['FUCQ-468','FUCQ-443']],
 ['offers/followup-http.js','createOfferFollowupRoutes',['FUCQ-466','FUCQ-445']],
 ['lifecycle/approvals/http.js','createLifecycleApprovalRoutes',['FUCQ-470','FUCQ-446']],
 ['lifecycle/documents/http.js','createDocumentRoutes',['FUCQ-471','FUCQ-446']],
 ['lifecycle/appointments/http.js','createAppointmentRoutes',['FUCQ-472','FUCQ-446']],
 ['lifecycle/return-plan/http.js','createReturnPlanRoutes',['FUCQ-473','FUCQ-446']],
 ['greg/http.js','createGregRoutes',['FUCQ-475','FUCQ-448']],
 ['comparison/http.js','createComparisonResultRoutes',['FUCQ-480','FUCQ-452']],
 ['comparison/http.js','createComparisonJobRoutes',['FUCQ-480','FUCQ-452']],
 ['supply/http.js','createSupplyRoutes',['FUCQ-462','FUCQ-478','FUCQ-449']],
 ['greg/publish/http.js','createGregPublishRoutes',['FUCQ-457','FUCQ-448']],
 ['predict/plan/http.js','createOrderPlanRoutes',['FUCQ-476','FUCQ-477','FUCQ-449']],
];
const routes = [];
for (const [suffix, name, stories] of factorySpecs) {
 const source = `server/gcsp/${suffix}`;
 const module = await import(pathToFileURL(resolve(root, source)));
 const text = await readFile(source, 'utf8');
 for (const route of module[name]()) routes.push({ method: route.method, path: route.path, role: route.role ?? 'service-enforced',
  source, line: text.split('\n').findIndex((l) => l.includes(`function ${name}`)) + 1,
  factory: name, stories, replacement: route.path.replace('/api/gcsp/', '/api/gcsp/v1/'),
  delta: ['/api/gcsp/brief/pause','/api/gcsp/brief/resume'].includes(route.path) ? 'remove legacy alias'
   : route.method === 'POST' && route.path === '/api/gcsp/comparison/jobs' ? 'Greg command only; presenter read only' : 'preserve semantic operation' });
}
const custom = [
 ['GET','/api/gcsp/context','identity/http.js','FUCQ-455','authenticated context replaces cookie'],
 ['POST','/api/gcsp/session/login','identity/http.js','FUCQ-455','replaced by real OIDC browser login'],
 ['POST','/api/gcsp/session/logout','identity/http.js','FUCQ-455','replaced by app/provider logout'],
 ['POST','/api/gcsp/session/switch','identity/http.js','FUCQ-455','removed: no impersonation'],
 ['POST','/api/gcsp/offers/access','offers/access-http.js','FUCQ-465','remove link-only cookie exchange; bearer ownership'],
 ['GET','/api/gcsp/offers/current','offers/access-http.js','FUCQ-465','owned current offer'],
 ['GET','/api/gcsp/offers/:offerId','offers/access-http.js','FUCQ-465','bearer sign-in and employee ownership'],
 ['GET','/api/gcsp/offers/:offerId/decision-reasons','offers/decision-http.js','FUCQ-466','owned current offer policy reasons'],
 ['POST','/api/gcsp/offers/:offerId/decision','offers/decision-http.js','FUCQ-466','local semantics; remote completion FUCQ-467'],
 ...['configurations','stock','vins'].map((kind) => ['GET',`/api/gcsp/vehicle-evidence/${kind}/:id`,'vehicle-evidence/vehicle-evidence-handler.js','FUCQ-459','exact evidence and synthetic identity guard']),
 ['GET','/api/gcsp/vehicle-images/:imageId.webp','vehicle-evidence/live-display-images.js','FUCQ-459','read transport/approved image projection'],
];
for (const [method,path,suffix,story,delta] of custom) routes.push({ method,path,source:`server/gcsp/${suffix}`, stories:[story],
 role:'custom-handler/service-enforced', replacement:delta.startsWith('remove') || delta.startsWith('removed') || delta.startsWith('replaced') ? null : path.replace('/api/gcsp/','/api/gcsp/v1/'), delta });
routes.sort((a,b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
const sourcePaths = (await Promise.all(['server/gcsp','server/vehicle-evidence','server/vehicles','server/recommendation','server/scenarios','blocks/gcsp','blocks/vehicle-matcher','blocks/demo-launcher','scripts/gcsp'].map(walk))).flat();
const rootFiles = (await readdir(root)).filter((p) => /^gcsp-.*\.(html|css)$/.test(p));
sourcePaths.push(...rootFiles,'server/index.js','server/engine.js','server/package.json','package.json','package-lock.json','render.yaml','render.gcsp.yaml','scripts/assemble-site.mjs','COMPONENTS.md','docs/design/high-level-design.drawio');
const sourceFiles = [];
for (const p of [...new Set(sourcePaths)].sort()) sourceFiles.push(await digestFile(p));
const evidencePaths = [
 'docs/gcsp/screens/README.md', ...((await readdir('docs/gcsp/screens')).filter((x) => /\.(png|webp)$/.test(x)).map((x) => `docs/gcsp/screens/${x}`)),
 'docs/gcsp/experience-quality.md','docs/gcsp/build-rules.md',
 'docs/gcsp/mockups/account-preferences-2026-11-10/README.md','docs/gcsp/mockups/account-preferences-2026-11-10/index.html',
 'docs/gcsp/mockups/vehicle-offer-2026-11-11/README.md','docs/gcsp/mockups/vehicle-offer-2026-11-11/index.html',
 ...await walk('docs/gcsp/mockups/offer-details-2026-11-12'),
 'docs/gcsp/evidence/offer-focused-2026-11-11/README.md','docs/gcsp/evidence/vehicle-page-style-alignment-2026-11-11/README.md',
 'docs/gcsp/models/fucq115-contract.md','docs/gcsp/models/artifacts/2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d.json',
 'docs/gcsp/models/fucq115-activation-published-command.json',
 'server/data/gcsp/comparison/process-only.json','server/data/gcsp/vehicle-evidence/display-images.sources.json',
 'server/data/gcsp/vehicle-evidence/demo-enrichment.v1/manifest.json','server/data/gcsp/vehicle-evidence/publication-reference.v1/manifest.json',
];
// Stream hashes for retained local corpus inputs/assets; do not copy or parse large files.
evidencePaths.push(...await walk('server/data/gcsp/vehicle-evidence'), ...await walk('assets/gcsp-vehicle-evidence'));
for (const dir of ['fleet-source.v1','lookup-reference.v1','demo-fleet.v1']) {
 const base = `server/data/gcsp/vehicle-evidence/${dir}`;
 evidencePaths.push(`${base}/active.json`);
 const pointer = JSON.parse(await readFile(`${base}/active.json`,'utf8'));
 for (const selection of [pointer.selected,pointer.previous].filter(Boolean)) evidencePaths.push(`${base}/versions/${selection.directory}/manifest.json`);
}
const retainedAndVisualFiles = [];
for (const p of [...new Set(evidencePaths)].sort()) retainedAndVisualFiles.push(await digestFile(p));
const releases = JSON.parse(await readFile('server/gcsp/vehicle-evidence/fleet-releases.json','utf8'));
const policy = JSON.parse(await readFile('server/gcsp/policy/seed-v1.json','utf8'));
const workloads = policy.assumptions.filter((a) => ['clock.handler.order.v1','clock.commands.v1','comparison.cohortSize','comparison.seeds','comparison.horizonDays','comparison.jobs.v1'].includes(a.key)).map(({key,value,source,basis}) => ({key,value,source,basis}));
const comparison = JSON.parse(await readFile('server/data/gcsp/comparison/process-only.json','utf8'));
const data = { story:'FUCQ-434', observedAt:'2026-11-13',
 productSourceSha:'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38', helperOnlySha:'ff7ad0c4e', claimSha:'ef21d7cb51b89293afc701784583e37e28cbbc0f',
 scope:'Read-only source inventory, not runtime/provider/visual acceptance', factories:factorySpecs.length, routes,
 sourceFiles, retainedAndVisualFiles, releaseDescriptors:releases, workloadDefaults:workloads,
 comparisonIdentity:{format:comparison.format,digest:comparison.digest,manifest:comparison.result.manifest},
 pages:rootFiles.filter((p) => p.endsWith('.html')).sort(),
 sourceAggregateSha256:createHash('sha256').update(sourceFiles.map((f) => `${f.path}\0${f.sha256}\n`).join('')).digest('hex') };
await writeFile(out,`${JSON.stringify(data,null,2)}\n`);
console.log(JSON.stringify({output:out,sourceFiles:sourceFiles.length,routes:routes.length,factories:factorySpecs.length,retainedAndVisualFiles:retainedAndVisualFiles.length,bytes:(await stat(out)).size,sourceAggregateSha256:data.sourceAggregateSha256}));
