"""One bounded selector observation; exact release required before allocation/network."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, subprocess
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(pathlib.Path(p).read_text())
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
A = read(BASE/'execution-plan.json')
assert len(sys.argv) == 2 and sys.argv[1] == 'live', 'explicit-live-phase-required'
assert os.environ.get('BMW_MISSING20_SELECTOR_GRANT') == A['id'], 'exact-parent-selector-grant-required'
release = read(BASE/'parent-release.json')
assert release['status']=='released-once' and release['allocationId']==A['id'] and release['planSha256']==sha(BASE/'execution-plan.json'), 'exact-parent-release-required'
identity = {p:sha(ROOT/p) for p in {**A['codePins'],**A['inputPins']}}
assert identity == {**A['codePins'],**A['inputPins']}
assert sha(A['runtime']['path']) == A['runtime']['sha256']
OUT=pathlib.Path(A['controlRoot']); output=pathlib.Path(A['outputRoot'])
assert not output.exists() and not output.is_symlink(), 'selector-allocation-already-created-never-replay'
spec=importlib.util.spec_from_file_location('resources', ROOT/'_tools/test_resources.py')
R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':16,'chunk_ram_mib':256,'chunk_seconds':45,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=16*R.MIB,checkpoint=output/'receipt.json')
host=R.HostBudget(policy);host._dead_owners=lambda:{}
entered=reserved=finished=False;result={};created=False
OUT.mkdir(parents=True,exist_ok=True)
def write_new(p,v):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x')as f:json.dump(v,f,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def finalize():
 global entered,reserved,finished
 if finished:return
 groups=all(R.group_has_live_members(p)is False for p in scratch.record['groups'])
 if not groups:raise RuntimeError('owned-selector-process-group-remains')
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
  if opened.returncode not in[0,1]or opened.stdout.strip():raise RuntimeError('owned-selector-scratch-open-files-unproved')
  scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 if created and not(output/'receipt.json').exists():
  events=[json.loads(line)for line in(output/'source-events.jsonl').read_text().splitlines()]if(output/'source-events.jsonl').exists()else[]
  R.atomic_json(output/'interruption.json',{'allocationId':A['id'],'reason':'child-joined-without-final-receipt','actualRequestsStarted':sum(e.get('phase')=='started'for e in events),'actualHeadersReceived':sum(e.get('phase')=='headers-received'for e in events),'eventsPreserved':len(events),'noReplay':True,'newAdmissions':0,'capacityCredit':0,'acceptance':False})
 receipt={'scratchAbsent':not os.path.lexists(scratch.root),'scratchRoot':str(scratch.root),'ownershipManifest':str(scratch.manifest),'groupsAbsent':groups,'groups':scratch.record['groups'],'reservationAbsent':scratch.token not in(R.read_json(host.path,{})or{}),'reservationToken':scratch.token,'removedAllocationBytes':scratch.record['peak'],'identityUnchanged':all(sha(ROOT/p)==h for p,h in identity.items()),'dependencyPathTouched':False,'compatibilityException':None,'leftovers':[],'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*')if p.is_file())if created else 0}
 R.atomic_json(OUT/'cleanup.json',receipt)
 if created:R.atomic_json(output/'cleanup.json',receipt)
 finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,16*R.MIB,256*R.MIB,ROOT,root=scratch.root);reserved=True
  scratch.__enter__();entered=True
  manifest=OUT/'durable-output-ownership.json'
  write_new(manifest,{'allocationId':A['id'],'root':str(output),'ownerPid':os.getpid(),'reservationToken':scratch.token,'state':'retained-output','scratchManifest':str(scratch.manifest)})
  output.mkdir(parents=True,exist_ok=False);created=True
  write_new(output/'output-ownership.json',{'allocationId':A['id'],'ownerManifest':str(manifest)})
  env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','BMW_MISSING20_SELECTOR_GRANT':A['id'],'TMPDIR':str(scratch.root),'TMP':str(scratch.root),'TEMP':str(scratch.root)}
  command=[A['runtime']['path'],str(BASE/'run-live.mjs'),'live']
  result=R.run_process(command,ROOT,env,OUT/'live.log',scratch,policy,16*R.MIB,224*R.MIB,30,host)
  R.atomic_json(OUT/'result.json',result);R.atomic_json(output/'result.json',result)
  if result.get('rc')==0 and result.get('issue')is None:(OUT/'live.log').unlink(missing_ok=True)
 finally:finalize()
print(json.dumps({'rc':result.get('rc'),'issue':result.get('issue'),'cleanup':str(OUT/'cleanup.json'),'output':str(output)}))
raise SystemExit(0 if result.get('rc')==0 and result.get('issue')is None and read(OUT/'cleanup.json')['scratchAbsent'] else 1)
