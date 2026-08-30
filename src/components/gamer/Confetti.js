// Lightweight confetti burst — ~22 particles, one Animated run,
// auto-cleans up. Cheap enough for low-end Android phones.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { mulberry32 } from '../../lib/utils';

const COLORS = ['#FFD700', '#7C3AED', '#06B6D4', '#10B981', '#EF4444', '#EC4899', '#F59E0B'];

export function Confetti({ trigger, count = 22, origin = { x: '50%', y: '38%' } }) {
  const [visible, setVisible] = useState(false);
  const anims = useRef(Array.from({ length: count }, () => new Animated.ValueXY({ x: 0, y: 0 }))).current;
  const fades = useRef(Array.from({ length: count }, () => new Animated.Value(1))).current;

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const rand = mulberry32(trigger);
    const parts = anims.map((a, i) => {
      const angle = rand() * Math.PI * 2;
      const speed = 45 + rand() * 95;
      a.setValue({ x: 0, y: 0 });
      fades[i].setValue(1);
      return Animated.parallel([
        Animated.timing(a, {
          toValue: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed - 36 },
          duration: 650 + rand() * 350,
          useNativeDriver: true,
          easing: Easing.out(Easing.quad),
        }),
        Animated.timing(fades[i], { toValue: 0, duration: 850, useNativeDriver: true, delay: 250 }),
      ]);
    });
    Animated.parallel(parts).start(() => setVisible(false));
  }, [trigger, anims, fades]);

  if (!visible) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: origin.x,
            top: origin.y,
            width: 8,
            height: 8,
            borderRadius: 2,
            backgroundColor: COLORS[i % COLORS.length],
            opacity: fades[i],
            transform: a.getTranslateTransform(),
          }}
        />
      ))}
    </View>
  );
}
