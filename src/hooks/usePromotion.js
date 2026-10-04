// FIX-S S5 — the ONE promotion controller, shared by Schedule and Home.
//
// All decisions live in lib/progression.js (pure, unit-tested); this hook only
// wires them to the real data layer, so cloud mode, local/offline mode and the
// tests all exercise the same logic:
//   * `today` comes from todayStr(), which already honours the FIX-F dev-date
//     offset — the prompt can be tested by moving the dev date, not by mocking.
//   * effects are injected into runPromotion(), never hard-coded here.
//   * the hook is DORMANT until the schema gate is applied (isSchemaReady): in
//     cloud mode a users row without the `progression` key means the DDL has not
//     run yet, so no prompt and no banner appear. Local mode has no schema at
//     all and is always ready.
import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, isRemote } from '../lib/db';
import { importPresetRows } from '../lib/starterData';
import {
  shouldPrompt,
  promotionState,
  progressionOf,
  classPausedFor,
  isSchemaReady,
  planAccept,
  planDecline,
  runPromotion,
  activeSchoolExams,
  pendingSessionsToRetire,
  promotionPreset,
  classYearAnchor,
} from '../lib/progression';
import { PROMOTION_TO_CLASS, PROGRESSION_STREAMS } from '../config/constants';
import { todayStr, nowIso } from '../lib/utils';

export function usePromotion() {
  const { profile, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // the date this device already surfaced the sheet — closing it without a
  // decision must not nag on every focus, but writes nothing: tomorrow it returns
  const [askedOn, setAskedOn] = useState('');

  const today = todayStr(); // one date system (FIX-F offset aware)
  const ready = !!profile && isSchemaReady(profile, { remote: isRemote() });
  const state = profile ? promotionState(profile, today) : 'not-due';
  const progression = progressionOf(profile);
  const needsPrompt = !!profile && ready && state === 'prompt' && askedOn !== today;
  const paused = profile ? classPausedFor(profile, today) : null;

  const dismiss = useCallback(() => setAskedOn(today), [today]);
  const clearMsg = useCallback(() => { setMsg(''); setError(''); }, []);

  // effects for runPromotion — the same in cloud and local mode (db.* switches)
  const buildDeps = useCallback(
    () => ({
      listSyllabus: () => db.list('syllabus', { eq: { user_id: profile.id } }),
      archiveRow: (id, patch) => db.update('syllabus', id, patch),
      importRows: (preset, track, existing) => importPresetRows(profile.id, preset, track, { existing }),
      patchProfile: (patch) => updateProfile(patch),
    }),
    [profile?.id, updateProfile]
  );

  const accept = useCallback(
    async (stream) => {
      if (!profile?.id) return { ok: false, message: 'Profile abhi load nahi hua — dobara koshish karo.' };
      setBusy(true); setError(''); setMsg('');
      try {
        const rows = await db.list('syllabus', { eq: { user_id: profile.id } });
        const plan = planAccept({ userId: profile.id, profile, rows, stream, today, stamp: nowIso() });
        const res = await runPromotion(plan, buildDeps());
        if (!res.ok) { setError(res.message || 'Promotion complete nahi ho paya.'); return res; }

        // pending Class 10 sessions are retired — the archived map must not keep
        // sitting on the calendar (completed/skipped history is untouched)
        let retired = 0;
        const archived = rows.filter((r) => plan.archiveIds.includes(r.id));
        if (archived.length) {
          const pending = await db.list('schedule', { eq: { user_id: profile.id, status: 'pending' } });
          const { ids } = pendingSessionsToRetire(pending, archived);
          for (const id of ids) {
            try { await db.remove('schedule', id); retired += 1; } catch {}
          }
        }

        setAskedOn(today);
        setMsg(
          `🎓 ${plan.toClass} shuru! ${res.archived} Class 10 chapter "Class 10 · Archived" mein chale gaye (history safe), ` +
          `${res.imported} ${plan.toClass} chapter import hue, ${retired} purane pending session hataye gaye. ` +
          `XP, streak, habits, workouts aur Content Locker — sab untouched. Schedule regenerate karo to naya plan banega.`
        );
        return { ...res, retired };
      } catch (e) {
        const raw = String((e && e.message) || e);
        setError(
          /archived|check constraint|constraint/i.test(raw)
            ? `${raw.split('\n')[0]} — FIX-S S5 schema gate abhi apply nahi hua (syllabus.status CHECK). Class level change nahi hua.`
            : raw
        );
        return { ok: false, message: raw };
      } finally {
        setBusy(false);
      }
    },
    [profile, today, buildDeps]
  );

  const decline = useCallback(async () => {
    if (!profile?.id) return { ok: false, message: 'Profile abhi load nahi hua.' };
    setBusy(true); setError(''); setMsg('');
    try {
      const plan = planDecline({ userId: profile.id, profile, today, stamp: nowIso() });
      const res = await runPromotion(plan, buildDeps());
      setAskedOn(today);
      if (!res.ok) { setError(res.message || 'Decline save nahi ho paya.'); return res; }
      setMsg(
        `Theek hai — class level ${profile.class_level || 'Class 10'} hi rahega aur class planning paused hai (kal phir puchenge). ` +
        `Olympiad/competitive sessions normal chalenge. Class 10 data safe hai.`
      );
      return res;
    } catch (e) {
      const raw = String((e && e.message) || e);
      setError(raw);
      return { ok: false, message: raw };
    } finally {
      setBusy(false);
    }
  }, [profile, today, buildDeps]);

  /**
   * PO decision 5: school exams saved for the finished Class 10 year stop driving
   * planning once the promotion is accepted. Olympiad/competitive dates are not
   * school exams and stay active. Feed this to the planner instead of the raw list.
   */
  const schoolExamsForPlanning = useCallback(
    () => activeSchoolExams(profile, Array.isArray(profile?.school_exams) ? profile.school_exams : []),
    [profile]
  );

  const anchor = profile ? classYearAnchor(profile) : null;
  return {
    today,
    ready,
    state,
    needsPrompt,
    progression,
    paused,
    busy,
    msg,
    error,
    accept,
    decline,
    dismiss,
    clearMsg,
    schoolExamsForPlanning,
    streams: PROGRESSION_STREAMS,
    toClass: PROMOTION_TO_CLASS,
    preset: promotionPreset(),
    anchor,
    shouldPrompt: () => (profile ? shouldPrompt(profile, today) : false),
  };
}
