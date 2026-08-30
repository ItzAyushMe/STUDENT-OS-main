// ============================================================
// StudentOS — theme mode context
// Screens declare their mode ('gamer' | 'light'); the root app
// follows along so status bar + background transitions feel smooth.
// ============================================================
import { createContext, useContext, useEffect, useState } from 'react';
import { getTheme } from '../config/theme';

const ThemeCtx = createContext({ mode: 'gamer', setMode: () => {} });

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('gamer');
  return <ThemeCtx.Provider value={{ mode, setMode }}>{children}</ThemeCtx.Provider>;
}

export const useThemeMode = () => useContext(ThemeCtx);

// Read the palette for the current (or overridden) mode WITHOUT changing it.
// Use for nested components (buttons, cards, headers...) that live inside
// whichever screen mode is active.
export function usePalette(modeOverride) {
  const { mode } = useThemeMode();
  return getTheme(modeOverride || mode);
}

// Use inside a screen: const theme = useTheme('light')
export function useTheme(mode) {
  const { setMode } = useThemeMode();
  useEffect(() => {
    setMode(mode);
  }, [mode, setMode]);
  return getTheme(mode);
}
