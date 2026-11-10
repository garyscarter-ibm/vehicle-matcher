import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const ROOT='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004';
const load=p=>import(pathToFileURL(join(ROOT,p)).href);
const cleanups=[];const after=fn=>cleanups.push(fn);const report={};const phase='fixed',baseline='';
let services,backend,server;
const good=(out,label='service')=>{assert.equal(out?.status,'ok',`${label}:${out?.status}:${out?.code||''}`);return out.value;};
const route=out=>{assert.equal(out.status,200,JSON.stringify(out.json));return good(out.json);};
const [{offlineEgressGuard},{createGcspRuntime},{buildServer},{createRunStockProviderFactory},{createLiveDisplayImageHandler},{createRouteClient,presenterTick,resetIntoScenario}]=await Promise.all([
load('server/test/helpers/offline-egress-guard.js'),load('server/gcsp/runtime.js'),load('server/index.js'),load('server/gcsp/stock/index.js'),load('server/gcsp/vehicle-evidence/live-display-images.js'),load('server/test/helpers/gcsp-decline-change-route.js')]);
const guard=offlineEgressGuard({after});
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const ready=join(process.env.TMPDIR,'fucq345-b-ready.json'), stop=join(process.env.TMPDIR,'fucq345-b-stop');
const evidenceFile=join(ROOT,'docs/gcsp/evidence/fucq345/assessment-b/browser-evidence.json');
try{
 const stock=createRunStockProviderFactory({env:{GCSP_STOCK_SOURCE:'demo'},logger:()=>{}});
 services=good(await createGcspRuntime({mode:'memory',environmentId:'fucq345-owned',commandId:'fucq345-bootstrap',policyAsOf:'2026-11-05T09:00:00.000Z',sessionNow:()=> '2026-11-06T00:00:00.000Z',adoptOfferJourney:true,stockProvider:stock,mail:{env:{}}}));
 server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/__assessment-b/bootstrap'&&req.method==='GET'){
   const payload=await readFile(ready,'utf8');res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(payload);return;
  }
  if(pathname==='/__assessment-b/stop'&&req.method==='POST'){
   await writeFile(stop,'stop\n');res.writeHead(204,{'Cache-Control':'no-store'}).end();return;
  }
  if(pathname==='/__assessment-b/evidence'&&req.method==='POST'){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('evidence payload exceeded 1 MiB');chunks.push(chunk);}
   const body=Buffer.concat(chunks).toString('utf8');const data=JSON.parse(body);const serial=JSON.stringify(data);const fixture=JSON.parse(await readFile(ready,'utf8'));
   if(!data||typeof data!=='object'||Array.isArray(data)||/\"(cookie|token|authorization)\"\s*:/i.test(serial)||fixture.cookie&&serial.includes(fixture.cookie))throw Error('evidence payload rejected by local redaction guard');
   await writeFile(evidenceFile,JSON.stringify(data,null,2)+'\n');res.writeHead(201,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({saved:true}));return;
  }
  if(pathname==='/__assessment-b/adjacent'){
   const {reset}=await resetIntoScenario(client,'decline-then-change','fucq345-b-adjacent-reset');assert.equal(reset.startState.status,'ok');route(await client.request('/api/gcsp/session/switch',{principalId:'demo-paula',commandId:'fucq345-b-adjacent-paula'}));
   const current=route(await client.request('/api/gcsp/offers/current'));const offer=current.offers.find(r=>r.runId===reset.runId);assert.ok(offer);
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({cookie:client.cookie(),offerPath:`/gcsp/offer?offerId=${encodeURIComponent(offer.offerId)}&runId=${encodeURIComponent(offer.runId)}`,activityPath:'/gcsp-activity-live.html'}));return;
  }
  if(pathname.startsWith('/api/')){backend.emit('request',req,res);return;}
  const path=pathname==='/gcsp/offer'?'/gcsp-offer.html':pathname;
  const file=resolve(ROOT,'.'+decodeURIComponent(path));if(!file.startsWith(ROOT+sep)||!(await stat(file)).isFile()){res.writeHead(404).end();return;}
  const body=phase==='baseline'&&path==='/blocks/gcsp/kit/vehicle-media.css'?baseline:await readFile(file);
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"script-src 'self'; object-src 'none'; base-uri 'self'"}).end(body);
 }catch{res.writeHead(404).end();}});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'localhost',r);});
 const origin=`http://localhost:${server.address().port}`;
 backend=buildServer({...services.dependencies,gcspAllowedOrigins:[origin],gcspVehicleImages:createLiveDisplayImageHandler({loadSources:async()=>{throw Error('retained-only');},fetchImpl:async()=>{throw Error('live-images-disabled');}})});good(await backend.gcspStartup,'startup');
 const client=createRouteClient({fetch:globalThis.fetch,origin});client.seed(good(await services.createLocalSession()).setCookie);
 route(await client.request('/api/gcsp/session/switch',{principalId:'demo-paula',commandId:'fucq345-paula'}));
 const a=route(await client.request('/api/gcsp/manual/account'));const action=a.actions.find(r=>r.enabled);const driver=a.choices.drivers.find(r=>r.kind==='employee');const option=a.choices.contractOptions.find(r=>r.driverKinds.includes(driver.kind));const location=a.choices.collectionLocations.find(r=>r.contractOptionIds.includes(option.contractOptionId)&&r.driverKinds.includes(driver.kind));
 const choices={mode:action.action==='replace'?'replacement':'new',oldContractId:action.oldContractId,slotId:action.slotId,schemeId:action.schemeId,driverId:driver.driverId,contractOptionId:option.contractOptionId,requestedCollectionDate:'2026-11-30',collectionLocationId:location.locationId,brand:a.choices.brands[0],contact:a.account.contact,expectedReturnMileage:a.currentContract?.currentOdometer?.value??null,specialRequirements:''};
 route(await client.request('/api/gcsp/manual/draft',{commandId:'fucq345-draft',expectedDraftVersion:0,expectedContextVersion:a.contextVersion,choices}));
 await presenterTick(client,'fucq345-release',{mode:'next-release'});
 const context=good(await services.identity.resolveSession({authorized:true,cookie:client.cookie()}));
 const decision=good(await services.manualRead.browseStock(context)).decisions.find(r=>r.gateStatus==='eligible'&&r.claimInput);assert.ok(decision);
 const claim=route(await client.request('/api/gcsp/manual/claim',{commandId:'fucq345-claim',...decision.claimInput}));report.expectedIdentity={holdId:claim.hold.holdId,quoteId:claim.quote.quoteId,orderUuid:claim.quote.orderUuid,holdVersion:claim.hold.version};

 await writeFile(ready,JSON.stringify({origin,cookie:client.cookie(),stop,sourceCheckpoint:process.env.FUCQ345_SOURCE_CHECKPOINT||'',identity:report.expectedIdentity}));
 process.env.FUCQ345_ORIGIN=origin;
 let browser,sourceContext,sourcePage;
 try{
  const {chromium}=await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-component-update','--renderer-process-limit=1']});
  sourceContext=await browser.newContext({viewport:{width:1280,height:900}});sourcePage=await sourceContext.newPage();
  const runnerSource=await readFile('/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-b-browser-runner.js','utf8');
  const runBrowser=new Function('return ('+runnerSource+')')();
  const browserSummary=await runBrowser(sourcePage);
  console.log('FUCQ345_B_BROWSER '+JSON.stringify(browserSummary));
  assert.equal(browserSummary.status,'captured','Assessment B direct browser proof did not complete');
 }catch(error){await writeFile(stop,'stop\n').catch(()=>{});throw error;}
 finally{try{await sourcePage?.close();}catch{}try{await sourceContext?.close();}catch{}try{await browser?.close();}catch{}}
 console.log('FUCQ345_B_READY '+ready);
 const deadline=Date.now()+300000;
 while(Date.now()<deadline){if(await stat(stop).then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,200));}
 guard.assertZero();console.log(JSON.stringify({state:'stopped',externalCalls:guard.calls}));
}finally{
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}backend?.closeAllConnections();await services?.close();
 for(const fn of cleanups.reverse())await fn();
}
