// DAILY WISDOM — morning quote, evening mood check-in (1–5 + note
// with mood-aware AI reply), weekly reflection with AI summary.
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { QUOTES, MOODS } from '../../config/constants';
import { aiMoodReply, aiWeeklyReflection, AIUnavailableError } from '../../lib/aiFeatures';
import { fonts, radius } from '../../config/theme';
import { todayStr, hashString, dateStr, dayjs, mondayOf, groupBy, nowIso } from '../../lib/utils';

export function WisdomScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [logs, setLogs] = useState(null);
  const [mood, setMood] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [weeklyMsg, setWeeklyMsg] = useState('');

  const today = todayStr();
  const quote = QUOTES[hashString(`wisdom-${today}`) % QUOTES.length];

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('mood_logs', { eq: { user_id: profile.id }, order: { col: 'date', asc: false }, limit: 60 });
    setLogs(rows);
    const todays = rows.find((r) => r.date === today);
    if (todays) {
      setMood(todays.mood || 0);
      setNote(todays.note || '');
      setReply(todays.ai_reply || null);
    }
  }, [profile?.id, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveMood = async () => {
    if (!mood || busy) return;
    setBusy(true);
    let aiReply = null;
    try {
      aiReply = await aiMoodReply({ mood, note });
    } catch (e) {
      aiReply =
        e instanceof AIUnavailableError
          ? null
          : null;
    }
    const existing = logs?.find((r) => r.date === today);
    const patch = { mood, note: note || null, ai_reply: aiReply, created_at: nowIso() };
    let rowId = existing?.id;
    if (existing) {
      await db.update('mood_logs', existing.id, patch);
    } else {
      const row = await db.insert('mood_logs', {
        user_id: profile.id,
        date: today,
        ...patch,
      });
      rowId = row.id;
      await awardXP('MOOD_CHECKIN');
    }
    setReply(aiReply || 'Note ho gaya. Kal phir batana kaisa raha din — small check-ins, big wins. 🌱');
    await load();
    setBusy(false);
  };

  const buildWeekly = async () => {
    if (weeklyBusy) return;
    setWeeklyBusy(true);
    setWeeklyMsg('');
    try {
      const weekStart = dateStr(mondayOf(today));
      const [moodRows, habitLogs, habits, focus, xpRows] = await Promise.all([
        db.list('mood_logs', { eq: { user_id: profile.id }, gte: { date: weekStart } }),
        db.list('habit_logs', { eq: { user_id: profile.id }, gte: { date: weekStart } }),
        db.list('habits', { eq: { user_id: profile.id, is_active: true } }),
        db.list('focus_sessions', { eq: { user_id: profile.id }, gte: { start_time: `${weekStart}T00:00:00` } }),
        db.list('xp_events', { eq: { user_id: profile.id }, gte: { created_at: `${weekStart}T00:00:00` } }),
      ]);
      const moods = moodRows.filter((m) => m.mood).map((m) => m.mood);
      const habitsDone = habitLogs.filter((l) => l.completed).length;
      const focusMinutes = focus.reduce((a, f) => a + (f.duration_minutes || 0), 0);
      const xp = xpRows.reduce((a, x) => a + (x.amount || 0), 0);
      let result;
      try {
        result = await aiWeeklyReflection({ moods, habitsDone, habitsTotal: habits.length, focusMinutes, xp });
      } catch (e) {
        // offline fallback summary
        const avg = moods.length ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1) : '—';
        result = {
          summary: `Is hafte: ${habitsDone} habits done, ${Math.round(focusMinutes)} min focus, average mood ${avg}/5, ${xp} XP kamaye.`,
          win: xp > 0 ? `${xp} XP earned — consistency OP 🔥` : 'New week, new chances 💪',
          improve: 'Ek focus session daily — bas wahi punch missing hai.',
          plan: 'Kal se: 1 focus session + 3 habits before 8 PM.',
        };
      }
      setWeekly(result);
    } finally {
      setWeeklyBusy(false);
    }
  };

  if (!logs) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Daily Wisdom" onBack={() => navigation.goBack()} />
        <Loading mode="light" />
      </Screen>
    );
  }

  const todaysLog = logs.find((r) => r.date === today);
  const last7 = Array.from({ length: 7 }, (_, i) => dateStr(dayjs(today).subtract(6 - i, 'day')));
  const byDate = groupBy(logs, (l) => l.date);

  return (
    <Screen mode="light">
      <ScreenHeader title="Daily Wisdom" subtitle="Mind bhi padhega tabhi marks aayenge 🌤️" onBack={() => navigation.goBack()} />

      {/* morning message */}
      <Card mode="light" style={{ marginBottom: 14, backgroundColor: '#FFFbeb', borderColor: '#FDE68A' }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#B45309', marginBottom: 8 }}>
          ☀️ Morning message
        </Text>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14.5, color: '#78350F', fontStyle: 'italic', lineHeight: 21 }}>
          “{quote.text}”
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#B45309', marginTop: 8 }}>— {quote.author}</Text>
      </Card>

      {/* evening mood check-in */}
      <Card mode="light" style={{ marginBottom: 14 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B', marginBottom: 4 }}>
          🌙 Evening mood check-in
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginBottom: 14 }}>
          {todaysLog ? 'Aaj ka mood logged — update kar sakte ho' : 'Din kaisa gaya? Ek tap mein bata do'}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {MOODS.map((m) => (
            <Pressable key={m.value} onPress={() => setMood(m.value)} style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 34, opacity: mood === m.value ? 1 : 0.35 }}>{m.emoji}</Text>
              <Text
                style={{
                  fontFamily: fonts.bodyMedium,
                  fontSize: 10.5,
                  color: mood === m.value ? '#0891B2' : '#94A3B8',
                  marginTop: 4,
                  textAlign: 'center',
                }}
              >
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Input
          label="Kuch likhna hai? (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Aaj energy low thi, par mock test accha gaya…"
          multiline
          style={{ marginTop: 14 }}
        />
        <Button
          title={busy ? 'Saving…' : todaysLog ? 'Update Check-in' : 'Log Mood (+5 XP)'}
          mode="light"
          onPress={saveMood}
          disabled={!mood}
          loading={busy}
        />
        {reply ? (
          <View style={{ backgroundColor: '#F0FDFA', borderRadius: radius.md, padding: 12, marginTop: 12 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#0891B2', marginBottom: 4 }}>🤖 Professor Byte</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#134E4A', lineHeight: 19 }}>{reply}</Text>
          </View>
        ) : null}
      </Card>

      {/* mood history */}
      <Card mode="light" style={{ marginBottom: 14 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginBottom: 10 }}>
          Last 7 days
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90 }}>
          {last7.map((d) => {
            const log = (byDate[d] || [])[0];
            const m = log?.mood || 0;
            const h = m ? 14 + m * 14 : 6;
            return (
              <View key={d} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <Text style={{ fontSize: 11 }}>{m ? MOODS[m - 1].emoji : ''}</Text>
                <View
                  style={{
                    width: '55%',
                    height: h,
                    borderRadius: 5,
                    backgroundColor: m ? (m >= 4 ? '#34D399' : m >= 3 ? '#FCD34D' : '#FCA5A5') : '#E2E8F0',
                    marginTop: 4,
                  }}
                />
                <Text style={{ fontFamily: fonts.body, fontSize: 9.5, color: '#94A3B8', marginTop: 4 }}>
                  {dayjs(d).format('ddd')}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      {/* weekly reflection */}
      <Card mode="light" style={{ marginBottom: 8 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B', marginBottom: 4 }}>
          📖 Weekly reflection
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginBottom: 12 }}>
          AI tumhare mood, habits, focus aur XP dekh ke ek honest recap likhega.
        </Text>
        {weekly ? (
          <View style={{ backgroundColor: '#F8FAFC', borderRadius: radius.md, padding: 12 }}>
            <Line label="Summary" text={weekly.summary} />
            <Line label="Win 🎉" text={weekly.win} />
            <Line label="Improve 🌱" text={weekly.improve} />
            <Line label="Next week plan 🎯" text={weekly.plan} />
          </View>
        ) : (
          <Button
            title={weeklyBusy ? 'Soch raha hai…' : 'Generate Weekly Reflection ✨'}
            variant="secondary"
            mode="light"
            onPress={buildWeekly}
            loading={weeklyBusy}
          />
        )}
      </Card>
    </Screen>
  );
}

function Line({ label, text }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: '#6D28D9', marginBottom: 3 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#334155', lineHeight: 19 }}>{text}</Text>
    </View>
  );
}
