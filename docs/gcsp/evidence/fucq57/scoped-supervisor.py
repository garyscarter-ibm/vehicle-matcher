from pathlib import Path
import sys,os,importlib.util,fcntl,subprocess,shlex,time,json
project=Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-030')
rdir=Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs')
sys.path.insert(0,str(project/'_tools'))
import scaffold_git as git_adapter
spec=importlib.util.spec_from_file_location('lookup_stamp',project/'_tools/test_stamp.py')
stamp=importlib.util.module_from_spec(spec);spec.loader.exec_module(stamp)
def git(root,args):
 rc,out,err=git_adapter.git(Path(root),args)
 if rc:raise stamp.RunError(err or out)
 return out.rstrip()
stamp._git=git
stamp.ref_exists=lambda root,ref: git_adapter.git(Path(root),["rev-parse","--verify","--quiet",ref+"^{commit}"])[0]==0
resources=stamp.resource_module()
OriginalScratch=resources.Scratch
class OwnedScratch(OriginalScratch):
 def __init__(self,*args,**kwargs):
  super().__init__(*args,**kwargs)
  self.manifest=rdir/'ownership'/('fucq57-20261105-offline-guard-scoped-'+self.token+'.json')
 def env(self,env):
  value=super().env(env)
  value["npm_config_cache"]=str(self.root/"npm-cache")
  value["NODE_V8_COVERAGE"]=str(self.root/"v8-coverage")
  return value
 def __exit__(self,kind,value,tb):
  allocated=resources.allocated_bytes(self.root)
  for sig in (15,9):
   for pid,start in list(owned_descendants.items()):
    if start and resources.process_identity(int(pid))==start:
     try:os.kill(int(pid),sig)
     except ProcessLookupError:pass
   if sig==15:time.sleep(.1)
  coverage=[]
  for path in (self.root/'v8-coverage').glob('*.json'):
   for entry in json.loads(path.read_text()).get('result',[]):
    if '/server/gcsp/vehicle-evidence/' in entry.get('url',''):
     coverage.append({'url':entry['url'],'functions':[{'name':f['functionName'],'covered':any(r['count']>0 for r in f['ranges'])} for f in entry['functions']]})
  resources.atomic_json(rdir/'impact'/('fucq57-'+self.token+'.json'),{'observations':'aggregate V8 function ranges; not per-test contexts','source':str(project),'functions':coverage})
  super().__exit__(kind,value,tb)
  self.record.update(scratchAbsent=not os.path.lexists(self.root),removedBytes=allocated,groupsAbsent=all(resources.group_has_live_members(g) is False for g in self.record['groups']),supervisorFinalizer=__file__)
  resources.atomic_json(self.manifest,self.record)
  if not self.record['groupsAbsent']:raise resources.ResourceError('Owned full process-group cleanup uncertain')
resources.Scratch=OwnedScratch
owned_descendants={}
run_results=[]
log_roots=[]
original_log_dir=stamp.new_log_dir
def owned_log_dir(base):
 import uuid
 path=Path(base)/'logs'/('fucq57-full-'+uuid.uuid4().hex)
 record=rdir/'ownership'/('fucq57-full-log-'+path.name+'.json')
 resources.atomic_json(record,{'state':'planned','root':str(path),'owner':resources.owner(),'supervisor':__file__})
 path.mkdir(parents=True)
 resources.atomic_json(path/'run.json',{'owner':os.getpid(),'finished':False})
 log_roots.append((path,record))
 return str(path)
stamp.new_log_dir=owned_log_dir
original_process=resources.run_process
def tracked_process(*args,**kwargs):
 result=original_process(*args,**kwargs)
 run_results.append(result)
 return result
resources.run_process=tracked_process
argv_evidence={'samplingSeconds':0.2,'samples':0,'maxObservedTestWorkers':0,'processes':{},'errors':[]}
original_rss=resources.group_rss
def observed_rss(pgid):
 snapshot=subprocess.run(['/bin/ps','-axo','pid=,ppid=,pgid=,rss=,stat=,args='],capture_output=True,text=True,timeout=3)
 if snapshot.returncode or snapshot.stderr or not snapshot.stdout.strip():
  raise resources.ResourceError('Cannot verify owned process fanout/RSS')
 table={}
 for row in snapshot.stdout.splitlines():
  values=row.strip().split(None,5)
  if len(values)==6:table[int(values[0])]=values
 members={pid for pid,v in table.items() if int(v[2])==pgid}
 while True:
  enlarged=members|{pid for pid,v in table.items() if int(v[1]) in members}
  if enlarged==members:break
  members=enlarged
 workers=0
 for pid in members:
  values=table[pid];args=shlex.split(values[5]);state=values[4]
  owned_descendants.setdefault(str(pid),resources.process_identity(pid))
  is_node=bool(args) and Path(args[0]).name=='node'
  is_worker=is_node and '.test.js' in values[5] and '--test' not in args and not state.startswith('Z')
  workers+=int(is_worker)
  if str(pid) not in argv_evidence['processes'] and len(argv_evidence['processes'])<512:
   argv_evidence['processes'][str(pid)]={'pid':pid,'ppid':int(values[1]),'pgid':int(values[2]),'argvObserved':args,'testWorker':is_worker,'state':state}
 argv_evidence['samples']+=1
 argv_evidence['maxObservedTestWorkers']=max(argv_evidence['maxObservedTestWorkers'],workers)
 if workers>1:raise resources.ResourceError('Unexpected full-suite fan-out: %d workers'%workers)
 return sum(int(table[pid][3])*1024 for pid in members)
resources.group_rss=observed_rss
stamp.resource_module=lambda:resources
load=stamp.load_settings
def settings(*args,**kwargs):
 value=load(*args,**kwargs)
 value.resources={**value.resources,'chunk_ram_mib':512,'unit_ram_mib':512,'chunk_scratch_mib':32,'unit_scratch_mib':32,'chunk_seconds':120,'log_mib':2}
 return value
stamp.load_settings=settings
if '--identity' in sys.argv[1:]:
 args=stamp.build_parser().parse_args(['--root',str(project),'--status','--command','node --test --test-concurrency=1 server/test/**/*.test.js'])
 st=settings(str(project),args.command)
 print(json.dumps({'head':stamp.head_commit(str(project)),'tree':stamp.tree_hash(str(project)),'codeKey':stamp.working_code_key(str(project),st.is_t0),'stampKey':stamp.stamp_key(str(project),st.is_t0),'executionIdentity':stamp.validation_identity(st,args)}))
 raise SystemExit(0)
lock=None
result_code=1
# Registered finally covers the supervisor and every Scratch allocation.
try:
 if '--full' in sys.argv[1:]:
  raise SystemExit('Full held: scoped supervisor cannot admit full execution')
  lockpath=Path('/Users/usget/.cache/agent-scaffolding/test-resources/full-suite.lock')
  lockpath.parent.mkdir(parents=True,exist_ok=True);lock=lockpath.open('a')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise SystemExit('Full-suite lock busy; no tests launched')
 result_code=stamp.main(['--root',str(project),*sys.argv[1:]])
finally:
 if '--targeted' in sys.argv[1:]:
  argv_evidence['processes']=list(argv_evidence['processes'].values())
  resources.atomic_json(rdir/'fucq57-20261105-offline-guard-scoped-argv.json',argv_evidence)
 if result_code==0:
  import shutil
  for path,record in log_roots:
   shutil.rmtree(path)
   resources.atomic_json(record,{'state':'removed','root':str(path),'absent':not path.exists(),'supervisor':__file__})
 if '--targeted' in sys.argv[1:]:
  reservations=resources.read_json(Path.home()/'.cache/agent-scaffolding/test-resources/reservations.json',{})
  summary={'results':run_results,'logRoots':[{'root':str(p),'absent':not p.exists()} for p,_ in log_roots],
   'ownedDescendants':owned_descendants,'ownedDescendantsAbsent':all(not start or resources.process_identity(int(pid))!=start for pid,start in owned_descendants.items()),
   'tokensAbsent':all(resources.read_json(item['manifest'],{}).get('token') not in reservations for item in run_results),
   'supervisor':__file__,'rc':result_code}
  resources.atomic_json(rdir/'fucq57-20261105-offline-guard-scoped-resource.json',summary)
 if lock is not None:fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
raise SystemExit(result_code)
