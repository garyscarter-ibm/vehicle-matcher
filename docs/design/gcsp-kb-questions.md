# Questions about the GCSP front-end and backend migration to AWS

## What this document is for

IBM is building a **demonstration** of a next-generation front end for the BMW company car scheme (GCSP). In the
demo, an employee states their preferences once and the system finds, holds and offers them suitable cars. The
scheme's ordering lead gets a view of predicted demand and suggested orders. The demo runs entirely on **synthetic
data** and doesn't connect to any BMW system.

We want the demo's data shapes, vehicle identifiers, order stages and architecture to be plausible and consistent
with the **target GCSP platform on AWS**. Please answer the questions below from the knowledge base.

**Always answer for the target AWS platform**, whether that part is already built or still in build. Don't describe
the legacy mainframe platform: the demo isn't built against it. Mention the mainframe only where the target
platform still depends on it (e.g. a system of record behind a target API).

## Anonymisation: required, because your answers will leave the BMW network

Your answers will be copied outside the BMW network into IBM working notes, so they must contain no confidential
or personal detail. Apply every rule below to the whole response.

1. **No people.** Never name individuals. Use a role instead ("the ordering lead", "a platform architect").
2. **No personal or employee data.** Don't include real employee records, grades tied to people, contracts or usage histories.
3. **No real vehicle identifiers.** Don't include real VINs, registrations, order or commission numbers. Describe the
   format instead (length, structure, what each part means), with a made-up example clearly marked *illustrative*.
4. **No infrastructure specifics.** Don't include hostnames, URLs, IP addresses, AWS account IDs, ARNs, bucket or queue
   names, repository names, ports, API keys, certificates or credentials. Describe services generically ("a managed
   message queue", "an API gateway in front of containerised services").
5. **No exact commercial values.** Don't include real prices, points tables, contribution amounts, residuals or
   supplier terms. Explain the structure and rules, and give illustrative ranges or examples, marked *illustrative*.
6. **No verbatim copying.** Summarise in your own words. Quote at most a short phrase where the exact wording matters.
7. **Sources, generically.** Cite a document by type and date only, such as "solution design, v2, Sep 2026". Never
   give an internal link, document ID or author.
8. **System names** may be given where they're the standard names of BMW scheme applications (e.g. GCSO, ISA). Use a
   generic description for any other internal system, team or vendor.
9. If a question can't be answered without breaking these rules, answer as much as you safely can and say "withheld: confidential".

## How to answer

Give these four things for each question, using its number:

- **Answer:** a short, plain-language summary.
- **Status:** `documented`, `partly documented` or `not documented`. Say "not documented" rather than infer.
- **Build status:** for the part of the target platform the answer describes, say `built`, `in build` or `designed only`. Give a timeline if one is documented.
- **Source:** the document type and date only (rule 7).

Return the answers as a single markdown document.

## Questions

### A. Vehicle identity
1. At which stage of the ordering lifecycle is a VIN assigned: factory order, build, arrival, release to the scheme, employee selection, or delivery?
2. Before a VIN exists, what identifies a vehicle or order (order number, commission number, stock ID)? Does that identifier stay stable through to delivery?
3. When an employee browses or selects from available stock, does each car carry a VIN and its full fitted specification (option codes)?
4. How is an employee's current car linked to its VIN and fitted specification?

### B. Stock, supply and release
5. How does a car become available to scheme employees? Who triggers release, how often, and which system records it?
6. How are future factory orders recorded? Are the request, the production confirmation and the arrival/release held as separate states? What are the amendment cut-offs?
7. How fresh is stock data in the target platform? Is there an event or notification for new or changed stock, or must it be polled?

### C. Reservation, selection and order
8. When an employee picks a car, is it reserved exclusively? For how long, what releases it, and what happens on timeout or navigating away?
9. Is there an API to reserve, release or select a car? Are these calls idempotent, and how are uncertain outcomes (timeouts) reconciled?
10. After selection, what are the order states through approval, documents and collection booking, and which system owns each?

### D. Scheme rules
11. How are Choices points calculated per vehicle and per employee grade? Where are the tables held, and how are effective dates and versions handled?
12. What are the Choices employee cash-contribution rules, and how long does a quoted price or points value stay fixed?
13. Where are eligibility rules held (grade, model, driver, licence, family)? Are they machine-readable?
14. Who can change vehicle points or scheme rules (by role), and how are changes approved, versioned and made effective?

### E. Identity and roles
15. How do employees and ordering staff sign in to the target front end? What kind of identity provider is used, and which roles exist?

### F. Target architecture on AWS
16. What is the target AWS architecture for the front end and backend, described generically (e.g. CDN with static hosting, containers or functions, API gateway)? Which front-end framework and design system?
17. Does the target backend expose REST, GraphQL or event interfaces to the front end? Which operations are read-only and which write, and which (if any) are still fulfilled by a system of record behind the target API?
18. Which kinds of database are used in the target, and where in the target platform does transactional state (orders, reservations) live?
19. How are timed or background processes (expiry, reminders, batch jobs) run?
20. What are the front-end hosting conventions: content security policy, cross-origin rules, base paths, and how would externally built components be added? Is Adobe Edge Delivery Services involved?
21. Which parts of the target platform are built, which are in build, and on what timeline?

### G. Notifications
22. How does the target platform send email (by service type), and which role owns the sender?

### H. Contract, renewal and usage data
23. Which contract fields exist (term, mileage allowance, start and renewal dates)? What happens if an employee doesn't choose in time, and can contracts be extended?
24. Is any vehicle usage data (mileage, fuel economy) available to GCSP, and under what permissions?

### I. Measures
25. Which reports or KPIs exist for order volumes, time to order, unallocated stock and renewal delays? Describe what each measures, not its values.

If you can only answer some, prioritise group A, then questions 8, 9, 16, 17 and 18.
