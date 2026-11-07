import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess
BASE=pathlib.Path(__file__).resolve().parent
ROOT=BASE.parents[4]
phase=sys.argv[1]
META=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f60-technical-supplement')/phase
assert not META.exists()
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files=[ROOT/'server/test/gcsp-technical-supplement.test.js',ROOT/'scripts/gcsp/verify-fleet.mjs']
for d in ['server/gcsp/vehicle-evidence','server/vehicle-evidence']:
 files.extend((ROOT/d).glob('*.js'))
files.extend((ROOT/'server/data/gcsp/vehicle-evidence/registered-technical').glob('*.json'))
identity={str(p):sha(p) for p in files}
selected=['server/test/gcsp-technical-supplement.test.js']
if phase=='legacy-registry': selected=['server/test/gcsp-vin-registry.test.js']
if phase=='legacy-contracts': selected=['server/test/gcsp-vehicle-details-contract.test.js','server/test/gcsp-vehicle-details-v2.test.js','server/test/bmw-catalogue-v2.test.js']
if phase=='legacy-audit': selected=['server/test/gcsp-fleet-integration.test.js','server/test/gcsp-fleet-verifier.test.js','server/test/gcsp-corpus-indexed.test.js']
identity.update({str(ROOT/p):sha(ROOT/p) for p in selected})
command=['/opt/homebrew/bin/node','--max-old-space-size=256','--test','--test-concurrency=1',*selected]
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(META,ROOT,policy,expected=64*R.MIB,checkpoint=META/'result.json');host=R.HostBudget(policy)
R.atomic_json(META/'selection.json',{'scope':'scoped retained-row technical supplement','changedPaths':['corpus-publisher.js','synthetic-registry.js','vehicle-details-contract.js','registered-technical-facts.js','verify-fleet.mjs'],'regression':'exact four qualified facts separate from immutable source envelope and history','selectedCommand':command,'excluded':['full suite','source traffic','nativeSQL','public restore','ordinary activation','UI screenshots'],'codePins':identity,'workers':1,'scratchMiB':64,'ramMiB':512,'seconds':120})
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert not os.path.lexists(link)
entered=reserved=finished=False;link_identity=None

def finish():
 global entered,reserved,finished,link_identity
 if finished:return
 assert all(R.group_has_live_members(g) is False for g in scratch.record['groups'])
 if link_identity:
  st=link.lstat();assert (st.st_dev,st.st_ino)==link_identity and link.is_symlink() and link.readlink()==vendor
  link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip()
  scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
 cleanup={'scratch':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkAbsent':not os.path.lexists(link),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'compatibilityException':None,'leftovers':[],'codeIdentityUnchanged':True}
 R.atomic_json(META/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True
  scratch.__enter__();entered=True
  link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino)
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','HOME':os.environ['HOME']},META/'command.log',scratch,policy,64*R.MIB,448*R.MIB,120,host)
  R.atomic_json(META/'result.json',result)
finally:
 finish();atexit.unregister(finish)
compact={'scope':'scoped','result':result,'cleanup':R.read_json(META/'cleanup.json',{}),'selection':str(META/'selection.json'),'selectionSha256':sha(META/'selection.json'),'acceptance':False}
R.atomic_json(BASE/(phase+'-results.json'),compact)
print((META/'command.log').read_text()[-6000:]);print(json.dumps(compact));sys.exit(0 if result.get('rc')==0 else 1)
