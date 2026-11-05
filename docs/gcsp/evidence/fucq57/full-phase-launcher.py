from pathlib import Path
import os,sys,json,time,subprocess,hashlib

project=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(project/'_tools'))
import test_resources as r

plan_path=project/'docs/gcsp/evidence/fucq57/full-plan.json'
plan=json.loads(plan_path.read_text())
freeze=json.loads(Path(plan['outsideFreeze']).read_text())
if freeze.get('admission')!='dispatcher-approved':raise SystemExit('Full not admitted')
if freeze['planSha256']!=hashlib.sha256(plan_path.read_bytes()).hexdigest():raise SystemExit('Plan changed after outside freeze')
if freeze['launcherSha256']!=hashlib.sha256(Path(__file__).read_bytes()).hexdigest():raise SystemExit('Launcher changed after freeze')
attempt=Path(plan['outsideAttempt'])
if attempt.exists():raise SystemExit('This admitted full attempt has already been launched; no automatic repeat')
rdir=Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs')
policy=r.Policy({'chunk_scratch_mib':8,'chunk_ram_mib':64,'chunk_seconds':180,'log_mib':2})
scratch=r.Scratch(rdir,project,policy,expected=8*r.MIB)
scratch.manifest=rdir/'ownership'/('fucq57-full-outer-'+scratch.token+'.json')
host=r.HostBudget(policy)
receipt={'planSha256':freeze['planSha256'],'freeze':freeze,'outsideFreeze':plan['outsideFreeze'],
 'outsideAttempt':str(attempt),'environment':plan['environment'],'command':plan['command'],
 'outer':{'pid':os.getpid(),'pgid':os.getpgrp(),'ppid':os.getppid(),'start':r.process_identity(os.getpid()),'argv':[sys.executable,*sys.argv]},
 'scratchRoot':str(scratch.root),'manifest':str(scratch.manifest),'supervisor':str(Path(__file__).resolve()),
 'state':'planned','phases':[],'limits':plan['outerLimits']}
r.atomic_json(attempt,receipt)
reserved=False
rc=1
started=time.monotonic()

def phase(name,mode,seconds):
 path=scratch.root/(name+'.log')
 args=[sys.executable,'-B',str(project/'docs/gcsp/evidence/fucq57/full-supervisor.py'),mode,'--command',plan['command']]
 item={'phase':name,'argv':args,'started':time.time()};issue=None
 with path.open('w') as output:
  process=subprocess.Popen(args,cwd=project,env=plan['environment'],stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
  scratch.child(process)
  item.update(pid=process.pid,pgid=os.getpgid(process.pid),start=r.process_identity(process.pid))
  receipt['phases'].append(item);r.atomic_json(attempt,receipt)
  deadline=time.monotonic()+seconds
  try:
   while process.poll() is None:
    used=scratch.sample()
    if time.monotonic()>deadline:issue='phase timeout'
    elif time.monotonic()-started>180:issue='outer attempt timeout'
    elif used>8*r.MIB:issue='outer scratch budget exceeded'
    elif path.stat().st_size>2*r.MIB:issue='phase output budget exceeded'
    elif __import__('shutil').disk_usage(scratch.root).free<policy.reserve:issue='emergency reserve'
    if issue:break
    time.sleep(.2)
  finally:r.stop_group(process)
 text=path.read_text(errors='replace')
 item.update(ended=time.time(),rc=process.returncode,issue=issue,
  stdout='\n'.join(text.splitlines()[-18:]) if process.returncode==0 else text[-16384:],
  joined=True,groupAbsent=r.group_has_live_members(process.pid) is False,
  processAbsent=r.process_identity(process.pid)!=item['start'])
 r.atomic_json(attempt,receipt)
 if issue or not item['groupAbsent'] or not item['processAbsent']:raise RuntimeError('Phase did not complete/clean safely: '+name)
 print(name+': exit '+str(item['rc']),flush=True)
 return item

try:
 host.acquire(scratch.token,8*r.MIB,64*r.MIB,str(project),root=scratch.root);reserved=True
 with r.handled_termination(),scratch:
  receipt['state']='running';r.atomic_json(attempt,receipt)
  before=phase('status-before','--status',15)
  if before['rc'] not in (0,1):raise RuntimeError('Unexpected preflight status')
  if before['rc']==0:raise RuntimeError('Matching full already exists; no repeat needed')
  full=phase('full','--full',135)
  if full['rc']!=0:raise RuntimeError('Required full failed; retained bounded failure summary')
  after=phase('status-after','--status',15)
  if after['rc']!=0:raise RuntimeError('Full metadata does not match')
  rc=0
except BaseException as error:
 receipt['error']=str(error)
finally:
 if reserved:host.release(scratch.token)
 receipt.update(state='passed' if rc==0 else 'failed',rc=rc,ended=time.time(),scratchAbsent=not os.path.lexists(scratch.root),
  groupsAbsent=all(r.group_has_live_members(g) is False for g in scratch.record['groups']),
  reservationAbsent=scratch.token not in r.read_json(host.path,{}),removedBytes=scratch.record['peak'])
 for key,name in [('resource','fucq57-20261105-offline-guard-full-resource.json'),('argv','fucq57-20261105-offline-guard-full-argv.json')]:
  path=rdir/name
  if path.is_file():receipt[key]=json.loads(path.read_text())
 stamp=rdir/('stamp-'+plan['stampKey']+'-default.json')
 if stamp.is_file():receipt['stamp']=json.loads(stamp.read_text())
 r.atomic_json(attempt,receipt)
 r.atomic_json(project/'docs/gcsp/evidence/fucq57/full-validation.json',receipt)
 print(json.dumps({k:receipt.get(k) for k in ['state','rc','error','scratchAbsent','groupsAbsent','reservationAbsent','removedBytes']},indent=2),flush=True)
raise SystemExit(rc)
