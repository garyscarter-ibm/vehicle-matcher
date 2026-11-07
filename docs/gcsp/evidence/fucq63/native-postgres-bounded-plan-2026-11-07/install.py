"""Pinned public bottle download and local bottle-only Homebrew installation; grant enforced by supervisor."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,subprocess,time,tarfile,urllib.request,urllib.parse,urllib.error,shutil
BASE=pathlib.Path(__file__).resolve().parent;plan=json.loads((BASE/'plan.json').read_text());packages=json.loads((BASE/'package-metadata.json').read_text());scratch=pathlib.Path(os.environ['TMPDIR']);output=pathlib.Path(os.environ['PHASE_OUTPUT']);started=time.monotonic();requests=0
assert '/Library/CloudStorage/OneDrive-IBM/Claude/' in str(scratch)
def save(name,value):(output/name).write_text(json.dumps(value,indent=2)+'\n')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
opener=urllib.request.build_opener(NoRedirect)
def request(url,headers=None):
 global requests
 requests+=1;assert requests<=35 and time.monotonic()-started<600
 parsed=urllib.parse.urlparse(url);assert parsed.scheme=='https' and parsed.hostname in ['ghcr.io','pkg-containers.githubusercontent.com']
 try:return opener.open(urllib.request.Request(url,headers=headers or {}),timeout=min(30,max(1,600-(time.monotonic()-started))))
 except urllib.error.HTTPError as e:
  if e.code in [301,302,303,307,308]:return e
  raise RuntimeError('Pinned bottle public request failed; no retry') from None
beforeKegs={p['name']:sorted(x.name for x in pathlib.Path('/opt/homebrew/Cellar',p['name']).iterdir()) if pathlib.Path('/opt/homebrew/Cellar',p['name']).is_dir() else [] for p in packages['packages']}
# Snapshot only existing prefix links owned by these approved package names; direct installer must preserve them.
priorRoots=[pathlib.Path('/opt/homebrew/Cellar',p['name']).resolve() for p in packages['packages']]
priorPrefixLinks={}
for folder in ['bin','sbin','lib','include','share','etc']:
 for path in pathlib.Path('/opt/homebrew',folder).rglob('*'):
  if path.is_symlink():
   target=path.resolve(strict=False)
   if any(root==target or root in target.parents for root in priorRoots):priorPrefixLinks[str(path)]=os.readlink(path)
beforeOpt={p['name']:os.readlink('/opt/homebrew/opt/'+p['name']) if pathlib.Path('/opt/homebrew/opt',p['name']).is_symlink() else None for p in packages['packages']}
for p in packages['packages']:assert not pathlib.Path(p['kegPath']).exists(),'Exact keg already exists; preserve it and request a reviewed reuse plan.'
default=pathlib.Path('/opt/homebrew/var/postgresql@16');assert not default.exists(),'Never appropriate a shared/default PostgreSQL cluster'
cache=scratch/'homebrew-cache';cache.mkdir();api=cache/'api/internal';api.mkdir(parents=True);catalog=pathlib.Path(packages['catalog']['path']);assert sha(catalog)==packages['catalog']['sha256'];shutil.copyfile(catalog,api/catalog.name)
archives=scratch/'archives';archives.mkdir();installed=[]
try:
 for p in packages['packages']:
  assert time.monotonic()-started<600
  suffix=('.'+str(p['bottleRebuild'])) if p['bottleRebuild'] else '';platform='all' if p['name']=='ca-certificates' else 'arm64_golden_gate';archive=archives/(p['name']+'--'+p['pkgVersion']+'.'+platform+'.bottle'+suffix+'.tar.gz')
  repository=urllib.parse.urlparse(p['url']).path.split('/blobs/')[0][4:];tokenURL='https://ghcr.io/token?'+urllib.parse.urlencode({'service':'ghcr.io','scope':'repository:'+repository+':pull'})
  with request(tokenURL) as response:token=json.loads(response.read(65536))['token']
  url=p['url'];headers={'Authorization':'Bearer '+token};response=None
  for redirects in range(4):
   response=request(url,headers)
   if response.status in [301,302,303,307,308]:
    assert redirects<3;url=urllib.parse.urljoin(url,response.headers['Location']);headers={};response.close();continue
   assert response.status==200;break
  count=0;digest=hashlib.sha256()
  with response,archive.open('xb') as f:
   while True:
    block=response.read(1048576)
    if not block:break
    count+=len(block);assert count<=p['downloadBytes'];digest.update(block);f.write(block)
  del token,headers
  assert count==p['downloadBytes'] and digest.hexdigest()==p['bottleSha256']
  with tarfile.open(archive,'r:gz') as tar:
   formula=[member for member in tar.getmembers() if member.name.endswith('/.brew/'+p['name']+'.rb')];assert len(formula)==1
   assert hashlib.sha256(tar.extractfile(formula[0]).read()).hexdigest()==p['formulaRubySha256']
  env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','HOMEBREW_NO_AUTO_UPDATE':'1','HOMEBREW_NO_ANALYTICS':'1','HOMEBREW_NO_INSTALL_CLEANUP':'1','HOMEBREW_NO_AUTOREMOVE':'1','HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK':'1','HOMEBREW_NO_ENV_HINTS':'1','HOMEBREW_CACHE':str(cache),'HOMEBREW_TEMP':str(scratch/'homebrew-temp'),'HOMEBREW_LOGS':str(scratch/'homebrew-logs'),'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch)}
  command=['/usr/bin/sandbox-exec','-p','(version 1) (allow default) (deny network*)','/opt/homebrew/bin/brew','ruby',str(BASE/'install-bottle.rb'),str(archive)]
  log=output/('install-'+p['name'].replace('@','-')+'.log')
  with log.open('xb') as f:result=subprocess.run(command,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=max(1,600-(time.monotonic()-started)))
  assert log.stat().st_size<=1048576;assert result.returncode==0,'Bottle install failed; never compile, retry or expand dependencies';log.unlink()
  keg=pathlib.Path(p['kegPath']);assert keg.is_dir();size=sum(x.stat().st_size for x in keg.rglob('*') if x.is_file() and not x.is_symlink());assert size<=p['installedBytes']+16*1024*1024
  for name,versions in beforeKegs.items():assert all(pathlib.Path('/opt/homebrew/Cellar',name,version).is_dir() for version in versions)
  assert not default.exists();assert all(pathlib.Path(path).is_symlink() and os.readlink(path)==target for path,target in priorPrefixLinks.items()),'Existing prefix links changed; preserve named diagnostic evidence';installed.append({'name':p['name'],'pkgVersion':p['pkgVersion'],'kegPath':str(keg),'logicalBytes':size,'preservedOldVersions':beforeKegs[p['name']],'previousOptLink':beforeOpt[p['name']],'actualOptLink':os.readlink('/opt/homebrew/opt/'+p['name']) if pathlib.Path('/opt/homebrew/opt',p['name']).is_symlink() else None});save('install-progress.json',{'status':'in-progress','installed':installed,'requests':requests,'acceptance':False})
 assert sum(x['logicalBytes'] for x in installed)<1024*1024*1024
 binaryRoot=pathlib.Path(packages['packages'][-1]['kegPath'])/'bin';binaries=[]
 for name in ['postgres','initdb','pg_isready']:
  path=binaryRoot/name;binaries.append({'path':str(path),'sha256':sha(path),'bytes':path.stat().st_size})
 version=subprocess.run([str(binaryRoot/'postgres'),'--version'],capture_output=True,text=True,check=True,timeout=5).stdout.strip();assert version=='postgres (PostgreSQL) 16.15'
 save('receipt.json',{'status':'exact-pinned-postgresql16-bottles-installed','version':version,'packages':installed,'binaries':binaries,'publicRequests':requests,'downloadBytes':packages['totalDownloadBytes'],'sourceCompilation':False,'postInstallExecuted':False,'defaultClusterCreated':False,'brewServicesUsed':False,'globalPrefixLinkRequested':False,'existingPrefixLinksPreserved':len(priorPrefixLinks),'upgradeUnlinkWrapperUsed':False,'optLinksMayChange':True,'installedKegsPreserved':True,'elapsedSeconds':time.monotonic()-started,'nativeAttempted':False,'acceptance':False})
except Exception:
 save('install-failure.json',{'status':'failed-no-retry-or-source-fallback','installed':installed,'requests':requests,'installedKegsPreserved':True,'nativeAttempted':False,'acceptance':False});raise RuntimeError('Pinned installation failed; bounded sanitized logs retained, installed kegs preserved') from None
