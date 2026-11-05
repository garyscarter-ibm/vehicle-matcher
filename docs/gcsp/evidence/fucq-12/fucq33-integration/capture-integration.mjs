import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE);
const BASE = process.env.BASE, OUT=resolve(process.env.OUT_DIR), ROOT=resolve(process.env.PROJECT_ROOT);
const browser=await chromium.launchPersistentContext(join(process.env.BROWSER_SCRATCH,'chrome-profile'),{executablePath:process.env.CHROME_PATH,headless:true,viewport:{width:1280,height:900},args:['--disable-background-networking','--disable-component-update','--disable-default-apps']});
const results=[],assertions=[],assertionFailures=[];
const check=(scope,id,pass,expected,observed)=>{const a={scope,id,pass:Boolean(pass),expected,observed};assertions.push(a);if(!a.pass)assertionFailures.push(a)};
const sha=x=>createHash('sha256').update(x).digest('hex');
const old=JSON.parse(await readFile(join(ROOT,'docs/gcsp/evidence/fucq-12/fucq33-final-browser.json'),'utf8'));
const oldReference=old.results.filter(x=>x.name.startsWith('employee-reference-'));
const unchanged={};
for(const [path,hash] of Object.entries(old.sourceSha256)) if(path.startsWith('blocks/demo-launcher/')||path==='index.html'||path==='blocks/vehicle-matcher/gcsp-kit.css'||path==='blocks/gcsp/employee/gcsp-employee.css')unchanged[path]={historical:hash,current:sha(await readFile(join(ROOT,path)))};
check('reuse','launcher-and-extracted-primitives-unchanged',Object.values(unchanged).every(x=>x.historical===x.current),'same SHA256 as reviewed historical source',unchanged);
await mkdir(OUT,{recursive:true});
async function open(path,viewport){
 const page=await browser.newPage({viewport});await page.setViewportSize(viewport);const log={errors:[],failed:[],external:[],badResponses:[]};
 page.on('pageerror',e=>log.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')log.errors.push(m.text())});
 page.on('requestfailed',r=>log.failed.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));
 page.on('response',r=>{if(r.status()>=400)log.badResponses.push({path:new URL(r.url()).pathname,status:r.status()})});
 await page.route('**/*',r=>{const url=r.request().url();if(url.startsWith(BASE)||url.startsWith('data:')||url.startsWith('about:'))return r.continue();log.external.push(new URL(url).origin);return r.abort()});
 await page.goto(BASE+path,{waitUntil:'networkidle'});return {page,log};
}
async function common(page){return page.evaluate(()=>{
 const css=n=>n?getComputedStyle(n):null, root=document.querySelector('.gcsp'), main=document.querySelector('.gcsp-main'), header=document.querySelector('.gcsp-header'),nav=document.querySelector('.gcsp-nav'),h1=document.querySelector('h1'),btn=document.querySelector('.gcsp-rep .vm-btn-primary,.gcsp-greg-bar .vm-btn');
 return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,font:css(main)?.fontFamily,h1Size:css(h1)?.fontSize,accent:css(root)?.getPropertyValue('--gcsp-accent').trim(),headerHeight:header?.getBoundingClientRect().height,sidebarWidth:nav?.getBoundingClientRect().width,headerBackground:css(header)?.backgroundColor,pageBackground:css(document.querySelector('.gcsp-content')||main)?.backgroundColor,button:btn?{text:btn.textContent.trim(),font:css(btn).fontFamily,foreground:css(btn).color,background:css(btn).backgroundColor}:null};
})}
function logs(scope,log){for(const key of Object.keys(log))check(scope,'no-'+key,log[key].length===0,[],log[key])}
try{
 for(const [label,viewport] of [['desktop',{width:1280,height:900}],['narrow-320',{width:320,height:740}]]){
  {
   const scope='merged-gallery-'+label,{page,log}=await open('/components.html',viewport);
   await page.locator('[aria-label="Car experience launcher"] .demo-brand-control').waitFor();await page.locator('.vm-gallery-greg-section .gcsp-table').first().waitFor();
   const details=await page.evaluate(()=>{
    const launch=document.querySelector('[aria-label="Car experience launcher"]'),greg=document.querySelector('.vm-gallery-greg-section'),root=document.getElementById('component-gallery');
    const measure=n=>({width:n.clientWidth,scroll:n.scrollWidth,font:getComputedStyle(n).fontFamily});
    return {page:{width:innerWidth,scroll:document.documentElement.scrollWidth},launcher:measure(launch),greg:measure(greg),labels:[...root.querySelectorAll('section[aria-label]')].map(x=>x.getAttribute('aria-label')),allText:root.textContent,tiles:greg.querySelectorAll('.gcsp-tile').length,tables:greg.querySelectorAll('.gcsp-table').length,band:[...greg.querySelectorAll('.is-band')].map(x=>x.textContent),brand:launch.querySelector('select').value,cards:launch.querySelectorAll('.demo-experience-choice').length,disabled:[...launch.querySelectorAll('button')].every(x=>x.disabled),computed:{launcherFont:getComputedStyle(launch.querySelector('.vm')).fontFamily,gregFont:getComputedStyle(greg.querySelector('.vm')).fontFamily,accent:getComputedStyle(launch.querySelector('.gcsp')).getPropertyValue('--gcsp-accent').trim()},tableWrappers:[...greg.querySelectorAll('.gcsp-table-wrap')].map(x=>({width:x.clientWidth,scroll:x.scrollWidth,overflow:getComputedStyle(x).overflowX,tabindex:x.getAttribute('tabindex')}))};
   });
   check(scope,'both-integrated-sections',details.cards===2&&details.tiles===3&&details.tables===2,{cards:2,tiles:3,tables:2},details);
   check(scope,'preserved-existing-examples',details.labels.includes('Employee decision card')&&details.labels.includes('Employee question controls and preview')&&/Local employee brief fixture/.test(details.allText)&&/Confirm no charging access/.test(details.allText)&&details.labels.includes('GCSP'),'employee decisions, controls, brief and GCSP shared kit present',details.labels);
   check(scope,'gallery-no-page-or-section-overflow',details.page.scroll<=details.page.width&&details.launcher.scroll<=details.launcher.width&&details.greg.scroll<=details.greg.width,'page and both sections fit viewport',details);
   check(scope,'launcher-state-retained',details.brand==='motorrad'&&details.disabled,'BMW Motorrad, explained disabled states',details.brand);
   check(scope,'privacy-band-remains-text',details.band.length===2&&details.band.every(x=>x.startsWith('fewer than 5')),'fewer than 5',details.band);
   check(scope,'shared-font-token-language',details.computed.launcherFont.startsWith('system-ui')&&details.computed.gregFont.startsWith('system-ui')&&details.computed.accent==='#0b6c7e','system-ui and #0b6c7e',details.computed);
   const screenshots=[];for(const [name,selector] of [['launcher','[aria-label="Car experience launcher"]'],['greg-kit','.vm-gallery-greg-section']]){const file=`fucq33-integration-gallery-${name}-${label}.png`;await page.locator(selector).screenshot({path:join(OUT,file)});screenshots.push(file)}
   const url=page.url();await page.locator('[aria-label="Car experience launcher"] select').selectOption('ferrari');check(scope,'launcher-gallery-callback-stays-local',page.url()===url&&/Local selection: ferrari/.test(await page.locator('[aria-label="Car experience launcher"]').innerText()),'local Ferrari callback without navigation',page.url());
   delete details.allText;logs(scope,log);results.push({name:scope,viewport,details,screenshots,...log});await page.close();
  }
  const references=[];
  for(const [kind,path,ready] of [['employee','/gcsp-employee.html?fixture=representative','.gcsp-rep'],['greg','/gcsp-greg.html?fixture=populated','.gcsp-greg-body .gcsp-table-wrap']]){
   const scope=kind+'-reference-'+label,{page,log}=await open(path,viewport);await page.locator(ready).first().waitFor();const metrics=await common(page);
   check(scope,'no-page-overflow',metrics.scrollWidth<=metrics.viewport,metrics.viewport,metrics.scrollWidth);
   check(scope,'shared-reference-typography-and-accent',metrics.font?.startsWith('system-ui')&&metrics.accent==='#0b6c7e'&&metrics.h1Size===(label==='desktop'?'34px':'28px'),'system-ui, responsive34px/28px, #0b6c7e',metrics);
   if(kind==='greg'){
    const tables=await page.locator('.gcsp-table-wrap').evaluateAll(ns=>ns.map(n=>({client:n.clientWidth,scroll:n.scrollWidth,overflow:getComputedStyle(n).overflowX,tabindex:n.getAttribute('tabindex')})));
    check(scope,'tables-scroll-locally',tables.every(x=>x.scroll<=x.client||x.overflow==='auto'&&x.tabindex==='0'),'overflow contained in keyboard-focusable table wrappers',tables);
    check(scope,'refresh-ghost-button-style',metrics.button?.background==='rgb(255, 255, 255)'&&metrics.button?.foreground==='rgb(10, 96, 112)','white/teal accent-ink Refresh',metrics.button);
    metrics.tables=tables;
   }else{
    const oldMetrics=oldReference.find(x=>x.name===scope)?.metrics;
    check(scope,'employee-font-matches-reviewed-source',Boolean(oldMetrics)&&metrics.font===oldMetrics.fontFamily,'same employee body font as prior reviewed source',{current:metrics.font,historical:oldMetrics?.fontFamily});
   }
   const screenshot=`fucq33-integration-${kind}-${label}.png`;await page.screenshot({path:join(OUT,screenshot),fullPage:true});logs(scope,log);references.push(metrics);results.push({name:scope,viewport,metrics,screenshot,...log});await page.close();
  }
  const keys=['font','h1Size','accent','headerHeight','sidebarWidth','headerBackground','pageBackground'];check('reference-parity-'+label,'employee-greg-shared-shell',keys.every(k=>references[0][k]===references[1][k]),keys,references);
 }
}finally{await browser.close()}
const receipt={story:'FUCQ-33',sourceCommit:process.env.SOURCE_COMMIT,capturedAt:new Date().toISOString(),scope:'Focused post-FUCQ-101 integration review; launcher behavior matrix and native option picking are not rerun.',historicalReuse:{receipt:'docs/gcsp/evidence/fucq-12/fucq33-final-browser.json',unchangedHashes:unchanged,limits:'Historical browser red assertions and dispositions remain in fucq33-validation.json; no all-pass historical matrix claim.'},results,assertions,assertionFailures};
await writeFile(process.env.FINAL_RECEIPT_PARTIAL,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({cases:results.length,assertions:assertions.length,passed:assertions.filter(x=>x.pass).length,failures:assertionFailures}));process.exitCode=assertionFailures.length?1:0;
