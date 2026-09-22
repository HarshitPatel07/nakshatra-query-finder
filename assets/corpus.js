/* ==========================================================================
   corpus.js — the firm's own past queries, used as worked examples
   --------------------------------------------------------------------------
   Seeded from the real Query Sheet (6 agencies, 78 observations). The model is
   shown the closest of these before it writes anything, so its wording, its
   categories and its level of detail come from work that was actually signed
   off rather than from my guess at house style.

   Every corrected sheet imported later is added to this, in localStorage, so
   the examples get closer to your own phrasing the more the tool is used.
   ========================================================================== */

/* The only categories allowed in output. */
export const CATEGORIES = [
  "Code Of Conduct",
  "Data Security",
  "Employee Background Verification",
  "Legal compliance & Infrastructure",
  "Manpower Register Verifications",
  "Monthly Compliance Verifications",
  "No Dues Letter Verification",
  "Process Management",
  "Product Declaration Verifications",
  "Repo Register Verification",
  "System Application Verification",
  "Visitor Register Verifications",
];

/* Spellings seen in the sheets that mean an existing category. */
export const CATEGORY_ALIASES = {
  'manpower': 'Manpower Register Verifications',
  'legal compliance & infrastructure:': 'Legal compliance & Infrastructure'
};

/* --------------------------------------------------------------------------
   The documents these queries are actually about, with the field names seen
   blank on each. This is what the model is told to go looking for — it is the
   difference between "the register is incomplete" and a usable query.
   -------------------------------------------------------------------------- */
export const DOCUMENTS = [
  { name: 'Manpower register', cat: 'Manpower Register Verifications',
    fields: ['Executive Sign', 'Executive Signature', 'Executive Axis ID', 'Executive Gatigo ID',
             'Gatigo TP Id of FOS', 'Axis ID of FOS', 'Date of Resignation',
             'Executive issuance date & Expiry Date', 'ID card number of Executive',
             'CM Sign', 'CM Name'], who: 'Executive Name' },

  { name: 'Declaration cum undertaking page', cat: 'Code Of Conduct',
    fields: ['Agency VEM ID', 'Agency Contact No', 'Agency Person Contact no.',
             'CM Details', 'CM Sign'], who: 'CM Name' },

  { name: 'Product Declaration page', cat: 'Product Declaration Verifications',
    fields: ['CM Sign', 'Agency Authorised Sign', 'Count of Case Allocated'],
    who: 'CM Name', monthly: true },

  { name: 'No Dues and Data Purging Declaration', cat: 'No Dues Letter Verification',
    fields: ['CM Details', 'CM Sign & Date', 'Data Purging month', 'Data of agency'],
    who: 'CM Name', monthly: true },

  { name: 'Monthly Compliance Declaration', cat: 'Monthly Compliance Verifications',
    fields: ['CM Details', 'CM Sign & Date', 'CM ID'], who: 'CM Name', monthly: true },

  { name: 'Visiting register page', cat: 'Visitor Register Verifications',
    fields: ['CM In time'], who: 'CM Name' },

  { name: 'Repo kit Tracker', cat: 'Repo Register Verification',
    fields: ['Repo Details', 'Repo return Date', 'Unused Date, CM ID & Sign'], who: 'LAN No.' },

  { name: 'Assets Management Declaration', cat: 'Data Security',
    fields: ['ID card number of Executive'], who: 'Executive Name' },

  { name: 'Telephone line Declaration', cat: 'System Application Verification',
    fields: ['Username & Executive Category'], who: null },

  { name: 'Agency Training Tracker', cat: 'Process Management',
    fields: ['Agency Sign'], who: null },

  { name: 'Vendor Declaration', cat: 'Employee Background Verification',
    fields: ['Bank Stamp'], who: null },

  { name: 'Audit Score Card', cat: 'Process Management',
    fields: ['Audit Justification'], who: null },

  { name: 'Agency Key personal Information', cat: 'Process Management',
    fields: ['Agency VEM ID'], who: null }
];

/* Queries that are not about a blank cell — each has its own fixed wording. */
export const STANDING_CHECKS = [
  { cat: 'Visitor Register Verifications',
    when: 'a Collection Manager has no visit entry in a month of the audit period',
    say: "CM was not visited in the agency one time in the each month for the month of <MONTHS>.(CM Name -:<NAMES>)" },
  { cat: 'Visitor Register Verifications',
    when: 'a Collection Manager never visited at all during the audit period',
    say: "CM was not visited in the agency for the audit period. (CM Name -:<NAMES>)" },
  { cat: 'Data Security',
    when: 'the manual says data was purged to a month but later data is still live',
    say: "As per Nakshatra Manual data was purged till <MONTH> but <MONTHS> data was available in Axis Bank system at the time of audit." },
  { cat: 'Process Management',
    when: 'a manual was surrendered but the surrender letter is absent',
    say: "Nakshatra Manual was surrender to the Bank but Surrender letter was not available at the time of Audit. (Barcode No : <BARCODE>)" }
];

/* --------------------------------------------------------------------------
   The exact sentence stem each document takes, counted from the real sheets.
   These are not interchangeable: "Manpower register was not PROPERLY FILLED UP
   in THE Nakshatra Manual" but "No Dues ... was not FILLED UP PROPERLY in
   Nakshatra Manual" — word order and the article both vary by document, and
   copying one onto another is exactly the drift that makes output look wrong.
   -------------------------------------------------------------------------- */
export const STEMS = {
  'Manpower register':                    'was not properly filled up in the Nakshatra Manual',
  'Declaration cum undertaking page':     'was not properly filled up in the Nakshatra Manual',
  'Vendor Declaration':                   'was not properly filled up in the Nakshatra Manual',
  'No Dues and Data Purging Declaration': 'was not filled up properly in Nakshatra Manual',
  'Repo kit Tracker':                     'was not filled up properly in Nakshatra Manual',
  'Audit Score Card':                     'was not filled up properly in Nakshatra Manual',
  'Monthly Compliance Declaration':       'was not filled up properly in the Nakshatra Manual',
  'Product Declaration page':             'was not filled up properly in the Nakshatra Manual',
  'Telephone line Declaration':           'was not filled up properly in the Nakshatra Manual',
  'Visiting register page':               'was not filled up properly in the Nakshatra Manual',
  'Agency Training Tracker':              'was not filled up properly in the Nakshatra Manual',
  'Assets Management Declaration':        'was wrongly filled up in the Nakshatra Manual',
  'Agency Key personal Information':      'was wrongly filled up in Nakshatra Manual'
};

/* Used when the defect is a wrong value rather than a blank one. */
export const WRONG_STEMS = {
  'Agency Key personal Information': 'was wrongly filled up in Nakshatra Manual'
};

export const DEFAULT_STEM = 'was not filled up properly in the Nakshatra Manual';

/* Months are always written this way: Apr'26, May'26 & Jun'26 / Apr'26 to Jun'26 */
export const MONTH_STYLE = "Apr'26, May'26, Jun'26 — joined with ' & ' for two, or 'to' for a run";

/* --------------------------------------------------------------------------
   The learned layer. Seed examples ship with the app; anything imported from a
   corrected sheet is kept in localStorage and ranks ahead of the seed, because
   it is this firm's most recent signed-off wording.
   -------------------------------------------------------------------------- */
const LEARNED_KEY = 'nq.learned';

export function loadLearned() {
  try { return JSON.parse(localStorage.getItem(LEARNED_KEY) || '[]'); } catch { return []; }
}

export function saveLearned(list) {
  try { localStorage.setItem(LEARNED_KEY, JSON.stringify(list.slice(-800))); return true; }
  catch { return false; }
}

/* Merge in rows from an imported sheet, ignoring ones already held. */
export function learn(newRows) {
  const held = loadLearned();
  const seen = new Set(held.concat(SEED_EXAMPLES).map(e => norm(e.obs)));
  const added = [];
  for (const r of newRows) {
    if (!r.obs || !r.cat) continue;
    const k = norm(r.obs);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push({ cat: canonCat(r.cat), obs: r.obs.trim() });
  }
  if (added.length) saveLearned(held.concat(added));
  return { added: added.length, total: held.length + added.length };
}

export function forgetLearned() {
  try { localStorage.removeItem(LEARNED_KEY); } catch {}
  try { localStorage.removeItem(FIELDS_KEY); } catch {}
}

/* --------------------------------------------------------------------------
   What to LOOK FOR, learned from the same sheets.
   --------------------------------------------------------------------------
   The examples above teach wording, and wording was never the problem: the
   sheets came back phrased correctly and half empty. What a corrected sheet
   also contains, and what was being thrown away, is the firm's own answer to
   "which fields on this document actually get queried" — the Focus sheet says
   the Manpower register is queried for Executive Signature, CM Sign and Date
   of Resignation, because a real auditor raised all three.

   That is a checklist written by the people who do this work, and every sheet
   imported makes it longer. It also discovers documents nobody hard-coded:
   a query about a page not in DOCUMENTS adds the page.
   -------------------------------------------------------------------------- */
const FIELDS_KEY = 'nq.fields';

export function loadFields() {
  try { return JSON.parse(localStorage.getItem(FIELDS_KEY) || '{}'); } catch { return {}; }
}

/* "Manpower register was not properly filled up … (i.e. CM Sign, Author Sign)"
   -> document "Manpower register", fields ["CM Sign", "Author Sign"] */
function partsOf(obs) {
  const s = String(obs || '').trim();

  /* the document is whatever stands before the verb that starts every stem */
  const m = /^(.*?)\s+(?:was|were|is|are|has|have|not)\b/i.exec(s);
  const doc = m ? m[1].trim().replace(/\s+/g, ' ') : '';
  if (!doc || doc.length < 4 || doc.length > 70) return null;

  const f = /\(\s*i\.?e\.?\s*:?\s*([^)]*)\)/i.exec(s);
  const fields = f
    ? f[1].split(/\s*(?:,|&|\band\b)\s*/).map(x => x.trim()).filter(x => x.length > 1 && x.length < 60)
    : [];

  return { doc, fields };
}

/* Sheets are typed by hand across years and offices, so the same field arrives
   as "CM Detail", "CM Details", "Cm Details". Asking about all three wastes the
   model's attention on one field three times, which is the opposite of what
   the checklist is for. Case, spacing, punctuation and a trailing plural are
   all ignored when deciding whether a field is already on the list. */
function fieldKey(f) {
  return String(f).toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

export function learnFields(rows) {
  const held = loadFields();
  let addedDocs = 0, addedFields = 0;

  for (const r of rows) {
    const p = partsOf(r.obs);
    if (!p || !p.fields.length) continue;
    const key = p.doc.toLowerCase();
    if (!held[key]) { held[key] = { name: p.doc, cat: canonCat(r.cat), fields: {} }; addedDocs++; }
    for (const f of p.fields) {
      /* count against the normalised form, but keep the spelling the firm
         actually used, so the checklist reads the way the sheets read */
      const fk = fieldKey(f);
      if (!fk) continue;
      const already = Object.keys(held[key].fields).find(x => fieldKey(x) === fk);
      if (already) { held[key].fields[already]++; continue; }
      held[key].fields[f] = 1;
      addedFields++;
    }
  }

  try { localStorage.setItem(FIELDS_KEY, JSON.stringify(held)); } catch {}
  return { addedDocs, addedFields };
}

/* The shipped documents, each with the learned fields folded in, plus any
   document the firm queries that was never hard-coded. Ordered so the fields
   raised most often on real audits are asked about first. */
export function documentsToCheck() {
  const learned = loadFields();
  const out = DOCUMENTS.map(d => ({ ...d, fields: d.fields.slice() }));
  const byKey = new Map(out.map(d => [d.name.toLowerCase(), d]));

  for (const [key, rec] of Object.entries(learned)) {
    const counts = rec.fields || {};
    const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    let doc = byKey.get(key);
    if (!doc) {
      /* a page the firm queries that nobody listed — worth asking about */
      doc = { name: rec.name, cat: canonCat(rec.cat) || 'Process Management',
              fields: [], who: null, learnt: true };
      out.push(doc);
      byKey.set(key, doc);
    }
    const have = new Set(doc.fields.map(fieldKey));
    for (const f of ranked) {
      const fk = fieldKey(f);
      if (have.has(fk)) continue;
      have.add(fk);
      doc.fields.push(f);
    }
  }
  return out;
}

function norm(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

export function canonCat(c) {
  const k = String(c || '').trim();
  return CATEGORY_ALIASES[k.toLowerCase()] || k;
}

/* --------------------------------------------------------------------------
   Pick the examples to put in front of the model. Learned rows first, then
   seed, favouring variety of category so one noisy document cannot crowd the
   others out.
   -------------------------------------------------------------------------- */
export function pickExamples(limit = 24) {
  const pool = loadLearned().concat(SEED_EXAMPLES);
  const byCat = new Map();
  for (const e of pool) {
    const c = canonCat(e.cat);
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(e);
  }
  const out = [];
  let round = 0;
  while (out.length < limit) {
    let took = 0;
    for (const list of byCat.values()) {
      if (list[round]) { out.push({ cat: canonCat(list[round].cat), obs: list[round].obs }); took++; }
      if (out.length >= limit) break;
    }
    if (!took) break;
    round++;
  }
  return out;
}

/* Worked examples, seeded from signed-off sheets.
   Names, LAN numbers, VEM IDs and barcodes are replaced with placeholders —
   the model needs the shape of the sentence, never the actual person. */
export const SEED_EXAMPLES = [
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (All Executive Sign)" },
  { cat: "Code Of Conduct",
    obs: "Declaration cum undertaking page was not properly filled up in the Nakshatra Manual. (i.e. Agency Contact No)" },
  { cat: "Product Declaration Verifications",
    obs: "Alteration and cutting done on the Agency Product Declaration page in Nakshatra mannual." },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e Executive issuance date & Expiry Date)(Executive Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e Executive Gatigo ID)(Executive Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (CM Name -:<name>)(CM Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e Executive Axis ID)(Executive Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e Executive Sign)(Executive Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of May'26 & June'26 (CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency for the audit period. (CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of April'26 to June'26. (i.e. Data Purging month)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of June'26. (i.e. CM Details)(CM Name -:<name>)" },
  { cat: "Repo Register Verification",
    obs: "Repo kit Tracker was not filled up properly in Nakshatra Manual. (i.e. Repo Details)(LAN No. -:<lan>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of April'26 to June'26. (i.e. CM Details)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Assets Management Declaration was wrongly filled up in the Nakshatra Manual. (i.e. 'Asset Permanently Disposed' column was marked as 'Yes', but the system was not actually purged.)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e. Executive Signature)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e. CM Sign) (CM Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e. Date of Resignation) (Executive Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Declaration cum undertaking page was wrongly filled up in the Nakshatra Manual. (i.e. Agency VEM ID) (<VEM ID>)" },
  { cat: "Process Management",
    obs: "Agency Key personal Information was wrongly filled up in Nakshatra Manual. (i.e. Agency VEM ID) (<VEM ID>)" },
  { cat: "Process Management",
    obs: "Product Declaration page was not filled up properly in the Nakshatra Manual for the month of Apr'26 & May'26. (i.e. Count of Case Allocated, Agency Authorised Sign) (CM Name -:<name>)" },
  { cat: "Process Management",
    obs: "Product Declaration page was not filled up properly in the Nakshatra Manual for the month of Jun'26. (i.e. CM Sign, Agency Authorised Sign) (CM Name -:<name>)" },
  { cat: "Process Management",
    obs: "Nakshatra Manual was surrender to the Bank but Surrender letter was not available at the time of Audit. (Barcode No : <barcode>)" },
  { cat: "Process Management",
    obs: "Audit Score Card was not filled up properly in Nakshatra Manual. (i.e. Audit Justification)" },
  { cat: "Data Security",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of May'26 & Jun'26. (i.e. CM Detail) (CM Name -:<name>)" },
  { cat: "Data Security",
    obs: "As per Nakshatra Manual data was purged till May'26 but May'26 data was available in Axis Bank system at the time of audit." },
  { cat: "Legal compliance & Infrastructure",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of Jun'26. (i.e. CM Details) (CM Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Declaration cum undertaking page was not properly filled up in the Nakshatra Manual. (i.e. Agency Person Contact no.)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e.Cm Sign,Author Sign) (CM Name -:<name>)" },
  { cat: "Product Declaration Verifications",
    obs: "Product Declaration page was not filled up properly in the Nakshatra Manual for the month of May'26 & June'26. (i.e. CM Sign)(CM Name -:<name>)" },
  { cat: "Product Declaration Verifications",
    obs: "Product Declaration page was not filled up properly in the Nakshatra Manual for the month of June'26. (i.e. CM Sign)(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one times in the each month for the month of April'26 & June'26. (CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one times in the each month for the month of June'26. (CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues And Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of April'26, May'26 & June'26. (i.e Data of agency )" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues And Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of April'26 & May'26. (i.e Cm Details)(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues And Data Purging Declaration was not filled up in Nakshatra Manual for the month of June'26." },
  { cat: "System Application Verification",
    obs: "Network Sharing was found in the system used for Axis Bank at the time of audit.(Name -:<name>), Axis Bank (Y:)" },
  { cat: "Legal compliance & Infrastructure",
    obs: "During the audit CA attested declaration for non-applicability of ESIC and EPF statutory compliances has not been provided." },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly compliance declaration for the month of April'26 is not updated with in TAT of 5th." },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up in the Nakshatra Manual for the month of May'26 & June'26." },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e. Axis ID of FOS)" },
  { cat: "Code Of Conduct",
    obs: "Declaration cum undertaking page was not properly filled up in the Nakshatra Manual. (i.e. CM Details)(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of Apr'26.(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of Apr'26 & May'26.(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of June'26.(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of May'26.(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of Apr'26 & June'26.(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "As per Nakshatra Manual data was purged till June'26 but Jan'26, Feb'26 & Mar'26 data was available in Axis Bank system at the time of audit. (<system id>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of Apr'26. (i.e. CM Details)(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of May'26 & June'26. (i.e. CM Details)(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of Apr'26 & May'26. (i.e. CM Details)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was wrongly filled up in the Nakshatra Manual.(I.e. CM ID)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of June'26.(I.e. CM Details)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of May'26.(I.e. CM Details)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of May'26 & June'26.(I.e. CM Details)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of Apr'26.(I.e. CM Details)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Telephone line Declaration was not filled up properly in the Nakshatra Manual. (i.e. Username & Executive Category)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Allteration was done in the Asset Management Declaration Page in the Nakshatra Manual." },
  { cat: "Employee Background Verification",
    obs: "Vendor Declaration was not properly filled up in the Nakshatra Manual.(i.e. Bank Stamp)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual.(i.e. CM Sign)(CM Name -:<name>)" },
  { cat: "Manpower Register Verifications",
    obs: "Manpower register was not properly filled up in the Nakshatra Manual. (i.e. Gatigo TP Id of FOS)(All)" },
  { cat: "Code Of Conduct",
    obs: "Declaration cum undertaking page was not properly filled up in the Nakshatra Manual. (i.e. CM Sign)(CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "Visiting register page was not filled up properly in the Nakshatra Manual. (i.e.CM In time) (CM Name -:<name>)" },
  { cat: "Visitor Register Verifications",
    obs: "CM was not visited in the agency one time in the each month for the month of May'26 & June'26.(CM Name -:<name>)" },
  { cat: "Product Declaration Verifications",
    obs: "Product Declaration page was not filled up properly in the Nakshatra Manual for the month of Apr'26 to Jun'26 (CM Sign)(CM Name -:<name>)" },
  { cat: "Product Declaration Verifications",
    obs: "Product Declaration page was not filled up properly in the Nakshatra Manual for the month of May'26 & Jun'26 (CM Sign)(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of May'26 & Jun'26. (i.e. CM Sign & Date)(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of Apr'26 to Jun'26. (i.e. CM Sign & Date)(CM Name -:<name>)" },
  { cat: "No Dues Letter Verification",
    obs: "No Dues and Data Purging Declaration was not filled up properly in Nakshatra Manual for the month of Apr'26 (i.e. CM Sign & Date)(CM Name -:<name>)" },
  { cat: "Repo Register Verification",
    obs: "Repo kit Tracker was wrongly filled up in Nakshatra Manual. (i.e. Repo return Date)(LAN No. -:<lan>)" },
  { cat: "Repo Register Verification",
    obs: "Repo kit Tracker was not filled up properly in Nakshatra Manual. (i.e. Unused Date, CM ID & Sign)(LAN No. -:<lan>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of Apr'26 to Jun'26 (i.e. CM Sign & Date)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Monthly Compliance Declaration was not filled up properly in the Nakshatra Manual for the month of May'26 & Jun'26. (i.e. CM Sign & Date)(CM Name -:<name>)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Assets Management Declaration was not filled up properly in the Nakshatra Manual. (i.e. ID card number of Executive)" },
  { cat: "Monthly Compliance Verifications",
    obs: "Agency Training Tracker was not filled up properly in the Nakshatra Manual. (i.e. Agency Sign)" },
];
