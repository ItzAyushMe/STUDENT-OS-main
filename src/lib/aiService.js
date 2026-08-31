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

// Fallback chains — the first entry is the default model. If the API
// returns "model not found" (deprecation/rollout), we try the next.
const GEMINI_MODELS = [AI_MODELS.gemini, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const GROQ_MODELS = [AI_MODELS.groq, 'llama-3.1-8b-instant', 'llama-3.3-70b-specdec'];

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
  return /404|not found|NOT_FOUND|does not exist|decommissioned|unsupported model/i.test(String(errMsg));
}

async function callGemini(args) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      return await geminiRequest(model, args);
    } catch (e) {
      lastErr = e;
      if (looksLikeMissingModel(e?.message)) continue; // try next model
      throw e; // auth/quota/network error — trying other models won't help
    }
  }
  throw lastErr;
}

async function callGroq(args) {
  let lastErr;
  for (const model of GROQ_MODELS) {
    try {
      return await groqRequest(model, args);
    } catch (e) {
      lastErr = e;
      if (looksLikeMissingModel(e?.message)) continue;
      throw e;
    }
  }
  throw lastErr;
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
      cache.set(ck, { ts: Date.now(), value });
      return value;
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
  const detail = failures.join(' | ').slice(0, 220);
  throw new AIUnavailableError(
    `AI call fail ho gayi. Details: ${detail}\n\nKey sahi hai? Gemini keys aistudio.google.com/apikey se, Groq keys console.groq.com/keys se. Key check karke dobara try karo! 💪`
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
You believe in small daily wins, spaced repetition, revision cycles and healthy routines.`;
