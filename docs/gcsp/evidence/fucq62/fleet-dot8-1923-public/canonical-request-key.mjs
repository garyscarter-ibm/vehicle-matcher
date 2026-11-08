import {createHash} from 'node:crypto';
export function canonicalRequestKey(request){return createHash('sha256').update(JSON.stringify({kind:request.kind,id:request.id})).digest('hex');}
