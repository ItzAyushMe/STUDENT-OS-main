
// GYM / WORKOUT TRACKER — FIX-C: full split system + classic toggle
// Prebuilt plans + PPL/Arnold/UpperLower/FullBody/Custom splits with
// week-based rotation, rest-day picker, exercise library auto-fill.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const [wizardRestDays, setWizardRestDays] = useState([6]); // default Sunday rest
  const [wizardCustomDays, setWizardCustomDays] = useState([
    { name: 'Day 1', groups: ['Chest','Triceps'] },
    { name: 'Day 2', groups: ['Back','Biceps'] },
    { name: 'Day 3', groups: ['Quads','Hamstrings'] },
  ]);
  const [mode, setMode] = useState('split'); // split | classic
  const [overrideMap, setOverrideMap] = useState({}); // dateStr -> true (train anyway)
  const [customDayEdit, setCustomDayEdit] = useState(null); // index being edited
  const [customDayForm, setCustomDayForm] = useState({ name: '', groups: [] });

  const gymSplit = useMemo(() => normalizeGymSplitV2(profile?.gym_split), [profile?.gym_split]);

  useEffect(() => {
    if (Array.isArray(profile?.custom_exercises)) setCustomExercises(profile.custom_exercises);
  }, [profile?.custom_exercises]);

  useEffect(() => {
    if (gymSplit) {
      setMode(gymSplit.mode || 'split');
    }
  }, [gymSplit]);

  useEffect(() => {
    // Load per-date override from AsyncStorage
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

  // Open wizard if gym_split null on first open
  useEffect(() => {
    if (profile && !profile.gym_split && logs !== null) {
      setWizardOpen(true);
      setWizardStep(1);
    }
  }, [profile?.gym_split, logs]);

  const setEntry = (name, patch) =>
    setEntries((e) => ({
      ...e,
      [name]: { sets: '', reps: '', weight: '', ...(e[name] || {}), ...patch },
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
      // Train anyway override — show full body or first day type as fallback
      const def = getSplitDefinition(gymSplit?.type);
      const fallback = def?.dayTypes?.[0] || { label: 'Full Body (override)', groups: ['Chest','Back','Quads','Abs/Core'] };
      return { ...fallback, isRest: false, isOverride: true };
    }
    return todayInfo;
  }, [todayInfo, isTodayOverridden, gymSplit]);

  const todayExercises = useMemo(() => {
    if (mode !== 'split' || !effectiveToday || effectiveToday.isRest) return [];
    const groups = effectiveToday.groups || [];
    if (!groups.length) return [];
    // auto-fill from library, gym mode default
    const libMode = gymSplit?.type === 'ppl' ? 'gym' : 'gym'; // could be configurable
    return getExercisesForGroups(groups, libMode);
  }, [effectiveToday, mode, gymSplit]);

  // FIX-F1: gym XP farm guard — once per day via xpOnce, logging independent of XP
  const finishWorkout = async () => {
    if (saving) return;
    setSaving(true);
    let alreadyEarned = false;
    let earnedToday = false;
    try {
      const exercises = Object.entries(entries)
        .filter(([, v]) => v.sets || v.reps || v.weight)
        .map(([name, v]) => ({
          name,
          sets: Number(v.sets) || 0,
          reps: v.reps || '—',
          weight: Number(v.weight) || 0,
        }));
      if (!exercises.length) {
        infoAlert('Kuch bharo 💪', 'Pehle kuch sets/reps bharo 💪 — khaali workout save nahi hota');
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
      // Then XP with guard
      if (!alreadyEarned) {
        try {
          const xpRes = await awardXP('WORKOUT');
          if (xpRes) {
            setConfetti(Date.now());
            earnedToday = true;
            await markEarnedToday(profile.id, 'workout');
          }
        } catch (xpErr) {
          console.warn('[F1] workout XP failed', xpErr?.message);
        }
      } else {
        infoAlert('Aaj ka gym XP le liya 💪', 'Workout logged, 0 XP — daily cap reached. Kal phir +30 milega!');
      }
      setEntries({});
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
    const next = [...customExercises.filter((e) => e.name !== name), { name, sets: 3, reps: '12' }];
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

      {/* weekly consistency + split badge */}
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

      {/* Mode toggle + setup */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Chip label="🏋️ Split Mode" selected={mode==='split'} onPress={() => setMode('split')} mode="light" />
        <Chip label="📋 Classic Plans" selected={mode==='classic'} onPress={() => setMode('classic')} mode="light" />
        <Pressable onPress={() => { setWizardOpen(true); setWizardStep(1); }} style={{ marginLeft: 8, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7 }}>
          <Ionicons name="settings-outline" size={16} color="#6D28D9" />
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
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#B91C1C' }}>{effectiveToday?.label}{effectiveToday?.isOverride ? ' (override)' : ''}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#7F1D1D', marginTop: 4 }}>
                  Groups: {(effectiveToday?.groups || []).join(', ') || 'Full Body'} · Auto-filled from exercise library ({todayExercises.length} exercises)
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 4 }}>
                  Week rotation: Mon is always {(() => {
                    const def = getSplitDefinition(gymSplit.type);
                    return def?.dayTypes?.[0]?.label || 'Day 1';
                  })()} — fresh every week, rest days skipped
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
                  </View>
                ) : null}
                {todayExercises.map((ex) => (
                  <ExerciseRow
                    key={ex.name}
                    ex={ex}
                    entry={entries[ex.name] || {}}
                    narrow={narrow}
                    onSet={(patch) => setEntry(ex.name, patch)}
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
              </View>
            ) : null}
            {plan.exercises.map((ex) => (
              <ExerciseRow
                key={ex.name}
                ex={ex}
                entry={entries[ex.name] || {}}
                narrow={narrow}
                onSet={(patch) => setEntry(ex.name, patch)}
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
        {customExercises.length ? (
          <View style={{ marginTop: 10 }}>
            {customExercises.map((ex) => (
              <ExerciseRow
                key={ex.name}
                ex={ex}
                entry={entries[ex.name] || {}}
                narrow={narrow}
                onSet={(patch) => setEntry(ex.name, patch)}
                removable
                onRemove={() => removeCustomExercise(ex.name)}
              />
            ))}
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', marginTop: 10 }}>
            Apne exercises add karo — sets/reps/weight waise hi log hote hain jaise plans mein.
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
                  {fmtDate(log.date)} · {(log.exercises || []).map((e) => e.name).slice(0, 3).join(', ')}
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
                      Exercises auto-filled from library per group (gym/home flags) — editable once after save
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
    </Screen>
  );
}

const styles = {
  colHead: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#64748B' },
};

function MiniInput({ value, onChangeText, placeholder, flex }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#CBD5E1"
      keyboardType="numeric"
      style={{
        flex: flex === undefined ? 0.6 : flex,
        minWidth: 44,
        minHeight: 36,
        marginLeft: 4,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 7,
        fontFamily: fonts.body,
        fontSize: 12.5,
        color: '#1E293B',
        textAlign: 'center',
      }}
    />
  );
}

function ExerciseRow({ ex, entry, narrow, onSet, removable, onRemove }) {
  if (!narrow) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: '#F1F5F9',
        }}
      >
        <View style={{ flex: 1.8, marginRight: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', flexShrink: 1 }}>
              {ex.name}
            </Text>
            {removable ? (
              <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 2, marginLeft: 4 }}>
                <Ionicons name="close-circle" size={16} color="#DC2626" />
              </Pressable>
            ) : null}
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8' }}>
            target {ex.sets}×{ex.reps} {ex.group ? `· ${ex.group}` : ''}
          </Text>
        </View>
        <MiniInput value={entry.sets ?? String(ex.sets)} onChangeText={(v) => onSet({ sets: v })} placeholder={String(ex.sets)} />
        <MiniInput value={entry.reps ?? String(ex.reps)} onChangeText={(v) => onSet({ reps: v })} placeholder={String(ex.reps)} />
        <MiniInput value={entry.weight ?? ''} onChangeText={(v) => onSet({ weight: v })} placeholder="0" />
      </View>
    );
  }
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', flexShrink: 1 }}>
          {ex.name}
        </Text>
        {removable ? (
          <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 2, marginLeft: 4 }}>
            <Ionicons name="close-circle" size={16} color="#DC2626" />
          </Pressable>
        ) : null}
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 1, marginBottom: 8 }}>
        target {ex.sets}×{ex.reps} {ex.group ? `· ${ex.group}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#64748B', width: 38 }}>Sets</Text>
        <MiniInput flex={1} value={entry.sets ?? String(ex.sets)} onChangeText={(v) => onSet({ sets: v })} placeholder={String(ex.sets)} />
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#64748B', width: 34, marginLeft: 8 }}>Reps</Text>
        <MiniInput flex={1} value={entry.reps ?? String(ex.reps)} onChangeText={(v) => onSet({ reps: v })} placeholder={String(ex.reps)} />
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#64748B', width: 34, marginLeft: 8 }}>Wt</Text>
        <MiniInput flex={1} value={entry.weight ?? ''} onChangeText={(v) => onSet({ weight: v })} placeholder="0" />
      </View>
    </View>
  );
}
