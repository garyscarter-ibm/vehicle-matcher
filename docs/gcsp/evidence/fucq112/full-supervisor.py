from pathlib import Path
import sys,os,importlib.util,fcntl,subprocess,shlex,time,json
project=Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-081')
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
resources=stamp.resource_module()
OriginalScratch=resources.Scratch
class OwnedScratch(OriginalScratch):
 def __init__(self,*args,**kwargs):
  super().__init__(*args,**kwargs)
  self.manifest=rdir/'ownership'/('fucq112-20261105-cases-full-'+self.token+'.json')
 def __exit__(self,kind,value,tb):
  allocated=resources.allocated_bytes(self.root)
  super().__exit__(kind,value,tb)
  self.record.update(scratchAbsent=not os.path.lexists(self.root),removedBytes=allocated,groupsAbsent=all(resources.group_has_live_members(g) is False for g in self.record['groups']),supervisorFinalizer=__file__)
  resources.atomic_json(self.manifest,self.record)
  if not self.record['groupsAbsent']:raise resources.ResourceError('Owned full process-group cleanup uncertain')
resources.Scratch=OwnedScratch
argv_evidence={'samplingSeconds':0.2,'samples':0,'maxObservedTestWorkers':0,'processes':{},'errors':[]}
original_rss=resources.group_rss
def observed_rss(pgid):
 rss=original_rss(pgid)
 if '--full' not in sys.argv[1:]:return rss
 snapshot=subprocess.run(['/bin/ps','-axo','pid=,ppid=,pgid=,stat=,args='],capture_output=True,text=True,timeout=3)
 if snapshot.returncode==0:
  workers=0
  for row in snapshot.stdout.splitlines():
   values=row.strip().split(None,4)
   if len(values)!=5 or values[2]!=str(pgid):continue
   pid,ppid,group,state,command=values
   args=shlex.split(command)
   is_node=bool(args) and Path(args[0]).name=='node'
   is_worker=is_node and '--test-isolation=process' in args and not state.startswith('Z')
   workers+=int(is_worker)
   if pid not in argv_evidence['processes'] and len(argv_evidence['processes'])<512:
    argv_evidence['processes'][pid]={'pid':int(pid),'ppid':int(ppid),'pgid':int(group),'argvObserved':args,'testWorker':is_worker,'state':state}
  argv_evidence['samples']+=1
  argv_evidence['maxObservedTestWorkers']=max(argv_evidence['maxObservedTestWorkers'],workers)
  if workers>1:raise resources.ResourceError('Unexpected full-suite fan-out: %d workers'%workers)
 elif len(argv_evidence['errors'])<5:argv_evidence['errors'].append({'rc':snapshot.returncode,'stderr':snapshot.stderr[:500]})
 return rss
resources.group_rss=observed_rss
stamp.resource_module=lambda:resources
load=stamp.load_settings
def settings(*args,**kwargs):
 value=load(*args,**kwargs)
 value.resources={**value.resources,'chunk_ram_mib':768,'unit_ram_mib':768,'chunk_scratch_mib':128,'unit_scratch_mib':128,'chunk_seconds':600,'log_mib':2}
 return value
stamp.load_settings=settings
lock=None
try:
 if '--full' in sys.argv[1:]:
  lockpath=Path('/Users/usget/.cache/agent-scaffolding/test-resources/full-suite.lock')
  lockpath.parent.mkdir(parents=True,exist_ok=True);lock=lockpath.open('a')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise SystemExit('Full-suite lock busy; no tests launched')
 raise SystemExit(stamp.main(['--root',str(project),*sys.argv[1:]]))
finally:
 if '--full' in sys.argv[1:]:
  argv_evidence['processes']=list(argv_evidence['processes'].values())
  resources.atomic_json(rdir/'fucq112-20261105-cases-full-argv.json',argv_evidence)
 if lock is not None:fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
