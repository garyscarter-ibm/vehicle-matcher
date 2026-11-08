"""Append exact actual pilot admissions and solver attempts to the pinned cumulative base. No HTTP."""
import sys
sys.dont_write_bytecode=True
import json,pathlib,hashlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
a=read(BASE/'execution-plan.json');series=read(BASE/'series-receipt.json');assert series['stop']=='all-six-model-solver-pilots-complete'
for pin in a['indexPins'].values():assert sha(pathlib.Path(pin['path']))==pin['sha256']
canonical=read(pathlib.Path(a['indexPins']['canonical']['path']));spent=read(pathlib.Path(a['indexPins']['spent']['path']));known={r['configurationId'] for r in canonical['entries']};used={r['requestDigest'] for r in spent['entries']};initial=(len(known),len(used));new=0
for id in a['contextIds']:
 d=BASE/id;p=read(d/'collection-plan.json');e=read(d/'collector-checkpoint.json');s=e['content'];r=read(d/'receipt.json')
 assert digest(s)==e['contentDigest'] and sha(d/'collector-checkpoint.json')==r['checkpointSha256']==sha(d/'collector-state.json')
 assert r['planDigest']==digest(p) and r['actualAttempts']==12 and s['cursor']==8 and s['counts']['operations']=={'page':1,'settings':1,'discover':1,'options':1,'solve':8}
 assert r['admitted']==len(s['accepted'])==8 and not s['duplicates'] and not s['rejected']
 for record in s['accepted']:
  assert record['admission'] is True and record['sourceKind']=='dated-snapshot' and record['configurationId'] not in known
  known.add(record['configurationId']);canonical['entries'].append({'configurationId':record['configurationId'],'origins':[{'path':str((d/'accepted.jsonl').relative_to(ROOT)),'kind':'admitted-source'}]});new+=1
 for candidate in p['candidates']:
  request=digest({'modelRegistration':p['modelRegistration'],'request':candidate['request']});assert request not in used;used.add(request)
  assert any(c['candidateId']==candidate['candidateId'] for c in s['sourceCaptures'])
  spent['entries'].append({'candidateId':candidate['candidateId'],'requestDigest':request,'outcome':'accepted'})
assert (len(canonical['entries']),len(spent['entries']),new)==(1974,2684,48)
for name,value in [('final-canonical-index.json',canonical),('final-spent-request-index.json',spent)]:
 with (BASE/name).open('x') as f:f.write(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'canonicalEntries':1974,'admittedSourceConfigurations':sum(any(o['kind']=='admitted-source' for o in r['origins']) for r in canonical['entries']),'spentSolverRequests':2684,'newlyAccepted':new,'allPriorEntriesPreserved':True,'canonicalSha256':sha(BASE/'final-canonical-index.json'),'spentSha256':sha(BASE/'final-spent-request-index.json'),'strictBindingVerificationStillRequired':True}))
