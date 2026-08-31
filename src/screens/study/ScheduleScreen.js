// Smart Schedule — daily time-blocks, weekly grid, monthly calendar.
// Generates plans offline (scheduleGenerator) with revision cycles,
// mock days and buffer days; missed quests auto-reschedule.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Confetti } from '../../components/gamer/Confetti';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { generateSchedule, autoRescheduleMissed, autoSetDeadlines } from '../../lib/scheduleGenerator';
import { aiReschedule } from '../../lib/aiFeatures';
import { SESSION_TYPES, TRACK_PRIORITY } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { dayjs, todayStr, dateStr, subjectColor, fmtDuration, mondayOf, nowIso } from '../../lib/utils';

export function ScheduleScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [view, setView] = useState('daily');
  const [selected, setSelected] = useState(todayStr());
  const [monthOffset, setMonthOffset] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [genBusy, setGenBusy] = useState(false);
  const [coverage, setCoverage] = useState(null);
  const [aiPlanMsg, setAiPlanMsg] = useState('');
  const [aiPlanBusy, setAiPlanBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const from = dateStr(dayjs().subtract(30, 'day'));
      const to = dateStr(dayjs().add(180, 'day'));
      const data = await db.list('schedule', {
        eq: { user_id: profile.id },
        gte: { date: from },
        lte: { date: to },
        order: { col: 'date', asc: true },
      });
      setSessions(data);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const missed = useMemo(
    () => sessions.filter((s) => s.status === 'pending' && s.date < todayStr()),
    [sessions]
  );

  const daySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.date === selected)
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))),
    [sessions, selected]
  );

  const weekDays = useMemo(() => {
    const mon = mondayOf(selected);
    return Array.from({ length: 7 }, (_, i) => dateStr(mon.add(i, 'day')));
  }, [selected]);

  const completeSession = async (s) => {
    await db.update('schedule', s.id, { status: 'completed' });
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'completed' } : x)));
    setConfetti(Date.now());
    await awardXP('STUDY_QUEST');
  };

  const skipSession = async (s) => {
    await db.update('schedule', s.id, { status: 'skipped' });
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'skipped' } : x)));
  };

  const generate = async (alsoDeadlines) => {
    setGenBusy(true);
    try {
      const syllabus = await db.list('syllabus', { eq: { user_id: profile.id } });
      // wipe pending future sessions (history stays)
      await db.removeWhere('schedule', { user_id: profile.id, status: 'pending' });
      const rows = generateSchedule({
        syllabus,
        examDate: profile.exam_date,
        olympiadDate: profile.olympiad_date || null,
        schoolExams: Array.isArray(profile.school_exams) ? profile.school_exams : [],
        dailyHours: profile.daily_study_hours,
        preferredTime: profile.preferred_time,
        daysOff: profile.days_off || [],
        prepLevel: profile.prep_level,
        weeks: 6,
        userId: profile.id,
      });
      setCoverage(rows.coverage || null);
      if (rows.length) await db.insertMany('schedule', rows);
      if (alsoDeadlines && syllabus.length) {
        const deadlines = autoSetDeadlines(
          syllabus,
          profile.exam_date,
          profile.daily_study_hours,
          Array.isArray(profile.school_exams) ? profile.school_exams : []
        );
        for (const [id, deadline] of Object.entries(deadlines)) {
          await db.update('syllabus', id, { deadline });
        }
      }
      await load();
      setGenOpen(false);
    } finally {
      setGenBusy(false);
    }
  };

  // AI-assisted catch-up: heuristic moves first, then Professor Byte
  // explains what to prioritise / drop (graceful if AI is offline).
  const rescheduleMissed = async () => {
    setAiPlanBusy(true);
    try {
      const { moved } = autoRescheduleMissed(sessions, { dailyHours: profile.daily_study_hours });
      for (const m of moved) await db.update('schedule', m.id, { date: m.date, status: 'pending' });
      await load();
      // AI advice on what to prioritise / drop (best-effort)
      try {
        const behindTopics = missed.map((m) => m.topic || m.subject).filter(Boolean);
        const plan = await aiReschedule({
          missed: missed.slice(0, 8),
          upcomingCount: sessions.filter((s) => s.date >= todayStr() && s.status === 'pending').length,
          examDate: profile.exam_date,
          dailyHours: profile.daily_study_hours,
          behindTopics,
        });
        if (plan?.advice) setAiPlanMsg(plan.advice);
      } catch {
        setAiPlanMsg(''); // offline — heuristic moves already applied
      }
    } finally {
      setAiPlanBusy(false);
    }
  };

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '35%' }} />
      <ScreenHeader
        title="Smart Schedule"
        subtitle={profile.exam_date ? `Exam: ${profile.exam_date}` : 'No exam set — self-paced mode'}
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row' }}>
            <HeaderBtn icon="sparkles-outline" onPress={() => setGenOpen(true)} />
            <HeaderBtn icon="add" onPress={() => setAddOpen(true)} />
          </View>
        }
      />

      <SegmentedControl
        options={[
          { key: 'daily', label: 'Daily' },
          { key: 'weekly', label: 'Weekly' },
          { key: 'monthly', label: 'Monthly' },
        ]}
        value={view}
        onChange={setView}
        mode="light"
        style={{ marginBottom: 14 }}
      />

      {missed.length > 0 ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#92400E', flex: 1 }}>
            {missed.length} quest{missed.length > 1 ? 's' : ''} miss ho gaye. Chinta mat karo — ek tap mein aage shift karo.
            Class-track quests pehle shift honge 🏫
          </Text>
          <Button
            title={aiPlanBusy ? 'Rescheduling…' : 'Auto-reschedule (AI catch-up plan)'}
            size="sm"
            mode="light"
            onPress={rescheduleMissed}
            loading={aiPlanBusy}
            style={{ marginTop: 10 }}
          />
          {aiPlanMsg ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#B45309', marginTop: 8, lineHeight: 17 }}>
              Professor Byte: {aiPlanMsg}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Priority coverage banner — class first, olympiad second, exam last */}
      {coverage ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#5B21B6' }}>
            🏫 Class {coverage.classPlanned}/{coverage.classTotal} planned
            {coverage.olympiadTotal ? ` · 🏅 Olympiad ${coverage.olympiadPlanned}/${coverage.olympiadTotal}` : ''}
            {coverage.examTotal ? ` · 🎯 ${profile.competitive_exam || 'Exam'} ${coverage.examPlanned}/${coverage.examTotal}` : ''}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#7C3AED', marginTop: 4, lineHeight: 16 }}>
            {coverage.classDoneBy && coverage.nextSchoolExam
              ? `Class syllabus target: done by ${coverage.classDoneBy} — 2 weeks before "${coverage.nextSchoolExam.label}" (${coverage.nextSchoolExam.date}) 📅`
              : 'Class syllabus first, then olympiad, then exam track — priority order locked in ⚡'}
          </Text>
        </Card>
      ) : null}

      {loading ? <Loading mode="light" /> : null}

      {view === 'daily' ? (
        <DailyView
          selected={selected}
          setSelected={setSelected}
          sessions={daySessions}
          onComplete={completeSession}
          onSkip={skipSession}
          onGenerate={() => setGenOpen(true)}
        />
      ) : null}

      {view === 'weekly' ? (
        <WeeklyView
          weekDays={weekDays}
          sessions={sessions}
          today={todayStr()}
          onPickDay={(d) => {
            setSelected(d);
            setView('daily');
          }}
        />
      ) : null}

      {view === 'monthly' ? (
        <MonthlyView
          monthOffset={monthOffset}
          setMonthOffset={setMonthOffset}
          sessions={sessions}
          onPickDay={(d) => {
            setSelected(d);
            setMonthOffset(0);
            setView('daily');
          }}
        />
      ) : null}

      {/* Generate modal */}
      <ModalSheet visible={genOpen} onClose={() => setGenOpen(false)} title="Generate Smart Schedule" mode="light">
        <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: '#475569', lineHeight: 20, marginBottom: 14 }}>
          Ye engine tumhare syllabus ke weightage + estimated hours + available time se ek day-by-day plan banayegi —
          revision cycles, Sunday mock tests aur exam-ke-pehle buffer days ke saath.
        </Text>
        <InfoRow label="Daily study hours" value={`${profile.daily_study_hours} hrs`} />
        <InfoRow label="Preferred time" value={profile.preferred_time || 'Night'} />
        <InfoRow label="Days off" value={(profile.days_off || []).length ? `${profile.days_off.length} days/week` : 'None'} />
        <InfoRow label="Exam date" value={profile.exam_date || 'Not set'} />
        <InfoRow label="Olympiad" value={profile.olympiad && profile.olympiad !== 'None' ? `${profile.olympiad}${profile.olympiad_date ? ` · ${profile.olympiad_date}` : ''}` : 'None'} />
        <InfoRow
          label="School exams"
          value={
            (profile.school_exams || []).length
              ? (profile.school_exams || []).map((e) => `${e.label} (${e.date})`).join(', ')
              : 'Not set — add in Settings for class-first planning'
          }
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#5B21B6', marginTop: 10, marginBottom: 4, lineHeight: 17 }}>
          Priority: 🏫 Class syllabus FIRST → 🏅 Olympiad → 🎯 {profile.competitive_exam || 'exam'} (leftover time). Revision
          waves + mocks + timed practice included.
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', marginTop: 10, marginBottom: 14 }}>
          Note: existing pending quests will be replaced. Completed history safe rahega.
        </Text>
        <Button
          title="Generate My Plan ⚡"
          mode="light"
          loading={genBusy}
          onPress={() => generate(true)}
          style={{ marginBottom: 10 }}
        />
        <Button
          title="Generate without touching deadlines"
          variant="secondary"
          mode="light"
          disabled={genBusy}
          onPress={() => generate(false)}
        />
      </ModalSheet>

      {/* Add block modal */}
      <AddBlockModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        userId={profile?.id}
        defaultDate={selected}
        onAdded={load}
      />
    </Screen>
  );
}

// ---------------- DAILY ----------------
function DailyView({ selected, setSelected, sessions, onComplete, onSkip, onGenerate }) {
  const done = sessions.filter((s) => s.status === 'completed').length;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <NavArrow dir="left" onPress={() => setSelected(dateStr(dayjs(selected).subtract(1, 'day')))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#1E293B' }}>
            {dayjs(selected).format('dddd')}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B' }}>
            {dayjs(selected).format('DD MMM YYYY')} · {done}/{sessions.length} done
          </Text>
        </View>
        <NavArrow
          dir="right"
          onPress={() => setSelected(dateStr(dayjs(selected).add(1, 'day')))}
        />
      </View>

      {selected !== todayStr() ? (
        <Pressable onPress={() => setSelected(todayStr())} style={{ alignSelf: 'center', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#6D28D9' }}>Jump to today</Text>
        </Pressable>
      ) : null}

      {sessions.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontSize: 34, textAlign: 'center', marginBottom: 8 }}>🌤️</Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', textAlign: 'center' }}>
            Aaj koi quest nahi hai
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Smart Schedule generate karo — ya manually block add karo.
          </Text>
          <Button title="Generate Smart Schedule ⚡" size="sm" mode="light" onPress={onGenerate} />
        </Card>
      ) : (
        sessions.map((s) => (
          <SessionBlock key={s.id} s={s} onComplete={onComplete} onSkip={onSkip} />
        ))
      )}
    </View>
  );
}

const TRACK_BADGE = { class: { icon: '🏫', label: 'Class' }, olympiad: { icon: '🏅', label: 'Olympiad' }, exam: { icon: '🎯', label: 'Exam' } };

const SessionBlock = memo(function SessionBlock({ s, onComplete, onSkip }) {
  const type = SESSION_TYPES[s.session_type] || SESSION_TYPES.study;
  const color = type.color;
  const completed = s.status === 'completed';
  const skipped = s.status === 'skipped';
  const badge = TRACK_BADGE[(s.track === 'olympiad' || s.track === 'exam') ? s.track : 'class'];
  return (
    <View
      style={{
        backgroundColor: completed ? '#F0FDF4' : '#FFFFFF',
        borderWidth: 1,
        borderColor: completed ? '#BBF7D0' : skipped ? '#E2E8F0' : '#E2E8F0',
        borderRadius: radius.lg,
        padding: 12,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: skipped ? 0.55 : 1,
      }}
    >
      <View style={{ width: 5, height: 52, borderRadius: 3, backgroundColor: color, marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', flexShrink: 1 }}>
            {s.start_time}–{s.end_time} · {fmtDuration(s.duration_minutes)} · {type.icon} {type.label}
          </Text>
          {badge && badge.label !== 'Class' ? (
            <View style={{ backgroundColor: '#FFFBEB', borderColor: badge.label === 'Olympiad' ? '#FDE68A' : '#FEE2E2', borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 6 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 9.5, color: badge.label === 'Olympiad' ? '#B45309' : '#B91C1C' }}>
                {badge.icon} {badge.label}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.bodySemiBold,
            fontSize: 14.5,
            color: '#1E293B',
            marginTop: 2,
            textDecorationLine: completed ? 'line-through' : 'none',
          }}
        >
          {s.topic || s.subject}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: color, marginTop: 2 }}>{s.subject}</Text>
      </View>
      {!completed && !skipped ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => onSkip(s)} hitSlop={8} style={{ padding: 8 }}>
            <Ionicons name="flash-outline" size={19} color="#CBD5E1" />
          </Pressable>
          <Pressable
            onPress={() => onComplete(s)}
            hitSlop={6}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4,
            }}
          >
            <Ionicons name="checkmark" size={20} color={color} />
          </Pressable>
        </View>
      ) : (
        <Text style={{ fontSize: 18 }}>{completed ? '✅' : '⏭️'}</Text>
      )}
    </View>
  );
});

// ---------------- WEEKLY ----------------
function WeeklyView({ weekDays, sessions, today, onPickDay }) {
  return (
    <View>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#64748B', marginBottom: 10 }}>
        Tap a day to open its quests · colours = subjects
      </Text>
      {weekDays.map((d) => {
        const list = sessions.filter((s) => s.date === d).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
        const done = list.filter((s) => s.status === 'completed').length;
        const isToday = d === today;
        return (
          <Pressable
            key={d}
            onPress={() => onPickDay(d)}
            style={({ pressed }) => ({
              backgroundColor: isToday ? '#EEF2FF' : '#FFFFFF',
              borderWidth: 1,
              borderColor: isToday ? '#C7D2FE' : '#E2E8F0',
              borderRadius: radius.md,
              padding: 12,
              marginBottom: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#1E293B', flex: 1 }}>
                {dayjs(d).format('ddd · DD MMM')} {isToday ? '· TODAY' : ''}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: done === list.length && list.length ? '#059669' : '#64748B' }}>
                {done}/{list.length} done
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {list.length ? (
                list.slice(0, 5).map((s) => (
                  <View
                    key={s.id}
                    style={{
                      backgroundColor: subjectColor(s.subject) + (s.status === 'completed' ? '33' : '1F'),
                      borderWidth: 1,
                      borderColor: subjectColor(s.subject) + (s.status === 'completed' ? '55' : '99'),
                      borderRadius: 7,
                      paddingVertical: 3,
                      paddingHorizontal: 8,
                      marginRight: 6,
                      marginBottom: 6,
                    }}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, color: '#1E293B', flexShrink: 1 }}>
                      {s.start_time} {s.topic || s.subject}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8' }}>Rest day / no quests</Text>
              )}
              {list.length > 5 ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#94A3B8', alignSelf: 'center' }}>
                  +{list.length - 5} more
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------- MONTHLY ----------------
function MonthlyView({ monthOffset, setMonthOffset, sessions, onPickDay }) {
  const base = dayjs().add(monthOffset, 'month').startOf('month');
  const startWeekday = (base.day() + 6) % 7; // Monday-first
  const daysInMonth = base.daysInMonth();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(base.date(d));

  const byDate = {};
  for (const s of sessions) {
    (byDate[s.date] = byDate[s.date] || []).push(s);
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <NavArrow dir="left" onPress={() => setMonthOffset((m) => m - 1)} />
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B' }}>
          {base.format('MMMM YYYY')}
        </Text>
        <NavArrow dir="right" onPress={() => setMonthOffset((m) => m + 1)} />
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: fonts.bodyMedium, fontSize: 11, color: '#94A3B8' }}>
            {d}
          </Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={i} style={{ width: '14.28%', height: 54 }} />;
          const d = dateStr(cell);
          const list = byDate[d] || [];
          const hasMock = list.some((s) => s.session_type === 'mock');
          const hasRevision = list.some((s) => s.session_type === 'revision');
          const allDone = list.length && list.every((s) => s.status === 'completed');
          const isToday = d === todayStr();
          return (
            <Pressable
              key={i}
              onPress={() => onPickDay(d)}
              style={{
                width: '14.28%',
                height: 54,
                alignItems: 'center',
                paddingTop: 6,
                borderRadius: 8,
                backgroundColor: hasMock ? '#FFF7ED' : hasRevision ? '#ECFEFF' : 'transparent',
                borderWidth: isToday ? 1.5 : 0,
                borderColor: '#818CF8',
              }}
            >
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: isToday ? '#4F46E5' : '#334155' }}>
                {cell.date()}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                {list.slice(0, 3).map((s) => (
                  <View
                    key={s.id}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      marginHorizontal: 1,
                      backgroundColor: allDone ? '#10B981' : subjectColor(s.subject),
                    }}
                  />
                ))}
                {hasMock ? <Text style={{ fontSize: 8 }}>📝</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
        <Legend color="#F59E0B" label="Mock day" />
        <Legend color="#0891B2" label="Revision week" />
        <Legend color="#10B981" label="All done" />
        <Legend color="#7C3AED" label="Study quest" />
      </View>
    </View>
  );
}

function Legend({ color, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color, marginRight: 5 }} />
      <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B' }}>{label}</Text>
    </View>
  );
}

// ---------------- helpers ----------------
function HeaderBtn({ icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
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
      <Ionicons name={icon} size={19} color="#6D28D9" />
    </Pressable>
  );
}

function NavArrow({ dir, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={{ padding: 8 }}>
      <Ionicons name={dir === 'left' ? 'chevron-back' : 'chevron-forward'} size={20} color="#64748B" />
    </Pressable>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 7 }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B' }}>{value}</Text>
    </View>
  );
}

function AddBlockModal({ visible, onClose, userId, defaultDate, onAdded }) {
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [type, setType] = useState('study');
  const [startTime, setStartTime] = useState('18:00');
  const [minutes, setMinutes] = useState('45');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      const m = Math.max(15, Number(minutes) || 45);
      const endTime = dayjs(`2000-01-01 ${startTime}`).add(m, 'minute').format('HH:mm');
      await db.insert('schedule', {
        user_id: userId,
        date: defaultDate,
        start_time: startTime,
        end_time: endTime,
        subject: subject.trim(),
        topic: topic.trim() || subject.trim(),
        session_type: type,
        status: 'pending',
        duration_minutes: m,
        priority: 'normal',
        created_at: nowIso(),
      });
      setSubject('');
      setTopic('');
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Add Quest / Time Block" mode="light">
      <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Physics" />
      <Input label="Topic" value={topic} onChangeText={setTopic} placeholder="e.g. Rotational Motion" />
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#64748B', marginBottom: 8 }}>
        Session type
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Object.entries(SESSION_TYPES).map(([key, t]) => (
          <Chip key={key} label={`${t.icon} ${t.label}`} selected={type === key} onPress={() => setType(key)} mode="light" small />
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Input label="Start (HH:MM)" value={startTime} onChangeText={setStartTime} placeholder="18:00" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="numeric" />
        </View>
      </View>
      <Button title="Add Quest" mode="light" onPress={save} loading={busy} disabled={!subject.trim()} />
    </ModalSheet>
  );
}
