// GYM / WORKOUT TRACKER — FIX-GYM cohesion round
// edit/delete everywhere + last-session prefill + bodyweight finish + CSV import + split day-memory + sets/reps bug fix
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Confetti } from '../../components/gamer/Confetti';
import { EmptyState, SectionTitle } from '../../components/ui/EmptyState';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { db } from '../../lib/db';
import { infoAlert } from '../../lib/alert';
import { GYM_PLANS, GYM_SPLITS, MUSCLE_GROUPS, EXERCISE_LIBRARY } from '../../config/constants';
import { hasEarnedToday, markEarnedToday } from '../../lib/xpOnce';
import { getWeeklyGymSplit, normalizeGymSplit, gymSplitBadgeText, todayWorkout, getExercisesForGroups, normalizeGymSplitV2, getSplitDefinition } from '../../lib/gymSplit';
import { fonts, radius } from '../../config/theme';
import { todayStr, dateStr, dayjs, mondayOf, nowIso, fmtDate } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ---------- FIX-GYM helpers ----------
function applyGymOverrides(exercises, overrides = {}) {
  if (!overrides || typeof overrides !== 'object') return exercises;
  const out = [];
  for (const ex of exercises) {
    const ov = overrides[ex.name] || overrides[ex.originalName] || null;
    if (ov && ov.isRemoved) continue;
    if (ov) {
      out.push({ ...ex, ...ov, originalName: ex.originalName || ex.name, _isOverridden: true });
    } else {
      out.push(ex);
    }
  }
  return out;
}

function parseCSV(text) {
  if (!text || typeof text !== 'string') return { error: 'Empty CSV', rows: [] };
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
  if (!lines.length) return { error: 'Empty CSV', rows: [] };
  const header = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const required = ['name','sets','reps','group'];
  const missing = required.filter(r=>!header.includes(r));
  if (missing.length) return { error: `Missing header: ${missing.join(',')} — expected name,sets,reps,group`, rows: [] };
  const idxName = header.indexOf('name');
  const idxSets = header.indexOf('sets');
  const idxReps = header.indexOf('reps');
  const idxGroup = header.indexOf('group');
  const rows = [];
  const errors = [];
  for (let i=1;i<lines.length;i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',').map(c=>c.trim());
    if (cols.length < 4) { errors.push(`Line ${i+1}: expected 4 cols, got ${cols.length}`); continue; }
    const name = cols[idxName];
    const sets = cols[idxSets];
    const reps = cols[idxReps];
    const group = cols[idxGroup];
    if (!name) { errors.push(`Line ${i+1}: name empty`); continue; }
    const setsNum = Number(sets);
    if (sets && (Number.isNaN(setsNum) || setsNum <=0)) { errors.push(`Line ${i+1}: sets invalid ${sets}`); continue; }
    if (!group) { errors.push(`Line ${i+1}: group empty`); continue; }
    rows.push({ name, sets: sets ? Number(sets) : 3, reps: reps || '12', group });
  }
  if (!rows.length && errors.length) return { error: errors[0], rows: [], allErrors: errors };
  return { error: errors.length ? errors.join('; ') : null, rows, allErrors: errors };
}

function formatLastRelative(dateStrVal) {
  if (!dateStrVal) return '';
  try {
    const d = dayjs(dateStrVal);
    const now = dayjs(todayStr());
    const diff = now.diff(d, 'day');
    if (diff <=0) return 'today';
    if (diff===1) return '1 day ago';
    if (diff<7) return `${diff} days ago`;
    if (diff<30) return `${Math.floor(diff/7)} wk ago`;
    return d.format('MMM D');
  } catch { return dateStrVal; }
}

function buildLastSessionMap(logs) {
  const map = {};
  if (!Array.isArray(logs)) return map;
  const sorted = [...logs].sort((a,b)=> String(b.date).localeCompare(String(a.date)));
  for (const log of sorted) {
    for (const ex of log.exercises || []) {
      if (!map[ex.name]) {
        map[ex.name] = { sets: ex.sets, reps: ex.reps, weight: ex.weight, date: log.date, method: ex.method || 'weighted' };
      }
    }
  }
  return map;
}

// FIX-GYM: custom_splits shape helpers
function getCustomSplitsForDay(customSplits, splitType, dayLabel) {
  if (!customSplits || typeof customSplits !== 'object') return null;
  const byType = customSplits[splitType];
  if (!byType || typeof byType !== 'object') return null;
  return byType[dayLabel] || null;
}

export function GymScreen({ navigation }) {
  const { profile, updateProfile } = useAuth();
  const { awardXP } = useGame();
  const { width } = useWindowDimensions();
  const narrow = width < 420;
  const [logs, setLogs] = useState(null);
  const [planKey, setPlanKey] = useState('home');
  const [entries, setEntries] = useState({});
  const [confetti, setConfetti] = useState(0);
  const [saving, setSaving] = useState(false);
  const [customExercises, setCustomExercises] = useState([]);
  const [newEx, setNewEx] = useState('');

  // FIX-C state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardType, setWizardType] = useState('ppl');
  const [wizardRestDays, setWizardRestDays] = useState([6]);
  const [wizardCustomDays, setWizardCustomDays] = useState([
    { name: 'Day 1', groups: ['Chest','Triceps'] },
    { name: 'Day 2', groups: ['Back','Biceps'] },
    { name: 'Day 3', groups: ['Quads','Hamstrings'] },
  ]);
  const [mode, setMode] = useState('split');
  const [overrideMap, setOverrideMap] = useState({});
  const [customDayEdit, setCustomDayEdit] = useState(null);
  const [customDayForm, setCustomDayForm] = useState({ name: '', groups: [] });

  // FIX-GYM new state
  const [gymOverrides, setGymOverrides] = useState({}); // profile.gym_overrides jsonb
  const [customSplits, setCustomSplits] = useState({}); // profile.custom_splits jsonb
  const [doneMap, setDoneMap] = useState({}); // { [name]: boolean }
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // original exercise name or object
  const [editForm, setEditForm] = useState({ name: '', sets: '', reps: '', group: '' });
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState(null); // { rows, error }
  const [dayEditOpen, setDayEditOpen] = useState(false);
  const [dayEditList, setDayEditList] = useState([]); // exercises for current day
  const [dayEditNew, setDayEditNew] = useState({ name: '', sets: '3', reps: '12', group: 'Chest' });

  const gymSplit = useMemo(() => normalizeGymSplitV2(profile?.gym_split), [profile?.gym_split]);

  useEffect(() => {
    if (Array.isArray(profile?.custom_exercises)) setCustomExercises(profile.custom_exercises);
  }, [profile?.custom_exercises]);

  useEffect(() => {
    if (profile?.gym_overrides && typeof profile.gym_overrides === 'object') {
      setGymOverrides(profile.gym_overrides);
    } else if (typeof profile?.gym_overrides === 'string') {
      try { setGymOverrides(JSON.parse(profile.gym_overrides)); } catch { setGymOverrides({}); }
    }
  }, [profile?.gym_overrides]);

  useEffect(() => {
    if (profile?.custom_splits && typeof profile.custom_splits === 'object') {
      setCustomSplits(profile.custom_splits);
    } else if (typeof profile?.custom_splits === 'string') {
      try { setCustomSplits(JSON.parse(profile.custom_splits)); } catch { setCustomSplits({}); }
    }
  }, [profile?.custom_splits]);

  useEffect(() => {
    if (gymSplit) {
      setMode(gymSplit.mode || 'split');
    }
  }, [gymSplit]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('sos.gym.override');
        if (raw) setOverrideMap(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  const saveOverrideMap = async (next) => {
    setOverrideMap(next);
    try { await AsyncStorage.setItem('sos.gym.override', JSON.stringify(next)); } catch {}
  };

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('workout_logs', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false } });
    setLogs(rows);
  }, [profile?.id]);

  const onBack = useHubBack(navigation, 'LifeHub');
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (profile && !profile.gym_split && logs !== null) {
      setWizardOpen(true);
      setWizardStep(1);
    }
  }, [profile?.gym_split, logs]);

  // FIX-GYM BUG: remove defaults that blocked ?? fallback and risked clearing
  const setEntry = (name, patch) =>
    setEntries((e) => ({
      ...e,
      [name]: { ...(e[name] || {}), ...patch },
    }));

  const today = todayStr();
  const todayInfo = useMemo(() => {
    if (!gymSplit) return null;
    return todayWorkout(gymSplit, today);
  }, [gymSplit, today]);

  const isTodayOverridden = Boolean(overrideMap[today]);
  const effectiveToday = useMemo(() => {
    if (!todayInfo) return null;
    if (todayInfo.isRest && isTodayOverridden) {
      const def = getSplitDefinition(gymSplit?.type);
      const fallback = def?.dayTypes?.[0] || { label: 'Full Body (override)', groups: ['Chest','Back','Quads','Abs/Core'] };
      return { ...fallback, isRest: false, isOverride: true };
    }
    return todayInfo;
  }, [todayInfo, isTodayOverridden, gymSplit]);

  const lastSessionMap = useMemo(() => buildLastSessionMap(logs), [logs]);

  const baseTodayExercises = useMemo(() => {
    if (mode !== 'split' || !effectiveToday || effectiveToday.isRest) return [];
    const groups = effectiveToday.groups || [];
    if (!groups.length) return [];
    const libMode = 'gym';
    return getExercisesForGroups(groups, libMode);
  }, [effectiveToday, mode]);

  const todayExercises = useMemo(() => {
    // apply overrides
    let list = applyGymOverrides(baseTodayExercises, gymOverrides);
    // FIX-GYM day-memory: if customSplits has entry for this split type + day label, use it (but still apply overrides for safety)
    if (gymSplit && effectiveToday?.label) {
      const mem = getCustomSplitsForDay(customSplits, gymSplit.type, effectiveToday.label);
      if (Array.isArray(mem) && mem.length) {
        // mem is already custom list, apply overrides again
        list = applyGymOverrides(mem, gymOverrides);
      }
    }
    return list;
  }, [baseTodayExercises, gymOverrides, customSplits, gymSplit, effectiveToday]);

  // classic plan exercises with overrides
  const classicExercises = useMemo(() => {
    const plan = GYM_PLANS[planKey];
    if (!plan) return [];
    const base = plan.exercises || [];
    return applyGymOverrides(base, gymOverrides);
  }, [planKey, gymOverrides]);

  const customExercisesFiltered = useMemo(() => {
    return applyGymOverrides(customExercises, gymOverrides);
  }, [customExercises, gymOverrides]);

  // FIX-GYM last-session prefill: prefill empty entries with last values
  useEffect(() => {
    if (!todayExercises.length && !classicExercises.length) return;
    const allNames = [...todayExercises, ...classicExercises, ...customExercisesFiltered].map(e=>e.name);
    if (!allNames.length) return;
    // only prefill if entries empty for those names
    setEntries(prev => {
      let changed = false;
      const next = { ...prev };
      for (const name of allNames) {
        const existing = next[name];
        const last = lastSessionMap[name];
        if (!existing && last) {
          next[name] = { sets: String(last.sets || ''), reps: String(last.reps || ''), weight: String(last.weight || '') };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [todayExercises, classicExercises, customExercisesFiltered, lastSessionMap]);

  // FIX-F1: gym XP farm guard — once per day via xpOnce, logging independent of XP
  const finishWorkout = async () => {
    if (saving) return;
    setSaving(true);
    let alreadyEarned = false;
    try {
      const allExNames = Object.keys(entries).concat(Object.keys(doneMap).filter(k=>doneMap[k]));
      const uniqueNames = [...new Set(allExNames)];
      const exercises = uniqueNames
        .map(name => {
          const v = entries[name] || {};
          const isDone = Boolean(doneMap[name]);
          const hasLog = v.sets || v.reps || v.weight;
          if (!hasLog && !isDone) return null;
          // if done but no weight, still log with last or target
          const last = lastSessionMap[name];
          const target = [...todayExercises, ...classicExercises, ...customExercisesFiltered].find(e=>e.name===name);
          return {
            name,
            sets: Number(v.sets || last?.sets || target?.sets || 0) || 0,
            reps: v.reps || last?.reps || target?.reps || '—',
            weight: Number(v.weight || last?.weight || 0) || 0,
            method: isDone ? 'done' : 'weighted',
          };
        })
        .filter(Boolean);
      if (!exercises.length) {
        infoAlert('Kuch bharo 💪', 'Pehle kuch sets/reps bharo ya bodyweight done tick karo — khaali workout save nahi hota');
        return;
      }
      const dayLabel = mode === 'split' && effectiveToday ? effectiveToday.label : GYM_PLANS[planKey].name;
      // FIX-F1: check daily guard before XP, but log always
      try {
        alreadyEarned = await hasEarnedToday(profile.id, 'workout');
      } catch { alreadyEarned = false; }
      const xpToLog = alreadyEarned ? 0 : 30;
      // Log workout FIRST — independent of XP success (F7 independence pattern)
      try {
        await db.insert('workout_logs', {
          user_id: profile.id,
          date: todayStr(),
          plan_name: dayLabel,
          exercises,
          xp_earned: xpToLog,
          created_at: nowIso(),
        });
      } catch (logErr) {
        infoAlert('Workout save fail hua', logErr?.message || 'Workout log nahi ho paya — dobara try karo');
        return;
      }
      if (!alreadyEarned) {
        try {
          const xpRes = await awardXP('WORKOUT');
          if (xpRes) {
            setConfetti(Date.now());
            await markEarnedToday(profile.id, 'workout');
          }
        } catch (xpErr) {
          console.warn('[F1] workout XP failed', xpErr?.message);
        }
      } else {
        infoAlert('Aaj ka gym XP le liya 💪', 'Workout logged, 0 XP — daily cap reached. Kal phir +30 milega!');
      }
      setEntries({});
      setDoneMap({});
      await load();
    } catch (e) {
      infoAlert('Workout save fail hua', e?.message || 'Workout log nahi ho paya — dobara try karo');
    } finally {
      setSaving(false);
    }
  };

  const addCustomExercise = async () => {
    const name = newEx.trim();
    if (!name) return;
    const next = [...customExercises.filter((e) => e.name !== name), { name, sets: 3, reps: '12', group: 'Chest' }];
    try {
      await updateProfile({ custom_exercises: next });
      setCustomExercises(next);
      setNewEx('');
    } catch (e) {
      infoAlert('Exercise save fail', e?.message || 'Custom exercise save nahi ho paya');
    }
  };

  const removeCustomExercise = async (name) => {
    const next = customExercises.filter((e) => e.name !== name);
    try {
      await updateProfile({ custom_exercises: next });
      setCustomExercises(next);
    } catch (e) {
      infoAlert('Exercise remove fail', e?.message || 'Custom exercise delete nahi ho paya');
    }
  };

  const saveGymSplit = async () => {
    try {
      const payload = {
        type: wizardType,
        restDays: wizardRestDays,
        customDays: wizardType === 'custom' ? wizardCustomDays : undefined,
        mode: 'split',
      };
      await updateProfile({ gym_split: payload });
      setWizardOpen(false);
      setWizardStep(1);
      infoAlert('Split saved ✅', `${GYM_SPLITS[wizardType]?.label || wizardType} + rest ${wizardRestDays.map(d=>WEEKDAYS[d]).join(', ') || 'none'} — Monday se rotation shuru!`);
    } catch (e) {
      infoAlert('Split save fail', e?.message || 'Gym split save nahi ho paya');
    }
  };

  // FIX-GYM edit/remove ALL
  const openEdit = (ex) => {
    setEditTarget(ex);
    setEditForm({ name: ex.name, sets: String(ex.sets || ''), reps: String(ex.reps || ''), group: ex.group || 'Chest' });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const origName = editTarget?.originalName || editTarget?.name;
    if (!origName) return;
    const newName = editForm.name.trim();
    if (!newName) { infoAlert('Name empty', 'Exercise name khaali nahi ho sakta'); return; }
    const isCustom = customExercises.some(e=>e.name===origName);
    try {
      if (isCustom) {
        const next = customExercises.map(e=> e.name===origName ? { ...e, name: newName, sets: Number(editForm.sets)||e.sets, reps: editForm.reps||e.reps, group: editForm.group||e.group } : e);
        await updateProfile({ custom_exercises: next });
        setCustomExercises(next);
      } else {
        // built-in → gym_overrides
        const nextOverrides = { ...gymOverrides, [origName]: { name: newName, sets: Number(editForm.sets)||undefined, reps: editForm.reps||undefined, group: editForm.group||undefined } };
        // if name changed, keep original key but override name
        await updateProfile({ gym_overrides: nextOverrides });
        setGymOverrides(nextOverrides);
        // if editing day-memory, update customSplits for current day only
        if (gymSplit && effectiveToday?.label && customSplits[gymSplit.type]?.[effectiveToday.label]) {
          const dayList = customSplits[gymSplit.type][effectiveToday.label];
          const updatedDay = dayList.map(e=> (e.name===origName || e.originalName===origName) ? { ...e, name: newName, sets: Number(editForm.sets)||e.sets, reps: editForm.reps||e.reps, group: editForm.group||e.group } : e);
          const nextSplits = { ...customSplits, [gymSplit.type]: { ...(customSplits[gymSplit.type]||{}), [effectiveToday.label]: updatedDay } };
          await updateProfile({ custom_splits: nextSplits });
          setCustomSplits(nextSplits);
        }
      }
      setEditOpen(false);
    } catch (e) {
      infoAlert('Edit fail', e?.message || 'Edit save nahi ho paya');
    }
  };

  const removeEdit = async () => {
    const origName = editTarget?.originalName || editTarget?.name;
    if (!origName) return;
    const isCustom = customExercises.some(e=>e.name===origName);
    try {
      if (isCustom) {
        const next = customExercises.filter(e=>e.name!==origName);
        await updateProfile({ custom_exercises: next });
        setCustomExercises(next);
      } else {
        const nextOverrides = { ...gymOverrides, [origName]: { ...(gymOverrides[origName]||{}), isRemoved: true } };
        await updateProfile({ gym_overrides: nextOverrides });
        setGymOverrides(nextOverrides);
        if (gymSplit && effectiveToday?.label && customSplits[gymSplit.type]?.[effectiveToday.label]) {
          const dayList = customSplits[gymSplit.type][effectiveToday.label];
          const updatedDay = dayList.filter(e=> e.name!==origName && e.originalName!==origName);
          const nextSplits = { ...customSplits, [gymSplit.type]: { ...(customSplits[gymSplit.type]||{}), [effectiveToday.label]: updatedDay } };
          await updateProfile({ custom_splits: nextSplits });
          setCustomSplits(nextSplits);
        }
      }
      setEditOpen(false);
    } catch (e) {
      infoAlert('Remove fail', e?.message || 'Delete nahi ho paya');
    }
  };

  // FIX-GYM CSV import
  const handleParseCSV = () => {
    const parsed = parseCSV(csvText);
    setCsvPreview(parsed);
  };

  const handleConfirmCSV = async () => {
    if (!csvPreview || !csvPreview.rows?.length) { infoAlert('CSV empty', 'Pehle valid CSV parse karo'); return; }
    try {
      // add to custom_exercises
      const existingNames = new Set(customExercises.map(e=>e.name));
      const toAdd = csvPreview.rows.filter(r=>!existingNames.has(r.name));
      const next = [...customExercises, ...toAdd];
      await updateProfile({ custom_exercises: next });
      setCustomExercises(next);
      // also save file via expo-file-system for record
      try {
        const path = FileSystem.documentDirectory + 'gym_import_last.csv';
        await FileSystem.writeAsStringAsync(path, csvText, { encoding: FileSystem.EncodingType.UTF8 });
      } catch {}
      setCsvOpen(false);
      setCsvText('');
      setCsvPreview(null);
      infoAlert('CSV imported ✅', `${toAdd.length} exercises added`);
    } catch (e) {
      infoAlert('CSV import fail', e?.message || 'CSV save nahi ho paya');
    }
  };

  const handleLoadCSVFile = async () => {
    try {
      const path = FileSystem.documentDirectory + 'gym_import.csv';
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) { infoAlert('File nahi mila', `Place CSV at ${path} or paste content`); return; }
      const content = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 });
      setCsvText(content);
      const parsed = parseCSV(content);
      setCsvPreview(parsed);
    } catch (e) {
      infoAlert('File read fail', e?.message || 'File read nahi ho paya');
    }
  };

  // FIX-GYM custom split day-memory edit
  const openDayEdit = () => {
    if (!effectiveToday?.label) return;
    setDayEditList(todayExercises.length ? todayExercises : baseTodayExercises);
    setDayEditOpen(true);
  };

  const saveDayEdit = async () => {
    if (!gymSplit?.type || !effectiveToday?.label) return;
    try {
      const nextSplits = { ...customSplits, [gymSplit.type]: { ...(customSplits[gymSplit.type]||{}), [effectiveToday.label]: dayEditList } };
      await updateProfile({ custom_splits: nextSplits });
      setCustomSplits(nextSplits);
      setDayEditOpen(false);
      infoAlert('Day saved ✅', `${effectiveToday.label} ke exercises sirf is day ke liye save hue`);
    } catch (e) {
      infoAlert('Day save fail', e?.message || 'Day save nahi ho paya');
    }
  };

  const addDayExercise = () => {
    const name = dayEditNew.name.trim();
    if (!name) return;
    setDayEditList(prev=> [...prev, { name, sets: Number(dayEditNew.sets)||3, reps: dayEditNew.reps||'12', group: dayEditNew.group }]);
    setDayEditNew({ name: '', sets: '3', reps: '12', group: 'Chest' });
  };

  const removeDayExercise = (name) => {
    setDayEditList(prev=> prev.filter(e=>e.name!==name));
  };

  const prs = useMemo(() => {
    const map = {};
    for (const log of logs || []) {
      for (const ex of log.exercises || []) {
        if ((ex.weight || 0) > (map[ex.name]?.weight || 0)) {
          map[ex.name] = { weight: ex.weight, reps: ex.reps, date: log.date };
        }
      }
    }
    return Object.entries(map).sort((a, b) => b[1].weight - a[1].weight).slice(0, 6);
  }, [logs]);

  const week = useMemo(() => {
    const mon = mondayOf(todayStr());
    return Array.from({ length: 7 }, (_, i) => {
      const d = dateStr(mon.add(i, 'day'));
      return { date: d, count: (logs || []).filter((l) => l.date === d).length };
    });
  }, [logs]);
  const thisWeek = week.reduce((a, d) => a + d.count, 0);

  const plan = GYM_PLANS[planKey];

  if (!logs) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Gym Tracker" onBack={onBack} />
      </Screen>
    );
  }

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '25%' }} />
      <ScreenHeader title="Gym / Workout" subtitle="Body bhi ek quest hai 💪 (+30 XP per workout)" onBack={onBack} />

      <Card mode="light" style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B', flex: 1 }}>
            This week: {thisWeek} workout{thisWeek === 1 ? '' : 's'}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B' }}>
            {thisWeek >= 3 ? 'Beast mode 🔥' : thisWeek >= 1 ? 'Chalo shuru hua 👍' : 'Aaj se shuru karo!'}
          </Text>
        </View>
        {(() => {
          const weekly = getWeeklyGymSplit(logs || []);
          const userSplit = normalizeGymSplit(profile?.gym_split);
          const badge = gymSplitBadgeText(userSplit, weekly);
          return (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#B91C1C', marginRight: 8 }}>Split: {gymSplit ? `${GYM_SPLITS[gymSplit.type]?.label || gymSplit.type} ${gymSplit.restDays?.length ? `· Rest ${gymSplit.restDays.map(d=>WEEKDAYS[d]).join(',')}` : ''}` : badge}</Text>
              {weekly.total ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#7F1D1D' }}>
                  {weekly.breakdown.push ? `Push ${weekly.breakdown.push} · ` : ''}{weekly.breakdown.pull ? `Pull ${weekly.breakdown.pull} · ` : ''}{weekly.breakdown.legs ? `Legs ${weekly.breakdown.legs} · ` : ''}{weekly.breakdown.core ? `Core ${weekly.breakdown.core} · ` : ''}{weekly.breakdown.cardio ? `Cardio ${weekly.breakdown.cardio}` : ''}
                </Text>
              ) : (
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#7F1D1D' }}>No exercises logged yet this week — set up your split!</Text>
              )}
            </View>
          );
        })()}
        <View style={{ flexDirection: 'row' }}>
          {week.map((d) => (
            <View key={d.date} style={{ flex: 1, alignItems: 'center' }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: d.count ? '#EF4444' : '#F1F5F9',
                  borderWidth: 1,
                  borderColor: d.count ? '#EF4444' : '#E2E8F0',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {d.count ? <Ionicons name="checkmark" size={16} color="#FFF" /> : null}
              </View>
              <Text style={{ fontFamily: fonts.body, fontSize: 9.5, color: '#94A3B8', marginTop: 5 }}>
                {dayjs(d.date).format('dd')}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Chip label="🏋️ Split Mode" selected={mode==='split'} onPress={() => setMode('split')} mode="light" />
        <Chip label="📋 Classic Plans" selected={mode==='classic'} onPress={() => setMode('classic')} mode="light" />
        <Pressable onPress={() => { setWizardOpen(true); setWizardStep(1); }} style={{ marginLeft: 8, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7 }}>
          <Ionicons name="settings-outline" size={16} color="#6D28D9" />
        </Pressable>
        <Pressable onPress={() => setCsvOpen(true)} style={{ marginLeft: 8, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#1D4ED8' }}>Import CSV</Text>
        </Pressable>
      </View>

      {mode === 'split' && gymSplit ? (
        <>
          <SectionTitle mode="light">Today — {effectiveToday?.label || 'Workout'}</SectionTitle>
          {effectiveToday?.isRest && !isTodayOverridden ? (
            <Card mode="light" style={{ marginBottom: 14, backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#166534', textAlign: 'center' }}>Rest & recover 💤</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#15803D', textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
                Aaj rest day hai — muscles recover kar rahe hain. Kal {(() => {
                  const tomorrow = dateStr(dayjs(today).add(1,'day'));
                  const tmr = todayWorkout(gymSplit, tomorrow);
                  return tmr.label;
                })()} ayega.
              </Text>
              <Button title="Train anyway (one-day override) 💪" size="sm" mode="light" onPress={async () => {
                const next = { ...overrideMap, [today]: true };
                await saveOverrideMap(next);
              }} style={{ marginTop: 12 }} />
              <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 8, textAlign: 'center' }}>
                Skipped gym day = gone (logged); next real day shows its own type — pure week rotation, Monday always day-type 1.
              </Text>
            </Card>
          ) : (
            <>
              <Card mode="light" style={{ marginBottom: 10, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#B91C1C' }}>{effectiveToday?.label}{effectiveToday?.isOverride ? ' (override)' : ''}</Text>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#7F1D1D', marginTop: 4 }}>
                      Groups: {(effectiveToday?.groups || []).join(', ') || 'Full Body'} · {todayExercises.length} exercises {customSplits[gymSplit.type]?.[effectiveToday.label] ? '· custom day memory' : '· auto-filled'}
                    </Text>
                  </View>
                  <Pressable onPress={openDayEdit} style={{ backgroundColor: '#FFF', borderWidth: 1, borderColor: '#FECACA', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#B91C1C' }}>Edit Day</Text>
                  </Pressable>
                </View>
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 4 }}>
                  Week rotation: Mon is always {(() => {
                    const def = getSplitDefinition(gymSplit.type);
                    return def?.dayTypes?.[0]?.label || 'Day 1';
                  })()} — fresh every week, rest days skipped. Day edits persist per weekday via custom_splits.
                </Text>
              </Card>
              <Card mode="light" style={{ marginBottom: 14, padded: false }} padded={false}>
                {/* FIX-F2: split mode list header — same as Classic */}
                {!narrow ? (
                  <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 }}>
                    <Text style={[styles.colHead, { flex: 1.8 }]}>Exercise</Text>
                    <Text style={[styles.colHead, { flex: 0.6 }]}>Sets</Text>
                    <Text style={[styles.colHead, { flex: 0.6 }]}>Reps</Text>
                    <Text style={[styles.colHead, { flex: 0.6 }]}>Wt(kg)</Text>
                    <Text style={[styles.colHead, { flex: 0.5 }]}>Done</Text>
                  </View>
                ) : null}
                {todayExercises.map((ex) => (
                  <ExerciseRow
                    key={ex.name}
                    ex={ex}
                    entry={entries[ex.name] || {}}
                    last={lastSessionMap[ex.name]}
                    narrow={narrow}
                    onSet={(patch) => setEntry(ex.name, patch)}
                    done={Boolean(doneMap[ex.name])}
                    onToggleDone={() => setDoneMap(prev=> ({ ...prev, [ex.name]: !prev[ex.name] }))}
                    onEdit={() => openEdit(ex)}
                  />
                ))}
                {!todayExercises.length ? (
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#94A3B8', padding: 12, textAlign: 'center' }}>
                    No exercises for groups {(effectiveToday?.groups || []).join(', ')} — add custom exercises or change split
                  </Text>
                ) : null}
              </Card>
            </>
          )}
        </>
      ) : null}

      {mode === 'classic' || !gymSplit ? (
        <>
          <SectionTitle mode="light">Pick a plan (Classic)</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {Object.entries(GYM_PLANS).map(([key, p]) => (
              <Chip key={key} label={p.name} selected={planKey === key} onPress={() => setPlanKey(key)} mode="light" />
            ))}
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 14 }}>
            {plan.hint} — sets/reps/weight edit karke apna log banao.
          </Text>
          <Card mode="light" style={{ marginBottom: 14, padded: false }} padded={false}>
            {!narrow ? (
              <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 }}>
                <Text style={[styles.colHead, { flex: 1.8 }]}>Exercise</Text>
                <Text style={[styles.colHead, { flex: 0.6 }]}>Sets</Text>
                <Text style={[styles.colHead, { flex: 0.6 }]}>Reps</Text>
                <Text style={[styles.colHead, { flex: 0.6 }]}>Wt(kg)</Text>
                <Text style={[styles.colHead, { flex: 0.5 }]}>Done</Text>
              </View>
            ) : null}
            {classicExercises.map((ex) => (
              <ExerciseRow
                key={ex.name}
                ex={ex}
                entry={entries[ex.name] || {}}
                last={lastSessionMap[ex.name]}
                narrow={narrow}
                onSet={(patch) => setEntry(ex.name, patch)}
                done={Boolean(doneMap[ex.name])}
                onToggleDone={() => setDoneMap(prev=> ({ ...prev, [ex.name]: !prev[ex.name] }))}
                onEdit={() => openEdit(ex)}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle mode="light">➕ My exercises</SectionTitle>
      <Card mode="light" style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={newEx}
            onChangeText={setNewEx}
            placeholder="Exercise name (e.g. Bicep Curls)"
            placeholderTextColor="#94A3B8"
            onSubmitEditing={addCustomExercise}
            style={{
              flex: 1,
              fontFamily: fonts.body,
              fontSize: 13,
              color: '#1E293B',
              backgroundColor: '#F8FAFC',
              borderWidth: 1,
              borderColor: '#E2E8F0',
              borderRadius: radius.md,
              paddingHorizontal: 10,
              paddingVertical: 8,
            }}
          />
          <Button title="Add" size="sm" mode="light" onPress={addCustomExercise} disabled={!newEx.trim()} style={{ marginLeft: 8 }} />
        </View>
        {customExercisesFiltered.length ? (
          <View style={{ marginTop: 10 }}>
            {customExercisesFiltered.map((ex) => (
              <ExerciseRow
                key={ex.name}
                ex={ex}
                entry={entries[ex.name] || {}}
                last={lastSessionMap[ex.name]}
                narrow={narrow}
                onSet={(patch) => setEntry(ex.name, patch)}
                done={Boolean(doneMap[ex.name])}
                onToggleDone={() => setDoneMap(prev=> ({ ...prev, [ex.name]: !prev[ex.name] }))}
                onEdit={() => openEdit(ex)}
                removable
                onRemove={() => removeCustomExercise(ex.name)}
              />
            ))}
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', marginTop: 10 }}>
            Apne exercises add karo — sets/reps/weight waise hi log hote hain jaise plans mein. Long-press or edit icon se edit/remove.
          </Text>
        )}
      </Card>
      <Button title={`Finish Workout (${mode==='split' && effectiveToday ? effectiveToday.label : plan.name} +30 XP) 💪`} mode="light" size="lg" onPress={finishWorkout} loading={saving} style={{ marginBottom: 18 }} />

      {prs.length ? (
        <>
          <SectionTitle mode="light">🏅 Personal records</SectionTitle>
          {prs.map(([name, pr]) => (
            <Card key={name} mode="light" style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 18, marginRight: 10 }}>🏅</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#1E293B' }}>
                    {name}
                  </Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    {pr.weight} kg × {pr.reps} · {fmtDate(pr.date)}
                  </Text>
                </View>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle mode="light">Recent workouts</SectionTitle>
      {logs.length ? (
        logs.slice(0, 8).map((log) => (
          <Card key={log.id} mode="light" style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 20, marginRight: 10 }}>🏋️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#1E293B' }}>{log.plan_name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                  {fmtDate(log.date)} · {(log.exercises || []).map((e) => `${e.name}${e.method==='done' ? '✓' : ''}`).slice(0, 3).join(', ')}
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#EF4444' }}>+{log.xp_earned} XP</Text>
            </View>
          </Card>
        ))
      ) : (
        <EmptyState
          icon="🏋️"
          title="No workouts yet"
          subtitle="Pehla workout log karo — +30 XP aur full-body mood boost."
          mode="light"
        />
      )}

      {/* Setup wizard */}
      <ModalSheet visible={wizardOpen} onClose={() => setWizardOpen(false)} title={wizardStep===1 ? 'Gym Split — Step 1: Pick split' : wizardStep===2 ? 'Step 2: Rest days' : 'Step 3: Save'} mode="light">
        {wizardStep === 1 ? (
          <>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#475569', marginBottom: 12, lineHeight: 18 }}>
              Kaunsa split follow karte ho? Ye har din ke exercises auto-change karega — roz same list nahi.
            </Text>
            {Object.entries(GYM_SPLITS).map(([key, s]) => (
              <Pressable key={key} onPress={() => setWizardType(key)} style={{ backgroundColor: wizardType===key ? '#FEF2F2' : '#F8FAFC', borderWidth: 1.5, borderColor: wizardType===key ? '#FCA5A5' : '#E2E8F0', borderRadius: 12, padding: 12, marginBottom: 8 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#1E293B' }}>{s.label}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: 2 }}>{s.hint}</Text>
                {s.dayTypes?.length ? (
                  <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 4 }}>
                    {s.dayTypes.map(d=>`${d.label} (${d.groups.join(',')})`).join(' → ')}
                  </Text>
                ) : null}
              </Pressable>
            ))}
            <Button title="Next — Rest days →" mode="light" onPress={() => setWizardStep(2)} style={{ marginTop: 8 }} />
          </>
        ) : null}
        {wizardStep === 2 ? (
          <>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#475569', marginBottom: 12, lineHeight: 18 }}>
              Rest weekdays chuno (Mon-first, multiple allowed). Split ka rotation NON-rest days pe Mon-start fresh har week.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
              {WEEKDAYS.map((d,i) => (
                <Chip key={d} label={d} selected={wizardRestDays.includes(i)} onPress={() => {
                  setWizardRestDays(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev, i]);
                }} mode="light" />
              ))}
            </View>
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginBottom: 12 }}>
              Example: PPL + Sunday rest → Mon Push, Tue Pull, Wed Legs, Thu Push, Fri Pull, Sat Legs, Sun Rest. Next Mon Push again.
            </Text>
            {wizardType === 'custom' ? (
              <>
                <SectionTitle mode="light">Custom days builder</SectionTitle>
                {wizardCustomDays.map((cd, idx) => (
                  <View key={idx} style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B', flex: 1 }}>{cd.name}: {cd.groups.join(', ')}</Text>
                      <Pressable onPress={() => {
                        setCustomDayForm({ name: cd.name, groups: cd.groups });
                        setCustomDayEdit(idx);
                      }} style={{ padding: 4 }}><Ionicons name="create-outline" size={16} color="#6D28D9" /></Pressable>
                      <Pressable onPress={() => setWizardCustomDays(prev => prev.filter((_,j)=>j!==idx))} style={{ padding: 4, marginLeft: 4 }}><Ionicons name="trash-outline" size={16} color="#DC2626" /></Pressable>
                    </View>
                  </View>
                ))}
                <Button title="+ Add custom day" size="sm" mode="light" variant="secondary" onPress={() => {
                  setCustomDayForm({ name: `Day ${wizardCustomDays.length+1}`, groups: ['Chest'] });
                  setCustomDayEdit(-1);
                }} style={{ marginBottom: 10 }} />
                {customDayEdit !== null ? (
                  <Card mode="light" style={{ marginBottom: 10, backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
                    <Input label="Day name" value={customDayForm.name} onChangeText={(v)=> setCustomDayForm({...customDayForm, name: v})} placeholder="e.g. Push Day" />
                    <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#92400E', marginBottom: 6 }}>Muscle groups (1–3)</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {MUSCLE_GROUPS.map((g) => (
                        <Chip key={g} label={g} small selected={customDayForm.groups.includes(g)} onPress={() => {
                          setCustomDayForm(prev => {
                            if (prev.groups.includes(g)) return { ...prev, groups: prev.groups.filter(x=>x!==g) };
                            if (prev.groups.length >=3) return prev;
                            return { ...prev, groups: [...prev.groups, g] };
                          });
                        }} mode="light" />
                      ))}
                    </View>
                    <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 6 }}>
                      Exercises auto-filled from library per group — editable once after save via day memory
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: 10 }}>
                      <Button title="Save day" size="sm" mode="light" onPress={() => {
                        if (!customDayForm.name.trim() || !customDayForm.groups.length) return;
                        if (customDayEdit === -1) {
                          setWizardCustomDays(prev => [...prev, { name: customDayForm.name.trim(), groups: customDayForm.groups }]);
                        } else {
                          setWizardCustomDays(prev => prev.map((d,i)=> i===customDayEdit ? { name: customDayForm.name.trim(), groups: customDayForm.groups } : d));
                        }
                        setCustomDayEdit(null);
                      }} style={{ flex: 1, marginRight: 8 }} />
                      <Button title="Cancel" size="sm" variant="secondary" mode="light" onPress={() => setCustomDayEdit(null)} style={{ flex: 0.5 }} />
                    </View>
                  </Card>
                ) : null}
              </>
            ) : null}
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <Button title="← Back" size="sm" variant="secondary" mode="light" onPress={() => setWizardStep(1)} style={{ flex: 0.5, marginRight: 8 }} />
              <Button title="Save split →" size="sm" mode="light" onPress={saveGymSplit} style={{ flex: 1 }} />
            </View>
          </>
        ) : null}
      </ModalSheet>

      {/* FIX-GYM edit modal */}
      <ModalSheet visible={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${editTarget?.name || 'Exercise'}`} mode="light">
        <Input label="Name" value={editForm.name} onChangeText={(v)=> setEditForm({...editForm, name: v})} placeholder="Exercise name" />
        <Input label="Sets" value={editForm.sets} onChangeText={(v)=> setEditForm({...editForm, sets: v})} placeholder="3" keyboardType="numeric" />
        <Input label="Reps" value={editForm.reps} onChangeText={(v)=> setEditForm({...editForm, reps: v})} placeholder="12 or 12 each leg" />
        <Input label="Group" value={editForm.group} onChangeText={(v)=> setEditForm({...editForm, group: v})} placeholder="Chest, Back, etc" />
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginBottom: 12 }}>Built-in edits persist as gym_overrides jsonb — constants never mutated at runtime. Editing a day edits only that day via custom_splits.</Text>
        <View style={{ flexDirection: 'row' }}>
          <Button title="Save" mode="light" onPress={saveEdit} style={{ flex: 1, marginRight: 8 }} />
          <Button title="Remove" variant="secondary" mode="light" onPress={removeEdit} style={{ flex: 1 }} />
        </View>
        <Button title="Cancel" variant="ghost" mode="light" onPress={() => setEditOpen(false)} style={{ marginTop: 8 }} />
      </ModalSheet>

      {/* FIX-GYM CSV import */}
      <ModalSheet visible={csvOpen} onClose={() => setCsvOpen(false)} title="Import CSV — name,sets,reps,group" mode="light">
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#475569', marginBottom: 8, lineHeight: 18 }}>
          Paste CSV with header name,sets,reps,group. Example:{"\n"}name,sets,reps,group{"\n"}Bench Press,4,8-10,Chest{"\n"}Squat,4,8-10,Quads
        </Text>
        <TextInput
          value={csvText}
          onChangeText={setCsvText}
          multiline
          numberOfLines={6}
          placeholder="name,sets,reps,group&#10;Bench Press,4,8-10,Chest"
          placeholderTextColor="#94A3B8"
          style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 10, fontFamily: fonts.body, fontSize: 12, color: '#1E293B', minHeight: 120, textAlignVertical: 'top', marginBottom: 10 }}
        />
        <View style={{ flexDirection: 'row', marginBottom: 10 }}>
          <Button title="Parse" size="sm" mode="light" onPress={handleParseCSV} style={{ flex: 1, marginRight: 8 }} />
          <Button title="Load file" size="sm" variant="secondary" mode="light" onPress={handleLoadCSVFile} style={{ flex: 1 }} />
        </View>
        {csvPreview ? (
          <Card mode="light" style={{ marginBottom: 10, backgroundColor: csvPreview.error ? '#FEF2F2' : '#F0FDF4', borderColor: csvPreview.error ? '#FECACA' : '#BBF7D0' }}>
            {csvPreview.error ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#B91C1C', marginBottom: 6 }}>Error: {csvPreview.error}</Text> : <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#166534', marginBottom: 6 }}>{csvPreview.rows.length} rows parsed ✅</Text>}
            {csvPreview.rows.slice(0,5).map((r,i)=> (
              <Text key={i} style={{ fontFamily: fonts.body, fontSize: 11, color: '#334155' }}>{r.name} — {r.sets}×{r.reps} · {r.group}</Text>
            ))}
            {csvPreview.rows.length>5 ? <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#94A3B8', marginTop: 4 }}>+{csvPreview.rows.length-5} more</Text> : null}
          </Card>
        ) : null}
        <Button title="Confirm Import" mode="light" disabled={!csvPreview?.rows?.length} onPress={handleConfirmCSV} style={{ marginBottom: 8 }} />
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8' }}>Uses expo-file-system only, no new deps. File saved to documentDirectory/gym_import_last.csv via FileSystem.writeAsStringAsync.</Text>
      </ModalSheet>

      {/* FIX-GYM day-memory edit */}
      <ModalSheet visible={dayEditOpen} onClose={() => setDayEditOpen(false)} title={`Edit ${effectiveToday?.label || 'Day'} — day memory`} mode="light">
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#475569', marginBottom: 10, lineHeight: 18 }}>
          Each split day remembers its own exercise list, persisted via custom_splits jsonb, restored on right weekday. Editing this day edits only this day.
        </Text>
        {dayEditList.map((ex, idx)=> (
          <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 8, marginBottom: 6 }}>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: '#1E293B' }}>{ex.name} {ex.sets}×{ex.reps} {ex.group ? `· ${ex.group}` : ''}</Text>
            <Pressable onPress={()=> removeDayExercise(ex.name)} style={{ padding: 4 }}><Ionicons name="trash-outline" size={14} color="#DC2626" /></Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 8 }}>
          <TextInput value={dayEditNew.name} onChangeText={(v)=> setDayEditNew({...dayEditNew, name: v})} placeholder="Name" placeholderTextColor="#94A3B8" style={{ flex: 1, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontFamily: fonts.body, fontSize: 12, color: '#1E293B' }} />
          <TextInput value={dayEditNew.sets} onChangeText={(v)=> setDayEditNew({...dayEditNew, sets: v})} placeholder="Sets" keyboardType="numeric" style={{ width: 50, marginLeft: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 6, fontFamily: fonts.body, fontSize: 12, color: '#1E293B', textAlign: 'center' }} />
          <TextInput value={dayEditNew.reps} onChangeText={(v)=> setDayEditNew({...dayEditNew, reps: v})} placeholder="Reps" style={{ width: 70, marginLeft: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 6, fontFamily: fonts.body, fontSize: 12, color: '#1E293B', textAlign: 'center' }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <TextInput value={dayEditNew.group} onChangeText={(v)=> setDayEditNew({...dayEditNew, group: v})} placeholder="Group" style={{ flex: 1, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontFamily: fonts.body, fontSize: 12, color: '#1E293B' }} />
          <Button title="+ Add" size="sm" mode="light" onPress={addDayExercise} style={{ marginLeft: 8 }} />
        </View>
        <Button title="Save Day (only this weekday)" mode="light" onPress={saveDayEdit} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  colHead: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#64748B' },
};

function MiniInput({ value, onChangeText, placeholder, flex, keyboardType }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#CBD5E1"
      keyboardType={keyboardType || 'default'}
      style={{
        flex: flex === undefined ? 0.8 : flex,
        minWidth: 56,
        minHeight: 36,
        marginLeft: 4,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 7,
        fontFamily: fonts.body,
        fontSize: 12.5,
        color: '#1E293B',
        textAlign: 'center',
      }}
    />
  );
}

function ExerciseRow({ ex, entry, last, narrow, onSet, removable, onRemove, done, onToggleDone, onEdit }) {
  const lastLine = last ? `Last: ${last.sets||'—'}×${last.reps||'—'} @ ${last.weight||0}kg · ${formatLastRelative(last.date)}` : null;
  if (!narrow) {
    return (
      <Pressable onLongPress={onEdit} style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: '#F1F5F9',
        }}>
        <View style={{ flex: 1.6, marginRight: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', flexShrink: 1 }}>
              {ex.name}{ex._isOverridden ? ' ✎' : ''}
            </Text>
            {removable ? (
              <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 2, marginLeft: 4 }}>
                <Ionicons name="close-circle" size={16} color="#DC2626" />
              </Pressable>
            ) : null}
            <Pressable onPress={onEdit} hitSlop={8} style={{ padding: 2, marginLeft: 4 }}>
              <Ionicons name="create-outline" size={14} color="#6D28D9" />
            </Pressable>
          </View>
          <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8' }}>
            target {ex.sets}×{ex.reps} {ex.group ? `· ${ex.group}` : ''}
          </Text>
          {lastLine ? <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 10, color: '#0EA5E9', marginTop: 1 }}>{lastLine}</Text> : null}
        </View>
        <MiniInput keyboardType="numeric" value={entry.sets ?? String(ex.sets)} onChangeText={(v) => onSet({ sets: v })} placeholder={String(ex.sets)} flex={0.6} />
        <MiniInput keyboardType="default" value={entry.reps ?? String(ex.reps)} onChangeText={(v) => onSet({ reps: v })} placeholder={String(ex.reps)} flex={1.1} />
        <MiniInput keyboardType="numeric" value={entry.weight ?? ''} onChangeText={(v) => onSet({ weight: v })} placeholder="0" flex={0.7} />
        <Pressable onPress={onToggleDone} style={{ marginLeft: 6, width: 28, height: 28, borderRadius: 8, backgroundColor: done ? '#DCFCE7' : '#F1F5F9', borderWidth: 1, borderColor: done ? '#86EFAC' : '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={done ? 'checkmark' : 'ellipse-outline'} size={16} color={done ? '#16A34A' : '#94A3B8'} />
        </Pressable>
      </Pressable>
    );
  }
  return (
    <Pressable onLongPress={onEdit} style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', flexShrink: 1, flex: 1 }}>
          {ex.name}{ex._isOverridden ? ' ✎' : ''}
        </Text>
        {removable ? (
          <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 2, marginLeft: 4 }}>
            <Ionicons name="close-circle" size={16} color="#DC2626" />
          </Pressable>
        ) : null}
        <Pressable onPress={onEdit} hitSlop={8} style={{ padding: 2, marginLeft: 6 }}>
          <Ionicons name="create-outline" size={16} color="#6D28D9" />
        </Pressable>
        <Pressable onPress={onToggleDone} style={{ marginLeft: 8, width: 28, height: 28, borderRadius: 8, backgroundColor: done ? '#DCFCE7' : '#F1F5F9', borderWidth: 1, borderColor: done ? '#86EFAC' : '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={done ? 'checkmark' : 'ellipse-outline'} size={16} color={done ? '#16A34A' : '#94A3B8'} />
        </Pressable>
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 1, marginBottom: 2 }}>
        target {ex.sets}×{ex.reps} {ex.group ? `· ${ex.group}` : ''}
      </Text>
      {lastLine ? <Text style={{ fontFamily: fonts.body, fontSize: 10, color: '#0EA5E9', marginBottom: 8 }}>{lastLine}</Text> : <View style={{ height: 8 }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#64748B', width: 38 }}>Sets</Text>
        <MiniInput keyboardType="numeric" flex={1} value={entry.sets ?? String(ex.sets)} onChangeText={(v) => onSet({ sets: v })} placeholder={String(ex.sets)} />
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#64748B', width: 34, marginLeft: 8 }}>Reps</Text>
        <MiniInput keyboardType="default" flex={1.2} value={entry.reps ?? String(ex.reps)} onChangeText={(v) => onSet({ reps: v })} placeholder={String(ex.reps)} />
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#64748B', width: 34, marginLeft: 8 }}>Wt</Text>
        <MiniInput keyboardType="numeric" flex={1} value={entry.weight ?? ''} onChangeText={(v) => onSet({ weight: v })} placeholder="0" />
      </View>
    </Pressable>
  );
}
