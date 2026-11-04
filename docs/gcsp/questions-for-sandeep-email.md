# Email to Sandeep — 2 November 2026

**Subject: GCSP demo — questions for 12 November**

Hi Sandeep,

Could you help with these from Confluence and the GCSP/GCSO/backend information you already have? Links, screenshots or anonymised examples are enough. Please leave anything outside your access open.

Please start with P2, which could change the design. P3 would be useful. There are no P1 blockers for the demo because we can use clearly labelled synthetic data where necessary.

**P2 — affects a major design decision**

- Which interfaces are available through GCSP over the mainframe today, and which depend on the planned Java modernisation? How fresh is the released-stock information, and what changes are expected by 12 November?
- Can you share interface documentation or anonymised examples for employees, contracts, available cars, holds and orders, showing which systems own them? Please distinguish reads from reservation/order operations and retain the field names linking the records.
- What does “PCS UKFS BMW” in the screenshots correspond to, and which scheme guide applies? Could you share that guide, including contract/mileage/renewal rules and the family-tree and driver-age/licence tables missing from our extract?
- Can you share dated vehicle-points and grade-allowance tables, including how any cash top-up is calculated and when the employee’s price becomes fixed?
- How do vehicle holds work today: when do the timers start, what releases the car, and can the backend support a longer exclusive hold? What happens if stock is withdrawn while held?
- What exactly happens when an employee submits an order: when is the car committed, which approvals follow, and how can a submission be checked safely if its response is lost? Could you share the complete declarations and confirmation screen too?
- Which services link an employee to their current car’s VIN and fitted specification, and supply model descriptions/images? An anonymised example showing model/type codes, equipment and relevant dates would help.
- Where are requested vehicles, Production-confirmed supply and cars released for employee selection recorded: in systems or spreadsheets? Is there a documented flow showing when requests can still change?

**P3 — nice to have**

- Did the earlier Pete Thorne enquiry establish a connected-vehicle data route? If documented, which mileage, consumption or charging summaries are available, with what coverage, update times and permitted GCSP use?
- Are there existing reports or support summaries covering release volumes, unallocated cars, manual orders and unresolved renewals? A recent anonymised example, or recorded employee-feedback themes, would help.
- What service does GCSP/GCSO currently use to send employee emails, and is its integration documented?
- Do the documents record current rules for moving unallocated employee cars to other channels, including any TNR changes taking effect for BMW in 2027?

Thanks,
Russell

---

The [review and traceability](sandeep-question-review.md) explain the priorities, additional gaps and questions kept outside Sandeep’s remit. Russell is handling [VIN samples](vin-sample-checklist.md) directly; the optional directory lookup has also been removed. This draft has not been sent.
