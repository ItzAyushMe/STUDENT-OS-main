// Segmented control (e.g. Daily / Weekly / Monthly).
import { Pressable, Text, View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { fonts, radius } from '../../config/theme';

export function SegmentedControl({ options, value, onChange, mode, style }) {
  const theme = usePalette(mode);
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: theme.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.border,
          padding: 4,
        },
        style,
      ]}
    >
      {options.map((opt) => {
        const key = typeof opt === 'string' ? opt : opt.key;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: radius.sm,
              backgroundColor: active ? theme.primary : 'transparent',
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.bodySemiBold,
                fontSize: 13,
                color: active ? '#FFFFFF' : theme.subtext,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
