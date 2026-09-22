/* ==========================================================================
   import.js — read a finished Query Sheet and turn it into worked examples
   --------------------------------------------------------------------------
   Every sheet in the workbook is one agency, laid out the same way: a sign-off
   header, then a "Main Category | Observation" table. Only the observation
   rows are taken — the header is the agency's own details and has no business
   being kept as an example.
   ========================================================================== */

import { learn, canonCat } from './corpus.js?v=36';

/* SheetJS ships only a UMD build on the allowed CDN, so it is pulled in as a
   classic script the first time an import is attempted rather than at load. */
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxReady = null;

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxReady) return xlsxReady;
  xlsxReady = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => window.XLSX ? ok(window.XLSX) : fail(new Error('spreadsheet reader did not load'));
    s.onerror = () => fail(new Error('could not reach the spreadsheet reader — check the connection'));
    document.head.appendChild(s);
  });
  return xlsxReady;
}

/* Names, IDs and account numbers are stripped before anything is stored. The
   model needs the shape of the sentence; keeping the people would put client
   data in the browser's storage for no gain. */
function redact(s) {
  return String(s)
    .replace(/\(\s*(?:i\.e\.?\s*)?(CM Name|Executive Name|CM name|Name)\s*[-:]*\s*[^)]*(\)|$)/gi,
             '($1 -:<name>)')
    .replace(/\(?\s*(?:LAN|Lan) No\.?\s*[-:]*\s*[A-Z0-9]{6,}\)?/g, '(LAN No. -:<lan>)')
    .replace(/(Barcode No\s*:?\s*)NM\d+/gi, '$1<barcode>')
    .replace(/\b[A-Z]{4,}[A-Z0-9]*\d[A-Z0-9]*\b/g, '<id>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* Pull the observation rows out of one worksheet. */
function rowsFrom(XLSX, ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });

  /* the table starts on the row after the "Main Category" header */
  let start = grid.findIndex(r =>
    String(r[0] || '').trim().toLowerCase() === 'main category');
  if (start === -1) return [];
  start += 1;

  const out = [];
  for (let i = start; i < grid.length; i++) {
    const cat = String(grid[i][0] || '').trim();
    const obs = String(grid[i][1] || '').trim();
    if (!cat || !obs) continue;
    if (obs.length < 15) continue;                 // stray notes, not observations
    out.push({ cat: canonCat(cat), obs: redact(obs) });
  }
  return out;
}

export async function importWorkbook(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const rows = [];
  const perSheet = [];
  for (const name of wb.SheetNames) {
    const got = rowsFrom(XLSX, wb.Sheets[name]);
    if (got.length) perSheet.push({ name, count: got.length });
    rows.push(...got);
  }

  if (!rows.length) {
    throw new Error('no "Main Category / Observation" table found in that workbook');
  }

  const { added, total } = learn(rows);
  return { sheets: perSheet, found: rows.length, added, total };
}
