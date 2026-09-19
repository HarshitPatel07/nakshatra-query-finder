/* ==========================================================================
   app.js — wiring: pick folder, show cost, run the review, render results
   ========================================================================== */

/* ?v= is bumped whenever these change — GitHub Pages caches assets hard, and
   without it a returning visitor keeps running the old build. */
import { groupByAgency, countPages, pages } from './scan.js?v=12';
import { readBatch, collate, checkKey } from './audit.js?v=12';
import { PROVIDERS, estimateCost, detectProvider, resolveModel } from './providers.js?v=12';

const $ = s => document.querySelector(s);

/* Pages per API call. Free-tier quotas count REQUESTS, not pages, so a bigger
   batch is the cheapest way to make a 49-page folder fit: 5 calls instead of 9.
   Ten pages is ~24k input tokens, comfortable in a 1M window. */
const BATCH = 10;
const KEY_STORE = 'nq.key';
const EFFORT_STORE = 'nq.effort';
const OVERRIDE_STORE = 'nq.override';

/* What the pasted key turned out to be. Null until a key is recognised. */
let detected = null;

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
  const k = $('#key').value.trim();
  if (!k) return keyStatus('', '');
  keyStatus(`Saved on this browser (…${k.slice(-4)})`, 'var(--green)');
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

async function identify(key) {
  lookup?.abort();
  detected = null;

  if (!key) { strip(''); redrawCosts(); return; }

  strip('Checking this key&hellip;', 'busy');

  lookup = new AbortController();
  let found;
  try {
    found = await detectProvider(key, lookup.signal);
  } catch (e) {
    if (e.name === 'AbortError') return;
    found = null;
  }

  if (!found) {
    strip('No provider accepted this key. Check it was copied whole, and that ' +
          'it is an <b>API</b> key rather than a password or a ChatGPT login.', 'bad');
    redrawCosts();
    return;
  }

  const id = found.provider;
  const P = PROVIDERS[id];
  const pick = resolveModel(id, found.models);
  detected = { provider: id, ...pick };

  /* Being offered a model is not the same as being able to use it: a free key
     lists Pro models it has zero quota for, and withdrawn models linger in the
     list. Try each in turn and keep the first that actually answers. */
  const tried = [];
  for (const candidate of (pick.candidates || [pick.model]).slice(0, 6)) {
    strip(`Trying <b>${esc(pretty(candidate))}</b>&hellip;`, 'busy');
    try {
      await checkKey({ provider: id, key, model: candidate, effort: 'low' }, lookup.signal);
      detected.model = candidate;
      detected.label = pretty(candidate);
      detected.rejected = tried;
      break;
    } catch (e) {
      if (e.name === 'AbortError') return;
      tried.push({ model: candidate, why: shortWhy(e.message) });
      detected.model = null;
    }
  }

  if (!detected.model) {
    strip(`<b>${esc(P.label)}</b> accepted the key, but no model would run: ` +
          esc(tried.map(t => `${pretty(t.model)} (${t.why})`).join(', ')), 'bad');
    detected = null;
    redrawCosts();
    return;
  }

  /* an explicit override outlives the auto-pick */
  const ov = store.get(OVERRIDE_STORE);
  if (ov && (found.models || []).includes(ov)) {
    detected.model = ov;
    detected.label = P.models.find(m => m.id === ov)?.label || ov;
    detected.overridden = true;
  }

  /* the override list is what this key really offers, best first, with the
     obviously-wrong modalities (image, speech, music) left out */
  const usable = (found.models || [])
    .filter(m => !P.excludeRe?.test(m))
    .sort((a, b) => (P.rank ? P.rank(b) - P.rank(a) : 0));
  const opts = usable.length ? usable : P.models.map(m => m.id);
  if (!opts.includes(detected.model)) opts.unshift(detected.model);

  $('#model').innerHTML = opts
    .map(id => `<option value="${id}">${esc(id)}</option>`).join('');
  $('#model').value = detected.model;

  const skipped = detected.rejected?.length
    ? ` <i>skipped ${esc(detected.rejected.map(t => pretty(t.model)).join(', '))}</i>`
    : '';

  strip(
    `Using <b>${esc(P.label)}</b> <span class="pill">${esc(detected.label)}</span>` +
    (detected.overridden ? ' <i>(your choice)</i>'
      : ' — best model this key can actually run') + skipped +
    (pick.note && !detected.overridden ? ` <i>${esc(pick.note)}</i>` : '')
  );

  $('#provnote').innerHTML = esc(P.note);
  $('#provnote').style.color = P.freeTier ? 'var(--amber)' : 'var(--muted)';
  redrawCosts();
}

function redrawCosts() { if (agencies.length) drawAgencies(); }

/* --------------------------------------------------------------------------
   Drop to the next-best model this key offers. Called when the current one
   has been given every retry and is still refusing — an alias like
   "gemini-flash-latest" can sit overloaded for a long stretch while a pinned
   version answers immediately.
   Returns true if it switched.
   -------------------------------------------------------------------------- */
const deadModels = new Set();   // spent or refusing, for this session

async function stepDownModel() {
  const list = (detected?.candidates || []).filter(m => !deadModels.has(m));
  const at = list.indexOf(detected.model);
  const rest = at === -1 ? list : list.slice(at + 1);
  if (!rest.length) return false;

  for (const next of rest) {
    try {
      await checkKey({ provider: detected.provider, key: $('#key').value.trim(),
                       model: next, effort: 'low' });
      log(`  switching to ${pretty(next)}`, 'warn');
      detected.model = next;
      detected.label = pretty(next);
      strip(`Using <b>${esc(PROVIDERS[detected.provider].label)}</b> ` +
            `<span class="pill">${esc(detected.label)}</span> — switched mid-run`);
      return true;
    } catch (e) {
      deadModels.add(next);       // don't come back to it later in this run
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

$('#effort').addEventListener('change', e => store.set(EFFORT_STORE, e.target.value));

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
    key: $('#key').value.trim(),
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
      <td class="num">${prov && model ? money(estimateCost(a.pages, prov, model)) : '&mdash;'}</td>
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

/* A free-tier model prices at zero — say "free", not "$0.00".
   With no key yet there is no rate to quote, so say nothing rather than $0. */
function money(v) {
  if (v === undefined) return 'cost shown once a key is added';
  if (v === null) return 'rate not on file';
  return v === 0 ? 'free' : '$' + v.toFixed(2);
}

function cost(pages) {
  if (!detected) return undefined;
  return estimateCost(pages, detected.provider, detected.model);
}

function totals() {
  const sel = picked();
  const p = sel.reduce((n, a) => n + a.pages, 0);
  const each = sel.map(a => cost(a.pages));
  const known = each.every(v => typeof v === 'number');
  const c = known ? each.reduce((n, v) => n + v, 0) : (detected ? null : undefined);
  $('#tot-line').textContent =
    `${sel.length} agency folder${sel.length === 1 ? '' : 's'} · ${p} pages · ` +
    (typeof c === 'number' ? 'about ' + money(c) : money(c));
  $('#run').disabled = !sel.length;
}

/* ---------- the run ----------------------------------------------------- */
$('#run').addEventListener('click', run);
$('#stop').addEventListener('click', () => {
  abort?.abort();
  log('stopped by you', 'warn');
});

async function run() {
  const C = cfg();
  if (!C.key) { alert('Paste an AI API key first.'); $('#key').focus(); return; }
  if (!C.provider || !C.model) {
    alert('That key was not recognised yet — check the message under the key box.');
    $('#key').focus();
    return;
  }
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
      let splitTo = BATCH;      // shrinks if replies keep overflowing

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
          log(`  read ${chunk.length} pages — ${n} issue${n === 1 ? '' : 's'}`, n ? 'warn' : 'ok');
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

          if (e.quotaCapped) {
            log(`  ${detected.label} is out of free quota` +
                (e.limit ? ` (${e.limit} requests)` : ''), 'err');
            deadModels.add(detected.model);
          } else {
            log(`  batch failed: ${e.message}`, 'err');
          }
          /* A model that is spent, or still overloaded after every retry, is
             not going to carry a 50-page folder — move to one with headroom. */
          if ((e.quotaCapped || e.exhausted) && await stepDownModel()) {
            log(`  retrying these ${chunk.length} pages on ${detected.label}`, 'warn');
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
        if (buf.length >= BATCH) await flush();
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
            <div class="obs low">
              <div class="txt" style="font-weight:500">${esc(o.text)}</div>
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
  const rows = [['Agency', 'Main Category', 'Observation', 'Status', 'Sources']];
  results.forEach(r => {
    if (!r.observations.length) rows.push([r.agency, '', 'Nil', '', '']);
    r.observations.forEach(o => rows.push([
      r.agency, o.category, o.text, '', (o.sources || []).join('; ')
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
