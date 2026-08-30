// Themed button — primary / secondary / ghost / danger.
// In gamer mode it gets a soft neon glow; pixel text optional.
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Platform } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { fonts, radius } from '../../config/theme';

const SIZES = {
  sm: { paddingVertical: 8, paddingHorizontal: 14, fontSize: 13 },
  md: { paddingVertical: 13, paddingHorizontal: 18, fontSize: 15 },
  lg: { paddingVertical: 16, paddingHorizontal: 22, fontSize: 16 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  mode,
  disabled,
  loading,
  icon,
  pixel = false,
  style,
  textStyle,
}) {
  const theme = usePalette(mode);
  const s = SIZES[size] || SIZES.md;
  const isGamer = theme.mode === 'gamer';

  const bg =
    variant === 'primary'
      ? theme.primary
      : variant === 'secondary'
      ? theme.card
      : variant === 'danger'
      ? theme.danger
      : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? theme.onPrimary
      : variant === 'ghost'
      ? theme.primary
      : theme.text;

  const glow =
    isGamer && variant === 'primary' && !disabled
      ? Platform.select({
          ios: { shadowColor: theme.primary, shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
          android: { elevation: 6 },
          default: { boxShadow: `0 0 14px ${theme.primary}` },
        })
      : {};

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: variant === 'ghost' ? 10 : radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: theme.border,
          ...s,
        },
        glow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {icon || null}
          {icon ? <View style={{ width: 7 }} /> : null}
          <Text
            style={[
              pixel && isGamer
                ? { fontFamily: fonts.pixel, fontSize: 10, letterSpacing: 0.5 }
                : { fontFamily: fonts.bodySemiBold, fontSize: s.fontSize },
              { color: fg },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
