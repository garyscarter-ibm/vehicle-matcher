# FUCQ-33 targeted browser follow-up

Source: `e16cf52f06274dfe9164af6d72765b5de8ad220d`. The original [26-case receipt](../fucq33-final-browser.json) and screenshots remain unchanged.

The corrected follow-up ran 33 assertions across action metrics, CSS composition, keyboard selection, gallery fixture preservation, historical fallback evidence and the MINI 320px claim-index comparison. 28 passed; 5 failed.

The corrected CSS parser strips the leading @import before counting rules. It found 19 moved rule blocks; all match the approved employee source, and the remaining employee rules match it exactly. This is one more block than the old receipt's declared count of 18.

MINI retail at 320px measured 76px of horizontal overflow against 76px at claim commit `7b6e57b`; classification: **pre-existing-baseline-limitation**.

Fallback DOM/image state, injected request paths and the existing fallback screenshot are referenced from the preserved full receipt. The only current screenshot files are the targeted captures in this folder.


Lead disposition: eight original harness failures have replacement proof; one original MINI overflow is baseline behavior; native popup option-picking remains unverified. The five red follow-up assertions are classified individually in [the final validation record](../fucq33-validation.json). The existing main-receipt Tab/focus/Enter recovery and fallback assertions pass; no all-pass browser matrix is claimed. The [headed native retry](../fucq33-keyboard-retry-browser.json) preserves 0/1 and its reporting history.
