async (sourcePage) => {
 const root='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004';
 const origin=process.env.FUCQ345_ORIGIN;
 const detectorUrl=origin+'/__assessment-b/detector.js';
 const detectorPath='/Users/usget/.codex/skills/impeccable/scripts/detector/detect-antipatterns-browser.js';
 const ev={schemaVersion:1,task:'FUCQ-345 Assessment B runtime diagnostics',sourceCheckpoint:'5a5ae694923c26c59acb81a121a56683e424159c',integratedBase:'95f391414685638618f71665ab23630508f7aa45',runtime:'offline local HTTP fixture; in-memory application runtime',browser:'fresh headless Chrome context; same-origin detector script; no screenshots',detector:{path:detectorPath,sha256:process.env.FUCQ345_DETECTOR_SHA256||null,api:'window.impeccableDetect()'},helper:{path:process.env.FUCQ345_HELPER_PATH||null,sha256:process.env.FUCQ345_HELPER_SHA256||null},runner:{path:process.env.FUCQ345_DIAGNOSTICS_RUNNER_PATH||null,sha256:process.env.FUCQ345_DIAGNOSTICS_RUNNER_SHA256||null},points:[],httpErrors:[],requestFailures:[],console:[],blockedExternalRequests:[],nativeContextDisruption:'A preparatory browser_run_code_unsafe attempt called clearCookies(), installed a context-wide route, and called close() on the supplied tool-managed context after its self-signed-HTTPS bootstrap failed. A separate certificate probe navigated that supplied page to chrome-error://chromewebdata/. Context ownership was not established; recorded as a disruption, not as preserved state. No app pages or screenshots were created by those native attempts.'};
 let ctx=null,p=null,fail=null;
 const scrub=s=>String(s).replace(/\b(cookie|token|authorization|bearer)\b\s*[:=]?\s*[^\s,;]+/gi,'$1=[redacted]').replace(/#token=[^\s]*/gi,'#token=[redacted]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email-redacted]').replace(/\b0\d{3,4}\s?\d{6}\b/g,'[phone-redacted]').slice(0,1200);
 const stripStyle=s=>scrub(s).replace(/%c/g,'').replace(/\s*color:\s*[^;]+;?/gi,'').replace(/\s*font-weight:\s*[^;]+;?/gi,'').replace(/\s+/g,' ').trim();
 const cookieRows=value=>String(value).split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return{name:x.slice(0,i),value:x.slice(i+1),url:origin,secure:new URL(origin).protocol==='https:',httpOnly:true,sameSite:'Lax'};});
 const attach=(page,label)=>{
  page.setDefaultTimeout(15000);
  page.on('console',m=>ev.console.push({point:label,type:m.type(),text:stripStyle(m.text())}));
  page.on('pageerror',e=>ev.console.push({point:label,type:'pageerror',text:scrub(e.message)}));
  page.on('response',r=>{if(r.status()>=400){let path='/';try{path=new URL(r.url()).pathname;}catch{}ev.httpErrors.push({point:label,status:r.status(),path,resourceType:r.request().resourceType(),method:r.request().method()});}});
  page.on('requestfailed',r=>{let path='/';try{path=new URL(r.url()).pathname;}catch{}ev.requestFailures.push({point:label,path,resourceType:r.resourceType(),method:r.method(),error:(()=>{const f=r.failure();return scrub(typeof f==='string'?f:(f?.errorText||'unknown'));})()});});
 };
 const newPage=async(label,width,url)=>{p=await ctx.newPage();attach(p,label);await p.setViewportSize({width,height:900});await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.readyState==='complete'&&!!document.body,null,{timeout:15000});await p.waitForTimeout(100);return p;};
 const waitMedia=async(sel)=>{await p.waitForFunction(s=>!!document.querySelector(s),sel,{timeout:15000});await p.waitForTimeout(150);};
 const waitVehicleMedia=async(sel)=>{await p.waitForFunction(s=>{const w=document.querySelector(s);if(!w)return false;const i=w.querySelector('img'),f=w.querySelector('.vm-card-soon,.vm-media-placeholder,[data-media-fallback]');return !i||(i.complete&&i.naturalWidth>0)||(f&&getComputedStyle(f).display!=='none');},sel,{timeout:15000});await p.waitForTimeout(150);};
 const safeFindings=rows=>{
  if(!Array.isArray(rows))return{shape:typeof rows,groups:[]};
  const groups=rows.map(g=>({selector:scrub(g.selector||''),tagName:scrub(g.tagName||''),rect:g.rect||null,isPageLevel:!!g.isPageLevel,isHidden:!!g.isHidden,findings:(Array.isArray(g.findings)?g.findings:[]).map(f=>({type:scrub(f.type||''),category:scrub(f.category||''),severity:scrub(f.severity||''),advisory:!!f.advisory,detail:scrub(f.detail||''),name:scrub(f.name||''),description:scrub(f.description||'')}))}));
  return{shape:'serialized-finding-groups',groups};
 };
 const runPoint=async(label,width)=>{
  const detectorConsoleStart=ev.console.length;
  await p.addScriptTag({url:detectorUrl});
  await p.waitForTimeout(2100);
  const result=await p.evaluate(()=>({available:typeof window.impeccableDetect==='function',findings:typeof window.impeccableDetect==='function'?window.impeccableDetect():null}));
  if(!result.available)throw new Error(label+' did not expose window.impeccableDetect');
  const data=safeFindings(result.findings),count=data.groups.reduce((n,g)=>n+g.findings.length,0),byType={};
  for(const g of data.groups)for(const f of g.findings)byType[f.type]=(byType[f.type]||0)+1;
  const point={state:label,viewportWidth:width,pagePath:(()=>{try{return new URL(p.url()).pathname;}catch{return'';}})(),api:'window.impeccableDetect()',findingGroupCount:data.groups.length,findingCount:count,byType,findings:data.groups,console:ev.console.slice(detectorConsoleStart)};
  const bytes=Buffer.byteLength(JSON.stringify(point));if(bytes>5*1024*1024)throw new Error(label+' detector diagnostics exceeded 5 MiB bound');
  ev.points.push(point);await p.waitForTimeout(100);await p.close();p=null;
 };
 try{
  const browser=sourcePage.context().browser();if(!browser)throw new Error('direct Playwright source page did not expose its browser');
  ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'});
  const appOrigin=new URL(origin).origin;
  await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin===appOrigin){await r.continue();return;}ev.blockedExternalRequests.push({origin:u.origin,resourceType:r.request().resourceType()});await r.abort();});
  const boot=await ctx.request.get(origin+'/__assessment-b/bootstrap',{timeout:15000});if(!boot.ok())throw new Error('local bootstrap returned HTTP '+boot.status());const ready=await boot.json();
  if(ready.detectorSha256!==ev.detector.sha256)throw new Error('detector source hash differs from the helper-served source');
  await ctx.addCookies(cookieRows(ready.cookie));
  p=await newPage('selected-review',375,origin+'/gcsp-account.html');await p.getByRole('button',{name:'Resume saved journey',exact:true}).click();await waitVehicleMedia('.gcsp-review-vehicle .vm-card-media');await runPoint('01-selected-review',375);
  p=await newPage('summary',1280,origin+'/gcsp-account.html');await p.getByRole('button',{name:'Resume saved journey',exact:true}).click();await waitMedia('.gcsp-review-vehicle .vm-card-media');const continueButton=p.getByRole('button',{name:'Continue to order review',exact:true});if(await continueButton.isVisible().catch(()=>false))await continueButton.click();await p.locator('.gcsp-summary-body').waitFor({state:'visible'});await runPoint('02-order-review-summary',1280);
  p=await newPage('confirmation',375,origin+'/gcsp-account.html');await p.getByRole('button',{name:'Resume saved journey',exact:true}).click();await waitMedia('.gcsp-review-vehicle .vm-card-media');const continueAgain=p.getByRole('button',{name:'Continue to order review',exact:true});if(await continueAgain.isVisible().catch(()=>false))await continueAgain.click();await p.locator('.gcsp-summary-body').waitFor({state:'visible'});const boxes=p.locator('.gcsp-summary-declarations input[type=checkbox]'),n=await boxes.count();if(n<1)throw new Error('summary declarations are missing for confirmation probe');for(const b of await boxes.all())await b.check();await p.getByRole('button',{name:/^Submit/}).click();await p.locator('.gcsp-summary-outcome-body').waitFor({state:'visible'});await runPoint('03-confirmation',375);
  const adjacentResponse=await ctx.request.get(origin+'/__assessment-b/adjacent',{timeout:15000});if(!adjacentResponse.ok())throw new Error('local adjacent reset returned HTTP '+adjacentResponse.status());const adjacent=await adjacentResponse.json();await ctx.clearCookies();await ctx.addCookies(cookieRows(adjacent.cookie));
  p=await newPage('offer',1280,origin+adjacent.offerPath);await p.waitForFunction(()=>document.querySelector('main')?.textContent.trim().length>0||document.querySelector('h1')?.textContent.trim().length>0,null,{timeout:15000});await waitVehicleMedia('.gcsp-offer-exact .vm-card-media');await runPoint('04-offer',1280);
  p=await newPage('activity',375,origin+adjacent.activityPath);await p.waitForFunction(()=>document.querySelector('main')?.textContent.trim().length>0||document.querySelector('h1')?.textContent.trim().length>0,null,{timeout:15000});await waitVehicleMedia('.gcsp-activity-offer-visual .vm-card-media');await runPoint('05-activity',375);
  ev.status='complete';
 }catch(e){fail=scrub(e.message);ev.status='incomplete';ev.failure=fail;}
 finally{
  if(p&&!p.isClosed()){try{await p.close();}catch{}}
  ev.summary={pointCount:ev.points.length,detectorGroupCount:ev.points.reduce((n,x)=>n+x.findingGroupCount,0),findingCount:ev.points.reduce((n,x)=>n+x.findingCount,0),httpErrorCount:ev.httpErrors.length,requestFailureCount:ev.requestFailures.length,consoleMessageCount:ev.console.length,blockedExternalRequestCount:ev.blockedExternalRequests.length};
  try{if(ctx){const saved=await ctx.request.post(origin+'/__assessment-b/diagnostics',{data:ev,timeout:15000});if(!saved.ok())ev.diagnosticsWriteFailure='local diagnostics endpoint HTTP '+saved.status();}}catch(e){ev.diagnosticsWriteFailure=scrub(e.message);}
  try{if(ctx)await ctx.request.post(origin+'/__assessment-b/stop',{timeout:15000});}catch(e){ev.stopSignalFailure=scrub(e.message);}
  try{await ctx?.close();}catch{}
 }
 return{status:ev.status,failure:fail,summary:ev.summary,diagnosticsWriteFailure:ev.diagnosticsWriteFailure||null,stopSignalFailure:ev.stopSignalFailure||null};
}
