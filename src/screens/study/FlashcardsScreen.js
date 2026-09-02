// FLASHCARDS — deck list per subject/topic with due counts and
// mastery. Manual card creation (AI deck generation arrives in
// Layer 4 via Professor Byte).
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { aiGenerateFlashcards, AIUnavailableError } from '../../lib/aiFeatures';
import { aiStatus } from '../../lib/aiService';
import { fonts, radius } from '../../config/theme';
import { groupBy, subjectColor, nowIso } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

export function FlashcardsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [cards, setCards] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiForm, setAiForm] = useState({ subject: '', topic: '', count: '8' });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [form, setForm] = useState({ front: '', back: '', subject: '', topic: '', type: 'qa' });
  const preSubject = route?.params?.subject;
  const preTopic = route?.params?.topic;

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('flashcards', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false } });
    setCards(rows);
  }, [profile?.id]);

  const onBack = useHubBack(navigation, 'StudyHub');
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addCard = async () => {
    if (!form.front.trim() || !form.back.trim()) return;
    await db.insert('flashcards', {
      user_id: profile.id,
      subject: (form.subject || preSubject || 'General').trim(),
      topic: (form.topic || preTopic || 'Mixed').trim(),
      front_text: form.front.trim(),
      back_text: form.back.trim(),
      card_type: form.type,
      mastery_level: 0,
      next_review: new Date().toISOString(),
      times_reviewed: 0,
      created_at: new Date().toISOString(),
    });
    await awardXP('FLASHCARD_CREATE');
    setForm({ front: '', back: '', subject: form.subject, topic: form.topic, type: 'qa' });
    setAddOpen(false);
    await load();
  };

  const generateDeck = async () => {
    const subject = (aiForm.subject || preSubject || '').trim();
    const topic = (aiForm.topic || preTopic || '').trim();
    if (!subject || !topic || aiBusy) return;
    setAiBusy(true);
    setAiMsg('');
    try {
      const cards = await aiGenerateFlashcards({
        subject,
        topic,
        count: Math.max(4, Math.min(15, Number(aiForm.count) || 8)),
        profileContext: [profile?.class_level, profile?.board].filter(Boolean).join(', '),
      });
      const rows = cards.map((c) => ({
        user_id: profile.id,
        subject,
        topic,
        front_text: c.front_text,
        back_text: c.back_text,
        card_type: c.card_type,
        mastery_level: 0,
        next_review: nowIso(),
        times_reviewed: 0,
        created_at: nowIso(),
      }));
      await db.insertMany('flashcards', rows);
      setAiMsg(`Shaabaash! ${rows.length} cards ban gaye. Deck kholo aur shuru karo! 🃏`);
      await load();
    } catch (e) {
      setAiMsg(e instanceof AIUnavailableError ? e.message : 'Deck generate nahi ho paya. Thodi der baad try karo.');
    } finally {
      setAiBusy(false);
    }
  };

  if (!cards) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Flashcards" onBack={onBack} />
        <Loading mode="light" />
      </Screen>
    );
  }

  // build decks: subject -> topic -> [cards]
  const decks = [];
  const bySubject = groupBy(cards, (c) => c.subject || 'General');
  for (const [subject, subjCards] of Object.entries(bySubject)) {
    const byTopic = groupBy(subjCards, (c) => c.topic || 'Mixed');
    for (const [topic, topicCards] of Object.entries(byTopic)) {
      decks.push({
        key: `${subject}::${topic}`,
        subject,
        topic,
        cards: topicCards,
        due: topicCards.filter((c) => !c.next_review || new Date(c.next_review) <= new Date()).length,
        mastered: topicCards.filter((c) => (c.mastery_level || 0) >= 4).length,
      });
    }
  }
  decks.sort((a, b) => b.due - a.due || a.subject.localeCompare(b.subject));

  const totalDue = decks.reduce((a, d) => a + d.due, 0);

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Flashcards"
        subtitle={totalDue ? `${totalDue} cards due for revision 🃏` : 'Decks ready — spaced repetition ON'}
        onBack={onBack}
        right={
          <View style={{ flexDirection: 'row' }}>
            <Pressable onPress={() => setAiOpen(true)} hitSlop={8} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7, marginRight: 8 }}>
              <Ionicons name="sparkles-outline" size={19} color="#0891B2" />
            </Pressable>
            <Pressable onPress={() => setAddOpen(true)} hitSlop={8} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7 }}>
              <Ionicons name="add" size={19} color="#6D28D9" />
            </Pressable>
          </View>
        }
      />

      {decks.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🃏</Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', textAlign: 'center' }}>
            No decks yet
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 14, lineHeight: 18 }}>
            Pehla card banao (front = question, back = answer).{'\n'}AI deck generation Layer 4 mein aayega — Professor Byte!
          </Text>
          <Button title="Create a Card" size="sm" mode="light" onPress={() => setAddOpen(true)} />
        </Card>
      ) : (
        decks.map((d) => {
          const color = subjectColor(d.subject);
          return (
            <Card
              key={d.key}
              mode="light"
              onPress={() => navigation.navigate('Deck', { subject: d.subject, topic: d.topic })}
              style={{ marginBottom: 10 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 5, height: 44, borderRadius: 3, backgroundColor: color, marginRight: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>
                    {d.topic}
                  </Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    {d.subject} · {d.cards.length} cards · {d.mastered} mastered
                  </Text>
                </View>
                {d.due > 0 ? (
                  <View style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, marginRight: 10 }}>
                    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: '#DC2626' }}>{d.due} due</Text>
                  </View>
                ) : (
                  <View style={{ backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, marginRight: 10 }}>
                    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: '#059669' }}>✓</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </View>
            </Card>
          );
        })
      )}

      {/* AI deck generation */}
      <ModalSheet visible={aiOpen} onClose={() => setAiOpen(false)} title="Generate Deck with AI ✨" mode="light">
        <Input label="Subject" value={aiForm.subject || preSubject || ''} onChangeText={(v) => setAiForm({ ...aiForm, subject: v })} placeholder="e.g. Physics" />
        <Input label="Topic / chapter" value={aiForm.topic || preTopic || ''} onChangeText={(v) => setAiForm({ ...aiForm, topic: v })} placeholder="e.g. Thermodynamics" />
        <Input label="How many cards? (4–15)" value={aiForm.count} onChangeText={(v) => setAiForm({ ...aiForm, count: v })} keyboardType="numeric" />
        {!aiStatus().anyConfigured ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#D97706', lineHeight: 17, marginBottom: 10 }}>
            ⚠️ No AI key set — add a Gemini/Groq key in Settings to use this. Manual card creation always works!
          </Text>
        ) : null}
        {aiMsg ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#0891B2', lineHeight: 18, marginBottom: 10 }}>{aiMsg}</Text>
        ) : null}
        <Button
          title={aiBusy ? 'Professor Byte likh raha hai…' : 'Generate Deck 🪄'}
          mode="light"
          loading={aiBusy}
          onPress={generateDeck}
          disabled={!aiForm.subject && !preSubject}
        />
      </ModalSheet>

      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title="New Flashcard" mode="light">
        <Input label="Subject" value={form.subject || preSubject || ''} onChangeText={(v) => setForm({ ...form, subject: v })} placeholder="e.g. Physics" />
        <Input label="Topic / chapter" value={form.topic || preTopic || ''} onChangeText={(v) => setForm({ ...form, topic: v })} placeholder="e.g. Thermodynamics" />
        <Input label="Front (question / prompt)" value={form.front} onChangeText={(v) => setForm({ ...form, front: v })} placeholder="What is the first law of thermodynamics?" multiline />
        <Input label="Back (answer)" value={form.back} onChangeText={(v) => setForm({ ...form, back: v })} placeholder="Energy can neither be created nor…" multiline />
        <Button title="Save Card (+10 XP)" mode="light" onPress={addCard} disabled={!form.front.trim() || !form.back.trim()} />
      </ModalSheet>
    </Screen>
  );
}
