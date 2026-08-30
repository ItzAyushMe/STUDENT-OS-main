// Empty states, loading indicator, section titles.
import { ActivityIndicator, Text, View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { fonts } from '../../config/theme';
import { Button } from './Button';

export function EmptyState({ icon = '🗺️', title, subtitle, actionLabel, onAction, mode }) {
  const theme = usePalette(mode);
  return (
    <View style={{ alignItems: 'center', paddingVertical: 34, paddingHorizontal: 18 }}>
      <Text style={{ fontSize: 44, marginBottom: 12 }}>{icon}</Text>
      <Text
        style={{
          fontFamily: fonts.bodySemiBold,
          fontSize: 16,
          color: theme.text,
          textAlign: 'center',
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 13.5,
            color: theme.subtext,
            textAlign: 'center',
            lineHeight: 19,
            marginBottom: 14,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} size="sm" mode={mode} />
      ) : null}
    </View>
  );
}

export function Loading({ text = 'Loading…', mode }) {
  const theme = usePalette(mode);
  return (
    <View style={{ alignItems: 'center', paddingVertical: 34 }}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: theme.subtext, marginTop: 12 }}>
        {text}
      </Text>
    </View>
  );
}

export function SectionTitle({ children, mode, right, style }) {
  const theme = usePalette(mode);
  const isGamer = theme.mode === 'gamer';
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 6 }, style]}>
      <Text
        style={
          isGamer
            ? { fontFamily: fonts.pixel, fontSize: 10, color: theme.text, letterSpacing: 1, flex: 1 }
            : { fontFamily: fonts.bodySemiBold, fontSize: 17, color: theme.text, flex: 1 }
        }
      >
        {children}
      </Text>
      {right || null}
    </View>
  );
}
