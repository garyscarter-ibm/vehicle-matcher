import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs/gcsp/evidence/fucq35/browser');
const chunk = process.argv[2] || 'flow';
const width = Number(process.argv[3] || 1280);
assert.ok(process.env.TMPDIR, 'Owned scratch required');
const { chromium } = await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const { createGcspRuntime } = await import(pathToFileURL(path.join(ROOT, 'server/gcsp/runtime.js')));
const { buildServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')));
const key = randomUUID(); process.env.DEMO_ACCESS_KEY = key;
let now = '2026-11-05T09:00:00.000Z';
const opened = await createGcspRuntime({ mode:'memory', environmentId:`fucq35-${chunk}-${width}`, policyAsOf:now, commandId:'fucq35-bootstrap', sessionNow:()=>now });
assert.equal(opened.status, 'ok'); const runtime = opened.value;
const issued = await runtime.createLocalSession(); assert.equal(issued.status, 'ok');
let browser, api, origin, outage = false, moduleFailure = false, disabled = false;
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async()=>{await browser?.close().catch(()=>{});server.closeAllConnections();await runtime.close();process.exit(143)});
const report = { story:'FUCQ-35', chunk, width, runtime:'actual memory repository, PolicyService, identity, manual service, HTTP and delivered account/setup journey', checks:[], api:[], pageErrors:[], screenshots:[], external:[], cleanup:{} };
const mime = (file) => ({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream';
const server = createServer(async (req,res)=>{
 const url = new URL(req.url, origin || 'http://127.0.0.1');
 if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url.pathname==='/fucq35-shell-proof'){res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html><head><link rel="stylesheet" href="/blocks/gcsp/shell/gcsp-shell.css"></head><body style="margin:0"><script type="module">import {portalShell} from '/blocks/gcsp/shell/portal-shell.js';const shell=portalShell();const heading=document.createElement('h1');heading.textContent='Standalone shell proof';shell.main.append(heading);document.body.append(shell.root);</script></body></html>`);return;}
 if(url.pathname.startsWith('/api/')){api.emit('request',req,res);return;}
 if(moduleFailure && url.pathname==='/blocks/gcsp/manual-setup/journey.js'){res.writeHead(503).end();return;}
 const absolute=path.resolve(ROOT, '.'+url.pathname);
 if(!absolute.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
 try {let bytes=await readFile(absolute);
  if(disabled && url.pathname==='/blocks/demo-launcher/demo-launcher.js')bytes=Buffer.from(bytes.toString().replace('createEmployeeCapability()', 'createEmployeeCapability({ enabled: false })'));
  res.writeHead(200,{'Content-Type':mime(absolute),'Cache-Control':'no-store'}).end(bytes);
 }catch{res.writeHead(404).end();}
});
try {
 await mkdir(OUT,{recursive:true});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});
 origin=`http://127.0.0.1:${server.address().port}`;
 const manual=new Proxy(runtime.account,{get(target,name){if(name==='readAccount' && outage)return async()=>({status:'unavailable',retryable:true});const value=target[name];return typeof value==='function'?value.bind(target):value;}});
 const denied=async()=>{throw Error('Unrelated provider unavailable in isolated launcher proof')};
 api=buildServer({...runtime.dependencies,gcspManual:manual,gcspAllowedOrigins:[origin],fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied});
 await api.gcspStartup;
 browser=await chromium.launchPersistentContext(path.join(process.env.TMPDIR,'browser-profile'),{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,viewport:{width,height:900},args:['--no-sandbox','--disable-background-networking','--disable-sync','--no-first-run','--renderer-process-limit=1',`--disk-cache-dir=${path.join(process.env.TMPDIR,'cache')}`]});
 const raw=issued.value.setCookie[1].split(';',1)[0];const split=raw.indexOf('=');
 await browser.addCookies([{name:raw.slice(0,split),value:raw.slice(split+1),domain:'127.0.0.1',path:'/api/gcsp',httpOnly:true,sameSite:'Lax',secure:false}]);
 await browser.addInitScript(value=>sessionStorage.setItem('vmAccessKey',value),key);
 const page=browser.pages()[0] || await browser.newPage();page.setDefaultTimeout(10000);
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin || ['data:','blob:'].includes(url.protocol))return route.continue();report.external.push(url.hostname+url.pathname);return route.abort();});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 const apiTasks=[];page.on('response',res=>{const url=new URL(res.url());if(url.pathname.startsWith('/api/gcsp/')){const record={path:url.pathname,method:res.request().method(),status:res.status()};report.api.push(record);apiTasks.push(res.json().then(body=>{record.envelopeStatus=body.status || body.error}).catch(()=>{}));}});
 const url=(experience,brand='bmw')=>`${origin}/index.html?experience=${experience}&brand=${brand}&api=${encodeURIComponent(origin)}`;
 const employee=url('employee-cars');
 const capture=async(name)=>{const file=`${chunk}-${width}-${name}.png`;await page.screenshot({path:path.join(OUT,file),fullPage:true,animations:'disabled'});report.screenshots.push(file);};
 const ready=async()=>{await page.getByRole('heading',{name:'Your cars',exact:true}).waitFor();assert.equal(await page.locator('gcsp-employee-entry').count(),1);assert.equal(await page.locator('.gcsp-header').count(),1);await page.waitForFunction(()=>document.activeElement?.tagName==='H1');};
 const skipProof=async(label)=>{const skip=page.locator('.gcsp-skip');assert.equal(await skip.evaluate(el=>getComputedStyle(el).clipPath),'inset(50%)',label+' skip clipped while unfocused');await skip.focus();assert.equal(await skip.evaluate(el=>getComputedStyle(el).clipPath),'none',label+' skip revealed when focused');await capture(label+'-skip-focused');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'MAIN');assert.equal(await skip.evaluate(el=>getComputedStyle(el).clipPath),'inset(50%)');report.checks.push(label+' skip hidden before focus, keyboard-visible and enters main');};
 const recovery=()=>page.getByRole('navigation',{name:'Car experiences'});
 if(chunk==='flow'){
  await page.goto(url('launcher'));await page.getByRole('link',{name:'Explore Employee cars',exact:true}).click();await ready();
  assert.ok(report.api.some(r=>r.path.endsWith('/account')&&r.status===200));report.checks.push('launcher reaches real account over authorised HTTP');
  await capture('account');await skipProof('embedded');
  await page.reload();await ready();report.checks.push('refresh retains one real entry');
  await recovery().getByRole('link',{name:'Car experiences',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.demo-launcher').waitFor();
  await page.goBack();await ready();report.checks.push('keyboard return and browser Back reach same entry');
  await page.goto(employee);await ready();
  await page.getByRole('button',{name:'Choose a replacement',exact:true}).first().click();await page.getByRole('heading',{name:'Your order choices',exact:true}).waitFor();
  assert.ok(report.api.some(r=>r.path.endsWith('/draft')&&r.method==='POST'&&r.status===200));report.checks.push('actual account save continues into delivered manual setup');
  await capture('setup');
  assert.ok(await recovery().getByRole('link',{name:'Used cars',exact:true}).isVisible());
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'No horizontal page overflow');report.checks.push('desktop/narrow shell and recovery controls fit viewport');
  for(const href of await recovery().locator('a').evaluateAll(nodes=>nodes.map(n=>n.href)))assert.doesNotMatch(href,/key=|employeeId|role=/);
  await page.goto(origin+'/fucq35-shell-proof');await page.getByRole('heading',{name:'Standalone shell proof',exact:true}).waitFor();await skipProof('standalone');await capture('standalone');
 } else if(chunk==='recovery'){
  moduleFailure=true;await page.goto(employee);await page.getByRole('heading',{name:'Employee cars could not open',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Employee cars could not open');await capture('module-error');
  moduleFailure=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await ready();report.checks.push('module failure is focused and Retry reaches actual account');
  outage=true;await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.getByRole('heading',{name:'Your account is unavailable',exact:true}).waitFor();
  assert.ok(await recovery().isVisible());await capture('provider-unavailable');outage=false;await page.getByRole('button',{name:'Refresh account',exact:true}).click();await ready();report.checks.push('actual provider unavailable recovers');
  await page.evaluate(()=>sessionStorage.setItem('vmAccessKey','rejected-synthetic-password'));await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.locator('.vm-gate-input').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.type),'password');const leave=page.locator('.vm-gate').getByRole('navigation',{name:'Leave employee cars',exact:true});const usedCars=leave.getByRole('link',{name:'Used cars',exact:true});assert.ok(await usedCars.isVisible());assert.equal(await usedCars.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);await capture('rejected-gate');
  await page.locator('.vm-gate-input').fill(key);await page.getByRole('button',{name:'Enter',exact:true}).click();await ready();report.checks.push('actual rejected demo gate recovers without losing navigation');
  await page.evaluate(()=>sessionStorage.setItem('vmAccessKey','rejected-synthetic-password'));await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.locator('.vm-gate-input').waitFor();await page.locator('.vm-gate').getByRole('link',{name:'Used cars',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.vehicle-matcher').waitFor();await page.goto(employee);await ready();report.checks.push('keyboard leaves rejected gate through visible Used cars recovery and returns');
  now='2026-11-07T09:00:00.000Z';await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.getByRole('heading',{name:'Your account is unavailable',exact:true}).waitFor();assert.equal(await page.locator('.vm-gate').count(),0);await Promise.allSettled(apiTasks);assert.ok(report.api.some(r=>r.envelopeStatus==='expired-session'));report.checks.push('actual expired employee session stays distinct from shared demo password');
  await page.goto(url('employee-cars','mini'));await page.getByRole('button',{name:'Choose BMW',exact:true}).waitFor();assert.equal(await page.locator('gcsp-employee-entry').count(),0);await capture('unsupported-brand');report.checks.push('unsupported employee brand shows explicit BMW and Used cars recovery');
 } else if(chunk==='disabled'){
  disabled=true;await page.goto(employee);await page.getByRole('button',{name:'Employee cars unavailable',exact:true}).waitFor();assert.equal(await page.locator('gcsp-employee-entry').count(),0);await capture('disabled');
  const modules=[],sharedAssets=[];page.on('request',req=>{const pathname=new URL(req.url()).pathname;if(pathname.startsWith('/blocks/gcsp/')){sharedAssets.push(pathname);if(pathname.endsWith('.js'))modules.push(pathname)}});
  await page.goto(`${origin}/index.html?brand=ford&api=${encodeURIComponent(origin)}`);await page.locator('.vehicle-matcher').waitFor();assert.equal(await page.locator('gcsp-employee-entry').count(),0);report.employeeModules=modules;report.sharedStyleAssets=sharedAssets;assert.equal(modules.length,0);await capture('retail');report.checks.push('disabled employee route and legacy retail stay usable without employee modules');
 }else throw Error('Unknown chunk');
 await Promise.allSettled(apiTasks);report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally {
 if(browser){await browser.close();report.cleanup.browserClosed=true;}
 await new Promise(done=>{server.close(done);server.closeAllConnections()});report.cleanup.listenerClosed=true;
 api?.closeAllConnections();await runtime.close();report.cleanup.runtimeClosed=true;
 await mkdir(OUT,{recursive:true});await writeFile(path.join(OUT,`${chunk}-${width}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,chunk,width,checks:report.checks,error:report.error,cleanup:report.cleanup}));
}
