// Settings — AI provider & keys, notifications, account, local data.
import { useEffect, useState } from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Input, Stepper } from '../../components/ui/Input';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Chip } from '../../components/ui/Chip';
import { SectionTitle } from '../../components/ui/EmptyState';
import { fonts, radius } from '../../config/theme';
import { askAI, AIUnavailableError } from '../../lib/aiService';
import { infoAlert, confirmAlert } from '../../lib/alert';
import { db, wipeLocalData } from '../../lib/db';
import { supabase, SUPABASE_URL } from '../../lib/supabase';
import { normalizePriorities } from '../../lib/scheduleGenerator';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../../config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useHubBack } from '../../hooks/useHubBack';

export function SettingsScreen({ navigation }) {
  const { profile, signOut, cloudMode, updateProfile } = useAuth();
  const onBack = useHubBack(navigation, 'HomeMain');
  const settings = useSettings();
  const [geminiKey, setGeminiKey] = useState(settings.geminiKey || '');
  const [groqKey, setGroqKey] = useState(settings.groqKey || '');
  const [reminderTime, setReminderTime] = useState(settings.dailyReminder || '20:00');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [examDate, setExamDate] = useState(profile?.exam_date || '');
  const [olympiadDate, setOlympiadDate] = useState(profile?.olympiad_date || '');
  const [dailyHours, setDailyHours] = useState(Number(profile?.daily_study_hours) || 3);
  const [schoolExams, setSchoolExams] = useState(
    Array.isArray(profile?.school_exams)
      ? profile.school_exams.map((e) => ({
          label: e.label || '',
          exact: Boolean(e.exact || (e.date && !e.start_date)),
          date: e.date || '',
          start_date: e.start_date || e.date || '',
          end_date: e.end_date || e.start_date || e.date || '',
        }))
      : []
  );
  const [priorities, setPriorities] = useState(() =>
    normalizePriorities(profile?.priorities || null)
  );
  const [lastError, setLastError] = useState(null);
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newTrackSubjects, setNewTrackSubjects] = useState([]); // subjects claimed by the custom track
  const [syllabusSubjects, setSyllabusSubjects] = useState([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    try {
      const raw = Platform.OS === 'web' ? window.localStorage.getItem('sos.lastError') : null;
      if (raw) setLastError(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // BUG 3: metadata for core AND custom priority tracks
  const trackMeta = (t) => {
    if (t === 'class') return { icon: '🏫', name: 'School / Class' };
    if (t === 'exam') return { icon: '🎯', name: 'Competitive Exam' };
    if (t === 'olympiad') return { icon: '🏅', name: 'Olympiad' };
    return { icon: '⭐', name: priorities.custom?.[t]?.name || 'Custom track' };
  };

  const openAddTrack = async () => {
    setNewTrackName('');
    setNewTrackSubjects([]);
    try {
      const rows = await db.list('syllabus', { eq: { user_id: profile.id } });
      setSyllabusSubjects([...new Set(rows.map((r) => r.subject).filter(Boolean))]);
    } catch {
      setSyllabusSubjects([]);
    }
    setAddTrackOpen(true);
  };

  const addCustomTrack = () => {
    const name = newTrackName.trim();
    if (!name) return;
    const id = `custom:${Date.now().toString(36)}`;
    setPriorities((p) =>
      normalizePriorities({
        ...p,
        order: [...p.order, id],
        timeSplit: { ...p.timeSplit, [id]: 10 },
        custom: { ...(p.custom || {}), [id]: { name, subjects: newTrackSubjects } },
      })
    );
    setAddTrackOpen(false);
  };

  const removeCustomTrack = (id, name) => {
    confirmAlert(
      `Remove "${name}"?`,
      'Is track ka time split wapas baaki tracks ko mil jayega. Schedule pe asar tabhi hoga jab tum regenerate karoge.',
      () => {
        setPriorities((p) => {
          const custom = { ...(p.custom || {}) };
          delete custom[id];
          const order = p.order.filter((t) => t !== id);
          const timeSplit = { ...p.timeSplit };
          delete timeSplit[id];
          return normalizePriorities({ ...p, order, timeSplit, custom });
        });
      },
      'Remove'
    );
  };

  // v1.0.6 recovery I + Y Round3: delete my account — honest reporting, no silent success
  const deleteAccount = () => {
    confirmAlert(
      'Delete your account?',
      'Saara data mit jayega: quests, XP, streaks, notes, friends — sab kuch. Ye undo nahi hota.',
      () => {
        confirmAlert(
          'Last chance!',
          'Data erase ho jayega. Continue?',
          async () => {
            setDeleting(true);
            let lastErr = null;
            const failedTables = [];
            let edgeFailed = false;
            let edgeError = '';
            try {
              if (cloudMode && profile?.id) {
                const tablesByUserId = [
                  'xp_events', 'mood_logs', 'workout_logs', 'content', 'flashcards',
                  'quiz_results', 'schedule', 'deadlines', 'syllabus', 'habit_logs',
                  'habits', 'focus_sessions', 'leaderboard', 'friends',
                ];
                for (const t of tablesByUserId) {
                  try {
                    await db.removeWhere(t, { user_id: profile.id });
                  } catch (e) {
                    console.warn(`[deleteAccount] failed to delete ${t} by user_id:`, e?.message);
                    lastErr = e;
                    failedTables.push(`${t}(${e?.message || 'error'})`);
                  }
                }
                try {
                  await db.removeWhere('friends', { friend_id: profile.id });
                } catch (e) {
                  console.warn('[deleteAccount] failed to delete friends by friend_id:', e?.message);
                  lastErr = e;
                  failedTables.push(`friends(friend_id): ${e?.message || 'error'}`);
                }
                try {
                  const { error } = await supabase.from('users').delete().eq('id', profile.id);
                  if (error) throw error;
                } catch (e) {
                  console.warn('[deleteAccount] failed to delete users row:', e?.message);
                  lastErr = e;
                  failedTables.push(`users: ${e?.message || 'error'}`);
                }

                // Edge Function to delete auth user (service-role)
                try {
                  const { data: authData } = await supabase.auth.getSession();
                  const token = authData?.session?.access_token;
                  if (token) {
                    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({ user_id: profile.id }),
                    });
                    if (!res.ok) {
                      const txt = await res.text().catch(() => '');
                      console.warn('[deleteAccount] Edge Function failed:', res.status, txt);
                      edgeFailed = true;
                      edgeError = `${res.status} ${txt}`.slice(0, 200);
                    }
                  } else {
                    edgeFailed = true;
                    edgeError = 'No session token';
                  }
                } catch (e) {
                  console.warn('[deleteAccount] Edge Function call failed (not deployed?):', e?.message);
                  edgeFailed = true;
                  edgeError = e?.message || 'Edge call failed';
                }

                // Y Round3: honesty BEFORE signOut
                if (failedTables.length || edgeFailed) {
                  const msg = [
                    failedTables.length ? `Kuch tables delete nahi ho paye: ${failedTables.join(', ')}` : '',
                    edgeFailed ? `Login delete nahi ho paya (Edge Function): ${edgeError || 'not deployed'}. Data delete ho gaya, lekin login delete nahi ho paya — support se baat karo ya Supabase Dashboard se auth user delete karo.` : '',
                  ].filter(Boolean).join('\n\n');
                  // show alert BEFORE wipe/signout so user sees truth
                  infoAlert('Delete partially completed', msg);
                }
              }
              await wipeLocalData();
              try { await AsyncStorage.removeItem('sos.session'); } catch { /* ignore */ }
              await signOut();
              if (lastErr) {
                console.warn('[deleteAccount] completed with failures:', failedTables, edgeError);
              }
            } catch (e) {
              console.error('[deleteAccount] unexpected error:', e);
              infoAlert('Delete failed', e?.message || 'Kuch gadbad ho gayi — dobara try karo.');
            } finally {
              setDeleting(false);
            }
          },
          'Delete forever',
          true
        );
      },
      'Delete',
      true
    );
  };

  const clearLastError = () => {
    try {
      if (Platform.OS === 'web') window.localStorage.removeItem('sos.lastError');
    } catch {
      /* ignore */
    }
    setLastError(null);
  };

  const saveAI = () => {
    settings.update({ geminiKey: geminiKey.trim(), groqKey: groqKey.trim() });
    setTestResult('Saved! ✅');
  };

  // Always save the pasted keys before testing — no "forgot to save" moments.
  const testAI = async () => {
    setTesting(true);
    setTestResult('');
    try {
      await settings.update({ geminiKey: geminiKey.trim(), groqKey: groqKey.trim() });
      const reply = await askAI({
        prompt: 'Say hello to a student in max 12 words, Hinglish flavor, one emoji.',
        noCache: true,
      });
      setTestResult(`Professor Byte: "${reply.trim().slice(0, 120)}"`);
      if (settings.refreshAIHealth) settings.refreshAIHealth();
    } catch (e) {
      setTestResult(e instanceof AIUnavailableError ? e.message : `Failed: ${e?.message || 'unknown'}`);
    } finally {
      setTesting(false);
    }
  };

  const toggleReminder = async (enabled) => {
    if (enabled) {
      if (Platform.OS === 'web') {
        infoAlert('Web limitation', 'Daily reminders work on Android/iOS builds. Web pe notifications abhi support nahi karte.');
        return;
      }
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          infoAlert('Permission needed', 'Notification permission denied hai — Settings app se allow karo.');
          return;
        }
        await scheduleReminder(reminderTime);
        settings.update({ dailyReminder: reminderTime });
      } catch (e) {
        infoAlert('Hmm', `Reminder set nahi ho paya: ${e?.message}`);
      }
    } else {
      if (Platform.OS !== 'web') await Notifications.cancelAllScheduledNotificationsAsync();
      settings.update({ dailyReminder: null });
    }
  };

  const saveExamDate = () => {
    updateProfile({ exam_date: examDate || null });
    setTestResult('Exam date saved ✅');
  };

  return (
    <Screen mode="light">
      <ScreenHeader title="Settings" subtitle="Apna game, apne rules" onBack={onBack} />

      {/* AI */}
      <SectionTitle mode="light">🤖 AI — Professor Byte</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginBottom: 8, lineHeight: 18 }}>
          No key yet? Get a FREE one in 30 seconds:{' '}
          <Text style={{ color: '#6D28D9', fontFamily: fonts.bodyMedium }}>aistudio.google.com/apikey</Text> (Gemini){' '}
          or <Text style={{ color: '#6D28D9', fontFamily: fonts.bodyMedium }}>console.groq.com/keys</Text> (Groq).
          Paste it below and tap Test AI — it saves automatically.
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View
            style={{
              backgroundColor: settings.aiStatus.anyConfigured ? '#ECFDF5' : '#FEF2F2',
              borderWidth: 1,
              borderColor: settings.aiStatus.anyConfigured ? '#A7F3D0' : '#FECACA',
              borderRadius: 999,
              paddingVertical: 4,
              paddingHorizontal: 10,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 11, marginRight: 5 }}>{settings.aiStatus.anyConfigured ? '✅' : '⚠️'}</Text>
            <Text
              style={{
                fontFamily: fonts.bodyMedium,
                fontSize: 11.5,
                color: settings.aiStatus.anyConfigured ? '#059669' : '#DC2626',
              }}
            >
              {settings.aiStatus.anyConfigured ? `AI ON · ${settings.aiStatus.provider} ready` : 'AI OFF — no key saved yet'}
            </Text>
          </View>
        </View>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginBottom: 12, lineHeight: 18 }}>
          Pick the default provider. If it fails, StudentOS automatically tries the other one.
        </Text>
        <SegmentedControl
          options={[
            { key: 'gemini', label: 'Gemini (2.0 Flash)' },
            { key: 'groq', label: 'Groq (Llama 3.3)' },
          ]}
          value={settings.effectiveProvider}
          onChange={(p) => settings.update({ aiProvider: p })}
          mode="light"
          style={{ marginBottom: 14 }}
        />
        <Input
          label="Gemini API key (aistudio.google.com/apikey)"
          value={geminiKey}
          onChangeText={setGeminiKey}
          placeholder="AIza…"
          secureTextEntry
        />
        <Input
          label="Groq API key (console.groq.com/keys)"
          value={groqKey}
          onChangeText={setGroqKey}
          placeholder="gsk_…"
          secureTextEntry
        />
        <View style={{ flexDirection: 'row' }}>
          <Button title="Save keys" size="sm" mode="light" onPress={saveAI} style={{ flex: 1, marginRight: 8 }} />
          <Button
            title={testing ? 'Testing…' : 'Save & Test AI'}
            size="sm"
            variant="secondary"
            mode="light"
            onPress={testAI}
            loading={testing}
            style={{ flex: 1.4 }}
          />
        </View>
        {testResult ? (
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 12,
              color: testResult.startsWith('Professor Byte') ? '#0891B2' : '#DC2626',
              marginTop: 10,
              lineHeight: 17,
            }}
          >
            {testResult}
          </Text>
        ) : null}
      </Card>

      {/* FIX B + BUG 3: priority order + weekly time split.
          All tracks ALWAYS visible — no hide button. 0% = skip.
          Custom tracks can be added (claiming subjects) and removed. */}
      <SectionTitle mode="light">🎚️ Priority & Time Split</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginBottom: 10, lineHeight: 17 }}>
          Kaunsa pehle? Order set karo (↑↓) aur time split do (%). 0% = skip — scheduler uss track ko chhod dega.
          {priorities.order.some((t) => t.startsWith('custom:')) ? ' Custom tracks apne subjects claim karte hain.' : ''}
        </Text>
        {priorities.order.map((track, i) => {
          const meta = trackMeta(track);
          const isCustom = track.startsWith('custom:');
          const claimed = isCustom && priorities.custom?.[track]?.subjects?.length
            ? ` · subjects: ${priorities.custom[track].subjects.join(', ')}`
            : '';
          const pct = priorities.timeSplit[track] || 0;
          const barColor = track === 'class' ? '#7C3AED' : track === 'olympiad' ? '#F59E0B' : track === 'exam' ? '#EF4444' : '#0D9488';
          return (
            <View key={track} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: '#94A3B8', fontFamily: fonts.bodySemiBold, width: 18 }}>{i + 1}.</Text>
              <Text style={{ fontSize: 17, marginRight: 8 }}>{meta.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13.5, color: pct === 0 ? '#94A3B8' : '#1E293B' }}>
                  {meta.name}
                  {pct === 0 ? ' (skipped)' : ''}
                </Text>
                {claimed ? (
                  <Text style={{ fontFamily: fonts.body, fontSize: 10, color: '#94A3B8', marginTop: 1 }} numberOfLines={1}>
                    {claimed.trim()}
                  </Text>
                ) : null}
                <View style={{ height: 5, backgroundColor: '#F1F5F9', borderRadius: 3, marginTop: 5, overflow: 'hidden' }}>
                  <View style={{ height: 5, width: `${Math.min(100, pct)}%`, backgroundColor: barColor }} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <StepBtn icon="remove" disabled={pct <= 0} onPress={() => setPriorities((p) => ({ ...p, timeSplit: { ...p.timeSplit, [track]: Math.max(0, pct - 5) } }))} />
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: '#334155', width: 38, textAlign: 'center' }}>{pct}%</Text>
                <StepBtn icon="add" disabled={pct >= 100} onPress={() => setPriorities((p) => ({ ...p, timeSplit: { ...p.timeSplit, [track]: Math.min(100, pct + 5) } }))} />
              </View>
              <View style={{ marginLeft: 4 }}>
                <Pressable
                  onPress={() =>
                    setPriorities((p) => {
                      const order = [...p.order];
                      const at = order.indexOf(track);
                      if (at > 0) {
                        order.splice(at, 1);
                        order.splice(at - 1, 0, track);
                      }
                      return { ...p, order };
                    })
                  }
                  hitSlop={6}
                  style={{ padding: 3 }}
                >
                  <Ionicons name="chevron-up" size={15} color={i === 0 ? '#E2E8F0' : '#6D28D9'} />
                </Pressable>
                <Pressable
                  onPress={() =>
                    setPriorities((p) => {
                      const order = [...p.order];
                      const at = order.indexOf(track);
                      if (at < order.length - 1) {
                        order.splice(at, 1);
                        order.splice(at + 1, 0, track);
                      }
                      return { ...p, order };
                    })
                  }
                  hitSlop={6}
                  style={{ padding: 3 }}
                >
                  <Ionicons name="chevron-down" size={15} color={i === priorities.order.length - 1 ? '#E2E8F0' : '#6D28D9'} />
                </Pressable>
              </View>
              {isCustom ? (
                <Pressable onPress={() => removeCustomTrack(track, meta.name)} hitSlop={6} style={{ padding: 4, marginLeft: 2 }}>
                  <Ionicons name="close-circle" size={17} color="#DC2626" />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Pressable onPress={openAddTrack} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 4, alignSelf: 'flex-start' }}>
          <Ionicons name="add-circle" size={17} color="#6D28D9" style={{ marginRight: 5 }} />
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#6D28D9' }}>Add custom track</Text>
        </Pressable>
        <Button
          title="Save Priorities"
          size="sm"
          mode="light"
          onPress={async () => {
            try {
              const norm = normalizePriorities(priorities);
              setPriorities(norm);
              await updateProfile({ priorities: norm });
              setTestResult('Priorities saved ✅');
              confirmAlert(
                'Regenerate schedule?',
                'Naye priorities schedule pe turant apply ho jayenge. Abhi regenerate karein?',
                () => navigation.navigate('StudyTab', { screen: 'Schedule', params: { autoRegen: true } }),
                'Regenerate'
              );
            } catch (e) {
              infoAlert('Priorities save fail hua', e?.message || 'Priorities save nahi ho paye — dobara try karo');
            }
          }}
          style={{ marginTop: 6 }}
        />
      </Card>

      {/* add custom track sheet */}
      <ModalSheet visible={addTrackOpen} onClose={() => setAddTrackOpen(false)} title="➕ Add custom track">
        <Input label="Track name (e.g. Physics Boost, Backlog, Revision)" value={newTrackName} onChangeText={setNewTrackName} placeholder="Physics Boost" />
        {syllabusSubjects.length ? (
          <>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#334155', marginTop: 12, marginBottom: 6 }}>
              Ye track kaunse subjects claim kare? (optional)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {syllabusSubjects.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  mode="light"
                  selected={newTrackSubjects.includes(s)}
                  onPress={() =>
                    setNewTrackSubjects((sel) => (sel.includes(s) ? sel.filter((x) => x !== s) : [...sel, s]))
                  }
                />
              ))}
            </View>
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 6, lineHeight: 15 }}>
              Claimed subjects is track ke budget mein aayenge — baaki sab apne original track mein.
            </Text>
          </>
        ) : null}
        <Button title="Add track" mode="light" onPress={addCustomTrack} disabled={!newTrackName.trim()} style={{ marginTop: 16 }} />
      </ModalSheet>

      {/* Profile basics */}
      <SectionTitle mode="light">🎯 Exam & Study Setup</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', marginBottom: 6 }}>Daily study hours</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable onPress={() => setDailyHours(h => Math.max(0.5, Math.round((h-0.5)*10)/10))} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ fontSize: 18, color: '#334155' }}>−</Text></Pressable>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', marginHorizontal: 14, minWidth: 50, textAlign: 'center' }}>{dailyHours} hrs</Text>
            <Pressable onPress={() => setDailyHours(h => Math.min(14, Math.round((h+0.5)*10)/10))} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ fontSize: 18, color: '#334155' }}>+</Text></Pressable>
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#64748B', marginTop: 6 }}>0.5 hr steps — schedule engine isse daily capacity banata hai</Text>
        </View>
        <Input
          label="Competitive exam date (YYYY-MM-DD)"
          value={examDate}
          onChangeText={setExamDate}
          placeholder="2027-05-24"
          hint="Smart schedule + auto deadlines isse use karte hain."
        />
        {(() => {
          const today = new Date().toISOString().slice(0,10);
          if (!examDate) {
            return <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#D97706', marginTop: 6, lineHeight: 15 }}>ℹ️ No exam date set — self-paced mode chalega, schedule 6 weeks rolling hoga. Exam date set karo for full-year planning.</Text>;
          }
          if (examDate < today) {
            return <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#DC2626', marginTop: 6, lineHeight: 15 }}>⚠️ Exam date past hai ({examDate}) — update karo, nahi to schedule purana lagega. Future date set karo.</Text>;
          }
          return null;
        })()}
        {profile?.olympiad && profile.olympiad !== 'None' ? (
          <Input
            label={`Olympiad date — ${profile.olympiad} (YYYY-MM-DD)`}
            value={olympiadDate}
            onChangeText={setOlympiadDate}
            placeholder="2026-11-15"
            style={{ marginTop: 10 }}
          />
        ) : null}

        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B', marginTop: 14, marginBottom: 4 }}>
          📅 My School Exams
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginBottom: 8, lineHeight: 16 }}>
          Mid-terms, finals… add them and the scheduler finishes your CLASS syllabus ~2 weeks before each one.
        </Text>
        {/* FIX-D3: saved school-exam ranges visible — summary card */}
        {profile?.school_exams && Array.isArray(profile.school_exams) && profile.school_exams.length ? (
          <View style={{ backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#166534', marginBottom: 6 }}>✅ Saved school exams ({profile.school_exams.length}) — visible to scheduler</Text>
            {profile.school_exams.map((e,i) => (
              <Text key={i} style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#15803D', lineHeight: 17 }}>
                • {e.label || 'School exam'}: {e.exact ? (e.date || e.start_date) : `${e.start_date || e.date || ''} → ${e.end_date || e.start_date || ''}`}{e.exact ? ' (exact)' : ' (range)'}
              </Text>
            ))}
            <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#64748B', marginTop: 6, lineHeight: 14 }}>Scheduler uses these ranges: class syllabus done 2 weeks before each range start, exam days = light revision only.</Text>
          </View>
        ) : (
          <View style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#B91C1C' }}>No school exams saved yet — add your mid-terms/finals below so scheduler can plan around them.</Text>
          </View>
        )}
        {(schoolExams || []).map((e, i) => (
          <View key={i} style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: 10, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Input
                  value={e.label}
                  onChangeText={(v) => setSchoolExams((prev) => prev.map((x, j) => (j === i ? { ...x, label: v } : x)))}
                  placeholder="e.g. Mid-Term / Pre-boards"
                />
              </View>
              <Pressable
                onPress={() => setSchoolExams((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={8}
                style={{ padding: 6, marginLeft: 4 }}
              >
                <Ionicons name="close-circle" size={20} color="#94A3B8" />
              </Pressable>
            </View>
            {e.exact ? (
              <Input
                value={e.date}
                onChangeText={(v) => setSchoolExams((prev) => prev.map((x, j) => (j === i ? { ...x, date: v } : x)))}
                placeholder="Exact date YYYY-MM-DD"
                keyboardType="numeric"
              />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Input
                    value={e.start_date}
                    onChangeText={(v) => setSchoolExams((prev) => prev.map((x, j) => (j === i ? { ...x, start_date: v } : x)))}
                    placeholder="From YYYY-MM-DD"
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    value={e.end_date}
                    onChangeText={(v) => setSchoolExams((prev) => prev.map((x, j) => (j === i ? { ...x, end_date: v } : x)))}
                    placeholder="To YYYY-MM-DD"
                    keyboardType="numeric"
                  />
                </View>
              </View>
            )}
            <Pressable
              onPress={() => setSchoolExams((prev) => prev.map((x, j) => (j === i ? { ...x, exact: !x.exact } : x)))}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}
              hitSlop={6}
            >
              <Ionicons name={e.exact ? 'checkbox' : 'square-outline'} size={16} color="#6D28D9" />
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11.5, color: '#475569', marginLeft: 6 }}>
                I know the exact date (range ki jagah)
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => setSchoolExams((prev) => [...prev, { label: '', start_date: '', end_date: '', exact: false }])}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: pressed ? '#EDE9FE' : '#F5F3FF',
            borderWidth: 1,
            borderColor: '#DDD6FE',
            marginBottom: 12,
          })}
        >
          <Ionicons name="add" size={15} color="#6D28D9" />
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#6D28D9', marginLeft: 6 }}>
            Add school exam (date range ya exact)
          </Text>
        </Pressable>

        <Button
          title="Save Exam Setup"
          size="sm"
          mode="light"
          onPress={async () => {
            try {
              const clean = schoolExams
                .map((e) => ({
                  label: (e.label || 'School exam').trim() || 'School exam',
                  exact: Boolean(e.exact),
                  ...(e.exact
                    ? { date: (e.date || '').trim() }
                    : { start_date: (e.start_date || '').trim(), end_date: (e.end_date || e.start_date || '').trim() }),
                }))
                .filter((e) => (e.exact ? /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') : /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || '')));
              setSchoolExams(clean);
              await updateProfile({
                exam_date: examDate || null,
                olympiad_date: olympiadDate || null,
                daily_study_hours: dailyHours,
                school_exams: clean,
                priorities: normalizePriorities(priorities),
              });
              setTestResult('Exam setup saved ✅');
            } catch (e) {
              infoAlert('Exam setup save fail hua', e?.message || 'Exam setup save nahi ho paya — dobara try karo');
            }
          }}
        />
      </Card>

      {/* Notifications */}
      <SectionTitle mode="light">🔔 Reminders</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B' }}>Daily evening reminder</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
              "Aaj ke quests complete kiye? 15 min padh lo, shaabaash!" — at {reminderTime}
            </Text>
          </View>
          <Switch
            value={Boolean(settings.dailyReminder)}
            onValueChange={toggleReminder}
            trackColor={{ true: '#6D28D9' }}
          />
        </View>
        {settings.dailyReminder ? (
          <Input
            label="Time (HH:MM)"
            value={reminderTime}
            onChangeText={setReminderTime}
            placeholder="20:00"
            style={{ marginTop: 10 }}
            onBlur={async () => {
              // L-2 (audit): editing the time used to do nothing until the
              // toggle was flipped — reschedule immediately on blur.
              if (!/^\d{1,2}:\d{2}$/.test(reminderTime)) return;
              try {
                if (Platform.OS !== 'web') await scheduleReminder(reminderTime);
                settings.update({ dailyReminder: reminderTime });
              } catch { /* keep the old schedule */ }
            }}
          />
        ) : null}
      </Card>

      {/* Data & account */}
      <SectionTitle mode="light">🗄️ Data & Account</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <Row label="Mode" value={cloudMode ? '☁️ Cloud (Supabase)' : '📱 Local (this device only)'} />
        <Row label="Username" value={profile?.username || '—'} />
        <Row label="Class" value={profile?.class_level || '—'} />
        <Row label="Total XP" value={String(profile?.total_xp || 0)} />
        {lastError ? (
          <View style={{ marginTop: 10, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: radius.md, padding: 10 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, color: '#B91C1C' }}>
              LAST APP ERROR ({new Date(lastError.ts).toLocaleString()}) — copy this when reporting bugs:
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#7F1D1D', marginTop: 4, lineHeight: 16 }}>{lastError.msg}</Text>
            <Pressable onPress={clearLastError} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 8, padding: 4 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11.5, color: '#6D28D9' }}>Clear</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <Button
            title="Reset local data"
            variant="secondary"
            size="sm"
            mode="light"
            style={{ flex: 1, marginRight: 8 }}
            onPress={() =>
              confirmAlert(
                'Reset local data?',
                'Ye is device ka saara StudentOS data mita dega. Cloud data safe rahega.',
                async () => {
                  await wipeLocalData();
                  await AsyncStorage.removeItem('sos.session');
                  await signOut();
                },
                'Reset',
                true
              )
            }
          />
          <Button
            title="Sign out"
            variant="danger"
            size="sm"
            mode="light"
            style={{ flex: 1 }}
            onPress={() =>
              confirmAlert('Sign out?', 'Progress cloud pe safe hai (local mode mein device pe).', signOut, 'Sign out')
            }
          />
        </View>
        <Button
          title={deleting ? 'Deleting…' : 'Delete my account'}
          variant="danger"
          size="sm"
          mode="light"
          disabled={deleting}
          onPress={deleteAccount}
          style={{ marginTop: 10 }}
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 6, lineHeight: 15, textAlign: 'center' }}>
          Double-confirm ke saath sab mita deta hai (cloud rows + local data). Login ID ko poora khatam karne ke liye Supabase dashboard se auth user bhi delete karo — on delete cascade sab clean kar dega.
        </Text>
      </Card>

      <Card mode="light" style={{ marginBottom: 20, backgroundColor: '#F8FAFC' }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', textAlign: 'center' }}>
          {APP_NAME} v{APP_VERSION}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 5, lineHeight: 17 }}>
          {APP_TAGLINE}{'\n'}Free for fellow students — made with ❤️ and chai.
        </Text>
      </Card>
    </Screen>
  );
}

function Row({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 7 }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', flex: 1 }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

async function scheduleReminder(hhmm) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const [h, m] = hhmm.split(':').map(Number);
  // Daily repeating trigger (Android + iOS)
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'StudentOS 🎮',
      body: 'Aaj ke quests complete kiye? 15 min padh lo — shaabaash! 💪',
    },
    trigger: { hour: h || 20, minute: m || 0, repeats: true, type: 'daily' },
  });
}

function StepBtn({ icon, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? '#F8FAFC' : pressed ? '#EDE9FE' : '#F1F5F9',
        borderWidth: 1,
        borderColor: disabled ? '#F1F5F9' : '#E2E8F0',
      })}
    >
      <Ionicons name={icon} size={15} color={disabled ? '#CBD5E1' : '#6D28D9'} />
    </Pressable>
  );
}
