// Actual product host and canonical account; explicit process-lifetime memory repository.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGcspDemo } from '../../../../scripts/gcsp-demo.mjs';
const OUT=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(OUT,'../../../..');
assert(process.env.TMPDIR,'Use the registered resource supervisor.');
const {chromium}=await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const deferred=()=>{let resolve;const promise=new Promise((r)=>{resolve=r;});return {promise,resolve};};
const results=[];let browser;
const api=(page,path)=>page.evaluate(async(url)=>(await fetch(url,{credentials:'same-origin',cache:'no-store'})).json(),path);
const waitStatus=(page,text)=>page.waitForFunction((value)=>document.querySelector('.gcsp-activity-status')?.textContent.trim()===value,text);
async function menu(page,label){await page.getByRole('button',{name:'Search actions',exact:true}).focus();await page.keyboard.press('ArrowDown');
  const item=page.getByRole('menuitem',{name:label,exact:true});await item.waitFor({state:'visible'});return item;}
async function capture(page,name){const overflowPx=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.equal(overflowPx,0);
  const file=`live-${name}.png`;await page.screenshot({path:join(OUT,file),fullPage:true,animations:'disabled'});
  return {file,viewport:page.viewportSize(),overflowPx,text:await page.locator('.gcsp-activity').innerText()};}
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const[size,viewport]of[['desktop',{width:1280,height:900}],['narrow-375',{width:375,height:812}]]){
    const opened=await startGcspDemo({runtime:{mode:'memory',environmentId:`fucq95-live-${size}`,policyAsOf:'2026-11-05T14:00:00.000Z',commandId:`bootstrap-${size}`}});
    assert.equal(opened.status,'ok');const app=opened.value;let context,held;
    try{
      context=await browser.newContext({viewport,reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(6000);
      const logs={errors:[],failed:[],external:[],httpErrors:[]},captures=[];
      page.on('pageerror',(e)=>logs.errors.push(String(e)));page.on('requestfailed',(r)=>logs.failed.push(r.url()));
      page.on('response',(r)=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))logs.httpErrors.push({path:new URL(r.url()).pathname,status:r.status()});});
      await page.route('**/*',(route)=>{if(route.request().url().startsWith(app.origin+'/'))return route.continue();logs.external.push(route.request().url());return route.abort();});
      await page.goto(app.origin+'/gcsp-activity-live.html');await page.getByRole('heading',{name:'No confirmed search',exact:true}).waitFor();
      assert.match(await page.locator('.gcsp-account-name').innerText(),/fictional/i);captures.push(await capture(page,`no-brief-${size}`));
      const initial=await api(page,'/api/gcsp/activity');assert.equal(initial.value.state,'no-brief');assert.equal(initial.value.permission,null);
      if(size==='narrow-375')await page.locator('.gcsp-menu-toggle').click();
      await page.getByRole('button',{name:'Your car brief',exact:true}).click();await page.waitForURL('**/gcsp-brief-live.html');
      await page.waitForFunction(()=>document.querySelector('.gcsp-brief-preview-status')?.textContent==='0 eligible cars.');
      const comfort=page.getByRole('slider',{name:'Comfort: what you prefer',exact:true});await comfort.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
      await page.waitForFunction(()=>document.querySelector('.gcsp-brief-preview-status')?.textContent==='0 eligible cars.');
      await page.getByRole('checkbox',{name:'Search for cars for me',exact:true}).click();await page.getByRole('checkbox',{name:'Hold a suitable car for me',exact:true}).click();
      await page.getByRole('button',{name:'Save this brief',exact:true}).click();
      await page.locator('.gcsp-brief-form').getByText('Brief version 1 saved. Your selected buddy permissions apply.',{exact:true}).waitFor();
      // Actual return through browser history; a restored live entry refreshes its server facts.
      await page.goBack();await waitStatus(page,'Active');const active=await api(page,'/api/gcsp/activity');
      assert.equal(active.value.briefVersion,1);assert.deepEqual([active.value.permission.canSearch,active.value.permission.canHold],[true,true]);
      assert.equal(active.value.lastSuccessfulCheck,null);assert.equal(active.value.offers.length,0);captures.push(await capture(page,`saved-active-${size}`));
      held=deferred();let pauseRequests=0;
      await page.route('**/api/gcsp/brief/pause',async(route)=>{pauseRequests++;if(held)await held.promise;await route.continue();});
      await menu(page,'Pause Search');await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.querySelector('.gcsp-activity-announcement')?.textContent==='Updating search.');
      assert.equal((await page.locator('.gcsp-activity-status').innerText()).trim(),'Active');const pending=await menu(page,'Pause Search');
      assert.equal(await pending.getAttribute('aria-disabled'),'true');await page.keyboard.press('Enter');assert.equal(pauseRequests,1);
      const bounds=await page.getByRole('menu',{name:'Search actions',exact:true}).boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=viewport.width);
      captures.push(await capture(page,`pending-${size}`));held.resolve();held=null;await waitStatus(page,'Inactive');
      assert.equal((await api(page,'/api/gcsp/activity')).value.briefVersion,2);captures.push(await capture(page,`paused-${size}`));
      await page.reload();await waitStatus(page,'Inactive');await menu(page,'Resume Search');await page.keyboard.press('Enter');await waitStatus(page,'Active');
      assert.equal((await api(page,'/api/gcsp/activity')).value.briefVersion,3);
      const outside=await page.evaluate(async()=>{const response=await fetch('/api/gcsp/brief/pause',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({commandId:crypto.randomUUID(),expectedBriefVersion:3})});return response.json();});assert.equal(outside.status,'ok');
      await menu(page,'Pause Search');await page.keyboard.press('Enter');await waitStatus(page,'Inactive');assert.match(await page.locator('.gcsp-activity-announcement').textContent(),/changed/);
      assert.equal((await api(page,'/api/gcsp/activity')).value.briefVersion,4);
      let fail=true;await page.route('**/api/gcsp/activity',(route)=>{if(!fail)return route.continue();fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({status:'unavailable'})});});
      await page.reload();await page.getByRole('heading',{name:'Activity unavailable',exact:true}).waitFor();assert.equal(await page.locator('.gcsp-activity-status,.gcsp-action-trigger').count(),0);
      captures.push(await capture(page,`unavailable-${size}`));await page.getByRole('button',{name:'Retry',exact:true}).focus();await page.keyboard.press('Enter');await waitStatus(page,'Inactive');
      assert.equal(await page.getByRole('button',{name:'Search actions',exact:true}).evaluate((n)=>n===document.activeElement),true);
      assert.deepEqual(logs.errors,[]);assert.deepEqual(logs.failed,[]);assert.deepEqual(logs.external,[]);
      assert.deepEqual(logs.httpErrors,[{path:'/api/gcsp/brief/pause',status:409},{path:'/api/gcsp/activity',status:503}]);
      results.push({size,viewport,captures,...logs,briefVersion:4,canonicalAccount:true,mode:'explicit memory',
        proof:['actual activity HTML bootstraps trusted canonical account','Brief navigation and actual saved consent','browser Back/reload currentness','pending duplicate suppression','real pause/resume and stale-version fresh read','failed read clears stale controls and keyboard Retry recovers'],
        remaining:['real search/check/no-match/source-delay receipts absent','current offer/access/lifecycle producers absent','memory state is process lifetime; PostgreSQL remains separate capability']});
    }finally{held?.resolve();await context?.close();await app.close();}
  }
}finally{await browser?.close();}
const sourceIdentity={};for(const path of['gcsp-activity-live.html','blocks/gcsp/activity/live.js','blocks/gcsp/activity/gcsp-activity.js','blocks/gcsp/activity/activity-controller.js','blocks/gcsp/activity/activity-http.js',
  'blocks/gcsp/activity/activity-body.js','blocks/gcsp/shell/account-runtime.js','blocks/gcsp/brief/runtime.js','scripts/gcsp-demo.mjs','server/gcsp/runtime.js','server/index.js']){
  sourceIdentity[path]=createHash('sha256').update(await readFile(join(ROOT,path))).digest('hex');}
await writeFile(join(OUT,'live-render-matrix.json'),JSON.stringify({scope:'actual same-origin product runtime and activity/Brief consumer; explicit memory mode',headless:true,isolated:true,sourceIdentity,results},null,2)+'\n');
console.log(JSON.stringify({widths:results.length,captures:results.reduce((n,r)=>n+r.captures.length,0),issues:[]}));
