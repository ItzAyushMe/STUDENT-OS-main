// ============================================================
// StudentOS — AI service (the ONLY module features call for AI)
//
// - Providers: Google Gemini (gemini-2.0-flash) and Groq
//   (llama-3.3-70b-versatile). Switch via config/constants.js
//   AI_PROVIDER, env EXPO_PUBLIC_AI_PROVIDER, or Settings screen.
// - Automatic fallback: if the primary provider fails, the other
//   one is tried.
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
  await AsyncStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
  cache.clear();
  return runtime;
}

function providerOrder() {
  const primary = (runtime.provider || AI_PROVIDER || 'gemini').toLowerCase();
  const secondary = primary === 'gemini' ? 'groq' : 'gemini';
  return [primary, secondary];
}

function keyFor(provider) {
  if (provider === 'gemini') return runtime.geminiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  if (provider === 'groq') return runtime.groqKey || process.env.EXPO_PUBLIC_GROQ_API_KEY || '';
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
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }
    const state = await NetInfo.fetch();
    return Boolean(state?.isConnected);
  } catch {
    return true; // don't block on unknown
  }
}

// ---------- cache ----------
const cache = new Map();
function cacheKey(provider, prompt, system, json) {
  return `${provider}|${json ? 'j' : 't'}|${system || ''}|${prompt}`;
}

// ---------- raw provider calls ----------
async function callGemini({ prompt, system, json, temperature, key }) {
  const model = AI_MODELS.gemini;
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
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 180)}`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

async function callGroq({ prompt, system, json, temperature, key }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const body = {
    model: AI_MODELS.groq,
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
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groq returned an empty response.');
  return text;
}

// ---------- public API ----------
export async function askAI({ prompt, system = '', json = false, temperature, noCache = false }) {
  const online = await isOnline();
  if (!online) {
    throw new AIUnavailableError(
      "You're offline, yaar. AI needs internet — but your quests, timer and habits are still fully working! 📴"
    );
  }

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
      // try the next provider
      console.warn(`[aiService] ${provider} failed:`, e?.message);
    }
  }

  const status = aiStatus();
  if (!status.anyConfigured) {
    throw new AIUnavailableError(
      'AI keys missing hai. Add a Gemini or Groq API key in Settings (ya .env file) — tab Professor Byte full power mein aayenge! ⚡'
    );
  }
  throw new AIUnavailableError(
    'AI thoda busy hai (ya keys galat hain). Thodi der baad try karo — meanwhile padhai continue! 💪'
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
