"""Append exact actual pilot outcomes to the frozen audited cumulative base. No HTTP."""
import sys
sys.dont_write_bytecode=True
import json,pathlib,hashlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
a=read(BASE/'execution-plan.json');series=read(BASE/'series-receipt.json');assert series['stop']=='all-six-model-solver-pilots-complete'
for pin in a['indexPins'].values():assert sha(pathlib.Path(pin['path']))==pin['sha256']
canonical=read(pathlib.Path(a['indexPins']['canonical']['path']));spent=read(pathlib.Path(a['indexPins']['spent']['path']));known={r['configurationId'] for r in canonical['entries']};used={r['requestDigest'] for r in spent['entries']};initial=(len(known),len(used));new=0;counts={'accepted':0,'duplicate':0,'rejected':0}
assert initial==(len(canonical['entries']),len(spent['entries']))
for id in a['contextIds']:
 d=BASE/id;p=read(d/'collection-plan.json');e=read(d/'collector-checkpoint.json');s=e['content'];r=read(d/'receipt.json')
 assert digest(s)==e['contentDigest'] and sha(d/'collector-checkpoint.json')==r['checkpointSha256']==sha(d/'collector-state.json')
 assert r['planDigest']==digest(p)==a['contextPlanDigests'][id] and r['allocationId']==a['id'] and r['actualAttempts']==12 and s['cursor']==8 and s['counts']['operations']=={'page':1,'settings':1,'discover':1,'options':1,'solve':8}
 assert r['admitted']==len(s['accepted'])==len(s['records']) and r['duplicates']==len(s['duplicates']) and r['rejected']==len(s['rejected'])
 assert len(s['accepted'])+len(s['duplicates'])+len(s['rejected'])==8 and len(s['sourceCaptures'])==len(s['accepted'])+len(s['duplicates'])
 captures={c['candidateId']:c for c in s['sourceCaptures']};duplicates={x['candidateId'] for x in s['duplicates']};rejects={x['candidateId'] for x in s['rejected']};ids={c['candidateId'] for c in p['candidates']}
 assert len(captures)==len(s['sourceCaptures']) and len(duplicates)==len(s['duplicates']) and len(rejects)==len(s['rejected'])
 assert duplicates<=captures.keys() and not captures.keys()&rejects and captures.keys()|rejects==ids
 admitted_solver={record['sourceEvidence']['solver'] for record in s['accepted']}
 assert len(admitted_solver)==len(s['accepted']) and {c['solver']['sha256'] for cid,c in captures.items() if cid not in duplicates}==admitted_solver
 for record in s['accepted']:
  assert record['admission'] is True and record['sourceKind']=='dated-snapshot' and record['configurationId'] not in known
  known.add(record['configurationId']);canonical['entries'].append({'configurationId':record['configurationId'],'origins':[{'path':str((d/'accepted.jsonl').relative_to(ROOT)),'kind':'admitted-source'}]});new+=1
 for duplicate in s['duplicates']:assert duplicate['configurationId'] in known
 for candidate in p['candidates']:
  request=digest({'modelRegistration':p['modelRegistration'],'request':candidate['request']});assert request not in used;used.add(request)
  cid=candidate['candidateId'];outcome='duplicate' if cid in duplicates else 'rejected' if cid in rejects else 'accepted';counts[outcome]+=1
  spent['entries'].append({'candidateId':cid,'requestDigest':request,'outcome':outcome})
assert len(canonical['entries'])==initial[0]+new and len(spent['entries'])==initial[1]+48 and new==counts['accepted'] and sum(counts.values())==48
assert series['newConfigurations']==new and series['publicGetAttempts']==72
for name,value in [('final-canonical-index.json',canonical),('final-spent-request-index.json',spent)]:
 with (BASE/name).open('x') as f:f.write(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
summary={'canonicalEntries':len(canonical['entries']),'admittedSourceConfigurations':sum(any(o['kind']=='admitted-source' for o in r['origins']) for r in canonical['entries']),'spentSolverRequests':len(spent['entries']),'newlyAccepted':new,'actualOutcomes':counts,'allPriorEntriesPreserved':True,'canonicalSha256':sha(BASE/'final-canonical-index.json'),'spentSha256':sha(BASE/'final-spent-request-index.json'),'strictBindingVerificationStillRequired':True,'globalUnionRequired':True}
with (BASE/'reconciliation.json').open('x') as f:f.write(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
