// ============================================================
// StudentOS — FIX-G testGenKit
// Pure helpers for AI test/question-bank/mind-map generation.
// NO react-native and NO aiService imports, so every rule here is
// unit-testable in scripts/logic-test.mjs (G0-G4, G6 semantics).
//
// Deliberately does NOT import testQuestionNormalizer.js — that module
// imports clampDifficultyTag from here, so importing back would create a
// cycle. Callers inject their normalizer via `normalize`.
// ============================================================

// G1: Groq has a 413 history on large payloads — 10 per request, not 20.
export const QB_BATCH_SIZE = 10;

export const QB_TYPES = ['mcq', 'vsaq', 'saq', 'laq'];

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

// ---------- G0: stem resolution ----------
// The AI aliases the stem field freely (q / question / text / prompt / title).
// Every render, print and share path must go through stemOf() so a question
// never shows as "Q1." with nothing after it.
export function stemOf(q) {
  if (!q) return '';
  if (typeof q === 'string') return q.trim();
  const raw = q.q ?? q.question ?? q.text ?? q.prompt ?? q.title ?? q.stem ?? '';
  return typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
}

export function hasValidStem(q) {
  return stemOf(q).length >= 3;
}

// Drop empty-stem questions and COUNT them, so the UI can say
// "N malformed questions skipped" instead of rendering blank rows.
export function validateStems(list) {
  const arr = Array.isArray(list) ? list : [];
  const kept = [];
  let skipped = 0;
  for (const item of arr) {
    if (hasValidStem(item)) kept.push(item);
    else skipped++;
  }
  return { kept, skipped };
}

// ---------- G1: exact per-type allocation ----------
// Largest-remainder allocation so per-type counts always sum EXACTLY to total.
function allocate(weights, total, order) {
  const keys = order.filter((k) => num(weights[k]) > 0);
  const W = keys.reduce((a, k) => a + num(weights[k]), 0);
  const out = {};
  for (const k of order) out[k] = 0;
  if (!keys.length || W <= 0 || total <= 0) return out;
  const exact = {};
  let floorSum = 0;
  for (const k of keys) {
    const e = (num(weights[k]) * total) / W;
    exact[k] = e;
    out[k] = Math.floor(e);
    floorSum += out[k];
  }
  let rest = total - floorSum;
  // hand the remainder to the largest fractional parts; ties -> canonical order
  const ranked = keys.slice().sort((a, b) => {
    const fa = exact[a] - Math.floor(exact[a]);
    const fb = exact[b] - Math.floor(exact[b]);
    if (fb !== fa) return fb - fa;
    return order.indexOf(a) - order.indexOf(b);
  });
  let i = 0;
  while (rest > 0 && ranked.length) {
    out[ranked[i % ranked.length]] += 1;
    rest--;
    i++;
  }
  return out;
}

// Default mix used when the caller supplies no usable breakdown.
const DEFAULT_MIX = { mcq: 10, vsaq: 4, saq: 4, laq: 2 };

// Scale any requested mix to `total` questions, exactly.
export function scaleBreakdown(breakdown, total) {
  const t = Math.max(0, Math.floor(num(total)));
  const src = breakdown && typeof breakdown === 'object' ? breakdown : {};
  const weights = {};
  let any = false;
  for (const k of QB_TYPES) {
    weights[k] = num(src[k]);
    if (weights[k] > 0) any = true;
  }
  return allocate(any ? weights : DEFAULT_MIX, t, QB_TYPES);
}

export function countByType(questions) {
  const out = { mcq: 0, vsaq: 0, saq: 0, laq: 0 };
  for (const q of Array.isArray(questions) ? questions : []) {
    const t = String(q?.type || '').toLowerCase();
    const hit = QB_TYPES.find((k) => t.includes(k));
    if (hit) out[hit] += 1;
  }
  return out;
}

export function totalOf(counts) {
  return QB_TYPES.reduce((a, k) => a + num(counts?.[k]), 0);
}

// Only the types that are still short — zero entries are omitted so a top-up
// batch never re-requests a type that is already satisfied.
export function missingByType(targets, have) {
  const out = {};
  for (const k of QB_TYPES) {
    const m = num(targets?.[k]) - num(have?.[k]);
    if (m > 0) out[k] = m;
  }
  return out;
}

// Plan ONE batch: request only what is missing, capped at batchSize.
// Every still-missing type is guaranteed at least 1 slot when the batch is big
// enough — otherwise a proportionally tiny shortfall (e.g. 1 LAQ against 30 SAQ)
// can be starved to zero and the bank would never converge.
export function planBatch(targets, have, batchSize = QB_BATCH_SIZE) {
  const miss = missingByType(targets, have);
  const missTotal = totalOf(miss);
  const cap = Math.max(1, Math.floor(num(batchSize, QB_BATCH_SIZE)));
  const reqCount = Math.min(cap, missTotal);
  if (reqCount <= 0) return { reqCount: 0, ask: {}, missing: miss };

  const missingKeys = QB_TYPES.filter((k) => num(miss[k]) > 0);
  let ask;
  if (missingKeys.length > 1 && reqCount >= missingKeys.length) {
    // reserve 1 per missing type, then split the rest proportionally to shortfall
    const restWeights = {};
    for (const k of missingKeys) restWeights[k] = Math.max(0, num(miss[k]) - 1);
    const restTotal = reqCount - missingKeys.length;
    const spread = restTotal > 0 ? allocate(restWeights, restTotal, QB_TYPES) : {};
    ask = {};
    for (const k of QB_TYPES) {
      const v = (missingKeys.includes(k) ? 1 : 0) + num(spread[k]);
      if (v > 0) ask[k] = Math.min(v, num(miss[k]));
    }
    // trimming to the real shortfall can free slots — hand them back to the largest need
    let used = Object.values(ask).reduce((a, b) => a + b, 0);
    let guard = 0;
    while (used < reqCount && guard++ < 64) {
      const room = missingKeys.filter((k) => num(ask[k] || 0) < num(miss[k])).sort((a, b) => (num(miss[b]) - num(ask[b] || 0)) - (num(miss[a]) - num(ask[a] || 0)));
      if (!room.length) break;
      ask[room[0]] = num(ask[room[0]] || 0) + 1;
      used++;
    }
  } else {
    ask = allocate(miss, reqCount, QB_TYPES);
    for (const k of Object.keys(ask)) if (ask[k] <= 0) delete ask[k];
  }
  return { reqCount, ask, missing: miss };
}

// How many batches we are willing to spend before admitting a partial result.
export function batchCapFor(total, batchSize = QB_BATCH_SIZE) {
  const cap = Math.max(1, Math.floor(num(batchSize, QB_BATCH_SIZE)));
  return Math.max(8, Math.ceil(num(total) / cap) * 3);
}

export function dedupeByStem(list, seenStems) {
  const seen = seenStems instanceof Set ? seenStems : new Set((Array.isArray(seenStems) ? seenStems : []).map((s) => String(s).trim().toLowerCase()));
  const kept = [];
  let duplicates = 0;
  for (const item of Array.isArray(list) ? list : []) {
    const s = stemOf(item).toLowerCase();
    if (!s) continue;
    if (seen.has(s)) { duplicates++; continue; }
    seen.add(s);
    kept.push(item);
  }
  return { kept, duplicates, seen };
}

// Lightweight normalizer used when the caller does not inject one.
function normalizeBankQuestion(raw, fallbackType) {
  if (!raw) return null;
  const stem = stemOf(raw);
  if (stem.length < 3) return null;
  const declared = String(raw.type || '').toLowerCase();
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o).trim()).filter(Boolean) : [];
  let type = QB_TYPES.find((k) => declared.includes(k));
  if (!type) type = options.length >= 2 ? 'mcq' : (QB_TYPES.find((k) => String(fallbackType || '').toLowerCase().includes(k)) || 'saq');
  if (type === 'mcq' && options.length < 2) type = 'saq';
  return {
    ...raw,
    q: stem.slice(0, 600),
    type,
    options: type === 'mcq' ? options.slice(0, 4) : [],
    answer: raw.answer ?? raw.answer_text ?? '',
    difficulty: clampDifficultyTag(raw.difficulty, 2),
  };
}

// ---------- G2: difficulty obedience ----------
export function difficultyBandName(pct) {
  const p = num(pct, 100);
  if (p <= 40) return 'easy';
  if (p <= 110) return 'medium';
  if (p <= 150) return 'hard';
  return 'very hard';
}

// Concrete prompt language per band — a blind reader must be able to tell
// easy / medium / hard generations apart.
export function difficultyInstruction(pct) {
  const p = num(pct, 100);
  const band = difficultyBandName(p);
  if (band === 'easy') {
    return `Difficulty band: EASY (${p}%). Write recall-level questions only — definitions, direct facts, names, one-step substitutions straight from the chapter. Every answer must be retrievable by remembering a single definition or fact. No application, no multi-concept reasoning.`;
  }
  if (band === 'medium') {
    return `Difficulty band: MEDIUM (${p}%). Write application-level questions — apply a stated rule or formula to a familiar situation, compare two ideas, explain a cause and effect, interpret a standard NCERT-style scenario. One reasoning step beyond recall.`;
  }
  if (band === 'hard') {
    return `Difficulty band: HARD (${p}%). Write multi-step HOTS questions — combine two or more concepts, unfamiliar patterns, numerical chains with 2+ steps, assertion-reason and case-based items that require derivation rather than recall.`;
  }
  return `Difficulty band: VERY HARD (${p}%). Write olympiad-level multi-step HOTS — unfamiliar patterns, proof-style derivation, cross-chapter synthesis, and non-routine numerical problems needing 3+ reasoning steps.`;
}

// Per-question difficulty tag, validated to 1-3 (never NaN, never out of range).
export function clampDifficultyTag(value, def = 2) {
  const fallback = Math.min(3, Math.max(1, Math.round(num(def, 2)) || 2));
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3, Math.max(1, Math.round(n)));
}

// ---------- G3: answer quality ----------
const ANSWER_WINDOWS = { vsaq: { min: 10, max: 20 }, saq: { min: 20, max: 30 }, laq: { min: 50, max: 60 } };

export function answerWindow(type) {
  const t = String(type || '').toLowerCase();
  const hit = ['vsaq', 'saq', 'laq'].find((k) => t.includes(k));
  return hit ? { ...ANSWER_WINDOWS[hit] } : null;
}

export function answerWordCount(text) {
  const s = String(text ?? '').replace(/\*\*/g, ' ').replace(/[•\-*]\s+/g, ' ');
  const parts = s.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9'’/-]/g, '')).filter(Boolean);
  return parts.length;
}

export function answerTextOf(q) {
  if (!q) return '';
  const a = q.answer ?? q.answer_text ?? q.model_answer ?? q.solution ?? '';
  return typeof a === 'string' ? a : String(a ?? '');
}

export function isAnswerInRange(q) {
  const w = answerWindow(q?.type);
  if (!w) return true; // MCQ and unknown types have no word window
  const n = answerWordCount(answerTextOf(q));
  return n >= w.min && n <= w.max;
}

export function answersOutOfWindow(questions) {
  return (Array.isArray(questions) ? questions : []).filter((q) => !isAnswerInRange(q));
}

// Render answers as bullet points.
export function toBullets(text) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  const lines = s
    .split(/\r?\n|(?<=[.;])\s+(?=[•\-*]|\d+[.)])/)
    .map((l) => l.replace(/^\s*(?:[•\-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length ? lines : [s];
}

// Split **bold** markers into segments so the UI can render real bold text
// instead of showing literal asterisks.
export function parseBoldSegments(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out.length ? out : [{ text: s, bold: false }];
}

// Validate word windows and run EXACTLY ONE rewrite pass for the violators.
// `ask` is injected so this is testable without a live provider.
export async function enforceAnswerWindows({ questions, ask, context = '' }) {
  const list = Array.isArray(questions) ? questions.slice() : [];
  const violators = answersOutOfWindow(list);
  if (!violators.length || typeof ask !== 'function') {
    return { questions: list, fixed: 0, violators: violators.length };
  }
  let rewritten = [];
  try {
    rewritten = (await ask({ violators, context })) || [];
  } catch {
    rewritten = [];
  }
  if (!Array.isArray(rewritten) || !rewritten.length) {
    return { questions: list, fixed: 0, violators: violators.length };
  }
  // index the rewrite answers by stem so we replace the right question
  const byStem = new Map();
  for (const r of rewritten) {
    const s = stemOf(r).toLowerCase();
    if (s) byStem.set(s, answerTextOf(r));
  }
  let fixed = 0;
  const next = list.map((q) => {
    if (isAnswerInRange(q)) return q; // never touch an answer that is already in range
    const s = stemOf(q).toLowerCase();
    if (!byStem.has(s)) return q;
    const candidate = { ...q, answer: byStem.get(s), answer_text: byStem.get(s) };
    if (isAnswerInRange(candidate)) {
      fixed++;
      return candidate;
    }
    return q;
  });
  return { questions: next, fixed, violators: violators.length };
}

// ---------- G4: mind map depth ----------
export function countMindMapNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  const kids = Array.isArray(node.children) ? node.children : [];
  return 1 + kids.reduce((a, c) => a + countMindMapNodes(c), 0);
}

export function mindMapDepth(node) {
  if (!node || typeof node !== 'object') return 0;
  const kids = Array.isArray(node.children) ? node.children : [];
  if (!kids.length) return 1;
  return 1 + Math.max(...kids.map((c) => mindMapDepth(c)));
}

// "Heavy" = a chapter the syllabus budgets >=6 hours (e.g. Life Processes).
export function isHeavyChapter(chapter) {
  const h = num(chapter?.estimated_hours ?? chapter?.hours ?? chapter?.hrs ?? chapter?.estimatedHours, 0);
  return h >= 6;
}

export function mindMapMinNodes(chapter) {
  return isHeavyChapter(chapter) ? 32 : 16;
}

export function mindMapMinDepth(chapter) {
  return isHeavyChapter(chapter) ? 3 : 2;
}

export function mindMapMeetsMinimum(node, chapter) {
  const nodes = countMindMapNodes(node);
  const depth = mindMapDepth(node);
  const minNodes = mindMapMinNodes(chapter);
  const minDepth = mindMapMinDepth(chapter);
  return { ok: nodes >= minNodes && depth >= minDepth, nodes, depth, minNodes, minDepth, heavy: isHeavyChapter(chapter) };
}

// Difficulty changes mind map CONTENT TYPE, not just size.
export function mindMapContentInstruction(pct) {
  const band = difficultyBandName(pct);
  if (band === 'easy') return 'Content type: definitions, labels and core ideas only — the terms a student must be able to name.';
  if (band === 'medium') return 'Content type: standard processes, cause-effect links and worked definitions — what a board answer needs.';
  if (band === 'hard') return 'Content type: key formulas, dates, derivations and exceptions — the hard edges that decide competitive-exam marks.';
  return 'Content type: derivations, proofs, unusual formula applications and cross-chapter links at olympiad depth.';
}

// Merge a top-up map into the existing root without duplicating labels.
export function mergeMindMap(root, extra) {
  if (!extra || typeof extra !== 'object') return root;
  if (!root || typeof root !== 'object') return extra;
  const sameLabel = String(extra.label || '').trim().toLowerCase() === String(root.label || '').trim().toLowerCase();
  if (!sameLabel) {
    const kids = Array.isArray(root.children) ? root.children.slice() : [];
    kids.push(extra);
    return { ...root, children: kids };
  }
  const kids = Array.isArray(root.children) ? root.children.slice() : [];
  const have = new Set(kids.map((k) => String(k?.label || '').trim().toLowerCase()));
  for (const c of Array.isArray(extra.children) ? extra.children : []) {
    const key = String(c?.label || '').trim().toLowerCase();
    if (key && !have.has(key)) { kids.push(c); have.add(key); }
  }
  return { ...root, children: kids };
}

// Validate node minimums and allow EXACTLY ONE follow-up top-up request.
export async function ensureMindMapSize({ root, chapter, ask, difficultyPct = 100 }) {
  let current = root;
  let status = mindMapMeetsMinimum(current, chapter);
  if (status.ok || typeof ask !== 'function') {
    return { root: current, nodes: status.nodes, depth: status.depth, ok: status.ok, minNodes: status.minNodes, minDepth: status.minDepth, toppedUp: false };
  }
  let extra = null;
  try {
    extra = await ask({ root: current, chapter, nodes: status.nodes, depth: status.depth, minNodes: status.minNodes, minDepth: status.minDepth, needed: status.minNodes - status.nodes, difficultyPct });
  } catch {
    extra = null;
  }
  const merged = mergeMindMap(current, extra && typeof extra === 'object' ? extra : null);
  const after = mindMapMeetsMinimum(merged, chapter);
  return { root: merged, nodes: after.nodes, depth: after.depth, ok: after.ok, minNodes: after.minNodes, minDepth: after.minDepth, toppedUp: true };
}

// ---------- G1: the question-bank loop ----------
// Deterministic, injectable, and exact: keeps asking for ONLY the missing
// types until every per-type target is met or the batch cap is spent.
export async function runQuestionBankLoop({
  targets,
  ask,
  batchSize = QB_BATCH_SIZE,
  maxBatches = batchCapFor(totalOf(targets), batchSize),
  normalize = null,
  context = '',
}) {
  const normalizer = typeof normalize === 'function' ? normalize : normalizeBankQuestion;
  const total = totalOf(targets);
  let questions = [];
  let seen = new Set();
  let batches = 0;
  let retries = 0;
  let emptyBatches = 0;
  let duplicates = 0;
  let skippedMalformed = 0;

  const harvest = (rawList, askBreakdown) => {
    const raw = Array.isArray(rawList) ? rawList : [];
    const normalized = [];
    for (const item of raw) {
      // a bare string answer from the model still carries a type via the ask
      const fallbackType = item && typeof item === 'object' && item.type
        ? item.type
        : (Object.keys(askBreakdown || {}).find((k) => num(askBreakdown[k]) > 0) || 'saq');
      let n = null;
      try { n = normalizer(item, fallbackType); } catch { n = null; }
      if (n) normalized.push(n);
    }
    const stemmed = validateStems(normalized);
    skippedMalformed += stemmed.skipped;
    const fresh = dedupeByStem(stemmed.kept, seen);
    duplicates += fresh.duplicates;
    seen = fresh.seen;
    return fresh.kept;
  };

  // Accept at most the remaining need per type, so per-type counts land EXACTLY.
  const acceptWithinTargets = (freshList) => {
    const have = countByType(questions);
    const miss = missingByType(targets, have);
    const buckets = {};
    for (const q of freshList) {
      const t = String(q?.type || '').toLowerCase();
      const hit = QB_TYPES.find((k) => t.includes(k));
      if (!hit) continue;
      (buckets[hit] = buckets[hit] || []).push(q);
    }
    const accepted = [];
    for (const k of QB_TYPES) {
      const room = num(miss[k]);
      if (room > 0 && buckets[k]) accepted.push(...buckets[k].slice(0, room));
    }
    return accepted;
  };

  while (questions.length < total && batches < maxBatches) {
    const have = countByType(questions);
    const plan = planBatch(targets, have, batchSize);
    if (plan.reqCount <= 0) break;
    batches++;
    const req = { askBreakdown: plan.ask, reqCount: plan.reqCount, already: questions, missing: plan.missing, targets, context };

    let fresh = harvest(await ask(req), plan.ask);
    let accepted = acceptWithinTargets(fresh);

    // G1: an empty/garbled batch gets ONE automatic retry before we move on.
    if (!accepted.length) {
      retries++;
      fresh = harvest(await ask({ ...req, retry: true }), plan.ask);
      accepted = acceptWithinTargets(fresh);
      if (!accepted.length) {
        emptyBatches++;
        continue;
      }
    }
    for (const q of accepted) {
      const s = stemOf(q).toLowerCase();
      if (s && !seen.has(s)) seen.add(s);
      questions.push(q);
    }
  }

  const perType = countByType(questions);
  return {
    questions,
    perType,
    total: questions.length,
    requested: total,
    short: questions.length < total,
    batches,
    retries,
    emptyBatches,
    duplicates,
    skippedMalformed,
  };
}
