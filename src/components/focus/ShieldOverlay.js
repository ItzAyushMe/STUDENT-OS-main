// Focus Shield overlay — soft nudge, not a hard block.
// 30-second "are you sure?" delay before leaving is allowed.
import { Modal, Pressable, Text, View } from 'react-native';
import { fonts, radius } from '../../config/theme';
import { Button } from '../ui/Button';

export function FocusShieldOverlay({ shield, onStay, onLeave }) {
  if (!shield) return null;
  const canLeave = shield.secondsLeft <= 0;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onStay}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(15,23,42,0.75)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 22,
        }}
      >
        <View
          style={{
            width: '100%',
            backgroundColor: '#FFFFFF',
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: '#FDE68A',
            padding: 22,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 46 }}>🛡️</Text>
          <Text
            style={{
              fontFamily: fonts.bodyBold,
              fontSize: 19,
              color: '#1E293B',
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            Focus Shield active!
          </Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 13.5,
              color: '#64748B',
              textAlign: 'center',
              lineHeight: 20,
              marginTop: 10,
            }}
          >
            Arre! Tumne {shield.reason} — but your quest is still running.{'\n'}
            Deep work > dopamine scroll. Tum kar loge! 💪
          </Text>

          <View
            style={{
              backgroundColor: '#FEF2F2',
              borderWidth: 1,
              borderColor: '#FECACA',
              borderRadius: radius.md,
              padding: 10,
              alignSelf: 'stretch',
              alignItems: 'center',
              marginTop: 16,
            }}
          >
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#DC2626' }}>
              Distraction logged · shield holds for {Math.max(0, shield.secondsLeft)}s
            </Text>
          </View>

          <Button title="Stay Focused 🎯" onPress={onStay} mode="light" size="lg" style={{ alignSelf: 'stretch', marginTop: 16 }} />
          <Pressable onPress={canLeave ? onLeave : undefined} disabled={!canLeave} style={{ marginTop: 12, padding: 6 }}>
            <Text
              style={{
                fontFamily: fonts.bodyMedium,
                fontSize: 13,
                color: canLeave ? '#DC2626' : '#CBD5E1',
              }}
            >
              {canLeave ? 'End session & leave' : `Leave anyway (wait ${shield.secondsLeft}s…)`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
