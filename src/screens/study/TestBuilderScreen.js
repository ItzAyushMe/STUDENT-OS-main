// AI TEST BUILDER (v1.0.2) — full tests (2 printable sets), question
// banks and per-chapter mind maps. Strict JSON contract + loading,
// error and "AI not configured" states. PDF via browser print on web,
// Share on native.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Input } from '../../components/ui/Input';
import { Loading } from '../../components/ui/EmptyState';
import { MathText } from '../../components/ui/MathText';
import { db } from '../../lib/db';
import { useHubBack } from '../../hooks/useHubBack';
import { aiGenerateTest, aiGenerateQuestionBank, aiGenerateMindMap, AIUnavailableError } from '../../lib/aiFeatures';
import { fonts, radius } from '../../config/theme';

const MODES = [
  { key: 'test', label: '📝 Test (2 sets)' },
  { key: 'bank', label: '🧠 Question Bank' },
  { key: 'map', label: '🗺️ Mind Map' },
];

// ---------- printable HTML export (web) ----------
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function printHtml(title, bodyHtml) {
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (!w) {
      window.alert('Pop-up blocked — pop-ups allow karo, phir Print/Save as PDF kar paoge.');
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; max-width: 760px; margin: 28px auto; color: #111; line-height: 1.5; }
        h1 { font-size: 21px; text-align: center; margin-bottom: 2px; }
        .meta { text-align: center; color: #444; font-size: 13px; margin-bottom: 18px; }
        .set { page-break-after: always; }
        .set:last-child { page-break-after: auto; }
        h2 { font-size: 16px; border-bottom: 2px solid #111; padding-bottom: 4px; }
        h3 { font-size: 14px; margin: 14px 0 6px; }
        .q { margin: 9px 0; font-size: 13.5px; }
        .opts { margin: 3px 0 0 18px; }
        .ans { margin-top: 22px; border-top: 1px dashed #999; padding-top: 10px; color: #333; font-size: 12.5px; }
        .mapnode { margin-left: 18px; border-left: 1px solid #bbb; padding-left: 12px; margin-top: 5px; }
        .maplabel { font-weight: bold; font-size: 13px; }
        @media print { .noprint { display: none; } }
      </style></head><body>${bodyHtml}
      <p class="noprint" style="text-align:center;color:#777;margin-top:24px">Use your browser's Print → Save as PDF.</p>
      <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
      </body></html>`);
    w.document.close();
  }
}

function shareText(title, text) {
  if (Platform.OS === 'web') {
    // copy to clipboard as a fallback
    try { navigator.clipboard?.writeText(text); window.alert('Copied to clipboard!'); } catch { /* ignore */ }
    return;
  }
  Share.share({ title, message: text }).catch(() => {});
}

export function TestBuilderScreen({ navigation }) {
  const { profile } = useAuth();
  const settings = useSettings();
  const onBack = useHubBack(navigation, 'StudyHub');
  const aiConfigured = settings.aiStatus?.anyConfigured;

  const [mode, setMode] = useState('test');
  const [rows, setRows] = useState(null); // syllabus rows for chapter picker
  const [picked, setPicked] = useState([]); // ids of picked syllabus rows
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [totalMarks, setTotalMarks] = useState('80');
  const [timeMinutes, setTimeMinutes] = useState('180');
  const [count, setCount] = useState('20');
  const [difficulty, setDifficulty] = useState(100);
  const [breakdown, setBreakdown] = useState({ mcq: 10, vsaq: 4, saq: 4, laq: 2 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { kind, data }
  const [setTab, setSetTab] = useState('A');
  const [showAnswers, setShowAnswers] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const data = await db.list('syllabus', { eq: { user_id: profile.id } });
    setRows(data.filter((r) => r.status !== 'completed'));
  }, [profile?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const subjects = useMemo(
    () => ['All', ...new Set((rows || []).map((r) => r.subject).filter(Boolean))],
    [rows]
  );
  const shownRows = useMemo(
    () => (subjectFilter === 'All' ? rows || [] : (rows || []).filter((r) => r.subject === subjectFilter)),
    [rows, subjectFilter]
  );
  const pickedChapters = useMemo(
    () => (rows || []).filter((r) => picked.includes(r.id)),
    [rows, picked]
  );

  const toggleChapter = (id) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const num = (v, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };

  const generate = async () => {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      if (mode === 'test') {
        const data = await aiGenerateTest({
          profile,
          chapters: pickedChapters,
          breakdown,
          totalMarks: num(totalMarks, 80),
          totalQuestions: num(count, 20),
          difficultyPct: difficulty,
          timeMinutes: num(timeMinutes, 180),
        });
        if (!data?.sets?.length) throw new Error('AI ne khaali paper bheja — thoda chhota try karo.');
        setResult({ kind: 'test', data });
        setSetTab('A');
      } else if (mode === 'bank') {
        const data = await aiGenerateQuestionBank({
          profile,
          chapters: pickedChapters,
          breakdown,
          totalQuestions: num(count, 20),
          difficultyPct: difficulty,
        });
        if (!data?.questions?.length) throw new Error('AI ne khaali bank bheja — dobara try karo.');
        setResult({ kind: 'bank', data });
      } else {
        const data = await aiGenerateMindMap({ profile, chapters: pickedChapters });
        if (!data?.chapters?.length) throw new Error('Mind map nahi bana — dobara try karo.');
        setResult({ kind: 'map', data });
      }
    } catch (e) {
      setError(e instanceof AIUnavailableError ? e.message : e?.message || 'Generate nahi ho paya. Dobara try karo.');
    } finally {
      setBusy(false);
    }
  };

  // ---------- exports ----------
  const qHtml = (q, i) => `
    <div class="q"><b>Q${i}.</b> ${escapeHtml(q.q)}
      ${q.options?.length ? `<div class="opts">${q.options.map((o, j) => `<div>(${String.fromCharCode(97 + j)}) ${escapeHtml(o)}</div>`).join('')}</div>` : ''}
    </div>`;

  const exportTest = () => {
    const r = result.data;
    const body = (r.sets || []).map((s) => `
      <div class="set">
        <h1>StudentOS — ${escapeHtml(profile?.class_level || '')} Test · Set ${escapeHtml(s.set)}</h1>
        <div class="meta">Time: ${escapeHtml(timeMinutes || '—')} min · Max marks: ${escapeHtml(totalMarks || '—')} · Difficulty: ${difficulty}%</div>
        ${(s.sections || []).map((sec) => `
          <h3>${escapeHtml(sec.label || sec.type)}</h3>
          ${(sec.questions || []).map((q, i) => qHtml(q, i + 1)).join('')}`).join('')}
        <div class="ans"><b>Answer Key — Set ${escapeHtml(s.set)}</b>
          ${(s.sections || []).flatMap((sec) => sec.questions || []).map((q, i) => `<div><b>A${i + 1}.</b> ${escapeHtml(q.answer ?? '—')}</div>`).join('')}
        </div>
      </div>`).join('');
    printHtml('StudentOS Test', body);
  };

  const exportBank = () => {
    const r = result.data;
    const body = `
      <h1>StudentOS — Question Bank</h1>
      <div class="meta">${escapeHtml(profile?.class_level || '')} · Difficulty: ${difficulty}% · ${r.questions.length} questions</div>
      <h2>Questions</h2>
      ${r.questions.map((q, i) => qHtml(q, i + 1)).join('')}
      <div class="ans"><b>Answers</b>
        ${r.questions.map((q, i) => `<div><b>A${i + 1}.</b> ${escapeHtml(q.answer ?? '—')}${q.why ? ` — ${escapeHtml(q.why)}` : ''}</div>`).join('')}
      </div>`;
    printHtml('StudentOS Question Bank', body);
  };

  const mapNodeHtml = (node) => `
    <div class="mapnode">
      <div class="maplabel">${escapeHtml(node.label)}</div>
      ${(node.children || []).map(mapNodeHtml).join('')}
    </div>`;

  const exportMap = () => {
    const body = `
      <h1>StudentOS — Mind Maps</h1>
      <div class="meta">${escapeHtml(profile?.class_level || '')} · one-page revision</div>
      ${(result.data.chapters || []).map((c) => `<h2>${escapeHtml(c.chapter)}</h2>${mapNodeHtml(c.root)}`).join('')}`;
    printHtml('StudentOS Mind Map', body);
  };

  const exportCurrent = () => {
    if (!result) return;
    if (result.kind === 'test') return exportTest();
    if (result.kind === 'bank') return exportBank();
    return exportMap();
  };

  const shareCurrent = () => {
    if (!result) return;
    const lines = [];
    if (result.kind === 'test') {
      result.data.sets.forEach((s) => {
        lines.push(`--- SET ${s.set} ---`);
        (s.sections || []).forEach((sec) => {
          lines.push(sec.label || sec.type);
          (sec.questions || []).forEach((q, i) => lines.push(`Q${i + 1}. ${q.q}${q.answer != null ? `\n   Ans: ${q.answer}` : ''}`));
        });
      });
    } else if (result.kind === 'bank') {
      result.data.questions.forEach((q, i) => lines.push(`Q${i + 1}. ${q.q}\n   Ans: ${q.answer}`));
    } else {
      const walk = (n, d) => { lines.push(`${'  '.repeat(d)}• ${n.label}`); (n.children || []).forEach((c) => walk(c, d + 1)); };
      result.data.chapters.forEach((c) => { lines.push(`\n== ${c.chapter} ==`); walk(c.root, 0); });
    }
    shareText('StudentOS', lines.join('\n'));
  };

  if (!rows) {
    return (
      <Screen mode="light">
        <ScreenHeader title="AI Test Builder" onBack={onBack} />
        <Loading mode="light" />
      </Screen>
    );
  }

  return (
    <Screen mode="light">
      <ScreenHeader
        title="AI Test Builder"
        subtitle="Paper, question bank ya mind map — 30 second mein"
        onBack={onBack}
      />

      <SegmentedControl options={MODES} value={mode} onChange={(m) => { setMode(m); setResult(null); setError(''); }} mode="light" style={{ marginBottom: 14 }} />

      {!aiConfigured ? (
        <Card mode="light" style={{ marginBottom: 14, backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#92400E', lineHeight: 18 }}>
            ⚠️ AI keys missing — ye feature AI se papers generate karta hai. Ek Gemini ya Groq key Settings mein
            daalo (Groq recommended), phir yahan wapas aao. Question bank bina AI ke nahi ban sakta.
          </Text>
        </Card>
      ) : null}

      {/* difficulty (0–200%) */}
      <Card mode="light" style={{ marginBottom: 12 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B', marginBottom: 6 }}>
          Difficulty — {difficulty}% {difficulty <= 80 ? '(warm-up)' : difficulty <= 110 ? '(exam level)' : difficulty <= 150 ? '(competitive level)' : '(olympiad 🔥)'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <StepBtn icon="remove" disabled={difficulty <= 0} onPress={() => setDifficulty((d) => Math.max(0, d - 10))} />
          <View style={{ flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, marginHorizontal: 10, overflow: 'hidden' }}>
            <View style={{ height: 8, width: `${(difficulty / 200) * 100}%`, backgroundColor: '#7C3AED' }} />
          </View>
          <StepBtn icon="add" disabled={difficulty >= 200} onPress={() => setDifficulty((d) => Math.min(200, d + 10))} />
        </View>
      </Card>

      {/* test/bank specifics */}
      {mode !== 'map' ? (
        <Card mode="light" style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row' }}>
            {mode === 'test' ? (
              <Input label="Total marks" value={totalMarks} onChangeText={setTotalMarks} placeholder="80" keyboardType="number-pad" style={{ flex: 1, marginRight: 8 }} />
            ) : null}
            <Input label={mode === 'test' ? 'Total questions' : 'Number of questions'} value={count} onChangeText={setCount} placeholder="20" keyboardType="number-pad" style={{ flex: 1 }} />
          </View>
          {mode === 'test' ? (
            <Input label="Time (minutes)" value={timeMinutes} onChangeText={setTimeMinutes} placeholder="180" keyboardType="number-pad" style={{ marginTop: 10 }} />
          ) : null}
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: '#334155', marginTop: 12, marginBottom: 6 }}>
            Breakdown (MCQ · VSAQ · SAQ · LAQ)
          </Text>
          <View style={{ flexDirection: 'row' }}>
            {(['mcq', 'vsaq', 'saq', 'laq'] ).map((k) => (
              <View key={k} style={{ flex: 1, marginRight: 6 }}>
                <Input
                  label={k.toUpperCase()}
                  value={String(breakdown[k])}
                  onChangeText={(v) => setBreakdown((b) => ({ ...b, [k]: num(v, 0) }))}
                  keyboardType="number-pad"
                />
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* chapter picker */}
      <Card mode="light" style={{ marginBottom: 12 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#1E293B', marginBottom: 8 }}>
          Chapters {picked.length ? `(${picked.length} selected)` : '(none = whole syllabus)'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {subjects.map((s) => (
            <Chip key={s} label={s} mode="light" selected={subjectFilter === s} onPress={() => setSubjectFilter(s)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {shownRows.map((r) => (
            <Chip
              key={r.id}
              label={`${picked.includes(r.id) ? '✓ ' : ''}${r.chapter}`.slice(0, 42)}
              mode="light"
              selected={picked.includes(r.id)}
              onPress={() => toggleChapter(r.id)}
            />
          ))}
          {!shownRows.length ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#94A3B8' }}>
              Syllabus khaali hai — pehle Syllabus Map mein chapters add karo.
            </Text>
          ) : null}
        </View>
      </Card>

      <Button
        title={busy ? 'Generating…' : mode === 'test' ? 'Generate Test (2 sets) 📝' : mode === 'bank' ? 'Generate Question Bank 🧠' : 'Generate Mind Maps 🗺️'}
        mode="light"
        size="lg"
        onPress={generate}
        loading={busy}
        disabled={busy}
        style={{ marginBottom: 12 }}
      />

      {busy ? <Loading mode="light" text="Professor Byte paper bana rahe hain…" /> : null}

      {error ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#B91C1C', lineHeight: 18 }}>{error}</Text>
          <Button title="Retry" size="sm" mode="light" onPress={generate} style={{ marginTop: 8 }} />
        </Card>
      ) : null}

      {/* ---------------- results ---------------- */}
      {result?.kind === 'test' ? (
        <Card mode="light" style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', flex: 1 }}>
              Test ready — Set {setTab}
            </Text>
            <Pressable onPress={() => setShowAnswers((s) => !s)} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#6D28D9' }}>
                {showAnswers ? 'Hide answers' : 'Show answers'}
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', marginBottom: 10 }}>
            {['A', 'B'].map((s) => (
              <Chip key={s} label={`Set ${s}`} mode="light" selected={setTab === s} onPress={() => setSetTab(s)} />
            ))}
          </View>
          {(result.data.sets.find((s) => s.set === setTab)?.sections || []).map((sec, si) => (
            <View key={si} style={{ marginBottom: 12 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: '#6D28D9', marginBottom: 6 }}>
                {sec.label || sec.type}
              </Text>
              {(sec.questions || []).map((q, qi) => (
                <View key={qi} style={{ marginBottom: 8 }}>
                  <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', lineHeight: 18 }}>
                    Q{qi + 1}. <MathText value={q.q} />
                  </Text>
                  {q.options?.length ? (
                    <View style={{ marginLeft: 14, marginTop: 3 }}>
                      {q.options.map((o, oi) => (
                        <Text key={oi} style={{ fontFamily: fonts.body, fontSize: 12, color: '#475569', lineHeight: 17 }}>
                          ({String.fromCharCode(97 + oi)}) {o}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {showAnswers ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#0891B2', marginTop: 3 }}>
                      Ans: {String(q.answer ?? '—')}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
          {showAnswers && result.data.tips ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', fontStyle: 'italic' }}>
              Tip: {result.data.tips}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <Button title="🖨️ Print / Save PDF" size="sm" mode="light" onPress={exportCurrent} style={{ flex: 1, marginRight: 8 }} />
            <Button title="📤 Share" size="sm" mode="light" variant="secondary" onPress={shareCurrent} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {result?.kind === 'bank' ? (
        <Card mode="light" style={{ marginBottom: 14 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginBottom: 10 }}>
            Question Bank — {result.data.questions.length} questions
          </Text>
          {result.data.questions.map((q, qi) => (
            <View key={qi} style={{ marginBottom: 9 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', lineHeight: 18 }}>
                Q{qi + 1} [{String(q.type || 'q').toUpperCase()}]. <MathText value={q.q} />
              </Text>
              {q.options?.length ? (
                <View style={{ marginLeft: 14, marginTop: 2 }}>
                  {q.options.map((o, oi) => (
                    <Text key={oi} style={{ fontFamily: fonts.body, fontSize: 12, color: '#475569' }}>
                      ({String.fromCharCode(97 + oi)}) {o}
                    </Text>
                  ))}
                </View>
              ) : null}
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#0891B2', marginTop: 2 }}>
                Ans: {String(q.answer ?? '—')}{q.why ? ` — ${q.why}` : ''}
              </Text>
            </View>
          ))}
          {result.data.weakSpots ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#B45309', marginTop: 6 }}>
              Revise: {result.data.weakSpots}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <Button title="🖨️ Print / Save PDF" size="sm" mode="light" onPress={exportCurrent} style={{ flex: 1, marginRight: 8 }} />
            <Button title="📤 Share" size="sm" mode="light" variant="secondary" onPress={shareCurrent} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {result?.kind === 'map' ? (
        <Card mode="light" style={{ marginBottom: 14 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B', marginBottom: 10 }}>
            Mind Maps — {result.data.chapters.length} chapter{result.data.chapters.length > 1 ? 's' : ''}
          </Text>
          {result.data.chapters.map((c, ci) => (
            <View key={ci} style={{ marginBottom: 14 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#6D28D9', marginBottom: 6 }}>
                🗺️ {c.chapter}
              </Text>
              <MapNode node={c.root} depth={0} />
            </View>
          ))}
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <Button title="🖨️ Print / Save PDF" size="sm" mode="light" onPress={exportCurrent} style={{ flex: 1, marginRight: 8 }} />
            <Button title="📤 Share" size="sm" mode="light" variant="secondary" onPress={shareCurrent} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function MapNode({ node, depth }) {
  const palette = ['#7C3AED', '#0891B2', '#F59E0B', '#10B981', '#EF4444', '#6366F1'];
  const color = palette[depth % palette.length];
  return (
    <View style={{ marginLeft: depth ? 14 : 0, borderLeftWidth: depth ? 1.5 : 0, borderLeftColor: '#E2E8F0', paddingLeft: depth ? 10 : 0, marginTop: 4 }}>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: depth === 0 ? 13 : 12, color: depth === 0 ? color : '#334155' }}>
        {depth === 0 ? '⭐ ' : '• '}{node.label}
      </Text>
      {(node.children || []).map((c, i) => (
        <MapNode key={i} node={c} depth={depth + 1} />
      ))}
    </View>
  );
}

function StepBtn({ icon, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? '#F8FAFC' : pressed ? '#EDE9FE' : '#F1F5F9',
        borderWidth: 1,
        borderColor: disabled ? '#F1F5F9' : '#E2E8F0',
      })}
    >
      <Ionicons name={icon} size={16} color={disabled ? '#CBD5E1' : '#6D28D9'} />
    </Pressable>
  );
}
