# Brief — automating an audit exception review

I'm looking for suggestions on how to approach this. I've described the work
and the constraints; I'd like your view on the best way to build it, including
approaches I may not have considered. Please don't assume my current thinking
is right.

---

## What the work is

We are an audit firm. We audit a network of agencies on behalf of a large
institution, on a recurring cycle.

Each agency keeps a **physical register book** issued by the institution. It is
a printed book with a fixed set of standard page types, filled in **by hand**
over the quarter by different people — agency staff and the institution's own
field managers.

Our auditor visits the agency, inspects the book and the agency's systems, and
photographs everything. The result is one folder per agency.

Our deliverable is a **query sheet**: a list of every exception found, written
in a strict house format, which goes back to the agency to correct.

## The inputs

One folder per agency, containing:

- Photographs of every page of the register book — taken on a phone, so they
  vary in angle, lighting, rotation and focus
- Some pages bundled as PDFs, some as loose images
- All of it is **image only — there is no text layer anywhere**
- Handwriting is mixed-script and often rushed
- A typical folder is 40–120 pages
- We process several agencies per cycle

## The current manual process

1. Someone opens the folder and goes page by page
2. On each page they check whether every mandatory cell has been filled in
3. For each blank or wrongly-filled cell they note: which document, which
   field, whose row it is (the register is organised by person), and which
   month the page covers
4. They write that up as one line in the house format
5. The sheet goes to the agency; responses are tracked in a status column

Steps 2–4 are what we want to automate. Not the visit, not the follow-up.

## What the output has to look like

A sheet per agency with:

- A header block of the agency's own details — these are themselves readable
  from one of the photographed pages
- A table of exceptions, each row being: **category** (from a fixed list of
  about twelve) and **observation** (one sentence)

The observation sentence is formulaic and non-negotiable. It always names:

- the document
- the defect
- the month, where the page is a monthly one
- the exact field that is blank
- the person whose row it is

The house wording varies slightly **by document type** — word order and article
differ — and we have several hundred past examples of correctly written ones.

Granularity matters: several blank fields in one person's row on one page is
**one** row listing all the fields, not one row per field. The same defect for
several people in one month is **one** row with the names joined. The same
defect for one person across several months is **one** row with the months
joined.

## What makes it hard

1. **Reading blank cells is the whole task.** Not "what does this say" but
   "which box that should have something in it is empty, and whose row is it".
2. **Photographed handwriting**, not clean scans.
3. **Some exceptions are absences, not marks on a page.** "This person never
   appears in the visit register for the quarter" requires reading the entire
   folder and working out who is missing — it cannot be answered from any
   single page.
4. **Some exceptions need outside information.** Whether a recorded ID is
   *wrong* requires knowing the correct one. Whether data was purged requires
   checking the institution's own system. These may simply be out of scope.
5. **A wrong detail is worse than a missing one.** The sheet goes to a client.
   A misread month or a misattributed name is a real problem; an admitted gap
   is not.
6. **Judgement about materiality.** Not every blank is raised. Our auditors
   are consistent about which ones matter, but it isn't written down anywhere
   except in the past examples.

## Constraints

- Handling client material, so where the images go and whether anyone retains
  or trains on them matters
- Cost per agency should be small — this replaces a task measured in hours
- Should be usable by staff who are auditors, not engineers
- We have a large body of correctly completed past sheets that can be used as
  training data or as worked examples
- Running cost and setup effort both matter; we'd rather start with something
  that works imperfectly today than a project that pays off in months

## What I'd like from you

1. **How would you approach this?** Not just an implementation of what I've
   described — tell me if the framing itself is wrong.
2. **Where should the work be split?** Reading the pages accurately and
   writing the sentence in house style feel like different problems. Should
   one system do both?
3. **How do we handle the whole-folder questions** — the exceptions that are
   about something missing across many pages rather than present on one?
4. **How should this be measured?** We have past sheets to compare against,
   but I want to know what a fair test looks like and what score would be good
   enough to actually use.
5. **What's the realistic ceiling**, and which parts should stay manual?
6. **What would you do first** if you wanted to know quickly whether the whole
   idea is viable?

Assume the pages are the same standard forms every cycle, and that we can
supply labelled examples if that helps.
