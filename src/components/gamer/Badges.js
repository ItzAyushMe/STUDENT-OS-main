// Gamer badges: XP counter, level badge, tier badge, streak flame.
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { GAMER, fonts } from '../../config/theme';
import { PixelText } from './PixelText';
import { TIERS } from '../../config/constants';

export function XPCounter({ xp, size = 22, showLabel = true }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <PixelText size={size} color={GAMER.gold} glow>
        {Number(xp || 0).toLocaleString('en-IN')}
      </PixelText>
      {showLabel ? (
        <PixelText size={size * 0.44} color={GAMER.gold} style={{ marginLeft: 6, marginBottom: 3 }} glow>
          XP
        </PixelText>
      ) : null}
    </View>
  );
}

export function LevelBadge({ level, size = 44 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: GAMER.primarySoft,
        backgroundColor: 'rgba(124,58,237,0.16)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.pixel, fontSize: size * 0.2, color: GAMER.subtext }}>LV</Text>
      <Text style={{ fontFamily: fonts.pixel, fontSize: size * 0.34, color: GAMER.primarySoft, marginTop: 2 }}>
        {level || 1}
      </Text>
    </View>
  );
}

export function TierBadge({ tierName, xp, small }) {
  const tier = TIERS.find((t) => t.name === tierName) || TIERS[0];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: tier.color + '66',
        borderRadius: 999,
        paddingVertical: small ? 3 : 5,
        paddingHorizontal: small ? 9 : 12,
      }}
    >
      <Text style={{ fontSize: small ? 10 : 12, marginRight: 5 }}>{tier.icon}</Text>
      <Text
        style={{
          fontFamily: fonts.bodySemiBold,
          fontSize: small ? 11 : 13,
          color: tier.color,
        }}
      >
        {tier.name}
      </Text>
      {xp != null ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginLeft: 6 }}>
          {Number(xp).toLocaleString('en-IN')}
        </Text>
      ) : null}
    </View>
  );
}

// 🔥 with a subtle, low-cost bounce loop
export function StreakFlame({ streak, size = 15 }) {
  const bounce = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(bounce, { toValue: 0, duration: 380, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
        Animated.delay(1500),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bounce]);
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  return (
    <Animated.View style={{ flexDirection: 'row', alignItems: 'center', transform: [{ translateY }] }}>
      <Text style={{ fontSize: size }}>🔥</Text>
      <Text
        style={{
          fontFamily: fonts.bodySemiBold,
          fontSize: 13,
          color: GAMER.warn,
          marginLeft: 4,
        }}
      >
        {streak || 0}d
      </Text>
    </Animated.View>
  );
}
