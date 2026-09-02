// Auth screen — sign in / sign up (Supabase email+password or Google),
// plus "continue as guest" local mode. Gamer aesthetic.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { CLOUD_ONLY, APP_NAME, APP_TAGLINE } from '../../config/constants';
import { GAMER, fonts, radius } from '../../config/theme';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PixelText } from '../../components/gamer/PixelText';

export function AuthScreen() {
  const { signIn, signUp, signInWithGoogle, continueAsGuest, cloudMode } = useAuth();
  const [tab, setTab] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e?.message || 'Kuch gadbad ho gayi. Try again!');
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (tab === 'signin') {
        await signIn({ email, password });
      } else {
        await signUp({ email, password, username });
      }
    });

  // Pure online mode without a backend = clear instructions, not a silent demo
  if (CLOUD_ONLY && !cloudMode) {
    return (
      <View style={{ flex: 1, backgroundColor: GAMER.bg, alignItems: 'center', justifyContent: 'center', padding: 26 }}>
        <Text style={{ fontSize: 54 }}>🔌</Text>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 17, color: GAMER.text, marginTop: 16, textAlign: 'center' }}>
          Backend not configured
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, textAlign: 'center', marginTop: 10, lineHeight: 19 }}>
          This build is the ONLINE-ONLY version of StudentOS. It needs a Supabase backend:{'\n\n'}
          1. Create a project at supabase.com{'\n'}
          2. Run supabase/schema.sql in the SQL editor{'\n'}
          3. Put the Project URL + anon key in .env (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY){'\n'}
          4. Restart with: npx expo start -c{'\n\n'}
          See README → 'Going Online (Production Setup)'.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: GAMER.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 34 }}>
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 22,
              backgroundColor: 'rgba(124,58,237,0.15)',
              borderWidth: 2,
              borderColor: GAMER.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <Text style={{ fontSize: 40 }}>🎓</Text>
          </View>
          <PixelText size={20} color={GAMER.text} glow align="center">
            {APP_NAME}
          </PixelText>
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 13,
              color: GAMER.subtext,
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            {APP_TAGLINE}
          </Text>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', marginBottom: 20 }}>
          {[
            { key: 'signin', label: 'Sign In' },
            { key: 'signup', label: 'Sign Up' },
          ].map((t) => (
            <Pressable
              key={t.key}
              onPress={() => {
                setTab(t.key);
                setError('');
              }}
              style={{
                flex: 1,
                paddingVertical: 11,
                borderRadius: radius.md,
                backgroundColor: tab === t.key ? GAMER.primary : GAMER.surface,
                borderWidth: 1,
                borderColor: tab === t.key ? GAMER.primary : GAMER.border,
                marginRight: t.key === 'signin' ? 10 : 0,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodySemiBold,
                  fontSize: 14,
                  color: tab === t.key ? '#FFF' : GAMER.subtext,
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'signup' ? (
          <View mode="gamer" style={{ marginBottom: -6 }}>
            <Input
              mode="gamer"
              label="Username (dost tujhe ise dhoondhenge)"
              value={username}
              onChangeText={setUsername}
              placeholder="arjun_grinds"
              autoCapitalize="none"
            />
          </View>
        ) : null}

        <Input
          mode="gamer"
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
        />
        <Input
          mode="gamer"
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />

        {error ? (
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 13,
              color: GAMER.danger,
              marginBottom: 14,
              lineHeight: 18,
            }}
          >
            {error}
          </Text>
        ) : null}

        <Button
          title={tab === 'signin' ? 'Enter the Arena' : 'Create My Account'}
          onPress={submit}
          loading={busy}
          mode="gamer"
          pixel
          size="lg"
          style={{ marginTop: 4 }}
        />

        {/* Google */}
        <Button
          title={cloudMode ? 'Continue with Google' : 'Google sign-in (needs Supabase)'}
          onPress={() => run(signInWithGoogle)}
          variant="secondary"
          mode="gamer"
          size="lg"
          disabled={!cloudMode}
          icon={<Ionicons name="logo-google" size={17} color={GAMER.text} />}
          style={{ marginTop: 12 }}
        />

        {/* Guest — hidden in Cloud Mode: the real online app has accounts only */}
        {cloudMode ? null : (
          <Pressable
            onPress={() => run(continueAsGuest)}
            disabled={busy}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginTop: 18, alignSelf: 'center' })}
          >
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13.5, color: GAMER.secondary }}>
              Just explore first — Continue as Guest →
            </Text>
          </Pressable>
        )}

        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 11.5,
            color: GAMER.subtext,
            textAlign: 'center',
            marginTop: 26,
            lineHeight: 17,
          }}
        >
          {cloudMode
            ? 'Your data syncs to your Supabase account.'
            : 'Running in Local Mode — data stays on this device. Add Supabase keys in .env to sync across devices.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
