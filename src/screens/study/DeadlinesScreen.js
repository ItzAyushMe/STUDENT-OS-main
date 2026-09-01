// Deadline Sheet — the mission board. Every topic with deadline,
// status, progress; filters by subject; summary cards; danger zone
// for overdue topics; AI auto-planning from exam date (offline engine).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { infoAlert } from '../../lib/alert';
import { autoSetDeadlines } from '../../lib/scheduleGenerator';
import { fonts, radius } from '../../config/theme';
import { todayStr, daysBetween, pct } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

export function DeadlinesScreen({ navigation }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [editRow, setEditRow] = useState(null);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const data = await db.list('syllabus', { eq: { user_id: profile.id } });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  const onBack = useHubBack(navigation, 'StudyHub');
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const subjects = useMemo(() => ['All', ...new Set(rows.map((r) => r.subject))], [rows]);
  const today = todayStr();

  const categorized = useMemo(() => {
    const behind = [];
    const inProgress = [];
    const upcoming = [];
    const completed = [];
    const noDate = [];
    for (const r of rows) {
      if (r.status === 'completed') completed.push(r);
      else if (!r.deadline) noDate.push(r);
      else if (r.deadline < today) behind.push(r);
      else if (r.status === 'in_progress') inProgress.push(r);
      else upcoming.push(r);
    }
    behind.sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
    inProgress.sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
    upcoming.sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
    return { behind, inProgress, upcoming, completed, noDate };
  }, [rows, today]);

  const applyFilter = (list) => (filter === 'All' ? list : list.filter((r) => r.subject === filter));

  const autoPlan = async () => {
    const schoolExams = Array.isArray(profile.school_exams) ? profile.school_exams : [];
    if (!profile.exam_date && !schoolExams.length) {
      infoAlert(
        'Exam dates missing',
        'Pehle school exam ya competitive exam date set karo (Settings) — phir auto-plan dabao.'
      );
      return;
    }
    setBusy(true);
    try {
      // BUG 11: deterministic first — exam date + syllabus + daily hours.
      // No AI needed to generate the sheet; AI only ever enhances advice.
      const deadlines = autoSetDeadlines(rows, profile.exam_date, profile.daily_study_hours, schoolExams);
      for (const [id, deadline] of Object.entries(deadlines)) {
        await db.update('syllabus', id, { deadline });
      }
      await load();
    } catch (e) {
      infoAlert('Auto-plan failed', e?.message || 'Deadlines set nahi ho paye. Dobara try karo.');
    } finally {
      setBusy(false);
    }
  };

  const saveDeadline = async () => {
    if (!editRow) return;
    await db.update('syllabus', editRow.id, { deadline: deadlineInput || null });
    setEditRow(null);
    await load();
  };

  const openEdit = (row) => {
    setEditRow(row);
    setDeadlineInput(row.deadline || '');
  };

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Deadline Sheet"
        subtitle="Mission board — har topic, har deadline"
        onBack={onBack}
        right={
          <Pressable
            onPress={autoPlan}
            disabled={busy}
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
            <Ionicons name="sparkles-outline" size={19} color="#6D28D9" />
          </Pressable>
        }
      />

      {/* Summary cards */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14 }}>
        <SummaryCard label="Completed" value={categorized.completed.length} color="#10B981" icon="✅" />
        <SummaryCard label="In progress" value={categorized.inProgress.length} color="#0891B2" icon="🔄" />
        <SummaryCard label="Behind" value={categorized.behind.length} color="#DC2626" icon="⚠️" />
        <SummaryCard label="Upcoming" value={categorized.upcoming.length} color="#6D28D9" icon="📅" />
      </View>

      {/* Danger zone */}
      {applyFilter(categorized.behind).length ? (
        <Card mode="light" style={{ marginBottom: 14, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 18, marginRight: 8 }}>🚨</Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#DC2626' }}>Danger zone — overdue</Text>
          </View>
          {applyFilter(categorized.behind).slice(0, 5).map((r) => (
            <Pressable
              key={r.id}
              onPress={() => navigation.navigate('TopicDetail', { rowId: r.id, subject: r.subject, chapter: r.chapter })}
              style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#FEE2E2' }}
            >
              <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#7F1D1D' }}>
                {r.subject} · {r.chapter}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#DC2626', marginTop: 2 }}>
                {Math.abs(daysBetween(r.deadline, today))} days late — rescue mission needed!
              </Text>
            </Pressable>
          ))}
          {categorized.behind.length > 5 ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#B91C1C', marginTop: 6 }}>
              +{categorized.behind.length - 5} more overdue
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Filters */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
        {subjects.map((s) => (
          <Chip key={s} label={s} selected={filter === s} onPress={() => setFilter(s)} mode="light" small />
        ))}
      </View>

      {loading ? <Loading mode="light" /> : null}

      {/* Mission table */}
      {['inProgress', 'upcoming', 'noDate', 'completed'].map((key) => {
        const list = applyFilter(categorized[key]);
        if (!list.length) return null;
        const titles = {
          inProgress: '🔄 In Progress',
          upcoming: '📅 Upcoming',
          noDate: '❓ No Deadline Set',
          completed: '✅ Completed',
        };
        return (
          <View key={key} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginBottom: 8 }}>
              {titles[key]} ({list.length})
            </Text>
            {list.map((r) => (
              <MissionRow key={r.id} row={r} today={today} onEdit={() => openEdit(r)} onOpen={() => navigation.navigate('TopicDetail', { rowId: r.id, subject: r.subject, chapter: r.chapter })} />
            ))}
          </View>
        );
      })}

      {!loading && rows.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B', textAlign: 'center' }}>
            Koi topics nahi mile 🗺️
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 10 }}>
            Syllabus Map se chapters add karo — deadlines yahan mission board ban jayengi.
          </Text>
          <Button title="Open Syllabus Map" size="sm" mode="light" onPress={() => navigation.navigate('Syllabus')} />
        </Card>
      ) : null}

      <Card mode="light" style={{ backgroundColor: '#F8FAFC' }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', lineHeight: 18 }}>
          💡 Auto-plan (✨ button) weightage + hours ke hisaab se deadlines ko exam date tak spread karta hai.
          Kisi bhi row pe tap karke manual override karo — boss always you ho.
        </Text>
      </Card>

      <ModalSheet visible={!!editRow} onClose={() => setEditRow(null)} title={editRow?.chapter || 'Deadline'} mode="light">
        <Input label="Deadline (YYYY-MM-DD)" value={deadlineInput} onChangeText={setDeadlineInput} placeholder="2027-04-15" />
        <View style={{ flexDirection: 'row' }}>
          <Button title="Clear" variant="secondary" size="sm" mode="light" onPress={() => setDeadlineInput('')} style={{ flex: 1, marginRight: 6 }} />
          <Button title="Save" size="sm" mode="light" onPress={saveDeadline} style={{ flex: 2 }} />
        </View>
      </ModalSheet>
    </Screen>
  );
}

function SummaryCard({ label, value, color, icon }) {
  return (
    <View
      style={{
        flexBasis: '48%', // 2×2 grid on narrow phones, 4-up on wide
        flexGrow: 1,
        maxWidth: '48%',
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: radius.md,
        paddingVertical: 10,
        alignItems: 'center',
        marginBottom: 8,
      }}
    >
      <Text style={{ fontSize: 15 }}>{icon}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 17, color, marginTop: 3 }}>{value}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 10, color: '#64748B', textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function MissionRow({ row, today, onEdit, onOpen }) {
  const daysLeft = row.deadline ? daysBetween(today, row.deadline) : null;
  const late = daysLeft != null && daysLeft < 0;
  const soon = daysLeft != null && daysLeft >= 0 && daysLeft <= 3;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: late ? '#FECACA' : '#E2E8F0',
        borderRadius: radius.md,
        padding: 11,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 13.5, color: '#1E293B' }}>
          {row.chapter}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 2 }}>
          {row.subject}
        </Text>
        <ProgressBar progress={(row.progress_percent || 0) / 100} mode="light" height={5} style={{ marginTop: 7, borderWidth: 0, backgroundColor: '#F1F5F9' }} color="#0891B2" />
      </View>
      <Pressable onPress={onEdit} hitSlop={8} style={{ alignItems: 'flex-end', marginLeft: 10 }}>
        <Text
          style={{
            fontFamily: fonts.bodySemiBold,
            fontSize: 12,
            color: late ? '#DC2626' : soon ? '#D97706' : '#64748B',
          }}
        >
          {row.deadline ? (late ? `${Math.abs(daysLeft)}d late` : daysLeft === 0 ? 'Today!' : `${daysLeft}d left`) : 'No date'}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
          {row.deadline || 'tap to set'}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
          {row.status === 'completed' ? '✅ done' : `${row.progress_percent || 0}%`}
        </Text>
      </Pressable>
    </Pressable>
  );
}
