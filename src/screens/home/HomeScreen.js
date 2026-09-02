// HOME — Gamer mode base camp. XP, level, streak, today's quests,
// habits status, quote of the day, quick actions.
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { useSettings } from '../../context/SettingsContext';
import { aiDailyMessage, AIUnavailableError } from '../../lib/aiFeatures';
import { GAMER, fonts, radius } from '../../config/theme';
import { QUOTES, SESSION_TYPES, STUDY_ARCS, arcOf } from '../../config/constants';
import { db } from '../../lib/db';
import { todayStr, greeting, hashString, fmtDuration } from '../../lib/utils';
import { levelProgress, nextTier, tierForXp } from '../../lib/xpService';
import { PixelText } from '../../components/gamer/PixelText';
import { XPCounter, LevelBadge, StreakFlame, TierBadge } from '../../components/gamer/Badges';
import { Confetti } from '../../components/gamer/Confetti';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { useIsOnline } from '../../hooks/useIsOnline';

export function HomeScreen({ navigation }) {
  const { profile, updateProfile } = useAuth();
  const { awardXP, level, tier, totalXp, streak, freezes } = useGame();
  const settings = useSettings();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [todayQuests, setTodayQuests] = useState([]);
  const [habitStats, setHabitStats] = useState({ done: 0, total: 0 });
  const [dayStarted, setDayStarted] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [aiDailyMsg, setAiDailyMsg] = useState('');
  const [arcOpen, setArcOpen] = useState(false);

  const aiConfigured = settings.aiStatus?.anyConfigured;
  const aiDown = settings.aiHealth && settings.aiHealth.ok === false;

  const name = profile?.display_name || profile?.username || 'Champ';
  const today = todayStr();

  const load = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const [sched, habits, logs] = await Promise.all([
        db.list('schedule', { eq: { user_id: profile.id, date: today } }),
        db.list('habits', { eq: { user_id: profile.id, is_active: true } }),
        db.list('habit_logs', { eq: { user_id: profile.id, date: today } }),
      ]);
      setTodayQuests(sched.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))));
      const doneHabitIds = new Set(logs.filter((l) => l.completed).map((l) => l.habit_id));
      setHabitStats({ done: habits.filter((h) => doneHabitIds.has(h.id)).length, total: habits.length });
      const key = `sos.daystart.${profile.id}`;
      const val = await AsyncStorage.getItem(key);
      setDayStarted(val === today);
    } catch {
      /* ignore */
    }
  }, [profile?.id, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Personalized AI morning message — uses today's REAL plan + weak areas.
  // Cached per day; degrades silently when AI is offline.
  useEffect(() => {
    if (!profile?.id || !aiConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const cacheKey = `sos.aiDailyMsg.${profile.id}.${today}`;
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          if (!cancelled) setAiDailyMsg(cached);
          return;
        }
        // weak areas = subjects with most wrong answers in recent quizzes
        const recent = await db.list('quiz_results', { eq: { user_id: profile.id }, order: { col: 'created_at', asc: false }, limit: 12 });
        const wrongBySubject = {};
        for (const r of recent) {
          if (!r.subject) continue;
          const total = Number(r.total_questions) || 0;
          const right = Number(r.correct_answers ?? r.score) || 0; // M-1 (audit): column is correct_answers
          const wrong = Math.max(0, total - right);
          if (wrong > 0) wrongBySubject[r.subject] = (wrongBySubject[r.subject] || 0) + wrong;
        }
        const weakAreas = Object.entries(wrongBySubject)
          .sort((a, b) => b[1] - a[1])
          .map(([s]) => s);
        const msg = await aiDailyMessage({
          profile,
          todaySessions: todayQuests,
          weakAreas,
          streak,
          xp: totalXp,
          habitsPending: Math.max(0, habitStats.total - habitStats.done),
        });
        if (!cancelled && msg) {
          // FIX 1: keep the WHOLE message — the prompt already asks for 2-3
          // lines. Only an extreme safety cap, cut at a word boundary + ellipsis.
          const full = String(msg).trim();
          const capped = full.length <= 700 ? full : `${full.slice(0, 700).slice(0, full.slice(0, 700).lastIndexOf(' '))}…`;
          setAiDailyMsg(capped);
          AsyncStorage.setItem(cacheKey, capped).catch(() => {});
        }
      } catch {
        /* AI offline — the static quote below still shows */
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, aiConfigured, today, todayQuests.length, streak]);

  // STUDY ARCS — one-time opt-in invite after onboarding
  useEffect(() => {
    if (!profile?.id || !profile?.onboarded || profile?.arc?.id) return;
    (async () => {
      try {
        const asked = await AsyncStorage.getItem(`sos.arcPrompted.${profile.id}`);
        if (!asked) setArcOpen(true);
      } catch { /* ignore */ }
    })();
  }, [profile?.id, profile?.onboarded, profile?.arc?.id]);

  const joinArc = async (arc) => {
    setArcOpen(false);
    try {
      await AsyncStorage.setItem(`sos.arcPrompted.${profile.id}`, '1');
    } catch { /* ignore */ }
    try {
      await updateProfile({ arc: { id: arc.id, start_date: todayStr() } });
    } catch { /* ignore */ }
  };

  const skipArc = async () => {
    setArcOpen(false);
    try {
      await AsyncStorage.setItem(`sos.arcPrompted.${profile.id}`, '1');
    } catch { /* ignore */ }
  };

  const arc = arcOf(profile);
  const arcDay = arc ? Math.max(1, Math.min(arc.days, Math.round((new Date(today) - new Date(arc.startDate)) / 86400000) + 1)) : 0;

  const quote = QUOTES[hashString(today) % QUOTES.length];

  const startMyDay = async () => {
    if (!dayStarted) {
      await AsyncStorage.setItem(`sos.daystart.${profile.id}`, today);
      setDayStarted(true);
      setConfetti(Date.now());
      await awardXP('DAILY_LOGIN', { label: 'Day started' });
    }
    navigation.navigate('StudyTab', { screen: 'Schedule' });
  };

  const pendingStudy = todayQuests.filter((q) => q.status === 'pending' && q.session_type === 'study');
  const pendingSide = todayQuests.filter((q) => q.status === 'pending' && q.session_type !== 'study');
  const mainQuest = pendingStudy[0] || null;
  const sideQuest = pendingSide[0] || null;
  const questsDone = todayQuests.filter((q) => q.status === 'completed').length;

  const completeQuest = async (q) => {
    await db.update('schedule', q.id, { status: 'completed' });
    setTodayQuests((prev) => prev.map((x) => (x.id === q.id ? { ...x, status: 'completed' } : x)));
    setConfetti(Date.now());
    await awardXP('STUDY_QUEST');
  };

  const lp = levelProgress(totalXp);
  const nt = nextTier(totalXp);
  const curTier = tierForXp(totalXp);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: GAMER.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + 14,
        paddingHorizontal: 16,
        paddingBottom: 40,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Confetti trigger={confetti} origin={{ x: '50%', y: '25%' }} />

      {/* active study arc banner */}
      {arc ? (
        <Pressable
          onPress={() => navigation.navigate('StudyTab', { screen: 'Schedule' })}
          style={{
            backgroundColor: `${arc.theme}22`,
            borderWidth: 1,
            borderColor: `${arc.theme}66`,
            borderRadius: radius.lg,
            padding: 13,
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 20, marginRight: 9 }}>{arc.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: arc.theme }}>
                {arc.label} — Day {arcDay}/{arc.days}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginTop: 2 }}>
                Streak {streak}🔥 · no-zero days. Schedule arc mode mein chal raha hai.
              </Text>
            </View>
            <Text style={{ fontSize: 16 }}>{arcDay >= arc.days ? '🏆' : '⚡'}</Text>
          </View>
          <View style={{ height: 5, backgroundColor: `${arc.theme}22`, borderRadius: 3, marginTop: 9, overflow: 'hidden' }}>
            <View style={{ height: 5, width: `${Math.min(100, (arcDay / arc.days) * 100)}%`, backgroundColor: arc.theme }} />
          </View>
        </Pressable>
      ) : null}

      {/* offline banner */}
      {!online ? (
        <View
          style={{
            backgroundColor: 'rgba(245,158,11,0.12)',
            borderWidth: 1,
            borderColor: 'rgba(245,158,11,0.4)',
            borderRadius: 12,
            padding: 10,
            marginBottom: 14,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 15, marginRight: 8 }}>📴</Text>
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: GAMER.warn, lineHeight: 17 }}>
            You're offline — quests, timer, habits & quizzes (bank) are still working. AI needs internet.
          </Text>
        </View>
      ) : null}

      {/* AI not connected banner — visible reason, one tap to fix */}
      {!aiConfigured ? (
        <Pressable
          onPress={() => navigation.navigate('Settings')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: pressed ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.08)',
            borderWidth: 1,
            borderColor: 'rgba(245,158,11,0.45)',
            borderRadius: radius.md,
            padding: 10,
            marginBottom: 12,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Text style={{ fontSize: 15, marginRight: 8 }}>🤖</Text>
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: GAMER.warn, lineHeight: 17 }}>
            AI not connected — add your free API key to unlock Professor Byte, AI quizzes, plans & flashcards. Tap here →
          </Text>
          <Ionicons name="chevron-forward" size={16} color={GAMER.warn} />
        </Pressable>
      ) : aiDown ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(239,68,68,0.08)',
            borderWidth: 1,
            borderColor: 'rgba(239,68,68,0.45)',
            borderRadius: radius.md,
            padding: 10,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 15, marginRight: 8 }}>⚠️</Text>
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: GAMER.warn, lineHeight: 17 }}>
            AI key saved but the test call failed — check the key in Settings. Everything else keeps working.
          </Text>
        </View>
      ) : null}

      {/* AI daily message (personalized — class, plan, weak areas) */}
      {aiDailyMsg ? (
        <View
          style={{
            backgroundColor: GAMER.surface,
            borderWidth: 1,
            borderColor: GAMER.border,
            borderRadius: radius.lg,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 13, marginRight: 6 }}>🧠</Text>
            <PixelText size={7.5} color={GAMER.subtext}>
              PROFESSOR BYTE · TODAY
            </PixelText>
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.text, lineHeight: 19 }}>
            {aiDailyMsg}
          </Text>
        </View>
      ) : null}

      {/* greeting */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <PixelText size={9} color={GAMER.subtext}>
            {greeting().toUpperCase()} 👋
          </PixelText>
          <PixelText size={13} color={GAMER.text} style={{ marginTop: 8 }}>
            {name.toUpperCase()}
          </PixelText>
        </View>
        <Pressable
          onPress={() => navigation.navigate('Settings')}
          hitSlop={10}
          style={({ pressed }) => ({
            backgroundColor: GAMER.surface,
            borderWidth: 1,
            borderColor: GAMER.border,
            borderRadius: 12,
            padding: 9,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="settings-outline" size={20} color={GAMER.subtext} />
        </Pressable>
      </View>

      {/* XP card */}
      <View
        style={{
          backgroundColor: GAMER.surface,
          borderWidth: 1,
          borderColor: GAMER.border,
          borderRadius: radius.lg,
          padding: 18,
          marginBottom: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <LevelBadge level={level} size={52} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <XPCounter xp={totalXp} size={24} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <StreakFlame streak={streak} />
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginLeft: 10 }}>
                🧊 {freezes} freeze{freezes === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          <TierBadge tierName={curTier.name} small />
        </View>
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <PixelText size={7.5} color={GAMER.subtext}>
              LV {level} → {level + 1}
            </PixelText>
            <PixelText size={7.5} color={GAMER.gold}>
              {lp.into}/{lp.step} XP
            </PixelText>
          </View>
          <ProgressBar progress={lp.pct} mode="gamer" color={GAMER.gold} height={9} />
          {nt ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginTop: 8 }}>
              {(nt.min - totalXp).toLocaleString('en-IN')} XP to {nt.icon} {nt.name}
            </Text>
          ) : (
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.gold, marginTop: 8 }}>
              Grandmaster — you are the final boss now ⚡
            </Text>
          )}
        </View>
      </View>

      {/* today's quests */}
      <PixelText size={10} color={GAMER.text} style={{ marginBottom: 10 }}>
        TODAY'S QUESTS {questsDone > 0 ? `· ${questsDone} DONE` : ''}
      </PixelText>

      <QuestCard
        tag="MAIN QUEST"
        color={GAMER.primarySoft}
        quest={mainQuest}
        onComplete={() => completeQuest(mainQuest)}
        emptyText="No main quest today — generate a smart schedule?"
        onEmpty={() => navigation.navigate('StudyTab', { screen: 'Schedule' })}
      />
      <QuestCard
        tag="SIDE QUEST"
        color={GAMER.secondary}
        quest={sideQuest}
        onComplete={() => completeQuest(sideQuest)}
        emptyText={pendingStudy.length > 1 ? `+${pendingStudy.length - 1} more study quests pending` : 'Side quest slot khali hai — revise or quiz karo'}
        onEmpty={null}
      />

      {/* habits status */}
      <Pressable
        onPress={() => navigation.navigate('LifeTab', { screen: 'Habits' })}
        style={({ pressed }) => ({
          backgroundColor: GAMER.surface,
          borderWidth: 1,
          borderColor: GAMER.border,
          borderRadius: radius.lg,
          padding: 14,
          marginBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontSize: 24, marginRight: 12 }}>✅</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: GAMER.text }}>
            Habits: {habitStats.done}/{habitStats.total} done
          </Text>
          <ProgressBar
            progress={habitStats.total ? habitStats.done / habitStats.total : 0}
            mode="gamer"
            color={GAMER.accent}
            height={6}
            style={{ marginTop: 8, flex: 1 }}
          />
        </View>
        <Ionicons name="chevron-forward" size={18} color={GAMER.subtext} />
      </Pressable>

      {/* quote + start my day */}
      <View
        style={{
          backgroundColor: 'rgba(6,182,212,0.08)',
          borderWidth: 1,
          borderColor: 'rgba(6,182,212,0.35)',
          borderRadius: radius.lg,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <PixelText size={8} color={GAMER.secondary}>
          QUOTE OF THE DAY
        </PixelText>
        <Text
          style={{
            fontFamily: fonts.bodyMedium,
            fontSize: 14,
            color: GAMER.text,
            lineHeight: 21,
            marginTop: 10,
            fontStyle: 'italic',
          }}
        >
          “{quote.text}”
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 8 }}>
          — {quote.author}
        </Text>
        <Pressable
          onPress={startMyDay}
          disabled={dayStarted}
          style={({ pressed }) => ({
            marginTop: 14,
            backgroundColor: dayStarted ? GAMER.card : GAMER.secondary,
            borderWidth: 1,
            borderColor: dayStarted ? GAMER.border : GAMER.secondary,
            borderRadius: radius.md,
            paddingVertical: 13,
            alignItems: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <PixelText size={9} color={dayStarted ? GAMER.subtext : '#FFFFFF'}>
            {dayStarted ? 'DAY STARTED ✓ SHAABAASH!' : 'START MY DAY (+5 XP)'}
          </PixelText>
        </Pressable>
      </View>

      {/* daily challenge */}
      <Pressable
        onPress={() => navigation.navigate('StudyTab', { screen: 'Quiz', params: { mode: 'daily' } })}
        style={({ pressed }) => ({
          backgroundColor: 'rgba(255,215,0,0.07)',
          borderWidth: 1,
          borderColor: 'rgba(255,215,0,0.35)',
          borderRadius: radius.lg,
          padding: 16,
          marginBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontSize: 26, marginRight: 12 }}>⚔️</Text>
        <View style={{ flex: 1 }}>
          <PixelText size={8.5} color={GAMER.gold}>
            DAILY CHALLENGE
          </PixelText>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, marginTop: 6 }}>
            5 questions · bonus XP · streak boost
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={GAMER.gold} />
      </Pressable>

      {/* quick actions */}
      <PixelText size={9} color={GAMER.subtext} style={{ marginBottom: 10 }}>
        QUICK ACTIONS
      </PixelText>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <QuickAction
          icon="timer"
          label="Start Timer"
          onPress={() => navigation.navigate('FocusTab', { screen: 'FocusMain' })}
        />
        <QuickAction
          icon="checkmark-circle"
          label="Log Habit"
          onPress={() => navigation.navigate('LifeTab', { screen: 'Habits' })}
        />
        <QuickAction
          icon="sparkles"
          label="Ask AI"
          onPress={() => navigation.navigate('StudyTab', { screen: 'Tutor' })}
        />
      </View>

      {/* study arc opt-in (shown once, after onboarding) */}
      <Modal visible={arcOpen} transparent animationType="fade" onRequestClose={skipArc}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.72)', padding: 22, justifyContent: 'center' }} onPress={skipArc}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: GAMER.surface, borderWidth: 1, borderColor: GAMER.border, borderRadius: radius.lg, padding: 20 }}
          >
            <Text style={{ fontSize: 30, textAlign: 'center' }}>⚡</Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 17, color: GAMER.text, textAlign: 'center', marginTop: 8 }}>
              Take up a Study Arc?
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, textAlign: 'center', marginTop: 6, lineHeight: 17 }}>
              Ek challenge jo tumhare schedule ko tight kar deta hai — more hours, higher intensity, no-zero days.
            </Text>
            {STUDY_ARCS.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => joinArc(a)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: pressed ? `${a.theme}30` : `${a.theme}18`,
                  borderWidth: 1,
                  borderColor: `${a.theme}66`,
                  borderRadius: radius.md,
                  padding: 13,
                  marginTop: 12,
                })}
              >
                <Text style={{ fontSize: 24, marginRight: 11 }}>{a.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: a.theme }}>
                    {a.label} · {a.days} days
                  </Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginTop: 2, lineHeight: 15 }}>
                    {a.desc}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={a.theme} />
              </Pressable>
            ))}
            <Pressable onPress={skipArc} hitSlop={8} style={{ alignSelf: 'center', marginTop: 16, padding: 6 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: GAMER.subtext }}>
                Not now — maybe later
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function QuestCard({ tag, color, quest, onComplete, emptyText, onEmpty }) {
  const type = quest ? SESSION_TYPES[quest.session_type] || SESSION_TYPES.study : null;
  return (
    <View
      style={{
        backgroundColor: GAMER.surface,
        borderWidth: 1,
        borderColor: GAMER.border,
        borderRadius: radius.lg,
        padding: 14,
        marginBottom: 10,
        borderLeftWidth: 3,
        borderLeftColor: color,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <PixelText size={7.5} color={color}>
          {tag}
        </PixelText>
        {quest ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginLeft: 'auto' }}>
            {quest.start_time} · {fmtDuration(quest.duration_minutes)}
          </Text>
        ) : null}
      </View>
      {quest ? (
        <>
          <Text numberOfLines={2} style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: GAMER.text }}>
            {type.icon} {quest.topic || quest.subject}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, marginTop: 3 }}>
            {quest.subject}
          </Text>
          <Pressable
            onPress={onComplete}
            disabled={quest.status !== 'pending'}
            style={({ pressed }) => ({
              marginTop: 12,
              backgroundColor: quest.status === 'completed' ? GAMER.card : color,
              borderRadius: radius.md,
              paddingVertical: 11,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons
              name={quest.status === 'completed' ? 'checkmark-done' : 'play'}
              size={16}
              color={quest.status === 'completed' ? GAMER.accent : '#FFF'}
              style={{ marginRight: 7 }}
            />
            <PixelText size={8.5} color={quest.status === 'completed' ? GAMER.accent : '#FFFFFF'}>
              {quest.status === 'completed' ? 'DONE ✓ +30 XP' : 'COMPLETE  +30 XP'}
            </PixelText>
          </Pressable>
        </>
      ) : (
        <View>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, lineHeight: 19 }}>
            {emptyText}
          </Text>
          {onEmpty ? (
            <Pressable onPress={onEmpty} style={{ marginTop: 10 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: GAMER.secondary }}>
                Open Schedule →
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function QuickAction({ icon, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: GAMER.surface,
        borderWidth: 1,
        borderColor: GAMER.border,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        width: '31.5%',
        paddingVertical: 14,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={21} color={GAMER.primarySoft} />
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11.5, color: GAMER.text, marginTop: 7 }}>
        {label}
      </Text>
    </Pressable>
  );
}
