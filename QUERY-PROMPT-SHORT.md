# Nakshatra Query Sheet — folder in, .xlsx out

You are a CA auditing an Axis Bank collection agency. The folder holds photos/PDFs
of its handwritten **Nakshatra Manual**. Produce the agency's **Query Sheet** as
`.xlsx`. Do it all yourself — write and run your own code, don't hand me scripts.

## Method (this is what decides accuracy)

**Transcribe tables cell by cell. Never scan a page for "what's wrong".**
Measured: glancing finds fields but not rows — 0 of 14 person-named queries found,
vs 3 of 4 unnamed. 27 of 43 real queries name a person. Find blanks with
`rows.filter()`, not by eye.

1. **List files.** Extract PDF pages. **Drop duplicates** — folders often hold the
   same evidence twice (45 photos + a 45-page PDF of them). Compare small
   greyscale fingerprints at all 4 rotations, tight threshold. Losing a real page
   is worse than reading one twice.
2. **Fix orientation.** ~Half these pages are sideways, and that alone cost 2
   queries on one page. Don't auto-detect from pixel stats — tested, it scored an
   upright page 2.76 and a sideways one 1.07, backwards. Build contact sheets
   (~12 thumbs), look, rotate, re-check.
3. **Read each page:** which document (list below), which month (never guess — not
   legible = empty), then copy the table: one record per row, one field per
   column, **every row including good ones**. Dense/small writing → enlarge into
   **full-width horizontal bands**. **Never cut vertically** — separates the name
   column from the data; tested, accuracy went 4/12 → 1/12.
   - Copy names **exactly, surname-first** (`Gupta Ravishankar`). No reordering,
     no dropping middle names, no tidying spelling.
   - Empty cell = `""`. **Any ink = filled** (initials, scrawl, "on behalf of", an
     employee number).
   - Stop at the last used row. Never invent a name, ID or date.
   - Note which column holds the person, and which columns are reference data
     (IDs, locations, products, buckets, counts) — **blanks there aren't queries**.
4. **Find defects:** column empty in some rows → query naming those rows' people;
   empty in every row (>2 rows) → one query, `(All <field>)`, nobody named.
5. **Group — in this order**, or one person splits across three rows:
   per person per field collect that person's months → people with identical
   month-sets share a row → same doc+people+months merge into one row listing all
   fields.

## Wording

`<Document> <stem> [for the month of <months>]. (i.e. <fields>)(<Label> -:<names>)`

Stems, copy exactly (note which say "in the Nakshatra Manual" vs "in Nakshatra Manual"):

- **was not properly filled up in the Nakshatra Manual** — Manpower register,
  Declaration cum undertaking page, Vendor Declaration
- **was not filled up properly in Nakshatra Manual** — No Dues and Data Purging
  Declaration, Repo kit Tracker, Audit Score Card
- **was not filled up properly in the Nakshatra Manual** — Monthly Compliance
  Declaration, Product Declaration page, Telephone line Declaration, Visiting
  register page, Agency Training Tracker
- **was wrongly filled up in the Nakshatra Manual** — Assets Management Declaration
- **was wrongly filled up in Nakshatra Manual** — Agency Key personal Information

Filled-but-wrong → `was wrongly filled up…` and quote the wrong value in brackets.
Only Product Declaration / No Dues / Monthly Compliance carry `for the month of`.

**Months:** `Apr'26`. Two join with ` & `. Three+ consecutive → `Apr'26 to Jun'26`.
A month outside the folder's quarter: keep it, and put
`check the month — <m> sits outside the audit period` in column C.

**Names:** join `, ` then final ` & `. Past 8 names → `(All <field>)`.
Fold spelling variants of one person (`Haldar`/`HALDER`) onto the fullest spelling;
don't fold two people sharing a surname.

Examples:
```
Manpower register was not properly filled up in the Nakshatra Manual. (i.e. CM Sign) (CM Name:Patel Akash Mukeshbhai,Vishal Verma)
Manpower register was not properly filled up in the Nakshatra Manual. (All Executive Sign)
Declaration cum undertaking page was wrongly filled up in the Nakshatra Manual. (i.e. Agency VEM ID) (WESSURFOC1)
No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of May'26 & Jun'26. (i.e. CM Detail) (CM Name : Sarfaraz Shabbir Shaikh)
CM was not visited in the agency one time in the each month for the month of Apr'26 & Jun'26. (CM Name: Prajyot Prabhakar Ambekar)
```

## Documents → Category | fields | named by

- **Manpower register** → Manpower Register Verifications | Executive Sign,
  Executive Signature, Executive Axis ID, Executive Gatigo ID, Gatigo TP Id of FOS,
  Axis ID of FOS, Date of Resignation, issuance & expiry date, ID card number of
  Executive, CM Sign, Author Sign | Executive Name
- **Declaration cum undertaking page** → Code Of Conduct | Agency VEM ID, Agency
  Contact No, Agency Person Contact no., CM Details, CM Sign | CM Name
- **Product Declaration page** *(monthly)* → Product Declaration Verifications |
  CM Sign, Agency Authorised Sign, Count of Case Allocated | CM Name
- **No Dues and Data Purging Declaration** *(monthly)* → No Dues Letter
  Verification | CM Details, CM Sign & Date, Data Purging month, Data of agency | CM Name
- **Monthly Compliance Declaration** *(monthly)* → Monthly Compliance
  Verifications | CM Details, CM Sign & Date, CM ID, Complied (Yes/No/NA) | CM Name
- **Visiting register page** → Visitor Register Verifications | CM In time, CM Out
  time, Signature, Purpose of Visit | CM Name
- **Repo kit Tracker** → Repo Register Verification | Repo Details, Repo return
  Date, Unused Date CM ID & Sign | **LAN No.**
- **Assets Management Declaration** → Data Security | ID card number of Executive | Executive Name
- **Telephone line Declaration** → System Application Verification | Username & Executive Category
- **Agency Training Tracker** → Process Management | Agency Sign
- **Vendor Declaration** → Employee Background Verification | Bank Stamp
- **Audit Score Card** → Process Management | Audit Justification
- **Agency Key personal Information** → Process Management | Agency VEM ID

Also allowed as a category: `Legal compliance & Infrastructure:`

## Not-a-blank-cell checks

**Who never visited:** the Bank Manager Agency Visit Register shows which CM
visited in which month. Take the CM roster **only from the sign-off page header** —
no other source. Anyone on it missing a month of the audit period:
```
CM was not visited in the agency one time in the each month for the month of <months>.(CM Name -:<names>)
CM was not visited in the agency for the audit period. (CM Name -:<names>)
```
**Never build the roster from the visit register** — a visiting bank manager or the
auditor becomes a "CM who failed to visit". That invented 11 queries on one agency,
one against the auditor who signed the audit. No sign-off CM list → skip this check
and say so.

Also: alteration/overwriting without countersign; expired authorisation letter; a
document that should be present and isn't.

**Can't come from photographs** (~9% of real queries — say so, don't invent):
data still in the Axis system after being declared purged; a network drive on the
agency PC; a CA-attested declaration never handed over; a non-existent surrender
letter. **Ceiling is ~91%, not 100%.**

## Workbook

One sheet named after the agency. Column A labels, B values:
row 1 `Agency Visit Sign Off`; rows 2–14 `Date`, `Name of the agency`, `Address of
the agency and location`, `Full name of the person who is signing`, `Designation in
the agency`, `Signature and stamp`, `Auditor full name`, `Signature`, `Auditor
Employee No.`, `Collection Manager Name`, `Collection Manager ID`, `Nakshatra
Barcode Number`, `Signature`; row 15 blank; row 16 `Audit Observation`; row 17
`Main Category` | `Observation` | `Sign off Revert`; row 18+ one query each,
sorted by category.

Fill 2–14 from the Agency Visit Sign Off page; leave empty if not legible. Column C
empty unless a query needs checking. Wrap column B; widths ~34 / ~104 / ~20.

## Finish

Give me the file, then list each observation with its page number. State: pages
read, pages unreadable, anything you were unsure of, anything you suspect but
couldn't confirm from a photograph.

**Agency folder:**
