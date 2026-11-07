"""One finite loader diagnostic; writes only owned cloud scratch and small evidence."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,re,selectors,shutil,subprocess,time,traceback
BASE=pathlib.Path(__file__).resolve().parent;plan=json.loads((BASE/'plan.json').read_text());scratch=pathlib.Path(os.environ['TMPDIR']);output=pathlib.Path(os.environ['PHASE_OUTPUT']);started=time.monotonic();stage='starting';logs=[]
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(65536),b''):h.update(block)
 return h.hexdigest()
def save(name,value):
 target=output/name;pending=target.with_suffix('.pending');pending.write_text(json.dumps(value,indent=2)+'\n');pending.replace(target)
def state():
 return {'kegs':{p['name']:sorted(x.name for x in pathlib.Path('/opt/homebrew/Cellar',p['name']).iterdir()) if pathlib.Path('/opt/homebrew/Cellar',p['name']).is_dir() else [] for p in plan['packages']},'optLinks':{p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in plan['optLinksBefore']},'defaultClusterExists':pathlib.Path(plan['defaultPostgresCluster']['path']).exists()}
def checkpoint(nextStage):
 global stage
 stage=nextStage;assert time.monotonic()-started<115;save('diagnostic-progress.json',{'stage':stage,'elapsedSeconds':time.monotonic()-started,'publicRequests':0,'installationAttempted':False,'acceptance':False})
assert str(output)==plan['outputRoot'] and '/Library/CloudStorage/OneDrive-IBM/Claude/' in str(scratch)
assert sha(BASE/'plan.json')==os.environ['REVIEWED_PLAN_SHA256'];before=state();save('before-state.json',before)
try:
 checkpoint('prepare-owned-signed-cache');cache=scratch/'homebrew-cache';api=cache/'api/internal';api.mkdir(parents=True)
 for pin in [plan['catalog'],plan['signedApiEnvelope']]:
  source=pathlib.Path(pin['path']);assert sha(source)==pin['sha256'];shutil.copyfile(source,api/source.name);assert sha(api/source.name)==pin['sha256']
 for name in ['homebrew-temp','homebrew-logs','archives']:(scratch/name).mkdir()
 spec=[]
 for package in plan['packages']:
  checkpoint('copy-'+package['name']);source=pathlib.Path(package['retainedArchive']['path']);assert source.stat().st_size==package['downloadBytes'] and sha(source)==package['bottleSha256'];archive=scratch/'archives'/package['canonicalArchiveName'];shutil.copyfile(source,archive);assert sha(archive)==package['bottleSha256'];spec.append({'name':package['name'],'pkgVersion':package['pkgVersion'],'archive':str(archive),'bytes':package['downloadBytes'],'sha256':package['bottleSha256'],'embeddedRubySha256':package['reviewedEmbeddedRuby']['sha256']})
 specPath=scratch/'seven-archives.json';specPath.write_text(json.dumps(spec)+'\n')
 env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','HOMEBREW_NO_AUTO_UPDATE':'1','HOMEBREW_NO_ANALYTICS':'1','HOMEBREW_NO_INSTALL_CLEANUP':'1','HOMEBREW_NO_AUTOREMOVE':'1','HOMEBREW_NO_ENV_HINTS':'1','HOMEBREW_CACHE':str(cache),'HOMEBREW_TEMP':str(scratch/'homebrew-temp'),'HOMEBREW_LOGS':str(scratch/'homebrew-logs'),'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch)}
 profile='(version 1) (allow default) (deny network*) (deny file-write*) (allow file-write* (literal "/dev/null")) (allow file-write* (subpath '+json.dumps(str(scratch))+'))'
 command=['/usr/bin/sandbox-exec','-p',profile,'/opt/homebrew/bin/brew','ruby',str(BASE/'loader-diagnostic.rb'),str(specPath)]
 checkpoint('invoke-seven-bottle-loader-diagnostic');proc=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=0);selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ);log=output/'loader.log';count=0
 try:
  with log.open('xb') as stream:
   while selector.get_map():
    assert time.monotonic()-started<115,'diagnostic-deadline'
    for key,mask in selector.select(.2):
     block=os.read(key.fileobj.fileno(),65536)
     if not block:selector.unregister(key.fileobj);key.fileobj.close();continue
     stream.write(block[:max(0,1048576-count)]);stream.flush();count+=len(block);assert count<=1048576,'diagnostic-log-budget'
   rc=proc.wait(timeout=max(1,115-(time.monotonic()-started)))
 finally:
  selector.close()
  if proc.poll() is None:
   proc.terminate()
   try:proc.wait(timeout=3)
   except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=3)
  if proc.stdout and not proc.stdout.closed:proc.stdout.close()
 lines=log.read_text(errors='replace').splitlines();markers=[line[:512] for line in lines if re.search(r'Downloading Homebrew API data|curl:|shims/shared/curl|Downloading https?://',line)][:16];logs=[{'path':str(log),'bytes':count,'sha256':sha(log),'returncode':rc,'networkAttemptMarkers':markers}];events=[json.loads(line) for line in lines if line.startswith('{')]
 assert rc==0 and not markers,'Loader failed or attempted fallback; no retry'
 assert len(events)==9 and events[0]['event']=='ruby-startup' and events[0]['guard'] is False and events[-1]['event']=='complete' and events[-1]['count']==7 and events[-1]['formulaInstallerLoaded'] is False
 rows=events[1:-1];assert [x['name'] for x in rows]==[x['name'] for x in spec]
 for row,item in zip(rows,spec):assert row['event']=='bottle-loader' and row['guard'] is False and row['regexMatch'] and row['fileExists'] and row['loaderClass']=='Formulary::FromBottleLoader' and row['localBottlePath']==item['archive'] and row['pkgVersion']==item['pkgVersion'] and row['embeddedRubySha256']==item['embeddedRubySha256'] and row['factoryExact']
 assert state()==before,'Installed state changed';checkpoint('complete');save('receipt.json',{'status':'seven-exact-local-bottle-loaders-proved','phase':plan['phase'],'events':events,'logs':logs,'elapsedSeconds':time.monotonic()-started,'publicRequests':0,'sourceCalls':0,'redownloadBytes':0,'installationAttempted':False,'formulaInstallerLoaded':False,'signedSidecarsCopied':False,'sourceCacheModified':False,'fileWritesRestrictedToOwnedScratchAndExactDevNull':True,'deviceWriteException':'/dev/null','installedStateUnchanged':True,'nativeDatabaseAttempted':False,'acceptance':False})
except Exception as error:
 save('diagnostic-failure.json',{'stage':stage,'errorType':type(error).__name__,'frames':[{'file':pathlib.Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(error.__traceback__)[-8:]],'logs':logs,'elapsedSeconds':time.monotonic()-started,'publicRequests':0,'installationAttempted':False,'nativeDatabaseAttempted':False,'acceptance':False});raise
finally:save('after-state.json',{'before':before,'after':state(),'unchanged':state()==before})
