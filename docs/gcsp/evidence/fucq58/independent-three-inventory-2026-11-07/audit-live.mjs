import {readFile,open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditRetainedRequests} from '../alternate-official-four-leads-2026-11-07/audit-live.mjs';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const series=JSON.parse(await readFile(join(base,'series-plan.json')));const entry=series.contexts.find(e=>e.id===process.argv[2]);
if(!entry)throw new Error('exact-declared-context-required');
const directory=join(series.outputRoot,entry.id);const plan=JSON.parse(await readFile(join(root,entry.qualificationPlanPath)));
const result=await auditRetainedRequests({plan,directory,id:entry.allocationId,mode:'live',entry});
const file=await open(join(directory,'live-validation.json'),'wx',0o600);try{await file.writeFile(JSON.stringify(result)+'\n');await file.sync();}finally{await file.close();}
console.log(JSON.stringify({context:entry.id,...result}));
