/* ==========================================================================
   app.js — wiring: pick folder, show cost, run the review, render results
   ========================================================================== */

/* ?v= is bumped whenever these change — GitHub Pages caches assets hard, and
   without it a returning visitor keeps running the old build. */
import { groupByAgency, countPages, pages } from './scan.js?v=5';
import { readBatch, consolidate } from './audit.js?v=5';
import { PROVIDERS, estimateCost, detectProvider, resolveModel } from './providers.js?v=5';

const $ = s => document.querySelector(s);

const BATCH = 6;          // pages per API call
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

  const id = detectProvider(key);
  if (!id) {
    strip('Key not recognised. Expected <b>sk-ant-…</b> (Claude), ' +
          '<b>sk-…</b> (OpenAI) or <b>AIza…</b> (Gemini).', 'bad');
    redrawCosts();
    return;
  }

  const P = PROVIDERS[id];
  strip(`Recognised <b>${esc(P.label)}</b> — finding the best model…`, 'busy');

  lookup = new AbortController();
  let pick;
  try {
    pick = await resolveModel(id, key, lookup.signal);
  } catch (e) {
    if (e.name === 'AbortError') return;
    pick = null;
  }
  if (!pick) { strip(`Recognised <b>${esc(P.label)}</b>, but the model list failed.`, 'bad'); return; }

  detected = { provider: id, ...pick };

  /* an explicit override outlives the auto-pick */
  const ov = store.get(OVERRIDE_STORE);
  if (ov && P.models.some(m => m.id === ov)) {
    detected.model = ov;
    detected.label = P.models.find(m => m.id === ov).label;
    detected.overridden = true;
  }

  $('#model').innerHTML = P.models
    .map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
  $('#model').value = detected.model;

  strip(
    `Using <b>${esc(P.label)}</b> <span class="pill">${esc(detected.label)}</span>` +
    (detected.overridden ? ' <i>(your choice)</i>'
      : detected.detected ? ' — best model this key can reach'
      : ' — assumed best; this key cannot list models') +
    (pick.note && !detected.overridden ? ` <i>${esc(pick.note)}</i>` : ''),
    detected.detected || detected.overridden ? '' : 'busy'
  );

  $('#provnote').innerHTML = esc(P.note);
  $('#provnote').style.color = P.freeTier ? 'var(--amber)' : 'var(--muted)';
  redrawCosts();
}

function redrawCosts() { if (agencies.length) drawAgencies(); }

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
      <td class="num">${prov && model ? money(estimateCost(a.pages, prov, model)) : '—'}</td>
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
  if (v === null) return 'cost shown once a key is added';
  return v === 0 ? 'free' : '$' + v.toFixed(2);
}

function cost(pages) {
  if (!detected) return null;
  return estimateCost(pages, detected.provider, detected.model);
}

function totals() {
  const sel = picked();
  const p = sel.reduce((n, a) => n + a.pages, 0);
  const c = detected ? sel.reduce((n, a) => n + cost(a.pages), 0) : null;
  $('#tot-line').textContent =
    `${sel.length} agency folder${sel.length === 1 ? '' : 's'} · ${p} pages · ` +
    (c === null ? money(null) : 'about ' + money(c));
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

  try {
    for (const agency of sel) {
      if (abort.signal.aborted) break;
      log(`— ${agency.name} (${agency.pages} pages) via ${PROVIDERS[C.provider].label} ${detected.label} —`);

      const findings = [];
      let buf = [];

      const flush = async () => {
        if (!buf.length) return;
        const chunk = buf; buf = [];
        try {
          const got = await readBatch(C, chunk, abort.signal);
          findings.push(...got);
          const n = got.reduce((s, g) => s + g.issues.length, 0);
          log(`  read ${chunk.length} pages — ${n} issue${n === 1 ? '' : 's'}`, n ? 'warn' : 'ok');
        } catch (e) {
          if (e.name === 'AbortError' || e.fatal) throw e;
          log(`  batch failed: ${e.message}`, 'err');
        }
        done += chunk.length;
        $('#pbar').style.width = Math.round(done / totalPages * 100) + '%';
        $('#pstat').textContent = `${done} of ${totalPages} pages`;
      };

      for await (const pg of pages(agency, { signal: abort.signal })) {
        if (abort.signal.aborted) break;
        if (pg.error) { log(`  skip ${pg.label}: ${pg.error}`, 'err'); done++; continue; }
        buf.push(pg);
        if (buf.length >= BATCH) await flush();
      }
      await flush();

      if (abort.signal.aborted) break;

      log('  consolidating…');
      try {
        const summary = await consolidate(C, agency.name, findings, abort.signal);
        results.push({ agency: agency.name, pages: findings.length, ...summary });
        log(`  ${summary.observations.length} observation(s), score ${summary.score}`, 'ok');
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        /* Merging is the last step and the cheapest to lose. Keep the raw
           per-page findings rather than discarding pages already paid for. */
        results.push(rawFallback(agency.name, findings));
        log(`  could not merge (${e.message}) — keeping raw findings`, 'warn');
        if (e.fatal) throw e;
      }
    }

    render();
  } catch (e) {
    if (e.name === 'AbortError') log('stopped — showing what was read', 'warn');
    else if (e.fatal) log('STOPPED: ' + e.message, 'err');
    else log('failed: ' + e.message, 'err');

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

/* Un-merged findings, one observation per issue, so a run that dies at the
   last step still hands back everything the pages cost. */
function rawFallback(name, findings) {
  const observations = [];
  findings.forEach(f => (f.issues || []).forEach(i => observations.push({
    text: i.text,
    severity: i.severity || 'low',
    category: i.category || '',
    sources: [f.label]
  })));
  return {
    agency: name, pages: findings.length,
    score: '—', grade: '—', category: 'not merged',
    partial: true, observations
  };
}

/* ---------- results ----------------------------------------------------- */
function render() {
  if (!results.length) return;
  $('#p-res').classList.remove('hide');

  $('#results').innerHTML = results.map(r => `
    <div style="margin-bottom:34px">
      <h3 style="font-size:17px;margin-bottom:2px">${esc(r.agency)}</h3>
      <div class="meta">${r.pages} pages read${r.partial
        ? ' · <b style="color:var(--amber)">raw findings, not merged — duplicates not removed</b>'
        : ''}</div>
      <div class="score">
        <div><div class="k">Score</div><div class="v">${r.score}</div></div>
        <div><div class="k">Grade</div><div class="v">${esc(r.grade)}</div></div>
        <div><div class="k">Category</div><div class="v" style="font-size:19px">${esc(r.category)}</div></div>
        <div><div class="k">Queries</div><div class="v">${r.observations.length}</div></div>
      </div>
      ${r.observations.length ? r.observations.map(o => `
        <div class="obs ${esc(o.severity || 'low')}">
          <div class="hd">
            <span class="txt">${esc(o.text)}</span>
            <span>
              <span class="tag cat">${esc(o.category || '')}</span>
              <span class="tag ${esc(o.severity || 'low')}">${esc(o.severity || '')}</span>
            </span>
          </div>
          ${o.sources?.length ? `<div class="src">${esc(o.sources.join('  ·  '))}</div>` : ''}
        </div>`).join('')
      : '<div class="empty">No exceptions found in this folder.</div>'}
    </div>`).join('');

  $('#p-res').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- export ------------------------------------------------------ */
function asText() {
  return results.map(r =>
    `${r.agency}\nScore ${r.score} — Grade ${r.grade} (${r.category})\n\nAuditor Observations:\n` +
    (r.observations.length
      ? r.observations.map((o, i) => `${i + 1}. ${o.text}`).join('\n')
      : 'Nil.')
  ).join('\n\n———\n\n');
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
  const rows = [['Agency', 'Score', 'Grade', 'Category', 'Severity', 'Area', 'Observation', 'Sources']];
  results.forEach(r => {
    if (!r.observations.length) rows.push([r.agency, r.score, r.grade, r.category, '', '', 'Nil', '']);
    r.observations.forEach(o => rows.push([
      r.agency, r.score, r.grade, r.category,
      o.severity, o.category, o.text, (o.sources || []).join('; ')
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
