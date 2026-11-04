# Allocation outcomes: satisfaction and employee effort

Discussion record, 2 November 2026. Russell offered the following as an idea, explicitly without claiming it is the right policy. It remains a candidate outcome for refinement, not an adopted allocation rule or additional Jira scope.

> Outcome - that at least as many employees are satisfied with the vehicle they end up with compared to the as-is, but with a measured reduction in total employee time wasted manually checking the portal.

## Assessment and candidate formulation

This gives the allocation experience two observable tests: protect the employee's eventual vehicle outcome and reduce the effort spent repeatedly looking for available cars. Both the manual chooser and the buddy participant belong in the evaluation.

A proposed refinement is: for the same renewal cohort, available supply and scheme constraints over the same period, achieve at least as many satisfactory vehicle outcomes by the relevant renewal deadline, with less total active portal-checking time. Also report total employee effort introduced by either route, so reduced checking is not offset invisibly by preference entry, offer handling or chasing support.

Treat satisfactory outcomes as a constraint on the time-saving goal. A convenient weighted score must not quietly allow fewer satisfied employees in exchange for more hours saved. These tests can fail in an experiment; the simulation must be able to reveal that result.

## Measurement to refine

- **Satisfaction:** distinguish reported happiness with the selected vehicle from later after-use satisfaction and from acceptance of an offer. Choose the same definition and assessment point for both routes. A deterministic fit score or predicted acceptance probability remains a labelled proxy; neither establishes real employee satisfaction.
- **Whole cohort:** retain manual users, buddy users, employees without a suitable allocation and unknown/unobserved outcomes in the accounting. Report unresolved outcomes separately rather than dropping people from the denominator. Check outcome distributions and important cohorts as well as the headline count.
- **Checking effort:** count active time repeatedly visiting/searching/rechecking the portal, including unsuccessful visits. Separate useful vehicle comparison from avoidable availability checking; elapsed time with a tab left open is not active effort. Show preference setup, offer review/decline and other new employee work separately and in a total-effort measure.
- **Comparable baseline:** first hold employee needs, stock, terms, renewal dates and underlying response assumptions constant across routes. Keep access/response differences explicit. Use paired repeatable scenarios and show variability. Evaluate later order-mix and points changes as separate experiments, so their effect is distinguishable from the allocation-process change.
- **Evidence:** simulation supplies estimated satisfaction and time under declared assumptions. A real before/after claim needs a comparable baseline and observed employee feedback/effort. No new baseline dataset, satisfaction result or time saving has been established by this discussion.

Definitions, satisfaction thresholds if used, active-time assumptions, assessment windows and any material improvement target belong in the one canonical policy/assumptions source required by the [build rules](build-rules.md). Plausible initial values may be tried and changed there; this note creates no competing runtime configuration.

## What it resolves, and what remains

The idea supplies a candidate success criterion for choosing and testing allocation policies. It does not itself decide who receives one scarce car when either of two employees would be satisfied with it. Renewal urgency, other acceptable options and a transparent tie-break remain policy choices to exercise through trials; manual and buddy commands use the same allocation authority.

For example, if one employee has another available acceptable car and the other has no acceptable alternative, giving the scarce car to the latter may produce two satisfactory outcomes across the fleet. That does not establish a universal priority rule: alternatives must actually be feasible, and competing deadlines/other employees can change the result. When neither person has an alternative, the headline satisfaction count alone leaves the tie unresolved.

Keep this discussion alongside the [simulation direction](demo-brief.md#compare-1000-fictional-employees), [readiness questions](delivery-readiness-review.md#focused-refinement-questions) and [predictive order-planning research](greg-predictive-research.md). It can inform later refinement of the shared allocation policy and FUCQ-74 evaluation; it has not changed Jira, the HLD or application behaviour.
