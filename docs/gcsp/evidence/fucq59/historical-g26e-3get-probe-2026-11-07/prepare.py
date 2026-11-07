"""Freeze one historical request packet; no source calls or output allocation."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert not(BASE/'plan.json').exists()and not(BASE/'actual').exists()
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
proposal=read(BASE.parent/'historical-catalogue-capability-assessment-2026-11-07/finite-probe-proposal.json')
plan=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',"import {DISCOVERY} from './catalogue.mjs'; console.log(JSON.stringify(DISCOVERY))"],cwd=BASE,text=True))
plan.update(schemaVersion='historical-g26e-finite-source-plan.v1',status='prepared; exact parent source release required',inputs=proposal['sourcePins'],sourceGrant=False,capacityCredit=0,acceptance=False,interpretation='Selected2024requestdates remain probes. Retain returned full model/AG/range/steering/order/effect/direct derivative separately. M60never substitutesM50. Catalogue evidence grants no constructibility, scheme join, production/year/plant/profile/WMI/integration acceptance.',supervisorOutput='/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/historical-g26e-3get/source',outputOwnershipManifest='/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/historical-g26e-3get/source/durable-output-ownership.json',retainedOutput=str(BASE/'actual'))
paths=[p for p in BASE.iterdir()if p.suffix in['.py','.mjs']];plan['codePins']={str(p.relative_to(ROOT)):sha(p)for p in paths};plan['codePins']['_tools/test_resources.py']=sha(ROOT/'_tools/test_resources.py');plan['runtimePins']={str(p):sha(p)for p in[pathlib.Path('/opt/homebrew/bin/node').resolve(),pathlib.Path('/usr/bin/python3')]}
(BASE/'plan.json').write_text(json.dumps(plan,indent=2)+'\n');print(json.dumps({'planSha256':sha(BASE/'plan.json'),'codePins':len(plan['codePins']),'inputPins':len(plan['inputs']),'GET':3,'sourceGrant':False}))
