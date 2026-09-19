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
    models: [
      { id: 'claude-opus-5',   label: 'Opus 5 — most accurate', in: 5,  out: 25 },
      { id: 'claude-sonnet-5', label: 'Sonnet 5 — cheaper',     in: 2,  out: 10 }
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
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o — accurate',  in: 2.5,  out: 10 },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini — cheap', in: 0.15, out: 0.6 }
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
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro — accurate', in: 1.25, out: 10 },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — cheap',  in: 0.30, out: 2.5 },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — free tier', in: 0, out: 0 }
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

/* Gemini by default: it is the only one with a free tier, and nothing is
   charged before the user deliberately switches. */
export const DEFAULT_PROVIDER = 'gemini';

/* Roughly (w x h)/750 tokens per page; good enough to price a folder. */
export function estimateCost(pageCount, providerId, modelId) {
  const p = PROVIDERS[providerId];
  const m = p?.models.find(x => x.id === modelId) || p?.models[0];
  if (!m) return 0;
  const inTok = pageCount * (2450 + 120);
  const outTok = pageCount * 170;
  return (inTok * m.in + outTok * m.out) / 1e6;
}
