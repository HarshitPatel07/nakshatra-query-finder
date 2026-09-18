# Nakshatra Query Finder

Reads a folder of scanned Axis Bank agency-audit evidence and drafts the
**Auditor Observations** — the queries — the way they appear on the
AGENCY AUDIT RATING AND SCORE CARD.

## Run it

```bash
python -m http.server 8130 --directory C:\Harshit\nakshatra_query
```

Open <http://localhost:8130>. A server is required (the page uses ES modules,
which browsers refuse to load from `file://`).

## Use it

1. Paste your Anthropic API key (console.anthropic.com → API keys). It is kept
   in this browser's `localStorage` only — never in these files, never pushed.
2. Click the drop zone and pick a folder:
   - pick the **parent** (`Nakshtra`) to do every agency in one run, or
   - pick a **single agency folder** for just that one.
3. Check the page counts and the cost estimate, untick any agency you don't want.
4. **Find queries.** Progress and per-batch results stream into the log.
5. Copy, download as CSV, or print the observations.

## What it checks

The checklist lives in `assets/audit.js` (`CHECKLIST`) and covers authorisation
letter validity, declaration cum undertaking signatures, the bank manager visit
register, agency visit sign-off, no-dues and dues-tracker CM signatures, code of
conduct display, PCC trails, and premises/staff records. Edit that one string to
change what the audit looks for — nothing else needs touching.

Being *present* is not enough: the prompt makes the model check each document is
complete, signed, dated and in validity, which is where the real queries come from
(e.g. "authorisation letter available but validity expired 31-03-26").

## How it works

| Step | Where |
|---|---|
| Group picked files into agencies by folder | `assets/scan.js` → `groupByAgency` |
| Render every PDF page to JPEG at 1568px | `assets/scan.js` → `pages` (pdf.js) |
| Read 6 pages per API call, collect issues | `assets/audit.js` → `readBatch` |
| Merge duplicates into final observations + score | `assets/audit.js` → `consolidate` |
| Progress, results, CSV/print | `assets/app.js` |

Every PDF in these packs is a **scanned image with no text layer**, so there is
nothing to grep — the pages have to be looked at. 1568px is the most detail
Anthropic bills for; anything larger is downscaled server-side anyway.

## Cost

Roughly **2,300 tokens per page**. A 114-page agency pack is about **$1.95** on
Opus 5, or **$0.78** on Sonnet 5. The estimate shown before you run is live and
per-agency — check it before a big run.

Opus 5 is the default because reading Indian handwriting on photographed register
pages is exactly the kind of task where the weaker model quietly guesses. Switch
to Sonnet 5 for a cheaper first pass.

## Limits — read before relying on it

- **It drafts, you sign.** Output is a first draft of the observations. Every
  query must be verified against the page before it goes on a score card.
- Handwriting is genuinely hard. The prompt tells the model to say "illegible"
  rather than invent a value, but check anything that carries a date or a number.
- Scoring bands (90+ = A, 75+ = B, 60+ = C) are the model's arithmetic from a
  clean 100. Treat the score as indicative; the collection manager sets the real one.
- Nothing is stored. Close the tab and the results are gone — export first.
