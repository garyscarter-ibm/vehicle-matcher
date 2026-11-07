"""Bounded F60 four-GET observation contract checks; no source traffic or ordinary data writes."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib
ROOT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-036')
BASE=ROOT/'docs/gcsp/evidence/fucq62'
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f60/qualified-image-boundary')
def read(p):return json.loads(p.read_text())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    return h.hexdigest()
def group_absent(R,pid):
    if R.group_has_live_members(pid) is False:return True
    try:os.killpg(pid,0)
    except ProcessLookupError:return True
    return False
def run():
    phase_name=sys.argv[1];phase=OUT/phase_name;phase.mkdir(parents=True,exist_ok=False)
    assert phase_name in ['retained-image-red','retained-image-green','retained-image-final','retained-image-final2','qualification-red','qualification-green','qualification-boundary','qualification-retained','image-red','image-green','image-boundary','image-green2','image-green3','image-runner','image-final','image-final2','observation-red', 'observation-green', 'observation-boundary', 'observation-green2', 'observation-final', 'observation-final2', 'observation-gates']
    tests=['server/test/gcsp-otd-qualified-enrichment.test.js']
    if phase_name.startswith('image-'):tests=['server/test/gcsp-v2-live-image.test.js']
    if phase_name in ['image-boundary','image-final','image-final2']:tests+=['server/test/bmw-live-imagery.test.js','server/test/gcsp-retained-image.test.js']
    if phase_name in ['observation-boundary', 'observation-final', 'observation-final2', 'observation-gates']:tests+=['server/test/gcsp-bmw-model-batch.test.js','server/test/gcsp-bmw-model-options-qualification.test.js']
    if phase_name in ['image-final','image-final2']:tests+=['server/test/gcsp-otd-qualified-enrichment.test.js','server/test/gcsp-source-enrichment.test.js','server/test/gcsp-fleet-enrichment.test.js']
    if phase_name=='qualification-boundary':tests+=['server/test/gcsp-source-enrichment.test.js','server/test/gcsp-fleet-enrichment.test.js']
    command=['/opt/homebrew/Cellar/node/26.7.0/bin/node','--max-old-space-size=256','--test','--test-concurrency=1',*tests]
    if phase_name=='qualification-retained':command=['/opt/homebrew/Cellar/node/26.7.0/bin/node','--max-old-space-size=256',str(ROOT/'docs/gcsp/evidence/fucq60/qualified-image-boundary-2026-11-07/run-retained.mjs')]
    if phase_name.startswith('retained-image-'):tests=['server/test/gcsp-v2-retained-image.test.js']+(['server/test/gcsp-retained-image.test.js','server/test/gcsp-v2-live-image.test.js'] if phase_name in ['retained-image-final','retained-image-final2'] else []);command=['/opt/homebrew/Cellar/node/26.7.0/bin/node','--max-old-space-size=256','--test','--test-concurrency=1',*tests]
    scratch_mib=64;seconds=120
    paths=['assets/gcsp-vehicle-evidence/9704a8616835a1c1ce3b6d65f80e91cabb9edbfc0f83eca06b467bb3b1d236e3.webp','docs/gcsp/evidence/fucq60/v2-image-capture-2026-11-07/run-live.mjs','docs/gcsp/evidence/fucq60/v2-image-capture-2026-11-07/supervise.py','docs/gcsp/evidence/fucq60/v2-image-capture-2026-11-07/image-plan.json','scripts/gcsp/verify-live-imagery.mjs','server/vehicle-evidence/bmw-live-imagery.js','server/gcsp/vehicle-evidence/registered-corpus-images.js','docs/gcsp/evidence/fucq60/qualified-image-boundary-2026-11-07/run-retained.mjs','docs/gcsp/evidence/fucq60/qualified-image-boundary-2026-11-07/supervise-offline.py','server/vehicle-evidence/bmw-catalogue-adapter.js','scripts/gcsp/enrich-fleet.mjs','scripts/gcsp/bmw-technical-qualification.mjs','scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/public-bmw-source.mjs','scripts/gcsp/collection-session.mjs','scripts/gcsp/enrichment-observation.mjs','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/run-live.mjs','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/supervise-offline.py','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/supervise.py','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/observation-plan.json',*tests]
    contract={'codePins':{p:sha(ROOT/p) for p in paths if (ROOT/p).exists()},'inputPins':{str(p.relative_to(ROOT)):sha(p) for area in ['server/data/gcsp/vehicle-evidence/fleet-source.v1','server/data/gcsp/vehicle-evidence/registered-sources'] for p in (ROOT/area).rglob('*') if p.is_file()},'selectedChecks':[command],'excluded':['full suite: optional retained technical operation and exact four-key qualifier only','BMW/source traffic: fixture transport only','Render and ordinary corpus mutation','unchanged311/new9 replays','binary image or technical publication'],'dependencyDirectory':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules'}
    if phase_name.startswith('retained-image-'):contract['excluded']=['full suite: only exact registered image association/byte verification and additive publisher restart boundary changed','all live source traffic: retained files and fixture transport only','ordinary corpus, source-envelope, technical-fact or immutable-history mutation','new UI layout: existing representative image presentation preserved'];contract['affectedBoundary']={'changedPaths':['server/gcsp/vehicle-evidence/registered-corpus-images.js','assets/gcsp-vehicle-evidence/9704a8616835a1c1ce3b6d65f80e91cabb9edbfc0f83eca06b467bb3b1d236e3.webp'],'regression':'v1-only additive image validator refused the exact accepted v2 source','callers':['corpus-publisher.validateRows','verify-fleet','synthetic-registry.publish/load'],'integration':'isolated existing writeCorpusCandidate and registry restart; no new wire format'}
    plan={'runId':'f60-observation-'+phase_name,'resources':{'workers':1,'hostRamMiB':512,'childRamMiB':448,'scratchMiB':scratch_mib,'seconds':seconds}}
    spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
    R.atomic_json(phase/'selection.json',{'identity':contract['codePins'],'inputs':contract['inputPins'],'selectedChecks':contract['selectedChecks'],'excluded':contract['excluded'],'resources':plan['resources']})
    R.atomic_json(phase/'retained-output-ownership.json',{'createdFor':plan['runId'],'immutableSourceFiles':contract['inputPins'],'sourceFilesPreserved':True,'expectedRetainedOutputMiB':1,'largeOutput':False,'retainedReceipts':[str(phase/p) for p in ['receipt.json','result.json','cleanup.json','selection.json']],'partialProgress':str(phase/'receipt.json.progress.json')})
    policy=R.Policy({'chunk_scratch_mib':scratch_mib,'chunk_ram_mib':512,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(phase,ROOT,policy,expected=scratch_mib*R.MIB,checkpoint=phase/'receipt.json.progress.json')
    host=R.HostBudget(policy);link=ROOT/'server/node_modules';vendor=pathlib.Path(contract['dependencyDirectory']);entered=reserved=finished=False;link_identity=None
    def finish():
        nonlocal entered,reserved,finished,link_identity
        if finished:return
        assert all(group_absent(R,pid) for pid in scratch.record['groups']),'owned group remains'
        if link_identity is not None:
            st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor
            link.unlink();link_identity=None
        if entered:scratch.__exit__(None,None,None);entered=False
        if reserved:host.release(scratch.token);reserved=False
        R.atomic_json(phase/'cleanup.json',{'scratch':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),
            'groupsAbsent':all(group_absent(R,pid) for pid in scratch.record['groups']),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),
            'dependencyLinkAbsent':not os.path.lexists(link),'removedScratchBytes':scratch.record['peak'],'retainedOutputOwnership':str(phase/'retained-output-ownership.json'),'compatibilityException':None})
        finished=True
    atexit.register(finish)
    try:
        with R.handled_termination():
            host.acquire(scratch.token,scratch_mib*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True
            scratch.__enter__();entered=True
            assert not os.path.lexists(link),'existing dependency path preserved';link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino)
            R.atomic_json(phase/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','HOME':os.environ['HOME']}
            commands=[command]
            results=[]
            for index,item in enumerate(commands):
                result=R.run_process(item,ROOT,env,phase/('command-'+str(index)+'.log'),scratch,policy,scratch_mib*R.MIB,448*R.MIB,seconds,host)
                results.append(result);R.atomic_json(phase/'chunk-results.json',results)
                if result['rc']!=0 or result['issue'] is not None:break
            R.atomic_json(phase/'result.json',result)
            for name,expected in contract['codePins'].items():assert sha(ROOT/name)==expected,name
            for name,expected in contract['inputPins'].items():assert sha(ROOT/name)==expected,name
            print(json.dumps(result))
    finally:
        try:finish()
        finally:atexit.unregister(finish)
    if not phase_name.endswith('red'):assert result['rc']==0 and result['issue'] is None,'selected check failed'
if __name__=='__main__':run()
