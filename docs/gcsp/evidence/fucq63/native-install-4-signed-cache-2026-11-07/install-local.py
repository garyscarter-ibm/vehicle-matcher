"""Finite zero-download installation from exact retained official bottles and reviewed embedded Ruby."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,re,selectors,shutil,subprocess,tarfile,time,traceback
BASE=pathlib.Path(__file__).resolve().parent;plan=json.loads((BASE/'plan.json').read_text());scratch=pathlib.Path(os.environ['TMPDIR']);output=pathlib.Path(os.environ['PHASE_OUTPUT']);started=time.monotonic();stage='starting';packageName=None;installed=[];observations={};logs=[]
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(65536),b''):h.update(block)
 return h.hexdigest()
def save(name,value):
 target=output/name;pending=target.with_suffix('.pending');pending.write_text(json.dumps(value,indent=2)+'\n');pending.replace(target)
def optlinks():return {p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in plan['optLinksBefore']}
def kegs():return {p['name']:sorted(x.name for x in pathlib.Path('/opt/homebrew/Cellar',p['name']).iterdir()) if pathlib.Path('/opt/homebrew/Cellar',p['name']).is_dir() else [] for p in plan['packages']}
def checkpoint(nextStage):
 global stage
 stage=nextStage;assert time.monotonic()-started<600;save('install-progress.json',{'stage':stage,'package':packageName,'installed':installed,'observations':observations,'logs':logs,'elapsedSeconds':time.monotonic()-started,'publicRequests':0,'nativeDatabaseAttempted':False,'acceptance':False})
def run_bounded(command,env,log):
 proc=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=0);selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ);count=0
 try:
  with log.open('xb') as stream:
   while selector.get_map():
    assert time.monotonic()-started<600,'install-deadline'
    for key,mask in selector.select(min(.25,max(.01,600-(time.monotonic()-started)))):
     block=os.read(key.fileobj.fileno(),65536)
     if not block:selector.unregister(key.fileobj);key.fileobj.close();continue
     kept=block[:max(0,1048576-count)];stream.write(kept);stream.flush();count+=len(block);assert count<=1048576,'installer-log-budget'
   rc=proc.wait(timeout=max(1,600-(time.monotonic()-started)));markers=[line[:512] for line in log.read_text(errors='replace').splitlines() if re.search(r'Downloading Homebrew API data|curl:|shims/shared/curl|Downloading https?://',line)][:16];return {'returncode':rc,'bytes':count,'sha256':sha(log),'path':str(log),'networkFallbackAttemptObserved':bool(markers),'networkAttemptMarkers':markers}
 finally:
  selector.close()
  if proc.poll() is None:
   proc.terminate()
   try:proc.wait(timeout=5)
   except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
  if proc.stdout and not proc.stdout.closed:proc.stdout.close()
assert '/Library/CloudStorage/OneDrive-IBM/Claude/' in str(scratch) and str(output)==plan['outputRoot'];assert sha(BASE/'plan.json')==os.environ['REVIEWED_PLAN_SHA256'];grant=json.loads(pathlib.Path(os.environ['ROOT_RELEASE_PATH']).read_text());assert grant['authorized'] is True and grant['phase']=='install-4-signed-cache' and grant['planSha256']==os.environ['REVIEWED_PLAN_SHA256'] and grant['embeddedRubyReviewed'] is True and grant['embeddedRubyPins']==plan['reviewedEmbeddedRubyPins'];assert grant['allowReviewedLocalPackagePaths'] is True and grant['signedApiEnvelope']==plan['signedApiEnvelope'];assert grant['newRequestCeiling']==0 and grant['acknowledgeOptLinksMayChange'] is True and grant['acknowledgeInstalledKegsPreserved'] is True
beforeKegs=kegs();beforeOpt=optlinks();assert beforeOpt==plan['optLinksBefore'];assert beforeKegs==plan['oldKegsBefore'];default=pathlib.Path('/opt/homebrew/var/postgresql@16');assert not default.exists()
priorRoots=[pathlib.Path('/opt/homebrew/Cellar',p['name']).resolve() for p in plan['packages']];priorPrefixLinks={}
for folder in ['bin','sbin','lib','include','share','etc']:
 for path in pathlib.Path('/opt/homebrew',folder).rglob('*'):
  if path.is_symlink():
   target=path.resolve(strict=False)
   if any(root==target or root in target.parents for root in priorRoots):priorPrefixLinks[str(path)]=os.readlink(path);assert len(priorPrefixLinks)<=4096
save('before-state.json',{'oldKegs':beforeKegs,'optLinks':beforeOpt,'existingPrefixLinks':priorPrefixLinks,'defaultClusterAbsent':True})
for p in plan['packages']:assert not pathlib.Path(p['kegPath']).exists(),'Exact keg already exists; preserve and use a separate reviewed reuse plan'
try:
 checkpoint('prepare-owned-homebrew-cache');cache=scratch/'homebrew-cache';cache.mkdir();api=cache/'api/internal';api.mkdir(parents=True);catalog=pathlib.Path(plan['catalog']['path']);assert sha(catalog)==plan['catalog']['sha256'];shutil.copyfile(catalog,api/catalog.name);assert sha(api/catalog.name)==plan['catalog']['sha256'];signed=pathlib.Path(plan['signedApiEnvelope']['path']);assert signed.stat().st_size==plan['signedApiEnvelope']['bytes'] and sha(signed)==plan['signedApiEnvelope']['sha256'];shutil.copyfile(signed,api/signed.name);assert sha(api/signed.name)==plan['signedApiEnvelope']['sha256'];save('cache-provenance.json',{'signedEnvelope':plan['signedApiEnvelope'],'payload':plan['catalog'],'sourceCacheModified':False,'ownedCacheOnly':True,'signedSidecarsCopied':False,'HomebrewVerificationRequired':True,'localPackagePathsExplicitlyAllowed':True,'noInstallFromApiSet':False});archives=scratch/'archives';archives.mkdir()
 for p in plan['packages']:
  packageName=p['name'];observations={};checkpoint('verify-retained-whole-official-bottle');source=pathlib.Path(p['retainedArchive']['path']);assert source.stat().st_size==p['downloadBytes'] and sha(source)==p['bottleSha256'];assert sha(pathlib.Path(p['reviewedEmbeddedRuby']['path']))==p['reviewedEmbeddedRuby']['sha256']
  checkpoint('copy-exact-bottle-to-canonical-owned-name');archive=archives/p['canonicalArchiveName'];h=hashlib.sha256();count=0
  with source.open('rb') as src,archive.open('xb') as dst:
   for block in iter(lambda:src.read(65536),b''):count+=len(block);assert count<=p['downloadBytes'];h.update(block);dst.write(block)
   dst.flush();os.fsync(dst.fileno())
  assert count==p['downloadBytes'] and h.hexdigest()==p['bottleSha256'] and sha(archive)==p['bottleSha256'];observations.update(archiveBytes=count,archiveSha256=h.hexdigest(),canonicalArchiveName=archive.name)
  checkpoint('verify-reviewed-embedded-build-ruby');matches=[];members=0;uncompressed=0
  with tarfile.open(archive,'r|gz') as tar:
   for member in tar:
    members+=1;assert members<=30000 and len(member.name)<=1024;uncompressed+=member.size;assert uncompressed<=384*1024*1024
    if member.name==p['embeddedMember']:
     assert member.isfile() and 0<member.size<=1048576;content=tar.extractfile(member).read(1048577);matches.append({'member':member.name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
  assert len(matches)==1 and matches[0]['bytes']==p['reviewedEmbeddedRuby']['bytes'] and matches[0]['sha256']==p['reviewedEmbeddedRuby']['sha256'];observations['actualEmbeddedRuby']=matches[0];observations['catalogCurrentFormulaRubySha256']=p['formulaRubySha256'];observations['embeddedEqualsCurrentFormula']=matches[0]['sha256']==p['formulaRubySha256']
  env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','HOMEBREW_INTERNAL_ALLOW_PACKAGES_FROM_PATHS':'1','HOMEBREW_NO_AUTO_UPDATE':'1','HOMEBREW_NO_ANALYTICS':'1','HOMEBREW_NO_INSTALL_CLEANUP':'1','HOMEBREW_NO_AUTOREMOVE':'1','HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK':'1','HOMEBREW_NO_ENV_HINTS':'1','HOMEBREW_CACHE':str(cache),'HOMEBREW_TEMP':str(scratch/'homebrew-temp'),'HOMEBREW_LOGS':str(scratch/'homebrew-logs'),'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch)}
  command=['/usr/bin/sandbox-exec','-p','(version 1) (allow default) (deny network*)','/opt/homebrew/bin/brew','ruby',plan['driver']['path'],str(archive)];log=output/('install-'+p['name'].replace('@','-')+'.log');checkpoint('invoke-reviewed-network-denied-bottle-installer');result=run_bounded(command,env,log);logs.append(result);observations['installer']=result;checkpoint('verify-native-keg-and-preserved-existing-state');assert result['returncode']==0 and not result['networkFallbackAttemptObserved'],'Bottle install failed or attempted fallback; never retry, compile or expand dependencies'
  keg=pathlib.Path(p['kegPath']);assert keg.is_dir();size=sum(x.stat().st_size for x in keg.rglob('*') if x.is_file() and not x.is_symlink());assert size<=p['installedBytes']+16*1024*1024
  for name,versions in beforeKegs.items():assert all(pathlib.Path('/opt/homebrew/Cellar',name,version).is_dir() for version in versions)
  assert not default.exists();assert all(pathlib.Path(path).is_symlink() and os.readlink(path)==target for path,target in priorPrefixLinks.items()),'Existing non-opt prefix links changed; named diagnostic evidence retained'
  installed.append({'name':p['name'],'pkgVersion':p['pkgVersion'],'kegPath':str(keg),'logicalBytes':size,'bottleSha256':p['bottleSha256'],'reviewedEmbeddedRubySha256':matches[0]['sha256'],'preservedOldVersions':beforeKegs[p['name']],'optLinksAfterThisPackage':optlinks()});checkpoint('package-complete')
 assert len(installed)==7 and sum(x['logicalBytes'] for x in installed)<1024*1024*1024;checkpoint('verify-postgres-binary-identities');binaryRoot=pathlib.Path(plan['packages'][-1]['kegPath'])/'bin';binaries=[{'path':str(binaryRoot/name),'sha256':sha(binaryRoot/name),'bytes':(binaryRoot/name).stat().st_size} for name in ['postgres','initdb','pg_isready']];version=subprocess.run(['/usr/bin/sandbox-exec','-p','(version 1) (allow default) (deny network*)',str(binaryRoot/'postgres'),'--version'],capture_output=True,text=True,check=True,timeout=5).stdout.strip();assert version=='postgres (PostgreSQL) 16.15'
 checkpoint('installation-complete');save('receipt.json',{'status':'exact-pinned-postgresql16-bottles-installed','phase':'install-4-signed-cache','version':version,'packages':installed,'binaries':binaries,'logs':logs,'publicRequests':0,'networkFallbackAttemptObserved':any(x['networkFallbackAttemptObserved'] for x in logs),'sourceCalls':0,'redownloadBytes':0,'reusedArchiveBytes':66864127,'sourceCompilation':False,'postInstallExecuted':False,'defaultClusterCreated':False,'brewServicesUsed':False,'globalPrefixLinkRequested':False,'existingPrefixLinksPreserved':len(priorPrefixLinks),'upgradeUnlinkWrapperUsed':False,'optLinksMayChange':True,'optLinksBefore':beforeOpt,'optLinksAfter':optlinks(),'installedKegsPreserved':True,'elapsedSeconds':time.monotonic()-started,'nativeDatabaseAttempted':False,'nativeAttempted':False,'acceptance':False})
except Exception as error:
 frames=[{'file':pathlib.Path(f.filename).name,'line':f.lineno,'function':f.name[:80]} for f in traceback.extract_tb(error.__traceback__)[-8:]];save('install-failure.json',{'status':'failed-no-retry-or-source-fallback','stage':stage,'package':packageName,'errorType':type(error).__name__,'frames':frames,'observations':observations,'installed':installed,'observedKegs':kegs(),'logs':logs,'optLinksBefore':beforeOpt,'optLinksAfter':optlinks(),'publicRequests':0,'networkFallbackAttemptObserved':True if any(x['networkFallbackAttemptObserved'] for x in logs) else None,'publicRequestsMeaning':'successful requests; partial logs may leave attempted fallback unknown','redownloadBytes':0,'installedKegsPreserved':True,'nativeDatabaseAttempted':False,'acceptance':False});raise RuntimeError('Local retained-bottle installation failed; bounded stage/hash/log evidence retained; installed kegs preserved') from None
finally:save('after-state.json',{'kegsBefore':beforeKegs,'kegsAfter':kegs(),'optLinksBefore':beforeOpt,'optLinksAfter':optlinks(),'existingPrefixLinksPreserved':all(pathlib.Path(path).is_symlink() and os.readlink(path)==target for path,target in priorPrefixLinks.items()),'defaultClusterAbsent':not default.exists()})
