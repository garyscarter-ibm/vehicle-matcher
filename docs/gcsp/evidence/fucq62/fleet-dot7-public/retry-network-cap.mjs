// Narrow only the reviewed runner's public-download child to at most44 approved requests.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {promisify} from 'node:util';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const output=process.argv.at(-1);assert(isAbsolute(output));const scratch=process.env.TMPDIR;assert(isAbsolute(scratch)&&/\/test-stamp-shard-[a-f0-9]+$/.test(scratch));
const root=fileURLToPath(new URL('../../../../../',import.meta.url));const capture=join(output,'retry-network-limit.json');const preload=join(scratch,'retry-child-network-cap.mjs');
writeFileSync(preload,`import {writeFileSync} from 'node:fs';import {approvedAssetUrl} from ${JSON.stringify(pathToFileURL(join(root,'server/gcsp/vehicle-evidence/fleet-release.js')).href)};const original=globalThis.fetch;let attempts=0,denied=0;globalThis.fetch=async(url,options)=>{attempts++;if(attempts>44){denied++;throw Error('Retry44-request limit');}try{approvedAssetUrl(String(url));const h=new Headers(options?.headers);if(h.has('authorization')||h.has('cookie'))throw Error('Anonymous retry only');}catch(e){denied++;throw e;}return original(url,options);};process.on('exit',()=>writeFileSync(${JSON.stringify(capture)},JSON.stringify({attempts,limit:44,denied,approvedOnly:true,authorization:false,cookie:false})));`);
let downloadChildren=0;const original=childProcess.execFile;const originalAsync=promisify(original);
function narrow(args){const [file,argv,...rest]=args;if(Array.isArray(argv)&&argv.includes(join(root,'server/scripts/fleet-artifacts.mjs'))&&argv.includes('--network')&&argv[argv.indexOf('--network')+1]==='download'){downloadChildren++;assert.equal(downloadChildren,1);return[file,['--import',preload,...argv],...rest];}return args;}
function bounded(...args){return Reflect.apply(original,this,narrow(args));}
Object.defineProperty(bounded,promisify.custom,{value:(...args)=>originalAsync(...narrow(args))});childProcess.execFile=bounded;syncBuiltinESMExports();
process.on('exit',()=>writeFileSync(join(output,'retry-wrapper.json'),JSON.stringify({downloadChildren,reviewedRunnerUnchanged:true,networkLimit:44})));
