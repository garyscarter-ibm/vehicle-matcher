"""Bounded one-worker exact suffix preflight; no source allocation or marker."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,subprocess,time
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
series=read(BASE/'series-plan.json');identity={p:sha(ROOT/p) for p in series['codePins']};assert identity==series['codePins']
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
OUT=ROOT/'.claude/test-runs/f70-trim-package-suffix-20261107'/('check-'+str(time.time_ns()))
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1});scratch=R.Scratch(OUT,ROOT,policy,expected=64*R.MIB)
host=R.HostBudget(policy);host._dead_owners=lambda:{}
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
entered=reserved=finished=False;link_identity=None;result={};cleanup={}
def finalize():
 global entered,reserved,finished,link_identity,cleanup
 if finished:return
 groups=all(R.group_has_live_members(p) is False for p in scratch.record['groups']);assert groups
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip()
 if link_identity is not None:
  s=link.lstat();assert (s.st_dev,s.st_ino)==link_identity and link.is_symlink() and link.readlink()==vendor;link.unlink();link_identity=None
 if entered:scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 cleanup={'scratch_root':str(scratch.root),'ownership_manifest':str(scratch.manifest),'scratch_absent':not os.path.lexists(scratch.root),'groups_absent':groups,'dependency_link_absent':not os.path.lexists(link),'reservation_absent':scratch.token not in (R.read_json(host.path,{}) or {}),
  'removed_allocation_bytes':scratch.record['peak'],'code_identity_unchanged':identity=={p:sha(ROOT/p) for p in identity},'suffix_marker_absent':not (pathlib.Path(series['outputRoot'])/'suffix-once.json').exists(),'compatibility_exception':None}
 R.atomic_json(OUT/'cleanup.json',cleanup);finished=True
atexit.register(finalize)
probe=len(sys.argv)==2 and sys.argv[1]=='--lifecycle-probe'
assert len(sys.argv)==1 or probe
for filename in ['supervise.py','verify-retained.py']:
 assert 'scratch.root =' not in (BASE/filename).read_text()
command=['/usr/bin/python3','-I','-B','-c',"import os,pathlib,json;p=pathlib.Path(os.environ['TMPDIR'])/'probe';p.write_bytes(b'owned-default-scratch');print(json.dumps({'status':'owned-scratch-lifecycle-probe','sourceTraffic':0}))"] if probe else ['/opt/homebrew/bin/node',str(BASE/'check-prepared.mjs')]
assert scratch.root.name=='test-stamp-shard-'+scratch.token
R.atomic_json(OUT/'plan.json',{'scope':'scoped exact252suffix preflight','changed_paths':list(identity),'regression':'unspent original suffix and actual pilot novelty','callers':['legacy batch validator','exact URL builder','current cumulative indexes'],
 'selected':command,'exclusions':['source traffic','full suite','publication','application acceptance'],'resources':{'workers':1,'hostMiB':512,'childMiB':448,'scratchMiB':64,'seconds':120}})
with R.handled_termination():
 try:
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  assert not os.path.lexists(link);link.symlink_to(vendor,target_is_directory=True);s=link.lstat();link_identity=(s.st_dev,s.st_ino)
  env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','TZ':'UTC','NODE_V8_COVERAGE':str(scratch.root/'coverage')}
  result=R.run_process(command,ROOT,env,OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,120,host)
  log=(OUT/'check.log').read_text();R.atomic_json(OUT/'result.json',result)
  if result['rc'] or result['issue']:print(log[-12000:]);raise RuntimeError('suffix check incomplete')
  result['check']=json.loads(log.strip().splitlines()[-1]);(OUT/'check.log').unlink()
  coverage=[]
  for p in (scratch.root/'coverage').glob('*.json'):
   for script in read(p)['result']:
    if str(ROOT) in script['url'] and '/node_modules/' not in script['url']:coverage.append({'url':script['url'],'functions':script['functions']})
  R.atomic_json(OUT/'coverage.json',coverage)
 finally:finalize()
assert all(cleanup[k] for k in ['scratch_absent','groups_absent','dependency_link_absent','reservation_absent','code_identity_unchanged','suffix_marker_absent'])
R.atomic_json(OUT/'result.json',{'result':result,'cleanup':cleanup,'identity':identity,'scope':'scoped','sourceTraffic':0});print(json.dumps({'out':str(OUT),'result':result,'cleanup':cleanup}))
