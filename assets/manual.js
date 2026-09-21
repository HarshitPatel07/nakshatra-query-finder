/* ==========================================================================
   manual.js — run the review with no API key at all
   --------------------------------------------------------------------------
   Google AI Studio is free in the browser, has no key and no card, and runs a
   far better model than any free API tier. It is a chat window rather than an
   API, so this module does everything around it: renders the folder to page
   images, bundles them, hands over the exact prompt, and takes the reply back.

   Everything that made the paid path worth having — the house wording, the
   collation, the category list, the export — is local and unchanged. Only the
   model call moves out of the app and into a browser tab.
   ========================================================================== */

import { pages as renderPages } from './scan.js?v=32';
import { buildPrompt } from './audit.js?v=32';

const ZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let zipReady = null;

function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (zipReady) return zipReady;
  zipReady = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = ZIP_URL;
    s.onload = () => window.JSZip ? ok(window.JSZip) : fail(new Error('zip library did not load'));
    s.onerror = () => fail(new Error('could not reach the zip library'));
    document.head.appendChild(s);
  });
  return zipReady;
}

/* --------------------------------------------------------------------------
   Render a folder into numbered page images, bundled into zips of `per` pages.
   Numbered because the reply refers to pages by number, and the numbering has
   to survive the trip through a chat window.
   -------------------------------------------------------------------------- */
export async function bundle(agency, { per = 12, signal, onProgress } = {}) {
  const JSZip = await loadZip();
  const parts = [];
  let zip = new JSZip();
  let inZip = 0, n = 0;
  const index = [];

  const close = async () => {
    if (!inZip) return;
    const blob = await zip.generateAsync({ type: 'blob' });
    parts.push(blob);
    zip = new JSZip();
    inZip = 0;
  };

  for await (const pg of renderPages(agency, { signal })) {
    if (signal?.aborted) break;
    if (pg.error) continue;
    n++;
    const name = String(n).padStart(3, '0') + '.jpg';
    zip.file(name, pg.b64, { base64: true });
    index.push({ n, name, label: pg.label });
    inZip++;
    onProgress?.(n, name, pg.label);
    if (inZip >= per) await close();
  }
  await close();

  return { parts, index, pageCount: n };
}

/* The prompt to paste, with the page numbering spelled out so the reply can be
   mapped back to real file names afterwards. */
export function promptFor(index) {
  return buildPrompt() + `

THE IMAGES
You are given ${index.length} page images named 001.jpg, 002.jpg and so on.
The "page" number in your answer is that file's number — 001.jpg is page 1.
Answer for every image, in order, including ones with nothing wrong.

Reply with the JSON object and nothing else. No explanation before or after.`;
}

/* --------------------------------------------------------------------------
   Take the pasted reply and turn it back into findings the rest of the app
   already knows how to handle. Tolerant on purpose — a chat window adds
   fences, preamble and stray commentary that an API never would.
   -------------------------------------------------------------------------- */
export function parseReply(text, index) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : String(text);
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('no JSON found in what was pasted');

  let out;
  try {
    out = JSON.parse(raw.slice(s, e + 1));
  } catch (err) {
    throw new Error('the JSON is incomplete — paste the whole reply, including the closing brace');
  }

  const byNum = new Map(index.map(i => [i.n, i.label]));
  return (out.pages || []).map(p => ({
    label: byNum.get(Number(p.page)) || `page ${p.page}`,
    doc: p.doc || '',
    month: p.month || '',
    issues: Array.isArray(p.issues) ? p.issues : []
  }));
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
