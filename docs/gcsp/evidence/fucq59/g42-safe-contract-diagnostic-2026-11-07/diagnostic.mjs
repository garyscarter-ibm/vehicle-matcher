/** Independent finite evidence projection. This never changes the production grammar. */
import { createHash } from 'node:crypto';
import { createCollectionSession, assertCollectionHttpObservation } from '../../../../../scripts/gcsp/collection-session.mjs';
import { projectBmwRangeInventory, publicBmwInventoryOperations, validatePublicBmwInventoryPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { validateBmwInventoryRequestRegistration, bmwInventoryRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { CollectionError, requireValue } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const type = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const token = v => typeof v === 'string' && /^[A-Z0-9]{1,16}$/.test(v);
const unsafe = v => /(?:https?:|[?&=@]|api.?key|token|secret|password|authorization|bearer|cookie|credential)/i.test(v) || /[A-HJ-NPR-Z0-9]{17}/.test(v);
const privacy = (value, secrets) => {
  JSON.stringify(value,(key,entry) => {
    requireValue(!secrets.some(secret => key.includes(secret) || typeof entry === 'string' && entry.includes(secret)),
      'diagnostic-privacy-refused','Sensitive contract evidence is not retained.');
    return entry;
  });
};
const safeKey = (key,secrets) => {
  requireValue(typeof key === 'string' && /^[A-Za-z0-9_. +:\-]{1,96}$/.test(key) && !unsafe(key)
    && !secrets.some(secret => key.includes(secret)), 'diagnostic-privacy-refused','Unsafe contract keys are not retained.');
  return key;
};

export function projectContractDiagnostic(value,input,secrets=[]) {
  const r=validateBmwInventoryRequestRegistration(input);
  requireValue(Array.isArray(secrets) && secrets.every(s=>typeof s==='string'&&s.length>0),'diagnostic-privacy-refused','Use memory-only transport secrets.');
  let originalRefusal=null;
  try { projectBmwRangeInventory(value,r); }
  catch(error) { if (!(error instanceof CollectionError) || !/^source-inventory-[a-z-]+$/.test(error.code)) throw error; originalRefusal=error.code; }
  requireValue(object(value) && Object.keys(value).length<=100,'diagnostic-tree-limit','A finite direct tree is required.');
  const aliases=Object.keys(value).filter(a=>object(value[a]?.modelRanges)&&Object.hasOwn(value[a].modelRanges,r.catalogueRangeKey)).sort();
  requireValue(aliases.length>=1&&aliases.length<=8&&aliases.every(token),'diagnostic-alias-limit','Finite direct aliases are required.');
  const modelTree=Object.fromEntries(aliases.map(a=>[a,{modelRanges:{[r.catalogueRangeKey]:{models:value[a].modelRanges[r.catalogueRangeKey]?.models}}}]));
  const models=projectBmwRangeInventory(modelTree,r);
  const relationships=[]; let rejectedContract=null;
  const add=(entry,path,retain=false) => {
    requireValue(relationships.length<768,'diagnostic-rows-limit','Finite contract relationship row limit.');
    const row={path,type:type(entry)};
    if(retain&&token(entry)) row.value=entry;
    relationships.push(row);
  };
  const fields=(record,path,names) => { if(object(record)) for(const name of names) if(Object.hasOwn(record,name)) add(record[name],`${path}/${name}`,true); };
  for(const alias of aliases) {
    const range=value[alias].modelRanges[r.catalogueRangeKey]; const path=`/${alias}/modelRanges/${r.catalogueRangeKey}/lines`;
    if(!Object.hasOwn(range,'lines')) { relationships.push({path,type:'missing'}); continue; }
    const lines=range.lines;
    requireValue(object(lines)&&Object.keys(lines).length<=128,'diagnostic-lines-limit','Finite literal lines object required.');
    for(const key of Object.keys(lines).sort()) {
      safeKey(key,secrets); const line=lines[key]; const pointer=`${path}/${key}`;
      if(!token(key)) rejectedContract ||= {gate:'line',path:pointer,key,type:type(line)};
      add(line,pointer); fields(line,pointer,['option','modelCode','agModelCode']);
      if(!object(line)) continue;
      if(Object.hasOwn(line,'defaultModel')) { add(line.defaultModel,`${pointer}/defaultModel`); fields(line.defaultModel,`${pointer}/defaultModel`,['modelCode','agModelCode']); }
      if(!Object.hasOwn(line,'includedTransmissionVariants')) continue;
      const variants=line.includedTransmissionVariants; const vp=`${pointer}/includedTransmissionVariants`; add(variants,vp);
      if(!object(variants)&&!Array.isArray(variants)) continue;
      requireValue(Object.keys(variants).length<=128,'diagnostic-variants-limit','Finite included-variant entries required.');
      for(const index of Object.keys(variants).sort()) {
        safeKey(index,secrets); const variant=variants[index]; const ip=`${vp}/${index}`;
        if(!/^[A-Za-z0-9_.+-]{1,16}$/.test(index)) rejectedContract ||= {gate:'variant',path:ip,key:index,type:type(variant)};
        add(variant,ip); fields(variant,ip,['modelCode','agModelCode']);
        if(!object(variant)||!Object.hasOwn(variant,'configuration')) continue;
        const config=variant.configuration; const cp=`${ip}/configuration`; add(config,cp); fields(config,cp,['modelCode','agModelCode']);
        if(!object(config)||!Object.hasOwn(config,'elements')) continue;
        const elements=config.elements; add(elements,`${cp}/elements`);
        if(object(elements)&&Object.hasOwn(elements,key)) add(elements[key],`${cp}/elements/${key}`);
      }
    }
  }
  requireValue((originalRefusal==='source-inventory-line-key')===Boolean(rejectedContract),'diagnostic-refusal-mismatch','The independent gate trace must match the unchanged production refusal.');
  const report={schemaVersion:'bmw-safe-contract-diagnostic.v1',requestScope:{role:'request-input-only',...r},originalRefusal,rejectedContract,
    observedAliases:models.observedAliases,modelNodes:models.modelNodes,modelAliases:models.modelAliases,seedPresent:models.seedPresent,
    relationships,admitted:0,newConfigurations:0,sourceCapacityCredit:0};
  privacy(report,secrets);
  for(const node of report.modelNodes) for(const val of Object.values(node.facts)) requireValue(typeof val!=='string'||!unsafe(val),'diagnostic-privacy-refused','Unsafe contract facts are not retained.');
  requireValue(Buffer.byteLength(JSON.stringify(report))<=112*1024,'diagnostic-output-limit','Finite retained diagnostic bytes required.');
  return report;
}

export function validateDiagnostic(retained,plan,mode) {
  const doc=retained?.document; const bytes=JSON.stringify(doc)+'\n'; const m=doc?.observation; const r=doc?.report;
  requireValue(object(retained)&&Object.keys(retained).sort().join(',')==='bytes,document,sha256'&&retained.bytes===Buffer.byteLength(bytes)
    && retained.bytes<=128*1024&&retained.sha256===sha(bytes)&&doc.schemaVersion==='bmw-safe-contract-diagnostic-observation.v1'
    &&Object.keys(doc).sort().join(',')==='observation,report,schemaVersion'
    &&m?.operation==='discover'&&m.capability==='bmw-model-tree'&&m.sourceVersion===plan.source.version&&m.sourceId===plan.source.id
    &&m.observedAt?.slice(0,10)===plan.qualificationDate&&m.transportKind===(mode==='live'?'live':'fixture')
    &&inputDigest(m.request)===inputDigest({method:'GET',url:bmwInventoryRequestUrls(plan.inventoryRegistration).discover})
    &&r?.schemaVersion==='bmw-safe-contract-diagnostic.v1'&&r.admitted===0&&r.newConfigurations===0&&r.sourceCapacityCredit===0
    &&r.relationships.length<=768&&r.modelNodes.length<=512&&r.observedAliases.length<=8
    &&inputDigest(r.requestScope)===inputDigest({role:'request-input-only',...plan.inventoryRegistration}),
  'checkpoint-corrupt','Use the sealed exact diagnostic identity and zero-admission contract.');
  return retained;
}

export async function createContractDiagnostic({plan:input,statePath,http,mode,now=Date.now}={}) {
  const plan=validatePublicBmwInventoryPlan(input);
  requireValue(['live','source-fixture'].includes(mode)&&http?.kind===(mode==='live'?'live':'fixture'),'source-allocation-required','Use explicit registered transport.');
  const operations=publicBmwInventoryOperations(plan); const prepare=operations.discover.prepare; let secrets=[];
  operations.discover={...operations.discover,cache:false,prepare:async request=>{
    const p=await prepare(request); secrets=Object.values(p.headers); return p;
  },project:(value,_request,metadata)=>{
    assertCollectionHttpObservation(metadata);
    requireValue(metadata.sourceVersion===plan.source.version&&metadata.observedAt.slice(0,10)===plan.qualificationDate,'source-observation-date','Use the pinned actual observation day.');
    const document={schemaVersion:'bmw-safe-contract-diagnostic-observation.v1',observation:metadata,report:projectContractDiagnostic(value,plan.inventoryRegistration,secrets)};
    privacy(document,secrets); const bytes=JSON.stringify(document)+'\n';
    return validateDiagnostic({document,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)},plan,mode);
  }};
  const session=await createCollectionSession({identity:{planDigest:inputDigest(plan),sourceVersion:plan.source.version,stage:'safe-contract-diagnostic',version:'1',mode},operations,limits:plan.limits,statePath,http,now,
    initialState:{diagnosticObservation:null,accepted:[],rejected:[],duplicates:[]},validateState:state=>{
      requireValue(['accepted','rejected','duplicates'].every(key=>Array.isArray(state[key])&&state[key].length===0),'checkpoint-corrupt','Diagnostic admission arrays must remain empty.');
      if(state.diagnosticObservation) validateDiagnostic(state.diagnosticObservation,plan,mode);
    }});
  return {session,run:()=>session.withCheckpoint(async({state,execute,commit})=>{
    if(!state.halted&&!state.diagnosticObservation) {
      if(state.counts.httpAttempts>0) {state.halted='diagnostic-interrupted';await commit('diagnostic-stop');}
      else try {const page=await execute('page',{});await execute('settings',{path:page.settingsPath});state.diagnosticObservation=await execute('discover',{});await commit('diagnostic-observed');}
      catch(error) {if(!(error instanceof CollectionError)) throw error; state.halted=error.code;await commit('diagnostic-stop');}
    }
    return structuredClone({reason:state.halted||'source-contract-diagnostic-observed',counts:state.counts,diagnostic:state.diagnosticObservation,admitted:0,sourceCapacityCredit:0});
  },{stage:{id:'safe-contract-diagnostic',version:'1',inputDigest:inputDigest(plan)}})};
}
