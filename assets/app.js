/* ==========================================================================
   app.js — wiring: pick folder, run the review, render results
   ========================================================================== */

/* ?v= is bumped whenever these change — GitHub Pages caches assets hard, and
   without it a returning visitor keeps running the old build. */
import { groupByAgency, countPages, pages } from './scan.js?v=25';
import { readBatch, collate, checkKey } from './audit.js?v=25';
import { PROVIDERS, detectProvider, resolveModel } from './providers.js?v=25';
import { loadLearned, forgetLearned } from './corpus.js?v=25';

const $ = s => document.querySelector(s);

/* Pages per API call, and it is a real trade-off.

   Accuracy wants FEW pages per call: a vision model reading ten photographed
   register pages at once splits its attention ten ways and starts missing
   blank cells. Free-tier quota wants MANY, because the quota counts requests,
   not pages — a 49-page folder is 17 calls at three per batch but only 5 at
   ten, and the newest Gemini Flash allows 20 a day.

   So the Care level chooses: Maximum reads carefully and spends requests,
   Medium conserves them. */
const BATCH_FOR = { max: 3, high: 6, medium: 10 };
const batchSize = () => BATCH_FOR[$('#effort').value] || 6;
const KEY_STORE = 'nq.key';
const EFFORT_STORE = 'nq.effort';
const OVERRIDE_STORE = 'nq.override';

/* --------------------------------------------------------------------------
   The key pool.

   Several keys can be pasted, one per line. Each is identified on its own, so
   they can be different providers entirely — a paid Claude key alongside free
   Gemini keys is a perfectly sensible mix. Free quotas are per key, so three
   keys is three times the daily allowance, and a key that is spent or being
   shed is stepped over rather than waited on.

   `detected` is whichever key is in use right now; `pool` is all of them.
   -------------------------------------------------------------------------- */
let pool = [];        // [{ key, provider, model, label, candidates, spent }]
let detected = null;  // the entry currently in use

const splitKeys = s => String(s || '')
  .split(/[\r\n,;]+/).map(x => x.trim()).filter(Boolean);

let agencies = [];
let results = [];
let abort = null;

/* ---------- remembered settings -----------------------------------------
   The key is written on every keystroke and paste, not on blur, so it
   survives typing it and clicking straight through. localStorage is per
   browser and per site, and has no expiry — it stays until site data is
   cleared or Forget is pressed.
   ------------------------------------------------------------------------ */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

function keyStatus(msg, colour) {
  const el = $('#keystat');
  if (!el) return;
  el.innerHTML = msg ? `<b style="color:${colour}">${esc(msg)}</b> &middot; ` : '';
}

function showSaved() {
  const n = splitKeys($('#key').value).length;
  if (!n) return keyStatus('', '');
  keyStatus(`${n} key${n === 1 ? '' : 's'} saved on this browser`, 'var(--green)');
}

/* ---------- detection strip --------------------------------------------- */
function strip(html, cls = '') {
  const el = $('#detected');
  el.className = 'detected ' + cls;
  el.innerHTML = html;
  el.classList.toggle('hide', !html);
}

/* --------------------------------------------------------------------------
   Recognise the key, then ask that account which models it can reach and take
   the most capable one. Debounced, and cancels an in-flight lookup so a paste
   mid-typing doesn't land on a stale answer.
   -------------------------------------------------------------------------- */
let lookup = null;

/* Work out one key: which provider owns it, and which model it can run. */
async function identifyOne(key, signal, say) {
  const found = await detectProvider(key, signal);
  if (!found) return { key, error: 'no provider accepted it' };

  const id = found.provider;
  const P = PROVIDERS[id];

  /* Ask what the account can pay for before choosing, so an empty balance
     lands on a free model rather than collecting a payment error from every
     paid one in turn. */
  let freeOnly = false;
  if (P.creditState) {
    say?.('checking credit');
    freeOnly = (await P.creditState(key, signal)) !== 'paid';
  }
  const pick = resolveModel(id, found.models, { freeOnly });

  /* Being offered a model is not the same as being able to use it: a free key
     lists Pro models it has zero quota for, and withdrawn models linger in the
     list. Try each in turn and keep the first that actually answers. */
  /* Walk deep enough to matter: free models are individually rate-limited, so
     several in a row can refuse while one further down answers immediately. */
  for (const candidate of (pick.candidates || [pick.model]).slice(0, 10)) {
    say?.(`trying ${pretty(candidate)}`);
    try {
      await checkKey({ provider: id, key, model: candidate, effort: 'low' }, signal);
      return {
        key, provider: id, model: candidate, label: pretty(candidate),
        candidates: pick.candidates || [candidate],
        offered: found.models || [], spent: false, freeOnly
      };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }
  /* Every candidate refused the probe. That is usually the provider shedding
     load, not a broken key — the provider did accept it a moment ago when it
     listed the models. Hand back the best-ranked model anyway and let the
     run's own retries deal with it, because refusing to start is worse than
     starting on a model that might be busy. */
  return {
    key, provider: id, model: pick.model, label: pretty(pick.model),
    candidates: pick.candidates || [pick.model],
    offered: found.models || [], spent: false, unverified: true, freeOnly
  };
}

async function identify(raw) {
  lookup?.abort();
  pool = []; detected = null;

  const keys = splitKeys(raw);
  if (!keys.length) { strip(''); redrawCosts(); return; }

  lookup = new AbortController();
  const sig = lookup.signal;
  const results = [];

  for (let i = 0; i < keys.length; i++) {
    strip(`Checking key ${i + 1} of ${keys.length}&hellip;`, 'busy');
    try {
      results.push(await identifyOne(keys[i], sig,
        m => strip(`Key ${i + 1} of ${keys.length} — ${esc(m)}&hellip;`, 'busy')));
    } catch (e) {
      if (e.name === 'AbortError') return;
      results.push({ key: keys[i], error: e.message });
    }
  }

  pool = results.filter(r => r.model);
  const bad = results.filter(r => !r.model);

  if (!pool.length) {
    strip('No key would run. ' +
      esc(bad.map((b, i) => `key ${i + 1}: ${b.error}`).join(' · ')) +
      ' — check they are <b>API</b> keys, pasted whole.', 'bad');
    redrawCosts();
    return;
  }

  /* an explicit override outlives the auto-pick, where the key offers it */
  const ov = store.get(OVERRIDE_STORE);
  for (const p of pool) {
    if (ov && p.offered.includes(ov)) { p.model = ov; p.label = pretty(ov); p.overridden = true; }
  }

  detected = pool[0];

  const opts = (detected.offered || [])
    .filter(m => !PROVIDERS[detected.provider].excludeRe?.test(m));
  if (!opts.includes(detected.model)) opts.unshift(detected.model);
  $('#model').innerHTML = opts.map(id => `<option value="${id}">${esc(id)}</option>`).join('');
  $('#model').value = detected.model;

  paintPool();
  $('#provnote').innerHTML = esc(PROVIDERS[detected.provider].note);
  $('#provnote').style.color = PROVIDERS[detected.provider].freeTier
    ? 'var(--amber)' : 'var(--muted)';
  redrawCosts();

  if (bad.length) log?.(`${bad.length} key(s) could not be used`, 'warn');
}

/* Show every key in the pool, which is live, and which are spent. */
function paintPool() {
  if (!pool.length) return strip('');
  const line = pool.map((p, i) => {
    const live = p === detected;
    const mark = p.spent ? '✕' : (live ? '▶' : '·');
    const style = p.spent ? 'opacity:.5;text-decoration:line-through'
                : live ? 'font-weight:700' : 'opacity:.75';
    return `<span style="${style}">${mark} ${esc(PROVIDERS[p.provider].label.split(' — ')[0])}` +
           ` ${esc(p.label)}${p.freeOnly ? ' <i>(free models — account has no credit)</i>' : ''}` +
           `${p.unverified ? ' <i>(unconfirmed — provider was busy)</i>' : ''}` +
           `<span class="pill">…${esc(p.key.slice(-4))}</span></span>`;
  }).join(' &nbsp; ');

  /* how many models the live key can rotate through — the number that decides
     whether a free key can carry a whole folder */
  const live = (detected?.candidates || []).filter(m => !deadModels.has(m)).length;
  const rota = live > 1
    ? `<br><span style="opacity:.8">rotating across <b>${live}</b> models — ` +
      `each has its own free allowance</span>`
    : '';

  const spent = pool.filter(p => p.spent).length;
  strip(
    (pool.length > 1
      ? `<b>${pool.length} keys</b> — using the first that answers` +
        (spent ? `, ${spent} spent` : '') + '<br>'
      : '') + line + rota,
    spent === pool.length ? 'bad' : ''
  );
}

function redrawCosts() { if (agencies.length) drawAgencies(); }

/* --------------------------------------------------------------------------
   No-key path: bundle the folder, hand over the prompt, take the reply back.
   -------------------------------------------------------------------------- */
let manual = null;   // { agency, index, prompt }

$('#mprep').addEventListener('click', async () => {
  const sel = picked();
  if (!sel.length) {
    $('#mstat').innerHTML = '<b style="color:var(--amber)">Pick a folder in step 2 first</b>';
    return;
  }
  if (sel.length > 1) {
    $('#mstat').innerHTML = '<b style="color:var(--amber)">Tick just one agency — ' +
      'they have to go through the chat one at a time</b>';
    return;
  }

  const agency = sel[0];
  const per = +$('#mper').value;
  $('#mprep').disabled = true;
  $('#mstat').textContent = 'rendering pages…';

  try {
    const { bundle, promptFor, download } = await import('./manual.js?v=25');
    const { parts, index, pageCount } = await bundle(agency, {
      per,
      onProgress: n => { $('#mstat').textContent = `rendering page ${n}…`; }
    });

    manual = { agency: agency.name, index, prompt: promptFor(index) };

    const base = agency.name.replace(/[^\w.-]+/g, '_');
    parts.forEach((blob, i) => download(blob,
      parts.length > 1 ? `${base}-part${i + 1}of${parts.length}.zip` : `${base}.zip`));

    $('#mzips').innerHTML = parts.length > 1
      ? `<b>${parts.length} zip files</b> downloaded (${pageCount} pages) — do one part per chat`
      : `<b>1 zip file</b> downloaded (${pageCount} pages)`;
    $('#msteps').classList.remove('hide');
    $('#mstat').innerHTML = `<b style="color:var(--green)">ready — ${pageCount} pages</b>`;
  } catch (e) {
    $('#mstat').innerHTML = `<b style="color:var(--red)">${esc(e.message)}</b>`;
  } finally {
    $('#mprep').disabled = false;
  }
});

$('#mcopy').addEventListener('click', async () => {
  if (!manual) return;
  try {
    await navigator.clipboard.writeText(manual.prompt);
    $('#mcopy').textContent = 'Copied';
    setTimeout(() => $('#mcopy').textContent = 'Copy the prompt', 1800);
  } catch { alert('Could not copy — the prompt is long, try again or use a different browser.'); }
});

$('#mread').addEventListener('click', async () => {
  if (!manual) return;
  const text = $('#mreply').value.trim();
  if (!text) { $('#mreadstat').textContent = 'paste the reply first'; return; }

  try {
    const { parseReply } = await import('./manual.js?v=25');
    const findings = parseReply(text, manual.index);
    const observations = collate(findings);

    /* several parts of one folder accumulate rather than replace */
    const prior = results.find(r => r.agency === manual.agency);
    if (prior) {
      const seen = new Set(prior.observations.map(o => o.text));
      prior.observations.push(...observations.filter(o => !seen.has(o.text)));
      prior.pages += findings.length;
    } else {
      results.push({ agency: manual.agency, pages: findings.length, observations });
    }

    $('#mreply').value = '';
    $('#mreadstat').innerHTML =
      `<b style="color:var(--green)">${findings.length} pages read, ` +
      `${observations.length} quer${observations.length === 1 ? 'y' : 'ies'}</b> — ` +
      `paste the next part, or scroll down for the sheet`;
    render();
  } catch (e) {
    $('#mreadstat').innerHTML = `<b style="color:var(--red)">${esc(e.message)}</b>`;
  }
});

/* ---------- learning from finished sheets -------------------------------- */
function learnStatus() {
  const n = loadLearned().length;
  $('#learnstat').innerHTML = n
    ? `<b style="color:var(--green)">${n}</b> imported example${n === 1 ? '' : 's'} in use`
    : 'none imported yet — using the built-in examples';
  $('#learnclear').classList.toggle('hide', !n);
}
learnStatus();

$('#learnbtn').addEventListener('click', () => $('#learnfile').click());

$('#learnfile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  $('#learnstat').textContent = 'reading…';
  try {
    const { importWorkbook } = await import('./import.js?v=25');
    const r = await importWorkbook(file);
    learnStatus();
    $('#learnstat').innerHTML +=
      ` &middot; added <b>${r.added}</b> of ${r.found} from ` +
      esc(r.sheets.map(s => s.name).join(', '));
  } catch (err) {
    $('#learnstat').innerHTML =
      `<b style="color:var(--red)">could not read that file — ${esc(err.message)}</b>`;
  } finally {
    e.target.value = '';
  }
});

$('#learnclear').addEventListener('click', () => {
  if (!confirm('Remove every example imported from your own sheets?\n\n' +
               'The built-in examples stay.')) return;
  forgetLearned();
  learnStatus();
});

/* --------------------------------------------------------------------------
   Drop to the next-best model this key offers. Called when the current one
   has been given every retry and is still refusing — an alias like
   "gemini-flash-latest" can sit overloaded for a long stretch while a pinned
   version answers immediately.
   Returns true if it switched.
   -------------------------------------------------------------------------- */
const deadModels = new Set();   // spent or refusing, for this session

/* --------------------------------------------------------------------------
   Spread the work across every model the key can reach, rather than draining
   one and then moving on.

   Free quotas are counted per model, so ten usable models at twenty requests
   each is two hundred requests, not twenty. Rotating also keeps any single
   model from being hammered hard enough to start shedding, which is what
   produced the 503 storms. Models are taken in ranked order, so the better
   ones still carry proportionally more of the folder.
   -------------------------------------------------------------------------- */
let rotateAt = 0;

function rotateModel() {
  const list = (detected?.candidates || []).filter(m => !deadModels.has(m));
  if (list.length < 2) return false;

  rotateAt = (rotateAt + 1) % list.length;
  const next = list[rotateAt];
  if (next === detected.model) return false;

  detected.model = next;
  detected.label = pretty(next);
  return true;
}

/* --------------------------------------------------------------------------
   Move to the next key that still has something left. Free quotas are per key,
   so a second key is a fresh allowance rather than the same wall again — this
   is tried before waiting, because waiting out a daily quota is hopeless.
   -------------------------------------------------------------------------- */
function nextKey(reason) {
  if (pool.length < 2) return false;
  if (detected) detected.spent = true;

  const fresh = pool.find(p => !p.spent);
  if (!fresh) { paintPool(); return false; }

  detected = fresh;
  deadModels.clear();            // a new key has its own model availability
  log(`  ${reason} — switching to key …${fresh.key.slice(-4)} (${fresh.label})`, 'warn');
  paintPool();
  return true;
}

async function stepDownModel() {
  const list = (detected?.candidates || []).filter(m => !deadModels.has(m));
  const at = list.indexOf(detected.model);
  const rest = at === -1 ? list : list.slice(at + 1);
  if (!rest.length) return false;

  for (const next of rest) {
    try {
      await checkKey({ provider: detected.provider, key: detected.key,
                       model: next, effort: 'low' });
      log(`  switching to ${pretty(next)}`, 'warn');
      detected.model = next;
      detected.label = pretty(next);
      strip(`Using <b>${esc(PROVIDERS[detected.provider].label)}</b> ` +
            `<span class="pill">${esc(detected.label)}</span> — switched mid-run`);
      return true;
    } catch (e) {
      /* Only retire a model that genuinely cannot serve this key. A 503 means
         Google handed its spare capacity to paying traffic for a moment — the
         model is fine and will answer again shortly, so retiring it here would
         burn the whole list in under two minutes. */
      if (e.quotaCapped || e.status === 404 || e.status === 400) deadModels.add(next);
    }
  }
  return false;
}

/* "gemini-3.5-flash" -> "Gemini 3.5 Flash" */
function pretty(id) {
  return String(id).replace(/[-_]/g, ' ')
    .replace(/\b([a-z])/g, c => c.toUpperCase())
    .replace(/\bGpt\b/, 'GPT');
}

/* the one useful clause out of a long provider error */
function shortWhy(msg) {
  if (/limit: 0|quota/i.test(msg)) return 'no quota on this plan';
  if (/no longer available|404/i.test(msg)) return 'withdrawn';
  if (/503|high demand/i.test(msg)) return 'overloaded';
  if (/429/.test(msg)) return 'rate limited';
  return (msg.split('—')[1] || msg).trim().slice(0, 40);
}

/* restore */
(function restore() {
  const e = store.get(EFFORT_STORE);
  if (e) $('#effort').value = e;
  const k = store.get(KEY_STORE);
  if (k) { $('#key').value = k; showSaved(); identify(k); }
})();

/* save + identify as they type or paste */
let saveTimer = null;
$('#key').addEventListener('input', e => {
  const v = e.target.value.trim();
  clearTimeout(saveTimer);
  if (!v) { store.del(KEY_STORE); keyStatus('', ''); identify(''); return; }
  saveTimer = setTimeout(() => {
    store.set(KEY_STORE, v)
      ? showSaved()
      : keyStatus('Could not save — private window?', 'var(--amber)');
    identify(v);
  }, 400);
});

$('#forget').addEventListener('click', () => {
  store.del(KEY_STORE);
  store.del(OVERRIDE_STORE);
  $('#key').value = '';
  keyStatus('Key removed from this browser', 'var(--muted)');
  identify('');
  $('#key').focus();
});

$('#effort').addEventListener('change', e => {
  store.set(EFFORT_STORE, e.target.value);
  if (agencies.length) totals();     // request count changes with batch size
});

/* ---------- optional manual override ------------------------------------ */
$('#advtoggle').addEventListener('click', ev => {
  ev.preventDefault();
  const w = $('#advwrap');
  w.classList.toggle('hide');
  $('#advtoggle').textContent = w.classList.contains('hide')
    ? 'Override the model' : 'Use the automatic choice';
  if (w.classList.contains('hide')) {
    store.del(OVERRIDE_STORE);
    identify($('#key').value.trim());
  }
});

$('#model').addEventListener('change', e => {
  store.set(OVERRIDE_STORE, e.target.value);
  identify($('#key').value.trim());
});

/* everything the audit layer needs, in one object */
function cfg() {
  return {
    provider: detected?.provider,
    key: detected?.key,
    model: detected?.model,
    effort: $('#effort').value
  };
}

/* ---------- progress panel ----------------------------------------------
   A batch can take a minute, so the panel has to keep saying something true
   the whole time — what it is doing now, how far in, and how long is left.
   ------------------------------------------------------------------------ */
const prog = {
  t0: 0, pages: 0, total: 0, issues: 0, failed: 0, agency: '', timer: null
};

function phase(text, working = true) {
  $('#phase').textContent = text;
  $('#spin').classList.toggle('done', !working);
  $('#barwrap').classList.toggle('working', working);
}

function hhmm(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60);
  return sec % 60 ? `${m}m ${sec % 60}s` : `${m}m`;
}

function paint() {
  const { pages, total, issues, failed, t0 } = prog;
  $('#pbar').style.width = total ? Math.round(pages / total * 100) + '%' : '0%';
  $('#s-pages').textContent = `${pages} / ${total}`;
  $('#s-agency').textContent = prog.agency || '—';
  $('#s-issues').textContent = issues;
  $('#s-failed').textContent = failed;
  $('#s-failed-wrap').style.display = failed ? '' : 'none';

  const el = (Date.now() - t0) / 1000;
  $('#s-elapsed').textContent = hhmm(el);
  /* estimate from actual throughput so far — honest, not a fixed guess */
  $('#s-left').textContent = pages && pages < total
    ? '~' + hhmm(el / pages * (total - pages))
    : (pages >= total && total ? 'done' : '—');
}

function startProgress(total) {
  Object.assign(prog, { t0: Date.now(), pages: 0, total, issues: 0, failed: 0, agency: '' });
  clearInterval(prog.timer);
  prog.timer = setInterval(paint, 1000);   // keeps elapsed ticking during a long call
  paint();
}

function stopProgress(text) {
  clearInterval(prog.timer);
  prog.timer = null;
  phase(text, false);
  paint();
}

/* ---------- logging ----------------------------------------------------- */
function log(msg, cls = '') {
  const el = $('#log');
  const t = new Date().toLocaleTimeString('en-GB');
  el.innerHTML += `<span class="dim">${t}</span> <span class="${cls}">${esc(msg)}</span>\n`;
  el.scrollTop = el.scrollHeight;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- folder picking --------------------------------------------- */
$('#drop').addEventListener('click', () => $('#picker').click());

$('#picker').addEventListener('change', async e => {
  const list = e.target.files;
  if (!list.length) return;

  agencies = groupByAgency(list);
  if (!agencies.length) {
    alert('No PDFs or images found in that folder.');
    return;
  }

  $('#scan-out').classList.remove('hide');
  $('#agency-rows').innerHTML =
    `<tr><td colspan="5" class="empty">Counting pages&hellip;</td></tr>`;

  for (const a of agencies) await countPages(a);
  drawAgencies();
});

function drawAgencies() {
  const prov = detected?.provider, model = detected?.model;
  $('#agency-rows').innerHTML = agencies.map((a, i) => `
    <tr>
      <td><input type="checkbox" class="pick" data-i="${i}" checked></td>
      <td><span class="agency-name">${esc(a.name)}</span></td>
      <td class="meta">${a.files.length} file${a.files.length > 1 ? 's' : ''}</td>
      <td class="num">${a.pages}</td>
    </tr>`).join('');

  $('#agency-rows').querySelectorAll('.pick')
    .forEach(c => c.addEventListener('change', totals));
  totals();
}

function picked() {
  return [...document.querySelectorAll('.pick')]
    .filter(c => c.checked)
    .map(c => agencies[+c.dataset.i]);
}

function totals() {
  const sel = picked();
  const p = sel.reduce((n, a) => n + a.pages, 0);
  /* Quotas count requests, so say how many this will take before it runs */
  const calls = sel.reduce((n, a) => n + Math.ceil(a.pages / batchSize()), 0);
  $('#tot-line').textContent =
    `${sel.length} agency folder${sel.length === 1 ? '' : 's'} · ${p} pages · ` +
    `${calls} request${calls === 1 ? '' : 's'}`;
  $('#run').disabled = !sel.length;
}

/* ---------- the run ----------------------------------------------------- */
$('#run').addEventListener('click', run);
$('#stop').addEventListener('click', () => {
  abort?.abort();
  log('stopped by you', 'warn');
});

async function run() {
  /* The box is the source of truth for "did you give me a key". The pool is
     only what identification made of it, and identification can still be
     running, or can have failed because the provider was busy — neither means
     the user forgot to paste something. */
  const typed = splitKeys($('#key').value);
  if (!typed.length) { alert('Paste an AI API key first.'); $('#key').focus(); return; }

  if (!pool.length) {
    $('#p-prog').classList.remove('hide');
    $('#log').innerHTML = '';
    startProgress(0);
    phase('Checking the key…');
    log('key not identified yet — checking now');
    await identify($('#key').value);
    if (!pool.length) {
      stopProgress('Could not use any key');
      alert('None of those keys would run.\n\n' +
            'Check the message under the key box — if it says the provider is ' +
            'busy rather than that the key is bad, wait a few minutes and try again.');
      return;
    }
  }

  const C = cfg();
  const sel = picked();

  abort = new AbortController();
  results = [];
  $('#p-prog').classList.remove('hide');
  $('#p-res').classList.add('hide');
  $('#log').innerHTML = '';
  $('#run').disabled = true;

  const totalPages = sel.reduce((n, a) => n + a.pages, 0);
  let done = 0;
  let failedPages = 0;      // pages that never got read, after every retry
  let busyWaits = 0;        // times the whole model list was busy at once
  const MAX_BUSY_WAITS = 5; // 30s, 60s, 120s, 240s, 240s — then give up honestly
  startProgress(totalPages);

  try {
    for (const agency of sel) {
      if (abort.signal.aborted) break;
      log(`— ${agency.name} (${agency.pages} pages) via ${PROVIDERS[C.provider].label} ${detected.label} —`);
      prog.agency = agency.name;
      phase(`Opening ${agency.name}`);

      const findings = [];
      let buf = [];
      let batchNo = 0;
      let splitTo = batchSize();      // shrinks if replies keep overflowing

      const flush = async (force) => {
        if (!buf.length) return;
        if (!force && buf.length > splitTo) {
          /* respect a reduced size after an overflow */
          const chunk = buf.slice(0, splitTo);
          buf = buf.slice(splitTo);
          await run1(chunk);
          return flush(force);
        }
        const chunk = buf; buf = [];
        await run1(chunk);
      };

      const run1 = async (chunk) => {
        batchNo++;
        phase(`Reading pages ${prog.pages + 1}–${prog.pages + chunk.length} of ` +
              `${agency.name} · ${detected.label}`);
        $('#pstat').textContent =
          `batch ${batchNo} · ${chunk.length} pages · ${chunk[0].label}` +
          (chunk.length > 1 ? ` → ${chunk[chunk.length - 1].label}` : '');
        try {
          const got = await readBatch(
            { ...C, onRetry: m => { log('  ' + m, 'warn'); phase(m); } }, chunk, abort.signal);
          findings.push(...got);
          const n = got.reduce((s, g) => s + g.issues.length, 0);
          prog.issues += n;
          /* Name what it thinks it looked at. "0 issues" on its own cannot be
             told apart from the model not recognising the pages at all. */
          const docs = [...new Set(got.map(g => g.doc).filter(Boolean))];
          log(`  ${detected.label}: read ${chunk.length} pages — ${n} issue${n === 1 ? '' : 's'}` +
              (docs.length ? ` · saw: ${docs.join(', ')}` : ' · did not identify any document'),
              n ? 'warn' : (docs.length ? 'ok' : 'err'));
          /* move to the next model so no single quota carries the folder */
          rotateModel();
        } catch (e) {
          if (e.name === 'AbortError' || e.fatal) throw e;
          /* Too many findings to fit in one reply — halve the batch and let
             both halves go round again rather than losing the pages. */
          if (e.splittable && chunk.length > 1) {
            const half = Math.ceil(chunk.length / 2);
            log(`  reply too long for ${chunk.length} pages — splitting into ${half} + ${chunk.length - half}`, 'warn');
            buf = chunk.slice(0, half).concat(chunk.slice(half), buf);
            splitTo = Math.max(2, half);
            return;
          }

          /* Not enough credit for this model. Retrying cannot make it cheaper,
             so retire it and fall to one the account can actually pay for. */
          if (e.unaffordable) {
            log(`  ${detected.label} costs more than this account has — ` +
                `moving to a model it can run`, 'err');
            deadModels.add(detected.model);
            if (!detected.freeOnly) {
              detected.freeOnly = true;
              const only = resolveModel(detected.provider, detected.offered, { freeOnly: true });
              if (only?.model) {
                detected.model = only.model;
                detected.label = pretty(only.model);
                detected.candidates = only.candidates;
                log(`  switching to free models — now on ${detected.label}`, 'warn');
                paintPool();
                buf = chunk.concat(buf);
                return;
              }
            }
          }

          if (e.quotaCapped) {
            log(`  ${detected.label} is out of free quota` +
                (e.limit ? ` (${e.limit} requests)` : ''), 'err');
            deadModels.add(detected.model);
          } else if (e.status === 404 || e.status === 400) {
            /* withdrawn, or refuses the request shape — it will never serve
               this key, so drop it out of the rotation for good. */
            log(`  ${detected.label} cannot serve this key — dropping it`, 'err');
            deadModels.add(detected.model);
            if (rotateModel()) {
              log(`  trying ${detected.label}`, 'warn');
              buf = chunk.concat(buf);
              return;
            }
          } else if (!e.unaffordable) {
            log(`  batch failed: ${e.message}`, 'err');
          }
          /* A model that is spent, or still overloaded after every retry, is
             not going to carry a 50-page folder — move to one with headroom. */
          /* A provider shedding load drops the BIGGEST requests first — the
             tiny probe gets through while six images do not. So shrink the
             batch before touching the model: it is far more likely to be
             accepted, and it does not re-upload the same pages to a second
             model for nothing. */
          if (e.exhausted && !e.quotaCapped && splitTo > 2) {
            splitTo = Math.max(2, Math.floor(splitTo / 2));
            log(`  provider is shedding large requests — dropping to ` +
                `${splitTo} pages a call`, 'warn');
            buf = chunk.concat(buf);
            return;
          }

          /* A spent quota is per key, so another key is a fresh allowance —
             far better than waiting out a daily limit that will not lift. */
          if (e.quotaCapped && nextKey('quota spent on this key')) {
            buf = chunk.concat(buf);
            return;
          }

          if ((e.quotaCapped || e.exhausted || e.unaffordable) && await stepDownModel()) {
            log(`  retrying these ${chunk.length} pages on ${detected.label}`, 'warn');
            buf = chunk.concat(buf);
            return;
          }

          /* every model on this key is busy — another key may be served */
          if (e.exhausted && nextKey('every model busy on this key')) {
            buf = chunk.concat(buf);
            return;
          }

          /* Every model busy at once means Google is shedding free-tier load,
             not that the folder is unreadable. Sit it out and come back to the
             same pages rather than throwing them away. */
          if (e.exhausted && busyWaits < MAX_BUSY_WAITS) {
            busyWaits++;
            const wait = Math.min(30 * 2 ** (busyWaits - 1), 240);
            log(`  every model is busy — waiting ${wait}s before trying again ` +
                `(${busyWaits} of ${MAX_BUSY_WAITS})`, 'warn');
            phase(`All models busy — waiting ${wait}s`);
            deadModels.clear();            // give them all another chance
            await new Promise(r => setTimeout(r, wait * 1000));
            if (abort.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            buf = chunk.concat(buf);
            return;
          }

          failedPages += chunk.length;
          prog.failed = failedPages;
        }
        done += chunk.length;
        prog.pages = done;
        paint();
      };

      for await (const pg of pages(agency, { signal: abort.signal })) {
        if (abort.signal.aborted) break;
        if (pg.error) {
          log(`  skip ${pg.label}: ${pg.error}`, 'err');
          done++; prog.pages = done; prog.failed = ++failedPages; paint();
          continue;
        }
        if (!buf.length) phase(`Preparing ${pg.label}`);
        buf.push(pg);
        if (buf.length >= batchSize()) await flush();
      }
      await flush(true);

      if (abort.signal.aborted) break;

      phase(`Writing up ${agency.name}`);

      /* Local, deterministic, and free — no model call. The sentence comes
         from the firm's own template, so the wording cannot drift, and one
         row per defect is preserved rather than summarised away. */
      const observations = collate(findings);
      results.push({
        agency: agency.name,
        pages: findings.length,
        header: headerFrom(findings),
        observations
      });
      log(`  ${observations.length} quer${observations.length === 1 ? 'y' : 'ies'}`, 'ok');
    }

    if (failedPages) {
      log(`WARNING: ${failedPages} page(s) were never read — the observations ` +
          `below are incomplete. Re-run to cover them.`, 'err');
      stopProgress(`Finished with ${failedPages} page(s) unread — results are incomplete`);
    } else {
      stopProgress(`Done — ${prog.issues} issue(s) across ${prog.pages} pages ` +
                   `in ${hhmm((Date.now() - prog.t0) / 1000)}`);
    }
    render();
  } catch (e) {
    if (e.name === 'AbortError') { log('stopped — showing what was read', 'warn'); stopProgress('Stopped'); }
    else if (e.fatal) { log('STOPPED: ' + e.message, 'err'); stopProgress('Stopped: ' + e.message); }
    else { log('failed: ' + e.message, 'err'); stopProgress('Failed: ' + e.message); }

    if (e.fatal) {
      log(results.length
        ? `kept ${results.length} finished folder(s) below — export before closing`
        : 'nothing finished, so nothing was lost', 'warn');
    }
    render();          // whatever completed is still worth having
  } finally {
    $('#run').disabled = false;
    abort = null;
  }
}

/* The Agency Visit Sign Off page carries everything rows 1-14 of the sheet
   need, so whichever page the model recognised as that form supplies them. */
function headerFrom(findings) {
  const f = findings.find(x => x.signoff) || {};
  return f.signoff || {};
}

/* ---------- results ----------------------------------------------------- */
function render() {
  if (!results.length) return;
  $('#p-res').classList.remove('hide');

  $('#results').innerHTML = results.map(r => {
    /* grouped by Main Category, the way the sheet is laid out */
    const byCat = new Map();
    r.observations.forEach(o => {
      const c = o.category || 'Process Management';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(o);
    });

    return `
    <div style="margin-bottom:34px">
      <h3 style="font-size:17px;margin-bottom:2px">${esc(r.agency)}</h3>
      <div class="meta">${r.pages} pages read · ${r.observations.length} quer${
        r.observations.length === 1 ? 'y' : 'ies'}</div>
      ${[...byCat.entries()].map(([cat, list]) => `
        <div style="margin-top:18px">
          <div class="catline">${esc(cat)} <span>${list.length}</span></div>
          ${list.map(o => `
            <div class="obs ${o.review ? 'medium' : 'low'}">
              <div class="txt" style="font-weight:500">${esc(o.text)}</div>
              ${o.review ? `<div class="src" style="color:var(--amber)">⚠ ${esc(o.review)}</div>` : ''}
              ${o.sources?.length
                ? `<div class="src">${esc(o.sources.slice(0, 6).join('  ·  '))}${
                    o.sources.length > 6 ? ` +${o.sources.length - 6}` : ''}</div>` : ''}
            </div>`).join('')}
        </div>`).join('')
      || '<div class="empty">No exceptions found in this folder.</div>'}
    </div>`;
  }).join('');

  $('#p-res').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- export ------------------------------------------------------ */
function asText() {
  return results.map(r => {
    const lines = [r.agency, '', 'Main Category\tObservation'];
    r.observations.forEach(o => lines.push(`${o.category}\t${o.text}`));
    if (!r.observations.length) lines.push('Nil');
    return lines.join('\n');
  }).join('\n\n———\n\n');
}

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(asText());
    $('#copy').textContent = 'Copied';
    setTimeout(() => $('#copy').textContent = 'Copy', 1600);
  } catch { alert('Could not copy — select the text and copy manually.'); }
});

$('#csv').addEventListener('click', () => {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  /* same columns as the Query Sheet, so it pastes straight in */
  const rows = [['Agency', 'Main Category', 'Observation', 'Status', 'Check', 'Sources']];
  results.forEach(r => {
    if (!r.observations.length) rows.push([r.agency, '', 'Nil', '', '', '']);
    r.observations.forEach(o => rows.push([
      r.agency, o.category, o.text, '', o.review || '', (o.sources || []).join('; ')
    ]));
  });
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nakshatra-queries.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#print').addEventListener('click', () => window.print());
