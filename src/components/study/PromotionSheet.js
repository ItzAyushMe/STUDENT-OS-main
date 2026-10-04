// FIX-ANCHOR D18 — short sheet + expandable consequences, present/future tense anchored to real date
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { ModalSheet } from '../ui/ModalSheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { fonts, radius } from '../../config/theme';

export function PromotionSheet({
  visible,
  onClose,
  streams = [],
  toClass = 'Class 11',
  preset = null,
  busy = false,
  error = '',
  onAccept,
  onDecline,
  anchor = null, // YYYY-MM-DD of class year end (25-Feb)
}) {
  const theme = usePalette();
  const [stream, setStream] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const chosen = streams.includes(stream) ? stream : null;

  const anchorText = anchor ? `Your ${'Class 10'} year ends ${anchor.split('-').reverse().join('-')}` : `Your Class 10 year ends 25-Feb`;

  return (
    <ModalSheet visible={visible} onClose={onClose} title={`🎓 Move to ${toClass}?`}>
      {/* 4 short lines max */}
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: theme.text, marginBottom: 4 }}>
        {anchorText}. Naya session 1 April se shuru hoga.
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: theme.subtext, lineHeight: 17, marginBottom: 4 }}>
        Abhi Class 10 mein ho — {toClass} mein move karna hai?
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 11, color: theme.subtext, lineHeight: 15, marginBottom: 10 }}>
        Stream chuno (label only): {streams.join(', ')}
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
        {streams.map((s) => (
          <Chip
            key={s}
            label={s}
            selected={chosen === s}
            onPress={() => setStream(chosen === s ? null : s)}
            color={theme.primary}
          />
        ))}
      </View>

      {/* Expandable What changes? */}
      <Pressable
        onPress={() => setShowDetails((v) => !v)}
        style={{
          backgroundColor: theme.card,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          marginBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: theme.text, flex: 1 }}>
          What changes? {showDetails ? '▲' : '▼'}
        </Text>
      </Pressable>

      {showDetails ? (
        <View
          style={{
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: radius.md,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: theme.text, lineHeight: 16, marginBottom: 6 }}>
            • Class 10 map "Class 10 · Archived" mein jayega — history safe, planning zero.
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: theme.text, lineHeight: 16, marginBottom: 6 }}>
            • {toClass} ke {preset?.rowCount ?? 0} chapters import honge.
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: theme.text, lineHeight: 16, marginBottom: 6 }}>
            • XP, streak, habits, workouts, Content Locker untouched.
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: theme.text, lineHeight: 16 }}>
            • School exams saved rahenge, planning nahi karenge.
          </Text>
        </View>
      ) : null}

      {!!error ? (
        <View
          style={{
            backgroundColor: `${theme.danger}18`,
            borderWidth: 1,
            borderColor: `${theme.danger}55`,
            borderRadius: radius.md,
            padding: 10,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: theme.danger, lineHeight: 17 }}>
            ⚠️ {error}
          </Text>
        </View>
      ) : null}

      <Button
        title={chosen ? `Move to ${toClass} · ${chosen}` : `Move to ${toClass}`}
        onPress={() => chosen && onAccept && onAccept(chosen)}
        disabled={!chosen || busy}
        loading={busy}
        size="md"
      />
      <View style={{ height: 8 }} />
      <Button
        title={`Stay in Class 10 till ${anchor ? anchor.split('-').reverse().join('-') : '25-Feb'}`}
        variant="ghost"
        size="sm"
        disabled={busy}
        onPress={() => onDecline && onDecline()}
      />
    </ModalSheet>
  );
}
