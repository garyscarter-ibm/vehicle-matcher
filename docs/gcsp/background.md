# GCSP background (captured 2026-10-30)

Raw notes from a walkthrough of BMW's Group Car Schemes Portal (`gcsp-int.bmwgroup.net`, the INT
environment) with Sandeep Sundar. Background for a new set of features; nothing is decided yet.
Screenshots are in `screens/`, in wizard order. They're from the test environment with junk data:
use them for layout and flow only, never as a source of facts (figures, rules, timings).

**Platform clarification, 2 November 2026:** Russell confirms that GCSO means Global Car Scheme – Ordering, the mainframe ordering application; ISA means Internal Sales Appointment, formerly the separate handover system. GCSP unifies their UI over the mainframe for now, with Java modernisation to follow. See the [current platform context and supplied slides](platform-context.md); the dated research below remains historical evidence.

## Screens

| File | Screen |
|---|---|
| `00-employee-account.webp` | Employee Account: employee, licence, additional drivers; order history per scheme (FS Choices, Motorcycle Choices, PCS UKFS BMW) |
| `01-replace-vehicle.webp` | Order wizard step 1, Replace Vehicle: current order and vehicle details |
| `02-new-order.png` | Step 2, New Order: scheme, driver, contract length, collection date and location, brand |
| `03-vehicle-series.png` | Step 3, Vehicle Series: series and body style tiles; ineligible ones (all M cars here) greyed out |
| `04-vehicle-models.png` | Step 4, Vehicle Models: the unassigned cars in that series (model, exterior, interior, cost, CO2, insurance group, earliest collection) |
| `05-vehicle-details.webp` | Step 5, Vehicle Details: car is held, "Vehicle preview available for: 12 Seconds" countdown; phone, email, expected return mileage |
| `06-summary.png` | Step 6, Summary: "Time remaining to place your order: 293 Seconds", T&Cs to accept |
| `07-order-confirmation.webp` | Step 7, Order Confirmation: new GCSO number, status Awaiting IS Approval |

## The journey as we know it (as-is)

1. **Your Account** is the employee's landing page. It only shows content if the employee exists
   in SAP HR; otherwise they see a support banner. It shows employee details, additional drivers
   and order history grouped by scheme. The *Order Vehicle* and *Replace* buttons appear according
   to eligibility.
2. **Order Wizard:** order details (scheme, contract length and mileage, driver, collection date
   and location, brand) → eligible body group → eligible vehicle → vehicle details and price →
   summary and T&Cs → confirmation with a GCSO order number.
   - The employee picks from **existing IVS stock**, not a configurator. Hence the "VEHICLE IS NO
     LONGER AVAILABLE" errors and "earliest delivery date".
3. **Approval** is a static state machine, not a workflow (SP-VZPS90OA-ORDER-FLOW.wiki §6):
   - New orders start at `20` Awaiting IS Approval, or `10` Awaiting HR Approval if the employee
     or their grade is flagged.
   - An order goes through `30` Awaiting IS Manager Approval only if the flag for that is set.
   - Once an order passes `30`, its data is sent to **IVS-R**.
   - Cancelled states are `90` (by GCSO) and `95` (by IVS).
4. **ISA appointment:** an administrator books the collection slot, an inspector marks it
   complete, and **Close Appointment** updates the fleet vehicle. For a return, it also queues a
   UVDM work request (the step that starts the used-car disposal).
5. **Contract end → Replace**, which goes back through the wizard in replacement mode.

## Facts

- New cars are released every Monday, Wednesday and Friday. Monday's release is at 11:30.
- IVSR: managers choose which cars UK employees can order.
- Two kinds of scheme:
  - **Choices**: employees earn points every month as part of their remuneration and spend them
    with BMW (merchandise, days off, GCSO vehicles). Higher grades earn more points.
  - **Preferences**: for relatives. Paid from salary, e.g. a car for your mum.
- At the right grade you can order more than one vehicle (e.g. for family).
- The type of vehicle you can have depends on grade and seniority.
- A vehicle's points value depends on its type and engine.
- You must change car every 6 months or 6,500 miles (Options) or 10 months or 10,500 miles
  (Preferences). BMW wants maximum residual value, so the cars go on as Young Used Cars.
- Within 3 months of your contract end date you can look at new cars and choose a collection
  date. The collection window has to fall in the last month of the contract.
- If you do far too many miles, the GCSO manager can override this and give an earlier collection
  date. You ask by email.
- Ordering: pick a series, then see the unassigned orders (cars available to pick). You have
  **120 seconds** to choose one; while you do, it's hidden from everyone else. Then you have
  **5 minutes** to read and accept the T&Cs.

## Ideas

- State your preferences in advance.
- If you're unlucky once, you get priority next time?
- Auto-allocate: an option to let the system pick for you.
- "Here are your three allocations": rank them 1st, 2nd, 3rd; emailed to you and held for a
  couple of hours.
- Back office: set quotas and nudge the recommendation algorithm.
- Spread demand: "Chosen by x people. Would you like one in white? Only 4 people chose that."
- VSS holds all the vehicle data: from the VIN you can get the static data. Sandeep will check
  with Pete Thorne whether we can get access to the connected vehicle data design.

## Earlier IBM proposal: "IBM x BMW Employee Car Scheme" (Oct 2024)

Source: `Box-Box/BMW Used Cars Auctions/Other/Employee Scheme Presentation4.pptx`, 7 slides, last
modified 2024-10-31 ([Box](https://ibm.ent.box.com/file/1686988626726)).

**Problem.** Predict which cars employees want, in advance, so the right number of each is
ordered. Other issues include the 9am first-come-first-served rush to get online and order the car.

**Why past data can't answer it.** Past choices were shaped by what was available, so they don't
show what people actually wanted. A feedback loop follows:
1. An employee picks a sub-optimal car in the Monday rush, under time pressure and limited stock.
2. We record that they "chose" it.
3. We predict their next car from their own and similar employees' past choices.
4. So we can only predict what they'd pick in a constrained rush, not what they want, and nothing
   in the process tells us whether they were satisfied.

The fix needs extra information: a form, or a ranking of the cars they'd want next, plus a
satisfaction score.

**Solution 1 (preferred).** Replace the race with a process where time doesn't matter: a form for
1st, 2nd and 3rd choice. Data needed for machine learning: the car they'd ideally like, and a
follow-up rating of how happy they were with it. The loop:
1. Employee ranks 1st, 2nd, 3rd preference.
2. Employee gets one of the three (ideally the 1st).
3. Employee gives a satisfaction score out of 10.
4. The model predicts the employee's next desired car, coping with changing eligibility and models.
5. The scheme team orders in the desired cars.
The model improves over time "until employees always get desired car".

**Solution 2 (fallback).** Treat the first ~25% of Monday-morning choices as people getting the
car they really want. Risks: that 25% may not represent the workforce (office staff who can log on
quickly, not factory staff); it throws away 75% of the data; and even the fast 25% may still not
pick what they ideally want.

## Earlier IBM proposal: "ECS User Stories & Process Map" (2025)

Source: `Box-Box/BMW Used Cars Auctions/For BMW/ECS/ECS User Stories & Process Map.pptx`, 5 slides,
last modified 2025-03-11 ([Box](https://ibm.ent.box.com/file/1805744330203)). The follow-on to the
2024 deck: user stories, then one end-to-end journey.

**Employee stories.**
- The allocation process is fair, so I have a reasonable chance of a car that meets my needs.
- I can give my top 3 car choices for my next company car.
- I get confirmation of my assigned car, so I can prepare for contract renewal.
- A more streamlined handover.
- Easy, convenient service with minimal friction.

**Admin stories.**
- I define which cars are available for selection, so the fleet stays within budget and
  operational constraints.
- I can handle the production response easily.
- I submit a final list of desired vehicles to the production team so they can allocate cars.
- Easy, convenient service with minimal friction.

**Process map.** Shown on a timeline: 1 March, 30 March, 3 April, 3 May.
1. **Employee (James, 38, wants a car for his family with 2 kids)** is approaching the end of his
   contract. He gets an automated email asking for his top 5 car choices, and
   replies by 1 March.
2. **Admin (Greg)** logs on and sees an ML-calculated list of cars to order. He can set min and
   max numbers per model to give the business control, and the ML updates the list. He sends the
   final list to production (30 March).
3. **Production** replies with the cars that can be had (3 April). Greg loads that list into the
   same dashboard, and the ML allocates the available cars to people by best match.
4. **James** gets an email naming his car, with handover instructions (3 May). His 1st and 2nd
   choices weren't available, so he gets his 3rd. He's disappointed, especially as his colleague
   Julianne got her 1st choice. But the car still fits his family, costs what he wanted to run and
   is dark like his 1st choice. And he knows he'll be higher in the pecking order next time.

## Stock management in the Employee Car Scheme

- Stock management: anything that isn't moving (e.g. not selected by a BMW employee as part of the
  CHOICEs scheme) is taken off the list of vehicles offered to employees in the GCSO web app and
  moved to another channel. Currently Greg does stock management a couple of times per month.
- On average 40-50 cars remain stuck and unallocated per stock management review by Greg. These
  vehicles are usually moved to the Retail channel, if the relevant team agrees, by changing the
  channel in IVS-ZG/IVS-R from "Employee Rental (EMR)" to "Sales (CAST)". That data might be used
  to train the AI model to predict which vehicles are more likely not to be selected by employees,
  and so remain stuck in the funnel.
- From March 2025 Greg will not be able to move MINI cars to other channels as part of stock
  management. It might be possible to move them to the Fleet channel, but no longer to the Retail
  channel: for MINI from March 2025, and for BMW from 2027, as part of changes introduced by TNR.
- Currently MINI is not available for CHOICEs on the employee car scheme, and is only available for
  selected special PEOPLE manual orders.

## Box note: "BMW Employee Car Scheme" (Oct-Nov 2024)

Source: `Box-Box/BMW Employee Car Scheme/BMW Employee Car Scheme.boxnote`, written by Elis
Salyahetdinova, last edited 2024-11-07 ([Box](https://ibm.ent.box.com/file/1669641592632)).
Discovery notes from calls with Greg, Jacob and Elis. The stock management notes above came from
this note.

**The team.** The BMW Employee Car Scheme team manages both the group car schemes (employee car
schemes, approximately 7,500 vehicles) and fleet vehicles for events such as the Goodwood Festival
of Speed (2,500 vehicles).

**High-level process.**
1. New employee joins BMW.
2. Goes through an allegation [sic] process.
3. Decision reached: approved or unapproved.
4. If approved for GCSO, their data is entered into the system and the employee is allocated a
   grade based on seniority. All employees get a grade, from junior to senior directors.
5. When new vehicles are released, they're made available only to the grades that qualify.
6. Employees need to select and order a vehicle 3 months in advance. For a new employee, they try
   in most cases to allocate a car from stock.
7. If the vehicle needs to be brought into the country, it's checked and, if approved, sent to the
   relevant VDC (vehicle distribution centre).
8. Vehicle received at the VDC.
9. Employee receives the eSigned contract 2 weeks in advance.
10. Employee collects the vehicle.
11. After 9 months the employee returns the vehicle to a VDC.
12. The vehicle is refurbished and resold through auctions.

The usual contract length is 9 months, with exceptions such as "high-mileage" employees.

**Systems.**
- GCSO: the ordering system. Web-based, not user-friendly, not flexible, constrained.
- IKB (marked "??" in the note): intelligent knowledge base, an old mainframe system looking into
  employee availability.
- SAP: used for payments.

**Two elements of the scheme.**
1. Points: Choices, for management employees.
2. Preferences: for non-management employees.

**Family tree.** Lets you get a vehicle by paying a fee: a brand new series for £300 a month for 9
months, with insurance and other key elements covered. Cars sold to employees count towards sales
targets.

**Pain points.**
- What cars will employees want in future? Historic data is available, plus the future pipeline
  of vehicles coming through.
- 300-400 new cars are uploaded to the site each week, and all employees try to access them on
  Monday morning.
- The team handles a lot of customer-service requests. A document of eligibility criteria and
  answers exists. Could a chatbot answer these on the team's behalf?
- The team manages stakeholders with sometimes conflicting needs (HR, Finance etc.). They must
  keep in mind the residual value of the YUC once it's returned after 9 months. EV residual values
  tend to trend downwards, but employees are very interested in EVs (e.g. they install home
  chargers).

**Ownership and channels.**
- The group car scheme is out of scope for the New Retail Model (previously the Future Sales Model,
  FSM). When an employee buys a car through the scheme it's taken off the NSC's books and bought by
  Alphabet, which owns it. When the employee returns it, Alphabet still owns it, and the NSC acts
  only as an intermediary between Alphabet and the dealer/agent network.
- Stock is shared across UK channels (employee car scheme, retail, mobility etc.). With the New
  Retail Model each channel will own its stock and sharing won't be possible. Initially this
  affects MINI only, around 20-25% of employee car scheme vehicles.
- Throughput of scheme vehicles is quick. The cost of holding a vehicle is the cash-flow delay
  until it's sold to Alphabet.
- Ireland is out of scope: a separate team runs it.

**KPIs.**
- Better demand forecasting would raise employee satisfaction and cut complaints from HR.
- Employee sentiment is very negative at the moment. A balance is needed between the scheme as a
  financial scheme, a business tool, getting employees on the road, volume through the channel,
  and employee satisfaction.

**Next steps (as of the note).**
- Looking to run monthly employee satisfaction surveys.
- A self-serve tool such as a chatbot: Jacob to investigate and share examples on the next call.
- A design thinking workshop with employees, Financial Services and HR to define the problem
  statement better: Elis to suggest it on the next call and mention it to Stuart.

**7 November 2024: "Employee Vehicle Process" call with Greg, Jacob and Elis.**
Mural board:
<https://app.mural.co/t/bmwinfluenceworkspace2223/m/bmwinfluenceworkspace2223/1730905841549/2df09e986ed6c351df4f9c2d99837102f7409f0e>

*Min/max criteria for renewal*
- The earliest an employee's car can be renewed, in special circumstances: 4 months + 2,500 miles.
- Maximum use: 10,000 miles or 9 months should not be exceeded. Special circumstances (e.g. a
  campaign delaying the new vehicle) can be an exception.
- The New Retail (TNR) will change the scheme period from the standard 9 months to 18 months.
- Normally an employee can collect a new vehicle up to two weeks before the official renewal date
  (e.g. 9 months is reached on 15 March, but they can swap cars on 1 March).
- The historical view of an employee's previous vehicles is in the GCSO web app and is seen as a
  feature worth keeping in any future application.

*Backend support process*
- For employees due to renew on 1 March 2025, Greg reviews which contracts end then and what
  vehicles are currently selected, and uses a pivot table alongside the Spec Matrix to decide the
  mix to order. On 1 November 2024 he submits a list of desired reorder vehicles to Production.
- Production confirms which of the requested vehicles they can provide, based on production
  availability.
- End November 2024: an advance email tells employees their contract expires by the end of March
  2025 and asks them to log in and select a new vehicle.
- 1 December 2024: Greg opens the GCSO portal for renewal selection (latest collection date:
  anyone whose contract ends by the end of March 2025).
- The employee picks one vehicle from the desired list that's still available and unselected. They
  can't pick a vehicle that wasn't on the original desired list.
- 1 March 2025: the employee collects the vehicle.
- Greg's main aim is to minimise manual orders, which take time and resources. His team is only
  three people, and he'd like to automate as much as possible to reduce their workload.

### Mural board: "Timeline" (6-7 Nov 2024)

The Mural linked from the Box note, exported 2026-10-30: the sticky notes as CSV and the board as
PDF, in [sources/mural/](sources/mural/). Stickies by Jacob Short and Elis Altanov.

The board has two swim lanes, **Employee Actions** and **Greg / Charles Actions**, each a 9-month
timeline (Day 1, Month 3, Month 5, Month 7, 9 Months).

*Employee lane:* Employee Gets New Car (Day 1, "1st March 2025") → Employee Orders Next Car
(between Month 5 and Month 7) → Employee Gets Second New Car (9 Months). Before Day 1: "Employee
selects one of the vehicle from the desired list still available and not selected" and "Employee
cannot select a vehicle that was not on the original desired list".

*Greg / Charles lane, before Day 1:*
1. 1st Nov 2024: Greg submits a list of desired reorder vehicles to the Production team. ("Spec
   Matrix is used by Greg to determine the mix of vehicles ordered.")
2. Production team comes back to say which of the requested vehicles are available.
3. End November 2024: advance email telling employees their contract is due to expire by the end
   of March 2025; please log in to select your new vehicle.
4. 1st December 2024: Greg opens the GCSO web portal for selection of renewal vehicles (latest to
   collection date: anyone whose contract is due to end by the end of March 2025).

*Open questions (Jacob, blue stickies):*
- Why not ask everyone ahead of time what they want, with a survey, and order in what they want?
  Is it because they want a diverse selection, which maintains residual values?
- How often do people currently get their 1st-3rd choice car?
- Could employees choose 3 cars that are the same with different specs, or are the options quite
  different? (Answer sticky: "points dont change for spec".)
- When does Greg need to place the order by? 3 months ahead of it arriving?

## Choices Car Scheme Guidelines v1.6 (June 2024)

Source: `Box-Box/BMW Employee Car Scheme/Choices Car Scheme Guidelines v1.6.pdf`, 40 pages
([Box](https://ibm.ent.box.com/file/1669639580698)). The employee-facing rulebook for Choices.
Full text: [sources/choices-car-scheme-guidelines-v1.6.md](sources/choices-car-scheme-guidelines-v1.6.md).
Its figures (the family tree, the age and licence eligibility table, and the ordering windows
table) are images and didn't come through as text. Below are the parts that bear on choosing and
ordering a car.

**Scheme basics.**
- Applies to employees of BMW (UK) Ltd, BMW Financial Services (GB) Ltd, BMW UK Pensions Services
  Ltd, Park Lane Ltd and BMW (UK) Holdings Ltd.
- Employees get an interest-free loan to buy the car, and sign a Loan Agreement with Alphabet (GB)
  Ltd at handover. Alphabet buys the car back at the end for the "Loan Amount", the predicted
  residual value set at the time of ordering.
- Covers everything but fuel: interest-free loan, comprehensive insurance, maintenance,
  depreciation provision, VED and first registration, PDI, delivery and emergency service. All are
  a benefit in kind and taxed.
- Monthly contribution in points or pounds, set by the vehicle's points value in the Choices Points
  and Eligibility Matrix (on the HR Portal; "updated regularly"). Cars above your entitlement can
  be topped up in cash at £1 = 1 point, from salary.
- The points value at the time of ordering is fixed for the agreement. Points can change when UK
  retail prices change or after a scheme cost review.

**Eligibility.**
- All Company employees aged 18+ who meet the age and licence criteria, except interns,
  apprentices and Year 1 graduates. Monthly benefit points are set by personal grade.
- One car each. G9 and above can have a second car for a partner or family member. G1-G8 and Grad
  2 get one.
- Restrictions by personal grade, the vehicle's insurance group, and how long a full licence has
  been held. Drivers flagged high-risk from licence or claim history may be restricted too.
- "Your GCSO account will only show vehicles which are available to you."
- A car for a family member is ordered in their name in GCSO, and must be if they drive it more
  than 50% of the time. The car is always registered to the employee, who must attend every
  collection and return.
- Some roles may be required to drive a particular model.

**Ordering.**
- Availability of models, colours and options may be restricted from time to time: "This
  monitoring of the fleet is essential to the continued viability of the Car scheme."
- No options can be added except tow bars (factory-fit only, on certain models; order at least 3
  months ahead) and lumbar support, via "Special requirements". No retrofits except winter tyres.
- Once an order is approved in GCSO it can't be changed or cancelled, barring extenuating
  circumstances.
- Agreement: a maximum of 9 months or 8,000-10,000 miles, whichever is sooner, unless the Company
  says otherwise.
- Handover locations: Farnborough (Cody) and Thorne (VDC); Nine Elms and Park Lane for Park Lane
  Ltd.
- Loan documents are sent via Adobe Sign about 14 days before the appointment and must be signed
  at least 2 days before it.

**Re-ordering.**
- Alphabet sends a renewal reminder three months before the contract end date if you haven't
  reordered. Ordering three months ahead is recommended, so the return and the new collection can
  share one appointment.
- Order windows open by month. Example: an end date of 27 August means the window opens on 1 May,
  and "we encourage you to start looking at the earliest opportunity to give you the best chance
  of securing a suitable vehicle."
- You can collect a replacement up to 14 days before the end date with no early-return charge. So
  an early-in-the-month end date can give two ordering windows (end date 7 August: the May window,
  or the April window by moving the collection date to 25 July).
- The requested date entered on your search becomes the requested appointment date.
- Over-mileage is charged per mile at the rate on the Agreement (varies by model). Agreements
  can't exceed 9 months. Mileage extensions aren't automatic if a replacement is delayed.
- Keeping the car (settling the loan) excludes you from the scheme for 12 months. Returning early
  under 8,000 miles loses eligibility for 12 months unless Alphabet agrees.

**Document history worth knowing.** v1.1 (December 2020) moved the contract term from 6 to 9
months.

## Choices vehicle eligibility matrices (orders from 1 October 2024)

Sources: `FS&UK Choices Vehicle Eligibility Matrix (WEF 1st October 2024).pdf` and
`RR&Production Choices Vehicle Eligibility Matrix (WEF 1st October 2024).pdf`, both in
`Box-Box/BMW Employee Car Scheme/`. Two-page scans, transcribed in full in
[sources/choices-eligibility-matrices-2024-10.md](sources/choices-eligibility-matrices-2024-10.md).

- Each lists the BMW range (1, 2, 3, 4, 5 and Z Series, X models, BMW i, M) by model, class
  (UKL, KKL, MKL, M) and engine, with a tick or cross per grade band. No MINI, and no points values.
- **FS&UK** (BMW / FS & Alphabet) grade bands: G1-6, G7, G8-10, G11-14.
- **RR&Production** grade bands: PG1, G8 - G10, G11 & G12.
- Engines marked (T) can have a factory tow bar: write "Tow Bar Requested" in GCSO's special
  requirements box.
- Both are maintained by C1-UK-G, Internal Fleets, Summit ONE, Farnborough.
