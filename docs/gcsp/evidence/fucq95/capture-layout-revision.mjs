// Bounded layout proof only. Background isolated browser; no saved commands or authenticated access.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const phase = process.argv[2] || 'initial';
if (!['initial', 'confirmed'].includes(phase)) throw new Error('Unknown phase');
const { chromium } = await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const SOURCES = ['gcsp-activity.html', 'components.html', 'blocks/gcsp/activity/activity-body.js', 'blocks/gcsp/activity/activity-offer.js',
  'blocks/gcsp/activity/activity-copy.js', 'blocks/gcsp/activity/activity-fixtures.js', 'blocks/gcsp/activity/harness.js',
  'blocks/gcsp/activity/gcsp-activity.css', 'blocks/gcsp/activity/activity-offer.css', 'blocks/gcsp/kit/action-menu.js', 'blocks/gcsp/kit/action-menu.css',
  'blocks/gcsp/kit/activity-timeline.js', 'blocks/gcsp/kit/activity-timeline.css', 'blocks/vehicle-matcher/component-gallery.js',
  'blocks/vehicle-matcher/vehicle-matcher.css', 'blocks/vehicle-matcher/gcsp-kit.css', 'blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/employee/gcsp-employee.js'];
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const path = resolve(ROOT, `.${name}`); if (!path.startsWith(ROOT + sep)) throw new Error('Outside root');
    const body = await readFile(path); res.writeHead(200, { 'Content-Type':mime[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser; const results = [];
const focus = (page) => page.evaluate(() => { const el = document.activeElement; const css = getComputedStyle(el);
  return { tag:el.tagName, name:(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80), outline:`${css.outlineStyle} ${css.outlineWidth}` }; });
async function open(path, viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion }); const page = await context.newPage();
  const logs = { console:[], failures:[], external:[] };
  page.on('console', (m) => { if (m.type() === 'error') logs.console.push(m.text()); }); page.on('pageerror', (e) => logs.console.push(String(e)));
  page.on('requestfailed', (r) => { if (!logs.external.includes(r.url())) logs.failures.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) logs.failures.push(`${r.status()} ${r.url()}`); });
  await page.route('**/*', (route) => { if (route.request().url().startsWith(base)) return route.continue(); logs.external.push(route.request().url()); return route.abort(); });
  await page.goto(base + '/' + path); return { page, context, logs };
}
async function state(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.gcsp-activity');
    const color = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    const lum = (rgb) => rgb.slice(0,3).map((n) => { const x=n/255; return x<=0.04045 ? x/12.92 : ((x+0.055)/1.055)**2.4; }).reduce((a,x,i) => a+x*[0.2126,0.7152,0.0722][i],0);
    const contrast = [...root.querySelectorAll('.gcsp-activity-status,.gcsp-activity-secondary,.gcsp-activity-check-status,.gcsp-activity-consequence,.gcsp-action-reason')].filter((el) => el.getClientRects().length).map((el) => {
      const fg=color(getComputedStyle(el).color); let at=el,bg;
      while(at) { const c=color(getComputedStyle(at).backgroundColor); if(c.length===3 || c[3]===1) { bg=c; break; } at=at.parentElement; }
      bg ||= [255,255,255]; const l=[lum(fg),lum(bg)].sort((a,b) => b-a);
      return { text:el.textContent.trim(), ratio:+((l[0]+0.05)/(l[1]+0.05)).toFixed(2) };
    });
    return { overflowPx:document.documentElement.scrollWidth-document.documentElement.clientWidth, text:root.innerText,
      status:root.querySelector('.gcsp-activity-status')?.textContent.trim(), image:root.querySelector('img') ? { src:root.querySelector('img').getAttribute('src'), alt:root.querySelector('img').alt, loaded:root.querySelector('img').complete && root.querySelector('img').naturalWidth>0 } : null,
      headings:[...root.querySelectorAll('h1,h2,h3')].map((el) => el.textContent), datedEvents:root.querySelectorAll('.gcsp-timeline-event').length,
      times:[...root.querySelectorAll('time')].map((el) => ({value:el.dateTime,text:el.textContent})), contrast,
      animations:[root,...root.querySelectorAll('*')].filter((el) => getComputedStyle(el).animationName!=='none').length };
  });
}
async function settle(page) { await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations!==Infinity).map((a) => a.finished.catch(() => {})))); }
async function menuCheck(page, expected) {
  const trigger=page.getByRole('button',{name:'Search actions',exact:true}); await trigger.focus(); await page.keyboard.press('ArrowDown');
  const item=page.getByRole('menuitem',{name:expected,exact:true}); const initial=await focus(page);
  const bounds=await page.getByRole('menu',{name:'Search actions',exact:true}).boundingBox();
  if(bounds.x<0 || bounds.x+bounds.width>page.viewportSize().width) throw new Error('Menu extends outside viewport');
  if (initial.name!==expected || await item.getAttribute('aria-disabled')!=='true') throw new Error('Menu opening/disabled semantics failed');
  await page.keyboard.press('Enter'); const disabledKeptOpen=await trigger.getAttribute('aria-expanded')==='true';
  for(const key of ['ArrowUp','ArrowDown','Home','End']) await page.keyboard.press(key);
  const reason=await page.locator('#'+await item.getAttribute('aria-describedby')).innerText();
  await page.keyboard.press('Escape'); const restored=await focus(page); if(restored.name!=='Search actions') throw new Error('Escape focus failed');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab'); const tabDismissed=await trigger.getAttribute('aria-expanded')==='false';
  await trigger.click(); await page.evaluate(() => { const b=document.createElement('button'); b.id='proof-outside'; b.textContent='Outside proof target'; document.body.append(b); });
  await page.locator('#proof-outside').click(); const outsideFocus=await focus(page); const outsideDismissed=await trigger.getAttribute('aria-expanded')==='false';
  await page.locator('#proof-outside').evaluate((el) => el.remove());
  if(!disabledKeptOpen || !tabDismissed || !outsideDismissed || outsideFocus.name!=='Outside proof target') throw new Error('Menu dismissal failed');
  return { initial, bounds, reason, disabledKeptOpen, escapeFocus:restored, tabDismissed, outsideDismissed, outsideFocus };
}
try {
  await mkdir(OUT,{recursive:true}); browser=await chromium.launch({channel:'chrome',headless:true});
  for(const [size,viewport] of [['desktop',{width:1280,height:900}],['narrow-375',{width:375,height:812}]]) {
    for(const fixture of ['offer','never-checked','paused','unavailable']) {
      const {page,context,logs}=await open(`gcsp-activity.html?fixture=${fixture}`,viewport); await page.waitForSelector('.gcsp-activity'); await settle(page);
      if(fixture==='offer') await page.locator('.gcsp-activity img').evaluate((img) => img.decode());
      const observed=await state(page); let menu,retry;
      if(fixture!=='unavailable') menu=await menuCheck(page,fixture==='paused'?'Resume Search':'Pause Search');
      else { const control=page.getByRole('button',{name:'Retry',exact:true}); await control.focus(); await page.keyboard.press('Enter'); retry={focus:await focus(page),announcement:await page.locator('.gcsp-activity-preview-status').innerText()}; if(retry.focus.name!=='Retry') throw new Error('Retry focus lost'); }
      if(fixture==='offer' && (!observed.image?.loaded || !observed.text.includes('Representative BMW brand image'))) throw new Error('Actual activity offer image absent');
      if(fixture==='never-checked' && (observed.image || !observed.text.includes('No current offer'))) throw new Error('No-offer projection fabricated media');
      const file=`layout-${phase}-${fixture}-${size}.png`; await page.screenshot({path:join(OUT,file),fullPage:true});
      let menuFile;
      if(fixture==='offer') { await page.getByRole('button',{name:'Search actions',exact:true}).click(); menuFile=`layout-${phase}-menu-${size}.png`; await page.screenshot({path:join(OUT,menuFile),fullPage:true}); await page.keyboard.press('Escape'); }
      results.push({name:`${fixture}-${size}`,viewport,file,menuFile,...observed,menu,retry,...logs}); await context.close();
    }
    const {page,context,logs}=await open('components.html',viewport); await page.waitForSelector('[data-offer-example="multiple"]'); await settle(page);
    const multiple=page.locator('[data-offer-example="multiple"]'); const second=multiple.getByRole('button',{name:'Image 2',exact:true}); await second.focus(); await page.keyboard.press('Enter');
    const imageSelection={pressed:await second.getAttribute('aria-pressed'),focus:await focus(page)}; if(imageSelection.pressed!=='true' || imageSelection.focus.name!=='Image 2') throw new Error('Image control failed');
    const media={absent:await page.locator('[data-offer-example="absent"] img').count(),broken:await page.locator('[data-offer-example="broken"] img').count(),imageSelection};
    if(media.absent || media.broken) throw new Error('Image fallback failed');
    const file=`layout-${phase}-gallery-offer-${size}.png`; await page.locator('section[aria-label="Buddy activity"] .gcsp-activity').first().screenshot({path:join(OUT,file)});
    results.push({name:`gallery-${size}`,file,viewport,media,overflowPx:await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth),...logs}); await context.close();
  }
  const {page,context,logs}=await open('gcsp-activity.html?fixture=paused',{width:375,height:812},'reduce'); await page.waitForSelector('.gcsp-activity');
  const menu=await menuCheck(page,'Resume Search'); results.push({name:'reduced-motion-narrow',...(await state(page)),menu,...logs}); await context.close();
} finally { if(browser) await browser.close(); await new Promise((done) => server.close(done)); }
const sourceIdentity=Object.fromEntries(await Promise.all(SOURCES.map(async(name) => [name,createHash('sha256').update(await readFile(join(ROOT,name))).digest('hex')])));
const issues=results.filter((r) => r.overflowPx>0 || r.console.length || r.failures.length || r.external.length || r.animations>0 || r.contrast?.some((c) => c.ratio<4.5)).map((r) => r.name);
await writeFile(join(OUT,`layout-${phase}-render-matrix.json`),JSON.stringify({phase,scope:'bounded activity layout revision; synthetic stored-offer reader projection, representative brand image',headless:true,isolated:true,sourceIdentity,results,issues},null,2)+'\n');
console.log(JSON.stringify({phase,checks:results.length,issues})); if(issues.length) process.exitCode=1;
