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
import { FREE_LIBRARY, LIB_KIND_ICON, CLASS10_LIBRARY } from '../../data/contentLibrary';
import { fonts } from '../../config/theme';
import { nowIso } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

export function ContentScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('All');
  const [tab, setTab] = useState('locker'); // 'locker' | 'library'
  const [openSubject, setOpenSubject] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aiBusyId, setAiBusyId] = useState(null);
  const [aiMsg, setAiMsg] = useState('');
  const [form, setForm] = useState({ kind: 'note', title: '', body: '', subject: '' });

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('content', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false } });
    setItems(rows);
  }, [profile?.id]);

  const onBack = useHubBack(navigation, 'StudyHub');
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
      url: form.kind === 'link' ? normalizeUrl(form.body.trim()) : null,
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

  // BUG 5: user-typed links like "youtube.com/..." fail without a scheme.
  const normalizeUrl = (u) => {
    const s = String(u || '').trim();
    if (!s) return s;
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  };

  const open = (item) => {
    if (item.url) Linking.openURL(normalizeUrl(item.url)).catch(() => {});
  };

  if (!items) {
    return (
      <Screen mode="light">
        <ScreenHeader title="Content Locker" onBack={onBack} />
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
        onBack={onBack}
        right={
          <Pressable onPress={() => setAddOpen(true)} hitSlop={8} style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 7 }}>
            <Ionicons name="add" size={19} color="#6D28D9" />
          </Pressable>
        }
      />

      {/* Locker vs Free Library switcher */}
      <View style={{ flexDirection: 'row', marginBottom: 14 }}>
        <TabBtn label="🗂️ My Locker" active={tab === 'locker'} onPress={() => setTab('locker')} />
        <TabBtn label="📚 Free Library" active={tab === 'library'} onPress={() => setTab('library')} />
      </View>

      {tab === 'library' ? (
        <FreeLibrary openSubject={openSubject} setOpenSubject={setOpenSubject} onOpen={(url) => Linking.openURL(normalizeUrl(url)).catch(() => {})} />
      ) : (
      <>
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

      </>
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

function TabBtn({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 9,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: active ? '#6D28D9' : '#FFFFFF',
        borderWidth: 1,
        borderColor: active ? '#6D28D9' : '#E2E8F0',
        marginRight: 8,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: active ? '#FFF' : '#334155' }}>{label}</Text>
    </Pressable>
  );
}

// Pre-loaded FREE resources — notes, videos, PYQ banks, olympiad set.
// Nothing to set up; students can add their own on the My Locker tab.
function FreeLibrary({ openSubject, setOpenSubject, onOpen }) {
  const subjects = Object.keys(FREE_LIBRARY.subjects);
  return (
    <View>
      <Card mode="light" style={{ marginBottom: 14, backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#5B21B6' }}>
          📚 Free Library — kuch bhi setup nahi karna
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#6D28D9', marginTop: 4, lineHeight: 17 }}>
          Official NCERT/CBSE/NTA resources + best free teaching channels, subject-wise. Apne notes/links My Locker tab
          mein add karo.
        </Text>
      </Card>

      {FREE_LIBRARY.general.map((r, i) => (
        <Card key={`g${i}`} mode="light" onPress={() => onOpen(r.url)} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 22, marginRight: 12 }}>{LIB_KIND_ICON[r.kind] || '🔗'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B' }}>{r.title}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: 3, lineHeight: 16 }}>{r.desc}</Text>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, color: '#0891B2', marginTop: 5 }}>✅ FREE · {r.source}</Text>
            </View>
            <Ionicons name="open-outline" size={16} color="#CBD5E1" style={{ marginTop: 2 }} />
          </View>
        </Card>
      ))}

      {/* Class 10 CBSE — community-vetted best free teachers (v1.0.2) */}
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginTop: 6, marginBottom: 8 }}>
        🎓 Class 10 CBSE — best free teachers
      </Text>
      {CLASS10_LIBRARY.map((s) => (
        <Card key={`c10-${s.subject}`} mode="light" style={{ marginBottom: 10, backgroundColor: '#F0FDFA', borderColor: '#CCFBF1' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 19, marginRight: 9 }}>{s.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#0F766E' }}>{s.subject}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#0D9488', marginTop: 1 }}>⭐ Main: {s.teacher}</Text>
            </View>
          </View>
          {s.items.map((it, i) => (
            <Pressable
              key={i}
              onPress={() => onOpen(it.url)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: pressed ? '#E6FFFA' : '#FFFFFF',
                borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 9,
                paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6,
              })}
            >
              <Text style={{ fontSize: 15, marginRight: 9 }}>{LIB_KIND_ICON[it.kind] || '🔗'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#1E293B' }}>{it.title}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 10, color: '#64748B', marginTop: 1 }}>✅ FREE · {it.source}</Text>
              </View>
              <Ionicons name="open-outline" size={14} color="#CBD5E1" />
            </Pressable>
          ))}
        </Card>
      ))}

      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginTop: 6, marginBottom: 8 }}>
        Subject-wise chapters
      </Text>
      {subjects.map((subj) => {
        const open = openSubject === subj;
        return (
          <View key={subj} style={{ marginBottom: 10 }}>
            <Pressable
              onPress={() => setOpenSubject(open ? null : subj)}
              style={({ pressed }) => ({
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E2E8F0',
                borderRadius: 12,
                padding: 13,
                opacity: pressed ? 0.75 : 1,
                flexDirection: 'row',
                alignItems: 'center',
              })}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', flex: 1 }}>{subj}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#64748B" />
            </Pressable>
            {open
              ? FREE_LIBRARY.subjects[subj].map((ch, ci) => (
                  <View key={ci} style={{ marginLeft: 8, marginTop: 8 }}>
                    <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#475569', marginBottom: 6 }}>
                      {ch.chapter}
                    </Text>
                    {ch.items.map((it, ii) => (
                      <Pressable
                        key={ii}
                        onPress={() => onOpen(it.url)}
                        style={({ pressed }) => ({
                          backgroundColor: '#F8FAFC',
                          borderWidth: 1,
                          borderColor: '#E2E8F0',
                          borderRadius: 10,
                          padding: 10,
                          marginBottom: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontSize: 16, marginRight: 10 }}>{LIB_KIND_ICON[it.kind] || '🔗'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#1E293B' }}>{it.title}</Text>
                          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
                            ✅ FREE · {it.source}
                          </Text>
                        </View>
                        <Ionicons name="open-outline" size={14} color="#CBD5E1" />
                      </Pressable>
                    ))}
                  </View>
                ))
              : null}
          </View>
        );
      })}

      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#B45309', marginTop: 6, marginBottom: 8 }}>
        🏅 Olympiad Library
      </Text>
      {FREE_LIBRARY.olympiad.map((r, i) => (
        <Card key={`o${i}`} mode="light" onPress={() => onOpen(r.url)} style={{ marginBottom: 10, backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 22, marginRight: 12 }}>{LIB_KIND_ICON[r.kind] || '🔗'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#92400E' }}>{r.title}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#A16207', marginTop: 3, lineHeight: 16 }}>{r.desc}</Text>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, color: '#B45309', marginTop: 5 }}>✅ FREE · {r.source}</Text>
            </View>
            <Ionicons name="open-outline" size={16} color="#FDE68A" style={{ marginTop: 2 }} />
          </View>
        </Card>
      ))}
    </View>
  );
}
