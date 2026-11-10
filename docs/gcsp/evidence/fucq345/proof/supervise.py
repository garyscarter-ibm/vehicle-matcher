import sys, os, json, importlib.util, hashlib
from pathlib import Path
ROOT=Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004')
RETAIN=Path('/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py'); R=importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
label=sys.argv[1]; command=sys.argv[2:]
policy=R.Policy({'chunk_scratch_mib':128,'chunk_ram_mib':1024,'unit_scratch_mib':128,'unit_ram_mib':1024,'chunk_seconds':600,'local_scratch_reason':'Bounded Node test/browser profile working set; no large output intended'})
unit={'id':label,'seconds':600,'disk':128*R.MIB,'ram':1024*R.MIB}
code={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['blocks/gcsp','blocks/vehicle-matcher','server/gcsp','server/test'] for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in ('.js','.css','.json','.mjs')}
identity={'run':'20261110-01a1c587-fucq345','label':label,'command':command,'code':code}
def launch(chunk,scratch,log,disk,ram,timeout,host,cancel):
 return R.run_process(command,str(ROOT),dict(os.environ),log,scratch,policy,disk,ram,timeout,host,cancel)
data=R.execute([unit],identity,str(ROOT),'/Users/usget/Claude/vehicle-matcher/.claude/test-runs/fucq345-20261110',RETAIN/('fucq345-'+label+'-logs'),policy,1,launch)
(RETAIN/('fucq345-'+label+'-receipt.json')).write_text(json.dumps(data,indent=2)+'\n')
for item in data['completed'].values():
 result=item['result']; text=Path(result['log']).read_text(); print(text[-11000:]); print(json.dumps({k:result[k] for k in ['rc','wall','issue','peak_scratch','peak_rss','cleanup']}))
print('RESOURCE_STATE',data['state'])
sys.exit(0 if data['state']=='complete' and all(x['result']['rc']==0 for x in data['completed'].values()) else 1)
