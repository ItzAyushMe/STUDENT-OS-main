// ============================================================
// StudentOS — Dual theme system
// GAMER mode: Home / Guild / XP / nav bar (dark + neon + pixel)
// LIGHT mode: Study / Focus / Life screens (calm + minimal)
// ============================================================

export const GAMER = {
  mode: 'gamer',
  bg: '#0D1117',
  surface: '#161B22',
  card: '#21262D',
  border: '#30363D',
  primary: '#7C3AED',
  primarySoft: '#A78BFA',
  secondary: '#06B6D4',
  accent: '#10B981',
  gold: '#FFD700',
  danger: '#EF4444',
  warn: '#F59E0B',
  text: '#E6EDF3',
  subtext: '#8B949E',
  onPrimary: '#FFFFFF',
};

export const LIGHT = {
  mode: 'light',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  card: '#F1F5F9',
  border: '#E2E8F0',
  primary: '#6D28D9',
  primarySoft: '#8B5CF6',
  secondary: '#0891B2',
  accent: '#10B981',
  gold: '#D97706',
  danger: '#DC2626',
  warn: '#D97706',
  text: '#1E293B',
  subtext: '#64748B',
  onPrimary: '#FFFFFF',
};

// Fonts (loaded in App.js via expo-font)
export const fonts = {
  pixel: 'PressStart2P_400Regular',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
};

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28 };

export function getTheme(mode) {
  return mode === 'gamer' ? GAMER : LIGHT;
}
