/* ==========================================================================
   providers.js — one shape for Claude, OpenAI and Gemini
   --------------------------------------------------------------------------
   Each provider turns a neutral request into its own wire format and reads
   the reply back out. audit.js never sees a vendor detail.

   A neutral `content` is a list of:
     { text: '...' }              or
     { image: '<base64 jpeg>' }
   ========================================================================== */

/* Rates are $ per 1M tokens and move often — check the vendor's pricing page
   before quoting a client. They only drive the on-screen estimate. */
export const PROVIDERS = {

  anthropic: {
    label: 'Claude — Anthropic',
    keyHint: 'sk-ant-...',
    keyUrl: 'console.anthropic.com → API keys',
    freeTier: false,
    note: 'Verified working. Best of the three at messy handwriting.',
    keyPattern: /^sk-ant-/,

    /* Most capable vision model first. The key's own model list decides which
       of these it may actually use — anything unknown is ignored. */
    prefer: [
      'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
      'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'
    ],
    listUrl: () => 'https://api.anthropic.com/v1/models?limit=100',
    listHeaders: key => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    }),
    parseList: j => (j.data || []).map(m => m.id),

    models: [
      { id: 'claude-opus-5',     label: 'Opus 5',     in: 5, out: 25 },
      { id: 'claude-opus-4-8',   label: 'Opus 4.8',   in: 5, out: 25 },
      { id: 'claude-opus-4-7',   label: 'Opus 4.7',   in: 5, out: 25 },
      { id: 'claude-opus-4-6',   label: 'Opus 4.6',   in: 5, out: 25 },
      { id: 'claude-sonnet-5',   label: 'Sonnet 5',   in: 2, out: 10 },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', in: 3, out: 15 },
      { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  in: 1, out: 5 }
    ],

    build(key, model, effort, system, content) {
      const parts = content.map(c => c.text
        ? { type: 'text', text: c.text }
        : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.image } });

      const body = {
        model, max_tokens: 16000, system,
        messages: [{ role: 'user', content: parts }],
        output_config: { effort }
      };
      if (model !== 'claude-sonnet-5') body.thinking = { type: 'adaptive' };

      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body
      };
    },

    read(json) {
      if (json.stop_reason === 'refusal') throw new Error('the model declined this request');
      return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    },

    errorOf(json) { return json?.error?.message || ''; }
  },

  /* ---------------------------------------------------------------------- */

  openai: {
    label: 'ChatGPT — OpenAI',
    keyHint: 'sk-proj-... or sk-...',
    keyUrl: 'platform.openai.com → API keys',
    freeTier: false,
    note: 'No free API tier — the API bills separately from a ChatGPT subscription. ' +
          'Browser calls could not be fully verified here; if every batch fails ' +
          'with "blocked by the browser", use Claude or Gemini instead.',
    keyPattern: /^sk-(proj-|svcacct-|[A-Za-z0-9])/,

    prefer: ['gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4o-mini', 'gpt-4.1-mini'],
    listUrl: () => 'https://api.openai.com/v1/models',
    listHeaders: key => ({ authorization: 'Bearer ' + key }),
    parseList: j => (j.data || []).map(m => m.id),

    models: [
      { id: 'gpt-4o',        label: 'GPT-4o',       in: 2.5,  out: 10 },
      { id: 'gpt-4.1',       label: 'GPT-4.1',      in: 2,    out: 8 },
      { id: 'gpt-4-turbo',   label: 'GPT-4 Turbo',  in: 10,   out: 30 },
      { id: 'gpt-4o-mini',   label: 'GPT-4o mini',  in: 0.15, out: 0.6 },
      { id: 'gpt-4.1-mini',  label: 'GPT-4.1 mini', in: 0.4,  out: 1.6 }
    ],

    build(key, model, effort, system, content) {
      const parts = content.map(c => c.text
        ? { type: 'text', text: c.text }
        : { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + c.image, detail: 'high' } });

      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: {
          model,
          max_tokens: 16000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: parts }
          ]
        }
      };
    },

    read(json) {
      const c = json.choices?.[0];
      if (c?.finish_reason === 'content_filter') throw new Error('blocked by content filter');
      return c?.message?.content || '';
    },

    errorOf(json) { return json?.error?.message || ''; }
  },

  /* ---------------------------------------------------------------------- */

  openrouter: {
    label: 'OpenRouter',
    keyHint: 'sk-or-v1-...',
    keyUrl: 'openrouter.ai → Keys',
    freeTier: true,
    note: 'One key reaching every provider, so a busy or exhausted model is ' +
          'routed around rather than stopping the run. Free models exist but ' +
          'are the weakest; the paid ones here are still fractions of a penny ' +
          'a page. Check openrouter.ai for each model’s data-retention terms ' +
          'before sending client evidence.',
    /* Distinctive enough to test before OpenAI's bare "sk-". */
    keyPattern: /^sk-or-/,

    prefer: [
      'google/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5', 'openai/gpt-4o',
      'google/gemini-2.5-flash', 'qwen/qwen2.5-vl-72b-instruct'
    ],

    /* Only models that can actually take an image are any use here, and the
       list is filtered to those before anything else looks at it. */
    listUrl: () => 'https://openrouter.ai/api/v1/models',
    listHeaders: key => ({ authorization: 'Bearer ' + key }),
    parseList(j) {
      const usable = (j.data || [])
        .filter(m => (m.architecture?.input_modalities || []).includes('image'))
          /* ":batch" is the queued endpoint — cheaper, but it returns later
           rather than now, so it is no use to an interactive run. */
        .filter(m => !/lyria|whisper|tts|embed|moderation|auto|:batch|:online/i.test(m.id));
      /* Prices come with the listing and vary per model, so keep them rather
         than showing "rate not on file" for every one of several hundred. */
      this.prices = {};
      for (const m of usable) {
        const inP = parseFloat(m.pricing?.prompt || 0) * 1e6;
        const outP = parseFloat(m.pricing?.completion || 0) * 1e6;
        if (inP >= 0 && outP >= 0) this.prices[m.id] = { in: inP, out: outP };
      }
      return usable.map(m => m.id);
    },
    prices: {},

    /* Hundreds of models come and go, so score the id by family rather than
       keeping a list that is stale within the month. */
    rank(id) {
      const s = id.toLowerCase();
      let n = 0;
      if (s.startsWith('google/gemini')) n = 900;
      else if (s.startsWith('anthropic/claude')) n = 950;
      else if (s.startsWith('openai/gpt')) n = 880;
      else if (s.startsWith('qwen/')) n = 700;
      else if (s.startsWith('mistralai/')) n = 650;
      else if (s.startsWith('meta-llama/')) n = 600;
      else if (s.startsWith('google/gemma')) n = 500;
      else n = 300;

      if (/pro|opus|sonnet-4|gpt-5|4o(?!-mini)/.test(s)) n += 120;
      if (/flash|mini|nano|lite|small|haiku/.test(s)) n -= 60;
      if (/:free/.test(s)) n -= 200;          // free variants are rate-limited and weaker
      if (/preview|beta|exp/.test(s)) n -= 30;

      /* A version is one or two digits, optionally with one decimal. Model
         names also carry date stamps — "mistral-small-2603" — and reading
         2603 as a version number puts a small model above Claude Opus. */
      const ver = /(?:^|[-\s])(\d{1,2}(?:\.\d)?)(?![\d.])/.exec(s.replace(/^[^/]*\//, ''));
      return n + Math.min(parseFloat(ver?.[1] || 0), 20) * 4;
    },

    models: [],       // priced live from the model list instead

    build(key, model, effort, system, content) {
      const parts = content.map(c => c.text
        ? { type: 'text', text: c.text }
        : { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + c.image } });

      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key,
          'HTTP-Referer': location.origin,      // OpenRouter asks callers to identify
          'X-Title': 'Nakshatra Query Finder'
        },
        body: {
          model,
          max_tokens: 16000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: parts }
          ]
        }
      };
    },

    read(json) {
      if (json.error) throw new Error(json.error.message || 'request refused');
      const c = json.choices?.[0];
      if (c?.finish_reason === 'content_filter') throw new Error('blocked by content filter');
      return c?.message?.content || '';
    },

    errorOf(json) { return json?.error?.message || ''; }
  },

  /* ---------------------------------------------------------------------- */

  gemini: {
    label: 'Gemini — Google',
    keyHint: 'AIza...',
    keyUrl: 'aistudio.google.com → Get API key',
    freeTier: true,
    note: 'Verified working, and the only one with a genuinely free tier. ' +
          'On the FREE tier Google may use what you send to improve their models — ' +
          'do not send client audit evidence through it. Paid tier does not train on your data.',
    /* Google issues "AIza…" and "AQ.…" — a hint for probe order, never a test. */
    keyPattern: /^(AIza|AQ\.)/,

    prefer: ['gemini-pro-latest', 'gemini-2.5-pro', 'gemini-flash-latest', 'gemini-2.5-flash'],

    /* Google ships new Gemini versions constantly, so score the id instead of
       maintaining a list that is stale the week after it is written. */
    excludeRe: /(image|tts|transcribe|audio|music|lyria|nano-banana|robotics|computer-use|deep-research|antigravity|embedding|aqa|gemma|learnlm|omni)/i,
    rank(id) {
      /* the "-latest" aliases always resolve to Google's current best */
      if (id === 'gemini-pro-latest') return 1e7;
      if (id === 'gemini-flash-latest') return 9e6;

      const m = id.match(/^gemini-(\d+(?:\.\d+)?)-(pro|flash)(-lite)?/);
      if (!m) return -1;
      const version = parseFloat(m[1]);
      const tier = m[2] === 'pro' ? 300 : (m[3] ? 100 : 200);
      const stable = /preview|exp|-\d{2}-\d{4}$/.test(id) ? 0 : 10;
      /* Lite variants read a little less well but are far less contended, so
         they stay in the fallback chain rather than being ranked out of it —
         when the headline models are all shedding load, these still answer. */
      return version * 1000 + tier + stable;
    },
    listUrl: key => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    listHeaders: () => ({}),
    parseList: j => (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, '')),

    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   in: 1.25, out: 10 },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', in: 0.30, out: 2.5 },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', in: 0,    out: 0 },
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro',   in: 1.25, out: 5 }
    ],

    build(key, model, effort, system, content) {
      const parts = content.map(c => c.text
        ? { text: c.text }
        : { inline_data: { mime_type: 'image/jpeg', data: c.image } });

      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: {
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { maxOutputTokens: 32000, temperature: 0.2 }
        }
      };
    },

    read(json) {
      const cand = json.candidates?.[0];
      if (!cand) throw new Error('no answer returned');
      if (cand.finishReason === 'SAFETY') throw new Error('blocked by safety filter');
      return (cand.content?.parts || []).map(p => p.text || '').join('');
    },

    errorOf(json) { return json?.error?.message || ''; }
  }
};

/* Only a fallback — the pasted key decides the provider. Gemini, so nothing
   is ever charged without the user deliberately supplying a paid key. */
export const DEFAULT_PROVIDER = 'gemini';

/* --------------------------------------------------------------------------
   Work out the provider by ASKING each one, not by reading the key's prefix.
   Google alone issues both "AIza…" and "AQ.…" keys, and vendors add new
   formats whenever they like — so the prefix is only a hint for what to try
   first. Whoever answers 200 owns the key.

   Returns { provider, models } — the model list comes free with the probe,
   so resolveModel never has to fetch it twice.
   -------------------------------------------------------------------------- */
export async function detectProvider(key, signal) {
  const k = (key || '').trim();
  if (!k) return null;

  /* try the likely one first, but never trust it enough to skip the others */
  const order = Object.keys(PROVIDERS).sort((a, b) =>
    (PROVIDERS[b].keyPattern.test(k) ? 1 : 0) - (PROVIDERS[a].keyPattern.test(k) ? 1 : 0));

  const attempts = order.map(async id => {
    const P = PROVIDERS[id];
    const res = await fetch(P.listUrl(k), { headers: P.listHeaders(k), signal });
    if (!res.ok) throw new Error(id + ' rejected');
    return { provider: id, models: P.parseList(await res.json()) };
  });

  /* first success wins; if every one fails we genuinely don't know the key */
  const results = await Promise.allSettled(attempts);
  for (const r of results) if (r.status === 'fulfilled') return r.value;
  return null;
}

/* --------------------------------------------------------------------------
   Ask the key which models it may use, then take the most capable one this
   app knows how to drive. Falls back to the preference list when the account
   cannot list models (some keys are scoped without that permission).
   Returns { model, label, detected, note }.
   -------------------------------------------------------------------------- */
export function resolveModel(providerId, available) {
  const P = PROVIDERS[providerId];
  const named = id => P.models.find(m => m.id === id);

  if (!available || !available.length) {
    const fb = P.prefer[0];
    return {
      model: fb, label: named(fb)?.label || fb, detected: false,
      note: 'this key could not list its models — assuming the best one'
    };
  }

  /* A provider with a ranker scores every model it is actually offered, so a
     version released after this code was written still wins on merit. */
  if (P.rank) {
    const scored = available
      .filter(id => !P.excludeRe?.test(id))
      .map(id => ({ id, score: P.rank(id) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.id);

    if (scored.length) {
      return {
        model: scored[0],
        label: named(scored[0])?.label || pretty(scored[0]),
        detected: true,
        /* Ranking says which is best; only a real call says which WORKS.
           A free key is offered Pro models it has zero quota for, and
           withdrawn models still appear in the list. */
        /* Deep enough to reach the older, stable models. On a free Gemini key
           the newest model has the SMALLEST allowance — gemini-3.8-flash caps
           at 20 requests — while 2.x flash and the lite variants run far
           longer, so the fallback chain has to get all the way down to them. */
        candidates: scored.slice(0, 14)
      };
    }
  }

  /* otherwise walk the explicit preference list, allowing dated snapshots */
  for (const want of P.prefer) {
    if (available.includes(want)) {
      return { model: want, label: named(want)?.label || pretty(want), detected: true };
    }
    const snap = available.find(a => a.startsWith(want + '-'));
    if (snap) return { model: snap, label: named(want)?.label || pretty(snap), detected: true };
  }

  return {
    model: available[0], label: pretty(available[0]), detected: true,
    note: 'none of the familiar models were offered — using the first available'
  };
}

/* "gemini-3.1-pro-preview" -> "Gemini 3.1 Pro Preview" */
function pretty(id) {
  return String(id)
    .replace(/[-_]/g, ' ')
    .replace(/\b([a-z])/g, c => c.toUpperCase())
    .replace(/\bGpt\b/, 'GPT');
}

/* Roughly (w x h)/750 tokens per page; good enough to price a folder. */
export function estimateCost(pageCount, providerId, modelId) {
  const P = PROVIDERS[providerId];
  /* a provider that prices per model from its live listing */
  const m = P?.prices?.[modelId] || P?.models.find(x => x.id === modelId);
  if (!m) return null;                 // auto-picked a model with no rate on file
  const inTok = pageCount * (2450 + 120);
  const outTok = pageCount * 170;
  return (inTok * m.in + outTok * m.out) / 1e6;
}
