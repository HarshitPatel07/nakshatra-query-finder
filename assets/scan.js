/* ==========================================================================
   scan.js — turn a picked folder into agency groups, and any page into a JPEG
   ========================================================================== */

import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs';

/* Anthropic downsizes anything past 1568px on the long edge, so that is the
   most detail we can pay for. Handwriting needs every pixel of it. */
export const MAX_EDGE = 1568;
export const JPEG_Q   = 0.82;

const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const PDF_RE = /\.pdf$/i;
const SKIP_RE = /(^|\/)(\.|~\$|Thumbs\.db|desktop\.ini)/i;

/* --------------------------------------------------------------------------
   Group the picked FileList into agencies.

   webkitRelativePath looks like  "Nakshtra/ABA Nakshatra/visit.pdf".
   The first segment is whatever folder they picked, so the agency is segment 2
   when there is one, and the picked folder itself when files sit at the root.
   -------------------------------------------------------------------------- */
export function groupByAgency(fileList) {
  const files = Array.from(fileList).filter(f => {
    const p = f.webkitRelativePath || f.name;
    if (SKIP_RE.test(p)) return false;
    return IMG_RE.test(f.name) || PDF_RE.test(f.name);
  });

  const map = new Map();

  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    const agency = parts.length > 2 ? parts[1] : (parts[0] || 'Selected folder');
    if (!map.has(agency)) map.set(agency, { name: agency, files: [], pages: 0 });
    map.get(agency).files.push(f);
  }

  return [...map.values()]
    .filter(a => a.files.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* Page count per agency — PDFs need opening, images are one page each. */
export async function countPages(agency) {
  let n = 0;
  for (const f of agency.files) {
    if (IMG_RE.test(f.name)) { n += 1; continue; }
    try {
      const doc = await openPdf(f);
      n += doc.numPages;
      doc.destroy();
    } catch {
      n += 1;                       // unreadable PDF still costs us one look
    }
  }
  agency.pages = n;
  return n;
}

async function openPdf(file) {
  const buf = await file.arrayBuffer();
  return pdfjs.getDocument({ data: buf, disableAutoFetch: true, disableStream: true }).promise;
}

/* --------------------------------------------------------------------------
   Yield every page of an agency as { label, dataUrl, bytes, w, h }.
   Async generator so the caller can stream pages into batches without ever
   holding a whole 50 MB PDF's worth of bitmaps in memory.
   -------------------------------------------------------------------------- */
export async function* pages(agency, { signal } = {}) {
  for (const file of agency.files) {
    if (signal?.aborted) return;

    if (IMG_RE.test(file.name)) {
      for (const part of await imageToJpeg(file)) yield part;
      continue;
    }

    let doc;
    try {
      doc = await openPdf(file);
    } catch (e) {
      yield { label: file.name, error: 'could not open: ' + e.message };
      continue;
    }

    for (let i = 1; i <= doc.numPages; i++) {
      if (signal?.aborted) { doc.destroy(); return; }
      try {
        for (const part of await pdfPageToJpeg(doc, i, file.name)) yield part;
      } catch (e) {
        yield { label: `${file.name} p${i}`, error: e.message };
      }
    }
    doc.destroy();
  }
}

/* --------------------------------------------------------------------------
   Why a page is cut into bands.

   A register page is 20-30 rows. Shrunk to fit 1568px on the long edge, each
   row is about 50 pixels tall — enough to see that a cell is blank, not enough
   to read the handwritten name on that row. The result was queries with the
   right document and the right field against the wrong person.

   So a tall page is rendered at full detail and cut into overlapping
   horizontal bands, each sent as its own image. Every row then arrives two to
   three times larger. The overlap means a row split by a cut still appears
   whole in the neighbouring band.
   -------------------------------------------------------------------------- */
const TILE_OVERLAP = 0.07;     // share of a tile repeated in its neighbour

/* --------------------------------------------------------------------------
   Providers downscale anything past MAX_EDGE on its LONG edge, so cutting a
   4096px-wide page into horizontal bands achieves nothing — each band is still
   4096 wide and gets crushed back down exactly as before.

   To actually keep the detail, every tile has to fit under the cap in BOTH
   directions. A 4096x3072 page therefore becomes a 3x2 grid of ~1400x1600
   tiles, each arriving at full native resolution. Rows go from about 50 pixels
   tall to about 200, which is the difference between seeing that a cell is
   blank and reading the name on that row.

   It costs one request's worth of image per tile, so it is reserved for the
   Maximum care level rather than being on by default.
   -------------------------------------------------------------------------- */
export let TILING = false;
export function setTiling(on) { TILING = !!on; }

function gridFor(w, h) {
  if (!TILING) return { cols: 1, rows: 1 };
  const cols = Math.max(1, Math.ceil(w / MAX_EDGE));
  const rows = Math.max(1, Math.ceil(h / MAX_EDGE));
  /* nine tiles for one page is past the point of usefulness */
  return (cols * rows > 6) ? { cols: Math.min(cols, 3), rows: Math.min(rows, 2) }
                           : { cols, rows };
}

async function pdfPageToJpeg(doc, pageNo, fileName) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });

  const g = gridFor(base.width, base.height);
  /* render big enough that each tile lands near the cap at native detail */
  const span = Math.max(g.cols, g.rows);
  const scale = Math.min((MAX_EDGE * span) / Math.max(base.width, base.height), 3);
  const vp = page.getViewport({ scale });

  const full = document.createElement('canvas');
  full.width = Math.round(vp.width);
  full.height = Math.round(vp.height);
  const ctx = full.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, full.width, full.height);

  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();

  const label = `${fileName} p${pageNo}`;
  return sliceIntoTiles(full, label);
}

function sliceIntoTiles(full, label) {
  const { cols, rows } = gridFor(full.width, full.height);
  if (cols * rows <= 1) return [finish(full, label)];

  const tw = full.width / cols, th = full.height / rows;
  const ox = tw * TILE_OVERLAP, oy = th * TILE_OVERLAP;
  const out = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, Math.round(c * tw - (c ? ox : 0)));
      const y0 = Math.max(0, Math.round(r * th - (r ? oy : 0)));
      const x1 = Math.min(full.width, Math.round((c + 1) * tw + (c < cols - 1 ? ox : 0)));
      const y1 = Math.min(full.height, Math.round((r + 1) * th + (r < rows - 1 ? oy : 0)));

      const cv = document.createElement('canvas');
      cv.width = x1 - x0;
      cv.height = y1 - y0;
      cv.getContext('2d', { alpha: false })
        .drawImage(full, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);

      const part = rows > 1 && cols > 1 ? `r${r + 1}c${c + 1}`
                 : rows > 1 ? `${r + 1}/${rows}` : `${c + 1}/${cols}`;
      out.push(finish(cv, `${label} [${part}]`));
    }
  }
  return out;
}

async function imageToJpeg(file) {
  const bmp = await createImageBitmap(file);
  const g = gridFor(bmp.width, bmp.height);
  const span = Math.max(g.cols, g.rows);
  const scale = Math.min((MAX_EDGE * span) / Math.max(bmp.width, bmp.height), 1);

  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();

  return sliceIntoTiles(cv, file.name);
}

function finish(canvas, label) {
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_Q);
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return {
    label,
    b64,
    w: canvas.width,
    h: canvas.height,
    bytes: Math.round(b64.length * 0.75)
  };
}

/* Anthropic bills vision at roughly (w x h) / 750 tokens. */
export function imageTokens(w, h) { return Math.ceil((w * h) / 750); }

/* Costing lives in providers.js, where the per-model rates are. */
