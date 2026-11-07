"""One fresh exact first-bottle diagnostic only. Never invokes Homebrew installation."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,tarfile,time,traceback,urllib.error,urllib.parse,urllib.request
BASE=pathlib.Path(__file__).resolve().parent;plan=json.loads((BASE/'plan.json').read_text());package=plan['package'];scratch=pathlib.Path(os.environ['TMPDIR']);output=pathlib.Path(os.environ['PHASE_OUTPUT']);started=time.monotonic();requests=0;stage='starting';observations={};aliases={p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in plan['aliases']}
def save(name,value):(output/name).write_text(json.dumps(value,indent=2)+'\n')
def checkpoint(nextStage):
 global stage
 stage=nextStage;save('progress.json',{'stage':stage,'requests':requests,'observations':observations,'elapsedSeconds':time.monotonic()-started,'installed':False,'nativeAttempted':False,'acceptance':False})
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
opener=urllib.request.build_opener(NoRedirect)
def request(url,headers=None):
 global requests
 parsed=urllib.parse.urlparse(url);assert parsed.scheme=='https' and parsed.hostname in ['ghcr.io','pkg-containers.githubusercontent.com'];requests+=1;assert requests<=5 and time.monotonic()-started<60
 try:return opener.open(urllib.request.Request(url,headers=headers or {}),timeout=min(15,max(1,60-(time.monotonic()-started))))
 except urllib.error.HTTPError as e:
  if e.code in [301,302,303,307,308]:return e
  raise RuntimeError('public-request-failed') from None
try:
 checkpoint('request-anonymous-token');repository=urllib.parse.urlparse(package['url']).path.split('/blobs/')[0][4:]
 with request('https://ghcr.io/token?'+urllib.parse.urlencode({'service':'ghcr.io','scope':'repository:'+repository+':pull'})) as response:token=json.loads(response.read(65536))['token']
 checkpoint('download-exact-first-bottle');url=package['url'];headers={'Authorization':'Bearer '+token}
 for redirects in range(4):
  response=request(url,headers)
  if response.status in [301,302,303,307,308]:assert redirects<3;url=urllib.parse.urljoin(url,response.headers['Location']);headers={};response.close();continue
  assert response.status==200;break
 archive=scratch/'ca-certificates--2026-10-20.all.bottle.tar.gz';count=0;digest=hashlib.sha256()
 with response,archive.open('xb') as f:
  while True:
   block=response.read(65536)
   if not block:break
   count+=len(block);assert count<=package['downloadBytes'];digest.update(block);f.write(block)
 del token,headers;observations.update(actualArchiveBytes=count,actualArchiveSha256=digest.hexdigest(),expectedArchiveBytes=package['downloadBytes'],expectedArchiveSha256=package['bottleSha256']);checkpoint('verify-archive-bytes');assert count==package['downloadBytes'] and digest.hexdigest()==package['bottleSha256']
 checkpoint('inspect-embedded-formula');rows=[]
 with tarfile.open(archive,'r:gz') as tar:
  members=tar.getmembers();assert len(members)<=10000
  for member in members:
   if '/.brew/' in member.name:
    assert len(member.name)<=512 and member.size<=1048576;row={'name':member.name,'bytes':member.size,'regular':member.isfile()}
    if member.isfile():row['sha256']=hashlib.sha256(tar.extractfile(member).read()).hexdigest()
    rows.append(row)
  assert len(rows)<=100;observations['embeddedBrewMembers']=rows;observations['expectedFormulaRubySha256']=package['formulaRubySha256'];checkpoint('verify-embedded-ruby');matches=[r for r in rows if r['name'].endswith('/.brew/ca-certificates.rb') and r['regular']];assert len(matches)==1;assert matches[0]['sha256']==package['formulaRubySha256']
 checkpoint('verified');save('receipt.json',{'status':'exact-first-bottle-preflight-passed','requests':requests,'observations':observations,'elapsedSeconds':time.monotonic()-started,'installed':False,'nativeAttempted':False,'acceptance':False})
except Exception as error:
 frames=[{'file':pathlib.Path(f.filename).name,'line':f.lineno,'function':f.name[:80]} for f in traceback.extract_tb(error.__traceback__)[-8:]];save('failure.json',{'status':'exact-first-bottle-preflight-failed','stage':stage,'errorType':type(error).__name__,'frames':frames,'requests':requests,'observations':observations,'elapsedSeconds':time.monotonic()-started,'installed':False,'nativeAttempted':False,'acceptance':False});raise RuntimeError('Fresh preflight failed; sanitized stage/hash/member diagnostics retained; no install attempted') from None
finally:
 after={p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in aliases};save('alias-state.json',{'before':aliases,'after':after,'unchanged':aliases==after,'installationInvoked':False});assert aliases==after
