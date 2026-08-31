// ============================================================
// StudentOS — ErrorBoundary
// Without this, ANY render crash = blank white screen and the
// whole app looks dead. With this, the app shows a friendly
// recovery card with the actual error message + one-tap recovery.
// ============================================================
import React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { fonts, radius } from '../../config/theme';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // full details in the console for debugging
    console.error('[StudentOS] screen crashed:', error?.message || error, info?.componentStack || '');
  }

  reset = () => this.setState({ error: null });

  reload = () => {
    if (Platform.OS === 'web' && typeof location !== 'undefined') {
      location.reload();
    } else {
      this.setState({ error: null });
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const msg = String(error?.message || error || 'Unknown error').slice(0, 400);

    return (
      <View style={{ flex: 1, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ScrollView style={{ width: '100%', maxWidth: 460 }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 20 }}>
          <Text style={{ fontSize: 54 }}>🛠️</Text>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 18, color: '#1E293B', marginTop: 14, textAlign: 'center' }}>
            Arre! Something broke
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 8, lineHeight: 19 }}>
            Tumhara data safe hai. Neeche wale buttons se app wapas chal jayegi — aur agar ye baar-baar aaye, to error
            message screenshot karke bhejo taaki hum pakka fix kar dein.
          </Text>

          <View
            style={{
              width: '100%',
              backgroundColor: '#FEF2F2',
              borderWidth: 1,
              borderColor: '#FECACA',
              borderRadius: radius.md,
              padding: 12,
              marginTop: 16,
            }}
          >
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 10, color: '#B91C1C', marginBottom: 4 }}>
              ERROR DETAILS (screenshot this if it repeats)
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#7F1D1D', lineHeight: 16 }}>{msg}</Text>
          </View>

          <Pressable
            onPress={this.reload}
            style={({ pressed }) => ({
              marginTop: 20,
              backgroundColor: pressed ? '#5B21B6' : '#6D28D9',
              borderRadius: radius.md,
              paddingVertical: 13,
              paddingHorizontal: 28,
              width: '100%',
              alignItems: 'center',
            })}
          >
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#FFF' }}>Reload app 🔄</Text>
          </Pressable>
          <Pressable onPress={this.reset} style={{ marginTop: 10, padding: 10 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#6D28D9' }}>Try again without reload</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}
