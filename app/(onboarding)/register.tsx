import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { hashPassword, normalizeUsername } from '@/lib/password';
import { buildProfilePayload } from '@/lib/profile';
import { colors, radii, spacing, typography } from '@/lib/design';
import { saveAccountSettings } from '@/lib/settingsService';
import { supabase } from '@/lib/supabase';
import { syncWaterLog } from '@/lib/waterLog';
import { useGymStore } from '@/stores/useGymStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function RegisterScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const profile = useUserStore((state) => state.profile);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const macros = useUserStore((state) => state.macros);
  const generatedPlan = useUserStore((state) => state.generatedPlan);
  const aiModel = useSettingsStore((state) => state.aiModel);
  const markSettingsSynced = useSettingsStore((state) => state.markSettingsSynced);
  const markSettingsError = useSettingsStore((state) => state.markSettingsError);
  const setProfile = useUserStore((state) => state.setProfile);
  const setSession = useUserStore((state) => state.setSession);
  const completeOnboarding = useUserStore((state) => state.completeOnboarding);
  const setWaterMl = useNutritionStore((state) => state.setWaterMl);
  const setCurrentSplit = useGymStore((state) => state.setCurrentSplit);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleRegister = async () => {
    const normalizedUsername = normalizeUsername(username);
    if (!profile || !generatedPlan) {
      Alert.alert('Plan missing', 'Please reveal your plan before creating the account.');
      router.replace('/(onboarding)/plan-reveal');
      return;
    }

    if (normalizedUsername.length < 3) {
      Alert.alert('Check username', 'Username must be at least 3 characters.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Check password', 'Password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    try {
      const passwordHash = hashPassword(normalizedUsername, password);
      const { data: existing, error: existingError } = await supabase.rpc('app_username_exists', {
        input_username: normalizedUsername,
      });

      if (existingError) throw existingError;
      if (existing) {
        Alert.alert('Username taken', 'Choose another username or login.');
        return;
      }

      const payload = buildProfilePayload({
        username: normalizedUsername,
        draft,
        profile,
        calorieGoal,
        macros,
        generatedPlan,
        aiModel,
      });
      const { data, error } = await supabase.from('profiles').insert(payload).select('*').single();
      if (error) throw error;

      const savedId = String((data as LooseRow).id ?? '');
      const { error: userError } = await supabase.from('app_users').insert({
        username: normalizedUsername,
        password_hash: passwordHash,
        profile_id: savedId,
      });
      if (userError) throw userError;

      const settingsSync = await saveAccountSettings(savedId);
      if (settingsSync.ok) {
        markSettingsSynced(settingsSync.syncedAt);
      } else {
        markSettingsError(settingsSync.error);
      }

      const savedProfile = { ...profile, id: savedId, username: normalizedUsername };
      setSession({ userId: savedId, username: normalizedUsername });
      setProfile(savedProfile);
      completeOnboarding();
      setWaterMl(0);
      setCurrentSplit(generatedPlan.workoutSplit);

      const { error: waterError } = await syncWaterLog({
        user_id: savedId,
        date: todayKey(),
        target_ml: generatedPlan.waterTargetMl,
        amount_ml: 0,
        glasses: 0,
      });
      if (waterError) console.warn('Unable to initialize water log', waterError.message);

      router.replace('/(tabs)');
    } catch (error) {
      console.warn('Unable to register user', error);
      Alert.alert('Registration failed', 'Please check Supabase connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <View style={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="person-add-outline" color={colors.violetLight} size={34} />
        </View>
        <Text style={styles.kicker}>Step 5 of 5</Text>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>This saves your onboarding once, then brings you straight to the dashboard next time.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={username}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            onChangeText={setPassword}
            placeholder="password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={handleRegister}
          style={[styles.primaryButton, saving && styles.disabledButton]}>
          <Text style={styles.primaryButtonText}>{saving ? 'Creating...' : 'Register and open dashboard'}</Text>
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
    backgroundColor: colors.violetBg,
    borderColor: colors.border,
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 64,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.violetLight,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: spacing.xs,
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
    backgroundColor: colors.violet,
    borderRadius: radii.inner,
    height: 52,
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
});
