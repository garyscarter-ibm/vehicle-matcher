"""Freeze the reviewed exact8 pilot and current integrated runtime. Zero source traffic."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib, re, subprocess
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
proposal = ROOT / 'docs/gcsp/evidence/fucq59/f70-trim-package-plan-2026-11-07'
baseline = ROOT / 'docs/gcsp/evidence/fucq59/f70-model-breadth-pilot-plan-2026-11-07'
original = read(proposal / 'plan.json'); manifest = read(proposal / 'candidate-manifest.json'); plan = read(BASE / 'collection-plan.json')
assert sha(proposal / 'plan.json') == 'f16fd35c8a1a47105c49f8892452670a36e8bec2ce9a420a264858544478621e'
assert sha(proposal / 'candidate-manifest.json') == '09f0892590918a3919d48b2f69a48876df1d4aa0e68449895bb715ff6a3a7d4e'
assert (BASE / 'collection-plan.json').read_bytes() == (proposal / 'templates/chunk01.json').read_bytes()
assert not pathlib.Path(original['outputRoot']).exists(), 'no source root before separate release'
canonical = read(baseline / 'final-canonical-index.json'); spent = read(baseline / 'final-spent-request-index.json')
assert len(canonical['entries']) == 876 and len(spent['entries']) == 1586
assert sum(any(o['kind'] == 'admitted-source' for o in r['origins']) for r in canonical['entries']) == 873
proof = read(baseline / 'retained-validation.json'); assert proof['finalResult'] == '6/6passed,0failed/skipped'
paths = set(manifest['sourceCodePins'])
paths.update(str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py', '.mjs'])
paths.update(['server/package.json','server/package-lock.json'])
# Freeze reviewed local transitive imports as well as the explicit collector/binder/resource boundary.
queue = list(paths)
while queue:
    p = queue.pop()
    if not p.endswith(('.mjs','.js')): continue
    text = (ROOT / p).read_text()
    for relative in re.findall(r"(?:from\s*|import\s*\()\s*['\"](\.[^'\"]+)['\"]", text):
        target = ((ROOT / p).parent / relative).resolve()
        if target.is_file() and ROOT in target.parents:
            key = str(target.relative_to(ROOT))
            if key not in paths: paths.add(key); queue.append(key)
code = {p: sha(ROOT / p) for p in sorted(paths)}
inputs = [proposal / name for name in ['plan.json','candidate-manifest.json','templates/chunk01.json','validation.json']]
inputs += [baseline / name for name in ['final-canonical-index.json','final-spent-request-index.json','retained-validation.json','series-receipt.json']]
inputs += [ROOT / plan['candidateDefinitionBasis']['path'], BASE / 'collection-plan.json']
index_pins = {name: {'path': str(baseline / file), 'sha256': sha(baseline / file), 'digest': digest(value), 'entries': len(value['entries'])}
              for name, file, value in [('canonical','final-canonical-index.json',canonical),('spent','final-spent-request-index.json',spent)]}
allocation = {'schemaVersion':'f70-trim-package8-allocation.v1','id':'f70-trim-package260-20261107-once-chunk01',
    'status':'prepared-unspent; exact parent source release still required','codeCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'codePins':code,'inputPins':{str(p):sha(p) for p in inputs},'indexPins':index_pins,'planDigest':digest(plan),
    'priorIndexDigest':digest(canonical),'spentIndexDigest':digest(spent),'baseline':{'canonical':876,'admittedSource':873,'spent':1586},
    'originalProposal':{'commit':'21bdddbd60f00851b8e27a64b0208a90aea36c82','path':str(proposal / 'plan.json'),'sha256':sha(proposal / 'plan.json'),
      'candidateManifestSha256':sha(proposal / 'candidate-manifest.json'),'templateSha256':sha(proposal / 'templates/chunk01.json'),
      'runtimePinRule':'Original proposal sourceCodePins remain historical; codePins here freeze current integrated capability after c47efdf and 46777fb3.'},
    'requestDigests':original['chunks'][0]['requestDigests'],'candidateAllowance':8,'solverAllowance':8,'attempts':12,'decodedBytes':8388608,
    'responseBytes':1048576,'seriesId':pathlib.Path(original['outputRoot']).name,'maximumWallSecondsFromFirstMarker':900,'chunkSeconds':120,
    'outputRoot':original['outputRoot'],'artifactDestination':str(pathlib.Path(original['outputRoot'])/'chunks/chunk01'),
    'checkpointFile':'collector-checkpoint.json','producerPins':{'projectorSha256':code['scripts/gcsp/capture-bmw-selection.mjs'],
      'qualifierSha256':code['scripts/gcsp/bmw-selection-binding.mjs'],'sessionSha256':code['scripts/gcsp/collection-session.mjs'],'policyVersion':'gcsp-policy-v1'},
    'snapshotVersion':'bmw-gb-trim-package8-2026-11-07.v2','sourceGrantEnvironment':{'F70_TRIM_PACKAGE8_SOURCE_GRANT':'f70-trim-package260-20261107-once-chunk01'},
    'resources':{'workers':1,'hostRamBytes':536870912,'childRamBytes':469762048,'scratchBytes':67108864,'seconds':120,'retainedShardBytes':33554432},
    'retainedDeliverables':{'primary':str(pathlib.Path(original['outputRoot'])/'chunks/chunk01/collector-checkpoint.json'),
      'disposable':False,'retainOnInterruption':True,'exportBeforeScratchCleanup':True,'oneDriveDirect':True},
    'continuationReleased':False,'capacityCreditBeforeSource':0,'acceptance':False}
for name,value in [('execution-plan.json',allocation),('execution-reservation.json',{'allocationId':allocation['id'],'executionPlanSha256':digest(allocation),'hashKind':'canonical-inputDigest','status':'prepared-unspent'})]:
    with (BASE/name).open('x') as f: f.write(json.dumps(value,indent=2)+'\n')
print(json.dumps({'allocationId':allocation['id'],'codePins':len(code),'inputPins':len(inputs),'baseline':allocation['baseline']}))
