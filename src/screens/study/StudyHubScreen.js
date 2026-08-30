// Study Hub — light mode launchpad for all academic tools.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SectionTitle } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { pct, sum, todayStr } from '../../lib/utils';
import { fonts } from '../../config/theme';

const TOOLS = [
  { key: 'Syllabus', title: 'Syllabus Map', desc: 'Subjects → chapters → topics', icon: '🗺️', tint: '#7C3AED' },
  { key: 'Schedule', title: 'Smart Schedule', desc: 'Daily · weekly · monthly quests', icon: '📅', tint: '#0891B2' },
  { key: 'Deadlines', title: 'Deadline Sheet', desc: 'Mission board + danger zone', icon: '🎯', tint: '#EF4444' },
  { key: 'Tutor', title: 'Professor Byte', desc: 'AI tutor — explain, solve, quiz', icon: '🤖', tint: '#10B981' },
  { key: 'Flashcards', title: 'Flashcards', desc: 'Spaced repetition decks', icon: '🃏', tint: '#F59E0B' },
  { key: 'Quiz', title: 'Quiz Arena', desc: 'Quick, daily, boss battles', icon: '🧠', tint: '#EC4899' },
  { key: 'Content', title: 'Content Locker', desc: 'Notes, links & AI summaries', icon: '🗂️', tint: '#6366F1' },
];

export function StudyHubScreen({ navigation }) {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ total: 0, completed: 0, todayPending: 0, todayDone: 0 });

  const load = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const [syll, sched] = await Promise.all([
        db.list('syllabus', { eq: { user_id: profile.id } }),
        db.list('schedule', { eq: { user_id: profile.id, date: todayStr() } }),
      ]);
      setStats({
        total: syll.length,
        completed: syll.filter((r) => r.status === 'completed').length,
        todayPending: sched.filter((r) => r.status === 'pending').length,
        todayDone: sched.filter((r) => r.status === 'completed').length,
      });
    } catch {
      /* ignore */
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const progress = pct(stats.completed, stats.total);

  return (
    <Screen mode="light">
      <ScreenHeader title="Study Hub" subtitle="Calm mode ON. Padhai ka time, bhai." />

      <Card mode="light" style={{ marginBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ fontSize: 30, marginRight: 12 }}>📈</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B' }}>
              Syllabus progress
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
              {stats.total
                ? `${stats.completed}/${stats.total} chapters conquered · ${progress}%`
                : 'Koi syllabus nahi mila — add karo ya preset import karo'}
            </Text>
          </View>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 22, color: '#6D28D9' }}>
            {progress}%
          </Text>
        </View>
        <ProgressBar progress={progress / 100} mode="light" color="#6D28D9" />
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 10 }}>
          Today: {stats.todayDone} quests done · {stats.todayPending} pending
        </Text>
      </Card>

      <SectionTitle mode="light">Tools</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {TOOLS.map((t) => (
          <Card
            key={t.key}
            mode="light"
            onPress={() => navigation.navigate(t.key)}
            style={{ width: '48.5%', marginBottom: 12, padding: 14 }}
          >
            <Text style={{ fontSize: 26, marginBottom: 8 }}>{t.icon}</Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B' }}>{t.title}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: 3, lineHeight: 15 }}>
              {t.desc}
            </Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
