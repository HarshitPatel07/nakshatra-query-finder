/* ==========================================================================
   export.js — write the Query Sheet workbook
   --------------------------------------------------------------------------
   One worksheet per agency, laid out exactly as the firm's own sheets are:

     row 1      Agency Visit Sign Off          (merged across A:B)
     rows 2-14  the sign-off details, label in column A, value in column B
     row 15     blank
     row 16     Audit Observation              (merged across A:B)
     row 17     Main Category | Observation
     row 18+    one row per query, with the status column left blank

   The status column is deliberately empty: it records what the agency said
   when the sheet came back, which is not something this tool can know.
   ========================================================================== */

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxReady = null;

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxReady) return xlsxReady;
  xlsxReady = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => window.XLSX ? ok(window.XLSX) : fail(new Error('spreadsheet writer did not load'));
    s.onerror = () => fail(new Error('could not reach the spreadsheet writer'));
    document.head.appendChild(s);
  });
  return xlsxReady;
}

/* The sign-off block, in the order the sheets use. */
const HEADER_ROWS = [
  ['Date', 'date'],
  ['Name of the agency', 'agency'],
  ['Address of the agency and location', 'address'],
  ['Full name of the person who is signing', 'signedBy'],
  ['Designation in the agency', 'designation'],
  ['Signature and stamp', 'stamp'],
  ['Auditor full name', 'auditor'],
  ['Signature', 'auditorSign'],
  ['Auditor Employee No.', 'auditorNo'],
  ['Collection Manager Name', 'cmNames'],
  ['Collection Manager ID', 'cmIds'],
  ['Nakshatra Barcode Number', 'barcode'],
  ['Signature', 'cmSign']
];

/* Excel caps a sheet name at 31 characters and forbids : \ / ? * [ ] */
function sheetName(name, taken) {
  let base = String(name || 'Agency').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Agency';
  let out = base, n = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${n++})`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(out.toLowerCase());
  return out;
}

function sheetFor(XLSX, result) {
  const h = result.header || {};
  const rows = [];

  rows.push(['Agency Visit Sign Off', '']);
  for (const [label, key] of HEADER_ROWS) {
    rows.push([label, key === 'agency' ? (h.agency || result.agency) : (h[key] || '')]);
  }
  rows.push(['', '']);
  rows.push(['Audit Observation', '']);
  rows.push(['Main Category', 'Observation']);

  /* grouped by category, the way the sheets read */
  const byCat = new Map();
  for (const o of result.observations || []) {
    const c = o.category || 'Process Management';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(o);
  }
  for (const [cat, list] of byCat) {
    for (const o of list) rows.push([cat, o.text, '']);
  }
  if (!result.observations?.length) rows.push(['', 'Nil', '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  /* the two banner rows span both columns, as in the originals */
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 15, c: 0 }, e: { r: 15, c: 1 } }
  ];
  ws['!cols'] = [{ wch: 38 }, { wch: 110 }, { wch: 18 }];

  /* observations wrap rather than run off the page */
  const firstObs = 18;
  for (let r = firstObs; r <= rows.length; r++) {
    const cell = ws['B' + r];
    if (cell) cell.s = { alignment: { wrapText: true, vertical: 'top' } };
  }
  return ws;
}

export async function writeWorkbook(results, filename) {
  if (!results?.length) throw new Error('nothing to export yet');
  const XLSX = await loadXLSX();

  const wb = XLSX.utils.book_new();
  const taken = new Set();
  for (const r of results) {
    XLSX.utils.book_append_sheet(wb, sheetFor(XLSX, r), sheetName(r.agency, taken));
  }

  XLSX.writeFile(wb, filename || 'Query sheet.xlsx');
  return { sheets: results.length };
}
