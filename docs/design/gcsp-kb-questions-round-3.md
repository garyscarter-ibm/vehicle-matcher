# Questions about vehicle and order identity on the GCSP target platform (round 3)

## What this document is for

IBM is building a **demonstration** of a next-generation front end for the BMW company car scheme (GCSP), for a
presentation to BMW. The demo runs entirely on **synthetic data** and doesn't connect to any BMW system.

The demo needs synthetic stock that looks like what the target platform will hold, so that a real data source could
later replace it without redesign. These questions are about **how the target platform identifies and describes a
vehicle order and its specification**: which fields, in what format, and which field is the key.

**Always answer for the target AWS platform**, whether that part is already built or still in build. Mention the
legacy mainframe only where the target still depends on its formats.

## Anonymisation: required, because your answers will leave the BMW network

Your answers will be copied outside the BMW network into IBM working notes, so they must contain no confidential
or personal detail. Apply every rule below to the whole response.

1. **No people.** Never name individuals. Use a role instead ("the ordering lead", "a platform architect").
2. **No personal or employee data.**
3. **No real identifiers.** Don't include real order numbers, UUIDs, VINs or registrations. **Do** describe each
   format exactly (length, character set, structure, what each part means), with a made-up example marked *illustrative*.
4. **Product codes are allowed.** BMW model codes and option codes are public on BMW's own configurator, so you may
   quote them, and their format, as examples.
5. **No infrastructure specifics.** Don't include hostnames, URLs, account IDs, resource names, keys or credentials.
6. **No exact commercial values.** Don't include real prices or points values.
7. **No verbatim copying.** Summarise in your own words. Field names from a data model or API specification may be quoted.
8. **Sources, generically.** Cite a document by type and date only, such as "data model, Nov 2026".
9. If a question can't be answered without breaking these rules, answer as much as you safely can and say "withheld: confidential".

## How to answer

For each question, give a short **answer**, a **status** (`documented`, `partly documented` or `not documented`;
say "not documented" rather than infer) and a **source** (document type and date only). If documents disagree, give
the most recent position. Where a field list is asked for, a table of field name, type or format, and meaning is ideal.
Return the answers as a single markdown document.

## Questions

### A. Order identity
1. Which identifier will GCSP store as the key for a scheme vehicle order: the order number, the order UUID, or both? Has this been decided, and does it stay the same from release to the scheme through to delivery?
2. What is the exact format of the order number (length, letters or digits, leading zeros, any check character) and of the wholesaler order ID? Give *illustrative* examples.
3. Can an order's identifier ever change (for example on amendment, replacement or a "unique key change")? If so, how is the link between old and new kept?

### B. Vehicle specification on an order
4. Which fields describe a vehicle's specification on an order, as returned to GCSP by the fleet application or ordering system? Please list each field with its format: for example model code, model range, paint code, upholstery code, option codes, packages, engine or powertrain, body type, model year or production week.
5. Which model code does the order carry: the 4-character model code used by the ordering system (*illustrative*: `72HH`), the configurator's model code (*illustrative*: `T5MJ`), the model range (*illustrative*: `G61`), or several of these? How are they related?
6. What is the format of an option code (*illustrative*: `S0337`, `P0300`)? Are paint and upholstery held as option codes or in separate fields? Is the option list complete for the fitted car, or only the chargeable extras?
7. Is there any identifier for a configuration or specification on its own, separate from the order (a specification ID, build code or hash)? Or is a specification always just the model code plus its list of codes?

### C. Matching and descriptions
8. How does GCSP or the fleet application decide that two orders are "the same car" for display (for example, grouping identical stock)? Which fields are compared?
9. Where do human-readable descriptions for model and option codes come from (pricing service, catalogue, fleet application), and is that lookup keyed by model code, option code and an effective date?
10. Do scheme eligibility rules and points prices refer to model codes, model ranges, series or something else? Which code would a rule match against?

### D. Example
11. Using made-up values, show one *illustrative* order record as GCSP would receive it, with every identity and specification field filled in.

If you can only answer some, prioritise 1, 4, 7, 5 and 11.
