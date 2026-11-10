import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const root='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004';
const cleanups=[];const report={cases:[]};let browser;
const {createLocalHttpsFixture}=await import(pathToFileURL(resolve(root,'server/test/helpers/local-https.js')).href);
const tls=await createLocalHttpsFixture({after:fn=>cleanups.push(fn)});
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer({key:await readFile(tls.configuration.keyFile),cert:await readFile(tls.configuration.certFile)},async(req,res)=>{try{const pathname=new URL(req.url,'https://localhost').pathname;const file=resolve(root,'.'+pathname);if(!file.startsWith(root+'/'))throw Error();res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
try{
 await new Promise(r=>server.listen(0,'localhost',r));const origin=`https://localhost:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const serviceWorkers of ['block','allow']){
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers});const result={serviceWorkers,errors:[]};
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push({message:e.message,stack:e.stack}));await page.goto(origin+'/components.html');
  await page.getByRole('heading',{name:'mediaWell: selected review image and missing-photo frame',exact:true}).waitFor();
  result.sandboxFrames=await page.locator('iframe[sandbox=""]').count();result.serviceWorkers=serviceWorkers;
  await page.waitForTimeout(200);report.cases.push(result);await context.close();
 }
 assert.ok(report.cases[0].errors.every(e=>e.message.includes("'serviceWorker'")));
 assert.ok(report.cases[0].errors.length>0);assert.deepEqual(report.cases[1].errors,[]);
 report.status='verified';
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));for(const clean of cleanups.reverse())await clean();await writeFile('/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-gallery-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
