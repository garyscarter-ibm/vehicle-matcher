import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const root='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004';
const cleanups=[];const report={sourceCommit:'e81db95ae0198679f7d4daf08a2132ca3a3c942d',screenshots:[],geometry:[],errors:[],sourcePins:{}};let browser;const hash=b=>createHash('sha256').update(b).digest('hex');const output=resolve(root,'docs/gcsp/evidence/fucq345/flow-corrected');for(const file of ['blocks/gcsp/kit/vehicle-media.css','blocks/vehicle-matcher/component-gallery.js','blocks/vehicle-matcher/vehicle-matcher.css','blocks/vehicle-matcher/decision-card.css','blocks/gcsp/shell/gcsp-shell.css','blocks/gcsp/shell/gcsp-tokens.css'])report.sourcePins[file]=hash(await readFile(resolve(root,file)));report.captureScriptSha256=hash(await readFile('/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-gallery-media.mjs'));
const {createLocalHttpsFixture}=await import(pathToFileURL(resolve(root,'server/test/helpers/local-https.js')).href);
const tls=await createLocalHttpsFixture({after:fn=>cleanups.push(fn)});
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer({key:await readFile(tls.configuration.keyFile),cert:await readFile(tls.configuration.certFile)},async(req,res)=>{try{const pathname=new URL(req.url,'https://localhost').pathname;const file=resolve(root,'.'+pathname);if(!file.startsWith(root+'/'))throw Error();res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
try{
 await new Promise(r=>server.listen(0,'localhost',r));const origin=`https://localhost:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'allow'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 for(const width of [1280,375]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/components.html');const group=page.locator('.vm-gallery-gcsp-group').filter({has:page.getByRole('heading',{name:'mediaWell: selected review image and missing-photo frame',exact:true})});await group.waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const [index,name] of [[0,'13-long-content-media'],[1,'14-missing-photo-media']]){
   const media=group.locator('.vm-card-media').nth(index);await media.scrollIntoViewIfNeeded();if(index===0)await media.locator('img').evaluate(i=>i.decode());
   const geometry=await media.evaluate(m=>{const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const overlap=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)):0;const tag=rect(m.querySelector('.vm-card-line')),photo=rect(m.querySelector('img')),caption=rect(m.querySelector('.vm-media-caption')),placeholder=rect(m.querySelector('.vm-card-soon'));return {media:rect(m),tag,photo,caption,placeholder,tagPhotoOverlap:overlap(tag,photo),tagCaptionOverlap:overlap(tag,caption),tagPlaceholderOverlap:overlap(tag,placeholder)};});
   assert.equal(geometry.tagPhotoOverlap,0);assert.equal(geometry.tagCaptionOverlap,0);if(index===1){assert.equal(geometry.tagPlaceholderOverlap,0);assert.ok(geometry.media.height>=geometry.media.width*9/16-1);}report.geometry.push({name,width,...geometry});
   const bytes=await media.screenshot({type:'jpeg',quality:85,animations:'disabled'});const file=`${name}-${width}.jpg`;await writeFile(resolve(output,file),bytes);report.screenshots.push({file,viewportWidth:width,sha256:hash(bytes),bytes:bytes.length});
  }
 }
 assert.deepEqual(report.errors,[]);await context.close();
 report.status='verified';
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));for(const clean of cleanups.reverse())await clean();await writeFile(resolve(output,'gallery-media-receipt.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
