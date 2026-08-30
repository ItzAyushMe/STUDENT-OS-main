// Themed screen container — declares the screen's visual mode
// ('gamer' or 'light'), fades content in subtly on mount/switch.
import { useEffect, useRef } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';

export function Screen({
  mode = 'light',
  children,
  scroll = true,
  padded = true,
  style,
  contentContainerStyle,
}) {
  const theme = useTheme(mode);
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [mode, fade]);

  const base = [{ flex: 1, backgroundColor: theme.bg, opacity: fade }, style];

  if (!scroll) {
    return (
      <Animated.View style={[...base, padded && { paddingHorizontal: 16 }, { paddingTop: insets.top + 8 }]}>
        {children}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={base}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 },
          padded && { paddingHorizontal: 16 },
          contentContainerStyle,
        ]}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}
