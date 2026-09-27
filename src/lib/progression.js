// ============================================================
// StudentOS — FIX-S S5: session progression (Class 10 -> Class 11)
//
// The academic session ends 25 Feb (CLASS_SESSION_END, FIX-S S4) and the new one
// starts 1 Apr (SESSION_START). Between those dates a Class 10 student has
// finished their class year; on/after 1 Apr the app offers the promotion ONCE per
// session:
//
//   ACCEPT  -> choose a stream (LABEL ONLY for now — PO decision 2), archive the
//              Class 10 class-track rows (status 'archived', history kept, zero
//              planning effect), import the existing COMBINED Class 11 dataset,
//              set class_level = 'Class 11'. XP, streak, history, Content Locker,
//              habits and workouts are NOT touched by any code path here.
//   DECLINE -> class_level unchanged, nothing archived, the class track is paused
//              (zero class sessions, honest summary) and the prompt re-fires the
//              NEXT day. Olympiad / competitive tracks are never affected.
//
// DESIGN RULES
//   * PURE core: every decision function takes (profile, today) and reads nothing
//     else — so the FIX-F dev-date offset exercises exactly the production path.
//   * NO db / AsyncStorage import in this module. Effects run through injected
//     deps (`runPromotion(plan, deps)`), which keeps the whole flow unit-testable
//     in Node and identical in local (offline) and cloud mode — the screens pass
//     the real db wrappers, the tests pass fakes.
//   * NEVER a half-promotion: archival happens FIRST; if the schema gate is not
//     applied (the 'archived' CHECK value missing) the run aborts before
//     class_level is touched and says so plainly.
//   * DORMANT until the PO runs the DDL (isSchemaReady): no prompt, no banner.
// ============================================================
import dayjs from 'dayjs';
import {
  SESSION_START,
  PROMOTION_FROM_CLASS,
  PROMOTION_TO_CLASS,
  PROGRESSION_STREAMS,
  S5_SCHEMA_GATE_APPLIED,
  SYLLABUS_ARCHIVED,
  isArchivedRow,
} from '../config/constants';
import { todayStr, dateStr, nowIso } from './utils';
import { CLASS_SYLLABI } from '../data/syllabusData';

const isDateStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const asDate = (v) => (isDateStr(v) ? v : todayStr());

/** 'Class 10' | '10' | 'class-10' -> 'Class 10' (same normalisation the syllabus picker uses). */
export function normalizeClassLevel(v) {
  // same rule syllabusData uses, plus separator tolerance so 'class-10', 'Class 10',
  // 'class_10', '10' and '10th' all resolve to one value
  const c = String(v == null ? '' : v).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = c.match(/class\s*(\d+)/) || c.match(/^(\d{1,2})$/) || c.match(/(\d{1,2})(st|nd|rd|th)/);
  const n = m ? parseInt(m[1], 10) : null;
  return n ? `Class ${n}` : '';
}

/**
 * The academic session a date belongs to, labelled by its START year:
 * Apr 2026 .. Mar 2027 -> '2026-27'. This is the key for "once per session".
 */
export function sessionLabelFor(today) {
  const d = dayjs(asDate(today));
  if (!d.isValid()) return '';
  const startYear = d.month() + 1 >= 4 ? d.year() : d.year() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * The 1 April that opens THIS date's promotion window.
 *
 * WHY the calendar year and not "the next session": FIX-S S4 already stops all
 * class-track sessions after 25 Feb of the CURRENT year, so from 26 Feb a Class 10
 * student has no class plan until they progress. The window therefore opens on the
 * 1 April of the same calendar year — before it (Jan–Mar, board-exam season) there
 * is no prompt, on/after it there is one.
 *   2027-02-26 -> 2027-04-01 (not yet)   2027-03-15 -> 2027-04-01 (not yet)
 *   2027-04-01 -> 2027-04-01 (DUE)       2027-09-27 -> 2027-04-01 (DUE)
 */
export function promotionDueDate(today) {
  const d = dayjs(asDate(today));
  if (!d.isValid()) return '';
  const [mm, dd] = String(SESSION_START || '04-01').split('-');
  const iso = `${d.year()}-${String(Number(mm) || 4).padStart(2, '0')}-${String(Number(dd) || 1).padStart(2, '0')}`;
  const x = dayjs(iso);
  return x.isValid() ? dateStr(x) : iso;
}

/** Normalised users.progression (null when absent/invalid). */
export function progressionOf(profile) {
  const raw = profile && profile.progression;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const status = raw.status === 'accepted' || raw.status === 'declined' ? raw.status : null;
  return {
    session: String(raw.session || ''),
    status,
    stream: raw.stream ? String(raw.stream) : null,
    fromClass: raw.fromClass ? String(raw.fromClass) : PROMOTION_FROM_CLASS,
    toClass: raw.toClass ? String(raw.toClass) : PROMOTION_TO_CLASS,
    promptedAt: isDateStr(raw.promptedAt) ? raw.promptedAt : null,
    decidedAt: isDateStr(raw.decidedAt) ? raw.decidedAt : null,
    declinedOn: isDateStr(raw.declinedOn) ? raw.declinedOn : null,
    promotedOn: isDateStr(raw.promotedOn) ? raw.promotedOn : null,
    archivedRows: Number(raw.archivedRows) || 0,
    importedRows: Number(raw.importedRows) || 0,
  };
}

/**
 * DORMANT GATE (PO decision). The promotion needs `users.progression` and the
 * widened `syllabus.status` CHECK. Before the PO runs that SQL:
 *   - cloud mode  -> the live users row has no `progression` key  => NOT ready
 *   - local mode  -> a plain JSON store has no schema at all       => ready [S5e]
 * The probe is READ-side only: this module never issues a trial write.
 * @param {object} profile  the users row as fetched
 * @param {{remote?:boolean}} opts  screens pass isRemote(); tests pass true/false
 */
export function isSchemaReady(profile, opts = {}) {
  if (S5_SCHEMA_GATE_APPLIED) return true;
  const remote = opts.remote !== false; // default: assume cloud unless told otherwise
  if (!remote) return true;
  return !!profile && Object.prototype.hasOwnProperty.call(profile, 'progression');
}

/**
 * PURE [S5a]: does this profile need the promotion prompt on this date?
 *   Class 10 + nothing decided this session + today >= 1 Apr  -> true
 *   15 Mar / Class 11 / already accepted / already asked today -> false
 * A decline re-fires the NEXT day (declinedOn !== today).
 */
export function shouldPrompt(profile, today) {
  const p = profile || {};
  const t = asDate(today);
  if (normalizeClassLevel(p.class_level) !== PROMOTION_FROM_CLASS) return false;
  const due = promotionDueDate(t);
  if (!due || t < due) return false;
  const prog = progressionOf(p);
  if (!prog) return true;
  if (prog.status === 'accepted') return false;           // promoted — never again
  if (prog.session !== sessionLabelFor(t)) return true;   // a decision from an older session
  if (prog.status === 'declined') return prog.declinedOn !== t; // re-prompt the next day
  return true;
}

/**
 * One state for the UI (Home banner + Schedule modal):
 * 'prompt' | 'declined' | 'accepted' | 'not-due'
 */
export function promotionState(profile, today) {
  const t = asDate(today);
  const prog = progressionOf(profile);
  if (prog && prog.status === 'accepted' && prog.session === sessionLabelFor(t)) return 'accepted';
  if (shouldPrompt(profile, t)) return 'prompt';
  if (prog && prog.status === 'declined' && prog.session === sessionLabelFor(t)) return 'declined';
  if (prog && prog.status === 'accepted') return 'accepted';
  return 'not-due';
}

/**
 * [S5c] Planner input: the class track is paused while a decline stands for the
 * current session. Olympiad/competitive tracks are untouched.
 */
export function classPausedFor(profile, today) {
  const t = asDate(today);
  const prog = progressionOf(profile);
  if (!prog || prog.status !== 'declined') return null;
  if (prog.session !== sessionLabelFor(t)) return null; // an old decline cannot pause a new session
  return {
    reason: 'promotion-declined',
    since: prog.declinedOn || prog.decidedAt || t,
    session: prog.session,
    toClass: prog.toClass,
  };
}

/**
 * PO decision 5: Class 10 school exams stay SAVED on the profile, but once the
 * student is promoted they stop driving class planning for the new class track.
 * Olympiad / competitive dates are not school exams and are never filtered here.
 */
export function activeSchoolExams(profile, schoolExams) {
  const list = Array.isArray(schoolExams) ? schoolExams.filter(Boolean) : [];
  const prog = progressionOf(profile);
  if (!prog || prog.status !== 'accepted' || !prog.promotedOn) return list;
  return list.filter((e) => {
    const start = String(e.start_date || e.start || e.date || '');
    return !!start && start >= prog.promotedOn;
  });
}

/** The Class 11 preset the promotion imports: the existing COMBINED 89-row set. */
export function promotionPreset(toClass = PROMOTION_TO_CLASS) {
  const preset = CLASS_SYLLABI[toClass] || null;
  return preset ? { key: toClass, label: preset.label || toClass, rowCount: (preset.rows || []).length, preset } : null;
}

/**
 * PURE accept plan — no I/O, fully deterministic.
 * @param {object} a { userId, profile, rows (syllabus rows), stream, today, stamp }
 */
export function planAccept({ userId, profile, rows, stream, today, stamp }) {
  const t = asDate(today);
  const fromClass = normalizeClassLevel(profile && profile.class_level) || PROMOTION_FROM_CLASS;
  const toClass = PROMOTION_TO_CLASS;
  const chosen = PROGRESSION_STREAMS.includes(stream) ? stream : null;
  if (!chosen) throw new Error(`planAccept: stream must be one of ${PROGRESSION_STREAMS.join(', ')} (got ${JSON.stringify(stream)})`);
  const preset = promotionPreset(toClass);
  if (!preset) throw new Error(`planAccept: no syllabus preset for ${toClass}`);

  const syllabus = Array.isArray(rows) ? rows.filter(Boolean) : [];
  // archive the OLD class map only: olympiad/exam rows stay live (PO decision 5)
  const archiveIds = syllabus
    .filter((r) => !isArchivedRow(r) && (r.track === 'olympiad' || r.track === 'exam' ? false : true))
    .map((r) => r.id)
    .filter(Boolean);
  const conqueredKept = syllabus.filter((r) => r && archiveIds.includes(r.id) && (r.completed_at || Number(r.progress_percent) >= 100)).length;

  const progression = {
    session: sessionLabelFor(t),
    status: 'accepted',
    stream: chosen,                       // LABEL ONLY — planning uses the combined set
    fromClass,
    toClass,
    promptedAt: t,
    decidedAt: t,
    promotedOn: t,
    schoolExamsRetiredOn: t,              // PO decision 5 marker
    archivedRows: archiveIds.length,
    conqueredArchived: conqueredKept,     // history stays readable (completed_at/progress kept on the row)
    importedRows: 0,                      // filled in by runPromotion
  };

  return {
    kind: 'accept',
    userId: userId || (profile && profile.id) || null,
    session: progression.session,
    stream: chosen,
    fromClass,
    toClass,
    today: t,
    stamp: stamp || nowIso(),
    rows: syllabus,
    archiveIds,
    archivePatch: { status: SYLLABUS_ARCHIVED },
    preset,
    importTrack: 'class',
    // EXACTLY two profile fields change. total_xp, current_streak, longest_streak,
    // streak_freezes, board, exam dates, priorities, arc, days_off, Content Locker,
    // habits, habit_logs, workouts, schedule and quiz history are NOT in this patch.
    userPatch: { class_level: toClass, progression },
    preserved: [
      'total_xp', 'current_streak', 'longest_streak', 'streak_freezes',
      'content', 'habits', 'habit_logs', 'workouts', 'gym_logs', 'schedule', 'quiz_results',
    ],
  };
}

/** PURE decline plan — profile-only write, nothing archived, class_level unchanged. */
export function planDecline({ userId, profile, today, stamp }) {
  const t = asDate(today);
  const fromClass = normalizeClassLevel(profile && profile.class_level) || PROMOTION_FROM_CLASS;
  const progression = {
    session: sessionLabelFor(t),
    status: 'declined',
    stream: null,
    fromClass,
    toClass: PROMOTION_TO_CLASS,
    promptedAt: t,
    decidedAt: t,
    declinedOn: t,                        // drives the next-day re-prompt
  };
  return {
    kind: 'decline',
    userId: userId || (profile && profile.id) || null,
    session: progression.session,
    today: t,
    stamp: stamp || nowIso(),
    userPatch: { progression },           // class_level deliberately absent
    classPaused: { reason: 'promotion-declined', since: t, session: progression.session },
  };
}

/**
 * Runs a plan. ALL effects come from `deps`, so the same code path serves cloud
 * mode, local/offline mode and the deterministic tests.
 *
 * deps = {
 *   listSyllabus()                     -> rows (only needed when plan.rows is absent)
 *   archiveRow(id, patch)              -> syllabus write
 *   importRows(preset, track, existing)-> { inserted } (starterData.importPresetRows)
 *   patchProfile(patch)                -> users write (AuthContext.updateProfile / db.update)
 * }
 *
 * Order matters: ARCHIVE -> IMPORT -> PROFILE. If archival fails (the 'archived'
 * CHECK value is missing because the DDL has not run), the run aborts BEFORE
 * class_level changes and reports it — never a half-promoted student.
 */
export async function runPromotion(plan, deps = {}) {
  if (!plan || typeof plan !== 'object') throw new Error('runPromotion: a plan is required');
  const { listSyllabus, archiveRow, importRows, patchProfile } = deps;
  if (typeof patchProfile !== 'function') throw new Error('runPromotion: deps.patchProfile is required');
  const writes = { users: 0, syllabusArchive: 0, syllabusInsert: 0, otherTables: [] };

  if (plan.kind === 'decline') {
    await patchProfile({ ...plan.userPatch });
    writes.users += 1;
    return {
      ok: true, kind: 'decline', writes,
      progression: plan.userPatch.progression,
      classLevel: null,               // unchanged on purpose
      classPaused: plan.classPaused,
    };
  }

  if (plan.kind !== 'accept') throw new Error(`runPromotion: unknown plan kind ${plan.kind}`);

  const rows = Array.isArray(plan.rows)
    ? plan.rows
    : (typeof listSyllabus === 'function' ? (await listSyllabus()) || [] : []);

  // 1) archive the old class map
  const archiveFailures = [];
  let archived = 0;
  for (const id of plan.archiveIds) {
    if (typeof archiveRow !== 'function') { archiveFailures.push({ id, message: 'deps.archiveRow missing' }); continue; }
    try {
      await archiveRow(id, { ...plan.archivePatch, archived_at: plan.stamp });
      archived += 1;
      writes.syllabusArchive += 1;
    } catch (e) {
      archiveFailures.push({ id, message: String((e && e.message) || e).split('\n')[0] });
    }
  }
  if (archiveFailures.length) {
    return {
      ok: false, kind: 'accept', reason: 'schema-gate', archived, archiveFailures, writes,
      message:
        `Class 10 archival failed for ${archiveFailures.length} row(s) — class_level was NOT changed. ` +
        `The syllabus.status CHECK still rejects '${SYLLABUS_ARCHIVED}'. Run the FIX-S S5 DDL and try again. ` +
        `First error: ${archiveFailures[0].message}`,
    };
  }

  // 2) import the combined Class 11 set (dedupe-safe; archived rows never block it)
  let imported = 0;
  if (typeof importRows === 'function') {
    const res = await importRows(plan.preset && plan.preset.preset, plan.importTrack, rows);
    imported = Number(res && res.inserted) || 0;
    writes.syllabusInsert = imported;
  }

  // 3) the profile: class_level + progression, nothing else
  const progression = { ...plan.userPatch.progression, archivedRows: archived, importedRows: imported, completedAt: plan.stamp };
  await patchProfile({ class_level: plan.userPatch.class_level, progression });
  writes.users += 1;

  return {
    ok: true, kind: 'accept', writes, archived, imported,
    classLevel: plan.userPatch.class_level,
    progression,
    stream: plan.stream,
  };
}

/**
 * [S5b] preservation snapshot: the values that MUST be byte-identical before and
 * after a promotion. Nothing here is written by runPromotion — the test asserts
 * the write set instead of trusting this list.
 */
export function preservationSnapshot({ profile, counts }) {
  const p = profile || {};
  const c = counts || {};
  return {
    total_xp: p.total_xp === undefined ? null : p.total_xp,
    current_streak: p.current_streak === undefined ? null : p.current_streak,
    longest_streak: p.longest_streak === undefined ? null : p.longest_streak,
    streak_freezes: p.streak_freezes === undefined ? null : p.streak_freezes,
    class_board: p.board === undefined ? null : p.board,
    olympiad: p.olympiad === undefined ? null : p.olympiad,
    olympiad_date: p.olympiad_date === undefined ? null : p.olympiad_date,
    exam_date: p.exam_date === undefined ? null : p.exam_date,
    school_exams: p.school_exams === undefined ? null : p.school_exams,
    content: c.content === undefined ? null : c.content,
    habits: c.habits === undefined ? null : c.habits,
    workouts: c.workouts === undefined ? null : c.workouts,
    schedule: c.schedule === undefined ? null : c.schedule,
  };
}

/** Rows the active lists/progress/trophy counts may use (archived excluded). */
export function activeRows(rows) {
  return Array.isArray(rows) ? rows.filter((r) => r && !isArchivedRow(r)) : [];
}

/** Archived rows for the collapsible "Class 10 · Archived" history section. */
export function archivedRows(rows) {
  return Array.isArray(rows) ? rows.filter((r) => r && isArchivedRow(r)) : [];
}

/**
 * [S5b] Pending schedule sessions that belonged to the now-archived class map.
 * They are retired on accept — otherwise last year's chapters would keep sitting
 * on the calendar (and the FIX-E auto-roller would push them into the new year).
 * COMPLETED and SKIPPED history is never touched: the student's record stays whole.
 * Schedule rows carry no syllabus FK, so identity is subject + topic text
 * (ladder topics are "…: <chapter>"), matching the planner's own dedupeKey logic.
 * @returns {{ids:string[], count:number}}
 */
export function pendingSessionsToRetire(sessions, archivedSyllabusRows) {
  const rows = Array.isArray(archivedSyllabusRows) ? archivedSyllabusRows : [];
  if (!rows.length || !Array.isArray(sessions)) return { ids: [], count: 0 };
  const keys = new Set(
    rows.map((r) => `${String(r.subject || '').toLowerCase()}|${String(r.chapter || r.topic || '').toLowerCase()}`)
  );
  const ids = [];
  for (const s of sessions) {
    if (!s || !s.id) continue;
    if (String(s.status || 'pending') !== 'pending') continue; // history preserved
    const subject = String(s.subject || '').toLowerCase();
    const topic = String(s.topic || '');
    const chapter = topic.includes(': ') ? topic.slice(topic.lastIndexOf(': ') + 2) : topic;
    if (keys.has(`${subject}|${chapter.toLowerCase()}`) || keys.has(`${subject}|${topic.toLowerCase()}`)) ids.push(s.id);
  }
  return { ids, count: ids.length };
}
