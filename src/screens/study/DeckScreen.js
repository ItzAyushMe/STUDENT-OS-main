// DECK — study flashcards with flip animation and spaced
// repetition (SM-2 lite): Easy +3d×mastery, Medium +1d, Hard +4h.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { Screen } from '../../components/ui/Screen';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Confetti } from '../../components/gamer/Confetti';
import { EmptyState } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { fonts, radius } from '../../config/theme';
import { subjectColor, nowIso } from '../../lib/utils';

export function DeckScreen({ navigation, route }) {
  const { subject, topic } = route?.params || {};
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const [cards, setCards] = useState(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [done, setDone] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const flip = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const rows = await db.list('flashcards', { eq: { user_id: profile.id, subject, topic } });
    // due cards first, then the rest
    const now = new Date();
    rows.sort((a, b) => {
      const aDue = !a.next_review || new Date(a.next_review) <= now ? 0 : 1;
      const bDue = !b.next_review || new Date(b.next_review) <= now ? 0 : 1;
      return aDue - bDue;
    });
    setCards(rows);
    setIdx(0);
    setDone(false);
    setReviewed(0);
  }, [profile?.id, subject, topic]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    Animated.timing(flip, {
      toValue: flipped ? 1 : 0,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [flipped, flip]);

  const card = cards && cards[idx];

  const rate = async (level) => {
    if (!card) return;
    // SM-2 lite
    let mastery = card.mastery_level || 0;
    let next;
    if (level === 'easy') {
      mastery = Math.min(5, mastery + 1);
      next = new Date(Date.now() + Math.max(1, 3 * mastery) * 86400000);
    } else if (level === 'medium') {
      next = new Date(Date.now() + 1 * 86400000);
    } else {
      mastery = Math.max(0, mastery - 1);
      next = new Date(Date.now() + 4 * 3600000);
    }
    await db.update('flashcards', card.id, {
      mastery_level: mastery,
      next_review: next.toISOString(),
      times_reviewed: (card.times_reviewed || 0) + 1,
    });
    setReviewed((r) => r + 1);
    await awardXP('FLASHCARD_REVIEW');

    setFlipped(false);
    if (idx + 1 >= cards.length) {
      setDone(true);
      setConfetti(Date.now());
    } else {
      setIdx((i) => i + 1);
    }
  };

  const frontOpacity = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] });
  const backOpacity = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const color = subjectColor(subject);

  if (!cards) {
    return (
      <Screen mode="light">
        <ScreenHeader title={topic || 'Deck'} onBack={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen mode="light" scroll={false}>
      <Confetti trigger={confetti} origin={{ x: '50%', y: '30%' }} />
      <ScreenHeader title={topic || 'Deck'} subtitle={`${subject} · spaced repetition`} onBack={() => navigation.goBack()} />

      {done || !cards.length ? (
        <EmptyState
          icon={done ? '🎉' : '🃏'}
          title={done ? 'Deck complete!' : 'This deck is empty'}
          subtitle={
            done
              ? `${reviewed} cards reviewed — shaabaash! Mastery levels updated. Kal phir aana, spaced repetition yaad rakhta hai.`
              : 'Create cards from the Flashcards screen first.'
          }
          actionLabel={done ? 'Review Again' : 'Back to Decks'}
          onAction={() => (done ? load() : navigation.goBack())}
          mode="light"
        />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', flex: 1 }}>
              Card {idx + 1} / {cards.length} · {reviewed} reviewed
            </Text>
            <View style={{ flexDirection: 'row' }}>
              {[0, 1, 2, 3, 4].map((m) => (
                <View
                  key={m}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginHorizontal: 2,
                    backgroundColor: (card?.mastery_level || 0) > m ? color : '#E2E8F0',
                  }}
                />
              ))}
            </View>
          </View>

          {/* flip card */}
          <Pressable onPress={() => setFlipped((f) => !f)} style={{ flex: 1, justifyContent: 'center' }}>
            <Animated.View
              style={{
                transform: [{ rotateY: frontRotate }],
                opacity: frontOpacity,
                backfaceVisibility: 'hidden',
              }}
            >
              <Card mode="light" style={{ minHeight: 240, justifyContent: 'center', padding: 22, borderWidth: 2, borderColor: color + '55' }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color, letterSpacing: 1, marginBottom: 14, textAlign: 'center' }}>
                  QUESTION
                </Text>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 19, color: '#1E293B', textAlign: 'center', lineHeight: 28 }}>
                  {card.front_text}
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', textAlign: 'center', marginTop: 20 }}>
                  Tap to flip 🔄
                </Text>
              </Card>
            </Animated.View>

            <Animated.View
              style={{
                transform: [{ rotateY: backRotate }],
                opacity: backOpacity,
                backfaceVisibility: 'hidden',
                position: flipped ? 'relative' : 'absolute',
                top: flipped ? undefined : '50%',
                left: flipped ? undefined : 0,
                right: flipped ? undefined : 0,
              }}
              pointerEvents={flipped ? 'auto' : 'none'}
            >
              <Card mode="light" style={{ minHeight: 240, justifyContent: 'center', padding: 22, backgroundColor: '#F0FDFA', borderWidth: 2, borderColor: '#10B98155' }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 11, color: '#0891B2', letterSpacing: 1, marginBottom: 14, textAlign: 'center' }}>
                  ANSWER
                </Text>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 18, color: '#1E293B', textAlign: 'center', lineHeight: 27 }}>
                  {card.back_text}
                </Text>
              </Card>
            </Animated.View>
          </Pressable>

          {/* rating */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 }}>
            <RateButton label="😵 Hard" hint="4 hrs" color="#DC2626" disabled={!flipped} onPress={() => rate('hard')} />
            <RateButton label="😐 Medium" hint="1 day" color="#D97706" disabled={!flipped} onPress={() => rate('medium')} />
            <RateButton label="😄 Easy" hint="3d × lvl" color="#059669" disabled={!flipped} onPress={() => rate('easy')} />
          </View>
          {!flipped ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', textAlign: 'center', marginBottom: 8 }}>
              Flip the card, then rate how it went — +15 XP per card
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function RateButton({ label, hint, color, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 0.32,
        backgroundColor: disabled ? '#F8FAFC' : '#FFFFFF',
        borderWidth: 1.5,
        borderColor: disabled ? '#E2E8F0' : color + '66',
        borderRadius: radius.md,
        paddingVertical: 12,
        alignItems: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: disabled ? '#94A3B8' : color }}>{label}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: '#94A3B8', marginTop: 3 }}>{hint}</Text>
    </Pressable>
  );
}
