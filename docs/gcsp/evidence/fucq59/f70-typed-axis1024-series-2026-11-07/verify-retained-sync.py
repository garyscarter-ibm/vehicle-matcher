"""Original five strict checks; actual conflict-log union and direct Node runner. No HTTP."""
import hashlib
import pathlib
import sys
sys.dont_write_bytecode = True
base = pathlib.Path(__file__).resolve().parent
original = base / 'verify-retained.py'
assert hashlib.sha256(original.read_bytes()).hexdigest() == '3995fecb95033b4f1a146307f65fcd1268c5e036d685f8512ec24c5855d1d8fb'
source = original.read_text()
source = source.replace("OUT = pathlib.Path(allocation['supervisorOutput'])", "OUT = pathlib.Path(allocation['supervisorOutput']) / 'retained-sync'", 1)
source = source.replace("'-retained')", "'-retained-sync')", 1)
source = source.replace("'--test-reporter=tap',", "'--test-reporter=tap', '--test-isolation=none',", 1)
source = source.replace("str(BASE / 'live-check.test.mjs')", "str(BASE / 'live-check-sync.test.mjs')", 1)
exec(compile(source, str(original) + ':retained-sync', 'exec'))
