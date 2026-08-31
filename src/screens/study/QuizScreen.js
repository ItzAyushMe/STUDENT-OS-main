// QUIZ — quick (5), standard (10), daily challenge (5, same for
// everyone) and boss battle (10, hard). Works fully OFFLINE using
// the bundled bank + your flashcards; Layer 4 adds AI-generated
// questions on top. Results show strengths, weaknesses, XP.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Confetti } from '../../components/gamer/Confetti';
import { Loading } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { QUIZ_BANK, pickDailyArena, pickBankQuiz } from '../../lib/quizBank';
import { aiGenerateQuiz, AIUnavailableError } from '../../lib/aiFeatures';
import { aiStatus, isOnline } from '../../lib/aiService';
import { fonts, radius } from '../../config/theme';
import { todayStr, fmtClock, nowIso, seededShuffle } from '../../lib/utils';

const MODES = {
  quick: { label: 'Quick Quiz', count: 5, icon: '⚡', hint: '5 questions, warm-up' },
  standard: { label: 'Standard', count: 10, icon: '📘', hint: '10 questions' },
  daily: { label: 'Daily Challenge', count: 5, icon: '⚔️', hint: 'Same 5 for everyone today' },
  boss: { label: 'Boss Battle', count: 10, icon: '🐉', hint: 'Hard mode, big XP' },
};

export function QuizScreen({ navigation, route }) {
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [phase, setPhase] = useState('setup');
  const [mode, setMode] = useState(route?.params?.mode || 'quick');
  const [subjects, setSubjects] = useState([]);
  const [subject, setSubject] = useState(route?.params?.subject || 'Mixed');
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [topicStats, setTopicStats] = useState({});
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [confetti, setConfetti] = useState(0);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!profile?.id) return;
      db.list('syllabus', { eq: { user_id: profile.id } }).then((rows) => {
        setSubjects([...new Set(rows.map((r) => r.subject))]);
      });
    }, [profile?.id])
  );

  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ---------- question generation (AI first, offline fallback) ----------
  const buildQuestions = async () => {
    const cfg = MODES[mode];
    let qs = [];
    if (mode === 'daily') {
      // AI first (class-aware), static arena bank as offline fallback
      const status = aiStatus();
      if (status.anyConfigured && (await isOnline())) {
        try {
          const syllabusRows = await db.list('syllabus', { eq: { user_id: profile.id } });
          const chapters = syllabusRows.slice(0, 60).map((r) => r.chapter);
          const aiQs = await aiGenerateQuiz({
            subject: '',
            topic: '',
            count: cfg.count,
            difficulty: 'medium',
            profileContext: [profile?.class_level, profile?.board, profile?.prep_level].filter(Boolean).join(', '),
            syllabusChapters: chapters,
          });
          if (aiQs.length >= 3) return aiQs.slice(0, cfg.count);
        } catch {
          /* offline — fall to arena bank */
        }
      }
      qs = pickDailyArena(todayStr()).map((q) => ({ ...q, source: 'arena' }));
    } else {
      // 1) Try AI-generated questions (needs API key + internet)
      const status = aiStatus();
      if (status.anyConfigured && (await isOnline())) {
        try {
          // pull the student's OWN syllabus chapters for this subject
          const syllabusRows = await db.list('syllabus', { eq: { user_id: profile.id } });
          const trackRows = syllabusRows.filter(
            (r) => !r.track || r.track === 'class' || r.track === 'olympiad' || r.track === 'exam'
          );
          const chapters = (subject === 'Mixed'
            ? trackRows
            : trackRows.filter((r) => r.subject === subject)
          ).map((r) => r.chapter);
          const aiQs = await aiGenerateQuiz({
            subject: subject === 'Mixed' ? '' : subject,
            topic: route?.params?.topic || '',
            count: cfg.count,
            difficulty: mode === 'boss' ? 'hard' : 'medium',
            profileContext: [profile?.class_level, profile?.board, profile?.prep_level].filter(Boolean).join(', '),
            syllabusChapters: chapters,
          });
          if (aiQs.length >= Math.min(3, cfg.count)) {
            return aiQs.slice(0, cfg.count);
          }
        } catch (e) {
          if (!(e instanceof AIUnavailableError)) {
            // fall through to offline generation
          }
        }
      }

      // 2) flashcards of this subject -> MCQs (distractors from other cards)
      let cards = await db.list('flashcards', { eq: { user_id: profile.id } });
      if (subject !== 'Mixed') cards = cards.filter((c) => c.subject === subject);
      if (mode === 'boss') cards = cards.filter((c) => (c.mastery_level || 0) <= 3); // attack weak spots
      const pool = cards.length >= 4 ? cards : [];
      const fcQs = pool.map((c) => {
        const others = seededShuffle(cards.filter((x) => x.id !== c.id), c.id)
          .slice(0, 3)
          .map((x) => x.back_text);
        const options = seededShuffle([c.back_text, ...others], `${c.id}-opts`);
        return {
          subject: c.subject,
          topic: c.topic,
          difficulty: 2,
          q: c.front_text,
          options,
          answer: options.indexOf(c.back_text),
          explanation: 'From your flashcards 🃏',
          source: 'fc',
        };
      });
      // 3) bank questions
      const bankQs = pickBankQuiz({
        subject: subject === 'Mixed' ? null : subject,
        count: cfg.count + (mode === 'boss' ? 4 : 0),
        difficulty: mode === 'boss' ? 3 : null,
      }).map((q) => ({ ...q, source: 'bank' }));
      const bankBoss = mode === 'boss' ? pickBankQuiz({ count: 12 }).map((q) => ({ ...q, source: 'bank' })) : [];
      qs = seededShuffle([...fcQs, ...bankQs, ...bankBoss], `${mode}-${subject}-${todayStr()}-${Date.now()}`)
        .slice(0, cfg.count);
    }
    return qs;
  };

  const start = async () => {
    setLoading(true);
    try {
      const qs = await buildQuestions();
      setQuestions(qs);
      setQIndex(0);
      setSelected(null);
      setCorrectCount(0);
      setTopicStats({});
      setStartedAt(Date.now());
      setElapsed(0);
      setResult(null);
      setPhase('playing');
    } finally {
      setLoading(false);
    }
  };

  const answer = (i) => {
    if (selected != null) return;
    setSelected(i);
    const q = questions[qIndex];
    const isCorrect = i === q.answer;
    if (isCorrect) setCorrectCount((c) => c + 1);
    setTopicStats((t) => ({
      ...t,
      [q.topic || 'Mixed']: { correct: (t[q.topic || 'Mixed']?.correct || 0) + (isCorrect ? 1 : 0), total: (t[q.topic || 'Mixed']?.total || 0) + 1 },
    }));
  };

  const next = async () => {
    if (qIndex + 1 >= questions.length) {
      await finish();
    } else {
      setQIndex((i) => i + 1);
      setSelected(null);
    }
  };

  const finish = async () => {
    const total = questions.length;
    const correct = correctCount;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    const timeTaken = elapsed;

    // XP
    let xp = 0;
    if (mode === 'daily') {
      xp = correct * 10 + 20; // arena rules
      await awardXP('ARENA_COMPLETE', { amount: 20, label: 'Daily challenge done' });
      if (correct) await awardXP('ARENA_CORRECT', { amount: correct * 10, label: `${correct} correct` });
    } else {
      const base = mode === 'boss' ? 40 : 20;
      xp = base;
      await awardXP('QUIZ_COMPLETE', { amount: base, label: MODES[mode].label });
      if (accuracy >= 90) {
        xp += 50;
        await awardXP('QUIZ_EXCELLENT');
      }
    }

    const weak = Object.entries(topicStats)
      .filter(([, s]) => s.correct < s.total)
      .map(([t]) => t);
    const strong = Object.entries(topicStats)
      .filter(([, s]) => s.total >= 2 && s.correct === s.total)
      .map(([t]) => t);

    await db.insert('quiz_results', {
      user_id: profile.id,
      subject: subject === 'Mixed' ? null : subject,
      topic: null,
      mode: mode === 'daily' ? 'daily' : mode,
      total_questions: total,
      correct_answers: correct,
      accuracy,
      time_taken: timeTaken,
      xp_earned: xp,
      weak_topics: weak,
      created_at: nowIso(),
    });

    setResult({ total, correct, accuracy, timeTaken, xp, weak, strong });
    setPhase('results');
    if (accuracy >= 80) setConfetti(Date.now());
  };

  // ---------------- SETUP ----------------
  if (phase === 'setup') {
    return (
      <Screen mode="light">
        <ScreenHeader title="Quiz Arena" subtitle="Gyaan ka battleground 🧠" onBack={() => navigation.goBack()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {Object.entries(MODES).map(([key, m]) => (
            <ModeCard key={key} mKey={key} mode={m} selected={mode === key} onPress={() => setMode(key)} />
          ))}
        </View>

        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#64748B', marginVertical: 10 }}>Subject</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="🌍 Mixed" selected={subject === 'Mixed'} onPress={() => setSubject('Mixed')} mode="light" />
          {subjects.map((s) => (
            <Chip key={s} label={s} selected={subject === s} onPress={() => setSubject(s)} mode="light" />
          ))}
        </View>

        <Card mode="light" style={{ marginTop: 16, backgroundColor: '#F8FAFC' }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', lineHeight: 18 }}>
            {mode === 'daily'
              ? '⚔️ Daily Challenge: same 5 questions for ALL players today — global ranking in the Guild tab.'
              : 'Questions come from your flashcards + the built-in bank. AI-generated questions unlock in Layer 4 (add an API key in Settings).'}
          </Text>
        </Card>

        <Button
          title={`Start ${MODES[mode].label} 🚀`}
          mode="light"
          size="lg"
          loading={loading}
          onPress={start}
          style={{ marginTop: 16 }}
        />
      </Screen>
    );
  }

  // ---------------- PLAYING ----------------
  if (phase === 'playing') {
    const q = questions[qIndex];
    return (
      <Screen mode="light">
        <ScreenHeader title={`${MODES[mode].label}`} subtitle={`Q${qIndex + 1} of ${questions.length} · ${fmtClock(elapsed)}`} onBack={() => setPhase('setup')} />
        <ProgressBar progress={(qIndex + (selected != null ? 1 : 0)) / questions.length} mode="light" color="#6D28D9" style={{ marginBottom: 18 }} />
        <Card mode="light" style={{ marginBottom: 18, padding: 18 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#6D28D9', letterSpacing: 1, marginBottom: 10 }}>
            {q.subject?.toUpperCase()} · {q.topic?.toUpperCase()}
          </Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 17.5, color: '#1E293B', lineHeight: 26 }}>{q.q}</Text>
        </Card>

        {q.options.map((opt, i) => {
          const isCorrect = selected != null && i === q.answer;
          const isWrongPick = selected === i && i !== q.answer;
          return (
            <Pressable
              key={i}
              onPress={() => answer(i)}
              disabled={selected != null}
              style={({ pressed }) => ({
                backgroundColor: isCorrect ? '#ECFDF5' : isWrongPick ? '#FEF2F2' : '#FFFFFF',
                borderWidth: 1.5,
                borderColor: isCorrect ? '#34D399' : isWrongPick ? '#F87171' : '#E2E8F0',
                borderRadius: radius.md,
                padding: 14,
                marginBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                opacity: selected == null && pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: isCorrect ? '#10B981' : isWrongPick ? '#EF4444' : '#F1F5F9',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: isCorrect || isWrongPick ? '#FFF' : '#64748B' }}>
                  {String.fromCharCode(65 + i)}
                </Text>
              </View>
              <Text style={{ flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: '#1E293B', lineHeight: 20 }}>{opt}</Text>
              {isCorrect ? <Text style={{ fontSize: 16 }}>✅</Text> : null}
              {isWrongPick ? <Text style={{ fontSize: 16 }}>❌</Text> : null}
            </Pressable>
          );
        })}

        {selected != null ? (
          <Card mode="light" style={{ backgroundColor: '#F8FAFC' }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#475569', lineHeight: 18 }}>
              {selected === q.answer ? '🎉 Sahi jawab! ' : 'Oops — '}
              {q.explanation}
            </Text>
            <Button
              title={qIndex + 1 >= questions.length ? 'See Results →' : 'Next Question →'}
              size="sm"
              mode="light"
              onPress={next}
              style={{ marginTop: 12 }}
            />
          </Card>
        ) : null}
      </Screen>
    );
  }

  // ---------------- RESULTS ----------------
  const r = result;
  const verdict =
    r.accuracy >= 90 ? 'LEGENDARY! 🏆' : r.accuracy >= 70 ? 'Shaabaash! 🔥' : r.accuracy >= 50 ? 'Accha progress 👍' : 'Thoda aur practice 🌱';
  const reco = r.weak.length
    ? `Weak spots: ${r.weak.slice(0, 3).join(', ')}. In topics ke flashcards banao aur kal phir quiz do — spaced repetition karegi magic.`
    : 'Solid performance! Boss battle try karo ya agla chapter shuru karo.';

  return (
    <Screen mode="light">
      <Confetti trigger={confetti} origin={{ x: '50%', y: '22%' }} />
      <ScreenHeader title="Quiz Results" subtitle={MODES[mode].label} onBack={() => navigation.goBack()} />
      <Card mode="light" style={{ alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ fontSize: 44 }}>{r.accuracy >= 90 ? '🏆' : r.accuracy >= 70 ? '🔥' : r.accuracy >= 50 ? '🙂' : '🌱'}</Text>
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 40, color: r.accuracy >= 70 ? '#059669' : '#D97706', marginTop: 8 }}>
          {r.accuracy}%
        </Text>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#1E293B', marginTop: 6 }}>{verdict}</Text>
      </Card>

      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <ResBox icon="✅" value={`${r.correct}/${r.total}`} label="Correct" />
        <ResBox icon="⏱️" value={fmtClock(r.timeTaken)} label="Time" />
        <ResBox icon="⚡" value={`+${r.xp}`} label="XP earned" />
      </View>

      {r.strong.length ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#059669', marginBottom: 6 }}>💪 Strengths</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {r.strong.map((t) => (
              <View key={t} style={{ backgroundColor: '#D1FAE5', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 6 }}>
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#065F46' }}>{t}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {r.weak.length ? (
        <Card mode="light" style={{ marginBottom: 12, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#DC2626', marginBottom: 6 }}>🎯 Weak topics</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {r.weak.map((t) => (
              <View key={t} style={{ backgroundColor: '#FEE2E2', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 6 }}>
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#991B1B' }}>{t}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card mode="light" style={{ marginBottom: 14 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#0891B2', marginBottom: 6 }}>🤖 Professor Byte says</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#475569', lineHeight: 19 }}>{reco}</Text>
      </Card>

      <View style={{ flexDirection: 'row' }}>
        <Button title="Play Again" variant="secondary" size="md" mode="light" onPress={start} style={{ flex: 1, marginRight: 8 }} />
        <Button title="Done" size="md" mode="light" onPress={() => navigation.goBack()} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

function ModeCard({ mKey, mode, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: '48.5%',
        backgroundColor: selected ? '#EEF2FF' : '#FFFFFF',
        borderWidth: 1.5,
        borderColor: selected ? '#818CF8' : '#E2E8F0',
        borderRadius: radius.lg,
        padding: 14,
        marginBottom: 12,
        marginRight: (mKey === 'quick' || mKey === 'daily') ? 6 : 0,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 24, marginBottom: 8 }}>{mode.icon}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#1E293B' }}>{mode.label}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#64748B', marginTop: 3 }}>{mode.hint}</Text>
    </Pressable>
  );
}

function ResBox({ icon, value, label }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginHorizontal: 4 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#1E293B', marginTop: 4 }}>{value}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#64748B' }}>{label}</Text>
    </View>
  );
}
