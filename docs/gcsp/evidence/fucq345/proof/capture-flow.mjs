import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {readFile,writeFile,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const ROOT='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004';
const RETAIN='/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110';
const OUTPUT=join(ROOT,'docs/gcsp/evidence/fucq345/flow-corrected');
const load=p=>import(pathToFileURL(join(ROOT,p)).href);
const hash=b=>createHash('sha256').update(b).digest('hex');
const cleanups=[]; const after=fn=>cleanups.push(fn);
const report={task:'FUCQ-345',base:'23ce581b',sourceCommit:'e81db95ae0198679f7d4daf08a2132ca3a3c942d',runtime:'actual-memory',imageSource:'verified retained assets; live source evidence disabled',screenshots:[],geometry:[],identities:[],errors:[],sourcePins:{}};
let services,backend,server,browser,page,phase='baseline';
const baseline=await readFile(process.env.FUCQ345_BASELINE_CSS,'utf8');
const good=(out,label='service')=>{assert.equal(out?.status,'ok',`${label}:${out?.status}:${out?.code||''}`);return out.value;};
const route=out=>{assert.equal(out.status,200,JSON.stringify(out.json));return good(out.json);};
const [{offlineEgressGuard},{createGcspRuntime},{buildServer},{createRunStockProviderFactory},{createLiveDisplayImageHandler},{createLocalHttpsFixture},{createRouteClient,presenterTick,resetIntoScenario}]=await Promise.all([
  load('server/test/helpers/offline-egress-guard.js'),load('server/gcsp/runtime.js'),load('server/index.js'),load('server/gcsp/stock/index.js'),load('server/gcsp/vehicle-evidence/live-display-images.js'),load('server/test/helpers/local-https.js'),load('server/test/helpers/gcsp-decline-change-route.js')]);
const guard=offlineEgressGuard({after});
const profile=await mkdtemp(join(process.env.TMPDIR,'fucq345-chrome-'));
await mkdir(OUTPUT,{recursive:true});
for(const path of ['blocks/gcsp/kit/vehicle-media.css','blocks/gcsp/kit/gcsp-kit.css','blocks/gcsp/shell/gcsp-shell.css','blocks/gcsp/shell/gcsp-tokens.css','blocks/vehicle-matcher/vehicle-matcher.css','blocks/vehicle-matcher/decision-card.css','blocks/vehicle-matcher/component-gallery.css','blocks/gcsp/manual-summary/manual-summary.css','blocks/gcsp/manual-review/manual-review.css','blocks/vehicle-matcher/modes/result-card.js','blocks/vehicle-matcher/component-gallery.js','server/test/gcsp-manual-review-render.test.js','server/gcsp/runtime.js'])report.sourcePins[path]=hash(await readFile(join(ROOT,path)));
report.sourcePins.baselineCss=hash(baseline);report.captureScriptSha256=hash(await readFile('/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-flow-browser.mjs'));
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
async function capture(name,target){
  if(target)await target.scrollIntoViewIfNeeded();
  await page.evaluate(async()=>{await document.fonts.ready;const until=Date.now()+5000;while([...document.images].some(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&!i.complete;})&&Date.now()<until)await new Promise(r=>setTimeout(r,50));});
  const bytes=await page.screenshot({type:'jpeg',quality:78,fullPage:false,animations:'disabled'});
  const file=`${name}-${page.viewportSize().width}.jpg`;await writeFile(join(OUTPUT,file),bytes);
  report.screenshots.push({file,sha256:hash(bytes),bytes:bytes.length});
}
async function geometry(name,selector='.gcsp-review-vehicle .vm-card-media'){
 const node=typeof selector==='string'?page.locator(selector).first():selector;const data=await node.evaluate(media=>{
   const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const tag=media.querySelector('.vm-card-line'),caption=media.querySelector('.vm-media-caption'),photo=media.querySelector('img'),placeholder=media.querySelector('.vm-card-soon');
   const overlap=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)):0;
   const t=rect(tag),c=rect(caption),p=rect(photo),m=rect(media),h=rect(placeholder);
   return {media:m,tag:t,caption:c,photo:p,overlap:overlap(t,c),tagPhotoOverlap:overlap(t,p),tagPlaceholderOverlap:overlap(t,h),line:tag.textContent,tagDisplay:getComputedStyle(tag).display,captionPosition:caption?getComputedStyle(caption).position:null,objectFit:photo?getComputedStyle(photo).objectFit:null,photoReady:photo?photo.complete&&photo.naturalWidth>0:null,placeholder:rect(placeholder),placeholderDisplay:getComputedStyle(placeholder).display,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
 });report.geometry.push({name,phase,...data});return data;
}
async function openReview(origin,width){
 await page.setViewportSize({width,height:900});await page.goto(origin+'/gcsp-account.html');
 await page.getByRole('button',{name:'Resume saved journey',exact:true}).click();
 await page.locator('.gcsp-review-vehicle img').waitFor();await page.locator('.gcsp-review-vehicle').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const i=document.querySelector('.gcsp-review-vehicle img');return i?.complete&&i.naturalWidth>0;});
}
async function syncCookies(client,origin){await browser.clearCookies();await browser.addCookies(client.cookie().split('; ').filter(Boolean).map(part=>{const at=part.indexOf('=');return {name:part.slice(0,at),value:part.slice(at+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax'};}));}
try{
 const tls=await createLocalHttpsFixture({after});
 const stock=createRunStockProviderFactory({env:{GCSP_STOCK_SOURCE:'demo'},logger:()=>{}});
 services=good(await createGcspRuntime({mode:'memory',environmentId:'fucq345-owned',commandId:'fucq345-bootstrap',policyAsOf:'2026-11-05T09:00:00.000Z',sessionNow:()=> '2026-11-06T00:00:00.000Z',adoptOfferJourney:true,stockProvider:stock,mail:{env:{}}}));
 server=createServer({key:await readFile(tls.configuration.keyFile),cert:await readFile(tls.configuration.certFile)},async(req,res)=>{try{
  const pathname=new URL(req.url,'https://localhost').pathname;if(pathname.startsWith('/api/')){backend.emit('request',req,res);return;}
  const path=pathname==='/gcsp/offer'?'/gcsp-offer.html':pathname;
  const file=resolve(ROOT,'.'+decodeURIComponent(path));if(!file.startsWith(ROOT+sep)||!(await stat(file)).isFile()){res.writeHead(404).end();return;}
  const body=phase==='baseline'&&path==='/blocks/gcsp/kit/vehicle-media.css'?baseline:await readFile(file);
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"script-src 'self'; object-src 'none'; base-uri 'self'"}).end(body);
 }catch{res.writeHead(404).end();}});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'localhost',r);});
 const origin=`https://localhost:${server.address().port}`;
 backend=buildServer({...services.dependencies,gcspAllowedOrigins:[origin],gcspVehicleImages:createLiveDisplayImageHandler({loadSources:async()=>{throw Error('retained-only');},fetchImpl:async()=>{throw Error('live-images-disabled');}})});good(await backend.gcspStartup,'startup');
 const client=createRouteClient({fetch:tls.fetch,origin});client.seed(good(await services.createLocalSession()).setCookie);
 route(await client.request('/api/gcsp/session/switch',{principalId:'demo-paula',commandId:'fucq345-paula'}));
 const a=route(await client.request('/api/gcsp/manual/account'));const action=a.actions.find(r=>r.enabled);const driver=a.choices.drivers.find(r=>r.kind==='employee');const option=a.choices.contractOptions.find(r=>r.driverKinds.includes(driver.kind));const location=a.choices.collectionLocations.find(r=>r.contractOptionIds.includes(option.contractOptionId)&&r.driverKinds.includes(driver.kind));
 const choices={mode:action.action==='replace'?'replacement':'new',oldContractId:action.oldContractId,slotId:action.slotId,schemeId:action.schemeId,driverId:driver.driverId,contractOptionId:option.contractOptionId,requestedCollectionDate:'2026-11-30',collectionLocationId:location.locationId,brand:a.choices.brands[0],contact:a.account.contact,expectedReturnMileage:a.currentContract?.currentOdometer?.value??null,specialRequirements:''};
 route(await client.request('/api/gcsp/manual/draft',{commandId:'fucq345-draft',expectedDraftVersion:0,expectedContextVersion:a.contextVersion,choices}));
 await presenterTick(client,'fucq345-release',{mode:'next-release'});
 const context=good(await services.identity.resolveSession({authorized:true,cookie:client.cookie()}));
 const decision=good(await services.manualRead.browseStock(context)).decisions.find(r=>r.gateStatus==='eligible'&&r.claimInput);assert.ok(decision);
 const claim=route(await client.request('/api/gcsp/manual/claim',{commandId:'fucq345-claim',...decision.claimInput}));report.expectedIdentity={holdId:claim.hold.holdId,quoteId:claim.quote.quoteId,orderUuid:claim.quote.orderUuid,holdVersion:claim.hold.version};
 browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',ignoreHTTPSErrors:true,viewport:{width:1280,height:900},serviceWorkers:'allow',args:['--disable-background-networking','--disable-component-update','--renderer-process-limit=1']});
 await browser.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await syncCookies(client,origin);page=browser.pages()[0]||await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
 for(phase of ['fixed'])for(const width of [1280,375]){
  await openReview(origin,width);const g=await geometry('selected');await capture(phase==='baseline'?'01-before-selected':'02-selected',page.locator('.gcsp-review-vehicle'));
  if(phase==='baseline')assert.ok(g.overlap>0,'baseline caption overlaps order tag');else{assert.equal(g.overlap,0);assert.equal(g.tagPhotoOverlap,0);assert.equal(g.captionPosition,'static');assert.equal(g.objectFit,'contain');assert.equal(g.photoReady,true);assert.ok(g.tag.y>=g.media.y&&g.tag.bottom<=g.caption.y);assert.ok(g.scrollWidth<=width+1);}
  const read=route(await client.request('/api/gcsp/manual/claim'));report.identities.push({phase,width,preserved:read.hold.holdId===claim.hold.holdId&&read.quote.quoteId===claim.quote.quoteId&&read.quote.orderUuid===claim.quote.orderUuid&&read.hold.version===claim.hold.version&&read.hold.phase==='preview'});assert.ok(report.identities.at(-1).preserved);
 }
 for(const width of [1280,375]){
  await openReview(origin,width);await page.getByLabel('Contact phone',{exact:true}).fill('');await page.getByRole('button',{name:'Continue to order review',exact:true}).click();await page.locator('.gcsp-error-summary a').first().waitFor();await capture('03-validation',page.locator('.gcsp-error-summary'));
  await page.getByLabel('Contact phone',{exact:true}).fill(choices.contact.phone);await capture('04-controls',page.getByRole('button',{name:'Continue to order review',exact:true}));
  await page.locator('.gcsp-review-vehicle img').evaluate(i=>i.dispatchEvent(new Event('error')));const broken=await geometry('broken-photo');assert.equal(broken.photo,null);assert.ok(broken.media.height>=broken.media.width*9/16-1);assert.equal(broken.placeholderDisplay,'flex');assert.equal(broken.tagPlaceholderOverlap,0);await capture('05-broken-photo',page.locator('.gcsp-review-vehicle'));
  await page.locator('.gcsp-review-vehicle .vm-card-line').evaluate(n=>n.textContent='');const empty=await geometry('empty-tag');assert.equal(empty.tagDisplay,'none');await capture('06-empty-tag',page.locator('.gcsp-review-vehicle'));
  await page.goto(origin+'/components.html');const group=page.locator('.vm-gallery-gcsp-group').filter({has:page.getByRole('heading',{name:'mediaWell: selected review image and missing-photo frame',exact:true})});await capture('07-long-content-photo',group.locator('.vm-card').first());await capture('08-missing-photo',group.locator('.vm-card').last());
  const card=group.locator('.vm-card').first();const long=await geometry('long-content', '.vm-gallery-gcsp-group:has(.gcsp-review-layout) .vm-card-media');assert.equal(long.overlap,0);assert.equal(long.tagPhotoOverlap,0);assert.ok(long.tag.right<=long.media.right+1);assert.ok(long.tag.bottom<=long.caption.y);assert.ok(await card.locator('.vm-card-name').textContent());const missing=await geometry('long-missing-photo',group.locator('.vm-card-media').last());assert.equal(missing.tagPlaceholderOverlap,0);assert.equal(missing.photo,null);assert.ok(missing.media.height>=missing.media.width*9/16-1);assert.ok(missing.tag.right<=missing.media.right+1);
 }
 await openReview(origin,1280);await page.getByRole('button',{name:'Continue to order review',exact:true}).click();await page.locator('.gcsp-summary-body').waitFor();
 for(const width of [1280,375]){await page.setViewportSize({width,height:900});await capture('09-order-review',page.locator('.gcsp-review-vehicle'));const g=await geometry('order-review');assert.equal(g.overlap,0);assert.equal(g.tagPhotoOverlap,0);}
 for(const box of await page.locator('.gcsp-summary-declarations input[type=checkbox]').all())await box.check();
 const submit=page.getByRole('button',{name:/^Submit/});await submit.click();await page.locator('.gcsp-summary-outcome-body').waitFor();
 for(const width of [1280,375]){await page.setViewportSize({width,height:900});await capture('10-confirmation',page.locator('.gcsp-summary-outcome-body .vm-card'));const g=await geometry('confirmation','.gcsp-summary-outcome-body .vm-card-media');assert.equal(g.overlap,0);assert.equal(g.tagPhotoOverlap,0);assert.equal(g.objectFit,'contain');}
 report.reusedAdjacent='Initial capture-receipt.json: offer/activity source rules and captured states unchanged by flow refinement; initial pageerror explained by gallery probe.';
 guard.assertZero();assert.deepEqual(report.errors,[]);report.externalCalls=guard.calls;report.status='captured';
}catch(error){report.status='incomplete';report.failure={message:error.message,stack:error.stack?.split('\n').slice(0,5)};throw error;}
finally{
 await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}backend?.closeAllConnections();await services?.close();
 for(const fn of cleanups.reverse())await fn();await rm(profile,{recursive:true,force:true});report.profileRemoved=await stat(profile).then(()=>false,e=>e.code==='ENOENT');
 await writeFile(join(OUTPUT,'capture-receipt.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,screenshots:report.screenshots.length,failure:report.failure,profileRemoved:report.profileRemoved}));
}
