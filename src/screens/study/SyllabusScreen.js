// Syllabus Map — subjects → chapters → topics with status,
// weightage stars, progress and add/import.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { EmptyState, SectionTitle } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { db } from '../../lib/db';
import { aiGenerateSyllabus, AIUnavailableError } from '../../lib/aiFeatures';
import { SYLLABUS_PRESETS, SUBJECT_COLORS } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { pct, subjectColor, nowIso } from '../../lib/utils';

const STATUS_ICON = { completed: '✅', in_progress: '🔄', locked: '🔒' };

export function SyllabusScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openSubject, setOpenSubject] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newChapter, setNewChapter] = useState('');
  const [newWeight, setNewWeight] = useState('3');
  const [newHours, setNewHours] = useState('6');
  const [subjects, setSubjects] = useState([]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const data = await db.list('syllabus', { eq: { user_id: profile.id } });
      setRows(data);
      const subs = [...new Set(data.map((r) => r.subject))].sort();
      setSubjects(subs);
      setOpenSubject((prev) => (prev && subs.includes(prev) ? prev : subs[0] || null));
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const bySubject = useMemo(() => {
    const map = {};
    for (const r of rows) {
      (map[r.subject] = map[r.subject] || []).push(r);
    }
    for (const s of Object.keys(map)) {
      map[s].sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
    }
    return map;
  }, [rows]);

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

  const importPreset = async (preset) => {
    const rowsToInsert = preset.rows.map((r) => ({
      user_id: profile.id,
      subject: r.subject,
      chapter: r.chapter,
      topic: null,
      subtopic: null,
      weightage: r.weightage || 3,
      estimated_hours: r.estimated_hours || 4,
      status: 'locked',
      progress_percent: 0,
      deadline: null,
      completed_at: null,
      created_at: nowIso(),
    }));
    // avoid duplicate chapters for the same subject
    const existing = new Set(rows.map((r) => `${r.subject}::${r.chapter}`));
    const fresh = rowsToInsert.filter((r) => !existing.has(`${r.subject}::${r.chapter}`));
    if (fresh.length) await db.insertMany('syllabus', fresh);
    setPresetOpen(false);
    await load();
  };

  const generateWithAI = async () => {
    setAiBusy(true);
    setAiMsg('');
    try {
      const gen = await aiGenerateSyllabus({
        classLevel: profile?.class_level || 'Class 10',
        board: profile?.board || '',
        exam: profile?.competitive_exam || '',
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

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Syllabus Map"
        subtitle="Trophy count: chapters conquered"
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row' }}>
            <HeaderBtn icon="download-outline" onPress={() => setPresetOpen(true)} />
            <HeaderBtn icon="add" onPress={() => setAddOpen(true)} />
          </View>
        }
      />

      {loading ? null : rows.length === 0 ? (
        <Card mode="light">
          <EmptyState
            icon="🗺️"
            title="Syllabus khali hai"
            subtitle="Import a starter syllabus (Class 10 CBSE, JEE PCM, NEET Bio…) ya apna khud ka chapter add karo."
            actionLabel="Import starter syllabus"
            onAction={() => setPresetOpen(true)}
          />
        </Card>
      ) : (
        subjects.map((subject) => {
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
      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add Chapter" mode="light">
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

      {/* Preset import modal */}
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
            {aiBusy ? 'Professor Byte syllabus bana raha hai…' : `Based on your class (${profile?.class_level || 'class'}), board & exam`}
          </Text>
        </Card>
        {Object.entries(SYLLABUS_PRESETS).map(([key, preset]) => (
          <Card key={key} mode="light" onPress={() => importPreset(preset)} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>{preset.label}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              {preset.rows.length} chapters · duplicates skipped
            </Text>
          </Card>
        ))}
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 6 }}>
          Tip: Professor Byte (AI) bhi syllabus generate kar sakta hai — Study Hub → Professor Byte.
        </Text>
      </ModalSheet>
    </Screen>
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
