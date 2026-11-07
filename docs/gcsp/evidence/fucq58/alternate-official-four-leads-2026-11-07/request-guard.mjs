import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
/** Bind the existing transport to page, one literal discovered settings path and exact tree. */
export function guardedRequests({entry,directory,fetch}){
  let calls=0;const kinds=['page','settings','discover'];
  return async(url,options)=>{
    const operation=kinds[calls];
    if(options?.method!=='GET'||options?.redirect!=='manual'||options?.credentials!=='omit'||options?.cache!=='no-store'||!operation||typeof url!=='string'||url!==url.trim()||(operation==='settings'?!/^https:\/\/configure\.bmw\.co\.uk\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/.test(url):url!==entry.requests[operation]))throw new Error('exact-finite-public-request-required');
    calls++;
    await appendFile(join(directory,'request-identities.jsonl'),JSON.stringify({attempt:calls,operation,method:'GET',url,requestIdentitySha256:createHash('sha256').update('GET '+url).digest('hex')})+'\n',{mode:0o600});
    return fetch(url,options);
  };
}
