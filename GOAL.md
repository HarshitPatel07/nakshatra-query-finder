# Goal, and the path to it

## The goal

Replace the page-by-page manual pass. Point the tool at an agency folder and
get that agency's query sheet back — in house format, ready to check and send.

**Not** replacing the visit, the judgement, or the sign-off. The auditor still
reads the draft and owns what goes to the client.

### What "good enough to use" means

This has to be pinned down, because "accurate" on its own is not a target.

| | Target | Why this number |
|---|---|---|
| **Finds the real exceptions** | 7 of every 10 that are findable from the photos | Below this, you re-read every page anyway and nothing is saved |
| **Doesn't invent things** | No stated month, name or ID that isn't on the page | A wrong detail sent to the client is worse than a missing one |
| **Wording** | Indistinguishable from hand-written | ✅ **already met** |
| **Time** | Under 10 minutes per agency, unattended | Must beat doing it by hand |
| **Cost** | Under ₹200 per agency | Small against the hours it replaces |

At that point the job changes from *"read 49 pages and write 12 queries"* to
*"check 12 drafted queries and add what's missing"*. That is the whole point.

---

## Where we actually are

Measured once, properly, on one agency against a finished sheet.

**Solved:**
- Reads photographed PDFs and images, no text layer needed
- Recognises the provider from any pasted key and picks a model that works
- Writes in house format — verified character-for-character against real rows
- Correct granularity: fields grouped, names joined, months joined
- Learns from imported finished sheets
- Survives busy providers, quota limits and truncated replies without losing pages

**Not solved:**
- **Finding**: 4½ of 8 findable exceptions — **56%**, target is 70%
- Whole-folder questions are structurally impossible in the current design
- Final output is CSV, not the workbook
- Free-tier capacity keeps stopping runs before they finish

**Out of scope — decided, not deferred:**
Four of the twelve on the test agency need information that is not in the
folder: whether a recorded ID is *wrong*, whether a surrendered book's letter
exists, whether purged data is still live in the institution's system. These
stay manual. The tool should not guess at them.

---

## The path

Five stages. Each has a gate — a question answered before moving on, so effort
isn't spent on the wrong thing.

### Stage 1 — Get a run to finish, every time
*Blocked on: free-tier capacity, not on the code.*

Three separate free-tier limits have stopped runs: the better models unavailable,
20 requests a day, and capacity withdrawn at busy times. These are what the free
tier *is*, not bad luck.

**Do:** move to a paid key. Roughly ₹50–150 per agency.
**Gate:** a full folder completes unattended, twice in a row.

Without this nothing below can be measured, because runs keep dying half way.

### Stage 2 — Find out what it can actually do
*The most important stage, and the cheapest.*

The current 56% is flattered — the built-in examples include the test agency's
own answers. A fair number needs that agency held out.

**Do:** hold one finished agency out of the examples entirely. Run it. Compare
line by line against the real sheet. Count found / missed / invented.

**Gate — this decides everything after it:**
- **65%+** → the approach works; go to Stage 4, polish and roll out
- **45–65%** → the approach works but reading is weak; go to Stage 3
- **under 45%** → generic page-reading is the wrong tool; the pages are the same
  standard forms every cycle, so a system trained on those specific layouts is
  the better answer, and Stage 3 should be that instead

Do not skip this. Everything after it is a different project depending on the
number.

### Stage 3 — Close the reading gap
*Only if Stage 2 says reading is the problem.*

In order of expected gain:

1. **Whole-folder pass.** Build the full list of people and months from every
   page first, then check for gaps. This is the only way to reach exceptions
   about something *absent across the folder* — currently impossible, and
   several real queries are exactly this shape.
2. **Tell it the audit period.** One input box. Stops impossible months and
   lets it notice a monthly page that never appears.
3. **Verification pass.** Re-check each drafted finding against its page before
   it is written. Catches misreads before they reach the sheet.
4. **Fewer pages per request.** Already done — unmeasured. Stage 2 will show it.

**Gate:** 70% found, nothing invented.

### Stage 4 — Deliver it in final form

- Export the workbook, not CSV: one sheet per agency, the sign-off header
  filled from the photographed page, status column left blank
- Flag low-confidence rows so the reviewer knows where to look first
- Make the whole folder runnable in one go

**Gate:** a sheet comes out that needs checking and topping up, not retyping.

### Stage 5 — Put it to work

- Run every agency each cycle
- Import each corrected sheet afterwards — the examples improve every cycle,
  which is the compounding part
- Track found / missed per cycle so drift is visible

**Gate:** an auditor who did not build it uses it unaided and prefers it.

---

## What stays manual, permanently

- The visit and the photographs
- Anything needing the institution's own systems or records
- Deciding which exceptions are material enough to raise
- Reviewing and signing the sheet

The tool drafts. It does not sign.

---

## The honest risk

The single unknown is Stage 2. Everything built so far assumes a general
page-reader can find blank cells in photographed handwritten forms well enough.
That is unproven at the level needed, and one clean measurement settles it.

If the answer is no, the work is not wasted — the wording engine, the learning
loop, the format and the folder handling all carry over to a system trained on
these specific forms. Only the reading layer would be replaced.

**Next action: Stage 1, then Stage 2. Nothing else until there is a real number.**
