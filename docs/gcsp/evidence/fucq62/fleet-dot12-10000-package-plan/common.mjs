import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
export async function sha(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
export async function check(pin){assert.equal((await stat(pin.path)).size,pin.bytes);assert.equal(await sha(pin.path),pin.sha256,pin.path);}
