// PROFESSOR BYTE — AI tutor chat. Explains, solves, quizzes,
// summarizes, plans and motivates. All AI goes through aiService.
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { aiTutorReply, aiMotivate, AIUnavailableError } from '../../lib/aiFeatures';
import { isOnline } from '../../lib/aiService';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Chip } from '../../components/ui/Chip';
import { Loading } from '../../components/ui/EmptyState';
import { LIGHT, GAMER, fonts, radius } from '../../config/theme';

const QUICK = [
  { key: 'explain', label: '📖 Explain a topic', prompt: 'Explain ' },
  { key: 'quiz', label: '🧠 Quiz me', prompt: 'Quiz me on 5 questions from my syllabus. Ask one at a time.' },
  { key: 'summarize', label: '📝 Summarize', prompt: 'Summarize ' },
  { key: 'plan', label: '🗺️ Plan my week', prompt: 'Plan my study week. ' },
  { key: 'motivate', label: '🔥 Motivate me', prompt: '__MOTIVATE__' },
];

export function TutorScreen({ navigation, route }) {
  useTheme('light');
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const prefill = route?.params?.prefill;

  const chatKey = `sos.chat.${profile?.id || 'guest'}`;

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(chatKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setMessages(parsed);
    } catch {
      setMessages([]);
    }
  }, [chatKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (prefill && messages) {
      setInput(prefill);
      navigation.setParams({ prefill: undefined });
    }
  }, [prefill, messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (msgs) => {
    setMessages(msgs);
    try {
      await AsyncStorage.setItem(chatKey, JSON.stringify(msgs.slice(-60)));
    } catch {
      /* ignore */
    }
  };

  const context = [
    profile?.class_level,
    profile?.board,
    profile?.competitive_exam !== 'None' && profile?.competitive_exam ? `preparing for ${profile.competitive_exam}` : '',
    profile?.prep_level,
  ]
    .filter(Boolean)
    .join(', ');

  const send = async (rawText) => {
    const text = String(rawText || input).trim();
    if (!text || busy) return;
    setInput('');
    const userMsg = { role: 'user', content: text, ts: Date.now() };
    const history = messages || [];
    await persist([...history, userMsg]);
    setBusy(true);
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 100);
    try {
      let reply;
      if (text === '__MOTIVATE__') {
        reply = await aiMotivate({ name: profile?.display_name || 'champ', streak: profile?.current_streak || 0, context });
      } else {
        reply = await aiTutorReply({ history, message: text, context });
      }
      await persist([...history, userMsg, { role: 'assistant', content: reply, ts: Date.now() }]);
    } catch (e) {
      const msg =
        e instanceof AIUnavailableError
          ? e.message
          : 'Thodi technical gadbad. Dobara try karo — main yahin hoon! 🤖';
      await persist([...history, userMsg, { role: 'assistant', content: msg, error: true, ts: Date.now() }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 150);
    }
  };

  if (messages === null) {
    return (
      <View style={{ flex: 1, backgroundColor: LIGHT.bg, paddingTop: insets.top + 8 }}>
        <ScreenHeader title="Professor Byte" onBack={() => navigation.goBack()} />
        <Loading mode="light" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: LIGHT.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={{ paddingTop: insets.top + 8, flex: 1 }}>
        <ScreenHeader
          title="Professor Byte 🤖"
          subtitle="Explain · Solve · Quiz · Summarize · Plan · Motivate"
          onBack={() => navigation.goBack()}
          right={
            <Pressable onPress={() => persist([])} hitSlop={8} style={{ padding: 6 }}>
              <Ionicons name="refresh-outline" size={20} color="#64748B" />
            </Pressable>
          }
        />

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <Text style={{ fontSize: 52 }}>🤖</Text>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: LIGHT.text, marginTop: 14 }}>
                Namaste! Professor Byte reporting 🫡
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: LIGHT.subtext, textAlign: 'center', marginTop: 8, lineHeight: 19, paddingHorizontal: 12 }}>
                Kuch bhi poocho — concept samjhaana, problem solve karna, quiz karna, ya thoda motivation. Chalo shuru karein?
              </Text>
            </View>
          ) : (
            messages.map((m, i) => <Bubble key={i} m={m} />)
          )}
          {busy ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: LIGHT.card, borderRadius: 16, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: LIGHT.subtext }}>Byte soch raha hai… 💭</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* quick actions */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          {QUICK.map((q) => (
            <Chip key={q.key} label={q.label} small onPress={() => (q.prompt.endsWith(' ') ? setInput(q.prompt) : send(q.prompt))} mode="light" />
          ))}
        </ScrollView>

        {/* input */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingHorizontal: 12,
            paddingTop: 6,
            paddingBottom: insets.bottom + 10,
            backgroundColor: LIGHT.surface,
            borderTopWidth: 1,
            borderTopColor: LIGHT.border,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Poocho kuch bhi…"
            placeholderTextColor={LIGHT.subtext}
            multiline
            style={{
              flex: 1,
              fontFamily: fonts.body,
              fontSize: 14.5,
              color: LIGHT.text,
              backgroundColor: LIGHT.card,
              borderWidth: 1,
              borderColor: LIGHT.border,
              borderRadius: radius.lg,
              paddingHorizontal: 14,
              paddingTop: 10,
              paddingBottom: 10,
              maxHeight: 110,
              marginRight: 8,
            }}
            onSubmitEditing={() => send()}
          />
          <Pressable
            onPress={() => send()}
            disabled={busy || !input.trim()}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: input.trim() && !busy ? LIGHT.primary : LIGHT.card,
              borderWidth: 1,
              borderColor: input.trim() && !busy ? LIGHT.primary : LIGHT.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="send" size={19} color={input.trim() && !busy ? '#FFF' : LIGHT.subtext} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m }) {
  const isUser = m.role === 'user';
  return (
    <View style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '86%', marginBottom: 8 }}>
      <View
        style={{
          backgroundColor: m.error ? '#FEF2F2' : isUser ? LIGHT.primary : LIGHT.card,
          borderWidth: 1,
          borderColor: m.error ? '#FECACA' : isUser ? LIGHT.primary : LIGHT.border,
          borderRadius: 16,
          borderBottomRightRadius: isUser ? 4 : 16,
          borderBottomLeftRadius: isUser ? 16 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 14,
            lineHeight: 21,
            color: m.error ? '#991B1B' : isUser ? '#FFF' : LIGHT.text,
          }}
        >
          {m.content}
        </Text>
      </View>
      {!isUser ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 9.5, color: LIGHT.subtext, marginLeft: 6, marginTop: 2 }}>
          Professor Byte {m.error ? '· offline' : ''}
        </Text>
      ) : null}
    </View>
  );
}
