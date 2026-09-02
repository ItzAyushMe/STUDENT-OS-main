// Syllabus Map — TRACK-SCOPED: "My Class" is the default map
// (highest priority), with optional "My Olympiad" and "My Exam"
// layers. Subjects → chapters with status, weightage stars,
// progress, per-track import and AI generation.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { db } from '../../lib/db';
import { seedSyllabusTrack } from '../../lib/starterData';
import { aiGenerateSyllabus, AIUnavailableError } from '../../lib/aiFeatures';
import { TRACKS, pickSyllabusSet, CLASS_SYLLABI, EXAM_SYLLABI, OLYMPIAD_SYLLABI } from '../../data/syllabusData';
import { SUBJECT_COLORS } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { pct, subjectColor, nowIso } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

const STATUS_ICON = { completed: '✅', in_progress: '🔄', locked: '🔒' };

// rows saved before tracks existed belong to the class map
const rowTrack = (r) => (r.track === 'olympiad' || r.track === 'exam' ? r.track : 'class');

export function SyllabusScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTrack, setActiveTrack] = useState('class');
  const [openSubject, setOpenSubject] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newChapter, setNewChapter] = useState('');
  const [newWeight, setNewWeight] = useState('3');
  const [newHours, setNewHours] = useState('6');

  // which tracks does this student have? (profile + any saved rows)
  const set = useMemo(() => pickSyllabusSet(profile || {}), [profile?.class_level, profile?.competitive_exam, profile?.olympiad]);
  const availableTracks = useMemo(() => {
    const t = ['class'];
    if (set.olympiad || rows.some((r) => rowTrack(r) === 'olympiad')) t.push('olympiad');
    if (set.exam || rows.some((r) => rowTrack(r) === 'exam')) t.push('exam');
    return t;
  }, [set, rows]);

  useEffect(() => {
    if (!availableTracks.includes(activeTrack)) setActiveTrack('class');
  }, [availableTracks]);

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

  const trackRows = useMemo(() => rows.filter((r) => rowTrack(r) === activeTrack), [rows, activeTrack]);

  const bySubject = useMemo(() => {
    const map = {};
    for (const r of trackRows) {
      (map[r.subject] = map[r.subject] || []).push(r);
    }
    for (const s of Object.keys(map)) {
      map[s].sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
    }
    // auto-open first subject of this track
    return map;
  }, [trackRows]);

  useEffect(() => {
    const subs = Object.keys(bySubject);
    setOpenSubject((prev) => (prev && subs.includes(prev) ? prev : subs[0] || null));
  }, [bySubject]);

  const addChapter = async () => {
    const subject = (newSubject || '').trim();
    const chapter = (newChapter || '').trim();
    if (!subject || !chapter) return;
    await db.insert('syllabus', {
      user_id: profile.id,
      subject,
      chapter,
      topic: null,
      subtopic: null,
      track: activeTrack,
      weightage: Math.max(1, Math.min(5, Number(newWeight) || 3)),
      estimated_hours: Math.max(0.5, Number(newHours) || 4),
      status: 'locked',
      progress_percent: 0,
      deadline: null,
      completed_at: null,
      created_at: nowIso(),
    });
    setNewChapter('');
    setAddOpen(false);
    await load();
  };

  const importPreset = async (preset, track) => {
    const rowsToInsert = preset.rows.map((r) => ({
      user_id: profile.id,
      subject: r.subject,
      chapter: r.chapter,
      topic: null,
      subtopic: null,
      track,
      weightage: r.weightage || 3,
      estimated_hours: r.estimated_hours || 4,
      status: 'locked',
      progress_percent: 0,
      deadline: null,
      completed_at: null,
      created_at: nowIso(),
    }));
    // avoid duplicate chapters for the same subject+track
    const existing = new Set(rows.filter((r) => rowTrack(r) === track).map((r) => `${r.subject}::${r.chapter}`));
    const fresh = rowsToInsert.filter((r) => !existing.has(`${r.subject}::${r.chapter}`));
    if (fresh.length) await db.insertMany('syllabus', fresh);
    setPresetOpen(false);
    await load();
  };

  // one-tap import of the student's OWN track (class-first!)
  const importMyTrack = async () => {
    await seedSyllabusTrack(profile.id, profile || {}, activeTrack);
    await load();
  };

  const generateWithAI = async () => {
    setAiBusy(true);
    setAiMsg('');
    try {
      const gen = await aiGenerateSyllabus({
        classLevel: profile?.class_level || 'Class 10',
        board: profile?.board || '',
        exam: activeTrack === 'exam' ? profile?.competitive_exam || '' : '',
        subjects: '',
      });
      const existing = new Set(rows.map((r) => `${r.subject}::${r.chapter}`));
      const fresh = gen
        .filter((r) => !existing.has(`${r.subject}::${r.chapter}`))
        .map((r) => ({
          user_id: profile.id,
          subject: r.subject,
          chapter: r.chapter,
          topic: null,
          subtopic: null,
          track: activeTrack,
          weightage: r.weightage,
          estimated_hours: r.estimated_hours,
          status: 'locked',
          progress_percent: 0,
          deadline: null,
          completed_at: null,
          created_at: nowIso(),
        }));
      if (fresh.length) await db.insertMany('syllabus', fresh);
      setAiMsg(`Shaabaash! ${fresh.length} chapters added by Professor Byte ✨`);
      setPresetOpen(false);
      await load();
    } catch (e) {
      setAiMsg(e instanceof AIUnavailableError ? e.message : 'AI syllabus nahi bana — presets try karo!');
    } finally {
      setAiBusy(false);
    }
  };

  const deleteRow = async (row) => {
    await db.remove('syllabus', row.id);
    await load();
  };

  const trackMeta = TRACKS[activeTrack];
  const trackDone = trackRows.filter((r) => r.status === 'completed').length;

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Syllabus Map"
        subtitle="Trophy count: chapters conquered"
        onBack={onBack}
        right={
          <View style={{ flexDirection: 'row' }}>
            <HeaderBtn icon="download-outline" onPress={() => setPresetOpen(true)} />
            <HeaderBtn icon="add" onPress={() => setAddOpen(true)} />
          </View>
        }
      />

      {/* Track switcher — CLASS is the default map */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        {availableTracks.map((t) => {
          const meta = TRACKS[t];
          const active = activeTrack === t;
          const count = rows.filter((r) => rowTrack(r) === t).length;
          return (
            <Pressable
              key={t}
              onPress={() => setActiveTrack(t)}
              style={({ pressed }) => ({
                backgroundColor: active ? '#6D28D9' : '#FFFFFF',
                borderWidth: 1,
                borderColor: active ? '#6D28D9' : '#E2E8F0',
                borderRadius: 999,
                paddingVertical: 8,
                paddingHorizontal: 14,
                marginRight: 8,
                flexDirection: 'row',
                alignItems: 'center',
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ fontSize: 13, marginRight: 5 }}>{meta.icon}</Text>
              <Text
                style={{
                  fontFamily: fonts.bodySemiBold,
                  fontSize: 13,
                  color: active ? '#FFF' : '#334155',
                }}
              >
                {meta.label}
              </Text>
              {count ? (
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: active ? '#EDE9FE' : '#94A3B8', marginLeft: 6 }}>
                  {count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 16 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', marginBottom: 10 }}>
          {activeTrack === 'class'
            ? 'Your class syllabus — the #1 priority. School ke exams isi se aayenge. 🏫'
            : activeTrack === 'olympiad'
            ? 'Olympiad track — second priority, class ke baad. 🏅'
            : 'Exam track — optional layer. Class + olympiad ke baad bachi hui time isi mein. 🎯'}
        </Text>
      </View>

      {loading ? null : trackRows.length === 0 ? (
        <Card mode="light">
          <EmptyState
            icon={trackMeta.icon}
            title={`${trackMeta.label} khali hai`}
            subtitle={
              set[activeTrack]
                ? `${set[activeTrack].label} import karo — one tap, ${set[activeTrack].rows.length} chapters.`
                : 'Apna khud ka chapter add karo, ya AI se generate karao.'
            }
            actionLabel={set[activeTrack] ? `Import ${set[activeTrack].label.split('·')[0].trim()}` : 'Add chapter'}
            onAction={() => (set[activeTrack] ? importMyTrack() : setAddOpen(true))}
          />
        </Card>
      ) : (
        Object.keys(bySubject).map((subject) => {
          const list = bySubject[subject] || [];
          const done = list.filter((r) => r.status === 'completed').length;
          const open = openSubject === subject;
          const color = subjectColor(subject);
          return (
            <View key={subject} style={{ marginBottom: 14 }}>
              <Pressable
                onPress={() => setOpenSubject(open ? null : subject)}
                style={({ pressed }) => ({
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#E2E8F0',
                  borderRadius: radius.lg,
                  padding: 14,
                  opacity: pressed ? 0.75 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                })}
              >
                <View style={{ width: 5, height: 42, borderRadius: 3, backgroundColor: color, marginRight: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#1E293B' }}>{subject}</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    {done}/{list.length} completed
                  </Text>
                  <ProgressBar progress={pct(done, list.length) / 100} mode="light" color={color} height={6} style={{ marginTop: 8 }} />
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#64748B" />
              </Pressable>

              {open ? (
                <View style={{ marginTop: 8, marginLeft: 6 }}>
                  {list.map((row) => (
                    <ChapterRow
                      key={row.id}
                      row={row}
                      onOpen={() =>
                        navigation.navigate('TopicDetail', {
                          rowId: row.id,
                          subject: row.subject,
                          chapter: row.chapter,
                        })
                      }
                      onDelete={() => deleteRow(row)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })
      )}

      {/* Add chapter modal */}
      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title={`Add Chapter → ${trackMeta.label}`} mode="light">
        <Input label="Subject" value={newSubject} onChangeText={setNewSubject} placeholder="e.g. Physics" />
        <Input label="Chapter / topic" value={newChapter} onChangeText={setNewChapter} placeholder="e.g. Thermodynamics" />
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Input label="Weightage (1–5)" value={newWeight} onChangeText={setNewWeight} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Est. hours" value={newHours} onChangeText={setNewHours} keyboardType="numeric" />
          </View>
        </View>
        <Button title="Add to Syllabus" onPress={addChapter} mode="light" disabled={!newSubject || !newChapter} />
      </ModalSheet>

      {/* Preset import modal — grouped by track */}
      <ModalSheet visible={presetOpen} onClose={() => setPresetOpen(false)} title="Import Syllabus" mode="light">
        {aiMsg ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#0891B2', marginBottom: 10, lineHeight: 18 }}>{aiMsg}</Text>
        ) : null}
        <Card
          mode="light"
          onPress={generateWithAI}
          style={{ marginBottom: 12, backgroundColor: '#ECFEFF', borderColor: '#A5F3FC' }}
        >
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#0891B2' }}>
            ✨ Generate with AI
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#475569', marginTop: 3 }}>
            {aiBusy
              ? 'Professor Byte syllabus bana raha hai…'
              : `For your class (${profile?.class_level || 'class'})${profile?.board ? `, ${profile.board}` : ''} — into "${trackMeta.label}"`}
          </Text>
        </Card>

        {/* Student's own presets first */}
        <SectionLabel>🏫 Your tracks</SectionLabel>
        {set.class ? (
          <Card mode="light" onPress={() => importPreset(set.class, 'class')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>{set.class.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {set.class.rows.length} chapters · {rows.filter((r) => rowTrack(r) === 'class').length ? 'already imported — duplicates skipped' : 'one tap'}
            </Text>
          </Card>
        ) : null}
        {set.olympiad ? (
          <Card mode="light" onPress={() => importPreset(set.olympiad, 'olympiad')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#B45309' }}>🏅 {set.olympiad.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {set.olympiad.rows.length} chapters · olympiad track
            </Text>
          </Card>
        ) : null}
        {set.exam ? (
          <Card mode="light" onPress={() => importPreset(set.exam, 'exam')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#B91C1C' }}>🎯 {set.exam.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {set.exam.rows.length} chapters · exam track (secondary)
            </Text>
          </Card>
        ) : null}

        {/* Full library */}
        <SectionLabel>📚 Full library (any track)</SectionLabel>
        {Object.entries(CLASS_SYLLABI).map(([name, preset]) => (
          <Card key={name} mode="light" onPress={() => importPreset(preset, 'class')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>{preset.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {preset.rows.length} chapters · class track
            </Text>
          </Card>
        ))}
        {Object.entries(OLYMPIAD_SYLLABI).map(([name, preset]) => (
          <Card key={name} mode="light" onPress={() => importPreset(preset, 'olympiad')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#B45309' }}>🏅 {preset.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {preset.rows.length} chapters · olympiad track
            </Text>
          </Card>
        ))}
        {Object.entries(EXAM_SYLLABI).map(([name, preset]) => (
          <Card key={name} mode="light" onPress={() => importPreset(preset, 'exam')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#B91C1C' }}>🎯 {preset.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {preset.rows.length} chapters · exam track
            </Text>
          </Card>
        ))}
      </ModalSheet>
    </Screen>
  );
}

function SectionLabel({ children }) {
  return (
    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#94A3B8', marginTop: 6, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Text>
  );
}

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

function ChapterRow({ row, onOpen, onDelete }) {
  const icon = STATUS_ICON[row.status] || '🔒';
  const high = (row.weightage || 0) >= 5;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: radius.md,
        padding: 12,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 18, marginRight: 10 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.bodyMedium,
              fontSize: 14,
              color: '#1E293B',
              flex: 1,
              textDecorationLine: row.status === 'completed' ? 'line-through' : 'none',
            }}
          >
            {row.chapter}
          </Text>
          {high ? <Text style={{ fontSize: 12, marginLeft: 6 }}>⭐</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          {row.status === 'in_progress' ? (
            <>
              <ProgressBar progress={(row.progress_percent || 0) / 100} mode="light" height={5} style={{ flex: 1, marginRight: 8, borderWidth: 0, backgroundColor: '#F1F5F9' }} color="#0891B2" />
              <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#0891B2' }}>{row.progress_percent || 0}%</Text>
            </>
          ) : (
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B' }}>
              {row.estimated_hours || 4} hrs{row.deadline ? ` · due ${row.deadline}` : ''}
            </Text>
          )}
        </View>
      </View>
      <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 6, marginLeft: 4 }}>
        <Ionicons name="trash-outline" size={16} color="#CBD5E1" />
      </Pressable>
    </Pressable>
  );
}
