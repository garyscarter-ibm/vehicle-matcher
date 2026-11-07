"""One exact three-GET historical probe, only after a parent release. No retries."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
ID='historical-g26e-20241001-20261107-once'
assert os.environ.get('HISTORICAL_G26E_PHASE_GRANT')==ID,'exact-parent-source-release-required'
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
plan=read(BASE/'plan.json');assert plan['run']==ID
release=read(BASE/'parent-release.json');assert sha(BASE/'parent-release.json')==os.environ.get('HISTORICAL_G26E_PARENT_RELEASE_SHA256')
assert release['allocationId']==ID and release['planSha256']==sha(BASE/'plan.json')and release['GET']==3
assert all(sha(ROOT/p)==h for p,h in{**plan['codePins'],**plan['inputs']}.items())
assert all(sha(pathlib.Path(p))==h for p,h in plan['runtimePins'].items())
preflight=read(BASE/'preflight.json');assert preflight['status']=='passed'and preflight['planSha256']==sha(BASE/'plan.json')and preflight['tests']=={'tests':23,'pass':23,'fail':0,'skipped':0}
output=BASE/'actual';assert not os.path.lexists(output),'preserve consumed historical allocation'
OUT=pathlib.Path(plan['supervisorOutput']);manifest=pathlib.Path(plan['outputOwnershipManifest']);assert not manifest.exists()
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':32,'chunk_ram_mib':256,'chunk_seconds':60,'log_mib':1});scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB);host=R.HostBudget(policy)
R.atomic_json(manifest,{'allocationId':ID,'owner':R.owner(),'root':str(output),'disposable':False,'retainOnInterruption':True,'state':'planned','token':scratch.token})
entered=reserved=finished=False;result={}
def finalize():
 global entered,reserved,finished
 if finished:return
 probe=subprocess.run(['/bin/ps','-axo','pgid='],capture_output=True,text=True,timeout=10);assert probe.returncode==0
 absent=not set(scratch.record['groups'])&{int(x)for x in probe.stdout.split()};assert absent,'owned groups still live or query unknown'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in[0,1]and not opened.stdout.strip()
  scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 cleanup={'groups':scratch.record['groups'],'groupsAbsent':absent,'scratchRoot':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'reservationAbsent':scratch.token not in(R.read_json(host.path,{})or{}),'removedAllocationBytes':scratch.record['peak'],'retainedOutput':str(output),'retainedBytes':sum(p.stat().st_size for p in output.rglob('*')if p.is_file())if output.exists()else 0,'dependencyPathTouched':False,'compatibilityException':None,'leftovers':[]}
 R.atomic_json(OUT/'cleanup.json',cleanup);owner=read(manifest);owner.update(state='finished',cleanup=cleanup);R.atomic_json(manifest,owner);finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,33*R.MIB,256*R.MIB,ROOT,root=output);reserved=True;scratch.__enter__();entered=True
  output.mkdir();owner=read(manifest);owner['state']='active';R.atomic_json(manifest,owner)
  command=['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),'--execute-historical-g26e-discovery']
  environment={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC','LANG':'en_GB.UTF-8','HISTORICAL_G26E_SOURCE_GRANT':ID,'HISTORICAL_G26E_OWNER_TOKEN':scratch.token,'HISTORICAL_G26E_PARENT_RELEASE_SHA256':sha(BASE/'parent-release.json')}
  result=R.run_process(command,ROOT,environment,OUT/'source.log',scratch,policy,32*R.MIB,256*R.MIB,55,host);R.atomic_json(OUT/'result.json',result)
 finally:finalize()
print(json.dumps({'result':result,'cleanup':read(OUT/'cleanup.json')}))
sys.exit(0 if result.get('rc')==0 and not result.get('issue')else 1)
