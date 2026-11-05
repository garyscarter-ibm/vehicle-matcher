from pathlib import Path
import os,sys,json,hashlib
project=Path(__file__).resolve().parents[4]
rdir=Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs')
target='root' if '--root' in sys.argv else 'server'
cwd=project if target=='root' else project/'server'
sys.path.insert(0,str(project/'_tools'))
import test_resources as r
policy=r.Policy({'chunk_scratch_mib':128,'chunk_ram_mib':512,'chunk_seconds':180,'log_mib':2})
env={key:os.environ[key] for key in ['HOME','USER','LOGNAME','LANG','SHELL','TZ'] if key in os.environ}
env.update(PATH='/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',SCAFFOLDING_HARNESS='codex',npm_config_audit='false',npm_config_fund='false')
locks={str(p.relative_to(project)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [project/'package-lock.json',project/'server/package-lock.json']}
scratch=r.Scratch(rdir,project,policy,expected=128*r.MIB)
scratch.manifest=rdir/'ownership'/('fucq57-'+target+'-install-'+scratch.token+'.json')
host=r.HostBudget(policy)
receipt={'argv':['npm','ci','--ignore-scripts','--no-audit','--no-fund'],'cwd':str(cwd),'environment':env,'pins':locks,'finalizer':__file__}
try:
 host.acquire(scratch.token,128*r.MIB,512*r.MIB,str(project),root=scratch.root)
 with r.handled_termination(),scratch:
  child_env=scratch.env(env);child_env['npm_config_cache']=str(scratch.root/'npm-cache')
  result=r.run_process(receipt['argv'],cwd,child_env,scratch.root/'install.log',scratch,policy,128*r.MIB,512*r.MIB,180,host=host)
  receipt['result']=result
  receipt['outputTail']=(scratch.root/'install.log').read_text()[-4096:]
  receipt['runtime']={name:__import__('subprocess').check_output(cmd,env=env,text=True,timeout=5).strip() for name,cmd in [('node',['node','--version']),('npm',['npm','--version'])]}
finally:
 host.release(scratch.token)
 receipt['scratchRoot']=str(scratch.root);receipt['manifest']=str(scratch.manifest)
 receipt['scratchAbsent']=not os.path.lexists(scratch.root)
 receipt['groupsAbsent']=all(r.group_has_live_members(g) is False for g in scratch.record['groups'])
 receipt['reservationAbsent']=scratch.token not in r.read_json(host.path,{})
 receipt['retainedEnvironment']=str(cwd/'node_modules')
 receipt['retainedAllocatedBytes']=r.allocated_bytes(cwd/'node_modules')
 if (project/'server/node_modules/pg/package.json').is_file():
  receipt['pgVersion']=json.loads((project/'server/node_modules/pg/package.json').read_text())['version']
  receipt['pgPackageSha256']=hashlib.sha256((project/'server/node_modules/pg/package.json').read_bytes()).hexdigest()
 if target=='root' and (project/'node_modules/jsdom/package.json').is_file():
  receipt['jsdomVersion']=json.loads((project/'node_modules/jsdom/package.json').read_text())['version']
  receipt['jsdomPackageSha256']=hashlib.sha256((project/'node_modules/jsdom/package.json').read_bytes()).hexdigest()
 r.atomic_json(project/('docs/gcsp/evidence/fucq57/'+target+'-install.json'),receipt)
 print(json.dumps(receipt,indent=2))
raise SystemExit(receipt['result']['rc'] if not receipt['result']['issue'] else 1)
