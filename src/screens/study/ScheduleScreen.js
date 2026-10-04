// Smart Schedule — daily time-blocks, weekly grid, monthly calendar.
// Generates plans offline (scheduleGenerator) with revision cycles,
// mock days and buffer days; missed quests auto-reschedule.
import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { useSettings } from '../../context/SettingsContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Confetti } from '../../components/gamer/Confetti';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { generateSchedule, autoRescheduleMissed, autoSetDeadlines, classSessionCutoff } from '../../lib/scheduleGenerator';
import { chunkRows, isRunStale, saveWithWorkers, buildPlanDiagnostics, computeMissingIds } from '../../lib/scheduleSave';
import { uuid } from '../../lib/utils';
import { usePromotion } from '../../hooks/usePromotion';
import { PromotionSheet } from '../../components/study/PromotionSheet';
import { aiReschedule } from '../../lib/aiFeatures';
import { SESSION_TYPES, TRACK_PRIORITY, arcOf, effectiveDailyHours, effectiveWeekdayHours, effectiveWeekendHours, effectiveWeeklyAverageHours } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { dayjs, todayStr, dateStr, subjectColor, fmtDuration, mondayOf, nowIso } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

export function ScheduleScreen({ navigation, route }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const settings = useSettings();
  // FIX-S S5: Class 10 -> Class 11 promotion. One controller for the whole app;
  // this screen is where the sheet opens on load (PO decision 4).
  const promo = usePromotion();
  const [promoOpen, setPromoOpen] = useState(false);
  const promoAskedRef = useRef(''); // open the sheet once per prompt-day
  const [view, setView] = useState('daily');
  const [selected, setSelected] = useState(todayStr());
  const [monthOffset, setMonthOffset] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [genBusy, setGenBusy] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [coverage, setCoverage] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagExpanded, setDiagExpanded] = useState(false);
  const [aiPlanMsg, setAiPlanMsg] = useState('');
  const [aiPlanBusy, setAiPlanBusy] = useState(false);
  const [regenChoiceOpen, setRegenChoiceOpen] = useState(false);
  const [coverageExpanded, setCoverageExpanded] = useState(false); // FIX-QA-UI
  const [genError, setGenError] = useState('');
  const [autoRollMsg, setAutoRollMsg] = useState('');
  const autoRolledRef = useRef(false);
  const genRunRef = useRef(0);
  const genBusyRef = useRef(false);
  const lastTickRef = useRef(Date.now()); // FIX-E: guard to auto-roll only once per screen load session

  // human-readable priority line for the generate modal (reads the
  // student's own priority settings — FIX B)
  const prioritySummary = () => {
    const p = profile.priorities || {};
    const order = Array.isArray(p.order) && p.order.length ? p.order : ['class', 'exam', 'olympiad'];
    const names = {
      class: '🏫 Class',
      exam: `🎯 ${profile.competitive_exam || 'Exam'}`,
      olympiad: '🏅 Olympiad',
    };
    return order
      .map((t) => names[t] || `⭐ ${p.custom?.[t]?.name || 'Custom'}`)
      .filter((x) => x)
      .join(' → ');
  };

  // BUG 10: always-visible priority order — instantly obvious the setting took
  const activePrio = useMemo(() => {
    const p = profile?.priorities;
    const order = Array.isArray(p?.order) && p.order.length ? p.order : ['class', 'exam', 'olympiad'];
    const icons = { class: '🏫', exam: '🎯', olympiad: '🏅' };
    return order.filter((t) => p?.enabled?.[t] !== false);
  }, [profile?.priorities]);

  const load = useCallback(async () => {
    if (!profile?.id) return [];
    setLoading(true);
    try {
      const from = dateStr(dayjs().subtract(30, 'day'));
      // FIX-SCHED3: load up to 1100 days to support long-horizon schedules (Apr 2028)
      const to = dateStr(dayjs().add(1100, 'day'));
      const data = await db.list('schedule', {
        eq: { user_id: profile.id },
        gte: { date: from },
        lte: { date: to },
        order: { col: 'date', asc: true },
      });
      setSessions(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  const onBack = useHubBack(navigation, 'StudyHub');
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // FIX-S S5: prompt ON SCHEDULE LOAD once the class session is over (1 Apr+).
  // `promo.needsPrompt` already carries the rules (Class 10 only, nothing decided
  // this session, a decline re-fires NEXT day, dormant until the schema gate is
  // applied) and reads todayStr(), so the FIX-F dev-date offset exercises it.
  useEffect(() => {
    if (loading || !promo.needsPrompt) return;
    if (promoAskedRef.current === promo.today) return;
    promoAskedRef.current = promo.today;
    setPromoOpen(true);
  }, [loading, promo.needsPrompt, promo.today]);

  const onPromoAccept = useCallback(async (stream) => {
    const res = await promo.accept(stream);
    setPromoOpen(false);
    setCoverage(null); // the old coverage no longer describes the new class map
    if (res?.ok) await load();
  }, [promo, load]);

  const onPromoDecline = useCallback(async () => {
    await promo.decline();
    setPromoOpen(false);
    setCoverage(null);
  }, [promo]);

  // BUG 10: navigated here after saving priorities (Settings → regenerate) —
  // open the regen dialog (Replace all / Keep completed) once, automatically.
  useEffect(() => {
    if (route.params?.autoRegen) {
      setRegenChoiceOpen(true);
      navigation.setParams({ autoRegen: undefined });
    }
  }, [route.params?.autoRegen]);

  // FIX-E: auto rollover on schedule load — skipped/pending past due auto-moves without button press
  useEffect(() => {
    if (loading) return;
    if (!sessions.length) return;
    if (autoRolledRef.current) return;
    const pastDue = sessions.filter((s) => (s.status === 'pending' || s.status === 'skipped') && s.date < todayStr());
    if (!pastDue.length) return;
    // auto-roll once per screen focus session
    autoRolledRef.current = true;
    (async () => {
      try {
          // FIX-S S5: retired Class 10 school exams must not move new sessions either
        const schoolExams = promo.schoolExamsForPlanning();
        const { moved } = autoRescheduleMissed(sessions, { dailyHours: profile?.daily_study_hours || 3, schoolExams });
        if (moved.length) {
          for (const m of moved) {
            try { await db.update('schedule', m.id, { date: m.date, status: 'pending' }); } catch {}
          }
          setSessions((prev) => prev.map((s) => {
            const mv = moved.find((x) => x.id === s.id);
            return mv ? { ...s, date: mv.date, status: 'pending' } : s;
          }));
          setAutoRollMsg(`Auto-rolled ${moved.length} missed/skipped quest${moved.length>1?'s':''} to upcoming days — no button needed ✅`);
        }
      } catch (e) {
        console.warn('[FIX-E] auto rollover failed', e?.message);
      }
    })();
  }, [sessions, loading, profile?.school_exams, profile?.daily_study_hours]);

  // Reset guard when screen refocuses (so next visit can auto-roll again)
  useFocusEffect(useCallback(() => {
    autoRolledRef.current = false;
    setAutoRollMsg('');
  }, []));

  const missed = useMemo(
    () => sessions.filter((s) => (s.status === 'pending' || s.status === 'skipped') && s.date < todayStr()),
    [sessions]
  );

  const daySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.date === selected)
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))),
    [sessions, selected]
  );

  const weekDays = useMemo(() => {
    const mon = mondayOf(selected);
    return Array.from({ length: 7 }, (_, i) => dateStr(mon.add(i, 'day')));
  }, [selected]);

  const completeSession = async (s) => {
    await db.update('schedule', s.id, { status: 'completed' });
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'completed' } : x)));
    setConfetti(Date.now());
    await awardXP('STUDY_QUEST');
  };

  const skipSession = async (s) => {
    await db.update('schedule', s.id, { status: 'skipped' });
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'skipped' } : x)));
  };

  // FIX D: regeneration always ASKS first — never silently appends on
  // top of old data. Two modes: fresh start, or keep-completed history.
  // FIX-SCHED2: reliability — timeouts, batch writes, progress, 60s watchdog.
  // FIX-SCHED1: horizon till 25 Feb (classSessionCutoff) + hoursMultiplier 2.0× default.
  const generate = async (mode = 'keep-completed') => {
    if (genBusyRef.current) return;
    genRunRef.current += 1;
    const myRun = genRunRef.current;
    genBusyRef.current = true;
    setGenBusy(true);
    setGenError('');
    lastTickRef.current = Date.now();
    const tick = (msg) => {
      setGenProgress(msg);
      lastTickRef.current = Date.now();
    };
    const yieldPaint = () => new Promise((r) => setTimeout(r, 0));
    const isStale = () => isRunStale(genRunRef.current, myRun);

    let watchdogInterval = null;
    const clearWatchdog = () => {
      if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
    };
    watchdogInterval = setInterval(() => {
      if (Date.now() - lastTickRef.current > 60000) {
        genRunRef.current += 1;
        setGenError('Generate 60s se zyada le raha hai — network slow ya data bada hai. Dobara try karo.');
        setGenBusy(false);
        setGenProgress('');
        genBusyRef.current = false;
        clearWatchdog();
      }
    }, 10000);

    try {
      tick('Loading syllabus…');
      if (isStale()) return;
      const syllabus = await db.list('syllabus', { eq: { user_id: profile.id } });
      if (isStale()) return;

      tick('Loading existing schedule…');
      if (isStale()) return;
      const planToday = todayStr();
      const allExisting = await db.list('schedule', {
        eq: { user_id: profile.id },
        gte: { date: dateStr(dayjs(planToday).subtract(30, 'day')) },
        lte: { date: dateStr(dayjs(planToday).add(1100, 'day')) },
        order: { col: 'date', asc: true },
        limit: 5000,
      });
      if (isStale()) return;

      let diagDeleteCount = null;
      const chunkedRemove = async (rowsToDelete, label) => {
        if (!rowsToDelete.length) { diagDeleteCount = 0; return 0; }
        const CHUNK = 100;
        let totalDeleted = 0;
        for (let i = 0; i < rowsToDelete.length; i += CHUNK) {
          if (isStale()) return totalDeleted;
          const chunk = rowsToDelete.slice(i, i + CHUNK);
          tick(`${label} (${Math.floor(i/CHUNK)+1}/${Math.ceil(rowsToDelete.length/CHUNK)})…`);
          await yieldPaint();
          if (isStale()) return totalDeleted;
          try {
            if (typeof db.removeWhere === 'function' && chunk.length === rowsToDelete.length) {
              if (label.includes('old schedule')) {
                const del = await db.removeWhere('schedule', { user_id: profile.id });
                totalDeleted = typeof del === 'number' ? del : rowsToDelete.length;
                diagDeleteCount = totalDeleted;
                break;
              } else {
                const del = await db.removeWhere('schedule', { user_id: profile.id, status: 'pending' });
                totalDeleted = typeof del === 'number' ? del : rowsToDelete.length;
                diagDeleteCount = totalDeleted;
                break;
              }
            }
            await Promise.all(chunk.map((r) => db.remove('schedule', r.id)));
            totalDeleted += chunk.length;
          } catch (e) {
            throw new Error(`Delete failed at chunk ${Math.floor(i/CHUNK)+1} — old schedule kept. ${e?.message || ''}`);
          }
        }
        diagDeleteCount = totalDeleted;
        return totalDeleted;
      };

      let kept = [];
      if (mode === 'fresh') {
        tick('Clearing old schedule…');
        await yieldPaint();
        if (isStale()) return;
        try {
          const del = await db.removeWhere('schedule', { user_id: profile.id });
          diagDeleteCount = typeof del === 'number' ? del : null;
          // FIX-VERIFY: small settle after delete — ensure delete fully completed before any insert
          await new Promise((r) => setTimeout(r, 350));
        } catch (e) {
          if (allExisting.length) {
            await chunkedRemove(allExisting, 'Clearing old schedule');
            await new Promise((r) => setTimeout(r, 350));
          } else {
            throw new Error(`Old schedule delete failed — keeping old plan. ${e?.message || ''}`);
          }
        }
        if (isStale()) return;
        kept = [];
      } else {
        tick('Clearing pending slots…');
        await yieldPaint();
        if (isStale()) return;
        const pendingRows = allExisting.filter((r) => r.status === 'pending');
        try {
          const del = await db.removeWhere('schedule', { user_id: profile.id, status: 'pending' });
          diagDeleteCount = typeof del === 'number' ? del : null;
          await new Promise((r) => setTimeout(r, 350));
        } catch (e) {
          if (pendingRows.length) {
            await chunkedRemove(pendingRows, 'Clearing pending slots');
            await new Promise((r) => setTimeout(r, 350));
          } else {
            throw new Error(`Pending delete failed — keeping existing. ${e?.message || ''}`);
          }
        }
        if (isStale()) return;
        kept = allExisting.filter((r) => r.status !== 'pending');
      }

      tick('Computing deadlines…');
      await yieldPaint();
      if (isStale()) return;
      const planSchoolExams = promo.schoolExamsForPlanning();
      const computedDeadlines = syllabus.length
        ? autoSetDeadlines(syllabus, profile.exam_date, profile.daily_study_hours, planSchoolExams)
        : {};
      const plannedSyllabus = syllabus.map((r) =>
        !r.deadline && computedDeadlines[r.id] ? { ...r, deadline: computedDeadlines[r.id] } : r
      );

      tick('Planning till 25 Feb…');
      await yieldPaint();
      if (isStale()) return;
      const rows = generateSchedule({
        syllabus: plannedSyllabus,
        deadlines: computedDeadlines,
        existing: kept,
        today: planToday,
        examDate: profile.exam_date,
        olympiadDate: profile.olympiad_date || null,
        schoolExams: planSchoolExams,
        classPaused: promo.paused,
        profile: profile,
        class_level: profile.class_level || null,
        priorities: profile.priorities || null,
        dailyHours: effectiveDailyHours(profile),
        weekdayHours: effectiveWeekdayHours(profile),
        weekendHours: effectiveWeekendHours(profile),
        preferredTime: profile.preferred_time,
        daysOff: profile.days_off || [],
        lightDay: settings.lightDay ?? 6,
        prepLevel: profile.prep_level,
        hoursMultiplier: settings.hoursMultiplier ?? 2.0,
        olympiadMultiplier: settings.olympiadMultiplier ?? 3.0,
        examMultiplier: settings.examMultiplier ?? 2.0,
        classSessionEnd: settings.classSessionEnd || '02-25',
        weeks: (() => {
          const today = dayjs();
          const exam = profile.exam_date ? dayjs(profile.exam_date) : null;
          const olymp = profile.olympiad_date ? dayjs(profile.olympiad_date) : null;
          let maxDate = today.add(6 * 7, 'day');
          if (exam && exam.isAfter(maxDate)) maxDate = exam;
          if (olymp && olymp.isAfter(maxDate)) maxDate = olymp;
          if (Array.isArray(profile.school_exams) && profile.school_exams.length) {
            for (const e of profile.school_exams) {
              const d = e.end_date || e.start_date || e.date;
              if (d) {
                const sd = dayjs(d);
                if (sd.isAfter(maxDate)) maxDate = sd;
              }
            }
          }
          try {
            const override = settings.classSessionEnd || '02-25';
            const cutoffStr = classSessionCutoff(todayStr(), override);
            const cutoffDay = dayjs(cutoffStr);
            if (cutoffDay.isValid() && cutoffDay.isAfter(maxDate)) maxDate = cutoffDay;
          } catch {}
          maxDate = maxDate.add(14, 'day');
          const diffDays = Math.max(42, maxDate.diff(today, 'day'));
          const weeksNeeded = Math.ceil(diffDays / 7);
          return Math.min(160, Math.max(6, weeksNeeded));
        })(),
        userId: profile.id,
      });
      if (isStale()) return;
      setCoverage(rows.coverage || null);

      // FIX-VERIFY v2: diagnostics scaffolding + verified save
      let diagSavedCount = 0;
      let diagFailed = [];
      const diagChunkSize = 500;
      const diagWorkerCount = 2;
      let diagReloaded = [];
      let diagVerifyPerChunk = [];
      let diagVerifyRetries = 0;
      let diagFinalCount = null;

      // FIX-VERIFY: assign stable uuid v4 at generation for idempotent writes
      for (const r of rows) {
        if (!r.id) r.id = uuid();
      }
      {
        const seen = new Set();
        for (const r of rows) {
          while (seen.has(r.id)) r.id = uuid();
          seen.add(r.id);
        }
      }

      if (rows.length) {
        const chunks = chunkRows(rows, diagChunkSize);
        const totalChunks = chunks.length;

        const getMinMax = (chunk) => {
          const dates = chunk.map((r) => r.date).filter(Boolean).sort();
          return { min: dates[0] || null, max: dates[dates.length - 1] || null };
        };

        const insertFn = async (chunk) => {
          if (isStale()) throw new Error('stale run aborted');
          const res = await db.insertMany('schedule', chunk);
          // FIX-VERIFY3: receipt-based verify — use upsert's own .select() return as returned, zero extra queries
          return Array.isArray(res) ? res : chunk;
        };

        const insertAndVerifyReceipt = async (chunk) => {
          const sentIds = chunk.map((r) => r.id);
          let returnedRows = await insertFn(chunk);
          let missing = computeMissingIds(sentIds, returnedRows);
          let retried = false;
          if (missing.length > 0) {
            const missingRows = chunk.filter((r) => missing.includes(r.id));
            returnedRows = await insertFn(missingRows);
            retried = true;
            const stillMissing = computeMissingIds(missing, returnedRows);
            missing = stillMissing;
          }
          const returned = chunk.length - missing.length;
          return { sent: chunk.length, returned, missing, retried, returnedRows };
        };

        const rangeCountChunk1 = async (chunk) => {
          const { min, max } = getMinMax(chunk);
          if (!min || !max) return 0;
          // FIX-VERIFY3: chunk1 sentinel — ONE count query via date window + pending status, no .in()
          const list = await db.list('schedule', {
            eq: { user_id: profile.id, status: 'pending' },
            gte: { date: min },
            lte: { date: max },
          });
          return Array.isArray(list) ? list.length : 0;
        };

        const onProgress = (completed, total) => {
          tick(`Saving schedule (${completed}/${total})…`);
        };

        let savedCount = 0;
        const failed = [];

        // FIX-VERIFY: Serialize first chunk — await delete already done + settle, now chunk1 alone verified before workers
        // FIX-VERIFY3: receipt-based + range-count sentinel for chunk1
        if (totalChunks >= 1) {
          tick(`Saving schedule (1/${totalChunks})…`);
          await yieldPaint();
          if (isStale()) return;
          try {
            const receiptRes = await insertAndVerifyReceipt(chunks[0]);
            // chunk1 sentinel range-count
            let rangeReturned = await rangeCountChunk1(chunks[0]);
            let retriedRange = false;
            if (rangeReturned < receiptRes.sent) {
              // retry once
              await insertFn(chunks[0]);
              retriedRange = true;
              rangeReturned = await rangeCountChunk1(chunks[0]);
            }
            const finalMissing = rangeReturned < receiptRes.sent ? receiptRes.sent - rangeReturned : receiptRes.missing.length;
            const isFailed = receiptRes.missing.length > 0 || rangeReturned < receiptRes.sent;
            diagVerifyPerChunk.push({
              index: 0,
              sent: receiptRes.sent,
              returned: receiptRes.returned,
              rangeReturned,
              missingCount: isFailed ? finalMissing : 0,
              retried: receiptRes.retried || retriedRange,
            });
            if (receiptRes.retried || retriedRange) diagVerifyRetries++;
            if (isFailed) {
              failed.push(0);
            } else {
              savedCount += receiptRes.sent;
            }
            onProgress(1, totalChunks);
          } catch (e) {
            try {
              await yieldPaint();
              if (isStale()) return;
              const receiptRes2 = await insertAndVerifyReceipt(chunks[0]);
              let rangeReturned2 = await rangeCountChunk1(chunks[0]);
              let retriedRange2 = false;
              if (rangeReturned2 < receiptRes2.sent) {
                await insertFn(chunks[0]);
                retriedRange2 = true;
                rangeReturned2 = await rangeCountChunk1(chunks[0]);
              }
              const isFailed2 = receiptRes2.missing.length > 0 || rangeReturned2 < receiptRes2.sent;
              diagVerifyPerChunk.push({
                index: 0,
                sent: receiptRes2.sent,
                returned: receiptRes2.returned,
                rangeReturned: rangeReturned2,
                missingCount: isFailed2 ? receiptRes2.sent - rangeReturned2 : 0,
                retried: receiptRes2.retried || retriedRange2,
              });
              if (receiptRes2.retried || retriedRange2) diagVerifyRetries++;
              if (isFailed2) failed.push(0);
              else savedCount += receiptRes2.sent;
              onProgress(1, totalChunks);
            } catch (e2) {
              failed.push(0);
              diagVerifyPerChunk.push({ index: 0, sent: chunks[0].length, returned: 0, rangeReturned: 0, missingCount: chunks[0].length, retried: false });
              onProgress(1, totalChunks);
            }
          }
          await yieldPaint();
          if (isStale()) return;
        }

        if (totalChunks > 1) {
          let nextIdx = 1;
          const CONCURRENCY = diagWorkerCount;
          const worker = async () => {
            while (true) {
              if (isStale()) break;
              const cur = nextIdx++;
              if (cur >= totalChunks) break;
              const chunk = chunks[cur];
              try {
                const res = await insertAndVerifyReceipt(chunk);
                diagVerifyPerChunk.push({ index: cur, sent: res.sent, returned: res.returned, missingCount: res.missing.length, retried: res.retried });
                if (res.retried) diagVerifyRetries++;
                if (res.missing.length > 0) failed.push(cur);
                else savedCount += res.sent;
              } catch (e) {
                try {
                  await yieldPaint();
                  if (isStale()) break;
                  const res2 = await insertAndVerifyReceipt(chunk);
                  diagVerifyPerChunk.push({ index: cur, sent: res2.sent, returned: res2.returned, missingCount: res2.missing.length, retried: res2.retried });
                  if (res2.retried) diagVerifyRetries++;
                  if (res2.missing.length > 0) failed.push(cur);
                  else savedCount += res2.sent;
                } catch (e2) {
                  failed.push(cur);
                  diagVerifyPerChunk.push({ index: cur, sent: chunk.length, returned: 0, missingCount: chunk.length, retried: false });
                }
              }
              onProgress(cur + 1, totalChunks);
              await yieldPaint();
              if (isStale()) break;
            }
          };
          const workers = Array.from({ length: Math.min(CONCURRENCY, totalChunks - 1) }, () => worker());
          await Promise.all(workers);
        }

        diagSavedCount = savedCount;
        diagFailed = failed;

        // FIX-VERIFY3: FINAL VERIFICATION — ONE range-count query user_id + date range + pending, throw LOUD, no warn swallow
        if (!isStale()) {
          const allDates = rows.map((r) => r.date).filter(Boolean).sort();
          const firstDate = allDates[0] || null;
          const lastDate = allDates[allDates.length - 1] || null;
          if (firstDate && lastDate) {
            const finalList = await db.list('schedule', {
              eq: { user_id: profile.id, status: 'pending' },
              gte: { date: firstDate },
              lte: { date: lastDate },
            });
            diagFinalCount = Array.isArray(finalList) ? finalList.length : 0;
            if (diagFinalCount < rows.length) {
              try {
                const reloadedPartial = await load();
                diagReloaded = reloadedPartial || [];
                const diag = buildPlanDiagnostics({
                  rows,
                  coverage: rows.coverage,
                  syllabus: plannedSyllabus,
                  profile,
                  settings,
                  savedCount: diagSavedCount,
                  failedChunks: diagFailed,
                  chunkSize: diagChunkSize,
                  workerCount: diagWorkerCount,
                  reloadedSessions: diagReloaded,
                  deleteDeletedCount: typeof diagDeleteCount !== 'undefined' ? diagDeleteCount : null,
                  verifyInfo: { perChunk: diagVerifyPerChunk, retries: diagVerifyRetries, finalCount: diagFinalCount },
                });
                setDiagnostics(diag);
                console.log('🩺 Plan diagnostics (final verify failed)', diag);
              } catch {}
              throw new Error(`Saved ${diagFinalCount}/${rows.length} — tap Generate again.`);
            }
          }
        }

        if (isStale()) return;

        if (failed.length) {
          try {
            const reloadedPartial = await load();
            diagReloaded = reloadedPartial || [];
            const diag = buildPlanDiagnostics({
              rows,
              coverage: rows.coverage,
              syllabus: plannedSyllabus,
              profile,
              settings,
              savedCount: diagSavedCount,
              failedChunks: diagFailed,
              chunkSize: diagChunkSize,
              workerCount: diagWorkerCount,
              reloadedSessions: diagReloaded,
              deleteDeletedCount: typeof diagDeleteCount !== 'undefined' ? diagDeleteCount : null,
              verifyInfo: { perChunk: diagVerifyPerChunk, retries: diagVerifyRetries, finalCount: diagFinalCount },
            });
            setDiagnostics(diag);
            console.log('🩺 Plan diagnostics (partial save)', diag);
          } catch {}
          throw new Error(`Schedule saved ${savedCount}/${rows.length} — tap Generate again to rebuild. Old completed days are kept. Failed chunks: ${failed.map((i)=>i+1).join(',')}`);
        }
      }

      if (syllabus.length && Object.keys(computedDeadlines).length) {
        tick('Saving deadlines…');
        await yieldPaint();
        if (isStale()) return;
        const deadlineUpdates = Object.entries(computedDeadlines).map(([id, deadline]) => ({
          id,
          patch: { deadline },
        }));
        if (typeof db.updateMany === 'function') {
          await db.updateMany('syllabus', deadlineUpdates);
        } else {
          const chunkSize = 20;
          for (let i = 0; i < deadlineUpdates.length; i += chunkSize) {
            if (isStale()) return;
            const chunk = deadlineUpdates.slice(i, i + chunkSize);
            await Promise.all(chunk.map(({ id, patch }) => db.update('syllabus', id, patch)));
          }
        }
      }

      tick('Reloading…');
      await yieldPaint();
      if (isStale()) return;
      const reloaded = await load();
      // FIX-SCOPE + FIX-VERIFY: build diagnostics object (success path) — from values already in scope + post-save readback
      try {
        const diag = buildPlanDiagnostics({
          rows,
          coverage: rows.coverage,
          syllabus: plannedSyllabus,
          profile,
          settings,
          savedCount: typeof diagSavedCount !== 'undefined' ? diagSavedCount : rows.length,
          failedChunks: typeof diagFailed !== 'undefined' ? diagFailed : [],
          chunkSize: typeof diagChunkSize !== 'undefined' ? diagChunkSize : 500,
          workerCount: typeof diagWorkerCount !== 'undefined' ? diagWorkerCount : 2,
          reloadedSessions: reloaded || [],
          deleteDeletedCount: typeof diagDeleteCount !== 'undefined' ? diagDeleteCount : null,
          verifyInfo: {
            perChunk: typeof diagVerifyPerChunk !== 'undefined' ? diagVerifyPerChunk : [],
            retries: typeof diagVerifyRetries !== 'undefined' ? diagVerifyRetries : 0,
            finalCount: typeof diagFinalCount !== 'undefined' ? diagFinalCount : (reloaded ? reloaded.length : null),
          },
        });
        setDiagnostics(diag);
        console.log('🩺 Plan diagnostics', diag);
      } catch (e) {
        console.log('🩺 diagnostics build failed', e?.message);
      }
      setGenOpen(false);
      setRegenChoiceOpen(false);
      clearWatchdog();
    } catch (e) {
      clearWatchdog();
      if (isStale()) return;
      setGenError(e?.message || 'Schedule generate nahi ho paya. Dobara try karo.');
    } finally {
      clearWatchdog();
      if (!isStale()) {
        setGenBusy(false);
        setGenProgress('');
        genBusyRef.current = false;
      }
    }
  };

  // AI-assisted catch-up: heuristic moves first, then Professor Byte
  // explains what to prioritise / drop (graceful if AI is offline).
  // FIX-D4: school exam awareness — heuristic skips exam days, AI prompt includes ranges
  const rescheduleMissed = async () => {
    setAiPlanBusy(true);
    try {
      const schoolExams = promo.schoolExamsForPlanning(); // FIX-S S5: retired exams excluded
      const { moved } = autoRescheduleMissed(sessions, { dailyHours: profile.daily_study_hours, schoolExams });
      for (const m of moved) await db.update('schedule', m.id, { date: m.date, status: 'pending' });
      await load();
      // AI advice on what to prioritise / drop (best-effort) — FIX-D4 includes school exams
      try {
        const behindTopics = missed.map((m) => m.topic || m.subject).filter(Boolean);
        const plan = await aiReschedule({
          missed: missed.slice(0, 8),
          upcomingCount: sessions.filter((s) => s.date >= todayStr() && s.status === 'pending').length,
          examDate: profile.exam_date,
          dailyHours: profile.daily_study_hours,
          behindTopics,
          schoolExams,
        });
        if (plan?.advice) setAiPlanMsg(plan.advice);
      } catch {
        setAiPlanMsg(''); // offline — heuristic moves already applied
      }
    } finally {
      setAiPlanBusy(false);
    }
  };

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '35%' }} />
      <ScreenHeader
        title="Smart Schedule"
        subtitle={profile.exam_date ? `Exam: ${profile.exam_date}` : 'No exam set — self-paced mode'}
        onBack={onBack}
        right={
          <View style={{ flexDirection: 'row' }}>
            <HeaderBtn icon="sparkles-outline" onPress={() => setGenOpen(true)} />
            <HeaderBtn icon="add" onPress={() => setAddOpen(true)} />
          </View>
        }
      />

      <SegmentedControl
        options={[
          { key: 'daily', label: 'Daily' },
          { key: 'weekly', label: 'Weekly' },
          { key: 'monthly', label: 'Monthly' },
        ]}
        value={view}
        onChange={setView}
        mode="light"
        style={{ marginBottom: 14 }}
      />

      {/* FIX-QA-UI: goals-first — DailyView immediately under tabs */}
      {loading ? <Loading mode="light" /> : null}

      {view === 'daily' ? (
        <DailyView
          selected={selected}
          setSelected={setSelected}
          sessions={daySessions}
          onComplete={completeSession}
          onSkip={skipSession}
          onGenerate={() => setGenOpen(true)}
        />
      ) : null}

      {view === 'weekly' ? (
        <WeeklyView
          weekDays={weekDays}
          sessions={sessions}
          today={todayStr()}
          onPickDay={(d) => {
            setSelected(d);
            setView('daily');
          }}
        />
      ) : null}

      {view === 'monthly' ? (
        <MonthlyView
          monthOffset={monthOffset}
          setMonthOffset={setMonthOffset}
          sessions={sessions}
          onPickDay={(d) => {
            setSelected(d);
            setMonthOffset(0);
            setView('daily');
          }}
        />
      ) : null}

      {/* FIX-ANCHOR: paused banner max 2 lines + button, present/future tense anchored */}
      {promo.paused ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#92400E', lineHeight: 16 }} numberOfLines={2}>
            ⏸️ Class planning paused till {promo.anchor ? promo.anchor.split('-').reverse().join('-') : '25-Feb'} — tap to decide
          </Text>
          <View style={{ height: 8 }} />
          <Button title="🎓 Promotion decide karo" size="sm" mode="light" onPress={() => setPromoOpen(true)} />
        </Card>
      ) : null}

      {/* FIX-ANCHOR: compact prompt chip max 2 lines + button, anchored */}
      {promo.state === 'prompt' && !promoOpen ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#5B21B6', flex: 1 }} numberOfLines={2}>
            🎓 Your Class 10 year ends {promo.anchor ? promo.anchor.split('-').reverse().join('-') : '25-Feb'} — {promo.toClass}?
          </Text>
          <Pressable onPress={() => setPromoOpen(true)} style={{ backgroundColor: '#6D28D9', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, marginLeft: 8 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#FFFFFF' }}>Decide</Text>
          </Pressable>
        </View>
      ) : null}

      {promo.msg ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#065F46', lineHeight: 18 }}>{promo.msg}</Text>
          <View style={{ height: 8 }} />
          <Button title="Naya plan generate karo ⚡" size="sm" mode="light" onPress={() => setRegenChoiceOpen(true)} />
        </Card>
      ) : null}

      {promo.error ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#B91C1C', lineHeight: 17 }}>⚠️ {promo.error}</Text>
          <View style={{ height: 8 }} />
          <Button title="Dobara try karo" size="sm" variant="secondary" mode="light" onPress={() => setPromoOpen(true)} />
        </Card>
      ) : null}

      {/* BUG 10: live priority order — proof the setting is applied */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          backgroundColor: '#F8FAFC',
          borderWidth: 1,
          borderColor: '#E2E8F0',
          borderRadius: radius.md,
          paddingHorizontal: 10,
          paddingVertical: 7,
          marginBottom: 12,
        }}
      >
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, color: '#64748B', marginRight: 7 }}>
          PRIORITY:
        </Text>
        {activePrio.map((t, i) => {
          const icons = { class: '🏫 Class', exam: '🎯 Exam', olympiad: '🏅 Olympiad' };
          const pct = profile?.priorities?.timeSplit?.[t];
          const label = icons[t] || `⭐ ${profile?.priorities?.custom?.[t]?.name || 'Custom'}`;
          return (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center' }}>
              {i > 0 ? <Text style={{ fontSize: 10, color: '#CBD5E1', marginHorizontal: 4 }}>→</Text> : null}
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#334155' }}>
                {label}
                {typeof pct === 'number' ? ` ${pct}%` : ''}
              </Text>
            </View>
          );
        })}
        {(() => { const arc = arcOf(profile); return arc ? (
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 10.5, color: arc.theme, marginLeft: 8 }}>
            {arc.emoji} {arc.label} — {effectiveDailyHours(profile)}h/day
          </Text>
        ) : null; })()}
      </View>

      {genError ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#B91C1C' }}>{genError}</Text>
          <Button title="Retry" size="sm" mode="light" onPress={() => setRegenChoiceOpen(true)} style={{ marginTop: 8 }} />
        </Card>
      ) : null}

      {autoRollMsg ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#065F46', lineHeight: 17 }}>{autoRollMsg}</Text>
        </Card>
      ) : null}
      {missed.length > 0 ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#92400E', flex: 1 }}>
            {missed.length} quest{missed.length > 1 ? 's' : ''} miss/skipped ho gaye. FIX-E: auto-roll on load already tried — if still here, tap to shift again.
            Class-track quests pehle shift honge 🏫 Skipped = kal auto-roll forward ⏭️ (now automatic on load)
          </Text>
          <Button
            title={aiPlanBusy ? 'Rescheduling…' : 'Auto-reschedule missed + skipped (AI catch-up)'}
            size="sm"
            mode="light"
            onPress={rescheduleMissed}
            loading={aiPlanBusy}
            style={{ marginTop: 10 }}
          />
          {aiPlanMsg ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#B45309', marginTop: 8, lineHeight: 17 }}>
              Professor Byte: {aiPlanMsg}
            </Text>
          ) : null}
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#92400E', marginTop: 8, lineHeight: 15 }}>
            ℹ️ Skip = is quest ko kal shift karna, delete nahi. Missed/skipped auto-roll on screen load (FIX-E) + manual button still available.
          </Text>
        </Card>
      ) : null}

      {/* FIX-QA-UI + FIX-FILL: collapsed coverage+warning — compact dismissible summary, goals-first, green ✅ when covered */}
      {coverage ? (
        (() => {
          const isCovered = !!(coverage.coverageWarning && String(coverage.coverageWarning).toLowerCase().includes('syllabus covered'));
          const isWarn = !!(coverage.coverageWarning && !isCovered);
          return (
            <Pressable
              onPress={() => setCoverageExpanded((v) => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: isWarn ? '#FEF2F2' : isCovered ? '#ECFDF5' : '#F5F3FF',
                borderWidth: 1,
                borderColor: isWarn ? '#FECACA' : isCovered ? '#A7F3D0' : '#DDD6FE',
                borderRadius: 20,
                paddingVertical: 7,
                paddingHorizontal: 12,
                marginTop: 8,
                marginBottom: 8,
              }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: isWarn ? '#B91C1C' : isCovered ? '#065F46' : '#5B21B6', flex: 1 }} numberOfLines={1}>
                {isWarn ? '⚠️ ' : '✅ '}
                🏫 {coverage.classPlanned}/{coverage.classTotal}
                {coverage.olympiadTotal ? ` · 🏅 ${coverage.olympiadPlanned}/${coverage.olympiadTotal}` : ''}
                {coverage.examTotal ? ` · 🎯 ${coverage.examPlanned}/${coverage.examTotal}` : ''}
                {coverage.totalRequiredHours ? ` · ${coverage.totalRequiredHours}h req` : ''}
                {isCovered ? ' · syllabus covered' : ''}
                {'  '}Tap to {coverageExpanded ? 'collapse' : 'expand'}
              </Text>
              <Ionicons name={coverageExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={isWarn ? '#B91C1C' : isCovered ? '#065F46' : '#5B21B6'} />
            </Pressable>
          );
        })()
      ) : null}
      {coverage && coverageExpanded ? (
        <>
          <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#5B21B6' }}>
              🏫 Class {coverage.classPlanned}/{coverage.classTotal} planned
              {coverage.olympiadTotal ? ` · 🏅 Olympiad ${coverage.olympiadPlanned}/${coverage.olympiadTotal}` : ''}
              {coverage.examTotal ? ` · 🎯 ${profile.competitive_exam || 'Exam'} ${coverage.examPlanned}/${coverage.examTotal}` : ''}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#7C3AED', marginTop: 4, lineHeight: 16 }}>
              {coverage.classDoneBy && coverage.nextSchoolExam
                ? `Class syllabus target: done by ${coverage.classDoneBy} — 2 weeks before "${coverage.nextSchoolExam.label || coverage.nextSchoolExam.start || 'School Exam'}" (${coverage.nextSchoolExam.start || ''}) 📅`
                : coverage.perTagInEffect && coverage.finalClass && coverage.finalCutoff
                  ? `Plan horizon: till ${coverage.finalCutoff} (Class-${coverage.finalClass} window till ${coverage.finalCutoff}) — base ${coverage.baseCutoff || classSessionCutoff(coverage.today || todayStr(), settings.classSessionEnd || '02-25')} — class first, olympiad second, exam last ⚡`
                  : `Plan horizon: till ${classSessionCutoff(coverage.today || todayStr(), settings.classSessionEnd || '02-25')} (${settings.classSessionEnd || '02-25'} session end) — class first, olympiad second, exam last ⚡`}
            </Text>
            {coverage.totalRequiredHours ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 6, lineHeight: 15 }}>
                📊 Total: {coverage.totalRequiredHours} hrs required · {coverage.totalAvailableHours} hrs available · {coverage.requiredPerDay} hrs/day needed · Weekday {coverage.weekdayHours ?? effectiveWeekdayHours(profile)}h / Weekend {coverage.weekendHours ?? effectiveWeekendHours(profile)}h · Avg {coverage.weeklyAvgHours ?? effectiveWeeklyAverageHours(profile)}h · Emphasis School {settings.hoursMultiplier ?? 2.0}× / Olympiad {settings.olympiadMultiplier ?? 3.0}× / Comp {settings.examMultiplier ?? 2.0}× — affects order, not size (D15) · Blend [D17]
              </Text>
            ) : null}
          </Card>
          {coverage.coverageWarning ? (
            (() => {
              const isCovered = String(coverage.coverageWarning).toLowerCase().includes('syllabus covered');
              return (
                <Card mode="light" style={{ marginBottom: 12, backgroundColor: isCovered ? '#ECFDF5' : '#FEF2F2', borderColor: isCovered ? '#A7F3D0' : '#FECACA' }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: isCovered ? '#065F46' : '#B91C1C', lineHeight: 18 }}>
                    {isCovered ? `✅ ${coverage.coverageWarning}` : coverage.coverageWarning}
                  </Text>
                  {!isCovered ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#B45309', marginTop: 6, lineHeight: 15 }}>
                      💡 How to fix: increase daily study hours in Settings, push exam date later. Emphasis School {settings.hoursMultiplier ?? 2.0}× / Olympiad {settings.olympiadMultiplier ?? 3.0}× / Comp {settings.examMultiplier ?? 2.0}× — affects order, not size (D15). Plan honestly shows shortfall till {classSessionCutoff(coverage.today || todayStr(), settings.classSessionEnd || '02-25')}, never fabricates impossible hours.
                    </Text>
                  ) : null}
              {coverage.overloaded && Array.isArray(coverage.unscheduled) && coverage.unscheduled.length ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#991B1B', marginTop: 6, lineHeight: 16 }}>
                  Not scheduled yet:{' '}
                  {coverage.unscheduled
                    .slice(0, 4)
                    .map((u) => `${u.chapter} (${u.remainingHours}h${u.deadline ? `, due ${u.deadline}` : ''})`)
                    .join(', ')}
                  {coverage.unscheduled.length > 4 ? ` +${coverage.unscheduled.length - 4} more` : ''}
                </Text>
              ) : null}
              {coverage.overloaded && Array.isArray(coverage.unscheduled) && coverage.unscheduled.length ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#991B1B', marginTop: 6, lineHeight: 16 }}>
                  Not scheduled yet:{' '}
                  {coverage.unscheduled
                    .slice(0, 4)
                    .map((u) => `${u.chapter} (${u.remainingHours}h${u.deadline ? `, due ${u.deadline}` : ''})`)
                    .join(', ')}
                  {coverage.unscheduled.length > 4 ? ` +${coverage.unscheduled.length - 4} more` : ''}
                </Text>
              ) : null}
              {Array.isArray(coverage.partial) && coverage.partial.length ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#991B1B', marginTop: 4, lineHeight: 16 }}>
                  Started but unfinished: {coverage.partial.length} chapter(s) —{' '}
                  {coverage.partial
                    .slice(0, 3)
                    .map((u) => `${u.chapter} (${u.plannedHours}h of ${(u.plannedHours + u.remainingHours).toFixed(1)}h)`)
                    .join(', ')}
                  {coverage.partial.length > 3 ? ` +${coverage.partial.length - 3} more` : ''}
                </Text>
              ) : null}
                </Card>
              );
            })()
          ) : null}
        </>
      ) : null}

      {/* FIX-SCOPE D19b: diagnostics panel — ZERO behavior changes, built at end of generate() */}
      {diagnostics ? (
        <Pressable
          onPress={() => setDiagExpanded(v=>!v)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#F0F9FF',
            borderWidth: 1,
            borderColor: '#BAE6FD',
            borderRadius: 16,
            paddingVertical: 6,
            paddingHorizontal: 10,
            marginTop: 8,
            marginBottom: 8,
          }}
        >
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#0369A1', flex: 1 }} numberOfLines={1}>
            🩺 Plan diagnostics (tap to {diagExpanded ? 'collapse' : 'expand / copy'})
          </Text>
          <Ionicons name={diagExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#0369A1" />
        </Pressable>
      ) : null}
      {diagnostics && diagExpanded ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#334155' }}>Diagnostics JSON</Text>
            <Pressable
              onPress={async () => {
                const txt = JSON.stringify(diagnostics, null, 2);
                try {
                  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(txt);
                  } else {
                    // fallback for native: try expo-clipboard if available
                    try {
                      const Clipboard = await import('expo-clipboard');
                      if (Clipboard && Clipboard.setStringAsync) await Clipboard.setStringAsync(txt);
                    } catch {}
                  }
                  // simple feedback via console + alert
                  console.log('📋 diagnostics copied');
                  if (typeof window !== 'undefined' && window.alert) window.alert('Diagnostics copied to clipboard');
                } catch (e) {
                  console.log('copy failed', e?.message);
                }
              }}
              style={{ backgroundColor: '#0EA5E9', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#FFFFFF' }}>Copy</Text>
            </Pressable>
          </View>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: '#334155', lineHeight: 14 }}>
            {JSON.stringify(diagnostics, null, 2)}
          </Text>
        </Card>
      ) : null}

      {/* Generate modal — FIX-SCHED3: shows effective hours + progress + editable session end */}
      <ModalSheet visible={genOpen} onClose={() => setGenOpen(false)} title="Generate Smart Schedule" mode="light">
        <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: '#475569', lineHeight: 20, marginBottom: 14 }}>
          Ye engine tumhare syllabus ke weightage + estimated hours (× weightage factor) + available time se ek day-by-day plan banayegi —
          revision cycles, Sunday mock tests aur exam-ke-pehle buffer days ke saath. Emphasis School {settings.hoursMultiplier ?? 2.0}× / Olympiad {settings.olympiadMultiplier ?? 3.0}× / Comp {settings.examMultiplier ?? 2.0}× — affects order, not size (D15). Plan horizon: till {classSessionCutoff(todayStr(), settings.classSessionEnd || '02-25')} ({settings.classSessionEnd || '02-25'} session end) + 14d buffer, per-track hard ends.
        </Text>
        <InfoRow label="Study hours" value={`Weekday ${effectiveWeekdayHours(profile)}h / Weekend ${effectiveWeekendHours(profile)}h · Avg ${effectiveWeeklyAverageHours(profile)}h/day · Blend [D17]`} />
        <InfoRow label="Emphasis" value={`School ${settings.hoursMultiplier ?? 2.0}× / Olympiad ${settings.olympiadMultiplier ?? 3.0}× / Competitive ${settings.examMultiplier ?? 2.0}× — affects order, not size (D15)`} />
        <InfoRow label="Preferred time" value={profile.preferred_time || 'Night'} />
        <InfoRow label="Days off" value={(profile.days_off || []).length ? `${profile.days_off.length} days/week = 50% quota — revision/mock/practice only, never free [D20b]` : 'None (Sat+Sun = weekend)'} />
        <InfoRow label="Light day" value={`${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][settings.lightDay ?? 6]} — 50% of its own day-type [D17/D20b]`} />
        <InfoRow label="Exam date" value={profile.exam_date || 'Not set'} />
        <InfoRow label="Olympiad" value={profile.olympiad && profile.olympiad !== 'None' ? `${profile.olympiad}${profile.olympiad_date ? ` · ${profile.olympiad_date}` : ''}` : 'None'} />
        <InfoRow
          label="School exams"
          value={
            (profile.school_exams || []).length
              ? (profile.school_exams || [])
                  .map((e) => `${e.label} (${e.exact ? e.date || e.start_date : `${e.start_date || e.date} → ${e.end_date || e.date}`})`)
                  .join(', ')
              : 'Not set — add in Settings for class-first planning'
          }
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#5B21B6', marginTop: 10, marginBottom: 4, lineHeight: 17 }}>
          Priority: {prioritySummary()}. Revision waves + mocks + timed practice included. Shortfall honestly reported, never fabricated.
        </Text>
        {genBusy && genProgress ? (
          <View style={{ backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', borderRadius: 8, padding: 8, marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#166534' }}>{genProgress}</Text>
          </View>
        ) : null}
        {genError ? (
          <View style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 8, padding: 8, marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#B91C1C' }}>{genError}</Text>
          </View>
        ) : null}
        <Button
          title="Generate My Plan ⚡"
          mode="light"
          loading={genBusy}
          onPress={() => setRegenChoiceOpen(true)}
          style={{ marginBottom: 10 }}
        />
      </ModalSheet>

      {/* FIX D: regeneration always asks — never silently piles new on old */}
      <ModalSheet visible={regenChoiceOpen} onClose={() => setRegenChoiceOpen(false)} title="How should we rebuild?" mode="light">
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#475569', lineHeight: 19, marginBottom: 14 }}>
          Regenerating builds a fresh plan from your syllabus progress. Your completed chapters, deadlines and XP stay safe —
          only the schedule slots change.
        </Text>
        <Button
          title="🔄 Keep completed, replace the rest"
          mode="light"
          loading={genBusy}
          onPress={() => {
            setRegenChoiceOpen(false);
            generate('keep-completed');
          }}
          style={{ marginBottom: 10 }}
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: -4, marginBottom: 14, lineHeight: 16 }}>
          Recommended — completed/skipped history stays, pending quests rebuild from where you are.
        </Text>
        <Button
          title="🧹 Replace my whole schedule (fresh start)"
          variant="secondary"
          mode="light"
          disabled={genBusy}
          onPress={() => {
            setRegenChoiceOpen(false);
            generate('fresh');
          }}
          style={{ marginBottom: 6 }}
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginBottom: 10, lineHeight: 16 }}>
          Wipes ALL schedule entries (including completed history) and starts clean. Syllabus progress is still preserved.
        </Text>
        <Button title="Cancel" variant="ghost" mode="light" onPress={() => setRegenChoiceOpen(false)} />
      </ModalSheet>

      {/* Add block modal */}
      <AddBlockModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        userId={profile?.id}
        defaultDate={selected}
        onAdded={load}
      />

      {/* FIX-S S5: the promotion sheet (same component Home uses) */}
      <PromotionSheet
        visible={promoOpen}
        onClose={() => { setPromoOpen(false); promo.dismiss(); }}
        streams={promo.streams}
        toClass={promo.toClass}
        preset={promo.preset}
        anchor={promo.anchor}
        busy={promo.busy}
        error={promo.error}
        onAccept={onPromoAccept}
        onDecline={onPromoDecline}
      />
    </Screen>
  );
}

// ---------------- DAILY ----------------
function DailyView({ selected, setSelected, sessions, onComplete, onSkip, onGenerate }) {
  const done = sessions.filter((s) => s.status === 'completed').length;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <NavArrow dir="left" onPress={() => setSelected(dateStr(dayjs(selected).subtract(1, 'day')))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#1E293B' }}>
            {dayjs(selected).format('dddd')}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B' }}>
            {dayjs(selected).format('DD MMM YYYY')} · {done}/{sessions.length} done
          </Text>
        </View>
        <NavArrow
          dir="right"
          onPress={() => setSelected(dateStr(dayjs(selected).add(1, 'day')))}
        />
      </View>

      {selected !== todayStr() ? (
        <Pressable onPress={() => setSelected(todayStr())} style={{ alignSelf: 'center', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#6D28D9' }}>Jump to today</Text>
        </Pressable>
      ) : null}

      {sessions.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontSize: 34, textAlign: 'center', marginBottom: 8 }}>🌤️</Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', textAlign: 'center' }}>
            Aaj koi quest nahi hai
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Smart Schedule generate karo — ya manually block add karo.
          </Text>
          <Button title="Generate Smart Schedule ⚡" size="sm" mode="light" onPress={onGenerate} />
        </Card>
      ) : (
        sessions.map((s) => (
          <SessionBlock key={s.id} s={s} onComplete={onComplete} onSkip={onSkip} />
        ))
      )}
    </View>
  );
}

const TRACK_BADGE = { class: { icon: '🏫', label: 'Class' }, olympiad: { icon: '🏅', label: 'Olympiad' }, exam: { icon: '🎯', label: 'Exam' } };

const SessionBlock = memo(function SessionBlock({ s, onComplete, onSkip }) {
  const type = SESSION_TYPES[s.session_type] || SESSION_TYPES.study || { icon: '📚', label: 'Study', color: '#6D28D9' };
  const color = type.color;
  const completed = s.status === 'completed';
  const skipped = s.status === 'skipped';
  const badge = TRACK_BADGE[(s.track === 'olympiad' || s.track === 'exam') ? s.track : 'class'];
  return (
    <View
      style={{
        backgroundColor: completed ? '#F0FDF4' : '#FFFFFF',
        borderWidth: 1,
        borderColor: completed ? '#BBF7D0' : skipped ? '#E2E8F0' : '#E2E8F0',
        borderRadius: radius.lg,
        padding: 12,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: skipped ? 0.55 : 1,
      }}
    >
      <View style={{ width: 5, height: 52, borderRadius: 3, backgroundColor: color, marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', flexShrink: 1 }}>
            {s.start_time}–{s.end_time} · {fmtDuration(s.duration_minutes)} · {type.icon} {type.label}
          </Text>
          {badge && badge.label !== 'Class' ? (
            <View style={{ backgroundColor: '#FFFBEB', borderColor: badge.label === 'Olympiad' ? '#FDE68A' : '#FEE2E2', borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 6 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 9.5, color: badge.label === 'Olympiad' ? '#B45309' : '#B91C1C' }}>
                {badge.icon} {badge.label}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.bodySemiBold,
            fontSize: 14.5,
            color: '#1E293B',
            marginTop: 2,
            textDecorationLine: completed ? 'line-through' : 'none',
          }}
        >
          {s.topic || s.subject}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: color, marginTop: 2 }}>{s.subject}</Text>
      </View>
      {!completed && !skipped ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => onSkip(s)} hitSlop={8} style={{ padding: 8, alignItems: 'center' }}>
            <Ionicons name="time-outline" size={19} color="#94A3B8" />
            <Text style={{ fontFamily: fonts.body, fontSize: 9, color: '#94A3B8', marginTop: 1 }}>Kal</Text>
          </Pressable>
          <Pressable
            onPress={() => onComplete(s)}
            hitSlop={6}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4,
            }}
          >
            <Ionicons name="checkmark" size={20} color={color} />
          </Pressable>
        </View>
      ) : (
        <Text style={{ fontSize: 18 }}>{completed ? '✅' : '⏭️'}</Text>
      )}
    </View>
  );
});

// ---------------- WEEKLY ----------------
function WeeklyView({ weekDays, sessions, today, onPickDay }) {
  return (
    <View>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#64748B', marginBottom: 10 }}>
        Tap a day to open its quests · colours = subjects
      </Text>
      {weekDays.map((d) => {
        const list = sessions.filter((s) => s.date === d).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
        const done = list.filter((s) => s.status === 'completed').length;
        const isToday = d === today;
        return (
          <Pressable
            key={d}
            onPress={() => onPickDay(d)}
            style={({ pressed }) => ({
              backgroundColor: isToday ? '#EEF2FF' : '#FFFFFF',
              borderWidth: 1,
              borderColor: isToday ? '#C7D2FE' : '#E2E8F0',
              borderRadius: radius.md,
              padding: 12,
              marginBottom: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#1E293B', flex: 1 }}>
                {dayjs(d).format('ddd · DD MMM')} {isToday ? '· TODAY' : ''}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: done === list.length && list.length ? '#059669' : '#64748B' }}>
                {done}/{list.length} done
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {list.length ? (
                list.slice(0, 5).map((s) => (
                  <View
                    key={s.id}
                    style={{
                      backgroundColor: subjectColor(s.subject) + (s.status === 'completed' ? '33' : '1F'),
                      borderWidth: 1,
                      borderColor: subjectColor(s.subject) + (s.status === 'completed' ? '55' : '99'),
                      borderRadius: 7,
                      paddingVertical: 3,
                      paddingHorizontal: 8,
                      marginRight: 6,
                      marginBottom: 6,
                    }}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, color: '#1E293B', flexShrink: 1 }}>
                      {s.start_time} {s.topic || s.subject}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8' }}>Rest day / no quests</Text>
              )}
              {list.length > 5 ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#94A3B8', alignSelf: 'center' }}>
                  +{list.length - 5} more
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------- MONTHLY ----------------
function MonthlyView({ monthOffset, setMonthOffset, sessions, onPickDay }) {
  const base = dayjs().add(monthOffset, 'month').startOf('month');
  const startWeekday = (base.day() + 6) % 7; // Monday-first
  const daysInMonth = base.daysInMonth();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(base.date(d));

  const byDate = {};
  for (const s of sessions) {
    (byDate[s.date] = byDate[s.date] || []).push(s);
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <NavArrow dir="left" onPress={() => setMonthOffset((m) => m - 1)} />
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B' }}>
          {base.format('MMMM YYYY')}
        </Text>
        <NavArrow dir="right" onPress={() => setMonthOffset((m) => m + 1)} />
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: fonts.bodyMedium, fontSize: 11, color: '#94A3B8' }}>
            {d}
          </Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={i} style={{ width: '14.28%', height: 54 }} />;
          const d = dateStr(cell);
          const list = byDate[d] || [];
          const hasMock = list.some((s) => s.session_type === 'mock');
          const hasRevision = list.some((s) => s.session_type === 'revision');
          const allDone = list.length && list.every((s) => s.status === 'completed');
          const isToday = d === todayStr();
          return (
            <Pressable
              key={i}
              onPress={() => onPickDay(d)}
              style={{
                width: '14.28%',
                height: 54,
                alignItems: 'center',
                paddingTop: 6,
                borderRadius: 8,
                backgroundColor: hasMock ? '#FFF7ED' : hasRevision ? '#ECFEFF' : 'transparent',
                borderWidth: isToday ? 1.5 : 0,
                borderColor: '#818CF8',
              }}
            >
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: isToday ? '#4F46E5' : '#334155' }}>
                {cell.date()}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                {list.slice(0, 3).map((s) => (
                  <View
                    key={s.id}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      marginHorizontal: 1,
                      backgroundColor: allDone ? '#10B981' : subjectColor(s.subject),
                    }}
                  />
                ))}
                {hasMock ? <Text style={{ fontSize: 8 }}>📝</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
        <Legend color="#F59E0B" label="Mock day" />
        <Legend color="#0891B2" label="Revision week" />
        <Legend color="#10B981" label="All done" />
        <Legend color="#7C3AED" label="Study quest" />
      </View>
    </View>
  );
}

function Legend({ color, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color, marginRight: 5 }} />
      <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B' }}>{label}</Text>
    </View>
  );
}

// ---------------- helpers ----------------
function HeaderBtn({ icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        backgroundColor: '#F1F5F9',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 10,
        padding: 7,
        marginLeft: 8,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color="#6D28D9" />
    </Pressable>
  );
}

function NavArrow({ dir, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={{ padding: 8 }}>
      <Ionicons name={dir === 'left' ? 'chevron-back' : 'chevron-forward'} size={20} color="#64748B" />
    </Pressable>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 7, alignItems: 'flex-start' }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', width: 110, flexShrink: 0, marginRight: 8 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B', flex: 1, flexShrink: 1, flexWrap: 'wrap' }}>{value}</Text>
    </View>
  );
}

function AddBlockModal({ visible, onClose, userId, defaultDate, onAdded }) {
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [type, setType] = useState('study');
  const [startTime, setStartTime] = useState('18:00');
  const [minutes, setMinutes] = useState('45');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      const m = Math.max(15, Number(minutes) || 45);
      const endTime = dayjs(`2000-01-01 ${startTime}`).add(m, 'minute').format('HH:mm');
      await db.insert('schedule', {
        user_id: userId,
        date: defaultDate,
        start_time: startTime,
        end_time: endTime,
        subject: subject.trim(),
        topic: topic.trim() || subject.trim(),
        session_type: type,
        status: 'pending',
        duration_minutes: m,
        priority: 'normal',
        created_at: nowIso(),
      });
      setSubject('');
      setTopic('');
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Add Quest / Time Block" mode="light">
      <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Physics" />
      <Input label="Topic" value={topic} onChangeText={setTopic} placeholder="e.g. Rotational Motion" />
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#64748B', marginBottom: 8 }}>
        Session type
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Object.entries(SESSION_TYPES).map(([key, t]) => (
          <Chip key={key} label={`${t.icon} ${t.label}`} selected={type === key} onPress={() => setType(key)} mode="light" small />
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Input label="Start (HH:MM)" value={startTime} onChangeText={setStartTime} placeholder="18:00" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="numeric" />
        </View>
      </View>
      <Button title="Add Quest" mode="light" onPress={save} loading={busy} disabled={!subject.trim()} />
    </ModalSheet>
  );
}
