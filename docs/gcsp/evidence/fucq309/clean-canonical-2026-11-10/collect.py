#!/usr/bin/env python3
"""Post-run evidence only: independently audit identities, owned scratch, group and reservation."""
import hashlib, json, os, subprocess
from datetime import datetime, timezone
from pathlib import Path
PROOF=Path(__file__).resolve().parent
RUNS=PROOF.parent/'fucq309-supervisor'
ROOT=Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027')
def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as stream:
        for data in iter(lambda:stream.read(1048576),b''):h.update(data)
    return h.hexdigest()
def write(name,data):
    path=PROOF/name
    assert not path.exists(), 'Preserve original evidence; do not overwrite '+str(path)
    path.write_text(json.dumps(data,indent=2)+'\n')
plan=json.loads((PROOF/'plan.json').read_text())
summary=json.loads((PROOF/'summary.json').read_text())
receipt=json.loads((RUNS/'clean-canonical-v4-receipt.json').read_text())
assert summary.get('closed') is True, 'Host teardown did not finish'
assert len(receipt['completed'])==1, 'Inspect incomplete supervisor before collection'
result=next(iter(receipt['completed'].values()))['result']
cleanup=result['cleanup']
manifest_path=Path(cleanup['manifest'])
manifest=json.loads(manifest_path.read_text())
registry_path=Path('/Users/usget/.cache/agent-scaffolding/test-resources/reservations.json')
registry=json.loads(registry_path.read_text())
groups=set(manifest.get('groups',[]))
process_rows=[]
for line in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,rss=,comm='],text=True).splitlines():
    parts=line.split(None,4)
    if len(parts)==5 and int(parts[2]) in groups:process_rows.append(line.strip())
clean={'observedAt':datetime.now(timezone.utc).isoformat(),'runId':'clean-canonical-v4','manifest':str(manifest_path),'root':manifest['root'],
 'manifestState':manifest['state'],'rootAbsent':not os.path.lexists(manifest['root']),'peakScratchBytes':manifest.get('peak',0),
 'ownedProcessGroups':sorted(groups),'liveOwnedGroupRows':process_rows,'reservationReleased':manifest['token'] not in registry,
 'remainingReservationCount':len(registry),'compatibilityException':None,'leftovers':'No owned scratch if audit assertions pass; pre-existing unconfirmed102133-byte jira_sync bytecode preserved.'}
assert clean['manifestState']=='removed' and clean['rootAbsent'] and not process_rows and clean['reservationReleased'],clean
write('cleanup.json',clean)
roots=[]
for path in sorted((RUNS/'ownership').glob('*.json')):
    row=json.loads(path.read_text())
    roots.append({'manifest':str(path),'state':row['state'],'root':row['root'],'absent':not os.path.lexists(row['root']),'peakFileBytes':row.get('peak',0)})
audit={'observedAt':datetime.now(timezone.utc).isoformat(),'run':'clean-canonical-v4-final-audit','supervisorRoots':len(roots),'allRemovedAndAbsent':all(row['state']=='removed' and row['absent'] for row in roots),'roots':roots,
 'totalMeasuredPeakScratchBytes':sum(row['peakFileBytes'] for row in roots),'compatibilityException':None,'unconfirmedPreExistingBytecode':{'path':str(ROOT/'_tools/__pycache__/jira_sync.cpython-314.pyc'),'preserved':True,'bytes':(ROOT/'_tools/__pycache__/jira_sync.cpython-314.pyc').stat().st_size if (ROOT/'_tools/__pycache__/jira_sync.cpython-314.pyc').exists() else None}}
assert audit['allRemovedAndAbsent'], 'An owned historical root remains; inspect without broad deletion'
write('cleanup-audit.json',audit)
source_changed=[path for path,value in plan['productionSourceHashes'].items() if sha(ROOT/path)!=value]
dep_root=Path(plan['dependencyRoot'])
dep_changed=[path for path,value in plan['dependencySourceHashes'].items() if sha(dep_root/path)!=value]
script_changed=[path for path,value in plan['executablesSha256'].items() if sha(path)!=value]
write('identity-audit.json',{'observedAt':datetime.now(timezone.utc).isoformat(),'head':plan['head'],'tree':plan['tree'],'productionFilesChecked':len(plan['productionSourceHashes']),'productionChanged':source_changed,'dependencyFilesChecked':len(plan['dependencySourceHashes']),'dependencyChanged':dep_changed,'executablesChanged':script_changed,'runtimeUnchanged':sha(plan['runtime']['execPath'])==plan['runtime']['sha256']})
assert not source_changed and not dep_changed and not script_changed
print(json.dumps({'status':summary['status'],'applicationSeconds':summary['elapsedMs']/1000,'resultStored':summary['resultStored'],'storedRows':summary.get('storedRowCount'),'supervisorResult':result,'cleanup':clean,'supervisorRoots':len(roots)},indent=2))
