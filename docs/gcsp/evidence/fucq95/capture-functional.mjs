// Test host only: injected synthetic account, real repository/identity/BriefService/activity HTTP.
// Product runtime and server composition belong to FUCQ-94. Isolated headless Chrome only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActivityClientRuntime } from '../../../../server/test/helpers/activity-client-runtime.js';
const OUT=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(OUT,'../../../..');
const {chromium}=await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const sources=['blocks/gcsp/activity/activity-controller.js','blocks/gcsp/activity/activity-http.js','blocks/gcsp/activity/gcsp-activity.js','blocks/gcsp/activity/activity-body.js',
  'blocks/gcsp/activity/activity-offer.js','blocks/gcsp/activity/gcsp-activity.css','blocks/gcsp/employee/gcsp-employee.js','blocks/gcsp/kit/action-menu.js',
  'server/gcsp/brief/activity.js','server/gcsp/brief/activity-http.js','server/gcsp/brief/index.js','server/index.js','server/test/helpers/activity-client-runtime.js'];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const html='<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity functional proof</title>'
  +'<link rel="stylesheet" href="/blocks/vehicle-matcher/vehicle-matcher.css"><link rel="stylesheet" href="/blocks/gcsp/shell/gcsp-shell.css">'
  +'<link rel="stylesheet" href="/blocks/gcsp/activity/gcsp-activity.css"><link rel="stylesheet" href="/gcsp-employee.css">'
  +'<body><div id="proof"></div><script type="module" src="/__proof/entry.js"></script></body></html>';
const entry="import { mountActivity } from '/blocks/gcsp/activity/gcsp-activity.js';\nimport { createActivityHttpAdapter } from '/blocks/gcsp/activity/activity-http.js';\n"
  +"const adapter=createActivityHttpAdapter({loadAccount:async ({signal})=>(await fetch('/__proof/account',{credentials:'same-origin',cache:'no-store',signal})).json()});\n"
  +"globalThis.activityProof=mountActivity(document.getElementById('proof'),{adapter});\n";
const deferred=()=>{let resolve;const promise=new Promise((r)=>{resolve=r;});return {promise,resolve};};
const status=(page)=>page.locator('.gcsp-activity-status');
const notice=(page)=>page.locator('.gcsp-activity-announcement');
async function waitStatus(page,text){await page.waitForFunction((value)=>document.querySelector('.gcsp-activity-status')?.textContent.trim()===value,text);}
async function menu(page,label){const trigger=page.getByRole('button',{name:'Search actions',exact:true});await trigger.focus();await page.keyboard.press('ArrowDown');
  const item=page.getByRole('menuitem',{name:label,exact:true});await item.waitFor({state:'visible'});
  const bounds=await page.getByRole('menu',{name:'Search actions',exact:true}).boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=page.viewportSize().width);
  assert.equal(await item.evaluate((node)=>document.activeElement===node),true);return item;}
async function capture(page,name){await page.evaluate(()=>Promise.all(document.getAnimations().filter((a)=>a.effect?.getTiming().iterations!==Infinity).map((a)=>a.finished.catch(()=>{}))));
  const facts=await page.locator('.gcsp-activity').evaluate((root)=>({text:root.innerText,overflowPx:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    headings:[...root.querySelectorAll('h1,h2')].map((n)=>n.textContent),datedEvents:root.querySelectorAll('.gcsp-timeline-event').length,
    images:root.querySelectorAll('img').length,animations:[root,...root.querySelectorAll('*')].filter((n)=>getComputedStyle(n).animationName!=='none').length}));
  assert.equal(facts.overflowPx,0);assert.equal(facts.animations,0);assert.equal(facts.images,0);
  const file=`functional-${name}.png`;await page.screenshot({path:join(OUT,file),fullPage:true});return {file,...facts};}
let browser;const results=[];const prior=process.env.DEMO_ACCESS_KEY;process.env.DEMO_ACCESS_KEY='';
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const [size,viewport]of [['desktop',{width:1280,height:900}],['narrow-375',{width:375,height:812}]]){
    const runtime=await createActivityClientRuntime();let api,base,hold,failRead=false;const requests=[];let context;
    const host=createServer(async(req,res)=>{
      try{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
        if(name==='/__proof/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
        if(name==='/__proof/entry.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(entry);return;}
        if(name==='/__proof/account'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(runtime.account));return;}
        if(name.startsWith('/api/gcsp/')){
          requests.push({method:req.method,path:name});
          if(req.method==='POST'&&hold)await hold.promise;
          if(name==='/api/gcsp/activity'&&failRead){failRead=false;res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'unavailable'}));return;}
          api.emit('request',req,res);return;
        }
        const path=resolve(ROOT,`.${decodeURIComponent(name)}`);if(!path.startsWith(ROOT+sep))throw new Error('Outside root');
        res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
      }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
    });
    try{
      await new Promise((done)=>host.listen(0,'127.0.0.1',done));base=`http://127.0.0.1:${host.address().port}`;api=runtime.server({origin:base});
      context=await browser.newContext({viewport,reducedMotion:'reduce'});
      await context.addCookies(runtime.cookie.split('; ').map((part)=>{const at=part.indexOf('=');return {name:part.slice(0,at),value:part.slice(at+1),url:base,httpOnly:true,sameSite:'Lax'};}));
      const page=await context.newPage(),logs={console:[],failedRequests:[],external:[],responses:[]};
      page.on('console',(m)=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))logs.console.push(m.text());});page.on('pageerror',(e)=>logs.console.push(String(e)));
      page.on('requestfailed',(r)=>logs.failedRequests.push(r.url()));page.on('response',(r)=>{if(r.status()>=400)logs.responses.push({status:r.status(),path:new URL(r.url()).pathname});});
      await page.route('**/*',(route)=>{if(route.request().url().startsWith(base))return route.continue();logs.external.push(route.request().url());return route.abort();});
      await page.goto(base+'/__proof/');await page.getByRole('heading',{name:'No confirmed search',exact:true}).waitFor();const captures=[];
      captures.push(await capture(page,`no-brief-${size}`));assert.equal(await page.locator('.gcsp-action-trigger').count(),0);
      await runtime.confirm();await page.evaluate(()=>activityProof.refresh());await waitStatus(page,'Active');captures.push(await capture(page,`active-${size}`));
      assert.match(await page.locator('.gcsp-activity').innerText(),/Last successful check: unavailable/);
      hold=deferred();await menu(page,'Pause Search');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.gcsp-activity-announcement')?.textContent==='Updating search.');
      assert.equal((await status(page).innerText()).trim(),'Active');const pending=await menu(page,'Pause Search');assert.equal(await pending.getAttribute('aria-disabled'),'true');await page.keyboard.press('Enter');
      assert.equal(requests.filter((r)=>r.method==='POST').length,1);captures.push(await capture(page,`pending-${size}`));hold.resolve();hold=null;await waitStatus(page,'Inactive');
      assert.equal((await runtime.activity.readActivity(runtime.context)).value.briefVersion,2);assert.match(await notice(page).textContent(),/paused/);
      assert.equal(await page.getByRole('button',{name:'Search actions',exact:true}).evaluate((n)=>n===document.activeElement),true);captures.push(await capture(page,`paused-${size}`));
      await page.reload();await waitStatus(page,'Inactive');await menu(page,'Resume Search');await page.keyboard.press('Enter');await waitStatus(page,'Active');
      assert.equal((await runtime.activity.readActivity(runtime.context)).value.briefVersion,3);
      assert.equal((await runtime.brief.pause(runtime.context,{commandId:`outside-${size}`,expectedBriefVersion:3})).status,'ok');
      await menu(page,'Pause Search');await page.keyboard.press('Enter');await waitStatus(page,'Inactive');assert.match(await notice(page).textContent(),/changed/);
      assert.equal((await runtime.activity.readActivity(runtime.context)).value.briefVersion,4);
      failRead=true;await page.evaluate(()=>activityProof.refresh());await page.getByRole('heading',{name:'Activity unavailable',exact:true}).waitFor();
      assert.equal(await page.locator('.gcsp-activity-status,.gcsp-action-trigger,.gcsp-activity img').count(),0);captures.push(await capture(page,`unavailable-${size}`));
      await page.getByRole('button',{name:'Retry',exact:true}).focus();await page.keyboard.press('Enter');await waitStatus(page,'Inactive');
      assert.equal(await page.getByRole('button',{name:'Search actions',exact:true}).evaluate((n)=>n===document.activeElement),true);
      const before=JSON.stringify(runtime.store.state);await page.evaluate(()=>activityProof.refresh());assert.equal(JSON.stringify(runtime.store.state),before);
      const current=(await runtime.clock.readState(runtime.presenter.context)).value;
      assert.equal((await runtime.clock.reset(runtime.presenter.context,{commandId:`reset-${size}`,expectedRunId:current.runId,expectedRunVersion:current.runVersion,
        scenarioVersion:current.versions.scenario,fixtureVersion:current.versions.fixture})).status,'ok');
      await page.evaluate(()=>activityProof.refresh());await page.getByRole('heading',{name:'Activity unavailable',exact:true}).waitFor();assert.equal(await status(page).count(),0);
      assert.equal(logs.console.length,0);assert.equal(logs.failedRequests.length,0);assert.equal(logs.external.length,0);
      assert.deepEqual(logs.responses.map((r)=>r.status),[409,503,409]);
      results.push({size,viewport,captures,requests,...logs,proof:'real pause/resume/reload/stale-version/failure/retry/nonmutating-read/reset; synthetic trusted test account'});
    }finally{hold?.resolve();await context?.close();host.closeAllConnections();await new Promise((done)=>host.close(done));await runtime.close();}
  }
}finally{await browser?.close();if(prior===undefined)delete process.env.DEMO_ACCESS_KEY;else process.env.DEMO_ACCESS_KEY=prior;}
const sourceIdentity=Object.fromEntries(await Promise.all(sources.map(async(name)=>[name,createHash('sha256').update(await readFile(join(ROOT,name))).digest('hex')])));
await writeFile(join(OUT,'functional-render-matrix.json'),JSON.stringify({headless:true,isolated:true,scope:'activity consumer, real HTTP and BriefService commands; no integrated search or allocation producer',sourceIdentity,results},null,2)+'\n');
console.log(JSON.stringify({widths:results.length,captures:results.reduce((n,r)=>n+r.captures.length,0),issues:[]}));
