// Compose all top-level providers.
import { ThemeProvider } from './ThemeContext';
import { SettingsProvider } from './SettingsContext';
import { AuthProvider } from './AuthContext';
import { GameProvider } from './GameContext';

export function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <AuthProvider>
          <GameProvider>{children}</GameProvider>
        </AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
