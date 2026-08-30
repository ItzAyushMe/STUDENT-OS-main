// ============================================================
// StudentOS — shared utilities (dates, ids, seeded randomness)
// ============================================================
import dayjs from 'dayjs';
import { SUBJECT_COLORS } from '../config/constants';

export { dayjs };

// ---------- ids ----------
export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------- dates ----------
export const todayStr = () => dayjs().format('YYYY-MM-DD');
export const dateStr = (d) => dayjs(d).format('YYYY-MM-DD');
export const nowIso = () => new Date().toISOString();

export function daysBetween(a, b) {
  return dayjs(b).startOf('day').diff(dayjs(a).startOf('day'), 'day');
}

export function daysUntil(date) {
  if (!date) return null;
  return daysBetween(todayStr(), date);
}

// Monday-based start of week
export function mondayOf(d) {
  const day = dayjs(d).day(); // 0=Sun .. 6=Sat
  const back = (day + 6) % 7;
  return dayjs(d).subtract(back, 'day').startOf('day');
}

export function weekStartStr(d) {
  return mondayOf(d).format('YYYY-MM-DD');
}

export function fmtDate(d) {
  return dayjs(d).format('DD MMM YYYY');
}

export function fmtDayShort(d) {
  return dayjs(d).format('ddd, DD MMM');
}

// ---------- time ----------
export function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(m) {
  const h = Math.floor(m / 60) % 24;
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// ---------- misc ----------
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function pct(a, b) {
  if (!b) return 0;
  return clamp(Math.round((a / b) * 100), 0, 100);
}

// Deterministic hash + seeded random (for Daily Arena — same set for everyone on a date)
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(arr, seed) {
  const rand = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function subjectColor(name) {
  const i = hashString(String(name || '')) % SUBJECT_COLORS.length;
  return SUBJECT_COLORS[i];
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up? Chalo ek last quest';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function sum(arr, fn = (x) => x) {
  return arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
}

export function groupBy(arr, fn) {
  return arr.reduce((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
}

export function orderBy(arr, fn, dir = 'asc') {
  const copy = [...arr];
  copy.sort((a, b) => {
    const av = fn(a);
    const bv = fn(b);
    if (av === bv) return 0;
    const r = av > bv ? 1 : -1;
    return dir === 'asc' ? r : -r;
  });
  return copy;
}
