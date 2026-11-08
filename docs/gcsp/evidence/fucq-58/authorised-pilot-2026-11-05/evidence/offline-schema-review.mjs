import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
const root='/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-031';
const source='docs/gcsp/evidence/fucq-4/observations-2026-11-01.json';const prior=JSON.parse(await readFile(root+'/'+source));
assert.equal(prior.model.modelCode,'T5MJ');assert.equal(prior.model.agModelCode,'72HH');assert.equal(prior.model.steering,'RL');
const observed={modelCode:prior.model.modelCode,agModelCode:prior.model.agModelCode,modelRange:prior.model.modelRange,rawModelRange:prior.model.rawModelRange,steering:prior.model.steering,orderDate:prior.model.orderDate,effectDate:prior.model.effectDate};
// Independent synthetic counterexample: a cross-reference is shorter than the complete model.
const reference={modelCode:'T5MJ',agModelCode:'72HH'};const complete={...observed,reference};
const shortest=[complete,reference].sort((a,b)=>JSON.stringify(a).length-JSON.stringify(b).length)[0];
assert.equal(shortest.steering,undefined);assert.equal(complete.steering,'RL');
const result={version:'fleet-pilot-schema-review.v1',reviewedDate:new Date().toISOString(),networkRequests:0,
 historicalEvidence:{source,observedDate:'2026-11-01',selectedModel:observed,meaning:'Historical matched model contains literal RL; not a new5November steering observation or profile activation'},
 syntheticCounterexample:{kind:'synthetic',smallestCandidate:reference,fullRecordSteering:'RL',result:'Shortest model/AG node selection can choose a cross-reference and miss RHD on its parent; this reproduces a parser limitation, not the actual retained live hierarchy'},
 liveDisposition:{sourceHttp200:3,stop:'catalogue-steering-unconfirmed',interpretation:'The live parser could not corroborate steering in its selected compact subtree. No evidence establishes that the complete source lacks RHD. Raw response was memory-only and discarded, so this run cannot recover its hierarchy.',retainedModelTree:false,sourcePermissions:'approved',additionalLiveRequests:0},
 remaining:['Review a bounded allowlisted model-tree projection containing model/AG/context/steering path before a revised pilot','Corroborate exact UK profile semantics/year/plant/era independently','Map every scheme model line to actual dated constructible catalogue context; historical/discontinued generations cannot be silently replaced'],checks:{historicalModelAndAgAndRl:'passed',syntheticShortestNodeCounterexample:'passed'}};
await writeFile(root+'/docs/gcsp/evidence/fucq-58/authorised-pilot-2026-11-05/evidence/schema-review.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checks:2,result:'passed',networkRequests:0,profileActivated:false}));
