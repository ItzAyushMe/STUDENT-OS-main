// LIFE HUB — launchpad for habits, gym and mental wellness.
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { SectionTitle } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { fonts } from '../../config/theme';
import { todayStr, fmtDuration } from '../../lib/utils';

const AREAS = [
  { key: 'Habits', title: 'Habit Tracker', desc: 'Streaks, freezes, daily wins', icon: '✅', tint: '#10B981' },
  { key: 'Gym', title: 'Gym / Workout', desc: 'Plans, PRs, consistency', icon: '💪', tint: '#EF4444' },
  { key: 'Wisdom', title: 'Daily Wisdom', desc: 'Mood check-ins, reflections', icon: '🌤️', tint: '#0891B2' },
];

export function LifeHubScreen({ navigation }) {
  const { profile } = useAuth();
  const [snap, setSnap] = useState({ habitsDone: 0, habitsTotal: 0, focusMin: 0, mood: null });

  const load = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const today = todayStr();
      const [habits, habitLogs, focus, moods] = await Promise.all([
        db.list('habits', { eq: { user_id: profile.id, is_active: true } }),
        db.list('habit_logs', { eq: { user_id: profile.id, date: today } }),
        db.list('focus_sessions', { eq: { user_id: profile.id } }),
        db.list('mood_logs', { eq: { user_id: profile.id, date: today } }),
      ]);
      const doneIds = new Set(habitLogs.filter((l) => l.completed).map((l) => l.habit_id));
      const todayFocus = focus.filter((f) => String(f.start_time || '').slice(0, 10) === today);
      setSnap({
        habitsDone: habits.filter((h) => doneIds.has(h.id)).length,
        habitsTotal: habits.length,
        focusMin: todayFocus.reduce((a, f) => a + (f.duration_minutes || 0), 0),
        mood: moods.find((m) => m.mood != null)?.mood ?? null,
      });
    } catch {
      /* ignore */
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen mode="light">
      <ScreenHeader title="Life" subtitle="Balance hi asli game hai — body, mind, habits" />

      <Card mode="light" style={{ marginBottom: 18 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', marginBottom: 10 }}>
          Aaj ka snapshot 📸
        </Text>
        <View style={{ flexDirection: 'row' }}>
          <Snap icon="✅" value={`${snap.habitsDone}/${snap.habitsTotal}`} label="Habits" />
          <Snap icon="⏱️" value={fmtDuration(snap.focusMin)} label="Focus" />
          <Snap icon="🌤️" value={snap.mood ? `${snap.mood}/5` : '—'} label="Mood" />
        </View>
      </Card>

      <SectionTitle mode="light">Areas</SectionTitle>
      {AREAS.map((a) => (
        <Card key={a.key} mode="light" onPress={() => navigation.navigate(a.key)} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                backgroundColor: a.tint + '1A',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 13,
              }}
            >
              <Text style={{ fontSize: 23 }}>{a.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B' }}>{a.title}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2 }}>{a.desc}</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 18 }}>›</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

function Snap({ icon, value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 12, paddingVertical: 10, marginHorizontal: 4 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', marginTop: 4 }}>{value}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#64748B' }}>{label}</Text>
    </View>
  );
}
