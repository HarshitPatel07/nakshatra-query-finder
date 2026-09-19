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
        model, max_tokens: 8000, system,
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
          max_tokens: 8000,
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

  gemini: {
    label: 'Gemini — Google',
    keyHint: 'AIza...',
    keyUrl: 'aistudio.google.com → Get API key',
    freeTier: true,
    note: 'Verified working, and the only one with a genuinely free tier. ' +
          'On the FREE tier Google may use what you send to improve their models — ' +
          'do not send client audit evidence through it. Paid tier does not train on your data.',
    keyPattern: /^AIza/,

    prefer: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
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
          generationConfig: { maxOutputTokens: 8000, temperature: 0.2 }
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
   Work out the provider from the shape of the key. Anthropic and Gemini carry
   unmistakable prefixes; OpenAI's plain "sk-" is the catch-all, so it is
   tested last.
   -------------------------------------------------------------------------- */
export function detectProvider(key) {
  const k = (key || '').trim();
  if (!k) return null;
  for (const id of ['anthropic', 'gemini']) {
    if (PROVIDERS[id].keyPattern.test(k)) return id;
  }
  return PROVIDERS.openai.keyPattern.test(k) ? 'openai' : null;
}

/* --------------------------------------------------------------------------
   Ask the key which models it may use, then take the most capable one this
   app knows how to drive. Falls back to the preference list when the account
   cannot list models (some keys are scoped without that permission).
   Returns { model, label, detected, note }.
   -------------------------------------------------------------------------- */
export async function resolveModel(providerId, key, signal) {
  const P = PROVIDERS[providerId];
  const best = id => P.models.find(m => m.id === id);

  let available = null;
  try {
    const res = await fetch(P.listUrl(key), { headers: P.listHeaders(key), signal });
    if (res.ok) available = P.parseList(await res.json());
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    /* listing is a convenience, never a blocker */
  }

  if (available && available.length) {
    /* exact match first, then a prefix match so dated snapshots still count */
    for (const want of P.prefer) {
      if (available.includes(want)) {
        return { model: want, label: best(want)?.label || want, detected: true };
      }
      const snap = available.find(a => a.startsWith(want + '-') || a.startsWith(want));
      if (snap) return { model: snap, label: best(want)?.label || snap, detected: true };
    }
    return {
      model: available[0],
      label: available[0],
      detected: true,
      note: 'none of the known models were offered — using the first available'
    };
  }

  const fb = P.prefer[0];
  return {
    model: fb,
    label: best(fb)?.label || fb,
    detected: false,
    note: 'could not list models for this key — assuming the best one'
  };
}

/* Roughly (w x h)/750 tokens per page; good enough to price a folder. */
export function estimateCost(pageCount, providerId, modelId) {
  const p = PROVIDERS[providerId];
  const m = p?.models.find(x => x.id === modelId) || p?.models[0];
  if (!m) return 0;
  const inTok = pageCount * (2450 + 120);
  const outTok = pageCount * 170;
  return (inTok * m.in + outTok * m.out) / 1e6;
}
