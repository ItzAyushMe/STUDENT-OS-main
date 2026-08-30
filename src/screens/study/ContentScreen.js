// CONTENT LOCKER — notes, links, YouTube refs with optional AI
// summaries (AI summarize arrives with Layer 4; data model ready).
import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { aiSummarizeContent, AIUnavailableError } from '../../lib/aiFeatures';
import { aiStatus } from '../../lib/aiService';
import { CONTENT_TYPES } from '../../config/constants';
import { fonts } from '../../config/theme';
import { nowIso } from '../../lib/utils';

export function ContentScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('All');
  const [addOpen, setAddOpen] = useState(false);
  const [aiBusyId, setAiBusyId] = useState(null);
  const [aiMsg, setAiMsg] = useState('');
  const [form, setForm] = useState({ kind: 'note', title: '', body: '', subject: '' });

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('content', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false } });
    setItems(rows);
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const detectType = (url) => {
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|webp)(\?|$)/.test(u)) return 'image';
    if (/\.(mp3|wav|m4a)(\?|$)/.test(u)) return 'audio';
    return 'link';
  };

  const add = async () => {
    if (!form.title.trim()) return;
    const type = form.kind === 'link' ? detectType(form.body) : 'note';
    await db.insert('content', {
      user_id: profile.id,
      title: form.title.trim(),
      type,
      url: form.kind === 'link' ? form.body.trim() : null,
      text: form.kind === 'note' ? form.body.trim() : null,
      subject: form.subject.trim() || null,
      topic: null,
      ai_summary: null,
      file_size: null,
      created_at: nowIso(),
    });
    await awardXP('NOTE_CREATE');
    setForm({ kind: 'note', title: '', body: '', subject: '' });
    setAddOpen(false);
    await load();
  };

  const remove = async (item) => {
    await db.remove('content', item.id);
    await load();
  };

  const summarize = async (item) => {
    if (!item.text || aiBusyId) return;
    setAiBusyId(item.id);
    setAiMsg('');
    try {
      const summary = await aiSummarizeContent({ title: item.title, text: item.text });
      await db.update('content', item.id, { ai_summary: summary });
      await load();
    } catch (e) {
      setAiMsg(e instanceof AIUnavailableError ? e.message : 'Summary nahi ban paya. Baad mein try karo.');
    } finally {
      setAiBusyId(null);
    }
  };

  const open = (item) => {
    if (item.url) Linking.openURL(item.url).catch(() => {});
  };

  if (!items) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Content Locker" onBack={() => navigation.goBack()} />
        <Loading mode="light" />
      </Screen>
    );
  }

  const types = ['All', ...Object.keys(CONTENT_TYPES)];
  const shown = filter === 'All' ? items : items.filter((i) => i.type === filter);

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Content Locker"
        subtitle="Notes, links, YouTube — sab ek jagah"
        onBack={() => navigation.goBack()}
        right={
          <Pressable onPress={() => setAddOpen(true)} hitSlop={8} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7 }}>
            <Ionicons name="add" size={19} color="#6D28D9" />
          </Pressable>
        }
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {types.map((t) => (
          <Chip
            key={t}
            label={t === 'All' ? 'All' : `${CONTENT_TYPES[t].icon} ${CONTENT_TYPES[t].label}`}
            small
            selected={filter === t}
            onPress={() => setFilter(t)}
            mode="light"
          />
        ))}
      </View>
      {aiMsg ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#0891B2', marginBottom: 10, lineHeight: 18 }}>{aiMsg}</Text>
      ) : null}

      {shown.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🗂️</Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', textAlign: 'center' }}>
            Locker khali hai
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Notes, PDF links, YouTube playlists — yahan store karo. +5 XP per save.
          </Text>
          <Button title="Add Something" size="sm" mode="light" onPress={() => setAddOpen(true)} />
        </Card>
      ) : (
        shown.map((item) => {
          const t = CONTENT_TYPES[item.type] || CONTENT_TYPES.note;
          return (
            <Card key={item.id} mode="light" onPress={item.url ? () => open(item) : undefined} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 24, marginRight: 12 }}>{t.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>
                    {item.title}
                  </Text>
                  {item.subject ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#6D28D9', marginTop: 2 }}>{item.subject}</Text>
                  ) : null}
                  {item.text ? (
                    <Text numberOfLines={2} style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginTop: 5, lineHeight: 18 }}>
                      {item.text}
                    </Text>
                  ) : null}
                  {item.url ? (
                    <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#0891B2', marginTop: 5 }}>
                      {item.url}
                    </Text>
                  ) : null}
                  {item.ai_summary ? (
                    <View style={{ backgroundColor: '#F0FDFA', borderRadius: 8, padding: 8, marginTop: 8 }}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#0891B2', marginBottom: 3 }}>🤖 AI Summary</Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#134E4A', lineHeight: 17 }}>{item.ai_summary}</Text>
                    </View>
                  ) : null}
                  <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 6 }}>
                    {String(item.created_at || '').slice(0, 10)}
                  </Text>
                </View>
                {item.text && !item.ai_summary ? (
                  <Pressable onPress={() => summarize(item)} disabled={aiBusyId === item.id} hitSlop={8} style={{ padding: 6 }}>
                    <Ionicons name={aiBusyId === item.id ? 'hourglass-outline' : 'sparkles-outline'} size={16} color="#0891B2" />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => remove(item)} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={16} color="#CBD5E1" />
                </Pressable>
              </View>
            </Card>
          );
        })
      )}

      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add to Locker" mode="light">
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          <Chip label="📝 Note" selected={form.kind === 'note'} onPress={() => setForm({ ...form, kind: 'note' })} mode="light" />
          <Chip label="🔗 Link / URL" selected={form.kind === 'link'} onPress={() => setForm({ ...form, kind: 'link' })} mode="light" />
        </View>
        <Input label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="e.g. Thermodynamics — Priya Ma'am notes" />
        <Input
          label={form.kind === 'note' ? 'Note text' : 'URL'}
          value={form.body}
          onChangeText={(v) => setForm({ ...form, body: v })}
          placeholder={form.kind === 'note' ? 'Likho ya paste karo…' : 'https://…'}
          multiline={form.kind === 'note'}
        />
        <Input label="Subject (optional)" value={form.subject} onChangeText={(v) => setForm({ ...form, subject: v })} placeholder="Physics" />
        <Button title="Save (+5 XP)" mode="light" onPress={add} disabled={!form.title.trim() || (form.kind === 'link' && !form.body.trim())} />
      </ModalSheet>
    </Screen>
  );
}
