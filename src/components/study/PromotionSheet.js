// FIX-S S5 — the Class 10 -> Class 11 promotion sheet.
// ONE component, used by both Schedule (opens on load) and Home (banner tap), so
// the decision is never implemented twice and can never drift apart.
// Everything it shows comes from lib/progression.js via the usePromotion hook:
// stream list, target class, chapter count, busy/error state.
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { usePalette } from '../../context/ThemeContext';
import { ModalSheet } from '../ui/ModalSheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { fonts, radius } from '../../config/theme';

function Line({ theme, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 7 }}>
      <Text style={{ fontSize: 12, marginRight: 8, lineHeight: 18 }}>•</Text>
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: theme.text, lineHeight: 18 }}>
        {children}
      </Text>
    </View>
  );
}

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
}) {
  const theme = usePalette();
  const [stream, setStream] = useState(null);
  const chosen = streams.includes(stream) ? stream : null;

  return (
    <ModalSheet visible={visible} onClose={onClose} title="🎓 Class 10 khatam — aage badho">
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: theme.text, marginBottom: 6 }}>
          Naya session shuru ho gaya hai (1 April). {toClass} mein move karein?
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: theme.subtext, lineHeight: 18, marginBottom: 12 }}>
          Class session 25 Feb ko khatam hua tha, isliye class track ka plan abhi ruka hua hai. Ek baar
          decide karo — baad mein Profile se class level kabhi bhi badal sakte ho.
        </Text>

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
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: theme.text, marginBottom: 8 }}>
            Accept karne par exactly yahi hoga:
          </Text>
          <Line theme={theme}>
            Class 10 ka poora map "Class 10 · Archived" section mein chala jayega — history (conquered
            chapters, progress) safe rahegi, planning/progress/trophy par zero asar.
          </Line>
          <Line theme={theme}>
            {toClass} ke {preset?.rowCount ?? 0} chapter import honge (existing combined {preset?.label || toClass} set).
          </Line>
          <Line theme={theme}>
            Class level {toClass} ho jayega. XP, streak, habits, workouts, Content Locker aur quiz history
            — kuch bhi touch nahi hoga.
          </Line>
          <Line theme={theme}>
            Class 10 ke school exams saved rahenge, lekin naye class plan ko drive nahi karenge. Olympiad
            aur competitive dates active rahenge.
          </Line>
        </View>

        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: theme.text, marginBottom: 8 }}>
          Stream chuno (abhi sirf label hai):
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
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
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: theme.subtext, lineHeight: 16, marginBottom: 12 }}>
          Stream-specific syllabus abhi nahi hai — teeno streams ko same combined {toClass} set milta hai.
          Stream sirf profile par label ki tarah save hoga.
        </Text>

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
          title={chosen ? `Move to ${toClass} · ${chosen}` : `Stream chuno to move to ${toClass}`}
          onPress={() => chosen && onAccept && onAccept(chosen)}
          disabled={!chosen || busy}
          loading={busy}
          size="md"
        />
        <View style={{ height: 8 }} />
        <Button
          title="Abhi nahi — class planning paused rakho"
          variant="ghost"
          size="sm"
          disabled={busy}
          onPress={() => onDecline && onDecline()}
        />
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: theme.subtext, marginTop: 8, lineHeight: 15 }}>
          "Abhi nahi" = class level wahi rahega, class track paused (zero class sessions), aur kal phir
          puchenge. Olympiad/competitive normal chalenge.
        </Text>
      </ScrollView>
    </ModalSheet>
  );
}
