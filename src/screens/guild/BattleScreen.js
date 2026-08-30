// BATTLES — challenge a friend to the same timed quiz.
// Same seeded question set for both players; winner takes a
// +60 XP bonus. Local mode battles vs demo rivals.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { useTheme } from '../../context/ThemeContext';
import { GAMER, fonts, radius } from '../../config/theme';
import { db, isRemote } from '../../lib/db';
import { DEMO_RIVALS } from '../../lib/guildData';
import { QUIZ_BANK } from '../../lib/quizBank';
import { PixelText } from '../../components/gamer/PixelText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Confetti } from '../../components/gamer/Confetti';
import { uuid, nowIso, hashString, fmtClock, seededShuffle } from '../../lib/utils';

const PER_Q_SECONDS = 20;
const BATTLE_COUNT = 5;

export function BattleScreen({ navigation }) {
  useTheme('gamer');
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState('pick'); // pick | play | result
  const [opponent, setOpponent] = useState(null);
  const [friends, setFriends] = useState([]);
  const [battleId, setBattleId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(PER_Q_SECONDS);
  const [totalTime, setTotalTime] = useState(0);
  const [rivalScore, setRivalScore] = useState(null);
  const [confetti, setConfetti] = useState(0);

  const loadFriends = useCallback(async () => {
    if (!profile?.id) return;
    const fr = await db.list('friends', { eq: { user_id: profile.id, status: 'accepted' } });
    const list = fr.map((f) => ({ id: f.friend_id, name: f.friend_name || 'Player', emoji: '🎮' }));
    if (!list.length && !isRemote()) {
      setFriends(DEMO_RIVALS.map((r) => ({ id: r.id, name: r.display_name, emoji: r.emoji, demo: true })));
    } else {
      setFriends(list);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { loadFriends(); }, [loadFriends]));

  // battle timer
  useEffect(() => {
    if (phase !== 'play' || selected != null) return;
    if (timeLeft <= 0) {
      setSelected(-1);
      return;
    }
    const t = setTimeout(() => {
      setTimeLeft((s) => s - 1);
      setTotalTime((s) => s + 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, selected]);

  const startBattle = (opp) => {
    const id = uuid();
    setOpponent(opp);
    setBattleId(id);
    // same set for both players — seeded by battle id
    const set = seededShuffle(QUIZ_BANK, id).slice(0, BATTLE_COUNT);
    setQuestions(set);
    // rival's score: deterministic from battle id + rival (as if they played the same set)
    const luck = hashString(`${id}-${opp.id}`) % 100;
    const skill = 55 + (hashString(opp.id) % 30); // 55-84% skill
    const rivalCorrect = Math.max(0, Math.min(BATTLE_COUNT, Math.round((skill / 100) * BATTLE_COUNT + (luck > 85 ? 1 : luck < 15 ? -1 : 0))));
    setRivalScore(rivalCorrect);
    setPhase('play');
    setQIndex(0);
    setSelected(null);
    setCorrect(0);
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
    const won = correct > rivalScore;
    const tie = correct === rivalScore;
    setPhase('result');
    if (won) setConfetti(Date.now());
    await db.insert('quiz_results', {
      user_id: profile.id,
      subject: null,
      topic: opponent?.name,
      mode: 'battle',
      total_questions: questions.length,
      correct_answers: correct,
      accuracy: Math.round((correct / questions.length) * 100),
      time_taken: totalTime,
      xp_earned: 25 + (won ? 60 : 0),
      weak_topics: [],
      created_at: nowIso(),
    });
    await awardXP('BATTLE_COMPLETE', { amount: 25, label: 'Battle fought' });
    if (won) await awardXP('BATTLE_WIN');
  };

  const q = questions[qIndex];

  return (
    <View style={{ flex: 1, backgroundColor: GAMER.bg, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
      <Confetti trigger={confetti} origin={{ x: '50%', y: '20%' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ padding: 6, marginRight: 6 }}>
          <Text style={{ color: GAMER.text, fontSize: 22 }}>‹</Text>
        </Pressable>
        <PixelText size={11} color={GAMER.secondary} glow>
          BATTLE MODE 🤺
        </PixelText>
      </View>

      {/* ---------------- PICK OPPONENT ---------------- */}
      {phase === 'pick' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <Card mode="gamer" style={{ marginBottom: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 44 }}>🤺</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, marginTop: 12, textAlign: 'center', lineHeight: 19 }}>
              Ek dost ko challenge karo — same questions, same timer.{'\n'}Winner gets +60 XP bonus. Loser gets gyaan 😄
            </Text>
          </Card>
          <PixelText size={9} color={GAMER.subtext} style={{ marginBottom: 10 }}>
            CHOOSE YOUR RIVAL
          </PixelText>
          {friends.map((f) => (
            <Card key={f.id} mode="gamer" onPress={() => startBattle(f)} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(6,182,212,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Text style={{ fontSize: 20 }}>{f.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: GAMER.text }}>{f.name}</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 2 }}>
                    {f.demo ? 'Demo rival (local mode)' : 'Friend'}
                  </Text>
                </View>
                <PixelText size={8} color={GAMER.secondary}>
                  FIGHT →
                </PixelText>
              </View>
            </Card>
          ))}
          {!friends.length ? (
            <Card mode="gamer">
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, textAlign: 'center' }}>
                Pehle Guild tab se dost add karo, phir battle ka maza! 🤝
              </Text>
            </Card>
          ) : null}
        </ScrollView>
      ) : null}

      {/* ---------------- PLAY ---------------- */}
      {phase === 'play' && q ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, flex: 1 }}>
              vs {opponent.name} · Q{qIndex + 1}/{questions.length} · ✅ {correct}
            </Text>
            <Text style={{ fontFamily: fonts.pixel, fontSize: 12, color: timeLeft <= 5 ? GAMER.danger : GAMER.secondary }}>
              {String(timeLeft).padStart(2, '0')}s
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: GAMER.card, marginBottom: 18 }}>
            <View style={{ height: '100%', width: `${(timeLeft / PER_Q_SECONDS) * 100}%`, borderRadius: 3, backgroundColor: timeLeft <= 5 ? GAMER.danger : GAMER.secondary }} />
          </View>

          <Card mode="gamer" style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 10, color: GAMER.secondary, letterSpacing: 1, marginBottom: 10 }}>
              {q.subject?.toUpperCase()} · {q.topic?.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16.5, color: GAMER.text, lineHeight: 25 }}>{q.q}</Text>
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
                  padding: 13,
                  marginBottom: 9,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: GAMER.secondary, marginRight: 12 }}>
                  {String.fromCharCode(65 + i)}
                </Text>
                <Text style={{ flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13.5, color: GAMER.text }}>{opt}</Text>
              </Pressable>
            );
          })}

          {selected != null ? (
            <Button title={qIndex + 1 >= questions.length ? 'Reveal Winner 🏆' : 'Next →'} size="sm" mode="gamer" onPress={next} />
          ) : null}
        </ScrollView>
      ) : null}

      {/* ---------------- RESULT ---------------- */}
      {phase === 'result' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <Card mode="gamer" style={{ alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 48 }}>{correct > rivalScore ? '🏆' : correct === rivalScore ? '🤝' : '😤'}</Text>
            <PixelText size={13} color={correct > rivalScore ? GAMER.gold : GAMER.text} glow style={{ marginTop: 12 }}>
              {correct > rivalScore ? 'VICTORY!' : correct === rivalScore ? 'DRAW!' : 'DEFEATED'}
            </PixelText>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
              <ScoreSide name={profile?.display_name || 'You'} emoji="🫵" score={correct} me />
              <Text style={{ fontFamily: fonts.pixel, fontSize: 12, color: GAMER.subtext, marginHorizontal: 16 }}>VS</Text>
              <ScoreSide name={opponent.name} emoji={opponent.emoji} score={rivalScore} />
            </View>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, marginTop: 16 }}>
              {fmtClock(totalTime)} total · +{25 + (correct > rivalScore ? 60 : 0)} XP earned
            </Text>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: GAMER.accent, marginTop: 8, textAlign: 'center', lineHeight: 18 }}>
              {correct > rivalScore
                ? 'Shaabaash! Winner XP bank ho gaya. Rematch?'
                : correct === rivalScore
                ? 'Barabari! Dono ko respect — rematch settle karega.'
                : 'Koi baat nahi — revânge is a dish best served revised 😤'}
            </Text>
          </Card>
          <View style={{ flexDirection: 'row' }}>
            <Button title="Rematch 🔁" variant="secondary" size="md" mode="gamer" onPress={() => startBattle(opponent)} style={{ flex: 1, marginRight: 8 }} />
            <Button title="Done" size="md" mode="gamer" onPress={() => navigation.goBack()} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function ScoreSide({ name, emoji, score, me }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 26 }}>{emoji}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: me ? GAMER.primarySoft : GAMER.text, marginTop: 5 }}>
        {name}
      </Text>
      <PixelText size={16} color={me ? GAMER.primarySoft : GAMER.secondary} style={{ marginTop: 8 }}>
        {score}
      </PixelText>
    </View>
  );
}
