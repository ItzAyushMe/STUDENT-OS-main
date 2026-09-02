// Simple lightweight progress bar (no heavy animation — low-end friendly).
import { View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { radius } from '../../config/theme';

export function ProgressBar({ progress = 0, color, mode, height = 8, trackColor, style }) {
  const theme = usePalette(mode);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return (
    <View
      style={[
        {
          height,
          borderRadius: radius.pill,
          backgroundColor: trackColor || theme.card,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.border,
        },
        style,
      ]}
    >
      <View
        style={{
          height: '100%',
          width: `${p * 100}%`,
          borderRadius: radius.pill,
          backgroundColor: color || theme.primary,
        }}
      />
    </View>
  );
}
