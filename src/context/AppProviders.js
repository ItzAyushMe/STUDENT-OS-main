// Compose all top-level providers.
import { ThemeProvider } from './ThemeContext';
import { SettingsProvider } from './SettingsContext';
import { AuthProvider } from './AuthContext';

export function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <AuthProvider>{children}</AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
