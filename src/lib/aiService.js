// ============================================================
// StudentOS — AI service (the ONLY module features call for AI)
//
// - Providers: Google Gemini and Groq (Llama). Switch via config/
//   env EXPO_PUBLIC_AI_PROVIDER, or at runtime in Settings.
// - Model fallback: if a model is unavailable/deprecated (404),
//   the next model in the chain is tried automatically.
// - Provider fallback: if the primary provider fails, the other
//   one is tried. Real errors are surfaced so you can diagnose.
// - Response caching for common prompts (30 min).
// - Graceful degradation: friendly errors, never a crash.
//
//   askAI({ prompt, system, json, temperature }) -> string
//   askAIJSON({ prompt, system, schemaHint })     -> object
// ============================================================
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AI_PROVIDER, AI_MODELS } from '../config/constants';

export class AIUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CACHE_TTL = 30 * 60 * 1000;
const RUNTIME_KEY = 'sos.ai.runtime';

// Fallback chains — the first entry is the default model.
// llama-3.3-70b-specdec was DECOMMISSIONED by Groq and is removed.
// L-10 (audit): gemini-1.5-flash is retired — pruned. Prefer the
// -latest alias first so future model swaps need no code change.
const GEMINI_MODELS = ['gemini-flash-latest', AI_MODELS.gemini, 'gemini-2.5-flash'];
const GROQ_MODELS = [AI_MODELS.groq, 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];

// ---------- runtime config (Settings screen overrides env) ----------
let runtime = {
  provider: null, // null -> use AI_PROVIDER constant
  geminiKey: null,
  groqKey: null,
};

export async function initRuntimeConfig() {
  try {
    const raw = await AsyncStorage.getItem(RUNTIME_KEY);
    if (raw) runtime = { ...runtime, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return runtime;
}

export async function setRuntimeConfig(patch) {
  runtime = { ...runtime, ...patch };
  try {
    await AsyncStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
  } catch {
    /* ignore */
  }
  cache.clear();
  return runtime;
}

function providerOrder() {
  const primary = (runtime.provider || AI_PROVIDER || 'gemini').toLowerCase();
  const secondary = primary === 'gemini' ? 'groq' : 'gemini';
  return [primary, secondary];
}

function keyFor(provider) {
  if (provider === 'gemini') return (runtime.geminiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY || '').trim();
  if (provider === 'groq') return (runtime.groqKey || process.env.EXPO_PUBLIC_GROQ_API_KEY || '').trim();
  return '';
}

export function aiStatus() {
  return {
    provider: providerOrder()[0],
    geminiConfigured: Boolean(keyFor('gemini')),
    groqConfigured: Boolean(keyFor('groq')),
    anyConfigured: Boolean(keyFor('gemini') || keyFor('groq')),
  };
}

// ---------- connectivity ----------
export async function isOnline() {
  try {
    if (Platform.OS === 'web') {
      // trust the browser first
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
      return true;
    }
    const state = await NetInfo.fetch();
    if (state && typeof state.isConnected === 'boolean') return state.isConnected;
    return true; // don't block on unknown
  } catch {
    return true;
  }
}

// ---------- connectivity self-test (runs once on startup) ----------
// Cheap ping so the app can show a real "AI not connected" banner
// instead of features failing silently. Result is cached.
let selfTestPromise = null;
export function selfTestAI() {
  if (!aiStatus().anyConfigured) {
    return Promise.resolve({ ok: false, reason: 'no-key' });
  }
  if (!selfTestPromise) {
    selfTestPromise = (async () => {
      try {
        const reply = await askAI({
          prompt: 'Reply with exactly: OK',
          system: 'You are a health check. Reply with exactly: OK',
          temperature: 0,
          noCache: true,
        });
        return { ok: true, provider: aiStatus().provider };
      } catch (e) {
        return { ok: false, reason: e instanceof AIUnavailableError ? e.message : 'unknown' };
      }
    })();
    // allow re-testing later (e.g. after the user adds a key)
    selfTestPromise.finally(() => {
      setTimeout(() => { selfTestPromise = null; }, 60 * 1000);
    }).catch(() => {});
  }
  return selfTestPromise;
}

// ---------- cache ----------
const cache = new Map();
function cacheKey(provider, prompt, system, json) {
  return `${provider}|${json ? 'j' : 't'}|${system || ''}|${prompt}`;
}

// ---------- raw provider calls ----------
async function geminiRequest(model, { prompt, system, json, temperature, key }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: 4096,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 160)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

async function groqRequest(model, { prompt, system, json, temperature, key }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const body = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: 4096,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 160)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groq returned an empty response.');
  return text;
}

function looksLikeMissingModel(errMsg) {
  return /404|not found|NOT_FOUND|does not exist|decommissioned|unsupported model|model_not_found/i.test(String(errMsg));
}

// Transient failures worth retrying: overload (503), rate limit (429),
// bad gateway (502/504). These are common on free tiers.
function isRetryable(errMsg) {
  return /429|502|503|504|overload|high demand|rate.?limit|too many requests|service unavailable|temporarily/i.test(
    String(errMsg)
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call a provider with model fallback + retry-with-backoff:
//  - primary model gets 3 attempts (2s → 4s backoff) on transient errors
//  - transient/missing-model errors then advance to the next model
//  - auth errors fail fast (retrying won't help)
async function callProvider(models, requester, args) {
  let lastErr;
  for (let mi = 0; mi < models.length; mi++) {
    const attempts = mi === 0 ? 3 : 1; // backoff retries only on the primary model
    const waits = [0, 2000, 4000];
    for (let a = 0; a < attempts; a++) {
      if (waits[a]) await sleep(waits[a]);
      try {
        return await requester(models[mi], args);
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || '');
        if (isRetryable(msg) && a < attempts - 1) continue; // wait + retry same model
        if (isRetryable(msg) || looksLikeMissingModel(msg)) break; // next model
        throw e; // hard error (bad key, bad request…) — no point continuing
      }
    }
  }
  throw lastErr;
}

async function callGemini(args) {
  return callProvider(GEMINI_MODELS, geminiRequest, args);
}

async function callGroq(args) {
  return callProvider(GROQ_MODELS, groqRequest, args);
}

// Plain-English translation of provider errors (FIX C: honest messages).
function humanizeError(provider, errMsg) {
  const m = String(errMsg || '');
  if (/decommissioned|not found|does not exist|model_not_found/i.test(m)) {
    return `${provider} ka model retire ho gaya tha — naye build me fix ho gaya hai. App refresh karke try karo.`;
  }
  if (/503|overload|high demand|service unavailable/i.test(m)) {
    return `${provider} servers busy hain (free tier pe common hai) — thodi der baad try karo.`;
  }
  if (/429|rate.?limit|too many requests/i.test(m)) {
    return `${provider} rate limit hit — ek minute ruk ke dobara try karo.`;
  }
  if (/401|403|api[ _]?key|invalid|permission/i.test(m)) {
    return `${provider} key accept nahi hui — key dobara check karo.`;
  }
  if (/failed to fetch|network|offline/i.test(m)) {
    return `${provider} tak network nahi pahunch raha — connection check karo.`;
  }
  return `${provider}: ${m.slice(0, 140)}`;
}

// ---------- markdown stripping (belt & suspenders) ----------
// Even with the persona rule, LLMs sometimes emit **bold** / - bullets.
// Every NON-JSON answer is cleaned so the UI never shows raw markdown.
export function stripMarkdown(text) {
  if (typeof text !== 'string') return text;
  let t = text;
  t = t.replace(/```[a-z]*\n?/gi, ''); // code fences
  t = t.replace(/^#{1,6}\s+/gm, ''); // headings
  t = t.replace(/(?! )\*\*([^*]+?)\*\*(?! )/g, '$1'); // **bold**
  t = t.replace(/(^|\s)\*([^*\n]+?)\*(?=\s|$|[.,!?])/g, '$1$2'); // *italic*
  t = t.replace(/(^|\s)_([^_\n]+?)_(?=\s|$|[.,!?])/g, '$1$2'); // _italic_
  t = t.replace(/^\s*[-*•]\s+/gm, '• '); // dash/star bullets -> •
  t = t.replace(/\|/g, '·'); // table pipes
  t = t.replace(/\n{3,}/g, '\n\n'); // collapse gaps
  return t.trim();
}

// ---------- public API ----------
export async function askAI({ prompt, system = '', json = false, temperature, noCache = false }) {
  const online = await isOnline();
  if (!online) {
    throw new AIUnavailableError(
      "You're offline, yaar. AI needs internet — but your quests, timer and habits are still fully working! 📴"
    );
  }

  const failures = [];
  for (const provider of providerOrder()) {
    const key = keyFor(provider);
    if (!key) continue;
    const ck = cacheKey(provider, prompt, system, json);
    if (!noCache && cache.has(ck)) {
      const hit = cache.get(ck);
      if (Date.now() - hit.ts < CACHE_TTL) return hit.value;
    }
    try {
      const value = await (provider === 'gemini'
        ? callGemini({ prompt, system, json, temperature, key })
        : callGroq({ prompt, system, json, temperature, key }));
      const clean = json ? value : stripMarkdown(value);
      cache.set(ck, { ts: Date.now(), value: clean });
      return clean;
    } catch (e) {
      failures.push(`${provider}: ${e?.message || 'failed'}`);
      console.warn(`[aiService] ${provider} failed:`, e?.message);
      // try the next provider
    }
  }

  const status = aiStatus();
  if (!status.anyConfigured) {
    throw new AIUnavailableError(
      'AI keys missing hai. Add a Gemini or Groq API key in Settings (ya .env file) — tab Professor Byte full power mein aayenge! ⚡'
    );
  }
  // Honest, human-readable reasons — no misleading "check your key"
  // when the key is fine (e.g. provider overloaded / model retired).
  const reasons = failures.map((f) => {
    const [provider, ...rest] = String(f).split(':');
    return humanizeError(provider.trim(), rest.join(':').trim());
  });
  const unique = [...new Set(reasons)];
  throw new AIUnavailableError(
    `AI thodi der ke liye busy hai. Asli wajah: ${unique.join(' | ').slice(0, 260)}\n\nAuto-retry + dusre provider pe fallback ho chuka hai. Thodi der baad dobara try karo 💪`
  );
}

// Robust JSON extraction (LLMs love wrapping JSON in prose/fences)
function extractJSON(text) {
  if (typeof text !== 'string') return text;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* keep digging */
  }
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start = -1;
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) start = firstObj;
  else if (firstArr >= 0) start = firstArr;
  if (start >= 0) {
    const openCh = t[start];
    const closeCh = openCh === '{' ? '}' : ']';
    const end = t.lastIndexOf(closeCh);
    if (end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* ignore */
      }
    }
  }
  throw new AIUnavailableError('AI ka answer samajh nahi aaya. Dobara try karo!');
}

export async function askAIJSON({ prompt, system = '', schemaHint = '', temperature = 0.4, noCache = false }) {
  const sys = `${system}\nReturn ONLY valid minified JSON. No markdown fences, no commentary.${
    schemaHint ? `\nExpected shape: ${schemaHint}` : ''
  }`;
  const text = await askAI({ prompt, system: sys, json: true, temperature, noCache });
  return extractJSON(text);
}

// Shared persona for all StudentOS AI features — Hinglish, warm, never condescending.
export const AI_PERSONA = `You are Professor Byte, the friendly AI mentor inside StudentOS — a free, gamified study app for Indian students (Class 6 to college).
Style: warm, encouraging, game-like. Light Hinglish flavor is welcome (words like "Shaabaash!", "Shuru karo", "Accha", "yaar") but keep it easy to understand — the base language is simple English.
Never condescending, never scold. Keep answers practical and short-ish unless depth is requested.
You believe in small daily wins, spaced repetition, revision cycles and healthy routines.

FORMATTING (very important — the app renders plain text, not Markdown):
- NEVER use Markdown: no **bold**, no *italics*, no ## headings, no - dash bullets, no | tables, no \`\`\` code fences.
- Write plain sentences. For emphasis use plain words.
- If a short list genuinely helps, use a single '•' on its own line — nothing else.
- Keep everything plain and readable on a phone.

MATH NOTATION (very important — the app renders plain text, not LaTeX):
- NEVER write LaTeX: no \\frac, no \\sqrt{...}, no \\lfloor, no \\begin{...}, no $...$ wrappers.
- Fractions as a/b: d/dx, 1/2, dv/dt. Roots as sqrt(x) or √x. Floor as floor(x) or ⌊x⌋, ceiling as ceil(x) or ⌈x⌉.
- Powers as x^2 or x^(n+1). Integrals as ∫, infinity as ∞, theta as θ, pi as π.
- Unicode symbols welcome: √ · × ÷ ± ≤ ≥ ≠ ≈ ∫ ∞ → ⇒ Δ Σ.
- Keep each equation on ONE line, plain and readable for a school student.`;
