// Settings — AI provider & keys, notifications, account, local data.
import { useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Input } from '../../components/ui/Input';
import { SectionTitle } from '../../components/ui/EmptyState';
import { fonts, radius } from '../../config/theme';
import { askAI, AIUnavailableError } from '../../lib/aiService';
import { infoAlert, confirmAlert } from '../../lib/alert';
import { wipeLocalData } from '../../lib/db';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../../config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

export function SettingsScreen({ navigation }) {
  const { profile, signOut, cloudMode, updateProfile } = useAuth();
  const settings = useSettings();
  const [geminiKey, setGeminiKey] = useState(settings.geminiKey || '');
  const [groqKey, setGroqKey] = useState(settings.groqKey || '');
  const [reminderTime, setReminderTime] = useState(settings.dailyReminder || '20:00');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [examDate, setExamDate] = useState(profile?.exam_date || '');

  const saveAI = () => {
    settings.update({ geminiKey: geminiKey.trim(), groqKey: groqKey.trim() });
    setTestResult('Saved! ✅');
  };

  const testAI = async () => {
    setTesting(true);
    setTestResult('');
    try {
      const reply = await askAI({
        prompt: 'Say hello to a student in max 12 words, Hinglish flavor, one emoji.',
        noCache: true,
      });
      setTestResult(`Professor Byte: "${reply.trim().slice(0, 120)}"`);
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
      <ScreenHeader title="Settings" subtitle="Apna game, apne rules" onBack={() => navigation.goBack()} />

      {/* AI */}
      <SectionTitle mode="light">🤖 AI — Professor Byte</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginBottom: 12, lineHeight: 18 }}>
          Pick the default provider. If it fails, StudentOS automatically tries the other one. Keys can also come from
          .env (EXPO_PUBLIC_GEMINI_API_KEY / EXPO_PUBLIC_GROQ_API_KEY).
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
            title={testing ? 'Testing…' : 'Test AI'}
            size="sm"
            variant="secondary"
            mode="light"
            onPress={testAI}
            loading={testing}
            style={{ flex: 1 }}
          />
        </View>
        {testResult ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#0891B2', marginTop: 10, lineHeight: 17 }}>
            {testResult}
          </Text>
        ) : null}
      </Card>

      {/* Profile basics */}
      <SectionTitle mode="light">🎯 Exam & Study Setup</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <Input
          label="Exam date (YYYY-MM-DD)"
          value={examDate}
          onChangeText={setExamDate}
          placeholder="2027-05-24"
          hint="Smart schedule + auto deadlines isse use karte hain."
        />
        <Button title="Save Exam Date" size="sm" mode="light" onPress={saveExamDate} />
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
          <Input label="Time (HH:MM)" value={reminderTime} onChangeText={setReminderTime} placeholder="20:00" style={{ marginTop: 10 }} />
        ) : null}
      </Card>

      {/* Data & account */}
      <SectionTitle mode="light">🗄️ Data & Account</SectionTitle>
      <Card mode="light" style={{ marginBottom: 16 }}>
        <Row label="Mode" value={cloudMode ? '☁️ Cloud (Supabase)' : '📱 Local (this device only)'} />
        <Row label="Username" value={profile?.username || '—'} />
        <Row label="Class" value={profile?.class_level || '—'} />
        <Row label="Total XP" value={String(profile?.total_xp || 0)} />
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
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B' }}>{value}</Text>
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
