// Compose all top-level providers.
import { useEffect } from 'react';
import { ThemeProvider } from './ThemeContext';
import { SettingsProvider } from './SettingsContext';
import { AuthProvider } from './AuthContext';
import { GameProvider } from './GameContext';
import { FocusProvider } from './FocusContext';
import { pruneGrowthTables, isRemote } from '../lib/db';

export function AppProviders({ children }) {
  // proactive maintenance: cap growth tables (xp_events etc.) once per
  // launch so Local Mode storage never fills up and breaks the app
  useEffect(() => {
    if (!isRemote()) {
      pruneGrowthTables(false).catch(() => {});
    }
  }, []);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AuthProvider>
          <GameProvider>
            <FocusProvider>{children}</FocusProvider>
          </GameProvider>
        </AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
