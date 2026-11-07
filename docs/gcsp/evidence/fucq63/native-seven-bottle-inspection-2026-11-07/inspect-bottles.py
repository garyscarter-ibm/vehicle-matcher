"""Download exact official bottles directly OneDrive and retain embedded Ruby bytes for later review; never execute Ruby."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,tarfile,time,traceback,urllib.error,urllib.parse,urllib.request
BASE=pathlib.Path(__file__).resolve().parent;plan=json.loads((BASE/'plan.json').read_text());output=pathlib.Path(os.environ['PHASE_OUTPUT']);started=time.monotonic();requests=0;stage='starting';completed=[];current=None;observations={}
assert hashlib.sha256((BASE/'plan.json').read_bytes()).hexdigest()==os.environ['REVIEWED_PLAN_SHA256']
assert str(output)==plan['outputRoot'];assert pathlib.Path(plan['defaultPostgresCluster']['path']).exists()==plan['defaultPostgresCluster']['exists']
aliases={p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in plan['aliases']};kegs={p:pathlib.Path(p).exists() for p in plan['kegs']};assert aliases==plan['aliases'] and kegs==plan['kegs']
archives=output/'archives';rubies=output/'embedded-ruby';archives.mkdir(mode=0o700);rubies.mkdir(mode=0o700)
def save(name,value):
 target=output/name;pending=target.with_suffix('.pending');pending.write_text(json.dumps(value,indent=2)+'\n');pending.replace(target)
def checkpoint(nextStage):
 global stage
 stage=nextStage;assert time.monotonic()-started<240;save('progress.json',{'stage':stage,'package':current,'requests':requests,'completed':completed,'observations':observations,'elapsedSeconds':time.monotonic()-started,'installed':False,'nativeAttempted':False,'rubyExecuted':False,'acceptance':False})
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
opener=urllib.request.build_opener(NoRedirect)
def request(url,headers=None):
 global requests
 parsed=urllib.parse.urlparse(url);assert parsed.scheme=='https' and parsed.hostname in ['ghcr.io','pkg-containers.githubusercontent.com'];requests+=1;assert requests<=35 and time.monotonic()-started<240
 try:return opener.open(urllib.request.Request(url,headers=headers or {}),timeout=min(30,max(1,240-(time.monotonic()-started))))
 except urllib.error.HTTPError as e:
  if e.code in [301,302,303,307,308]:return e
  raise RuntimeError('public-request-failed') from None
try:
 for package in plan['packages']:
  current=package['name'];observations={};checkpoint('request-anonymous-token');repository=urllib.parse.urlparse(package['url']).path.split('/blobs/')[0][4:]
  with request('https://ghcr.io/token?'+urllib.parse.urlencode({'service':'ghcr.io','scope':'repository:'+repository+':pull'})) as response:token=json.loads(response.read(65536))['token']
  checkpoint('download-exact-bottle');url=package['url'];headers={'Authorization':'Bearer '+token}
  for redirects in range(4):
   response=request(url,headers)
   if response.status in [301,302,303,307,308]:assert redirects<3;url=urllib.parse.urljoin(url,response.headers['Location']);headers={};response.close();continue
   assert response.status==200;break
  archive=archives/package['archiveName'];partial=archives/(package['archiveName']+'.partial');count=0;digest=hashlib.sha256()
  with response,partial.open('xb') as f:
   while True:
    assert time.monotonic()-started<240;block=response.read(65536)
    if not block:break
    count+=len(block);assert count<=package['downloadBytes'];digest.update(block);f.write(block)
   f.flush();os.fsync(f.fileno())
  del token,headers;observations.update(actualArchiveBytes=count,actualArchiveSha256=digest.hexdigest(),expectedArchiveBytes=package['downloadBytes'],expectedArchiveSha256=package['bottleSha256']);checkpoint('verify-exact-whole-bottle');assert count==package['downloadBytes'] and digest.hexdigest()==package['bottleSha256'];partial.replace(archive)
  checkpoint('inspect-bounded-embedded-ruby');members=0;uncompressed=0;rows=[]
  with tarfile.open(archive,'r|gz') as tar:
   for member in tar:
    assert time.monotonic()-started<240;members+=1;assert members<=30000 and len(member.name)<=1024;uncompressed+=member.size;assert uncompressed<=384*1024*1024
    if '/.brew/' not in member.name or not member.name.endswith('.rb'):continue
    assert len(rows)<8 and member.isfile() and 0<member.size<=1048576
    parts=pathlib.PurePosixPath(member.name).parts;assert not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in parts
    content=tar.extractfile(member).read(1048577);assert len(content)==member.size
    row={'member':member.name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'regular':True};rows.append(row)
    if member.name.endswith('/.brew/'+package['name']+'.rb'):
     target=rubies/(package['name']+'.rb');pending=target.with_suffix('.rb.pending')
     with pending.open('xb') as f:f.write(content);f.flush();os.fsync(f.fileno())
     pending.replace(target);row['retainedPath']=str(target)
  matches=[r for r in rows if 'retainedPath' in r];assert len(matches)==1;embedded=matches[0]
  if package['name']=='ca-certificates':assert embedded['bytes']==7949 and embedded['sha256']=='4abe22fb50b45cd5e113747a92a115e0479c4017502d7e8a87132a340b742d84'
  checkpoint('record-distinct-formula-identities');completed.append({'name':package['name'],'pkgVersion':package['pkgVersion'],'archivePath':str(archive),'archiveBytes':count,'archiveSha256':digest.hexdigest(),'trustAnchor':'Pinned exact official whole bottle SHA256 from frozen package metadata','embeddedRuby':embedded,'embeddedRubyMembers':rows,'catalogCurrentFormulaRubySha256':package['formulaRubySha256'],'embeddedEqualsCurrentCatalogFormula':embedded['sha256']==package['formulaRubySha256'],'currentCatalogFormulaIsEmbeddedPin':False,'archiveMembersInspected':members,'uncompressedMemberBytes':uncompressed,'rubyExecuted':False})
  checkpoint('package-complete')
 assert len(completed)==7 and sum(p['archiveBytes'] for p in completed)==66864127
 checkpoint('all-seven-retained-for-actual-ruby-review');save('receipt.json',{'status':'seven-exact-bottles-and-embedded-ruby-retained-for-review','requests':requests,'packages':completed,'retainedArchiveBytes':66864127,'elapsedSeconds':time.monotonic()-started,'separateInstallGrantRequired':True,'actualRubyReviewRequiredBeforeInstall':True,'installed':False,'nativeAttempted':False,'rubyExecuted':False,'sourceCalls':0,'acceptance':False})
except Exception as error:
 frames=[{'file':pathlib.Path(f.filename).name,'line':f.lineno,'function':f.name[:80]} for f in traceback.extract_tb(error.__traceback__)[-8:]];save('failure.json',{'status':'seven-bottle-inspection-failed','stage':stage,'package':current,'errorType':type(error).__name__,'frames':frames,'requests':requests,'completed':completed,'observations':observations,'elapsedSeconds':time.monotonic()-started,'installed':False,'nativeAttempted':False,'rubyExecuted':False,'acceptance':False});raise RuntimeError('Inspection failed; bounded sanitized stage/hash/member diagnostics retained; no install or Ruby execution') from None
finally:
 after={p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in aliases};afterKegs={p:pathlib.Path(p).exists() for p in kegs};save('alias-keg-state.json',{'aliasesBefore':aliases,'aliasesAfter':after,'kegsBefore':kegs,'kegsAfter':afterKegs,'unchanged':aliases==after and kegs==afterKegs,'installationInvoked':False});assert aliases==after and kegs==afterKegs;assert pathlib.Path(plan['defaultPostgresCluster']['path']).exists()==plan['defaultPostgresCluster']['exists']
