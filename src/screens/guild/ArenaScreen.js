// DAILY ARENA — the same 5 questions for every player each day
// (date-seeded). 15s per question, +10 XP per correct, +20 finish
// bonus, global ranking for the day.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { useTheme } from '../../context/ThemeContext';
import { GAMER, fonts, radius } from '../../config/theme';
import { pickDailyArena } from '../../lib/quizBank';
import { demoArenaBoard } from '../../lib/guildData';
import { db, isRemote } from '../../lib/db';
import { PixelText } from '../../components/gamer/PixelText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Confetti } from '../../components/gamer/Confetti';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { todayStr, fmtClock, nowIso } from '../../lib/utils';

const PER_Q_SECONDS = 15;

export function ArenaScreen({ navigation }) {
  useTheme('gamer');
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState('intro'); // intro | play | result
  const [qIndex, setQIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [selected, setSelected] = useState(null);
  const [timeLeft, setTimeLeft] = useState(PER_Q_SECONDS);
  const [totalTime, setTotalTime] = useState(0);
  const [confetti, setConfetti] = useState(0);
  const [board, setBoard] = useState(null);

  const questions = pickDailyArena(todayStr());

  useEffect(() => {
    if (phase !== 'play' || selected != null) return;
    if (timeLeft <= 0) {
      setSelected(-1); // timeout
      return;
    }
    const t = setTimeout(() => {
      setTimeLeft((s) => s - 1);
      setTotalTime((s) => s + 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, selected]);

  const start = () => {
    setPhase('play');
    setQIndex(0);
    setCorrect(0);
    setSelected(null);
    setTimeLeft(PER_Q_SECONDS);
    setTotalTime(0);
  };

  const answer = (i) => {
    if (selected != null) return;
    setSelected(i);
    if (i === questions[qIndex].answer) setCorrect((c) => c + 1);
  };

  const next = async () => {
    if (qIndex + 1 >= questions.length) {
      await finish();
    } else {
      setQIndex((i) => i + 1);
      setSelected(null);
      setTimeLeft(PER_Q_SECONDS);
    }
  };

  const finish = async () => {
    setPhase('result');
    if (correct >= 3) setConfetti(Date.now());
    await db.insert('quiz_results', {
      user_id: profile.id,
      subject: null,
      topic: null,
      mode: 'arena',
      total_questions: questions.length,
      correct_answers: correct,
      accuracy: Math.round((correct / questions.length) * 100),
      time_taken: totalTime,
      xp_earned: correct * 10 + 20,
      weak_topics: [],
      created_at: nowIso(),
    });
    await awardXP('ARENA_COMPLETE', { amount: 20, label: 'Arena complete' });
    if (correct > 0) await awardXP('ARENA_CORRECT', { amount: correct * 10, label: `${correct} correct` });
    // load board
    let myEntry = { id: profile.id, name: profile.display_name || 'You', correct, time: totalTime, emoji: '🫵' };
    let rows = [];
    if (isRemote()) {
      try {
        const results = await db.list('quiz_results', { eq: { mode: 'arena' }, gte: { created_at: `${todayStr()}T00:00:00` } });
        const mine = results.filter((r) => r.user_id === profile.id);
        if (mine.length) {
          myEntry = { ...myEntry, correct: Math.max(correct, ...mine.map((m) => m.correct_answers)), time: Math.min(...mine.map((m) => m.time_taken || 999)) };
        }
        const users = await db.list('users', {});
        const nameOf = {};
        users.forEach((u) => (nameOf[u.id] = u.display_name || u.username || 'Player'));
        const grouped = {};
        results.forEach((r) => {
          const g = grouped[r.user_id] || { id: r.user_id, name: nameOf[r.user_id] || 'Player', correct: 0, time: 999 };
          g.correct = Math.max(g.correct, r.correct_answers);
          g.time = Math.min(g.time, r.time_taken || 999);
          grouped[r.user_id] = g;
        });
        rows = Object.values(grouped);
      } catch (e) {
        rows = [];
      }
    } else {
      rows = null; // use demo
    }
    if (rows) {
      rows.sort((a, b) => b.correct - a.correct || a.time - b.time);
      setBoard(rows.slice(0, 12).map((r, i) => ({ ...r, rank: i + 1, me: r.id === profile.id })));
    } else {
      setBoard(demoArenaBoard(todayStr(), myEntry));
    }
  };

  const q = questions[qIndex];

  return (
    <View style={{ flex: 1, backgroundColor: GAMER.bg, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
      <Confetti trigger={confetti} origin={{ x: '50%', y: '20%' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ padding: 6, marginRight: 6 }}>
          <Text style={{ color: GAMER.text, fontSize: 22 }}>‹</Text>
        </Pressable>
        <PixelText size={11} color={GAMER.gold} glow>
          DAILY ARENA ⚔️
        </PixelText>
      </View>

      {/* ---------------- INTRO ---------------- */}
      {phase === 'intro' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <Card mode="gamer" style={{ marginBottom: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 50 }}>⚔️</Text>
            <PixelText size={9} color={GAMER.text} style={{ marginTop: 14 }}>
              TODAY'S GAUNTLET
            </PixelText>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, marginTop: 10, textAlign: 'center', lineHeight: 19 }}>
              5 questions · 15 seconds each{'\n'}Sab players ke same questions — ek hi din, ek hi battlefield.
            </Text>
          </Card>
          <Card mode="gamer" style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: GAMER.gold, marginBottom: 6 }}>XP on the line</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.text, lineHeight: 19 }}>
              ⚡ +10 XP per correct answer{'\n'}🏆 +20 XP for finishing{'\n'}📅 New set every day — rank resets daily
            </Text>
          </Card>
          <Button title="ENTER THE ARENA 🚀" mode="gamer" pixel size="lg" onPress={start} />
        </ScrollView>
      ) : null}

      {/* ---------------- PLAY ---------------- */}
      {phase === 'play' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, flex: 1 }}>
              Q{qIndex + 1}/{questions.length} · ✅ {correct}
            </Text>
            <Text style={{ fontFamily: fonts.pixel, fontSize: 12, color: timeLeft <= 5 ? GAMER.danger : GAMER.secondary }}>
              {String(timeLeft).padStart(2, '0')}s
            </Text>
          </View>
          <ProgressBar progress={timeLeft / PER_Q_SECONDS} mode="gamer" color={timeLeft <= 5 ? GAMER.danger : GAMER.secondary} style={{ marginBottom: 18 }} />

          <Card mode="gamer" style={{ marginBottom: 18 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.secondary, letterSpacing: 1, marginBottom: 10 }}>
              {q.subject?.toUpperCase()} · {q.topic?.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 17, color: GAMER.text, lineHeight: 26 }}>{q.q}</Text>
          </Card>

          {q.options.map((opt, i) => {
            const isCorrect = selected != null && i === q.answer;
            const isWrong = selected === i && i !== q.answer;
            return (
              <Pressable
                key={i}
                onPress={() => answer(i)}
                disabled={selected != null}
                style={{
                  backgroundColor: isCorrect ? 'rgba(16,185,129,0.15)' : isWrong ? 'rgba(239,68,68,0.15)' : GAMER.surface,
                  borderWidth: 1.5,
                  borderColor: isCorrect ? GAMER.accent : isWrong ? GAMER.danger : GAMER.border,
                  borderRadius: radius.md,
                  padding: 14,
                  marginBottom: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: GAMER.secondary, marginRight: 12 }}>
                  {String.fromCharCode(65 + i)}
                </Text>
                <Text style={{ flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: GAMER.text }}>{opt}</Text>
                {isCorrect ? <Text>✅</Text> : null}
                {isWrong ? <Text>❌</Text> : null}
              </Pressable>
            );
          })}

          {selected != null ? (
            <Card mode="gamer" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, lineHeight: 18 }}>
                {selected === q.answer ? '🎉 Sahi! ' : selected === -1 ? '⏰ Time up! ' : '❌ Galat. '}
                {q.explanation}
              </Text>
              <Button title={qIndex + 1 >= questions.length ? 'Finish ⚔️' : 'Next →'} size="sm" mode="gamer" onPress={next} style={{ marginTop: 12 }} />
            </Card>
          ) : null}
        </ScrollView>
      ) : null}

      {/* ---------------- RESULT ---------------- */}
      {phase === 'result' && board ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <Card mode="gamer" style={{ alignItems: 'center', marginBottom: 14 }}>
            <PixelText size={16} color={correct >= 4 ? GAMER.gold : GAMER.text} glow>
              {correct}/5 CORRECT
            </PixelText>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, marginTop: 10 }}>
              {fmtClock(totalTime)} total · +{correct * 10 + 20} XP earned
            </Text>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.accent, marginTop: 8 }}>
              {correct === 5 ? 'FLAWLESS VICTORY! 👑' : correct >= 3 ? 'Solid fight! 🔥' : 'Kal phir — practice makes power 💪'}
            </Text>
          </Card>

          <PixelText size={9} color={GAMER.subtext} style={{ marginBottom: 10 }}>
            TODAY'S GLOBAL RANKING
          </PixelText>
          {board.slice(0, 8).map((row) => (
            <View
              key={row.id}
              style={{
                backgroundColor: row.me ? 'rgba(124,58,237,0.16)' : GAMER.surface,
                borderWidth: 1,
                borderColor: row.me ? GAMER.primarySoft : GAMER.border,
                borderRadius: radius.md,
                padding: 11,
                marginBottom: 7,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.pixel, fontSize: 10, color: row.rank <= 3 ? GAMER.gold : GAMER.subtext, width: 32 }}>
                #{row.rank}
              </Text>
              <Text style={{ fontSize: 16, marginRight: 9 }}>{row.emoji || '🎮'}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: GAMER.text }}>
                {row.name} {row.me ? '(you)' : ''}
              </Text>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: GAMER.secondary }}>
                {row.correct}/5 · {row.time}s
              </Text>
            </View>
          ))}
          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginTop: 8, lineHeight: 16 }}>
            {isRemote() ? 'Live board from all StudentOS players today.' : 'Demo rivals (local mode). Cloud mode = real global board.'}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
