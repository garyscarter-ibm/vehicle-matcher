"""One finite loader diagnostic; uses owned local active working set and exports small evidence."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,re,selectors,shutil,subprocess,time,traceback
BASE=pathlib.Path(__file__).resolve().parent;plan=json.loads((BASE/'plan.json').read_text());scratch=pathlib.Path(os.environ['TMPDIR']);destination=pathlib.Path(os.environ['PHASE_OUTPUT']);output=pathlib.Path(plan['metadataRoot'])/'evidence';output.mkdir(mode=0o700);started=time.monotonic();stage='starting';logs=[]
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
assert str(destination)==plan['outputRoot'] and scratch.parent==pathlib.Path('/private/tmp') and scratch.name.startswith('test-stamp-shard-')
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
 source=pathlib.Path(plan['brewEntrypoint']['path']).read_text();needle='ENV_VAR_NAMES=(\n';assert source.count(needle)==1;projected=source.replace(needle,needle+'  TMPDIR TMP TEMP\n');assert hashlib.sha256(projected.encode()).hexdigest()==plan['brewStartupProjection']['sha256'];(scratch/'brew-startup-projection.sh').write_text(projected)
 command=['/usr/bin/sandbox-exec','-p',profile,'/bin/bash','-pu','-c',projected,plan['brewEntrypoint']['path'],'ruby',str(BASE/'loader-diagnostic.rb'),str(specPath)]
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
 assert state()==before,'Installed state changed';checkpoint('complete');save('receipt.json',{'status':'seven-exact-local-bottle-loaders-proved','phase':plan['phase'],'events':events,'logs':logs,'elapsedSeconds':time.monotonic()-started,'publicRequests':0,'sourceCalls':0,'redownloadBytes':0,'installationAttempted':False,'formulaInstallerLoaded':False,'signedSidecarsCopied':False,'sourceCacheModified':False,'fileWritesRestrictedToOwnedLocalScratchAndExactDevNull':True,'deviceWriteException':'/dev/null','installedStateUnchanged':True,'startupProjectionSha256':plan['brewStartupProjection']['sha256'],'localCompatibilityException':plan['resources']['compatibilityException'],'nativeDatabaseAttempted':False,'acceptance':False})
except Exception as error:
 save('diagnostic-failure.json',{'stage':stage,'errorType':type(error).__name__,'frames':[{'file':pathlib.Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(error.__traceback__)[-8:]],'logs':logs,'elapsedSeconds':time.monotonic()-started,'publicRequests':0,'installationAttempted':False,'nativeDatabaseAttempted':False,'acceptance':False});raise
finally:
 save('after-state.json',{'before':before,'after':state(),'unchanged':state()==before})
 allowed={'diagnostic-progress.json','before-state.json','after-state.json','loader.log','receipt.json','diagnostic-failure.json'};total=0
 for path in sorted(output.iterdir()):
  assert path.name in allowed and path.is_file() and not path.is_symlink();size=path.stat().st_size;total+=size;assert size<=1048576 and total<=2*1048576
  pending=destination/(path.name+'.pending');shutil.copyfile(path,pending);assert sha(pending)==sha(path);pending.replace(destination/path.name)

