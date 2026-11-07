import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { qualifyPilotPlan, configurationKey } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-031/scripts/gcsp/fleet-plan.mjs';
const ROOT='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-031';
const planBytes=await readFile(path.join(ROOT,'server/data/gcsp/vehicle-evidence/fleet-plan.json'));
const plan=JSON.parse(planBytes); const pilot=qualifyPilotPlan(plan);
if (!pilot.ready || process.argv[2]!=='--execute-plan') throw Error('pilot plan not ready');
const output=plan.destinations.evidence.path;const imageOutput=plan.destinations.images.path;
for(const target of [output,imageOutput]) {
 if(!target.startsWith(ROOT+'/docs/gcsp/evidence/fucq-58/authorised-pilot-2026-11-05/'))throw Error('destination refused');
 await mkdir(target,{recursive:true});if(await realpath(target)!==target)throw Error('destination refused');
}
const sha=(value)=>createHash('sha256').update(value).digest('hex');
const sourceScript=await readFile(process.argv[1]);await writeFile(path.join(output,'pilot-client.mjs'),sourceScript,{flag:'wx'});
const old=JSON.parse(await readFile(path.join(ROOT,'docs/gcsp/evidence/fucq-4/configuration-generation-native-2026-11-01.json'),'utf8'));
const native=JSON.parse(await readFile(path.join(ROOT,'docs/gcsp/evidence/fucq-4/public-website-key-native-2026-11-01.json'),'utf8'));
const excerpts=JSON.parse(await readFile(path.join(ROOT,'docs/gcsp/evidence/fucq-4/response-excerpts-2026-11-01.json'),'utf8'));
const start=Date.now();const abortAll=new AbortController();const timer=setTimeout(()=>abortAll.abort(),plan.budgets.durationMs);
const summary={version:'fleet-pilot-observations.v1',observedDate:new Date().toISOString(),source:'public-bmw-uk-configurator',providerStatus:'unsupported-public-website',authorisation:plan.pilot.authorisationSource,planSha256:sha(planBytes),clientSha256:sha(sourceScript),requestedContext:plan.pilot.context,readOnly:true,writeRequests:0,requests:[],categoryCounts:{bootstrap:0,catalogue:0,solver:0,otd:0,manifest:0,images:0},downloadedBytes:0,builds:[],catalogue:null,image:null,profileQualified:0,unknownFields:['UK profile/year/era/plant','all scheme-model current catalogue joins','five-WMI multi-build coverage','verified fitted equipment'],status:'incomplete',stopped:null};
const limits=plan.pilot.requests;
function fail(code){const e=new Error(code);e.safeCode=code;throw e;}
async function get(category,url,headers={},image=false){
 if(abortAll.signal.aborted||Date.now()-start>=plan.budgets.durationMs)fail('elapsed-limit');
 if(summary.requests.length>=limits.total||summary.categoryCounts[category]>=limits[category])fail('request-budget');
 const parsed=new URL(url);const hosts=['configure.bmw.co.uk','prod.ucp.bmw.cloud','prod.cosy.bmw.cloud'];
 if(parsed.protocol!=='https:'||!hosts.includes(parsed.hostname)||parsed.username||parsed.password)fail('source-host');
 const record={category,attempt:summary.requests.length+1,status:null,bytes:0,elapsedMs:0};summary.requests.push(record);summary.categoryCounts[category]++;
 const abortOne=new AbortController();const t=setTimeout(()=>abortOne.abort(),plan.budgets.timeoutMs);const since=Date.now();
 let reader;
 try{
  const response=await fetch(url,{method:'GET',headers,credentials:'omit',cache:'no-store',redirect:'manual',signal:AbortSignal.any([abortOne.signal,abortAll.signal])});
  record.status=response.status;
  if(response.status>=300&&response.status<400)fail('redirect');
  if(response.status!==200)fail([401,403,429].includes(response.status)?'authentication-or-rate-limit':'source-http-failure');
  const contentType=(response.headers.get('content-type')||'').split(';')[0];record.contentType=contentType;
  if(image?!['image/webp','image/jpeg','image/png'].includes(contentType):!(category==='bootstrap'?['text/html','application/json'].includes(contentType):/json/.test(contentType)))fail('unexpected-content-type');
  const cap=image?plan.pilot.bytes.image:plan.pilot.bytes.response;
  const declared=Number(response.headers.get('content-length'));if(declared>cap){record.declaredBytes=declared;fail('response-too-large');}
  const chunks=[];reader=response.body.getReader();
  while(true){const part=await reader.read();if(part.done)break;record.bytes+=part.value.byteLength;summary.downloadedBytes+=part.value.byteLength;
   if(record.bytes>cap||summary.downloadedBytes>plan.pilot.bytes.total)fail('download-limit');chunks.push(part.value);}
  return Buffer.concat(chunks);
 }catch(e){record.failure=e.safeCode||(abortOne.signal.aborted?'request-timeout':abortAll.signal.aborted?'elapsed-limit':'transport-failure');fail(record.failure);}
 finally{if(reader)await reader.cancel().catch(()=>{});clearTimeout(t);record.elapsedMs=Date.now()-since;}
}
const parse=(buf)=>{try{return JSON.parse(buf.toString('utf8'));}catch{fail('unexpected-json');}};
function visit(v,fn,p=[]){if(!v||typeof v!=='object')return;fn(v,p);for(const[k,x]of Object.entries(v))if(x&&typeof x==='object')visit(x,fn,[...p,k]);}
function headerFor(settings,kind){
 const names={catalogue:/settingsVehicleTree$/i,options:/settingsLocalisation$/i,solver:/settings(RuleSolver|Rules|Constructibility)$/i,otd:/settingsOtd$/i,manifest:/settings(Cosy|Images|Image|ImageUrls)$/i};
 const candidates=[];visit(settings,(v,p)=>{if(p.length&&names[kind].test(p.at(-1)))candidates.push(v);});
 let values=[];for(const c of candidates)visit(c,(v)=>{for(const[k,x]of Object.entries(v))if(k.toLowerCase()==='x-api-key'&&typeof x==='string')values.push(x);if(String(v.name).toLowerCase()==='x-api-key'&&typeof v.value==='string')values.push(v.value);});
 values=[...new Set(values)];if(values.length!==1){summary.settingsProfileNames=[];visit(settings,(v,p)=>{if(p.length&&/^settings[A-Z]/.test(p.at(-1)))summary.settingsProfileNames.push(p.at(-1));});summary.settingsProfileNames=[...new Set(summary.settingsProfileNames)].slice(0,80);fail('settings-profile-shape:'+kind);}
 return {'x-api-key':values[0]};
}
function primitiveMatches(v,needle){let result=false;visit(v,(obj)=>{if(Object.values(obj).some(x=>x===needle))result=true;});return result;}
function modelRecord(tree){const records=[];visit(tree,(v,p)=>{if(Object.values(v).some(x=>x==='T5MJ')||p.at(-1)==='T5MJ')records.push(v);});const valid=records.filter(v=>primitiveMatches(v,'72HH'));valid.sort((a,b)=>JSON.stringify(a).length-JSON.stringify(b).length);if(!valid.length)fail('catalogue-model-ag-unconfirmed');return valid[0];}
function selectedFacts(v){const facts=[];visit(v,(obj,p)=>{for(const[k,x]of Object.entries(obj))if((typeof x==='string'||typeof x==='number'||typeof x==='boolean')&&/(?:model|range|steer|agcode|effectdate|orderdate|powertrain|drive|generation)/i.test(k)&&String(x).length<=120&&!/https?:|[A-HJ-NPR-Z0-9]{17}/.test(String(x)))facts.push({path:[...p,k].join('.'),value:x});});return facts.slice(0,80);}
try{
 const html=(await get('bootstrap',plan.pilot.bootstrap.pageUrl)).toString('utf8');
 const found=[...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)].map(x=>x[0].startsWith('/en_GB/')?x[0]:'/en_GB/'+x[0]);
 const paths=[...new Set(found)].filter(x=>new RegExp(plan.pilot.bootstrap.settingsPattern).test(x));if(paths.length!==1)fail('settings-discovery-shape');
 const settings=parse(await get('bootstrap','https://configure.bmw.co.uk'+paths[0]));
 const treeUrl=native.results.find(x=>x.requestId==='model-tree').url;
 const tree=parse(await get('catalogue',treeUrl,headerFor(settings,'catalogue')));const model=modelRecord(tree);
 const steering=primitiveMatches(model,'RL')||primitiveMatches(model,'RHD');
 const contradictory=primitiveMatches(model,'LL')||primitiveMatches(model,'LHD');if(!steering||contradictory)fail('catalogue-steering-unconfirmed');
 summary.catalogue={source:treeUrl,observedDate:new Date().toISOString(),modelCode:'T5MJ',agModelCode:'72HH',steering:'RHD',steeringSource:'RL/RHD literal within matched model record',selectedFacts:selectedFacts(model),fullSchemeCoverage:false};
 const facts=summary.catalogue.selectedFacts;for(const fact of facts){if(/effectDate$/i.test(fact.path)&&fact.value!==plan.pilot.context.effectDate)fail('catalogue-effect-date-mismatch');if(/orderDate$/i.test(fact.path)&&fact.value!==plan.pilot.context.orderDate)fail('catalogue-order-date-mismatch');}
 summary.catalogue.dateCompleteness={effectDate:facts.some(f=>/effectDate$/i.test(f.path))?'observed-matched':'not-returned-on-matched-model',orderDate:facts.some(f=>/orderDate$/i.test(f.path))?'observed-matched':'not-returned-on-matched-model'};
 const optionsUrl=native.results.find(x=>x.requestId==='options').url;
 const options=parse(await get('catalogue',optionsUrl,headerFor(settings,'options')));const families={paint:[],fabric:[],rim:[]};
 visit(options,(v,p)=>{const code=v.code||p.at(-1);if(/^[A-Z0-9]{4,12}$/.test(code||'')&&Object.hasOwn(families,v.optionType))families[v.optionType].push(code);});
 for(const name of Object.keys(families))families[name]=[...new Set(families[name])].sort();summary.catalogue.optionFamilies=families;
 const headers=headerFor(settings,'solver');
 for(let i=0;i<plan.pilot.seeds.length;i++){
  const seed=plan.pilot.seeds[i];const url=new URL(old.source+old.requests.rulePath);url.searchParams.set('included-elements',seed.join(','));url.searchParams.set('mandatory-elements','S0337');url.searchParams.set('add-rules-for-mandatory-element-classes','fabric,paint,rim');url.searchParams.set('application','connext');
  const result=parse(await get('solver',url.href,headers));const elements=result.configuration?.elements;
  if(result.constructible!==true||result.configuration?.modelCode!=='T5MJ'||!elements||typeof elements!=='object'||Array.isArray(elements))fail('solver-unconstructible-or-substituted');
  const codes=Object.keys(elements).sort();if(!codes.length||codes.some(x=>!/^[A-Z0-9]{4,12}$/.test(x))||!seed.every(x=>codes.includes(x)))fail('solver-incomplete-or-lost-selection');
  const accessoryCodes=Object.entries(elements).filter(([,v])=>v?.type==='accessory').map(([k])=>k).sort();
  if(codes.some(code=>code.startsWith('SE')&&!accessoryCodes.includes(code)))fail('accessory-classification-unconfirmed');
  const build={evidenceId:'pilot-'+(i+1),seedOptions:seed,constructible:true,resolvedModelCode:'T5MJ',requestedOptionsPreserved:true,completeSelectedElements:codes,selectedAccessories:accessoryCodes,selectionComplete:true,configurationId:configurationKey('T5MJ',codes,accessoryCodes),observedDate:new Date().toISOString(),source:old.source+old.requests.rulePath,context:plan.pilot.context,verifiedFitted:'unknown'};
  build.knownConfiguration=plan.families[0].configurations.some(v=>v.configurationId===build.configurationId);summary.builds.push(build);
  const otdUrl=new URL(old.source+old.requests.otdPath);otdUrl.searchParams.set('included-options',codes.join(','));const otd=parse(await get('otd',otdUrl.href,headerFor(settings,'otd')));
  if(!Array.isArray(otd.values))fail('otd-values-shape');const definitions={N_SITZE:['seats','count'],A_GEPR_V211:['luggageNormal','litres'],A_GEPR_V214:['luggageExpanded','litres'],E_0_100KMH:['acceleration0to100kmh','seconds']};
  build.technical={sourceStatus:typeof otd.status==='number'?otd.status:null,sourceStatusMeaning:'unknown',valueCount:otd.values.length,values:[]};
  for(const v of otd.values){const d=definitions[v.referenceName];if(d&&typeof v.targetValue==='number'&&Number.isFinite(v.targetValue))build.technical.values.push({name:d[0],value:v.targetValue,unit:d[1]});}
 }
 const build=summary.builds[0];const manifestUrl=new URL(excerpts.imageManifest.requestUrl);manifestUrl.searchParams.set('options',build.completeSelectedElements.join(','));
 const manifest=parse(await get('manifest',manifestUrl.href,headerFor(settings,'manifest')));
 if(!primitiveMatches(manifest,'72HH')||!build.completeSelectedElements.every(code=>primitiveMatches(manifest,code)))fail('image-response-identity-unconfirmed');
 const images=[];visit(manifest.desktop,(v)=>{if(typeof v.viewImage==='string'&&v.distinctionParameters?.POV==='HEROFRONT')images.push(v);});if(!images.length)fail('image-view-shape');
 const imageUrl=new URL(images[0].viewImage);if(imageUrl.protocol!=='https:'||imageUrl.hostname!=='prod.cosy.bmw.cloud')fail('image-host');
 const image=await get('images',imageUrl.href,{},true);const ext={'image/webp':'webp','image/png':'png','image/jpeg':'jpg'}[summary.requests.at(-1).contentType];const imageFile='representative-front.'+ext;await writeFile(path.join(imageOutput,imageFile),image,{flag:'wx'});
 summary.image={file:'../images/'+imageFile,configurationId:build.configurationId,source:'BMW COSY returned asset; opaque URL discarded',view:'HEROFRONT',fidelity:'representative-configuration-render; fitted equipment unverified',modelContext:'manifest request72HH and exact resolved selection; matching response identity and complete selection observed',bytes:image.length,sha256:sha(image),observedDate:new Date().toISOString()};
 summary.status='completed-bounded-pilot';
}catch(e){summary.status='stopped';summary.stopped=e.safeCode||'unexpected-shape-or-local-failure';}
finally{
 clearTimeout(timer);abortAll.abort();summary.elapsedMs=Date.now()-start;summary.attempts=summary.requests.length;
 summary.distinctObserved=new Set(summary.builds.map(x=>x.configurationId)).size;summary.additionalDistinct=new Set(summary.builds.filter(x=>!x.knownConfiguration).map(x=>x.configurationId)).size;
 await writeFile(path.join(output,'evidence.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:summary.status,stopped:summary.stopped,attempts:summary.attempts,bytes:summary.downloadedBytes,elapsedMs:summary.elapsedMs,builds:summary.builds.length,additionalDistinct:summary.additionalDistinct,evidence:path.join(output,'evidence.json')}));
}
