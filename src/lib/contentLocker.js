// ============================================================
// StudentOS — FIX-J: CONTENT LOCKER RULES (pure core)
//
// Everything that DECIDES lives here: upload validation, storage-path shape,
// URL normalization, dedupe keys, search matching, malformed-row fallbacks,
// syllabus choices, the NOTE_CREATE daily-guard decision and list ordering.
// No supabase, no AsyncStorage, no react-native, no expo-document-picker —
// plain-Node importable so scripts/logic-test.mjs can prove every rule (J1–J7)
// without a device or a network.
//
// The effectful half (picker, storage upload/signed URLs, rows) lives in
// src/screens/study/ContentScreen.js and delegates every decision back here.
//
// STORAGE SECURITY GATE (PO-executed, never by app code):
//   private bucket `content`; object name = `{auth.uid()}/{uuid}.{ext}` — the
//   first path segment MUST be the user id (policy content_storage_own checks
//   exactly that). No public bucket, no public URLs, reads via short-lived
//   signed URLs only. See supabase/schema.sql (file-only DDL).
// ============================================================
import { CONTENT_TYPES, XP_RULES, isArchivedRow } from '../config/constants.js';

// ---------- constants ----------
export const CONTENT_BUCKET = 'content';           // private bucket (PO gate)
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;  // 10 MB (J1)
export const SIGNED_URL_TTL_SECONDS = 300;         // short expiry — private bucket
export const NOTE_XP_KEY = 'note';                 // xpOnce key (J2) — mandated, not invented
export const XP_NOTE_CREATE = XP_RULES?.NOTE_CREATE?.amount ?? 5;
export const DUPLICATE_MESSAGE = 'Already saved in your locker'; // exact copy per spec (J3)
export const LOCAL_UPLOAD_MESSAGE =
  'File upload = cloud only (private Supabase Storage). Local mode mein notes aur links ' +
  'save hote hain — files nahi. Supabase connect karo (Settings) to upload PDF/image/audio.';
export const FILE_TYPES = ['pdf', 'image', 'audio'];

// extension -> locker type / mime. Handoff allowlist: PDF, PNG/JPG/WEBP, MP3/M4A/WAV
// (jpeg kept as the jpg alias — the repo's own detectType already treats them alike).
export const EXT_TYPE = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
  mp3: 'audio', m4a: 'audio', wav: 'audio',
};
export const EXT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
};
const MIME_EXT = {
  'application/pdf': 'pdf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
};
// what the document picker is offered per source kind
export const PICKER_MIME = {
  pdf: ['application/pdf'],
  image: ['image/png', 'image/jpeg', 'image/webp'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave'],
};

// ---------- J1a: validation BEFORE any network call ----------
export function extOf(fileName) {
  const s = String(fileName || '').trim();
  const dot = s.lastIndexOf('.');
  if (dot < 0 || dot === s.length - 1) return '';
  return s.slice(dot + 1).toLowerCase();
}

export function extFromMime(mimeType) {
  const m = String(mimeType || '').trim().toLowerCase();
  if (!m) return '';
  if (MIME_EXT[m]) return MIME_EXT[m];
  const sub = m.split('/')[1] || '';
  return EXT_TYPE[sub] ? sub : '';
}

export function typeForExt(ext) {
  return EXT_TYPE[String(ext || '').toLowerCase()] || null;
}

export function fmtFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * The one gate every upload passes through BEFORE picker-to-network happens:
 * title non-empty, extension on the allowlist, 0 < size <= 10 MB.
 * Pure: no I/O, deterministic — [J1a].
 */
export function validateUpload({ title, fileName, mimeType, size } = {}) {
  const t = String(title || '').trim();
  if (!t) return { ok: false, reason: 'empty-title', message: 'Title khali nahi ho sakta — pehle title likho.' };
  const ext = extOf(fileName) || extFromMime(mimeType);
  if (!ext || !EXT_TYPE[ext]) {
    return {
      ok: false, reason: 'bad-type',
      message: `Ye file type allowed nahi hai${ext ? ` (.${ext})` : ''}. Sirf PDF, PNG/JPG/WEBP, MP3/M4A/WAV — max 10 MB.`,
    };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, reason: 'empty-file', message: 'File khaali hai ya uska size pata nahi chala.' };
  }
  if (bytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false, reason: 'too-big',
      message: `File ${fmtFileSize(bytes)} hai — limit ${fmtFileSize(MAX_UPLOAD_BYTES)} hai. Chhoti file try karo.`,
    };
  }
  return {
    ok: true, ext, type: EXT_TYPE[ext], title: t, sizeBytes: bytes,
    contentType: String(mimeType || '').trim() || EXT_MIME[ext] || 'application/octet-stream',
  };
}

// ---------- J1: storage path shape (private, uid-first) ----------
const safeId = (v) => String(v || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
const safeExt = (v) => (/^[a-z0-9]{1,10}$/.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'bin');

/** Object NAME inside the `content` bucket: `{uid}/{id}.{ext}` — uid is segment 1 (policy). */
export function storageObjectName(userId, ext, id) {
  const uid = safeId(userId);
  if (!uid) return null;
  return `${uid}/${safeId(id)}.${safeExt(ext)}`;
}

/** Full display path `content/{uid}/{id}.{ext}` (docs/UI only — uploads use the name). */
export function storageFullPath(userId, ext, id) {
  const name = storageObjectName(userId, ext, id);
  return name ? `${CONTENT_BUCKET}/${name}` : null;
}

/** The isolation invariant the storage policy enforces — proven here for every name we build. */
export function firstSegmentIsUser(objectName, userId) {
  if (!objectName || !userId) return false;
  return String(objectName).split('/')[0] === String(userId);
}

/**
 * A row whose `url` is a STORAGE OBJECT NAME (not an http link): uploaded files only.
 * Link-kind rows whose URL merely ends in .pdf/.png keep url = http(s) and are NOT files.
 */
export function isStoredFileRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (!FILE_TYPES.includes(row.type)) return false;
  const u = row.url;
  return typeof u === 'string' && !!u.trim() && !/^https?:\/\//i.test(u) && u.includes('/');
}

// ---------- J3/J6: URL normalization + dedupe ----------
/**
 * Normalize a user-typed/DB URL to a canonical http(s) form, or null when it is
 * not a valid http(s) URL (J6: scheme-less gets https://, javascript:/data:/ftp:
 * are rejected — only http(s) ever opens or dedupes).
 */
export function normalizeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s || /[\s\u0000-\u001f]/.test(s)) return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(s);
  let scheme; let rest;
  if (m) { scheme = m[1].toLowerCase(); rest = s.slice(m[0].length); }
  else { scheme = 'https'; rest = s; } // BUG-5 behaviour kept: bare hosts get https://
  if (scheme !== 'http' && scheme !== 'https') return null; // J6: http(s) only
  const slash = rest.indexOf('/');
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  let tail = slash === -1 ? '' : rest.slice(slash);
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/.test(host)) return null;
  tail = tail.replace(/\/+(?=[?#]|$)/, ''); // trailing-slash insensitive
  return `${scheme}://${host}${tail}`;
}

/**
 * Dedupe comparison key for a URL: FULLY case-, scheme- and trailing-slash-
 * insensitive (J3). The whole normalized URL is lowercased — for a student
 * locker, /Watch?v=1 and /watch?v=1 ARE the same saved item. (normalizeUrl
 * itself keeps path case for opening/display; only the KEY folds it.)
 */
export function urlDedupeKey(u) {
  const n = normalizeUrl(u);
  return n ? n.toLowerCase().replace(/^https?:\/\//, '') : null;
}

const normText = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Dedupe key of a locker row/candidate:
 *   rows with an http(s) url  -> url key (links, youtube, pdf/image/audio LINKS)
 *   note rows                 -> title+text key (trimmed, whitespace-collapsed, case-insensitive)
 *   uploaded-file rows        -> null (unique storage names are never duplicates)
 */
export function dedupeKeyOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (isStoredFileRow(row)) return null;
  const urlKey = urlDedupeKey(row.url);
  if (urlKey) return `url:${urlKey}`;
  const title = normText(row.title);
  const text = normText(row.text);
  if (!title && !text) return null;
  return `note:${title}\u0000${text}`;
}

/** The existing row that duplicates `candidate`, or null. Deleting the original frees the key. */
export function findDuplicate(existingRows, candidate) {
  const key = dedupeKeyOf(candidate);
  if (!key) return null;
  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    if (!row || typeof row !== 'object') continue;
    if (dedupeKeyOf(row) === key) return row;
  }
  return null;
}

// ---------- J1b: the content row an upload produces ----------
export function fileRowFrom({ userId, title, type, sizeBytes, objectName, subject, topic, createdAt }) {
  return {
    user_id: userId,
    title: String(title || '').trim(),
    type,                                   // 'pdf' | 'image' | 'audio'
    url: objectName,                        // storage object NAME — never a public URL
    text: null,
    subject: String(subject || '').trim() || null,
    topic: String(topic || '').trim() || null,
    ai_summary: null,
    file_size: Number(sizeBytes) || 0,
    created_at: createdAt || null,
  };
}

// ---------- J4: search (client-side substring) composed with the type filter ----------
export function matchesSearch(row, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  const fields = [row && row.title, row && row.text, row && row.subject];
  return fields.some((v) => String(v == null ? '' : v).toLowerCase().includes(q));
}

export function filterItems(rows, { type = 'All', query = '' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((r) => type === 'All' || (r && r.type) === type)
    .filter((r) => matchesSearch(r, query));
}

// ---------- J6: malformed rows render via a fallback card, never crash ----------
const FALLBACK_CARD = {
  malformed: true, id: null, title: 'Unknown item', type: 'note', icon: '❓', label: 'Unknown',
  subject: null, topic: null, text: null, url: null, aiSummary: null, fileSizeLabel: null,
  isFile: false, canOpen: false, created_at: null,
};

/** Total-function: ANY input (null, junk, missing fields, unknown type) -> a renderable card. */
export function safeCard(row) {
  if (!row || typeof row !== 'object') return { ...FALLBACK_CARD };
  const known = CONTENT_TYPES[row.type];
  const type = known ? String(row.type) : 'note';
  const icon = known ? known.icon : '❓';
  const label = known ? known.label : 'Unknown type';
  const rawTitle = String(row.title == null ? '' : row.title).trim();
  const text = row.text == null ? null : String(row.text);
  const url = typeof row.url === 'string' && row.url.trim() ? row.url.trim() : null;
  const isFile = isStoredFileRow(row);
  const size = Number(row.file_size);
  return {
    malformed: !known || (!rawTitle && !text && !url),
    id: row.id == null ? null : String(row.id),
    title: rawTitle || '(Untitled)',
    type, icon, label,
    subject: row.subject == null ? null : String(row.subject),
    topic: row.topic == null ? null : String(row.topic),
    text, url, isFile,
    aiSummary: row.ai_summary == null ? null : String(row.ai_summary),
    fileSizeLabel: Number.isFinite(size) && size > 0 ? fmtFileSize(size) : null,
    canOpen: !!(url || text),
    created_at: row.created_at == null ? null : row.created_at,
  };
}

// ---------- J5: subject/chapter choices from the student's ACTIVE syllabus ----------
/**
 * Feed with raw syllabus rows — archived (S5) rows are excluded here too, so even
 * if a caller forgets activeSyllabusRows() the picker can never offer history.
 */
export function syllabusChoices(rows) {
  const subjects = [];
  const chaptersBySubject = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || isArchivedRow(r)) continue;
    const subj = String(r.subject == null ? '' : r.subject).trim();
    if (!subj) continue;
    if (!subjects.includes(subj)) subjects.push(subj);
    const ch = String(r.chapter == null ? '' : r.chapter).trim();
    if (!ch) continue;
    if (!chaptersBySubject[subj]) chaptersBySubject[subj] = [];
    if (!chaptersBySubject[subj].includes(ch)) chaptersBySubject[subj].push(ch);
  }
  return { subjects, chaptersBySubject };
}

// ---------- J2: NOTE_CREATE once-per-day guard (xpOnce key 'note') ----------
export function noteXpDecision({ alreadyEarnedToday }) {
  if (alreadyEarnedToday) {
    return { award: false, amount: 0, reason: 'daily-cap', message: 'Aaj ka note XP mil chuka ✅ — 0 XP, save phir bhi pakka.' };
  }
  return { award: true, amount: XP_NOTE_CREATE, reason: 'first-today', message: '' };
}

/**
 * Runs the guarded award with EVERY effect injected (screen passes the real
 * xpOnce/awardXP; tests pass fakes). The save flow must never depend on this:
 * callers insert the row FIRST and treat this result as display-only.
 */
export async function applyNoteXp({ userId, hasEarnedToday, markEarnedToday, awardXP } = {}) {
  const out = { awardedXp: 0, reason: null, msg: '' };
  let earned = false;
  try {
    earned = !!(typeof hasEarnedToday === 'function' && (await hasEarnedToday(userId, NOTE_XP_KEY)));
  } catch { earned = false; }
  const d = noteXpDecision({ alreadyEarnedToday: earned });
  out.reason = d.reason;
  if (!d.award) { out.msg = d.message; return out; }
  try {
    const res = typeof awardXP === 'function' ? await awardXP('NOTE_CREATE') : null;
    out.awardedXp = Number(res && res.gained) || 0;
    if (res && typeof markEarnedToday === 'function') {
      try { await markEarnedToday(userId, NOTE_XP_KEY); } catch {}
    }
  } catch {
    out.msg = 'XP award fail hua — save phir bhi ho gaya ✅';
  }
  return out;
}

// ---------- J7: ordering (created_at desc, stable) ----------
export function compareCreatedDesc(a, b) {
  const av = String((a && a.created_at) || '');
  const bv = String((b && b.created_at) || '');
  if (av !== bv) return bv.localeCompare(av);
  return String((a && a.id) || '').localeCompare(String((b && b.id) || '')); // stable tie-break
}

export function sortItemsDesc(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(compareCreatedDesc);
}
