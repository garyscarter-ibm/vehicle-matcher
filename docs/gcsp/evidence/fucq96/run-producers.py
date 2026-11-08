import hashlib,json,os,pathlib,sys
sys.dont_write_bytecode=True
sys.path.insert(0,'/Users/usget/Claude/vehicle-matcher/_tools')
from test_resources import Policy,HostBudget,Scratch,run_process,atomic_json,handled_termination,group_has_live_members,read_json
import scaffold_git as sg
ROOT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-059')
RUN=pathlib.Path(__file__).parent
PINS={'7ca1fb98400efb99e02cb445ce36978f15d18fe9':['server/gcsp/stock/index.js','server/gcsp/stock/port.js','server/gcsp/stock/synthetic-provider.js'],
      'b4154ce3bfe195564a2d9f17980309d76e545eba':['server/gcsp/offers/buddy-hold.js','server/gcsp/offers/offer-token.js']}
policy=Policy({'chunk_scratch_mib':32,'chunk_ram_mib':256,'chunk_seconds':120,'log_mib':1});host=HostBudget(policy)
scratch=Scratch(RUN,ROOT,policy,expected=32*1024*1024,checkpoint=RUN/'producers-checkpoint.json')
scratch.record['supervisor_finalizer']=str(pathlib.Path(__file__).resolve())
receipt={'run':'dev-poller-restart-20261105-fucq96','pins':PINS,'copiedFiles':{},'state':'planned','scope':'actual pinned producer integration with explicit synthetic source input; native/live integration excluded'}
command=['node','--test','--test-concurrency=1',str(RUN/'producer-proof.mjs')];receipt['command']=command
atomic_json(RUN/'producers-plan.json',receipt)
try:
    host.acquire(scratch.token,32*1024*1024,256*1024*1024,'/private/tmp',root=scratch.root)
    try:
        with handled_termination(),scratch:
            (scratch.root/'package.json').write_text('{"type":"module"}\n')
            for commit,paths in PINS.items():
                for name in paths:
                    rc,out,err=sg.git(ROOT,['show',commit+':'+name])
                    if rc:raise RuntimeError(err)
                    p=scratch.root/pathlib.Path(name).relative_to('server');p.parent.mkdir(parents=True,exist_ok=True);p.write_text(out)
                    receipt['copiedFiles'][commit+':'+name]=hashlib.sha256(p.read_bytes()).hexdigest()
            for name in ['repository','policy','brief','manual-context']:
                (scratch.root/'gcsp'/name).symlink_to(ROOT/'server/gcsp'/name,target_is_directory=True)
            receipt['ownSourceHashes']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set([*ROOT.glob('server/gcsp/**/*.js'),*ROOT.glob('server/gcsp/**/*.json'),*ROOT.glob('server/test/helpers/*.js')])) if p.is_file()}
            receipt['proofHash']=hashlib.sha256((RUN/'producer-proof.mjs').read_bytes()).hexdigest()
            atomic_json(RUN/'producers-plan.json',receipt)
            env={k:v for k,v in os.environ.items() if k not in ['GCSP_DATABASE_URL','DATABASE_URL','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSERVICE','PGSERVICEFILE']}
            env['GCSP_FUCQ96_PROOF_ROOT']=str(scratch.root)
            outcome=run_process(command,str(ROOT),env,RUN/'producers.log',scratch,policy,32*1024*1024,256*1024*1024,120,host)
    finally:host.release(scratch.token)
    receipt.update(outcome,state='passed' if outcome['rc']==0 and not outcome['issue'] else 'failed')
finally:
    receipt.update(scratchRoot=str(scratch.root),scratchRemoved=not scratch.root.exists(),groupsAbsent=all(group_has_live_members(p) is False for p in scratch.record['groups']),reservationAbsent=scratch.token not in read_json(host.path,{}),removedAllocation=scratch.record['peak'],compatibilityException=None,leftovers=[])
    atomic_json(RUN/'producers-checkpoint.json',receipt)
    print(json.dumps({k:v for k,v in receipt.items() if k not in ['ownSourceHashes','copiedFiles']}),flush=True)
sys.exit(0 if receipt['state']=='passed' else 1)
