// HOME — Gamer mode base camp. XP, level, streak, today's quests,
// habits status, quote of the day, quick actions.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { GAMER, fonts, radius } from '../../config/theme';
import { QUOTES, SESSION_TYPES } from '../../config/constants';
import { db } from '../../lib/db';
import { todayStr, greeting, hashString, fmtDuration } from '../../lib/utils';
import { levelProgress, nextTier, tierForXp } from '../../lib/xpService';
import { PixelText } from '../../components/gamer/PixelText';
import { XPCounter, LevelBadge, StreakFlame, TierBadge } from '../../components/gamer/Badges';
import { Confetti } from '../../components/gamer/Confetti';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { useIsOnline } from '../../hooks/useIsOnline';

export function HomeScreen({ navigation }) {
  const { profile } = useAuth();
  const { awardXP, level, tier, totalXp, streak, freezes } = useGame();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [todayQuests, setTodayQuests] = useState([]);
  const [habitStats, setHabitStats] = useState({ done: 0, total: 0 });
  const [dayStarted, setDayStarted] = useState(false);
  const [confetti, setConfetti] = useState(0);

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
