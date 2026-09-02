// Text input + textarea + number stepper.
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePalette } from '../../context/ThemeContext';
import { fonts, radius } from '../../config/theme';

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  mode,
  keyboardType = 'default',
  secureTextEntry,
  autoCapitalize = 'none',
  right,
  hint,
  style,
}) {
  const theme = usePalette(mode);
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      {label ? (
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: theme.subtext, marginBottom: 6 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: theme.card,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.md,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 10 : 0,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.subtext}
          multiline={multiline}
          numberOfLines={multiline ? 4 : 1}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          style={{
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 15,
            color: theme.text,
            paddingVertical: multiline ? 6 : 12,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
        />
        {right || null}
      </View>
      {hint ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: theme.subtext, marginTop: 5 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Stepper({ label, value, onChange, min = 0, max = 12, step = 0.5, suffix = 'hrs', mode }) {
  const theme = usePalette(mode);
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const btn = (name, delta, disabled) => (
    <Pressable
      onPress={() => !disabled && onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(2))))}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: theme.card,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={name} size={20} color={theme.text} />
    </Pressable>
  );
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? (
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: theme.subtext, marginBottom: 6 }}>
          {label}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {btn('remove', -step, value <= min)}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 18, color: theme.text }}>
            {fmt(value)} {suffix}
          </Text>
        </View>
        {btn('add', step, value >= max)}
      </View>
    </View>
  );
}
