// FIX 4 — back button always lands on the section hub, never jumps
// across tabs to Home. Used by every sub-screen (Habits, Gym, Tutor,
// Schedule, …) for BOTH the header arrow and Android hardware back.
//   const onBack = useHubBack(navigation, 'LifeHub');
import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function useHubBack(navigation, hubRoute) {
  const goBackOrHub = useCallback(() => {
    try {
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate(hubRoute);
    } catch {
      navigation.navigate(hubRoute);
    }
  }, [navigation, hubRoute]);

  // Android hardware back: pop the nested stack; if there's nothing to
  // pop (deep-linked straight in), land on this section's hub.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackOrHub();
        return true;
      });
      return () => sub.remove();
    }, [goBackOrHub])
  );

  return goBackOrHub;
}
