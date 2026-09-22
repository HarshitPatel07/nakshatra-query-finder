# Nakshatra agency audit — find the queries in a folder

Paste this whole file into Claude Code, add the folder path at the bottom, and
let it run. It produces the agency's Query Sheet in the firm's format.

---

## What this is

An Axis Bank collection agency keeps a printed register book, the **Nakshatra
Manual**, filled in by hand. An audit photographs its pages. The job is to find
the cells that should be filled in and are not, and to write each one up as a
query in the firm's own wording.

## The one rule that matters

**Transcribe. Do not judge.**

Reading a page and reporting "what's wrong with it" has been measured on real
folders and it fails in a specific way: it finds *fields* and cannot attribute
*rows*. On MS Chandan it produced **0 of the 14 queries that name a person**,
while getting 3 of the 4 that name nobody. A signature column that is six-eighths
filled reads as "filled" to anything that glances at it.

So do not look for problems. Copy the table out, cell by cell, and let
`build_sheet.py` find the blanks. `rows.filter()` has no attention to run out of
on row 30 of 43.

---

## Step 1 — prepare the pages

```bash
python claude/prep.py "<agency folder>"
```

This collects every photograph and PDF page, drops duplicates (folders often
hold the same evidence twice), writes numbered pages into `<folder>/_work/pages`,
and builds contact sheets in `<folder>/_work/contact`.

## Step 2 — fix the orientation

Read each contact sheet. Roughly half these pages are photographed sideways, and
orientation costs real queries — the page that lost two of MS Chandan's was
sideways. Note which page numbers need turning and by how many degrees
clockwise, then re-run:

```bash
python claude/prep.py "<agency folder>" --rotate "1:90,2:90,3:90,8:180"
```

Check the new contact sheets. Repeat until every page is upright.

## Step 3 — read the pages

Read `_work/pages/pageNNN.jpg` in order. For each page:

1. **Say which document it is** (list below). If it is not one of them, or it is
   a photograph of the premises, note it and move on.
2. **Say which month it covers**, if the page carries one. Never guess a month —
   a wrong month goes to the bank. If it is not legible, leave it empty.
3. **Copy the table out**, one object per row, one key per column.

When a table is dense or the handwriting is small, blow the page up first —
full-width horizontal bands, never vertical cuts:

```bash
python claude/prep.py "<agency folder>" --zoom 3 --bands 3
```

Vertical cuts separate the name column from the data. That was tried and it took
accuracy from 4 in 12 down to 1 in 12, because every finding came back with
nobody on it.

### Transcription rules

- **Copy what is written, exactly.** Surname first if that is how it is written
  — `Gupta Ravishankar`, not `Ravishankar Gupta`. The sheet has to match the
  register so the agency can find the row.
- **An empty cell is `""`.** Do not write "missing" or "not filled" — just empty.
- **A signed cell is any mark at all.** Initials, a scrawl, "on behalf of", an
  employee number. If there is ink in the cell, it is filled.
- **Every row, including the ones that are fine.** The blanks cannot be found
  without the rows around them.
- **Stop at the last used row.** Printed empty rows at the bottom of a form are
  not people.
- **If you cannot read a cell, say so** in a `doubt` note on that page rather
  than guessing.

### Write it to `tables.json`

```json
{
  "agency": "Ms Chandan Shah",
  "header": {
    "date": "11.08.2026",
    "agency": "Ms Chandan Shah",
    "address": "180/1A, Senhati Colony, Behala, Kolkata, West Bengal, 700034",
    "signedBy": "", "designation": "", "stamp": "",
    "auditor": "", "auditorSign": "", "auditorNo": "",
    "cmNames": "", "cmIds": "", "barcode": "", "agencySign": ""
  },
  "pages": [
    {
      "page": 3,
      "document": "Product Declaration page",
      "month": "Jun'26",
      "who": "CM Name",
      "columns": ["CM Employee ID", "CM Name", "CM Location", "CM Sign", "Agency Authorised Sign"],
      "ignore": ["CM Employee ID", "CM Location"],
      "rows": [
        {"CM Employee ID": "482519", "CM Name": "Rakesh Modak",   "CM Location": "SILIGURI", "CM Sign": "Seth for Rakesh Modak", "Agency Authorised Sign": "Chandan Saha"},
        {"CM Employee ID": "474977", "CM Name": "Sarmila Sarkar", "CM Location": "SILIGURI", "CM Sign": "",                      "Agency Authorised Sign": "Chandan Saha"}
      ]
    }
  ],
  "extra": [
    {"category": "Process Management",
     "observation": "Nakshatra Manual was surrender to the Bank but Surrender letter was not available at the time of Audit. (Barcode No : NM00180)",
     "review": ""}
  ]
}
```

- `who` — the column holding the person a row belongs to. Usually `CM Name`,
  `Executive Name`, or `LAN No.` on the repo tracker.
- `ignore` — columns that are reference data rather than things that must be
  filled: employee IDs, locations, products, buckets, case counts. Blanks there
  are not queries.
- `extra` — anything that is not a blank cell: a missing document, an alteration
  without countersign, something seen at the premises.

## Step 4 — build the sheet

```bash
python claude/build_sheet.py tables.json -o "<Agency> - Query sheet.xlsx"
```

It finds the blanks, groups them the way the firm does — one row per person with
that person's months joined — words them in the house style, and writes the
workbook: sign-off header in rows 1–14, `Main Category | Observation` from row 17.

It prints every observation with the page it came from. **Check each one against
the page before sending it.**

---

## The documents, and what must be filled on each

| Document | Category | Fields that get queried |
|---|---|---|
| Manpower register | Manpower Register Verifications | Executive Sign, Executive Signature, Executive Axis ID, Executive Gatigo ID, Gatigo TP Id of FOS, Axis ID of FOS, Date of Resignation, issuance & expiry date, ID card number, CM Sign, CM Name, Author Sign |
| Declaration cum undertaking page | Code Of Conduct | Agency VEM ID, Agency Contact No, Agency Person Contact no., CM Details, CM Sign |
| Product Declaration page *(monthly)* | Product Declaration Verifications | CM Sign, Agency Authorised Sign, Count of Case Allocated |
| No Dues and Data Purging Declaration *(monthly)* | No Dues Letter Verification | CM Details, CM Sign & Date, Data Purging month, Data of agency |
| Monthly Compliance Declaration *(monthly)* | Monthly Compliance Verifications | CM Details, CM Sign & Date, CM ID, Complied (Yes/No/NA) |
| Visiting register page | Visitor Register Verifications | CM In time, CM Out time, Signature, Purpose of Visit |
| Repo kit Tracker | Repo Register Verification | Repo Details, Repo return Date, Unused Date CM ID & Sign — named by **LAN No.** |
| Assets Management Declaration | Data Security | ID card number of Executive |
| Telephone line Declaration | System Application Verification | Username & Executive Category |
| Agency Training Tracker | Process Management | Agency Sign |
| Vendor Declaration | Employee Background Verification | Bank Stamp |
| Audit Score Card | Process Management | Audit Justification |
| Agency Key personal Information | Process Management | Agency VEM ID |

## Checks that are not about a blank cell

- **Who never visited.** The Bank Manager Agency Visit Register shows which CM
  visited in which month. Take the Collection Managers from the **sign-off page
  header** — that list and no other. Anyone on it with no visit in a month of
  the audit period is a query. Never build this roster from the visit register
  itself: a bank manager who called in once, or the auditor, becomes a CM who
  then "failed to visit", and on one agency that invented eleven queries
  including one against the auditor who signed the audit.
- **Alteration or overwriting** without a countersign.
- **An expired authorisation letter** — it exists, and the validity date has passed.
- **A document that should be there and is not.**

## What cannot be found from photographs

Say so plainly rather than inventing it. Across three real folders, 4 of 43
signed-off queries were of this kind — about 9%:

- data still present in the Axis Bank system after it was declared purged
- a network drive mapped on the agency's PC
- a CA-attested declaration nobody handed over
- a surrender letter that does not exist

These need a person at the audit. **The ceiling from photographs alone is
roughly 91%, and anyone promising 100% is wrong.**

---

## Run it

```
Agency folder: <paste the path here>
```
