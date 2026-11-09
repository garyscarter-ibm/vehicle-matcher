"""Print an unauthorized exact phase-review template, using only retained metadata; never executes a phase."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
assert len(sys.argv)==2;phase=sys.argv[1];plan=read(BASE/'plan.json');assert phase in plan['phases'];candidate=read(pathlib.Path(plan['candidatePlan']['path']));output=pathlib.Path(candidate['outputRoot'])
paths=[pathlib.Path(candidate['baseline']['ordinaryActivationReceipt']['path'])]
if phase!='publish-restart':paths.append(output/'publish-restart-receipt.json')
if phase in ['summarize','descriptor']:paths.extend(output/name for name in ['strict-direct-audit-receipt.json',*[f'http-chunk{i}-receipt.json' for i in range(8)],'rollback-receipt.json'])
if phase=='descriptor':paths.append(output/'offline-proof-summary.json')
# FUCQ-160: emit exactly supervise.py's literal receipt-pin filter (plain ordinary receipt.json is excluded), in its str order.
paths=sorted(set(p for p in paths if (p.name.endswith('-receipt.json') or p.name=='offline-proof-summary.json') and str(p)!=plan['candidateReceipt']['path']),key=str)
assert all(p.is_file() for p in paths),'Required prior phase receipt unavailable; preserve completed phases and do not invent its identity'
grant={'authorized':False,'phase':phase,'planSha256':sha(BASE/'plan.json'),'candidateReceiptSha256':plan['candidateReceipt']['sha256'],'manifestDigest':plan['expectedManifestDigest'],'codePins':plan['codePins'],'sourceCalls':0,'publicRequests':0,'nativeDatabaseRequests':0,'ordinaryPublicationExecuted':False,'priorReceiptPins':[{'path':str(p),'sha256':sha(p)} for p in paths]};print(json.dumps(grant,indent=2))
