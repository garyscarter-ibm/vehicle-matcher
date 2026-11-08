"""Frozen-prefix reconciliation; read-only source inputs, no tests or HTTP replay."""
import collections, datetime, hashlib, json, os, pathlib, subprocess

ROOT=pathlib.Path('/Users/usget/Claude/vehicle-matcher')
CONTROL=ROOT/'.claude/f58-63-overnight-20261106/f58'
CLOUD=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output')
DEST=CLOUD/'global-union10351-20261107'
cache={};checks=0;groups=set();tokens=set();roots=set();totals=collections.Counter();lanes=[]
read=lambda p:json.loads(pathlib.Path(p).read_text())
def sha(p):
 p=pathlib.Path(p)
 if p not in cache:
  h=hashlib.sha256()
  with p.open('rb') as f:
   for b in iter(lambda:f.read(1048576),b''):h.update(b)
  cache[p]=h.hexdigest()
 return cache[p]
def check(value,message):
 global checks
 checks+=1
 assert value,message
def write(p,value):
 with p.open('x') as f:json.dump(value,f,sort_keys=True,indent=2);f.write('\n')
def admitted(rows):return sum(any(o['kind']=='admitted-source' for o in r['origins']) for r in rows)

assert not DEST.exists()
base=CLOUD/'global-union8813-20261107'
check(sha(CONTROL/'global-union8813-parent-audit.json')=='3272740ef9c4bccab5950890e59e327b575e1875940330bb0fd0ac7153d9627d','prior parent audit')
check(sha(base/'final-canonical-index.json')=='fbf27148d27e4a46259bf4d66cfdb2db11a692213ffb4c75245aed886739ca8d','basecanonical')
check(sha(base/'final-spent-request-index.json')=='f6dee6e3e587f0b630d5c7901ccbda16d68259591e289d065bfa72e1472e579e','basespent')
canonical=read(base/'final-canonical-index.json');spent=read(base/'final-spent-request-index.json')
union_c={r['configurationId']:r for r in canonical['entries']};union_s={r['requestDigest']:r for r in spent['entries']}
specs=[('F70-1156-145', 'f70-optional-axis-suffix1156-20261107-once', 145, 822, 334, '3ac6b02d4171d428906a4b4be6f54d6c754e9ab571c0cf8bf208768aa427102b', '846fd0054e0593f9ec626d85cc9b3059fadf48fa42de858ed585f980c7fea192'), ('breadth03-120', 'scheme-breadth30-phase03-960-20261107-once', 120, 716, 244, '851c876cae2c9e21b282d2ce0976ae386a4291cbc8274a276b3559d6fd4eb215', '97e8c43513933bc39acd8da59e2649e296aea6ea1db3b11f454b5924da091c80')]
for label,name,count,adds,rejects,final_c_sha,final_s_sha in specs:
 directory=CLOUD/name/'sessions';prior_c_sha=sha(directory/'session001/prior-canonical-index.json');prior_s_sha=sha(directory/'session001/spent-request-index.json');lane=collections.Counter();proof_pins=[]
 for number in range(1,count+1):
  session=directory/f'session{number:03d}';p=read(session/'live-validation.json');r=read(session/'receipt.json');primary=read(session/'collector-checkpoint.json')['content'];accepted=[json.loads(x) for x in (session/'accepted.jsonl').read_text().splitlines() if x.strip()];tag=f'{label}-{number}'
  pins=p['retainedChecks']['identity']
  for path,h in pins.items():
   actual=pathlib.Path(path) if pathlib.Path(path).is_absolute() else ROOT/('.claude/worktrees/DEV-2026-11-04-032' if label.startswith('F70') else '.claude/worktrees/DEV-2026-11-04-035')/path
   check(sha(actual)==h,tag+'testedidentity '+path)
  check(p['primarySha256']==r['checkpointSha256']==sha(session/'collector-checkpoint.json') and p['receiptSha256']==sha(session/'receipt.json'),tag+'seals')
  check(sha(session/'prior-canonical-index.json')==prior_c_sha and sha(session/'spent-request-index.json')==prior_s_sha,tag+'chain')
  check(sha(session/'final-canonical-index.json')==p['finalCanonicalIndexSha256'] and sha(session/'final-spent-request-index.json')==p['finalSpentRequestIndexSha256'],tag+'finalpins')
  strict=p['retainedChecks'];s=strict['summary'];check(strict['rc']==0 and strict['issue'] is None and s['tests']==s['pass']==5 and all(s.get(k,0)==0 for k in ['fail','cancelled','skipped','todo']),tag+'strict5')
  check(p['sourceTrafficDuringValidation']==0 and p['acceptance'] is False and r['f61Acceptance'] is False,tag+'traffic/acceptance')
  counts=primary['counts'];actual=p['actualSource'];solver=counts['operations']['solve'];gets=counts['httpAttempts']
  check(primary['accepted']==accepted and len(accepted)==r['newlyAccepted']==p['sourceCapacityCredit']==actual['accepted'] and all(a['admission'] is True and a['sourceKind']=='dated-snapshot' for a in accepted),tag+'accepted')
  check(len(primary['rejected'])==r['rejected']==actual['rejected'] and len(primary['duplicates'])==r['duplicates']==actual['duplicates']==0,tag+'reject/duplicate')
  check(r['reason']==actual['reason']=='queue-exhausted' and counts==r['counts'] and gets==counts['sourceCalls']==r['actualAttempts']==actual['attempts'] and solver==actual['solverRequests'] and all(counts[k]==0 for k in ['failures','timeouts','substitutions','cacheEvictions']),tag+'realcomplete')
  before_c=read(session/'prior-canonical-index.json')['entries'];after_c=read(session/'final-canonical-index.json')['entries'];before_s=read(session/'spent-request-index.json')['entries'];after_s=read(session/'final-spent-request-index.json')['entries'];by_id={a['configurationId']:a for a in after_c};ids={a['configurationId'] for a in accepted}
  check(len(by_id)==len(after_c) and all(by_id.get(a['configurationId'])==a for a in before_c) and set(by_id)-{a['configurationId'] for a in before_c}==ids,tag+'canonicaldelta')
  check(after_s[:len(before_s)]==before_s and len(after_s)-len(before_s)==solver and len({a['requestDigest'] for a in after_s})==len(after_s),tag+'spentdelta')
  evidence=read(session/'reconciliation-event-evidence.json');events={}
  for source in evidence['sources']:
   f=session/source['file'];lines=f.read_text().splitlines();check(sha(f)==source['sha256'] and len(lines)==source['rows'],tag+'eventfile')
   for line in lines:
    row=json.loads(line);key=(row['attempt'],row['phase']);check(key not in events or events[key]==line,tag+'eventoverlap');events[key]=line
  observed=[json.loads(line) for line in events.values()]
  check(len(observed)==2*gets and sorted(e['attempt'] for e in observed if e['phase']=='started')==list(range(1,gets+1)) and sum(e['phase']=='headers-received' and e.get('status')==200 for e in observed)==gets and all(e['method']=='GET' for e in observed),tag+'actualGETevents')
  for key in ['cleanup','retainedCleanup']:
   clean=p[key];m=read(clean['ownership_manifest']);check(all(clean[k] is True for k in ['scratch_absent','groups_absent','dependency_link_absent','reservation_absent','code_identity_unchanged']) and m['state']=='removed' and m['root']==clean['scratch_root'] and not os.path.lexists(clean['scratch_root']),tag+'cleanup');groups.update(m['groups']);tokens.add(m['token']);roots.add(m['root'])
  lane.update(admitted=len(accepted),rejected=len(primary['rejected']),GET=gets,solver=solver,strictChecks=5,removedScratchBytes=sum(p[k]['removed_allocation_bytes'] for k in ['cleanup','retainedCleanup']));proof_pins.append({'path':str(session/'live-validation.json'),'sha256':sha(session/'live-validation.json')});prior_c_sha=p['finalCanonicalIndexSha256'];prior_s_sha=p['finalSpentRequestIndexSha256']
 check(prior_c_sha==final_c_sha and prior_s_sha==final_s_sha and lane['admitted']==adds and lane['rejected']==rejects,label+'terminal')
 for row in after_c:
  cid=row['configurationId'];check(cid not in union_c or union_c[cid]==row,label+'canonicaloverlap');union_c.setdefault(cid,row)
 for row in after_s:
  digest=row['requestDigest'];check(digest not in union_s or union_s[digest]==row,label+'spentoverlap');union_s.setdefault(digest,row)
 lanes.append({'label':label,'counts':dict(lane),'proofPins':proof_pins,'canonicalSha256':prior_c_sha,'spentSha256':prior_s_sha});totals.update(lane)

check(admitted(union_c.values())==10351 and len(union_c)==10354,'exactglobal10351')

ps=subprocess.run(['/bin/ps','-axo','pgid=,stat='],capture_output=True,text=True,check=True);live={int(v[0]) for line in ps.stdout.splitlines() if len(v:=line.split())>=2 and not v[1].startswith('Z')};reservations=read(pathlib.Path.home()/'.cache/agent-scaffolding/test-resources/reservations.json');check(not groups.intersection(live) and not tokens.intersection(reservations),'independentgroups/tokens')
owner={'ownerPid':os.getpid(),'retainedOutputRoot':str(DEST),'scratchCreated':False,'sourceHTTP':0,'testsReplayed':0,'expectedBytes':12*1024*1024,'forecastRAMMiB':192,'forecastSeconds':30};write(CONTROL/'global-union10351-parent-audit-ownership.json',owner);DEST.mkdir(mode=0o700)
write(DEST/'final-canonical-index.json',{**canonical,'basis':'parent8813 plus exact strictF70-1156prefix145 and breadthphase03prefix120; all common prefixes byteidentical; zero replay','entries':list(union_c.values())});write(DEST/'final-spent-request-index.json',{**spent,'basis':'exact immutable shared-prefix union; conservative failed-template exclusions remain labelled in indexes and continuation packets; spent-index entries are not all observed solver attempts','entries':list(union_s.values())})
report={'status':'parent-proved','schemaVersion':'actual-global-union-candidate.v1','scope':'count10351proof; profiles/modelbreadth/enrichmentandfullacceptanceopen','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'admittedSource':10351,'canonical':10354,'spent':len(union_s),'remaining10000':0,'overshoot10000':351,'checks':checks,'errors':[],'sourceRequestsDuringAudit':0,'testsReplayed':0,'scratchCreated':False,'sourceAcceptance':False,'lanes':lanes,'totals':dict(totals),'priorParentAuditPin':{'path':str(CONTROL/'global-union8813-parent-audit.json'),'sha256':sha(CONTROL/'global-union8813-parent-audit.json')},'independentCleanup':{'scratchRootsAbsent':len(roots),'groupsChecked':len(groups),'allGroupsAbsent':True,'allReservationsAbsent':True,'leftovers':[],'compatibilityException':None},'canonicalPin':{'path':str(DEST/'final-canonical-index.json'),'sha256':sha(DEST/'final-canonical-index.json')},'spentPin':{'path':str(DEST/'final-spent-request-index.json'),'sha256':sha(DEST/'final-spent-request-index.json')},'retainedLogicalBytes':sum(p.stat().st_size for p in DEST.iterdir()),'failedSourceSessionsCapacityCredit':0,'newSourceCapacity':1538}
write(CONTROL/'global-union10351-parent-audit.json',report);print(json.dumps({k:v for k,v in report.items() if k!='lanes'}))
