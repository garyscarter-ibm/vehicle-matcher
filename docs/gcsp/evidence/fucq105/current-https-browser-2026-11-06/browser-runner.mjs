// One granted FUCQ105 browser smoke. Invoke only through the owned supervisor.
import assert from 'node:assert/strict';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { startGcspDemo } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-080/scripts/gcsp-demo.mjs';
import { createSyntheticStockProvider } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-080/server/gcsp/stock/index.js';
import { createVehicleSnapshot } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-080/server/vehicles/index.js';
import { inputDigest } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-080/server/gcsp/repository/index.js';
import { OFFER_ACCESS_COOKIE } from '/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-080/server/gcsp/offers/access.js';

assert.equal(process.env.FUCQ103_CHUNK, 'offer-single-browser');
for (const key of ['FUCQ103_SCRATCH','FUCQ103_OUTPUT','FUCQ103_PROCESS_LEDGER','FUCQ103_SOURCE_PLAN']) assert.ok(process.env[key]);
const scratch=resolve(process.env.FUCQ103_SCRATCH), output=resolve(process.env.FUCQ103_OUTPUT);
const plan=JSON.parse(await readFile(process.env.FUCQ103_SOURCE_PLAN,'utf8'));
const ledger={pids:[process.pid],ports:[],profile:resolve(scratch,'chrome-profile')};
const saveLedger=()=>writeFile(process.env.FUCQ103_PROCESS_LEDGER,JSON.stringify(ledger));
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const bound=(promise,ms,message)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));};
const good=value=>{assert.equal(value?.status,'ok','Actual service must succeed');return value.value;};
let app,chrome,browser,context,page,source;
let report={state:'incomplete',runIdentity:'fucq105-current-https-2028',checks:[],captures:[],errors:[],resourceFailures:[],
 boundary:'Actual delivered HTTPS launcher; explicit memory services with one labelled synthetic exact-car input. Local self-signed TLS accepted only in this test context. No nativeDB/liveBMW/mail/second-browser/whole107 claim.'};
const persist=()=>writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
async function check(name,run){report.activeCheck=name;await persist();const evidence=await run();report.checks.push({name,state:'passed',...(evidence?{evidence}:{})});await persist();}
async function capture(name){assert.equal(new URL(page.url()).hash,'','Fragment must be removed before capture');const path=resolve(output,name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled'});report.captures.push({name,path});await persist();}
async function pending(){await page.getByRole('heading',{name:'Your car offer',exact:true}).waitFor({timeout:7000});}
try{
 await mkdir(resolve(scratch,'tls'),{recursive:true});await saveLedger();
 const key=resolve(scratch,'tls/key.pem'),cert=resolve(scratch,'tls/cert.pem');
 const openssl=spawn(plan.executables.openssl.path,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',key,'-out',cert],{stdio:'ignore'});
 ledger.pids.push(openssl.pid);await saveLedger();const [code]=await bound(once(openssl,'exit'),6000,'TLS setup timeout');assert.equal(code,0);
 const stockProvider={pull:request=>source?source.pull(request):{status:'unavailable',reason:'Synthetic setup not prepared',retryable:true}};
 app=good(await startGcspDemo({port:0,tls:{keyFile:key,certFile:cert},runtime:{mode:'memory',stockProvider,environmentId:'fucq105-current-https-2028',policyAsOf:'2026-11-06T09:00:00.000Z',commandId:'browser-bootstrap'}}));
 ledger.ports.push(app.server.address().port);await saveLedger();
 const {chromium}=await import(plan.playwrightEntry);
 chrome=spawn(plan.executables.chrome.path,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${ledger.profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-breakpad','--metrics-recording-only','--disable-application-cache','--disk-cache-size=1048576','--media-cache-size=1048576','about:blank'],{stdio:'ignore'});
 ledger.pids.push(chrome.pid);await saveLedger();const activePort=resolve(ledger.profile,'DevToolsActivePort'),deadline=Date.now()+8000;
 while(true){try{await access(activePort);break;}catch{assert.ok(Date.now()<deadline,'Chrome setup timeout');await pause(50);}}
 const [port]=(await readFile(activePort,'utf8')).trim().split('\n');ledger.ports.push(Number(port));await saveLedger();
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:8000});
 context=await browser.newContext({viewport:{width:1280,height:900},ignoreHTTPSErrors:true,reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(10000);
 await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==app.origin){report.resourceFailures.push({kind:'external-request-blocked'});await route.abort('blockedbyclient');}else await route.continue();});
 const {services:s}=app;
 await check('ordinary-secure-employee-session',async()=>{
  await page.goto(app.origin+'/gcsp-account.html');
  await page.locator('gcsp-account main').waitFor();
  const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name==='gcsp_session'&&c.secure&&c.httpOnly));assert.ok(!cookies.some(c=>c.name===OFFER_ACCESS_COOKIE));
  return {cookieInjection:false,secureHttpOnly:true,offerCookiePresent:false};
 });
 let acting,presenter,produced,link,cleanURL,quote;
 await check('real-release-brief-hold-one-offer',async()=>{
  const cookie=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
  acting=good(await s.identity.resolveSession({authorized:true,cookie}));
  presenter=good(await s.identity.resolveSession({authorized:true,cookie,purpose:'presenter-control'}));
  let time=good(await s.clock.now(presenter));
  if(Date.parse(time.now)<Date.parse('2026-11-06T09:00:00.000Z')){good(await s.clock.advance(presenter,{commandId:'smoke-morning',expectedClockVersion:time.clockVersion,to:'2026-11-06T09:00:00.000Z'}));time=good(await s.clock.now(presenter));}
  const observedAt=time.now, version='synthetic-f105-one-offer-v1';
  const fact=(value,unit=null)=>({status:value===null?'unknown':'known',value,unit,provenance:{sourceRef:'TEST:fucq105-current-https-2028',observedAt,version,assurance:value===null?'unknown':'synthetic-scenario'}});
  const orderUuid='f1050000-0000-4000-8000-000000000001';
  const car={orderUuid,orderNumber:'9100105',configurationId:'RzIxOlMx',corpusVersion:version,revision:1,
   visibility:{companyIds:[acting.companyId],schemeIds:[acting.schemeId],employeeIds:[acting.employeeId]},availability:{availableUntil:'2027-01-01T00:00:00.000Z'},
   facts:createVehicleSnapshot({sourceNamespace:'TEST:fucq105-current-https-2028',identityKind:'exact-stock',sourceKeys:{stockId:orderUuid},snapshotVersion:version,observedAt,
    display:{name:'Synthetic TEST BMW 320i M Sport Touring',model:'BMW 3 Series Touring',derivative:'320i M Sport',colour:'Black Sapphire metallic'},
    facts:{eligibilityModelKey:fact('G21 Touring|320i'),body:fact('estate'),fuel:fact('petrol'),seats:fact(5,'count'),boot:fact(500,'L'),zeroTo62:fact(7,'s'),mpg:fact(45,'mpg-imperial'),sizeClass:fact(3,'ordinal-1-5'),tags:fact(['cruiser']),colour:fact('Black Sapphire metallic'),options:fact(null)}})};
  source=createSyntheticStockProvider({runId:acting.runId,version,label:'Synthetic one-offer browser input; not BMW corpus/live stock',windows:[{windowId:'one',availableAt:observedAt,supplyId:null,stock:[car]}]});
  const tick=good(await s.clock.tick(presenter,{eventId:'f105-release',inputDigest:inputDigest('f105-release'),expectedClockVersion:time.clockVersion}));
  const release=tick.outcomes.find(x=>x.handlerId==='stock-release');assert.ok(release);assert.equal(release.outcome.status,'ok');
  const rows=async(table,filter={})=>good(await s.repository.query(acting,table,filter));
  const stock=(await rows('stock',{orderUuid}))[0];assert.ok(stock?.release,'Real release must commit');
  const brief={schemaVersion:1,preferences:{body:{value:'estate',importance:100,valueState:'confirmed',importanceState:'confirmed',source:'employee'}},essentials:{seats:{value:5,operator:'gte',unit:'count',state:'confirmed',source:'employee'}}};
  good(await s.brief.saveDraft(acting,{commandId:'f105-draft',expectedBriefVersion:0,expectedDraftVersion:0,brief}));
  good(await s.brief.confirm(acting,{commandId:'f105-confirm',expectedBriefVersion:0,expectedDraftVersion:1,consent:{search:true,hold:true}}));
  const employee=(await rows('employees',{employeeId:acting.employeeId}))[0],slot=(await rows('entitlement_slots',{entitlementSlotId:acting.entitlementSlotId}))[0];
  produced=good(await s.buddy.allocate(acting,{commandId:'f105-allocate',orderUuid,expectedBriefVersion:1,expectedStockVersion:stock.version,expectedEmployeeVersion:employee.version,expectedSlotVersion:slot.version}));
  const offers=await rows('offers');assert.equal(offers.length,1);
  const outbox=await rows('notification_outbox');assert.equal(outbox.length,1);link=new URL(outbox[0].payload.offerLink,app.origin);assert.ok(link.hash.startsWith('#token='));
  cleanURL=app.origin+'/gcsp/offer?'+new URLSearchParams({offerId:produced.offer.offerId,runId:acting.runId});
  quote=produced.quote;
  return {offers:1,releasedThroughActualService:true,briefVersion:1,syntheticInput:true,orderNumber:car.orderNumber,quoteId:quote.quoteId,points:quote.terms.points,allowance:quote.terms.allowanceInputs};
 });
 await check('account-known-offer-before-offer-cookie',async()=>{
  assert.ok(!(await context.cookies()).some(c=>c.name===OFFER_ACCESS_COOKIE));await page.goto(cleanURL);await pending();
  assert.ok(!(await context.cookies()).some(c=>c.name===OFFER_ACCESS_COOKIE));await capture('account-pending-1280');
  return {entry:'known offer URL with ordinary employee cookies',offerCookiePresent:false};
 });
 await check('actual-producer-email-exchange-fragment-removed',async()=>{
  const exchange=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/gcsp/offers/access',{timeout:7000});
  try{await page.goto(link.href);}catch{throw Error('Producer email navigation failed; private URL suppressed');}
  const response=await exchange;assert.equal(response.status(),200,'Actual email exchange must succeed');
  await pending();assert.equal(new URL(page.url()).hash,'');assert.ok((await context.cookies()).some(c=>c.name===OFFER_ACCESS_COOKIE&&c.secure&&c.httpOnly));link=null;
  return {exchangeStatus:200,fragmentRemoved:true,secureHttpOnlyOfferCookie:true};
 });
 await check('clean-authoritative-pending-reload',async()=>{
  await page.reload();await pending();assert.equal(new URL(page.url()).hash,'');
  const url=new URL(cleanURL);const reply=await page.request.get(app.origin+'/api/gcsp/offers/'+encodeURIComponent(produced.offer.offerId)+'?runId='+encodeURIComponent(acting.runId));
  assert.equal(reply.status(),200);const dto=good(await reply.json());assert.equal(dto.state,'pending');assert.equal(dto.quote.quoteId,quote.quoteId);
  assert.deepEqual(dto.quote.terms.points,quote.terms.points);return {state:dto.state,quoteId:dto.quote.quoteId,serverNow:dto.serverNow,expiresAt:dto.expiresAt};
 });
 await check('exact-car-typed-points-known-and-unknown-facts',async()=>{
  const text=await page.locator('.gcsp-offer-exact').innerText();
  for(const wanted of ['Synthetic TEST BMW 320i M Sport Touring','BMW 3 Series Touring','320i M Sport','Black Sapphire metallic','9100105','Fitted equipment unknown']) assert.ok(text.includes(wanted),'Exact offered fact missing: '+wanted);
  assert.ok(text.includes(String(quote.terms.points.value))&&text.toLowerCase().includes('points'),'Typed points must be displayed');
  const current=await page.locator('.gcsp-offer-current').innerText();assert.ok(current.includes('320i M Sport Touring'));assert.ok(current.includes('Partial comparison. Current-car specifications and points are unknown.'));
  assert.equal((await page.locator('.gcsp-offer-current').innerText()).match(/Unknown/g)?.length,8);
  assert.ok((await page.locator('.gcsp-countdown').innerText()).length>0);assert.ok(await page.locator('[data-offer-action="accept"]').isEnabled());assert.ok(await page.locator('[data-offer-action="decline"]').isEnabled());
  return {exactOrder:true,pointsFromPinnedQuote:true,currentComparison:'partial; all eight specifications/points unknown',image:'shared fallback',countdown:await page.locator('.gcsp-countdown').innerText()};
 });
 await check('desktop-and-375-keyboard-focus-reduced-motion',async()=>{
  const results=[];
  for(const width of [1280,375]){
   await page.setViewportSize({width,height:width===375?812:900});
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,host:document.querySelector('gcsp-offer')?.tagName}));
   assert.ok(layout.scroll<=width,'Horizontal overflow');assert.ok(layout.reduced);assert.equal(layout.host,'GCSP-OFFER');
   await page.locator('[data-offer-action="accept"]').focus();await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.offerAction),'decline');
   const focus=await page.locator('[data-offer-action="decline"]').evaluate(el=>{const s=getComputedStyle(el);return {visible:el.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth};});assert.ok(focus.visible&&focus.outline!=='none'&&focus.width!=='0px','Visible keyboard focus');
   const refresh=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/gcsp/offers/'+encodeURIComponent(produced.offer.offerId));
   await refresh;assert.equal(await page.evaluate(()=>document.activeElement?.dataset.offerAction),'decline','Readback preserves focus');
   await capture('email-reload-pending-'+width);results.push({...layout,focus,readbackFocusPreserved:true});
  }
  return results;
 });
 await check('server-clock-countdown-deadline-readback',async()=>{
  const initial=await page.locator('.gcsp-countdown').innerText();const time=good(await s.clock.now(presenter));
  good(await s.clock.advance(presenter,{commandId:'f105-expire',expectedClockVersion:time.clockVersion,to:produced.hold.expiresAt}));
  await page.getByRole('heading',{name:'Offer expired',exact:true}).waitFor({timeout:10000});
  assert.equal(await page.locator('[data-offer-action="accept"]').count(),0);await capture('expired-375');
  await page.reload();await page.getByRole('heading',{name:'Offer expired',exact:true}).waitFor();return {initial,expiry:produced.hold.expiresAt,authoritativeReloadState:'expired'};
 });
 assert.deepEqual(report.resourceFailures,[]);report.state='passed';delete report.activeCheck;
}catch(error){report.errors.push({check:report.activeCheck||'setup',kind:error.name,message:(error.message||'Runner failed').replace(/https?:\/\/\S+/g,'[URL suppressed]').slice(0,1500)});}
finally{
 const cleanupErrors=[];
 for(const [name,close] of [['context',()=>context?.close()],['browser',()=>browser?.close()],['actualHttpsLauncher',()=>app?.close()]]){try{await bound(Promise.resolve().then(close),3000,name+' close timeout');}catch{cleanupErrors.push(name+' close failed');}}
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGTERM');try{await bound(once(chrome,'exit'),3000,'Chrome exit timeout');}catch{cleanupErrors.push('Chrome exit timeout');}}
 report.driverCleanupErrors=cleanupErrors;if(cleanupErrors.length)report.state='incomplete';await persist();console.log(JSON.stringify({state:report.state,checks:report.checks.length,captures:report.captures.length}));
}
process.exitCode=report.state==='passed'?0:1;
