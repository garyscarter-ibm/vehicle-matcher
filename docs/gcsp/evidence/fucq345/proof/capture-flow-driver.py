import os,sys
from pathlib import Path
ROOT=Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-004')
sys.path.insert(0,str(ROOT/'_tools'))
import scaffold_git as sg
rc,out,err=sg.git(ROOT,['show','23ce581b:blocks/gcsp/kit/vehicle-media.css'])
if rc: raise RuntimeError(err)
target=Path(os.environ['TMPDIR'])/'fucq345-baseline.css'
target.write_text(out)
os.environ['FUCQ345_BASELINE_CSS']=str(target)
os.environ['GCSP_OFFLINE']='1'
os.environ['COLOUR_WARM']='1'
os.execvp('node',['node','/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq345-flow-browser.mjs'])
