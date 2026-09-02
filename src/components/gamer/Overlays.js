// Global gamer-mode overlays: LEVEL UP! celebration + floating XP toasts.
// Rendered once at the root of the app; driven by GameContext.
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, View } from 'react-native';
import { GAMER, fonts, radius } from '../../config/theme';
import { PixelText } from './PixelText';
import { Confetti } from './Confetti';
import { Button } from '../ui/Button';
import { TIERS } from '../../config/constants';

export function LevelUpOverlay({ celebration, onDone }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (celebration) {
      pop.setValue(0.4);
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 }).start();
      const t = setTimeout(onDone, 4200);
      return () => clearTimeout(t);
    }
  }, [celebration, onDone, pop]);

  if (!celebration) return null;
  const tier = TIERS.find((t) => t.name === celebration.tier);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDone}>
      <Pressable
        onPress={onDone}
        style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.82)', alignItems: 'center', justifyContent: 'center' }}
      >
        <Confetti trigger={celebration.id} count={30} />
        <Animated.View
          style={{
            transform: [{ scale: pop }],
            alignItems: 'center',
            backgroundColor: GAMER.surface,
            borderWidth: 2,
            borderColor: GAMER.gold,
            borderRadius: radius.lg,
            paddingVertical: 30,
            paddingHorizontal: 34,
            width: '82%',
          }}
        >
          <PixelText size={13} color={GAMER.gold} glow align="center">
            LEVEL UP!
          </PixelText>
          <Text style={{ fontSize: 64, marginVertical: 12 }}>🎉</Text>
          <PixelText size={9} color={GAMER.subtext}>
            YOU ARE NOW
          </PixelText>
          <PixelText size={20} color={GAMER.primarySoft} glow style={{ marginTop: 10 }}>
            LV {celebration.level}
          </PixelText>
          {tier ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
              <Text style={{ fontSize: 16, marginRight: 6 }}>{tier.icon}</Text>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: tier.color }}>
                {tier.name} tier
              </Text>
            </View>
          ) : null}
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 13,
              color: GAMER.subtext,
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            Shaabaash! Aise hi grind karte raho. 🚀
          </Text>
          <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
            <Button
              title="Continue the quest"
              onPress={onDone}
              mode="gamer"
              pixel
              size="md"
            />
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export function XPToastStack({ toasts }) {
  if (!toasts || !toasts.length) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 54, left: 0, right: 0, alignItems: 'center' }}>
      {toasts.map((t) => (
        <XPToast key={t.id} toast={t} />
      ))}
    </View>
  );
}

function XPToast({ toast }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(rise, { toValue: 1, duration: 1100, useNativeDriver: true }),
    ]).start();
  }, [rise]);
  const opacity = rise.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [14, -18] });
  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }],
        backgroundColor: 'rgba(13,17,23,0.92)',
        borderWidth: 1,
        borderColor: GAMER.gold + '77',
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 16,
        marginBottom: 8,
      }}
    >
      <Text style={{ fontFamily: fonts.pixel, fontSize: 11, color: GAMER.gold }}>
        +{toast.amount} XP
        {toast.label ? <Text style={{ color: GAMER.subtext, fontFamily: fonts.body }}> · {toast.label}</Text> : null}
      </Text>
    </Animated.View>
  );
}
