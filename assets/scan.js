/* ==========================================================================
   scan.js — turn a picked folder into agency groups, and any page into a JPEG
   ========================================================================== */

import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs';

/* --------------------------------------------------------------------------
   How large a page image is worth sending.

   This was pinned at 1568 for every provider, which is Anthropic's limit —
   anything larger is downscaled at their end. But Gemini takes 3072, so half
   the available detail was being thrown away on the provider actually in use,
   and on these register pages detail is the whole game: the difference between
   seeing a cell is blank and reading whose row it is.
   -------------------------------------------------------------------------- */
const EDGE_BY_PROVIDER = {
  anthropic: 1568,
  gemini: 3072,
  openai: 2048,
  openrouter: 2048      // varies by model underneath; 2048 is safe across them
};

export let MAX_EDGE = 1568;
export function setProvider(id) { MAX_EDGE = EDGE_BY_PROVIDER[id] || 1568; }

export const JPEG_Q = 0.82;

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
  /* An agency folder routinely holds the same evidence twice — MS Chandan has
     45 photographs and a 45-page PDF of those same photographs, so a folder of
     45 pages of evidence was costing 90 pages of quota and producing every
     query twice. Photographs are taken first, because a PDF page is a copy of
     one. */
  const seen = [];

  for (const file of agency.files) {
    if (signal?.aborted) return;

    if (IMG_RE.test(file.name)) {
      for (const part of await imageToJpeg(file, seen)) yield part;
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
        for (const part of await pdfPageToJpeg(doc, i, file.name, seen)) yield part;
      } catch (e) {
        yield { label: `${file.name} p${i}`, error: e.message };
      }
    }
    doc.destroy();
  }
}

/* --------------------------------------------------------------------------
   Is this page one already sent?

   The PDF copy of a photograph is resampled and recompressed, so not a byte of
   it matches while the page is plainly the same. A small normalised greyscale
   reduction catches that, and comparing all four rotations catches a copy that
   was also turned on the way into the PDF.

   The threshold is set from measurement rather than taste. On this evidence two
   photographs of two DIFFERENT register pages sit 0.49 to 0.68 apart — the
   printed form is identical and only the handwriting differs — while the same
   photograph reached through a PDF sits near zero. 0.15 has a wide margin on
   both sides. An earlier attempt at 0.28 on a coarser reduction threw away
   fourteen real pages, which is the worse failure by far: a page not read is a
   query not raised.
   -------------------------------------------------------------------------- */
const FP = 48;
const FP_TOL = 0.15;

function fingerprint(source) {
  const cv = document.createElement('canvas');
  cv.width = FP; cv.height = FP;
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.drawImage(source, 0, 0, FP, FP);

  const px = ctx.getImageData(0, 0, FP, FP).data;
  const grey = new Float32Array(FP * FP);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114);
  }
  let mean = 0;
  for (const v of grey) mean += v;
  mean /= grey.length;
  let sd = 0;
  for (const v of grey) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / grey.length) || 1;
  for (let i = 0; i < grey.length; i++) grey[i] = (grey[i] - mean) / sd;

  return grey;
}

/* the same square read out at each quarter turn */
function rotations(a) {
  const out = [a];
  for (let k = 1; k < 4; k++) {
    const prev = out[k - 1];
    const next = new Float32Array(FP * FP);
    for (let y = 0; y < FP; y++) {
      for (let x = 0; x < FP; x++) next[x * FP + (FP - 1 - y)] = prev[y * FP + x];
    }
    out.push(next);
  }
  return out;
}

/* Called on the WHOLE page, before it is cut into bands. Comparing bands
   instead looks like it would work and does not: a PDF copy at a different
   pixel size bands at different boundaries, so no band lines up with the band
   it is a copy of, and every duplicate gets through. */
function duplicate(source, seen) {
  let fp;
  try { fp = fingerprint(source); } catch { return false; }

  for (const held of seen) {
    for (const turn of held) {
      let diff = 0;
      for (let i = 0; i < fp.length; i++) diff += Math.abs(fp[i] - turn[i]);
      if (diff / fp.length < FP_TOL) return true;
    }
  }
  seen.push(rotations(fp));
  return false;
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

/* --------------------------------------------------------------------------
   NEVER cut a register page vertically.

   A grid of tiles was tried and made things markedly worse: on these pages the
   names sit in a left-hand column and the data spreads right, so a vertical
   cut puts the name and the blank cell in different images. The model then
   reports blanks it cannot attribute and names it has no data for — every
   observation came back without a person on it.

   Horizontal bands keep every row whole, name and all. They buy less detail
   than a grid would, but they buy it without breaking the one association the
   entire task depends on.
   -------------------------------------------------------------------------- */
function gridFor(w, h) {
  if (!TILING) return { cols: 1, rows: 1 };
  const rows = Math.max(1, Math.min(3, Math.round(h / (w / 2.2))));
  return { cols: 1, rows };
}

/* --------------------------------------------------------------------------
   Straightening pages photographed sideways.

   The Nakshatra Manual is a landscape-bound book, so every page in it is
   wider than it is tall. Roughly one page in five comes back portrait, which
   means the auditor turned the phone rather than the book — nine of Jayguru's
   forty-nine, including the Manpower Register, which is where five of that
   agency's twelve queries live. A model reading a table on its side can tell a
   cell is empty but loses which row it belongs to, and that is exactly the
   failure the output showed.

   These photographs turn the same way, so a portrait page is rotated a quarter
   turn anticlockwise. There is no EXIF orientation to read — it was checked,
   and none of the pages carry one.

   THIS ONLY CATCHES HALF THE PROBLEM, and the half it misses is the expensive
   one. It tests the shape of the PHOTOGRAPH, and a sideways page is very often
   inside a photograph that is still landscape: the MS Chandan pages are
   1808x1769, so height is less than width, so not one of them was ever turned —
   and roughly half of that folder is sideways. That agency produced 0 of its 14
   queries that name a person.

   Shape cannot settle it and neither can pixel statistics: comparing how
   abruptly ink changes along each axis was measured against twelve pages of
   known orientation and scored an upright page 2.76 against a sideways one at
   1.07, the wrong way round, because the book is photographed at an angle under
   hard light and the shadow gradient swamps the text.

   What does know is the model that is about to read the page. So this stays as
   a first guess for the obvious portrait case, and the reader is asked to
   report the orientation it actually sees; pages it calls sideways are turned
   and read again. See `turned()` and the re-read in app.js.
   -------------------------------------------------------------------------- */
function uprightIfSideways(src) {
  if (src.height <= src.width) return src;

  const cv = document.createElement('canvas');
  cv.width = src.height;
  cv.height = src.width;
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.translate(0, cv.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return cv;
}

async function pdfPageToJpeg(doc, pageNo, fileName, seen) {
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

  if (seen && duplicate(full, seen)) return [];

  const label = `${fileName} p${pageNo}`;
  return sliceIntoTiles(uprightIfSideways(full), label);
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

async function imageToJpeg(file, seen) {
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

  if (seen && duplicate(cv, seen)) return [];
  return sliceIntoTiles(uprightIfSideways(cv), file.name);
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

/* --------------------------------------------------------------------------
   Turn an already-rendered page image by a quarter or half turn.

   Used when a page comes back unrecognised: the upright guess is based on the
   shape of the photograph, and a page taken the other way round ends up upside
   down instead of sideways. Rather than rely on that guess being right, the
   caller can send the page again the other way and keep whichever reading
   actually identified the document.
   -------------------------------------------------------------------------- */
export async function turned(page, degrees) {
  const bmp = await createImageBitmap(
    await (await fetch('data:image/jpeg;base64,' + page.b64)).blob());

  const quarter = degrees === 90 || degrees === 270;
  const cv = document.createElement('canvas');
  cv.width = quarter ? bmp.height : bmp.width;
  cv.height = quarter ? bmp.width : bmp.height;

  const ctx = cv.getContext('2d', { alpha: false });
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();

  return { ...finish(cv, `${page.label} [turned ${degrees}°]`), turnedFrom: page.label };
}

/* Costing lives in providers.js, where the per-model rates are. */
