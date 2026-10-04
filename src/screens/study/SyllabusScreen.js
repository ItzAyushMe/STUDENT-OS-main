// Syllabus Map — TRACK-SCOPED: "My Class" is the default map
// (highest priority), with optional "My Olympiad" and "My Exam"
// layers. Subjects → chapters with status, weightage stars,
// progress, per-track import and AI generation.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useAuth } from '../../context/AuthContext';
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
import { infoAlert } from '../../lib/alert';
import { seedSyllabusTrack, importPresetRows } from '../../lib/starterData';
import { aiGenerateSyllabus, aiEstimateWeightage, AIUnavailableError } from '../../lib/aiFeatures';
import { TRACKS, pickSyllabusSet, CLASS_SYLLABI, EXAM_SYLLABI, OLYMPIAD_SYLLABI } from '../../data/syllabusData';
import { SUBJECT_COLORS, isArchivedRow, activeSyllabusRows } from '../../config/constants';
import { fonts, radius } from '../../config/theme';
import { pct, subjectColor, nowIso } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';
import { useSettings } from '../../context/SettingsContext';
import { computeTaughtTill, buildTaughtTillUpdates, toggleRowPatch } from '../../lib/taughtTill';

const STATUS_ICON = { completed: '✅', in_progress: '🔄', locked: '🔒' };

// rows saved before tracks existed belong to the class map
const rowTrack = (r) => (r.track === 'olympiad' || r.track === 'exam' ? r.track : 'class');

export function SyllabusScreen({ navigation }) {
  const { profile } = useAuth();
  const settings = useSettings();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTrack, setActiveTrack] = useState('class');
  const [openSubject, setOpenSubject] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  // FIX-S S5 (PO decision 3): archived Class 10 history lives in its own
  // COLLAPSIBLE section — never mixed into the active map, its counts or trophies
  const [archivedOpen, setArchivedOpen] = useState(false);
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

  // FIX-S S5: ARCHIVED rows are history. They are filtered out of everything that
  // drives progress, trophies, subject cards and the planner — only the archived
  // section below shows them.
  const trackRows = useMemo(
    () => activeSyllabusRows(rows).filter((r) => rowTrack(r) === activeTrack),
    [rows, activeTrack]
  );
  const archivedTrackRows = useMemo(
    () => rows.filter((r) => isArchivedRow(r) && rowTrack(r) === activeTrack),
    [rows, activeTrack]
  );
  const archivedBySubject = useMemo(() => {
    const map = {};
    for (const r of archivedTrackRows) (map[r.subject] = map[r.subject] || []).push(r);
    return map;
  }, [archivedTrackRows]);

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
    try {
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
        // FIX-SESSION D14: tag carry-through — write class_level if profile or track provides it
        ...(activeTrack === 'class' && profile?.class_level ? { class_level: profile.class_level } : {}),
      });
      setNewChapter('');
      setAddOpen(false);
      await load();
    } catch (e) {
      infoAlert('Syllabus save fail hua', e?.message || 'Chapter add nahi ho paya — dobara try karo');
    }
  };

  // FIX-S S5 (NEW Y note): the preset import is no longer screen-local. It lives in
  // lib/starterData.importPresetRows so the promotion accept path and this screen
  // dedupe IDENTICALLY — and so an ARCHIVED Class 10 row can never swallow a fresh
  // Class 11 chapter that happens to share its subject::chapter name.
  const importPreset = async (preset, track) => {
    try {
      const res = await importPresetRows(profile.id, preset, track, { existing: rows });
      setPresetOpen(false);
      await load();
      setAiMsg(
        res.inserted
          ? `✅ ${res.inserted} chapter import hue — ${preset?.label || track}${res.skipped ? ` · ${res.skipped} duplicate skip` : ''}`
          : `Sab ${res.skipped} chapter pehle se imported hain (archived rows duplicate nahi maane jaate).`
      );
    } catch (e) {
      infoAlert('Syllabus import fail hua', e?.message || 'Preset import nahi ho paya — dobara try karo');
    }
  };

  const importMyTrack = async () => {
    try {
      await seedSyllabusTrack(profile.id, profile || {}, activeTrack);
      await load();
    } catch (e) {
      infoAlert('Syllabus import fail hua', e?.message || 'My track import nahi ho paya');
    }
  };

  // FIX-SCHED8 D6: AI weightage estimator — batches ≤10, zero writes on failure, reasons briefly shown
  const estimateWeightage = async () => {
    if (!profile?.id) return;
    setAiBusy(true);
    setAiMsg('');
    try {
      const trackRowsForEst = rows.filter(r => rowTrack(r) === activeTrack && !isArchivedRow(r));
      if (!trackRowsForEst.length) {
        setAiMsg('No chapters to estimate — import syllabus first');
        return;
      }
      const results = await aiEstimateWeightage({ syllabusRows: trackRowsForEst, profile: profile || {} });
      if (!results.length) {
        setAiMsg('AI could not estimate — try again');
        return;
      }
      // Map results to existing rows by subject+chapter
      const updates = [];
      const reasons = [];
      for (const res of results) {
        const match = trackRowsForEst.find(r => r.subject === res.subject && r.chapter === res.chapter);
        if (match) {
          const w = Math.max(1, Math.min(5, Number(res.weightage) || 3));
          updates.push({ id: match.id, patch: { weightage: w } });
          if (res.reason) reasons.push(`${res.subject} — ${res.chapter}: ${w}★ — ${res.reason}`);
        }
      }
      if (!updates.length) {
        setAiMsg('No matching chapters found for AI results');
        return;
      }
      // ZERO writes on failure: only write after all batches succeeded (aiEstimateWeightage already succeeded)
      await db.updateMany('syllabus', updates);
      await load();
      setAiMsg(`✨ Weightage updated for ${updates.length} chapters:\n` + reasons.slice(0, 10).join('\n'));
    } catch (e) {
      const msg = e instanceof AIUnavailableError ? e.message : e?.message || 'AI weightage estimate fail hua';
      setAiMsg(msg);
      infoAlert('AI weightage fail', msg);
      // ZERO writes on failure — we did not call updateMany yet
    } finally {
      setAiBusy(false);
    }
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
      // FIX-S S5: archived rows never count as duplicates
      const existing = new Set(
        rows.filter((r) => rowTrack(r) === activeTrack && !isArchivedRow(r)).map((r) => `${r.subject}::${r.chapter}`)
      );
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
      const msg = e instanceof AIUnavailableError ? e.message : e?.message || 'AI syllabus nahi bana — presets try karo!';
      setAiMsg(msg);
      infoAlert('AI syllabus fail hua', msg);
    } finally {
      setAiBusy(false);
    }
  };

  const deleteRow = async (row) => {
    await db.remove('syllabus', row.id);
    await load();
  };

  // FIX-SCHED4 D2: taught-till slider per subject + individual toggle, last-action-wins, no DDL
  const handleTaughtTill = async (subject, list, newTill) => {
    try {
      const updates = buildTaughtTillUpdates(list, newTill, nowIso());
      if (updates.length) {
        await db.updateMany('syllabus', updates);
        await load();
      }
    } catch (e) {
      infoAlert('Taught-till update fail', e?.message || 'Slider update nahi ho paya');
    }
  };

  const handleToggleRow = async (row) => {
    try {
      const patch = toggleRowPatch(row, nowIso());
      await db.update('syllabus', row.id, patch);
      await load();
    } catch (e) {
      infoAlert('Toggle fail', e?.message || 'Chapter toggle nahi ho paya');
    }
  };

  const trackMeta = TRACKS[activeTrack] || TRACKS.class;
  const trackDone = trackRows.filter((r) => r.status === 'completed').length;

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Syllabus Map"
        subtitle="Trophy count: chapters conquered"
        onBack={onBack}
        right={
          <View style={{ flexDirection: 'row' }}>
            <HeaderBtn icon="sparkles-outline" onPress={estimateWeightage} />
            <HeaderBtn icon="download-outline" onPress={() => setPresetOpen(true)} />
            <HeaderBtn icon="add" onPress={() => setAddOpen(true)} />
          </View>
        }
      />

      {/* Track switcher — CLASS is the default map */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        {availableTracks.map((t) => {
          const meta = TRACKS[t] || TRACKS.class;
          const active = activeTrack === t;
          const count = rows.filter((r) => rowTrack(r) === t && !isArchivedRow(r)).length; // FIX-S S5
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
        {aiMsg ? (
          <Pressable onPress={() => setAiMsg('')} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#0891B2', lineHeight: 16 }}>{aiMsg}</Text>
          </Pressable>
        ) : null}
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
                ? `${(set[activeTrack].label || trackMeta.label)} import karo — one tap, ${set[activeTrack].rows.length} chapters.`
                : 'Apna khud ka chapter add karo, ya AI se generate karao.'
            }
            actionLabel={set[activeTrack] ? `Import ${(set[activeTrack].label || trackMeta.label).split('·')[0].trim()}` : 'Add chapter'}
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
                  {/* FIX-SCHED4 D2: taught-till slider per subject — uses existing fields, no DDL, last-action-wins */}
                  <View style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: 10, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#334155' }}>
                        Taught till: {computeTaughtTill(list)}/{list.length}
                      </Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#64748B' }}>
                        {computeTaughtTill(list) === list.length ? 'All done ✅' : `${list.length - computeTaughtTill(list)} left`}
                      </Text>
                    </View>
                    <Slider
                      style={{ width: '100%', height: 30 }}
                      minimumValue={0}
                      maximumValue={list.length}
                      step={1}
                      value={computeTaughtTill(list)}
                      minimumTrackTintColor={color}
                      maximumTrackTintColor="#E2E8F0"
                      thumbTintColor={color}
                      onSlidingComplete={(v) => handleTaughtTill(subject, list, v)}
                    />
                    <Text style={{ fontFamily: fonts.body, fontSize: 10, color: '#94A3B8', marginTop: 2, lineHeight: 13 }}>
                      Slider = first N chapters taught. Individual toggle below overrides — last action wins. No DDL, uses status/progress/completed_at.
                    </Text>
                  </View>
                  {list.map((row) => (
                    <ChapterRow
                      key={row.id}
                      row={row}
                      onToggle={() => handleToggleRow(row)}
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

      {/* FIX-S S5 (PO decision 3): collapsible "Class 10 · Archived" — read-only
          history. It is deliberately NOT part of trackRows, so progress bars,
          trophy counts, deadlines and the planner all ignore it. */}
      {archivedTrackRows.length ? (
        <View style={{ marginBottom: 14 }}>
          <Pressable
            onPress={() => setArchivedOpen((o) => !o)}
            style={({ pressed }) => ({
              backgroundColor: '#F8FAFC',
              borderWidth: 1,
              borderColor: '#E2E8F0',
              borderRadius: radius.lg,
              padding: 14,
              opacity: pressed ? 0.75 : 1,
              flexDirection: 'row',
              alignItems: 'center',
            })}
          >
            <Text style={{ fontSize: 18, marginRight: 10 }}>🗄️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#64748B' }}>
                Class 10 · Archived — {archivedTrackRows.length} chapters
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', marginTop: 2, lineHeight: 16 }}>
                Purana class map, history ki tarah safe. Progress, trophy, deadlines aur schedule par zero asar.
              </Text>
            </View>
            <Ionicons name={archivedOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#94A3B8" />
          </Pressable>

          {archivedOpen ? (
            <View
              style={{
                marginTop: 8,
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E2E8F0',
                borderRadius: radius.lg,
                padding: 12,
              }}
            >
              {Object.entries(archivedBySubject).map(([subject, list]) => {
                const done = list.filter((r) => r.status === 'completed').length;
                return (
                  <View key={subject} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                      <View style={{ width: 4, height: 14, borderRadius: 2, backgroundColor: subjectColor(subject), marginRight: 8 }} />
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#475569', flex: 1 }}>{subject}</Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#94A3B8' }}>{done}/{list.length} conquered</Text>
                    </View>
                    {list.map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingLeft: 12 }}>
                        <Text style={{ fontSize: 11, marginRight: 6 }}>{STATUS_ICON[r.status] || '🗄️'}</Text>
                        <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: '#94A3B8' }}>{r.chapter}</Text>
                        {r.progress_percent ? (
                          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#CBD5E1' }}>{r.progress_percent}%</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                );
              })}
              <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#CBD5E1', marginTop: 4, lineHeight: 15 }}>
                Archived rows delete nahi hote — ye tumhara record hai. Naya plan sirf active chapters se banta hai.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

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
              {set.class.rows.length} chapters · {rows.filter((r) => rowTrack(r) === 'class' && !isArchivedRow(r)).length ? 'already imported — duplicates skipped' : 'one tap'}
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

function ChapterRow({ row, onOpen, onDelete, onToggle }) {
  const icon = STATUS_ICON[row.status] || '🔒';
  const high = (row.weightage || 0) >= 5;
  // FIX-MULT D15: per-track EMPHASIS — order, not size (effective = base × weightage factor only)
  let settings;
  try { settings = useSettings(); } catch { settings = { hoursMultiplier: 2.0, olympiadMultiplier: 3.0, examMultiplier: 2.0 }; }
  const base = Number(row.estimated_hours) || 4;
  const track = row.track || 'class';
  let mult = 1;
  if (track === 'class') mult = settings?.hoursMultiplier ?? 2.0;
  else if (track === 'olympiad') mult = settings?.olympiadMultiplier ?? 3.0;
  else if (track === 'exam') mult = settings?.examMultiplier ?? 2.0;
  const w = Math.max(1, Math.min(5, Number(row.weightage) || 3));
  const wf = 1 + (w - 3) * 0.1;
  const effective = base * wf;
  const hoursLine = `Base ~${base}h → Effective ~${effective.toFixed(1)}h (w${w} ${wf.toFixed(1)}×) · Emphasis ${track} ${mult}× order only (D15)${row.deadline ? ` · due ${row.deadline}` : ''}`;
  const isDone = String(row.status).toLowerCase() === 'completed';
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: isDone ? '#BBF7D0' : '#E2E8F0',
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
            numberOfLines={2}
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
              {hoursLine}
            </Text>
          )}
        </View>
      </View>
      {/* FIX-SCHED4 D2: individual toggle — done/new, last-action-wins */}
      <Pressable onPress={onToggle} hitSlop={8} style={{ backgroundColor: isDone ? '#DCFCE7' : '#F1F5F9', borderWidth: 1, borderColor: isDone ? '#86EFAC' : '#E2E8F0', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, marginLeft: 6 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 10.5, color: isDone ? '#15803D' : '#64748B' }}>{isDone ? 'Done ✓' : 'New'}</Text>
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 6, marginLeft: 4 }}>
        <Ionicons name="trash-outline" size={16} color="#CBD5E1" />
      </Pressable>
    </Pressable>
  );
}
