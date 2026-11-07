"""Read-only root .8 cold-start diagnosis, one bounded process and owned link."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=pathlib.Path('/Users/usget/Claude/vehicle-matcher')
phase=sys.argv[1];assert phase in ['default','capped256']
META=ROOT/'.claude/f58-63-overnight-20261106/f62/local-default-startup'/phase;assert not META.exists()
plan=json.loads((BASE/'plan.json').read_text())
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
pins={p['path']:p['sha256'] for p in plan['pins']};pins.update({str(BASE/'probe.mjs'):sha(BASE/'probe.mjs'),str(BASE/'supervise.py'):sha(BASE/'supervise.py'),str(BASE/'plan.json'):sha(BASE/'plan.json')})
for path,digest in pins.items():assert sha(pathlib.Path(path))==digest
if phase=='capped256':
 prior=R.read_json(BASE/'default-results.json',{});assert prior.get('result',{}).get('issue') or prior.get('probe',{}).get('status')=='failed','Comparison needs actual failure/resource evidence.'
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':90,'log_mib':1});scratch=R.Scratch(META,ROOT,policy,expected=64*R.MIB,checkpoint=META/'result.json');host=R.HostBudget(policy)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir() and not os.path.lexists(link)
command=['/opt/homebrew/bin/node']+(['--max-old-space-size=256'] if phase=='capped256' else [])+[str(BASE/'probe.mjs'),str(BASE/'plan.json'),str(scratch.root/'checkpoint.json')]
selection={'scope':'scoped actual root buildServer/default local registry cold start '+phase,'variant':phase,'command':command,'affectedCallers':['buildServer default local-vehicle lookup','SyntheticRegistry.load','registeredCatalogueSources','actual health and configuration HTTP wrappers'],'integrationBoundaries':['root ordinary .8 manifest/source shard lookup','no injected lookup/registry or fixture','nativeDB env absent','source offline guard + only loopbackHTTP'],'excluded':['full suite','source/provider traffic','nativeDB','browser','Render retry/deploy','DTO full sweep','consumer defect fix'],'pins':pins,'resources':{'workers':1,'scratchMiB':64,'hostRamMiB':512,'groupRamMiB':448,'seconds':90},'runtime':'localNode26, noRenderOOMclaim'}
R.atomic_json(META/'selection.json',selection)
R.atomic_json(META/'owned-link-plan.json',{'owner':R.owner(),'phase':phase,'path':str(link),'target':str(vendor),'scratch':str(scratch.root),'manifest':str(scratch.manifest)})
entered=reserved=finished=False;link_identity=None;result={};probe={}
def finish():
 global entered,reserved,finished,link_identity
 if finished:return
 assert all(R.group_has_live_members(g) is False for g in scratch.record['groups'])
 if link_identity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor;link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in pins.items()),'immutable code/input changed'
 cleanup={'scratch':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkAbsent':not os.path.lexists(link),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'compatibilityException':None,'leftovers':[],'immutablePinsUnchanged':True}
 R.atomic_json(META/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino);R.atomic_json(META/'owned-link.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1'},META/'command.log',scratch,policy,64*R.MIB,448*R.MIB,90,host);R.atomic_json(META/'result.json',result)
  checkpoint=scratch.root/'checkpoint.json'
  if checkpoint.exists():probe=R.read_json(checkpoint,{});R.atomic_json(META/'probe.json',probe)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped local startup '+phase,'result':result,'probe':probe,'cleanup':R.read_json(META/'cleanup.json',{}),'selection':str(META/'selection.json'),'selectionSha256':sha(META/'selection.json'),'acceptance':False,'renderOomEstablished':False}
R.atomic_json(BASE/(phase+'-results.json'),compact)
print((META/'command.log').read_text()[-6000:]);print(json.dumps(compact));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
