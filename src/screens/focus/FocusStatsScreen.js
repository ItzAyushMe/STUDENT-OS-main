// Focus history & stats — today, this week (bar chart), all-time,
// focus streak. Pure Views for the chart (low-end friendly).
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { fonts, radius } from '../../config/theme';
import { todayStr, dateStr, dayjs, fmtDuration, mondayOf, groupBy } from '../../lib/utils';

export function FocusStatsScreen({ navigation }) {
  const { profile } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const rows = await db.list('focus_sessions', { eq: { user_id: profile.id }, order: { col: 'start_time', asc: false } });
      setSessions(rows);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !sessions) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Focus Stats" onBack={() => navigation.goBack()} />
        <Loading mode="light" text="Crunching your focus numbers…" />
      </Screen>
    );
  }

  const today = todayStr();
  const byDate = groupBy(sessions, (s) => String(s.start_time || '').slice(0, 10));

  const todays = byDate[today] || [];
  const todayMin = todays.reduce((a, s) => a + (s.duration_minutes || 0), 0);

  // this week (Mon..Sun)
  const mon = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => dateStr(mon.add(i, 'day')));
  const weekData = week.map((d) => ({
    date: d,
    minutes: (byDate[d] || []).reduce((a, s) => a + (s.duration_minutes || 0), 0),
  }));
  const weekMin = weekData.reduce((a, d) => a + d.minutes, 0);
  const maxMin = Math.max(30, ...weekData.map((d) => d.minutes));

  // all-time
  const totalMin = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const totalXp = sessions.reduce((a, s) => a + (s.xp_earned || 0), 0);
  const avgRating = (() => {
    const rated = sessions.filter((s) => s.focus_rating);
    if (!rated.length) return null;
    return (rated.reduce((a, s) => a + s.focus_rating, 0) / rated.length).toFixed(1);
  })();

  // focus streak (consecutive days ending today/yesterday with >=1 session)
  let focusStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = dateStr(dayjs(today).subtract(i, 'day'));
    if ((byDate[d] || []).length) focusStreak++;
    else if (i === 0) continue; // today not done yet doesn't break
    else break;
  }

  const bestDay = Object.entries(byDate).sort((a, b) => b[1].length - a[1].length)[0];

  return (
    <Screen mode="light">
      <ScreenHeader title="Focus Stats" subtitle="Numbers don't lie — tu kar lega" onBack={() => navigation.goBack()} />

      {/* today + streak */}
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <StatBox icon="⏱️" value={fmtDuration(todayMin)} label="Today" style={{ flex: 1, marginRight: 8 }} />
        <StatBox icon="🔥" value={`${focusStreak}d`} label="Focus streak" style={{ flex: 1 }} />
      </View>

      {/* weekly bar chart */}
      <Card mode="light" style={{ marginBottom: 12 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B', marginBottom: 4 }}>
          This week · {fmtDuration(weekMin)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, marginTop: 12 }}>
          {weekData.map((d, i) => {
            const h = Math.round((d.minutes / maxMin) * 100);
            const isToday = d.date === today;
            return (
              <View key={d.date} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 9, color: '#94A3B8', marginBottom: 4 }}>
                  {d.minutes ? d.minutes : ''}
                </Text>
                <View
                  style={{
                    width: '62%',
                    height: `${Math.max(3, h)}%`,
                    borderRadius: 5,
                    backgroundColor: isToday ? '#0891B2' : d.minutes ? '#67E8F9' : '#E2E8F0',
                  }}
                />
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10, color: isToday ? '#0891B2' : '#94A3B8', marginTop: 5 }}>
                  {dayjs(d.date).format('dd')}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      {/* all-time */}
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <StatBox icon="🌍" value={fmtDuration(totalMin)} label="All-time focus" style={{ flex: 1.4, marginRight: 8 }} />
        <StatBox icon="🎮" value={`${sessions.length}`} label="Sessions" style={{ flex: 1, marginRight: 8 }} />
        <StatBox icon="⚡" value={`${totalXp}`} label="XP earned" style={{ flex: 1 }} />
      </View>
      {avgRating ? (
        <Card mode="light" style={{ marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#475569' }}>
            Average focus rating: <Text style={{ fontFamily: fonts.bodySemiBold, color: '#0891B2' }}>{avgRating} / 5</Text>
            {bestDay ? ` · Best day: ${bestDay[0]} (${bestDay[1].length} sessions)` : ''}
          </Text>
        </Card>
      ) : null}

      {/* recent sessions */}
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', marginBottom: 8 }}>
        Recent sessions
      </Text>
      {sessions.slice(0, 12).map((s) => (
        <View
          key={s.id}
          style={{
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: '#E2E8F0',
            borderRadius: radius.md,
            padding: 12,
            marginBottom: 8,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 20, marginRight: 10 }}>{s.mode === 'deep' ? '🧠' : s.mode === 'sprint' ? '⚡' : '🎯'}</Text>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13.5, color: '#1E293B' }}>
              {s.topic || 'Focus session'}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
              {String(s.start_time || '').slice(0, 10)} · {s.duration_minutes} min
              {s.distractions ? ` · ${s.distractions} distractions` : ''}
            </Text>
          </View>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: '#0891B2' }}>
            {s.focus_rating ? `${'⭐'.repeat(s.focus_rating)}` : '—'}
          </Text>
        </View>
      ))}
      {!sessions.length ? (
        <Card mode="light">
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', textAlign: 'center' }}>
            Abhi tak koi session nahi. Pehla session start karo — 25 min, 25 XP! ⚡
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function StatBox({ icon, value, label, style }) {
  return (
    <View
      style={[
        {
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#E2E8F0',
          borderRadius: radius.md,
          paddingVertical: 12,
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 17 }}>{icon}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#1E293B', marginTop: 4 }}>{value}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#64748B', marginTop: 2 }}>{label}</Text>
    </View>
  );
}
