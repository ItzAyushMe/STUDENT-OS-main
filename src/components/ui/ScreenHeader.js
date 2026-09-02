// Screen header — back arrow + title (+ optional right action).
// Follows the active theme mode; pixel title in gamer mode.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePalette } from '../../context/ThemeContext';
import { fonts } from '../../config/theme';

export function ScreenHeader({ title, subtitle, onBack, right, mode, style }) {
  const theme = usePalette(mode);
  const isGamer = theme.mode === 'gamer';
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: 6,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          marginBottom: 12,
        },
        style,
      ]}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={({ pressed }) => [
            { padding: 6, marginRight: 6, borderRadius: 10, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={
            isGamer
              ? { fontFamily: fonts.pixel, fontSize: 12, color: theme.text, letterSpacing: 1 }
              : { fontFamily: fonts.bodySemiBold, fontSize: 20, color: theme.text }
          }
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: theme.subtext, marginTop: 3 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right || null}
    </View>
  );
}
