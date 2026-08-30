// Small selectable pill.
import { Pressable, Text, View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { fonts, radius } from '../../config/theme';

export function Chip({ label, selected, onPress, color, icon, mode, small }) {
  const theme = usePalette(mode);
  const accent = color || theme.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        {
          paddingVertical: small ? 5 : 7,
          paddingHorizontal: small ? 10 : 14,
          borderRadius: radius.pill,
          backgroundColor: selected ? accent : theme.card,
          borderWidth: 1,
          borderColor: selected ? accent : theme.border,
          opacity: pressed ? 0.7 : 1,
          marginRight: 8,
          marginBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
        },
      ]}
    >
      {icon ? <Text style={{ fontSize: 12, marginRight: 5 }}>{icon}</Text> : null}
      <Text
        style={{
          fontFamily: fonts.bodyMedium,
          fontSize: small ? 11.5 : 13,
          color: selected ? '#FFFFFF' : theme.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
