// Compose all top-level providers.
import { ThemeProvider } from './ThemeContext';
import { SettingsProvider } from './SettingsContext';
import { AuthProvider } from './AuthContext';
import { GameProvider } from './GameContext';
import { FocusProvider } from './FocusContext';

export function AppProviders({ children }) {
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
