// Lightweight online/offline detection (NetInfo + web fallback).
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export function useIsOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => setOnline(navigator.onLine !== false);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }
    const unsub = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state?.isConnected));
    });
    return () => unsub();
  }, []);

  return online;
}
