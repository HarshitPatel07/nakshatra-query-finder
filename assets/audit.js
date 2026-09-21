/* ==========================================================================
   audit.js — read pages, then consolidate into observations.
   Provider-agnostic: the wire format lives in providers.js.
   ========================================================================== */

import { PROVIDERS } from './providers.js?v=16';
import { CATEGORIES, DOCUMENTS, STANDING_CHECKS, MONTH_STYLE, pickExamples, canonCat,
         STEMS, WRONG_STEMS, DEFAULT_STEM } from './corpus.js?v=16';

/* --------------------------------------------------------------------------
   The read prompt is built fresh each run so that examples imported since the
   last run are actually used.
   -------------------------------------------------------------------------- */
function buildReadSystem() {
  const docs = DOCUMENTS.map(d =>
    `- ${d.name}  [category: ${d.cat}]\n` +
    `    fields that are commonly blank: ${d.fields.join(', ')}\n` +
    (d.who ? `    name the person as: (${d.who} -:<name>)\n` : '') +
    (d.monthly ? `    this page repeats per month — say which month is at fault\n` : '')
  ).join('');

  const standing = STANDING_CHECKS.map(s => `- ${s.when}\n    write: ${s.say}`).join('\n');

  const examples = pickExamples(24)
    .map(e => `[${e.cat}] ${e.obs}`).join('\n');

  return `You are a chartered accountant auditing an Axis Bank collection agency under the
Nakshatra programme. You are shown photographed pages of the agency's NAKSHATRA MANUAL —
a printed register book filled in by hand — plus supporting declarations.

Your job on each page is narrow and specific: find CELLS THAT SHOULD BE FILLED IN AND ARE NOT,
or are filled in wrongly. For each one you must capture four things, because the query cannot
be written without them:
  1. WHICH DOCUMENT the page is
  2. WHICH FIELD is blank or wrong
  3. WHOSE ROW it is — the Collection Manager or Executive named on that line
  4. WHICH MONTH the page covers, when the page is a monthly one

THE DOCUMENTS TO EXPECT
${docs}
CHECKS THAT ARE NOT ABOUT A BLANK CELL
${standing}

HOW A QUERY IS WORDED — these are real signed-off queries from this firm. Match this
voice, this level of detail, and this punctuation exactly:
${examples}

Month style: ${MONTH_STYLE}

HARD RULES
- NEVER state a month, a name, an ID or a date you cannot actually read on the page.
  If the month is not legible, set "month" to "" — do not guess. A wrong month is worse
  than no month, because it is sent to the bank.
- GRANULARITY, which this firm is strict about:
    · One issue per DOCUMENT + MONTH + PERSON. If three fields are blank in the same
      person's row on the same page, that is ONE issue whose "field" lists all three,
      e.g. "CM Sign, Agency Authorised Sign". It is NOT three issues.
    · Different people on the same page ARE separate issues — they get merged later.
    · If a field is blank for nearly everyone on the page, say so once with who: ""
      rather than listing dozens of names.
- Do NOT summarise as "several entries are incomplete" — name the field.
- A page with nothing wrong gets an empty issues array. Do not manufacture findings.
- Only use these categories: ${CATEGORIES.join(' | ')}

Reply with ONLY a JSON object, no prose and no code fence:
{"pages":[{"page":<1-based number within THIS batch>,
  "doc":"<which document this page is>",
  "month":"<e.g. Jun'26, or empty if not legible>",
  "issues":[{"document":"<document name as listed above>",
             "field":"<the exact field that is blank or wrong>",
             "who":"<the CM or Executive named on that row, or empty>",
             "whoLabel":"<CM Name | Executive Name | LAN No. | empty>",
             "month":"<month this defect relates to, or empty>",
             "wrong":<true if filled in but incorrect, false if simply blank>,
             "category":"<one of the categories above>",
             "note":"<only if this is a standing check rather than a blank cell>"}]}]}`;
}

/* --------------------------------------------------------------------------
   What an Axis Nakshatra agency audit actually checks. Derived from the real
   score cards and evidence packs — the model uses it as the spine, but is told
   to report anything else it sees too.
   -------------------------------------------------------------------------- */
const CHECKLIST = `
AUTHORISATION & MANDATE
- Bank-to-agency authorisation letter to collect money: present, signed, and STILL IN VALIDITY.
  An expired validity date is a query even though the letter exists.
- Agency agreement / VEM ID recorded.

DECLARATION CUM UNDERTAKING (from the agency)
- Signed by proprietor / partner / director.
- Every Collection Manager listed with CM Employee ID and signature. Blank rows are a query.

BANK MANAGER AGENCY VISIT REGISTER
- Entries carry date, employee ID, name, mobile, branch, product, bucket/DPD,
  time in, time out, signature, purpose of visit.
- Missing time-out, missing signature, gaps between visit dates, or overwriting/
  alteration without countersign are queries.

AGENCY VISIT SIGN OFF
- Agency name, address, signatory name and designation, auditor name and employee no.,
  Nakshatra barcode number, agency stamp and signature all filled.

DUES / NO-DUES
- No-dues certificates present and current.
- Dues Tracker updated in Nakshatra. If kept manually, it must still be SIGNED BY THE CM —
  manual upkeep without CM signature is a query.

CODE OF CONDUCT
- RPMG / debt-collection Code of Conduct displayed at the agency premises (photo evidence).
- Acknowledgement section signed and dated.

SYSTEMS
- PCC software trails reviewable at time of audit. Software error preventing trail
  verification is itself a reportable observation.

PREMISES & STAFF
- Recovery agent ID cards, police verification, training/IIBF certificates where shown.
`.trim();

const UNUSED_READ_SYS = `You are a chartered accountant performing an Axis Bank Nakshatra agency audit.
You are being shown scanned pages of an agency's evidence pack: handwritten registers,
signed declarations, no-dues certificates and photographs of the agency premises.

For EACH page you are given, report what the page is and any audit exception on it.

${CHECKLIST}

RULES
- Handwriting is often unclear. Only assert what you can actually read. If a field looks
  blank, say it is blank; if it is illegible, say illegible — never invent a value.
- A document being PRESENT is not enough. Check it is complete, signed, dated and in validity.
- Blank mandatory cells, missing signatures, missing time-out entries, expired dates and
  unexplained alterations are all exceptions.
- If a page is clean, return an empty issues array for it. Do not manufacture findings.

Reply with ONLY a JSON object, no prose and no code fence:
{"pages":[{"page":<the 1-based number of the page within THIS batch>,
  "doc":"<what this document is>",
  "issues":[{"text":"<the exception, one sentence, specific>",
             "severity":"high|medium|low",
             "category":"<Authorisation|Declaration|Visit Register|Sign Off|Dues|Code of Conduct|Systems|Premises|Other>"}]}]}`;

const SUM_SYS = `You are the senior chartered accountant signing off an Axis Bank Nakshatra
agency audit. Your assistants have read every page of the evidence pack and listed what they
found. Turn their raw findings into the Auditor Observations that go on the
AGENCY AUDIT RATING AND SCORE CARD.

- Merge duplicates: the same defect seen on many pages is ONE observation that says how
  widespread it is (e.g. "time out not recorded in 7 of 20 visit register entries").
- Drop anything that is not a real audit exception.
- Write each observation the way an auditor writes it on the score card: plain, factual,
  specific, one or two sentences. Name the document and the date or count where known.
- Order by severity, most serious first.
- Suggest a score out of 100 and the matching grade, following the bank's own bands:
  90-100 = A / Very Good, 75-89 = B / Good, 60-74 = C / Average, below 60 = D / Poor.
  Start from 100 and deduct for what you found.

Reply with ONLY a JSON object, no prose and no code fence:
{"score":<0-100>,"grade":"<A|B|C|D>","category":"<Very Good|Good|Average|Poor>",
 "observations":[{"text":"<the observation>","severity":"high|medium|low",
   "category":"<area>","sources":["<file p<n>>", ...]}]}`;

/* -------------------------------------------------------------------------- */

/* How hard to push before handing the batch back to the caller.

   A 503 means this model is busy right now — another model is almost always
   quicker than waiting, so give it one short retry and move on. A 429 with no
   named ceiling is a per-minute limit that genuinely does clear, and switching
   model would hit the same account limit, so that one is worth waiting out. */
const TRIES_BUSY = 2;
const TRIES_RATE = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* "Please retry in 54.05s" — providers often say exactly how long to wait. */
function hintedDelay(detail) {
  const m = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(detail || '');
  return m ? Math.min(Math.ceil(parseFloat(m[1])) * 1000, 60000) : 0;
}

/* cfg = { provider, key, model, effort, onRetry? } */
async function call(cfg, system, content, signal) {
  const P = PROVIDERS[cfg.provider];
  if (!P) throw new Error('unknown provider: ' + cfg.provider);

  const req = P.build(cfg.key, cfg.model, cfg.effort, system, content);

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(req.url, {
        method: 'POST', headers: req.headers,
        body: JSON.stringify(req.body), signal
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      /* A browser CORS refusal surfaces as a bare "Failed to fetch" with no
         response to inspect. Retrying cannot help, so end the run and say why. */
      const err = new Error(
        `blocked by the browser — ${P.label} would not accept a direct call from a web page`);
      err.fatal = true;
      throw err;
    }

    if (res.ok) return P.read(await res.json());

    let detail = '';
    try { detail = P.errorOf(await res.json()); } catch { /* non-JSON body */ }

    /* An empty wallet or a bad key never heals — stop the run outright. */
    const fatal = res.status === 401 || res.status === 403 ||
                  (res.status === 400 &&
                   /credit balance|billing|api key not valid|invalid.*api.?key/i.test(detail));

    /* A named quota ceiling ("limit: 20") is this MODEL's allowance, not a
       passing spike. Waiting it out burns minutes and still fails, so the
       caller should move to a model with more headroom instead of retrying.
       Newer Gemini models carry the smallest free-tier quotas, so the model
       that ranks best is often the one that runs out first. */
    const quotaCapped = res.status === 429 && /limit:\s*\d+/i.test(detail);

    /* "High demand" and unnamed rate limits ARE temporary — come back rather
       than dropping the pages. */
    const worthRetrying = !fatal && !quotaCapped &&
      (res.status === 503 || res.status === 429 || res.status >= 500);

    const busy = res.status === 503;
    const tries = busy ? TRIES_BUSY : TRIES_RATE;

    if (worthRetrying && attempt < tries) {
      const wait = busy ? 1500
                        : (hintedDelay(detail) || Math.min(2000 * 2 ** (attempt - 1), 30000));
      cfg.onRetry?.(`${busy ? 'busy' : 'rate limited'}, waiting ` +
                    `${Math.round(wait / 1000)}s (try ${attempt + 1} of ${tries})`);
      await sleep(wait);
      if (signal?.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; throw a; }
      continue;
    }

    const err = new Error(`HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
    err.fatal = fatal;
    err.status = res.status;
    err.quotaCapped = quotaCapped;      // this model is spent — try another
    err.limit = (/limit:\s*(\d+)/i.exec(detail) || [])[1];
    err.exhausted = worthRetrying;      // gave it every chance and it still failed
    throw err;
  }
}

/* --------------------------------------------------------------------------
   Build the house sentence from the parts the model extracted, rather than
   asking it to write prose. The template is fixed, so the wording cannot drift:

     <Document> was not filled up properly in the Nakshatra Manual
       [for the month of <MONTHS>]. (i.e. <Field>)(<WhoLabel> -:<Who>)
   -------------------------------------------------------------------------- */
export function phrase(issue) {
  const doc = (issue.document || '').trim();
  if (!doc) return null;

  /* the stem is per-document and learned from the firm's own sheets */
  let stem = STEMS[doc];
  if (issue.wrong) {
    stem = WRONG_STEMS[doc] ||
      (stem || DEFAULT_STEM).replace(/was not (properly filled up|filled up properly)/,
                                     'was wrongly filled up');
  }
  stem = stem || DEFAULT_STEM;

  let s = `${doc} ${stem}`;
  if (issue.month) s += ` for the month of ${issue.month}`;
  s += '.';
  /* "(All Executive Sign)" rather than seventy names, matching the sheets */
  const all = /^__ALL__(\d+)$/.exec(issue.who || '');
  if (all) {
    s += ` (All ${issue.field || 'entries'})`;
    return s;
  }

  if (issue.field) s += ` (i.e. ${issue.field})`;
  if (issue.who) s += `(${issue.whoLabel || 'CM Name'} -:${issue.who})`;
  return s;
}

/* Two issues are the same query when document, field, person and month match. */
export function issueKey(i) {
  return [i.document, i.field, i.who, i.month]
    .map(x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
}

/* Models sometimes wrap JSON in a fence or add a stray sentence. Dig it out. */
function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const s = raw.indexOf('{');
  if (s === -1) {
    const err = new Error('no JSON in reply');
    err.splittable = true;
    throw err;
  }

  const e = raw.lastIndexOf('}');
  if (e > s) {
    try { return JSON.parse(raw.slice(s, e + 1)); } catch { /* fall through to salvage */ }
  }

  /* A reply cut off at max_tokens leaves valid objects followed by a half-
     written one. Rather than lose the whole batch, close the brackets that
     are still open and keep the pages that did come through. */
  const body = raw.slice(s);
  const cut = body.lastIndexOf('},');
  if (cut > 0) {
    const stack = [];
    const head = body.slice(0, cut + 1);
    let inStr = false, esc = false;
    for (const ch of head) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    try {
      const fixed = JSON.parse(head + stack.reverse().join(''));
      fixed.__truncated = true;
      return fixed;
    } catch { /* salvage failed too */ }
  }

  const err = new Error('reply was cut off mid-answer');
  err.splittable = true;
  throw err;
}


/* --------------------------------------------------------------------------
   Read one batch of pages. `batch` is [{label, b64}, ...].
   Returns [{label, doc, issues:[...]}]
   -------------------------------------------------------------------------- */
export async function readBatch(cfg, batch, signal) {
  const content = [];
  batch.forEach((p, i) => {
    content.push({ text: `--- page ${i + 1}: ${p.label} ---` });
    content.push({ image: p.b64 });
  });
  content.push({ text: `Report on all ${batch.length} page(s) above, in order.` });

  const text = await call(cfg, buildReadSystem(), content, signal);

  const out = parseJson(text);
  return (out.pages || []).map(p => ({
    label: batch[(p.page || 1) - 1]?.label || batch[0]?.label || '?',
    doc: p.doc || '',
    month: p.month || '',
    issues: (Array.isArray(p.issues) ? p.issues : []).map(i => ({
      ...i,
      category: canonCat(i.category),
      month: i.month || p.month || '',
      text: i.note || phrase(i) || i.text || ''
    })).filter(i => i.text)
  }));
}

/* --------------------------------------------------------------------------
   Consolidate every page finding into the final observation list.
   -------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   Turn page findings into sheet rows — locally, with no model call.

   The firm writes ONE ROW PER DEFECT, so nothing is summarised away. The only
   merging done is the merging the auditors themselves do:
     · same document + field + month, several people  ->  names joined
     · same document + field + people, several months ->  months joined
   -------------------------------------------------------------------------- */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthOrder(m) {
  const x = /([A-Za-z]{3})[a-z]*'?(\d{2})/.exec(m || '');
  if (!x) return 9999;
  const i = MONTHS.findIndex(n => n.toLowerCase() === x[1].toLowerCase());
  return (+x[2]) * 12 + (i < 0 ? 0 : i);
}

/* Naming eight people is useful; naming seventy is a wall of text nobody
   reads, and the firm writes "(All …)" in that case instead. */
const NAME_CAP = 8;

function joinNames(list) {
  const u = [...new Set(list.filter(Boolean))];
  if (u.length <= 1) return u[0] || '';
  if (u.length > NAME_CAP) return `__ALL__${u.length}`;
  return u.slice(0, -1).join(', ') + ' & ' + u[u.length - 1];
}

function joinMonths(list) {
  const u = [...new Set(list.filter(Boolean))].sort((a, b) => monthOrder(a) - monthOrder(b));
  if (u.length <= 1) return u[0] || '';
  /* a clean run of consecutive months is written "Apr'26 to Jun'26" */
  const run = u.every((m, i) => i === 0 || monthOrder(m) === monthOrder(u[i - 1]) + 1);
  if (run && u.length > 2) return `${u[0]} to ${u[u.length - 1]}`;
  return u.slice(0, -1).join(', ') + ' & ' + u[u.length - 1];
}

/* The firm lists every blank field on one page as a single query —
   "(i.e. Count of Case Allocated, Agency Authorised Sign)" — not one query per
   field. Seven rows for one score card is the model being too literal. */
function mergeFields(flat) {
  const byDMW = new Map();
  for (const i of flat) {
    const k = [i.document, i.month, i.who].map(x =>
      String(x || '').toLowerCase().trim()).join('|');
    if (!byDMW.has(k)) byDMW.set(k, { ...i, fields: [], sources: [] });
    const g = byDMW.get(k);
    if (i.field) g.fields.push(i.field);
    g.sources.push(i.source);
  }
  return [...byDMW.values()].map(g => ({
    ...g,
    field: joinFields(g.fields),
    source: g.sources[0],
    sources: [...new Set(g.sources)]
  }));
}

function joinFields(list) {
  const u = [...new Set(list.filter(Boolean))];
  if (u.length <= 1) return u[0] || '';
  if (u.length === 2) return u.join(', ');
  return u.slice(0, -1).join(', ') + ' & ' + u[u.length - 1];
}

export function collate(findings) {
  let flat = [];
  findings.forEach(f => (f.issues || []).forEach(i =>
    flat.push({ ...i, source: f.label })));

  flat = mergeFields(flat);

  /* pass 1 — same document+field+month, different people */
  const byDFM = new Map();
  for (const i of flat) {
    const k = [i.document, i.field, i.month].map(x => String(x || '').toLowerCase().trim()).join('|');
    if (!byDFM.has(k)) byDFM.set(k, { ...i, whos: [], sources: [] });
    const g = byDFM.get(k);
    if (i.who) g.whos.push(i.who);
    g.sources.push(i.source);
  }

  /* pass 2 — same document+field+people, different months */
  const byDFW = new Map();
  for (const g of byDFM.values()) {
    const names = joinNames(g.whos);
    const k = [g.document, g.field, names].map(x => String(x || '').toLowerCase().trim()).join('|');
    if (!byDFW.has(k)) byDFW.set(k, { ...g, names, months: [], sources: [] });
    const h = byDFW.get(k);
    if (g.month) h.months.push(g.month);
    h.sources.push(...g.sources);
  }

  /* An audit covers one quarter, so the monthly pages cluster. A month far
     outside that cluster is far more likely to be a misread than a real page
     — flag it for checking rather than dropping it, because dropping could
     hide a genuine finding. */
  const tally = new Map();
  for (const g of byDFW.values())
    for (const m of g.months) tally.set(m, (tally.get(m) || 0) + 1);
  const common = [...tally.entries()].filter(([, n]) => n > 1).map(([m]) => monthOrder(m));
  const lo = common.length ? Math.min(...common) : null;
  const hi = common.length ? Math.max(...common) : null;
  const suspect = m => lo !== null && m &&
    (monthOrder(m) < lo - 1 || monthOrder(m) > hi + 1);

  return [...byDFW.values()].map(g => {
    const issue = { ...g, who: g.names, month: joinMonths(g.months) };
    const odd = g.months.filter(suspect);
    return {
      category: canonCat(g.category) || 'Process Management',
      text: g.note || phrase(issue) || g.text || '',
      document: g.document || '',
      field: g.field || '',
      who: g.names || '',
      month: issue.month,
      review: odd.length ? `check the month — ${odd.join(', ')} sits outside the audit period` : '',
      sources: [...new Set(g.sources)]
    };
  }).filter(r => r.text)
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') ||
                    (a.document || '').localeCompare(b.document || ''));
}

export async function consolidate(cfg, agencyName, findings, signal) {
  const lines = findings
    .filter(f => f.issues.length)
    .map(f => `${f.label} [${f.doc}]\n` +
      f.issues.map(i => `  - (${i.severity}/${i.category}) ${i.text}`).join('\n'))
    .join('\n');

  if (!lines) {
    return { score: 100, grade: 'A', category: 'Very Good', observations: [] };
  }

  const text = await call(cfg, SUM_SYS, [{
    text: `Agency: ${agencyName}\nPages read: ${findings.length}\n\nRaw findings:\n\n${lines}`
  }], signal);

  const out = parseJson(text);
  return {
    score: Number(out.score) || 0,
    grade: out.grade || '—',
    category: out.category || '—',
    observations: Array.isArray(out.observations) ? out.observations : []
  };
}

/* Cheapest possible round-trip, to tell a bad key from a bad page. */
export async function checkKey(cfg, signal) {
  await call(cfg, 'Reply with the single word OK.', [{ text: 'ping' }], signal);
  return true;
}
