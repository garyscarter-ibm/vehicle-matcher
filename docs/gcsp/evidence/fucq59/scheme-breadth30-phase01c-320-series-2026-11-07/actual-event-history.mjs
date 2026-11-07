/** Exact retained rows only. Preserve all originals and refuse conflicting duplicates. */
import{readFileSync,readdirSync}from'node:fs';import{join}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';
export function actualEventHistory(base,allocation,state){
 const distinct=new Map(),sources=[];let duplicates=0;
 for(const name of readdirSync(base).filter(n=>/^source-events.*\.jsonl$/.test(n)).sort()){
  const bytes=readFileSync(join(base,name)),lines=bytes.toString('utf8').split('\n').filter(r=>r.trim());sources.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),rows:lines.length});
  for(const raw of lines){const row=JSON.parse(raw);assert.ok(['started','headers-received','transport-refused'].includes(row.phase));assert.equal(Object.hasOwn(row,'url')||Object.hasOwn(row,'headers'),false);const key=row.attempt+':'+row.phase;if(distinct.has(key)){assert.equal(distinct.get(key).raw,raw,'conflicting actual event rows');duplicates++;}else distinct.set(key,{raw,row});}
 }
 const events=[...distinct.values()].map(v=>v.row).sort((a,b)=>a.attempt-b.attempt||(a.phase==='started'?-1:1)),starts=events.filter(r=>r.phase==='started');
 assert.deepEqual(starts.map(r=>r.attempt),Array.from({length:allocation.attempts},(_,i)=>i+1));assert.equal(starts.length,state.counts.httpAttempts);
 return{events,sources,duplicates,synthesizedRows:0};
}
