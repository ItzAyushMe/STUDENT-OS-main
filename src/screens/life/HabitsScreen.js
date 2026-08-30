// HABITS — tracker with morning/afternoon/evening groups, weekly
// 7-day view, per-habit streaks, streak freeze power-up and
// custom habit creation. Light mode.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Confetti } from '../../components/gamer/Confetti';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { HABIT_CATEGORIES } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { todayStr, dateStr, dayjs, mondayOf, nowIso, groupBy } from '../../lib/utils';

const PARTS = [
  { key: 'morning', label: '🌅 Morning' },
  { key: 'afternoon', label: '☀️ Afternoon' },
  { key: 'evening', label: '🌙 Evening' },
];

const ICON_CHOICES = ['🎯', '📖', '🧘', '💧', '🏃', '📓', '🌙', '🥗', '📵', '🧠', '💪', '🛏️', '☀️', '🎸'];

export function HabitsScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP, freezes } = useGame();
  const [habits, setHabits] = useState(null);
  const [logs, setLogs] = useState([]);
  const [confetti, setConfetti] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'academic', icon: '🎯', part: 'morning' });

  const today = todayStr();
  const week = useMemo(() => {
    const mon = mondayOf(today);
    return Array.from({ length: 7 }, (_, i) => dateStr(mon.add(i, 'day')));
  }, [today]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const from = dateStr(mondayOf(today).subtract(7, 'day'));
    const [hs, ls] = await Promise.all([
      db.list('habits', { eq: { user_id: profile.id, is_active: true }, order: { col: 'created_at', asc: true } }),
      db.list('habit_logs', { eq: { user_id: profile.id }, gte: { date: from } }),
    ]);
    setHabits(hs);
    setLogs(ls);
  }, [profile?.id, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logMap = useMemo(() => {
    // key: habit_id::date
    const m = {};
    for (const l of logs) m[`${l.habit_id}::${l.date}`] = l;
    return m;
  }, [logs]);

  const streakFor = useCallback(
    (habitId) => {
      let streak = 0;
      for (let i = 0; i < 400; i++) {
        const d = dateStr(dayjs(today).subtract(i, 'day'));
        const l = logMap[`${habitId}::${d}`];
        if (l && (l.completed || l.frozen)) streak++;
        else if (i === 0) continue; // today pending doesn't break
        else break;
      }
      return streak;
    },
    [logMap, today]
  );

  const toggleToday = async (habit) => {
    const existing = logMap[`${habit.id}::${today}`];
    if (existing && existing.completed) {
      // undo
      await db.remove('habit_logs', existing.id);
      setLogs((prev) => prev.filter((l) => l.id !== existing.id));
      return;
    }
    const streak = streakFor(habit.id);
    const row = await db.insert('habit_logs', {
      habit_id: habit.id,
      user_id: profile.id,
      date: today,
      completed: true,
      completed_at: nowIso(),
      streak_count: streak + 1,
      frozen: false,
    });
    setLogs((prev) => [...prev, row]);
    setConfetti(Date.now());
    await awardXP('HABIT');
  };

  const useFreeze = async (habit) => {
    if (freezes <= 0) return;
    const yesterday = dateStr(dayjs(today).subtract(1, 'day'));
    const row = await db.insert('habit_logs', {
      habit_id: habit.id,
      user_id: profile.id,
      date: yesterday,
      completed: false,
      completed_at: nowIso(),
      streak_count: streakFor(habit.id),
      frozen: true,
    });
    setLogs((prev) => [...prev, row]);
    // consume a global freeze from the profile
    await db.update('users', profile.id, { streak_freezes: Math.max(0, (profile.streak_freezes || 0) - 1) });
    await load();
  };

  const addHabit = async () => {
    if (!form.name.trim()) return;
    await db.insert('habits', {
      user_id: profile.id,
      name: form.name.trim(),
      category: form.category,
      icon: form.icon,
      target_time: null,
      part: form.part,
      is_active: true,
      created_at: nowIso(),
    });
    setForm({ name: '', category: 'academic', icon: '🎯', part: 'morning' });
    setAddOpen(false);
    await load();
  };

  if (!habits) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Habits" onBack={() => navigation.goBack()} />
        <Loading mode="light" />
      </Screen>
    );
  }

  const doneToday = habits.filter((h) => logMap[`${h.id}::${today}`]?.completed).length;

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '30%' }} />
      <ScreenHeader
        title="Habits"
        subtitle={`${doneToday}/${habits.length} done today · ${freezes} 🧊 freeze${freezes === 1 ? '' : 's'} left`}
        onBack={() => navigation.goBack()}
        right={
          <Pressable onPress={() => setAddOpen(true)} hitSlop={8} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7 }}>
            <Ionicons name="add" size={19} color="#6D28D9" />
          </Pressable>
        }
      />

      {/* weekly header */}
      <View style={{ flexDirection: 'row', marginBottom: 10, marginLeft: 4 }}>
        <View style={{ flex: 1.6 }} />
        {week.map((d) => (
          <View key={d} style={{ flex: 0.5, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10, color: d === today ? '#6D28D9' : '#94A3B8' }}>
              {dayjs(d).format('dd')}
            </Text>
          </View>
        ))}
        <View style={{ width: 34 }} />
      </View>

      {PARTS.map((part) => {
        const list = habits.filter((h) => (h.part || 'morning') === part.key);
        if (!list.length) return null;
        return (
          <View key={part.key} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', marginBottom: 8 }}>
              {part.label} ({list.filter((h) => logMap[`${h.id}::${today}`]?.completed).length}/{list.length})
            </Text>
            {list.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                week={week}
                today={today}
                logMap={logMap}
                streak={streakFor(h.id)}
                freezes={freezes}
                onToggle={() => toggleToday(h)}
                onFreeze={() => useFreeze(h)}
              />
            ))}
          </View>
        );
      })}

      {!habits.length ? (
        <Card mode="light">
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', textAlign: 'center' }}>
            Koi habit nahi hai
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Chhote habits, bade level-ups. Pehla habit add karo!
          </Text>
          <Button title="Add Habit" size="sm" mode="light" onPress={() => setAddOpen(true)} />
        </Card>
      ) : null}

      {/* Add habit modal */}
      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title="New Habit" mode="light">
        <Input label="Habit name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="e.g. Solve 5 DPPs daily" />
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#64748B', marginBottom: 8 }}>Category</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {Object.entries(HABIT_CATEGORIES).map(([key, c]) => (
            <Chip key={key} label={`${c.icon} ${c.label}`} small selected={form.category === key} onPress={() => setForm({ ...form, category: key })} mode="light" />
          ))}
        </View>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#64748B', marginVertical: 8 }}>Part of day</Text>
        <View style={{ flexDirection: 'row' }}>
          {PARTS.map((p) => (
            <Chip key={p.key} label={p.label} small selected={form.part === p.key} onPress={() => setForm({ ...form, part: p.key })} mode="light" />
          ))}
        </View>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#64748B', marginVertical: 8 }}>Icon</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {ICON_CHOICES.map((ic) => (
            <Pressable
              key={ic}
              onPress={() => setForm({ ...form, icon: ic })}
              style={{
                fontSize: 20,
                padding: 8,
                borderRadius: 10,
                backgroundColor: form.icon === ic ? '#EEF2FF' : '#F8FAFC',
                borderWidth: 1,
                borderColor: form.icon === ic ? '#C7D2FE' : '#E2E8F0',
                marginRight: 6,
                marginBottom: 6,
              }}
            >
              <Text style={{ fontSize: 20 }}>{ic}</Text>
            </Pressable>
          ))}
        </View>
        <Button title="Add Habit (+10 XP per day)" mode="light" onPress={addHabit} disabled={!form.name.trim()} style={{ marginTop: 6 }} />
      </ModalSheet>
    </Screen>
  );
}

function HabitRow({ habit, week, today, logMap, streak, freezes, onToggle, onFreeze }) {
  const cat = HABIT_CATEGORIES[habit.category] || HABIT_CATEGORIES.academic;
  const doneToday = Boolean(logMap[`${habit.id}::${today}`]?.completed);
  const yesterdayMissed =
    !logMap[`${habit.id}::${dateStr(dayjs(today).subtract(1, 'day'))}`] && streak >= 2 && freezes > 0;

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: radius.md,
        padding: 11,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Pressable
        onPress={onToggle}
        hitSlop={4}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: doneToday ? cat.color : '#CBD5E1',
          backgroundColor: doneToday ? cat.color : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 10,
        }}
      >
        {doneToday ? <Ionicons name="checkmark" size={22} color="#FFF" /> : <Text style={{ fontSize: 17 }}>{habit.icon}</Text>}
      </Pressable>

      <View style={{ flex: 1.6 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13.5, color: '#1E293B' }}>
          {habit.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text style={{ fontSize: 10, marginRight: 4 }}>{cat.icon}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: streak > 0 ? '#D97706' : '#94A3B8' }}>
            {streak > 0 ? `🔥 ${streak}d streak` : 'No streak yet'}
          </Text>
          {yesterdayMissed ? (
            <Pressable onPress={onFreeze} style={{ marginLeft: 8, backgroundColor: '#ECFEFF', borderWidth: 1, borderColor: '#A5F3FC', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10, color: '#0891B2' }}>🧊 save streak</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* weekly dots */}
      {week.map((d) => {
        const l = logMap[`${habit.id}::${d}`];
        const state = l?.completed ? 'done' : l?.frozen ? 'frozen' : null;
        return (
          <View key={d} style={{ flex: 0.5, alignItems: 'center' }}>
            <View
              style={{
                width: 11,
                height: 11,
                borderRadius: 6,
                backgroundColor: state === 'done' ? cat.color : state === 'frozen' ? '#A5F3FC' : d === today ? '#E2E8F0' : '#F1F5F9',
                borderWidth: d === today ? 1.5 : 0,
                borderColor: cat.color,
              }}
            />
          </View>
        );
      })}

      <View style={{ width: 34, alignItems: 'flex-end' }}>
        {doneToday ? <Text style={{ fontSize: 13 }}>✨</Text> : null}
      </View>
    </View>
  );
}
