// CONTENT LOCKER — notes, links, YouTube refs with optional AI
// summaries (AI summarize arrives with Layer 4; data model ready).
// FIX-J: + real file uploads to the PRIVATE `content` bucket (PO-gated DDL —
// the app never creates buckets and never makes public URLs), NOTE_CREATE XP
// behind the xpOnce daily guard (key 'note'), dedupe, search, syllabus
// chapter/topic metadata, malformed-row fallback cards. Every DECISION lives in
// src/lib/contentLocker.js (pure, unit-tested J1–J7); this screen renders and
// moves bytes. Existing note/link behavior and the F6 error surfaces are kept.
import { useCallback, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getDocumentAsync } from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
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
import { db, isRemote } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import { hasEarnedToday, markEarnedToday } from '../../lib/xpOnce';
import { aiSummarizeContent, AIUnavailableError } from '../../lib/aiFeatures';
import { aiStatus } from '../../lib/aiService';
import { CONTENT_TYPES, activeSyllabusRows } from '../../config/constants';
import { FREE_LIBRARY, LIB_KIND_ICON, CLASS10_LIBRARY } from '../../data/contentLibrary';
import {
  CONTENT_BUCKET, MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS, DUPLICATE_MESSAGE,
  LOCAL_UPLOAD_MESSAGE, PICKER_MIME, extOf, extFromMime, typeForExt, fmtFileSize,
  validateUpload, storageObjectName, isStoredFileRow, normalizeUrl, findDuplicate,
  fileRowFrom, filterItems, safeCard, syllabusChoices, applyNoteXp, FILE_TYPES,
  sortItemsDesc,
} from '../../lib/contentLocker';
import { fonts } from '../../config/theme';
import { nowIso, localDateOf, uuid } from '../../lib/utils';
import { useHubBack } from '../../hooks/useHubBack';

export function ContentScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');                 // FIX-J4: client-side search
  const [tab, setTab] = useState('locker'); // 'locker' | 'library'
  const [openSubject, setOpenSubject] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aiBusyId, setAiBusyId] = useState(null);
  const [aiMsg, setAiMsg] = useState('');
  const [form, setForm] = useState({ kind: 'note', title: '', body: '', subject: '', topic: '' });
  const [choices, setChoices] = useState({ subjects: [], chaptersBySubject: {} }); // FIX-J5
  const [picked, setPicked] = useState(null);             // FIX-J1: picked file asset
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState(null);       // FIX-J1: audio playback
  const audioRef = useRef(null);                          // { stop() } of the live player
  // v1.0.6 recovery: readable note view
  const [noteOpen, setNoteOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);
  const [fullReaderOpen, setFullReaderOpen] = useState(false); // FIX-D2 full-screen

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('content', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false } });
    setItems(sortItemsDesc(rows)); // FIX-J7: created_at desc, stable tie-break
    // FIX-J5: chapter/topic choices come from the student's OWN active syllabus
    // rows (S5 activeSyllabusRows — archived history is never offered)
    try {
      const syl = await db.list('syllabus', { eq: { user_id: profile.id } });
      setChoices(syllabusChoices(activeSyllabusRows(syl)));
    } catch {
      setChoices({ subjects: [], chaptersBySubject: {} });
    }
  }, [profile?.id]);

  const stopAudio = () => {
    try { audioRef.current?.stop?.(); } catch {}
    audioRef.current = null;
    setPlayingId(null);
  };

  const onBack = useHubBack(navigation, 'StudyHub');
  useFocusEffect(useCallback(() => {
    load();
    return () => stopAudio(); // never keep playing after leaving the Locker
  }, [load]));

  const detectType = (url) => {
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|webp)(\?|$)/.test(u)) return 'image';
    if (/\.(mp3|wav|m4a)(\?|$)/.test(u)) return 'audio';
    return 'link';
  };

  // FIX-F6: silent failure audit — add/remove had no visible catch
  // FIX-J2: NOTE_CREATE behind the xpOnce daily guard (key 'note'); the save
  // itself never depends on XP. FIX-J3: dedupe before insert. FIX-J6: validation.
  const add = async () => {
    const title = String(form.title || '').trim();
    if (!title) { setAiMsg('Title khali nahi ho sakta.'); return; } // J6: empty-after-trim rejected
    const isLink = form.kind === 'link';
    let url = null;
    if (isLink) {
      url = normalizeUrl(form.body); // J6: canonical http(s) or null — bare hosts get https://
      if (!url) { setAiMsg('Link http(s) hona chahiye — URL check karo (javascript:/ftp:/khaali nahi).'); return; }
    }
    const text = !isLink ? String(form.body || '').trim() : null;
    if (!isLink && !text) { setAiMsg('Note text khali nahi ho sakta.'); return; }
    const type = isLink ? detectType(url) : 'note';
    // J3: same normalized URL (links) or same title+text (notes) is blocked — no insert
    if (findDuplicate(items || [], { type, url, text, title })) { setAiMsg(DUPLICATE_MESSAGE); return; }
    try {
      await db.insert('content', {
        user_id: profile.id,
        title,
        type,
        url,
        text,
        subject: form.subject.trim() || null,
        topic: form.topic.trim() || null, // FIX-J5: chapter from the active syllabus
        ai_summary: null,
        file_size: null,
        created_at: nowIso(),
      });
      // J2: guard -> award -> mark, every effect injected; failures never block the save
      const xp = await applyNoteXp({
        userId: profile.id,
        hasEarnedToday: (uid, key) => hasEarnedToday(uid, key),
        markEarnedToday: (uid, key) => markEarnedToday(uid, key),
        awardXP: (code) => awardXP(code),
      });
      setAiMsg(xp.reason === 'daily-cap' ? `Saved ✅ — ${xp.msg}` : `Saved ✅ +${xp.awardedXp} XP`);
      setForm({ kind: 'note', title: '', body: '', subject: '', topic: '' });
      setAddOpen(false);
      await load();
    } catch (e) {
      console.warn('[F6] Content add failed', e?.message);
      setAiMsg(e?.message?.includes('Session expired') ? 'Session expired — please login again' : 'Content save fail hua — dobara try karo');
    }
  };

  const remove = async (item) => {
    try {
      // FIX-J7: deleting an uploaded file removes the STORAGE OBJECT first — the
      // row is only deleted once the object is gone, so no orphan is ever left.
      // (A missing object is not an error — supabase remove is idempotent.)
      if (isStoredFileRow(item) && isRemote() && supabase) {
        const { error } = await supabase.storage.from(CONTENT_BUCKET).remove([item.url]);
        if (error) {
          console.warn('[J7] storage remove failed', error?.message);
          setAiMsg(`Storage object delete nahi hua — item abhi hai, dobara try karo. (${error.message})`);
          return;
        }
      }
      await db.remove('content', item.id);
      if (playingId === item.id) stopAudio();
      setAiMsg('Item delete ho gaya ✅');
      await load();
    } catch (e) {
      console.warn('[F6] Content remove failed', e?.message);
      setAiMsg('Content delete nahi ho paya — dobara try karo');
    }
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

  // BUG 5 behaviour (scheme-less "youtube.com/..." links) now lives in the pure
  // lib: normalizeUrl() prepends https:// and REJECTS anything not http(s) — J6.

  // ---------- FIX-J1: real file uploads (private bucket, PO-gated DDL) ----------
  const pickFile = async (kind) => {
    if (!isRemote() || !supabase) { setAiMsg(LOCAL_UPLOAD_MESSAGE); return; }
    setAiMsg('');
    try {
      const res = await getDocumentAsync({ type: PICKER_MIME[kind] || '*/*', copyToCacheDirectory: true, multiple: false });
      // cancelled picker -> NO row, NO upload, NO XP
      if (res?.canceled || !Array.isArray(res?.assets) || !res.assets.length) return;
      const a = res.assets[0];
      // type/size gate immediately (the FULL validateUpload — including the title —
      // runs again in saveFile BEFORE any network call [J1a])
      const ext = extOf(a.name) || extFromMime(a.mimeType);
      if (!typeForExt(ext)) { setAiMsg('Ye file type allowed nahi hai. Sirf PDF, PNG/JPG/WEBP, MP3/M4A/WAV.'); return; }
      const bytes = Number(a.size);
      if (!Number.isFinite(bytes) || bytes <= 0) { setAiMsg('File khaali hai ya size pata nahi chala.'); return; }
      if (bytes > MAX_UPLOAD_BYTES) { setAiMsg(`File ${fmtFileSize(bytes)} hai — limit ${fmtFileSize(MAX_UPLOAD_BYTES)} hai.`); return; }
      setPicked({
        uri: a.uri, name: a.name || `file.${ext}`, size: bytes, ext,
        mimeType: String(a.mimeType || '').trim() || null, file: a.file || null,
      });
      if (!String(form.title || '').trim()) {
        setForm((f) => ({ ...f, title: String(a.name || '').replace(/\.[^.]+$/, '').slice(0, 80) })); // filename as a title draft
      }
    } catch (e) {
      console.warn('[J1] pick failed', e?.message);
      setAiMsg(e?.message || 'File pick nahi hui — dobara try karo.');
    }
  };

  // Bytes for supabase storage, per platform:
  //   web    -> the picker's real File object (storage-js Blob path builds the multipart body)
  //   native -> FIX-CONTENT: old FormData {uri} with empty name rejected on Android
  //             (Unsupported FormDataPart implementation, screenshot 3). New path:
  //             try fetch(uri).blob() first (new RN supports file:// fetch), fallback
  //             to expo-file-system base64 → Uint8Array → storage upload. Web branch
  //             kept byte-identical per handoff.
  const uploadBody = async (p) => {
    if (Platform.OS === 'web') {
      if (p.file) return p.file;
      const r = await fetch(p.uri);
      if (!r.ok) throw new Error('picked file read fail (web)');
      return r.blob();
    }
    // FIX-CONTENT: native path — blob first, then file-system
    try {
      const res = await fetch(p.uri);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && typeof blob.size === 'number' && blob.size > 0) return blob;
      }
    } catch {}
    // Fallback: expo-file-system Base64 → Uint8Array
    try {
      const FS = await import('expo-file-system');
      // SDK 57 has both legacy readAsStringAsync and new File API
      let b64 = null;
      if (FS.readAsStringAsync) {
        const enc = (FS.EncodingType && FS.EncodingType.Base64) || 'base64';
        b64 = await FS.readAsStringAsync(p.uri, { encoding: enc });
      } else if (FS.File) {
        const file = new FS.File(p.uri);
        if (typeof file.base64 === 'function') b64 = await file.base64();
        else if (typeof file.bytes === 'function') {
          const u8 = await file.bytes();
          return u8;
        }
      } else if (FS.default && FS.default.readAsStringAsync) {
        const enc = (FS.default.EncodingType && FS.default.EncodingType.Base64) || 'base64';
        b64 = await FS.default.readAsStringAsync(p.uri, { encoding: enc });
      }
      if (!b64) throw new Error('FileSystem returned empty base64');
      // base64 → Uint8Array (atob available in RN 0.73+; fallback manual)
      let bytes;
      if (typeof atob === 'function') {
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        // manual base64 decode (no atob)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let str = b64.replace(/[^A-Za-z0-9+/=]/g, '');
        const len = str.length;
        const buffer = [];
        let i = 0;
        while (i < len) {
          const enc1 = chars.indexOf(str.charAt(i++));
          const enc2 = chars.indexOf(str.charAt(i++));
          const enc3 = chars.indexOf(str.charAt(i++));
          const enc4 = chars.indexOf(str.charAt(i++));
          const chr1 = (enc1 << 2) | (enc2 >> 4);
          const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
          const chr3 = ((enc3 & 3) << 6) | enc4;
          buffer.push(chr1);
          if (enc3 !== 64) buffer.push(chr2);
          if (enc4 !== 64) buffer.push(chr3);
        }
        bytes = new Uint8Array(buffer);
      }
      return bytes;
    } catch (e) {
      throw new Error(`File read fail (native): ${e?.message || e}`);
    }
  };

  const saveFile = async () => {
    if (!picked) return;
    if (!isRemote() || !supabase) { setAiMsg(LOCAL_UPLOAD_MESSAGE); return; }
    // [J1a] the FULL validation gate runs BEFORE any network call
    const v = validateUpload({ title: form.title, fileName: picked.name, mimeType: picked.mimeType, size: picked.size });
    if (!v.ok) { setAiMsg(v.message); return; }
    setUploading(true);
    setAiMsg('');
    try {
      // [J1] object name = {uid}/{uuid}.{ext} — first path segment is the user id,
      // exactly what the content_storage_own policy pins; upsert:false so a name
      // collision (astronomically unlikely with uuids) fails instead of overwriting.
      const objectName = storageObjectName(profile.id, v.ext, uuid());
      if (!objectName) throw new Error('storage path nahi bana (session check karo)');
      const { error } = await supabase.storage
        .from(CONTENT_BUCKET)
        .upload(objectName, await uploadBody(picked), { contentType: v.contentType, upsert: false });
      if (error) throw new Error(error.message);
      await db.insert('content', fileRowFrom({
        userId: profile.id, title: v.title, type: v.type, sizeBytes: v.sizeBytes,
        objectName, subject: form.subject, topic: form.topic, createdAt: nowIso(),
      }));
      // [J2] same daily guard as notes/links — the upload never depends on XP
      const xp = await applyNoteXp({
        userId: profile.id,
        hasEarnedToday: (uid, key) => hasEarnedToday(uid, key),
        markEarnedToday: (uid, key) => markEarnedToday(uid, key),
        awardXP: (code) => awardXP(code),
      });
      setAiMsg(xp.reason === 'daily-cap' ? `Uploaded ✅ — ${xp.msg}` : `Uploaded ✅ +${xp.awardedXp} XP`);
      setPicked(null);
      setForm({ kind: 'note', title: '', body: '', subject: '', topic: '' });
      setAddOpen(false);
      await load();
    } catch (e) {
      console.warn('[J1] upload failed', e?.message); // F6 pattern: VISIBLE error
      setAiMsg(String(e?.message || '').includes('Session expired')
        ? 'Session expired — please login again'
        : `Upload fail hua — ${e?.message || 'dobara try karo'}`);
    } finally {
      setUploading(false);
    }
  };

  // ---------- opening items: signed URLs for files, normalized URLs for links ----------
  const signedUrlFor = async (item) => {
    if (!isRemote() || !supabase) return null;
    // private bucket: SHORT-LIVED signed URL only — never a public URL
    const { data, error } = await supabase.storage.from(CONTENT_BUCKET).createSignedUrl(item.url, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'signed URL nahi mila');
    return data.signedUrl;
  };

  const toggleAudio = async (item, signed) => {
    if (playingId === item.id) { stopAudio(); return; }
    stopAudio();
    try {
      if (Platform.OS === 'web') {
        const el = new Audio(signed); // web: HTMLAudioElement (soundService pattern)
        el.onended = () => { audioRef.current = null; setPlayingId(null); };
        await el.play();
        audioRef.current = { stop: () => { try { el.pause(); } catch {} } };
      } else {
        const expoAudio = require('expo-audio'); // native: expo-audio (already a dependency)
        const p = expoAudio.createAudioPlayer(signed);
        p.play();
        audioRef.current = { stop: () => { try { p.pause(); } catch {} try { p.remove?.(); } catch {} } };
      }
      setPlayingId(item.id);
    } catch (e) {
      setAiMsg(`Audio play nahi hua — ${e?.message || 'dobara try karo'}`);
      audioRef.current = null;
      setPlayingId(null);
    }
  };

  const open = async (item) => {
    const c = safeCard(item); // J6: whatever the row looks like, opening never crashes
    if (c.isFile) {
      try {
        setAiMsg('');
        const signed = await signedUrlFor(item);
        if (!signed) { setAiMsg('File cloud mode mein nahi khul sakti (Storage chahiye).'); return; }
        if (c.type === 'audio') { await toggleAudio(item, signed); return; }
        // PDF / image: open the signed URL in the browser (in-app tab on device)
        if (WebBrowser?.openBrowserAsync) await WebBrowser.openBrowserAsync(signed);
        else Linking.openURL(signed).catch(() => {});
      } catch (e) {
        console.warn('[J1] open failed', e?.message);
        setAiMsg(`File open nahi hui — ${e?.message || 'dobara try karo'}`);
      }
      return;
    }
    if (c.url) {
      const u = normalizeUrl(c.url); // J6: garbage URLs never reach Linking
      if (u) Linking.openURL(u).catch(() => {});
      else setAiMsg('Ye link khul nahi sakta (invalid URL) — row adhoora lag raha hai.');
    } else if (c.text) {
      // v1.0.6 recovery: tapping a note opens readable note view
      setSelectedNote(item);
      setNoteOpen(true);
    } else {
      setAiMsg('Is item mein kholne ko kuch nahi hai (adhoora row).'); // J6 honest fallback
    }
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
  // FIX-J4: search composes with the type chip — both client-side, no server call
  const shown = filterItems(items, { type: filter, query });

  return (
    <Screen mode="light">
      <ScreenHeader
        title="Content Locker"
        subtitle="Notes, links, files, YouTube — sab ek jagah"
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
        <FreeLibrary openSubject={openSubject} setOpenSubject={setOpenSubject} onOpen={(url) => { const u = normalizeUrl(url); if (u) Linking.openURL(u).catch(() => {}); }} />
      ) : (
      <>
      {/* FIX-J4: substring search over title / note text / subject */}
      <View style={{ marginBottom: 10 }}>
        <Input value={query} onChangeText={setQuery} placeholder="🔍 Search locker… (title / text / subject)" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {types.map((t) => (
          <Chip
            key={t}
            label={t === 'All' ? 'All' : `${(CONTENT_TYPES[t] || CONTENT_TYPES.note).icon} ${(CONTENT_TYPES[t] || CONTENT_TYPES.note).label}`}
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

      {items.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🗂️</Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', textAlign: 'center' }}>
            Locker khali hai
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Notes, links, PDFs, images, audio — yahan store karo. Pehle save par +5 XP (din mein ek baar).
          </Text>
          <Button title="Add Something" size="sm" mode="light" onPress={() => setAddOpen(true)} />
        </Card>
      ) : shown.length === 0 ? (
        <Card mode="light">
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', textAlign: 'center' }}>
            {query ? `Kuch nahi mila “${query}” ke liye.` : 'Is type ka item nahi hai.'}
          </Text>
        </Card>
      ) : (
        shown.map((item, idx) => {
          // FIX-J6: whatever shape the stored row has (null url/text, unknown
          // type, missing fields), safeCard() turns it into something renderable
          const c = safeCard(item);
          const t = CONTENT_TYPES[c.type] || CONTENT_TYPES.note;
          return (
            <Card key={item?.id || `row-${idx}`} mode="light" onPress={() => open(item)} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 24, marginRight: 12 }}>{t.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>
                    {c.title}
                  </Text>
                  {c.subject || c.topic ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#6D28D9', marginTop: 2 }}>
                      {[c.subject, c.topic].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {c.text ? (
                    <Text numberOfLines={2} style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginTop: 5, lineHeight: 18 }}>
                      {c.text}
                    </Text>
                  ) : null}
                  {c.url && !c.isFile ? (
                    <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#0891B2', marginTop: 5 }}>
                      {c.url}
                    </Text>
                  ) : null}
                  {c.isFile ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#0891B2', marginTop: 5 }}>
                      {c.fileSizeLabel}{playingId === c.id ? '  ·  🔊 playing…' : ''}
                    </Text>
                  ) : null}
                  {item?.ai_summary ? (
                    <View style={{ backgroundColor: '#F0FDFA', borderRadius: 8, padding: 8, marginTop: 8 }}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#0891B2', marginBottom: 3 }}>🤖 AI Summary</Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#134E4A', lineHeight: 17 }}>{item.ai_summary}</Text>
                    </View>
                  ) : null}
                  <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 6 }}>
                    {localDateOf(item?.created_at)}
                  </Text>
                </View>
                {c.text && !item?.ai_summary && !c.isFile ? (
                  <Pressable onPress={() => summarize(item)} disabled={aiBusyId === item?.id} hitSlop={8} style={{ padding: 6 }}>
                    <Ionicons name={aiBusyId === item?.id ? 'hourglass-outline' : 'sparkles-outline'} size={16} color="#0891B2" />
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

      {/* FIX-J: Add modal — note / link / PDF / image / audio + syllabus metadata */}
      <ModalSheet visible={addOpen} onClose={() => { setAddOpen(false); stopAudio(); }} title="Add to Locker" mode="light">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>
          <Chip label="📝 Note" small selected={form.kind === 'note'} onPress={() => setForm({ ...form, kind: 'note' })} mode="light" />
          <Chip label="🔗 Link / URL" small selected={form.kind === 'link'} onPress={() => setForm({ ...form, kind: 'link' })} mode="light" />
          {FILE_TYPES.map((k) => (
            <Chip
              key={k}
              label={`${(CONTENT_TYPES[k] || {}).icon || '📄'} ${(CONTENT_TYPES[k] || {}).label || k}`}
              small
              selected={form.kind === k}
              onPress={() => setForm((f) => {
                // switching file kind: drop a picked file that no longer matches
                if (picked && typeForExt(picked.ext) !== k) setPicked(null);
                return { ...f, kind: k };
              })}
              mode="light"
            />
          ))}
        </View>

        <Input
          label="Title"
          value={form.title}
          onChangeText={(v) => setForm({ ...form, title: v })}
          placeholder="e.g. Thermodynamics — Priya Ma'am notes"
        />

        {FILE_TYPES.includes(form.kind) ? (
          <View style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, marginBottom: 14 }}>
            {picked ? (
              <>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#1E293B' }} numberOfLines={1}>
                  {(CONTENT_TYPES[form.kind] || {}).icon || '📄'} {picked.name}
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 3 }}>
                  {fmtFileSize(picked.size)} · limit {fmtFileSize(MAX_UPLOAD_BYTES)}
                </Text>
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <Button title="Change file" size="sm" mode="light" onPress={() => pickFile(form.kind)} disabled={uploading} />
                </View>
              </>
            ) : (
              <>
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginBottom: 8 }}>
                  PDF · PNG/JPG/WEBP · MP3/M4A/WAV — max {fmtFileSize(MAX_UPLOAD_BYTES)}. Private bucket, sirf tum dekh sakte ho.
                </Text>
                <Button title={`Pick ${((CONTENT_TYPES[form.kind] || {}).label || 'file')}`} size="sm" mode="light" onPress={() => pickFile(form.kind)} disabled={uploading} />
              </>
            )}
            {!isRemote() ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#B45309', marginTop: 8 }}>{LOCAL_UPLOAD_MESSAGE}</Text>
            ) : null}
          </View>
        ) : (
          <Input
            label={form.kind === 'note' ? 'Note text' : 'URL'}
            value={form.body}
            onChangeText={(v) => setForm({ ...form, body: v })}
            placeholder={form.kind === 'note' ? 'Likho ya paste karo…' : 'https://…'}
            multiline={form.kind === 'note'}
          />
        )}

        {/* FIX-J5: subject (free text + own-syllabus chips) and chapter/topic chips */}
        <Input
          label="Subject (optional)"
          value={form.subject}
          onChangeText={(v) => setForm({ ...form, subject: v, topic: '' })} // changing subject clears the chapter
          placeholder="Physics"
        />
        {choices.subjects.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {choices.subjects.map((s) => (
              <Chip key={s} label={s} small selected={form.subject === s} onPress={() => setForm({ ...form, subject: s, topic: '' })} mode="light" />
            ))}
          </View>
        ) : null}
        {form.subject && (choices.chaptersBySubject[form.subject] || []).length ? (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#475569', marginBottom: 6 }}>Chapter / topic (apne syllabus se)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {(choices.chaptersBySubject[form.subject] || []).map((ch) => (
                <Chip key={ch} label={ch} small selected={form.topic === ch} onPress={() => setForm({ ...form, topic: ch })} mode="light" />
              ))}
            </View>
          </View>
        ) : null}
        {form.topic ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#6D28D9', marginBottom: 10 }}>Selected topic: {form.topic}</Text>
        ) : null}

        <Button
          title={uploading ? 'Uploading…' : FILE_TYPES.includes(form.kind) ? 'Upload file' : 'Save'}
          mode="light"
          onPress={FILE_TYPES.includes(form.kind) ? saveFile : add}
          disabled={
            uploading ||
            !form.title.trim() ||
            (FILE_TYPES.includes(form.kind) ? !picked : form.kind === 'link' && !form.body.trim())
          }
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 8 }}>
          +5 XP din mein ek baar (pehle save par) — baaki saves bhi pakke, bina XP ke.
        </Text>
      </ModalSheet>

      {/* FIX-D2: full-screen note reader — readable, scrollable, selectable, full height */}
      <ModalSheet visible={noteOpen} onClose={() => { setNoteOpen(false); setSelectedNote(null); }} title={selectedNote?.title || 'Note'} mode="light" maxHeight="92%">
        {selectedNote ? (
          <View style={{ flex: 1, minHeight: 400 }}>
            {selectedNote.subject ? (
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#6D28D9', marginBottom: 8 }}>{selectedNote.subject}</Text>
            ) : null}
            <ScrollView style={{ backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', flex: 1, maxHeight: 520 }} contentContainerStyle={{ padding: 16 }}>
              <Text selectable style={{ fontFamily: fonts.body, fontSize: 14.5, color: '#1E293B', lineHeight: 22 }}>
                {selectedNote.text || '—'}
              </Text>
            </ScrollView>
            {selectedNote.ai_summary ? (
              <View style={{ backgroundColor: '#F0FDFA', borderRadius: 8, padding: 10, marginTop: 12 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: '#0891B2', marginBottom: 4 }}>🤖 AI Summary</Text>
                <Text selectable style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#134E4A', lineHeight: 18 }}>{selectedNote.ai_summary}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#94A3B8' }}>{localDateOf(selectedNote.created_at)}</Text>
              {selectedNote.text && !selectedNote.ai_summary && aiStatus().configured ? (
                <Pressable onPress={() => { setNoteOpen(false); summarize(selectedNote); }} hitSlop={8}>
                  <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#0891B2' }}>✨ Summarize</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 14 }}>
              <Button title="Close" mode="light" variant="secondary" onPress={() => { setNoteOpen(false); setSelectedNote(null); }} style={{ flex: 1, marginRight: 8 }} />
              <Button title="Full-screen reader" mode="light" size="sm" onPress={() => setFullReaderOpen(true)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </ModalSheet>
      {/* FIX-D2: true full-screen reader overlay — full-screen note reader */}
      {fullReaderOpen && selectedNote ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', zIndex: 9999 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}>
            <Pressable onPress={() => setFullReaderOpen(false)} hitSlop={8} style={{ padding: 6, marginRight: 8 }}>
              <Ionicons name="arrow-back" size={22} color="#1E293B" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#1E293B' }}>{selectedNote.title}</Text>
              {selectedNote.subject ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#6D28D9' }}>{selectedNote.subject}</Text> : null}
            </View>
            <Pressable onPress={() => { setFullReaderOpen(false); setNoteOpen(false); setSelectedNote(null); }} hitSlop={8} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color="#64748B" />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text selectable style={{ fontFamily: fonts.body, fontSize: 16, color: '#1E293B', lineHeight: 26 }}>
              {selectedNote.text || '—'}
            </Text>
            {selectedNote.ai_summary ? (
              <View style={{ backgroundColor: '#F0FDFA', borderRadius: 12, padding: 14, marginTop: 20, borderWidth: 1, borderColor: '#CCFBF1' }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#0F766E', marginBottom: 6 }}>🤖 AI Summary</Text>
                <Text selectable style={{ fontFamily: fonts.body, fontSize: 14, color: '#134E4A', lineHeight: 20 }}>{selectedNote.ai_summary}</Text>
              </View>
            ) : null}
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#94A3B8', marginTop: 20 }}>{localDateOf(selectedNote.created_at)} · full-screen reader</Text>
          </ScrollView>
        </View>
      ) : null}
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
