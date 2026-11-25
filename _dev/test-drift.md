# Known test drift

Each line below names one way tests drift away from the code they check, so `_tools/test_drift.py` can find it before it
fails a suite. One drift per line: `- name | one-line concept in plain words | kind | arg`. Kinds: clock-mix, stale-pin,
orphan-selector, contract-callers, regex (arg is a Python regex run over test-file lines). Other lines are ignored.
Add a new drift with `_tools/test_drift.py --add "name | concept | kind | arg"`.

- clock-mix | A test pins a calendar date but the code under test compares it with today's date. | clock-mix | Instant\.now|LocalDate(Time)?\.now|ZonedDateTime\.now|Date\.now\(|new Date\(\)|currentTimeMillis|runNow|RunClock
- stale-pin | A test still holds a value (version, hash, id) that the change replaced. | stale-pin | 
- orphan-selector | A test looks for a CSS class or test id that no template or style defines any more. | orphan-selector | 
- contract-callers | A changed public signature or contract whose callers' tests were not updated. | contract-callers | 
