// Bottom-sheet style modal wrapper.
// FIX-UI1: the sheet body is a ScrollView inside a KeyboardAvoidingView — before
// this, {children} rendered raw inside a maxHeight:'85%' sheet, so anything below
// the fold (gym wizard Next, habit Save, locker Save) was UNREACHABLE on a phone
// and the keyboard hid modal inputs. Every sheet now scrolls and stays tappable
// (keyboardShouldPersistTaps="handled"); Android relies on the manifest
// softwareKeyboardLayoutMode:"resize" (FIX-UI2), iOS on behavior:'padding'.
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '../../context/ThemeContext';
import { fonts, radius } from '../../config/theme';

export function ModalSheet({ visible, onClose, title, mode = 'light', children, maxHeight = '85%' }) {
  const theme = usePalette(mode);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.55)' }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight,
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderWidth: 1,
            borderColor: theme.border,
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: insets.bottom + 18,
          }}
        >
          <View
            style={{
              width: 44,
              height: 5,
              borderRadius: 99,
              backgroundColor: theme.border,
              alignSelf: 'center',
              marginBottom: 12,
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Text
              style={{
                flex: 1,
                fontFamily: theme.mode === 'gamer' ? fonts.pixel : fonts.bodySemiBold,
                fontSize: theme.mode === 'gamer' ? 11 : 18,
                color: theme.text,
              }}
            >
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color={theme.subtext} />
            </Pressable>
          </View>
          {/* FIX-UI1: scrollable, keyboard-safe body. flexShrink lets the sheet
              cap at maxHeight and scroll instead of clipping; "handled" keeps
              buttons (Save/Next) tappable while the keyboard is open. The sheet
              container above already pads insets.bottom + 18, so the content
              container adds a flat 24 breathing room (handoff's 24 + insets
              intent, without doubling the inset). */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flexShrink: 1 }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
