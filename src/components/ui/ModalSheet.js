// Bottom-sheet style modal wrapper.
import { Modal, Pressable, Text, View } from 'react-native';
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
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
