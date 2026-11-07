"""Run the original five strict retained checks without Node worker isolation. No HTTP."""
import hashlib
import pathlib
import sys
sys.dont_write_bytecode = True
base = pathlib.Path(__file__).resolve().parent
original = base / 'verify-retained.py'
assert hashlib.sha256(original.read_bytes()).hexdigest() == '3995fecb95033b4f1a146307f65fcd1268c5e036d685f8512ec24c5855d1d8fb'
source = original.read_text()
source = source.replace("OUT = pathlib.Path(allocation['supervisorOutput'])", "OUT = pathlib.Path(allocation['supervisorOutput']) / 'retained-direct'", 1)
source = source.replace("'-retained')", "'-retained-direct')", 1)
source = source.replace("'--test-reporter=tap',", "'--test-reporter=tap', '--test-isolation=none',", 1)
exec(compile(source, str(original) + ':retained-direct', 'exec'))
