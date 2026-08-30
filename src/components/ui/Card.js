// Themed card — surface container, pressable when needed.
import { Pressable, View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { radius } from '../../config/theme';

export function Card({ children, style, onPress, mode, padded = true, testID }) {
  const theme = usePalette(mode);
  const base = {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    ...(padded ? { padding: 14 } : {}),
  };
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [base, { opacity: pressed ? 0.75 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[base, style]}>
      {children}
    </View>
  );
}
