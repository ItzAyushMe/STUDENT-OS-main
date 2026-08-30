// Topic/Chapter detail — progress, status, deadline override, complete with XP.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Confetti } from '../../components/gamer/Confetti';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { db } from '../../lib/db';
import { fonts, radius } from '../../config/theme';
import { subjectColor, nowIso, todayStr } from '../../lib/utils';

export function TopicDetailScreen({ navigation, route }) {
  const { rowId, subject, chapter } = route?.params || {};
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [row, setRow] = useState(null);
  const [confetti, setConfetti] = useState(0);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await db.list('syllabus', { eq: { id: rowId } });
    setRow(rows[0] || null);
    setDeadlineInput(rows[0]?.deadline || '');
  }, [rowId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!row) return <Screen mode="light"><ScreenHeader title="Topic" onBack={() => navigation.goBack()} /></Screen>;

  const color = subjectColor(row.subject);

  const setProgress = async (val) => {
    const v = Math.max(0, Math.min(100, Math.round(val)));
    const status = v >= 100 ? 'completed' : v > 0 ? 'in_progress' : 'locked';
    const wasCompleted = row.status === 'completed';
    const patch = { progress_percent: v, status, ...(v >= 100 ? { completed_at: nowIso() } : {}) };
    setRow({ ...row, ...patch });
    await db.update('syllabus', row.id, patch);
    if (v >= 100 && !wasCompleted) {
      setConfetti(Date.now());
      await awardXP('CHAPTER_COMPLETE');
    }
  };

  const complete = () => setProgress(100);

  const saveDeadline = async () => {
    const patch = { deadline: deadlineInput || null };
    setRow({ ...row, ...patch });
    await db.update('syllabus', row.id, patch);
    setDeadlineOpen(false);
  };

  const startStudySession = () => {
    navigation.navigate('Schedule');
  };

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '30%' }} />
      <ScreenHeader title={row.chapter} subtitle={`${row.subject} · ${row.estimated_hours || 4} hrs est.`} onBack={() => navigation.goBack()} />

      {/* status + weightage */}
      <View style={{ flexDirection: 'row', marginBottom: 14 }}>
        <View style={{ backgroundColor: color + '1A', borderWidth: 1, borderColor: color + '55', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, marginRight: 8 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color }}>
            {row.status === 'completed' ? '✅ Completed' : row.status === 'in_progress' ? `🔄 ${row.progress_percent}%` : '🔒 Locked'}
          </Text>
        </View>
        <View style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, marginRight: 8 }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#64748B' }}>
            Weightage {'⭐'.repeat(Math.max(1, row.weightage || 3))}
          </Text>
        </View>
        {row.deadline ? (
          <Pressable onPress={() => setDeadlineOpen(true)} style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#DC2626' }}>
              📅 {row.deadline}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* progress control */}
      <Card mode="light" style={{ marginBottom: 14 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginBottom: 10 }}>
          Progress — slide karo ya buttons dabao
        </Text>
        <ProgressBar progress={(row.progress_percent || 0) / 100} mode="light" color={color} height={10} />
        <View style={{ flexDirection: 'row', marginTop: 12, justifyContent: 'space-between' }}>
          {[0, 25, 50, 75, 100].map((v) => (
            <Pressable
              key={v}
              onPress={() => setProgress(v)}
              style={{
                backgroundColor: (row.progress_percent || 0) >= v && v > 0 ? color + '22' : '#F1F5F9',
                borderWidth: 1,
                borderColor: (row.progress_percent || 0) >= v && v > 0 ? color + '66' : '#E2E8F0',
                borderRadius: 10,
                paddingVertical: 8,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: '#1E293B' }}>{v}%</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* actions */}
      {row.status !== 'completed' ? (
        <Button title="Mark Complete  (+100 XP)" onPress={complete} mode="light" size="lg" style={{ marginBottom: 10 }} />
      ) : (
        <Card mode="light" style={{ marginBottom: 10, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#059669', textAlign: 'center' }}>
            Shaabaash! Chapter conquered 🏆 (+100 XP)
          </Text>
        </Card>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
        <Button title="Set Deadline" variant="secondary" size="sm" mode="light" onPress={() => setDeadlineOpen(true)} style={{ flex: 1, marginRight: 6 }} />
        <Button title="Add to Schedule" variant="secondary" size="sm" mode="light" onPress={startStudySession} style={{ flex: 1, marginLeft: 6 }} />
      </View>

      <Card mode="light" style={{ marginBottom: 14 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginBottom: 8 }}>
          Quick tools for this chapter
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <QuickTool emoji="🤖" label="Ask Byte" onPress={() => navigation.navigate('Tutor', { prefill: `Explain "${row.chapter}" (${row.subject}) simply` })} />
          <QuickTool emoji="🃏" label="Flashcards" onPress={() => navigation.navigate('Flashcards', { subject: row.subject, topic: row.chapter })} />
          <QuickTool emoji="🧠" label="Quiz me" onPress={() => navigation.navigate('Quiz', { subject: row.subject, topic: row.chapter })} />
        </View>
      </Card>

      <ModalSheet visible={deadlineOpen} onClose={() => setDeadlineOpen(false)} title="Deadline override" mode="light">
        <Input
          label="Deadline date (YYYY-MM-DD)"
          value={deadlineInput}
          onChangeText={setDeadlineInput}
          placeholder={todayStr()}
          hint="AI/algorithm sets this automatically from your exam date — but boss always you ho."
        />
        <View style={{ flexDirection: 'row' }}>
          <Button title="Clear" variant="secondary" size="sm" mode="light" onPress={() => setDeadlineInput('')} style={{ flex: 1, marginRight: 6 }} />
          <Button title="Save" size="sm" mode="light" onPress={saveDeadline} style={{ flex: 2 }} />
        </View>
      </ModalSheet>
    </Screen>
  );
}

function QuickTool({ emoji, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: radius.md,
        paddingVertical: 12,
        paddingHorizontal: 10,
        flex: 0.32,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 22, marginBottom: 6 }}>{emoji}</Text>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#1E293B' }}>{label}</Text>
    </Pressable>
  );
}
