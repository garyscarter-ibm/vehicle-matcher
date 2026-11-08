#!/usr/bin/env python3
"""Author a static source/dependency catalogue; never import or run application code."""
from pathlib import Path, PurePosixPath
import sys, json, hashlib, re, os, datetime
root=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(root/'_tools'))
import scaffold_git as G
from test_resources import atomic_json
refs={'central100':'38be4f5d95823b5f010a56c3d4b6cbda4eca55e8','case122':'9c43be94afd5c645a56c37fdb538f4f276310f5d','release92':'15a79957e61d81612311d3aab7dbf77733dc4e0d'}
def git(args):
 rc,out,err=G.git(root,args)
 if rc: raise RuntimeError(str(args)+': '+err)
 return out
cache={}
def chosen(path):
 if path.startswith('server/gcsp/stock/'):return refs['release92']
 if path.startswith(('server/gcsp/cases/','blocks/','assets/')):return refs['case122']
 return refs['central100']
def source(path):
 key=(chosen(path),path)
 if key not in cache:
  try:cache[key]=git(['show',key[0]+':'+path])
  except UnicodeDecodeError:
   file=root/path
   expected=git(['rev-parse',key[0]+':'+path]).strip()
   observed=git(['hash-object','--no-filters',str(file)]).strip()
   if observed!=expected:raise RuntimeError('Binary source needs exact immutable bytes: '+path)
   cache[key]=file.read_bytes()
 return cache[key]
def normalize(parent,spec):
 parts=[]
 for bit in (PurePosixPath(parent).parent/PurePosixPath(spec)).parts:
  if bit=='..':
   if not parts:raise RuntimeError('outside source root')
   parts.pop()
  elif bit!='.':parts.append(bit)
 return '/'.join(parts)
roots=['server/gcsp/runtime.js','server/index.js','server/gcsp/manual-context/recommendation-facts.js','server/gcsp/greg/index.js','server/gcsp/greg/publish/index.js','server/gcsp/greg/publish/fit.js','server/gcsp/stock/index.js','server/gcsp/stock/synthetic-provider.js','server/gcsp/cases/index.js','blocks/gcsp/cases/gcsp-help.js','blocks/gcsp/cases/gcsp-case-queue.js','blocks/gcsp/cases/http-adapter.js']
queue=roots+['server/gcsp/stock/fixtures/tranche-plan.json','server/gcsp/stock/fixtures/real-shaped-pull.json','package.json','package-lock.json','server/package.json','server/package-lock.json']
rows={};edges=[];dynamic=[];external=set();assets=[]
imports=re.compile(r"(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)[\'\"]([^\'\"]+)[\'\"]")
urls=re.compile(r"new\s+URL\(\s*[\'\"]([^\'\"]+)[\'\"]\s*,\s*import\.meta\.url")
while queue:
 path=queue.pop()
 if path in rows:continue
 text=source(path);data=text.encode() if isinstance(text,str) else text
 blob=git(['rev-parse',chosen(path)+':'+path]).strip()
 if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=blob:raise RuntimeError('Git object byte mismatch '+path)
 rows[path]={'path':path,'ref':chosen(path),'gitBlob':blob,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
 if not path.endswith(('.js','.mjs')):continue
 for spec in imports.findall(text):
  if spec.startswith('.'):
   target=normalize(path,spec);edges.append({'from':path,'specifier':spec,'to':target,'kind':'literal-module'});queue.append(target)
  elif re.fullmatch(r'(?:node:)?[@a-zA-Z0-9_][@a-zA-Z0-9_./-]*',spec):
   edges.append({'from':path,'specifier':spec,'kind':'builtin' if spec.startswith('node:') else 'installed'});external.add(spec)
 for spec in urls.findall(text):
  if not spec.startswith('.'):continue
  target=normalize(path,spec)
  kind=git(['cat-file','-t',chosen(target)+':'+target]).strip()
  if kind=='tree':
   paths=git(['ls-tree','-r','--name-only',chosen(target),'--',target]).splitlines()
   if len(paths)>512:raise RuntimeError('unbounded directory asset')
   assets.append({'from':path,'directory':target,'ref':chosen(target),'files':paths});queue.extend(paths)
  else:queue.append(target)
  edges.append({'from':path,'specifier':spec,'to':target,'kind':'literal-url-asset'})
 for n,line in enumerate(text.splitlines(),1):
  if re.search(r'\bimport\s*\(\s*[^\s\'\"]|new\s+URL\(\s*`',line):
   entry={'path':path,'line':n,'expression':line.strip(),'status':'not resolved by literal scan; review before harness admission'}
   if path=='blocks/gcsp/shell/portal-shell.js' and 'const LOGO = (name)' in line:
    calls=re.findall(r'LOGO\(([^)]*)\)',text)
    if calls != ["'bmwgroup-bmw-mini'"]:raise RuntimeError('Unreviewed shell logo call')
    target='assets/brand-logos/bmwgroup-bmw-mini.svg'
    queue.append(target);edges.append({'from':path,'to':target,'kind':'bounded-template-url','basis':'sole LOGO call supplies this literal name'})
    entry.update(status='bounded by sole literal call; asset pinned',target=target)
   dynamic.append(entry)
# Complete package-directory inventories, rather than guessing a CJS file graph.
base=Path(git(['rev-parse','--git-common-dir']).strip()).resolve().parent
def resolve_package(name,start):
 for ancestor in [start,*start.parents]:
  candidate=ancestor/'node_modules'/name/'package.json'
  if candidate.is_file():return candidate.parent.resolve()
 return None
def digest_file(p):
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
packages={};installed={};dependency_edges=[];absences=[]
work=[('pg',base/'server',False),('jsdom',base,False)]
while work:
 name,caller,optional=work.pop();directory=resolve_package(name,caller)
 if directory is None:
  absences.append({'package':name,'requester':str(caller),'optional':optional})
  if not optional:raise RuntimeError('missing required package '+name)
  continue
 dependency_edges.append({'requester':str(caller),'package':name,'resolvedRoot':str(directory),'optional':optional})
 if str(directory) in packages:continue
 meta=json.loads((directory/'package.json').read_text());packages[str(directory)]={'name':meta['name'],'version':meta['version'],'packageJson':str(directory/'package.json')}
 for folder,dirs,files in os.walk(directory,followlinks=False):
  dirs[:]=sorted(d for d in dirs if d not in ['node_modules','.git'])
  for filename in sorted(files):
   p=Path(folder)/filename;s=p.lstat();real=p.resolve();target=real.stat()
   if not real.is_file():raise RuntimeError('non-file installed entry '+str(p))
   installed[str(p)]={'sha256':digest_file(real),'bytes':target.st_size,'device':s.st_dev,'inode':s.st_ino,'realpath':str(real),'targetDevice':target.st_dev,'targetInode':target.st_ino,'link':os.readlink(p) if p.is_symlink() else None}
   if len(installed)>10000 or sum(item['bytes'] for item in installed.values())>128*1024*1024:raise RuntimeError('installed inventory exceeds authoring bound')
 optional_names=set(meta.get('optionalDependencies',{}))
 for dep in sorted(set(meta.get('dependencies',{}))|optional_names):work.append((dep,directory,dep in optional_names))
 for dep in sorted(meta.get('peerDependencies',{})):
  work.append((dep,directory,meta.get('peerDependenciesMeta',{}).get(dep,{}).get('optional',False)))
node=Path('/opt/homebrew/bin/node');ns=node.stat()
publication=json.loads(source('docs/gcsp/evidence/fucq100/greg-eligibility-final-run.json'))
# The publication record is metadata, not an import root; verify all six exact pins independently.
six=[]
for path,expected in publication['changed_source_hashes'].items():
 text=git(['show',refs['central100']+':'+path]);actual=hashlib.sha256(text.encode()).hexdigest()
 if actual!=expected:raise RuntimeError('publication mismatch '+path)
 six.append({'path':path,'ref':refs['central100'],'sha256':actual})
value={'kind':'author-only stable source basis; not an executable combined-runtime freeze','version':1,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'executionAllowed':False,'refs':refs,'centralPublicationPins':six,'roots':roots,'selectionRule':'stock modules from92; case modules and all blocks from122; other source/config from100. Combined central candidate must replace this selection after root relay/review.','sources':dict(sorted(rows.items())),'edges':edges,'directoryAssets':assets,'nonliteralEdges':dynamic,'externalImports':sorted(external),'installed':{'method':'Entire physical package directories for recursive declared runtime/optional/peer dependencies of pg and jsdom; excludes nested node_modules, which are resolved separately. Static inventory, not observed runtime imports.','packages':packages,'dependencyEdges':dependency_edges,'absentOptional':absences,'files':dict(sorted(installed.items())),'node':{'path':str(node),'realpath':str(node.resolve()),'sha256':digest_file(node),'device':ns.st_dev,'inode':ns.st_ino}},'counts':{'sourceFiles':len(rows),'sourceEdges':len(edges),'installedPackages':len(packages),'installedFiles':len(installed),'installedBytes':sum(v['bytes'] for v in installed.values()),'nonliteralEdges':len(dynamic)},'unfrozenGaps':['100 combined runtime/server startup and reset/provider lifecycle candidate not supplied','New normalized source input and new-run preparation profile not authored/pinned; seeded known-stock metadata remains immutable through92 release','Focused test/controller harness, resource supervisor and fail-closed loader not authored/pinned; no executable test command yet','Review nonliteral edges and regenerate complete per-path source/installed graph after combined candidate and harness supplied'],'scope':'No source adoption, application imports, tests, runtime, listener, scratch, browser, native, full, dependency writes, Jira/map/claim changes.'}
output=root/'docs/gcsp/evidence/fucq122/producer-integration-catalogue.json'
value['selectionRule']='stock modules from92; case modules, blocks and assets from122; other source/config from100. Combined central candidate must replace this selection after root relay/review.'
value['authoringTool']={'path':str(Path(__file__).resolve().relative_to(root)),'sha256':digest_file(Path(__file__))}
value['authoringDependencies']={name:digest_file(root/name) for name in ['_tools/scaffold_git.py','_tools/test_resources.py']}
value['counts']['unresolvedNonliteralEdges']=sum('not resolved' in row['status'] for row in dynamic)
atomic_json(output,value)
print(json.dumps({'output':str(output),'bytes':output.stat().st_size,'sha256':digest_file(output),'counts':value['counts'],'optionalAbsences':absences,'nonliteralEdges':dynamic},indent=2))
