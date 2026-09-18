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
      yield await imageToJpeg(file);
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
        yield await pdfPageToJpeg(doc, i, file.name);
      } catch (e) {
        yield { label: `${file.name} p${i}`, error: e.message };
      }
    }
    doc.destroy();
  }
}

async function pdfPageToJpeg(doc, pageNo, fileName) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_EDGE / Math.max(base.width, base.height), 3);
  const vp = page.getViewport({ scale });

  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width);
  cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);

  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();

  return finish(cv, `${fileName} p${pageNo}`);
}

async function imageToJpeg(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(MAX_EDGE / Math.max(bmp.width, bmp.height), 1);
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  return finish(cv, file.name);
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

/* A full page at max edge is ~2.4k tokens; use that to price a folder. */
export function estimateCost(pageCount, model) {
  const perPage = imageTokens(MAX_EDGE, Math.round(MAX_EDGE * 0.75));
  const inTok = pageCount * (perPage + 120);       // + prompt overhead
  const outTok = pageCount * 170;                  // findings written back
  const rate = model === 'claude-sonnet-5'
    ? { in: 2 / 1e6, out: 10 / 1e6 }
    : { in: 5 / 1e6, out: 25 / 1e6 };
  return inTok * rate.in + outTok * rate.out;
}
