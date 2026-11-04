# Follow-up questions about the GCSP target platform on AWS (round 2)

## What this document is for

IBM is building a **demonstration** of a next-generation front end for the BMW company car scheme (GCSP), for a
presentation to BMW. In the demo, an employee states their preferences once and the system finds, holds and offers
them suitable cars. The scheme's ordering lead gets a view of predicted demand and suggested orders. The demo runs
entirely on **synthetic data** and doesn't connect to any BMW system.

This round asks only what a BMW audience would notice if the demo got it wrong. Brief answers are fine.

**Always answer for the target AWS platform**, whether that part is already built or still in build. Mention the
legacy mainframe only where current scheme rules are documented nowhere else.

## Anonymisation: required, because your answers will leave the BMW network

Your answers will be copied outside the BMW network into IBM working notes, so they must contain no confidential
or personal detail. Apply every rule below to the whole response.

1. **No people.** Never name individuals. Use a role instead ("the ordering lead", "a platform architect").
2. **No personal or employee data.** Don't include real employee records, grades tied to people, contracts or usage histories.
3. **No real vehicle identifiers.** Don't include real VINs, registrations, order or commission numbers.
4. **No infrastructure specifics.** Don't include hostnames, URLs, IP addresses, account IDs, resource names, ports,
   keys, certificates or credentials. Describe services generically.
5. **No exact commercial values.** Don't include real prices, points values, contribution amounts or volumes. Explain
   the structure and rules, and give illustrative ranges, marked *illustrative*.
6. **No verbatim copying.** Summarise in your own words.
7. **Sources, generically.** Cite a document by type and date only, such as "solution design, v2, Sep 2026". Never
   give an internal link, document ID or author.
8. **System names** may be given where they're the standard names of BMW scheme applications (e.g. GCSO, ISA). Use a
   generic description for any other internal system, team or vendor.
9. If a question can't be answered without breaking these rules, answer as much as you safely can and say "withheld: confidential".

## How to answer

For each question, give a short **answer**, a **status** (`documented`, `partly documented` or `not documented`;
say "not documented" rather than infer) and a **source** (document type and date only). If documents disagree, give
the most recent position. Return the answers as a single markdown document.

## Questions

1. **Choices points.** How does an employee's points entitlement work: an allowance per grade, per month or per contract? When a car costs more points than the employee has, is ordering simply blocked, or can they pay cash to make up the difference?
2. **Electric and plug-in cars.** Are there scheme rules specific to electric or plug-in hybrid cars, such as needing a home charge point or confirming charging access?
3. **Ordering new stock.** How does the scheme team decide which cars to order for the scheme? Who sets the quota, how often, and at what level (model or series)? What do they submit, and roughly how long does it take from that order to the cars being released to employees? Give *illustrative* ranges.
4. **Releases.** Typically how many cars are in a release, and how quickly is released stock taken by employees? Give *illustrative* ranges.
5. **Preferences.** Does the target platform capture employee preferences, wish lists or saved searches, or notify employees when suitable cars arrive?
6. **Hosting other components.** Could the target Angular app host standard web components (custom elements) built by another team, if they were bundled into the app? Does anything in the platform's design-system or security guidance rule that out?
