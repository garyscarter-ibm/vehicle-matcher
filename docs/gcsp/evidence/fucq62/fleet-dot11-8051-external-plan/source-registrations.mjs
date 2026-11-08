// Offline build-only trust from exact parent-reviewed file hashes. Never used by production lookup.
import assert from 'node:assert/strict';
import {indexJsonl} from '../../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import {inputDigest} from '../../../../../server/gcsp/repository/core.js';
import {validateBmwCatalogueV2Envelope} from '../../../../../server/vehicle-evidence/bmw-catalogue-v2.js';
export async function sourceRegistrations(files,policy){
 const assumptions=policy.assumptions;assert.equal(assumptions['stock.configuration.modelCodeField'].value,'vgModelCode');assert.equal(assumptions['stock.configuration.codeSeparator'].value,',');assert.equal(assumptions['stock.configuration.includePaintAndUpholstery'].value,true);assert.equal(assumptions['stock.configuration.encoding'].value,'base64-padded');
 const key=identity=>{const model=identity.vgModelCode,codes=identity.factoryOptionCodes;assert.match(model,/^[A-Z0-9]{2,16}$/);assert.ok(Array.isArray(codes)&&codes.length>0&&codes.length<=256);assert.ok(codes.every(c=>typeof c==='string'&&/^[A-Z0-9]{2,16}$/.test(c)));assert.equal(new Set(codes).size,codes.length);const decodedIdentity=model+':'+[...codes].sort().join(',');return {configurationId:Buffer.from(decodedIdentity).toString('base64'),decodedIdentity,signaturePolicyVersion:policy.policyVersion};};key.policyVersion=policy.policyVersion;
 const registrations=[],seen=new Set();
 for(const file of files){
  const indexed=await indexJsonl(file.path,{key:row=>row.configurationId,maxBytes:33554432,maxRows:100000,maxRowBytes:1048576});assert.equal(indexed.checksum,file.sha256);assert.ok(indexed.length);
  for(const entry of indexed.metadataEntries()){
   assert.equal(seen.has(entry.key),false,'Duplicate admitted source identity');seen.add(entry.key);const record=indexed.get(entry.key),expected=record.catalogue,binding=expected?.sourceBinding;assert.equal(record.admission,true);assert.equal(record.sourceKind,'dated-snapshot');assert.equal(record.source.id,'bmw-uk-public');assert.equal(record.configurationId,expected.lookupIdentity.configurationId);assert.ok(binding);
   const trusted=()=>({configurationKey:key,producerPins:binding.producerPins,evidencePins:binding.evidence,requestScope:binding.requestScope,confirmedContext:binding.confirmedContext});const qualified=validateBmwCatalogueV2Envelope(JSON.stringify(expected),trusted());assert.equal(qualified.status,'valid');
   registrations.push(Object.freeze({lookupIdentity:Object.freeze(structuredClone(qualified.lookupIdentity)),qualifySnapshot(snapshot){const original=indexed.get(entry.key),envelope=original.catalogue,b= envelope.sourceBinding;const checked=validateBmwCatalogueV2Envelope(typeof snapshot==='string'?snapshot:JSON.stringify(snapshot),{configurationKey:key,producerPins:b.producerPins,evidencePins:b.evidence,requestScope:b.requestScope,confirmedContext:b.confirmedContext});return checked.status==='valid'&&inputDigest(checked.envelope)===inputDigest(envelope)?{status:'qualified',envelope:checked.envelope}:{status:'invalid',envelope:null};}}));
  }
 }
 assert.equal(registrations.length,8050);return registrations;
}
