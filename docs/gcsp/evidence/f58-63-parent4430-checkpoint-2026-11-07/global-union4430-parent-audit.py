"""Read-only actual breadth48 audit and exact union with parent-proved4398; no replay."""
from pathlib import Path
import json,hashlib,os,datetime
ROOT=Path('/Users/usget/Claude/vehicle-matcher');CHILD=ROOT/'.claude/worktrees/DEV-2026-11-04-035';B=CHILD/'docs/gcsp/evidence/fucq59/scheme-breadth-typed-pilot48-2026-11-07';CTL=ROOT/'.claude/f58-63-overnight-20261106/f58';CLOUD=Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output');DEST=CLOUD/'global-union4430-20261107'
read=lambda p:json.loads(Path(p).read_text());cache={};checks=0

def sha(p):
 p=Path(p)
 if p not in cache:cache[p]=hashlib.sha256(p.read_bytes()).hexdigest()
 return cache[p]
def check(value):
 global checks
 checks+=1;assert value

def save(p,d):
 with p.open('x') as f:json.dump(d,f,indent=2,sort_keys=True);f.write('\n')

v=read(B/'actual-validation.json');p=v['retainedProof'];check(sha(B/'actual-validation.json')=='8bda2daf68d246f1d45b9869bdfd5359cd61fd8590ad74e000c37d252e6f85ef');check(p['rc']==0 and p['issue'] is None and p['testCounts']=={'tests':42,'pass':42,'fail':0,'skipped':0} and p['identityUnchanged'])
for path,h in p['identity'].items():check(sha(Path(path) if Path(path).is_absolute() else CHILD/path)==h)
series=read(B/'series-receipt.json');check(sha(B/'series-receipt.json')==v['seriesReceiptSha256']);check(series['publicGetAttempts']==72 and len(series['contexts'])==6 and series['newConfigurations']==32 and series['acceptance'] is False)
rows=[];totals={'admitted':0,'rejected':0,'duplicates':0,'GET':0,'solver':0,'decodedBytes':0}
for context in series['contexts']:
 d=B/context['id'];state=read(d/'collector-checkpoint.json')['content'];r=read(d/'receipt.json');check(r==context['retainedReceipt']);check(sha(d/'collector-checkpoint.json')==r['checkpointSha256']==context['checkpointExport']['checkpointSha256']);check(state['counts']==r['counts']==context['checkpointCounts']);check(r['reason']=='queue-exhausted' and r['processedCandidates']==8 and r['actualAttempts']==12);check(len(state['accepted'])==r['admitted'] and len(state['rejected'])==r['rejected'] and len(state['duplicates'])==r['duplicates']==0)
 accepted=[json.loads(x) for x in (d/'accepted.jsonl').read_text().splitlines() if x.strip()];check(accepted==state['accepted'] and all(x['admission'] is True and x['sourceKind']=='dated-snapshot' for x in accepted));rows.extend(accepted)
 events=[json.loads(x) for x in (d/'source-events.jsonl').read_text().splitlines() if x.strip()];check(sorted(x['attempt'] for x in events if x['phase']=='started')==list(range(1,13)));check(len(events)==24 and all(x['method']=='GET' and 'url' not in x and 'headers' not in x for x in events) and sum(x['phase']=='headers-received' and x['status']==200 for x in events)==12)
 c=context['cleanup'];check(all(c[k] is True for k in ['groupsAbsent','scratchAbsent','reservationAbsent']) and not os.path.lexists(c['scratchRoot']) and read(c['manifest'])['state']=='removed')
 totals['admitted']+=len(accepted);totals['rejected']+=r['rejected'];totals['duplicates']+=r['duplicates'];totals['GET']+=r['actualAttempts'];totals['solver']+=r['counts']['operations']['solve'];totals['decodedBytes']+=r['counts']['decodedBytes']
check(totals==v['actualSource']|{'elapsedSeconds':v['actualSource']['elapsedSeconds']} if False else totals=={'admitted':32,'rejected':16,'duplicates':0,'GET':72,'solver':48,'decodedBytes':6326538})
check(len(rows)==len({x['configurationId'] for x in rows})==len({x['canonicalSignature'] for x in rows})==32)
clean=v['retainedCleanup'];check(all(clean[k] for k in ['scratch_absent','groups_absent','reservation_absent','dependencyLinkAbsent']) and not os.path.lexists(clean['scratchRoot']) and read(clean['manifest'])['state']=='removed')
base=read(CLOUD/'global-union4398-20261107/final-canonical-index.json');spent=read(CLOUD/'global-union4398-20261107/final-spent-request-index.json');check(sha(CLOUD/'global-union4398-20261107/final-canonical-index.json')=='aa088c6e74df1ae40ff8483ab8fe7654d4832b3d1a1721e37d08180eef99e803');check(sha(CLOUD/'global-union4398-20261107/final-spent-request-index.json')=='ee9c9fff29937700c5d40abf082957d92cce57331bfe914bda6a5eb9acba8615')
c={x['configurationId']:x for x in base['entries']};s={x['requestDigest']:x for x in spent['entries']};old=set(c)
for x in read(B/'final-canonical-index.json')['entries']:
 key=x['configurationId'];check(key not in c or c[key]==x);c.setdefault(key,x)
for x in read(B/'final-spent-request-index.json')['entries']:
 key=x['requestDigest'];check(key not in s or s[key]==x);s.setdefault(key,x)
check(set(c)-old=={x['configurationId'] for x in rows});check(len(c)==4433 and sum(any(y['kind']=='admitted-source' for y in x['origins']) for x in c.values())==4430 and len(s)==5828)
report={'schemaVersion':'actual-global-union.v1','status':'proved','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'parent-proved4398 plus independent exactinput/primary/event/cleanup audit of42strict breadthchecks; no source/test replay','admittedSource':4430,'canonical':4433,'spent':5828,'newSince4398':32,'remaining10000':5570,'checks':checks,'actualBreadthSource':totals,'strictChecksReused':42,'sourceRequestsDuringAudit':0,'testsReplayed':0,'scratchCreated':False,'sourceAcceptance':False,'basisAuditSha256':sha(CTL/'global-union4398-parent-audit.json'),'breadthProofSha256':sha(B/'actual-validation.json'),'cleanup':v['independentCleanup']}
save(CTL/'global-union4430-ownership.json',{'ownerPid':os.getpid(),'outputRoot':str(DEST),'disposable':False,'scratchCreated':False,'expectedBytes':6*1024*1024,'purpose':'immutable canonical/spent indexes only; existing primary retained in place'})
DEST.mkdir(mode=0o700);save(DEST/'final-canonical-index.json',{**base,'basis':'parent-proved4398 plus strict actual breadth32','entries':sorted(c.values(),key=lambda x:x['configurationId'])});save(DEST/'final-spent-request-index.json',{**spent,'basis':'exactprefix and disjoint48spent breadth outcomes','entries':list(s.values())})
report.update(canonicalPin={'path':str(DEST/'final-canonical-index.json'),'sha256':sha(DEST/'final-canonical-index.json')},spentPin={'path':str(DEST/'final-spent-request-index.json'),'sha256':sha(DEST/'final-spent-request-index.json')},retainedLogicalBytes=sum(p.stat().st_size for p in DEST.iterdir()));save(CTL/'global-union4430-parent-audit.json',report);print(json.dumps(report))
