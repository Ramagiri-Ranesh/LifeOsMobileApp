import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/lib/design';
import { loadProfileForAuthUser, migrateLegacyAccount, normalizeUsername, usernameToAuthEmailCandidates } from '@/lib/auth';
import { profileFromRow } from '@/lib/profile';
import { hydrateAccountSettings } from '@/lib/settingsService';
import { supabase } from '@/lib/supabase';
import { useGymStore } from '@/stores/useGymStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useUserStore((state) => state.setSession);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const setGeneratedPlan = useUserStore((state) => state.setGeneratedPlan);
  const completeOnboarding = useUserStore((state) => state.completeOnboarding);
  const setCurrentSplit = useGymStore((state) => state.setCurrentSplit);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const showLoginError = (title: string, message: string) => {
    setErrorMessage(message);
    Alert.alert(title, message);
  };

  const handleLogin = async () => {
    const normalizedUsername = normalizeUsername(username);
    setErrorMessage('');

    if (!normalizedUsername || !password) {
      showLoginError('Login details required', 'Enter your username and password.');
      return;
    }

    setLoading(true);
    try {
      const emailCandidates = usernameToAuthEmailCandidates(normalizedUsername);
      let authData = null;
      let authError = null;

      for (const email of emailCandidates) {
        const result = await supabase.auth.signInWithPassword({ email, password });
        authData = result.data;
        authError = result.error;
        if (!authError) break;
      }

      if (authError) {
        try {
          const migration = await migrateLegacyAccount(normalizedUsername, password);
          if (migration.migrated) {
            const retry = await supabase.auth.signInWithPassword({ email: emailCandidates[0], password });
            authData = retry.data;
            authError = retry.error;
          }
        } catch (migrationError) {
          console.warn('Unable to migrate legacy account during login', migrationError);
        }
      }

      if (authError || !authData) {
        showLoginError(
          'Login failed',
          'Username or password is incorrect. If this account was created before the secure login update, deploy the migration function once and try again.',
        );
        return;
      }
      const authUserId = authData.user?.id ?? '';
      if (!authUserId) {
        showLoginError('Login failed', 'Username or password is incorrect.');
        return;
      }

      const data = await loadProfileForAuthUser(authUserId);
      if (!data) {
        showLoginError('Profile missing', 'This login exists, but no LifeOS profile is linked to it.');
        await supabase.auth.signOut();
        return;
      }
      const row = data as LooseRow;
      const restored = profileFromRow(row);
      if (!restored.onboardingCompleted) {
        showLoginError('Onboarding incomplete', 'Please finish onboarding for this account.');
        router.replace('/(onboarding)/basic-profile');
        return;
      }

      const userId = String(row.id ?? '');
      setSession({ userId, username: normalizedUsername });
      setProfile({ ...restored.profile, id: userId, authUserId, username: normalizedUsername });
      setPlanTargets(restored.calorieGoal, restored.macros, restored.profile.waterTargetMl);
      if (restored.generatedPlan) setGeneratedPlan(restored.generatedPlan);
      setCurrentSplit(restored.generatedPlan?.workoutSplit ?? restored.profile.split);
      await hydrateAccountSettings(userId);
      completeOnboarding();
      router.replace('/');
    } catch (error) {
      console.warn('Unable to login', error);
      showLoginError('Login failed', 'Please check Supabase connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <View style={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="log-in-outline" color={colors.emeraldLight} size={34} />
        </View>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Login to open your dashboard without repeating onboarding.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setUsername(value);
              if (errorMessage) setErrorMessage('');
            }}
            placeholder="username"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={username}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            onChangeText={(value) => {
              setPassword(value);
              if (errorMessage) setErrorMessage('');
            }}
            onSubmitEditing={handleLogin}
            placeholder="password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <Pressable accessibilityRole="button" onPress={() => router.replace('/(onboarding)/basic-profile')} hitSlop={8}>
          <Text style={styles.secondaryLink}>Create a new account</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={handleLogin}
          style={[styles.primaryButton, loading && styles.disabledButton]}>
          <Text style={styles.primaryButtonText}>{loading ? 'Logging in...' : 'Login'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xl,
  },
  icon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: colors.border,
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 64,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  form: {
    marginTop: spacing.xl,
  },
  label: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  secondaryLink: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  errorText: {
    color: colors.rose,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  footer: {
    backgroundColor: colors.background,
    bottom: 0,
    left: 0,
    padding: spacing.gutter,
    position: 'absolute',
    right: 0,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radii.inner,
    height: 52,
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '900',
  },
});
