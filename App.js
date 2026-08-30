// ============================================================
// StudentOS — app entry point
// Free, gamified, AI-powered study OS for Indian students.
// "Level Up Your Life. One Quest at a Time."
// ============================================================
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p';

import { AppProviders } from './src/context/AppProviders';
import { RootNavigator } from './src/navigation/RootNavigator';
import { GAMER, fonts } from './src/config/theme';
import { Text, View } from 'react-native';

function FontSplash() {
  return (
    <View style={{ flex: 1, backgroundColor: GAMER.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 52 }}>🎓</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, marginTop: 16 }}>
        Loading fonts…
      </Text>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    PressStart2P_400Regular,
  });

  if (!fontsLoaded) return <FontSplash />;

  return (
    <SafeAreaProvider>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </SafeAreaProvider>
  );
}
