/* ==========================================================================
   audit.js — read pages, then consolidate into observations.
   Provider-agnostic: the wire format lives in providers.js.
   ========================================================================== */

import { PROVIDERS } from './providers.js?v=4';

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

const READ_SYS = `You are a chartered accountant performing an Axis Bank Nakshatra agency audit.
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

/* cfg = { provider, key, model, effort } */
async function call(cfg, system, content, signal) {
  const P = PROVIDERS[cfg.provider];
  if (!P) throw new Error('unknown provider: ' + cfg.provider);

  const req = P.build(cfg.key, cfg.model, cfg.effort, system, content);

  let res;
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal
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

  if (!res.ok) {
    let detail = '';
    try { detail = P.errorOf(await res.json()); } catch { /* non-JSON body */ }
    const err = new Error(`HTTP ${res.status}${detail ? ' — ' + detail : ''}`);

    /* No amount of retrying fixes an empty wallet, a bad key or a blocked
       account — these end the run instead of failing page after page.
       Rate limits and server blips stay retryable. */
    err.fatal = res.status === 401 || res.status === 403 ||
                (res.status === 400 &&
                 /credit balance|billing|quota|api key not valid|invalid.*api.?key/i.test(detail));
    err.status = res.status;
    throw err;
  }

  return P.read(await res.json());
}

/* Models sometimes wrap JSON in a fence or add a stray sentence. Dig it out. */
function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('no JSON in reply');
  return JSON.parse(raw.slice(s, e + 1));
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

  const text = await call(cfg, READ_SYS, content, signal);

  const out = parseJson(text);
  return (out.pages || []).map(p => ({
    label: batch[(p.page || 1) - 1]?.label || batch[0]?.label || '?',
    doc: p.doc || '',
    issues: Array.isArray(p.issues) ? p.issues : []
  }));
}

/* --------------------------------------------------------------------------
   Consolidate every page finding into the final observation list.
   -------------------------------------------------------------------------- */
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
