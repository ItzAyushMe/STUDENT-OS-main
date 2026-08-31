// GYM / WORKOUT TRACKER — prebuilt plans (Home/Beginner/Intermediate/
// Advanced), per-exercise logging (sets/reps/weight), personal
// records, weekly consistency, +30 XP per workout.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Confetti } from '../../components/gamer/Confetti';
import { EmptyState, SectionTitle } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { GYM_PLANS } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { todayStr, dateStr, dayjs, mondayOf, nowIso, fmtDate } from '../../lib/utils';

export function GymScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const { width } = useWindowDimensions();
  const narrow = width < 420; // 9:16 phones → stacked cards instead of the wide table
  const [logs, setLogs] = useState(null);
  const [planKey, setPlanKey] = useState('home');
  const [entries, setEntries] = useState({}); // exercise name -> {sets, reps, weight}
  const [confetti, setConfetti] = useState(0);
  const [saving, setSaving] = useState(false);

  const plan = GYM_PLANS[planKey];

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('workout_logs', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false } });
    setLogs(rows);
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setEntry = (name, patch) =>
    setEntries((e) => ({
      ...e,
      [name]: { sets: '', reps: '', weight: '', ...(e[name] || {}), ...patch },
    }));

  const finishWorkout = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const exercises = Object.entries(entries)
        .filter(([, v]) => v.sets || v.reps || v.weight)
        .map(([name, v]) => ({
          name,
          sets: Number(v.sets) || 0,
          reps: v.reps || '—',
          weight: Number(v.weight) || 0,
        }));
      if (!exercises.length) return;
      await db.insert('workout_logs', {
        user_id: profile.id,
        date: todayStr(),
        plan_name: plan.name,
        exercises,
        xp_earned: 30,
        created_at: nowIso(),
      });
      await awardXP('WORKOUT');
      setEntries({});
      setConfetti(Date.now());
      await load();
    } finally {
      setSaving(false);
    }
  };

  // PRs: max weight per exercise
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

  // weekly consistency
  const week = useMemo(() => {
    const mon = mondayOf(todayStr());
    return Array.from({ length: 7 }, (_, i) => {
      const d = dateStr(mon.add(i, 'day'));
      return { date: d, count: (logs || []).filter((l) => l.date === d).length };
    });
  }, [logs]);
  const thisWeek = week.reduce((a, d) => a + d.count, 0);

  if (!logs) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Gym Tracker" onBack={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '25%' }} />
      <ScreenHeader title="Gym / Workout" subtitle="Body bhi ek quest hai 💪 (+30 XP per workout)" onBack={() => navigation.goBack()} />

      {/* weekly consistency */}
      <Card mode="light" style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B', flex: 1 }}>
            This week: {thisWeek} workout{thisWeek === 1 ? '' : 's'}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B' }}>
            {thisWeek >= 3 ? 'Beast mode 🔥' : thisWeek >= 1 ? 'Chalo shuru hua 👍' : 'Aaj se shuru karo!'}
          </Text>
        </View>
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

      {/* plan picker */}
      <SectionTitle mode="light">Pick a plan</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Object.entries(GYM_PLANS).map(([key, p]) => (
          <Chip key={key} label={p.name} selected={planKey === key} onPress={() => setPlanKey(key)} mode="light" />
        ))}
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 14 }}>
        {plan.hint} — sets/reps/weight edit karke apna log banao.
      </Text>

      {/* log table — responsive: wide screens get a table row,
          narrow phones (9:16) get a stacked card per exercise */}
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
      <Button title="Finish Workout (+30 XP) 💪" mode="light" size="lg" onPress={finishWorkout} loading={saving} style={{ marginBottom: 18 }} />

      {/* PRs */}
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

      {/* history */}
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
        minWidth: 44, // comfortable touch target even when squeezed
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

// One exercise: table-row on wide screens, stacked card on narrow phones.
function ExerciseRow({ ex, entry, narrow, onSet }) {
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
          <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B' }}>
            {ex.name}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8' }}>
            target {ex.sets}×{ex.reps}
          </Text>
        </View>
        <MiniInput value={entry.sets ?? String(ex.sets)} onChangeText={(v) => onSet({ sets: v })} placeholder={String(ex.sets)} />
        <MiniInput value={entry.reps ?? String(ex.reps)} onChangeText={(v) => onSet({ reps: v })} placeholder={String(ex.reps)} />
        <MiniInput value={entry.weight ?? ''} onChangeText={(v) => onSet({ weight: v })} placeholder="0" />
      </View>
    );
  }
  // narrow: stacked card — name on top, labelled inputs below, nothing clipped
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
      }}
    >
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', flexShrink: 1 }}>
        {ex.name}
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 1, marginBottom: 8 }}>
        target {ex.sets}×{ex.reps}
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
