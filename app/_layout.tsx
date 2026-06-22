import 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import 'react-native-reanimated';

import { colors, colorsForAppMode } from '@/lib/design';
import {
  registerLifeOSBackgroundTasks,
  registerNotificationReceivedHandler,
  registerNotificationResponseHandler,
  scheduleLifeOSNotifications,
} from '@/lib/notifications';
import { profileFromRow } from '@/lib/profile';
import { hydrateAccountSettings } from '@/lib/settingsService';
import { supabase } from '@/lib/supabase';
import { loadProfileForAuthUser } from '@/lib/auth';
import { useGymStore } from '@/stores/useGymStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const {
    currentUserId,
    hasRegisteredBefore,
    onboardingCompleted,
    profile,
    completeOnboarding,
    resetAuth,
    setGeneratedPlan,
    setPlanTargets,
    setProfile,
    setSession,
  } = useUserStore();
  const setCurrentSplit = useGymStore((state) => state.setCurrentSplit);
  const appLockEnabled = useSettingsStore((state) => state.appLockEnabled);
  const appMode = useSettingsStore((state) => state.appMode);
  const systemMode = useColorScheme();
  const modeColors = colorsForAppMode(appMode, systemMode === 'light' ? 'light' : 'dark');
  const [unlocked, setUnlocked] = useState(!appLockEnabled);
  const [authChecked, setAuthChecked] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const profileMatchesAuth = Boolean(profile && authUserId && (profile.id === authUserId || profile.authUserId === authUserId));
  const isReady = Boolean(authChecked && authUserId && currentUserId && profileMatchesAuth && profile && onboardingCompleted);

  useEffect(() => {
    let mounted = true;

    async function restoreProfile(authId: string) {
      const data = await loadProfileForAuthUser(authId);
      if (!data) throw new Error('No LifeOS profile is linked to the Supabase Auth user.');

      const restored = profileFromRow(data as Record<string, Json | undefined>);
      const username = restored.profile.username ?? '';
      const profileId = restored.profile.id ?? authId;

      setSession({ userId: profileId, username });
      setProfile({ ...restored.profile, id: profileId, authUserId: authId, username });
      setPlanTargets(restored.calorieGoal, restored.macros, restored.profile.waterTargetMl);
      if (restored.generatedPlan) setGeneratedPlan(restored.generatedPlan);
      setCurrentSplit(restored.generatedPlan?.workoutSplit ?? restored.profile.split);
      await hydrateAccountSettings(profileId);
      if (restored.onboardingCompleted) completeOnboarding();
    }

    async function reconcileAuth() {
      try {
        const { data } = await supabase.auth.getSession();
        const sessionUserId = data.session?.user.id ?? null;
        const routeGroup = segments[0];
        const routeName = segments[1];
        const isRegistering = routeGroup === '(onboarding)' && routeName === 'register' && !onboardingCompleted;

        if (!mounted) return;
        setAuthUserId(sessionUserId);

        if (!sessionUserId) {
          if (currentUserId || onboardingCompleted) resetAuth();
          return;
        }

        if (isRegistering) return;

        const sessionMatchesProfile = Boolean(
          profile && (profile.id === sessionUserId || profile.authUserId === sessionUserId),
        );

        if (!sessionMatchesProfile || !onboardingCompleted) {
          await restoreProfile(sessionUserId);
        }
      } catch (error) {
        console.warn('Unable to restore Supabase auth session', error);
        resetAuth();
        setAuthUserId(null);
      } finally {
        if (mounted) setAuthChecked(true);
      }
    }

    void reconcileAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const sessionUserId = session?.user.id ?? null;
      setAuthUserId(sessionUserId);
      if (event === 'SIGNED_OUT' || !sessionUserId) resetAuth();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [
    completeOnboarding,
    currentUserId,
    onboardingCompleted,
    profile,
    resetAuth,
    setCurrentSplit,
    setGeneratedPlan,
    setPlanTargets,
    setProfile,
    setSession,
    segments,
  ]);

  useEffect(() => {
    if (!authChecked) return;
    const routeGroup = segments[0];

    if (!isReady && routeGroup !== '(onboarding)') {
      router.replace(hasRegisteredBefore ? '/(onboarding)/login' : '/(onboarding)');
    }

    if (isReady && routeGroup === '(onboarding)') {
      router.replace('/(tabs)');
    }
  }, [authChecked, hasRegisteredBefore, isReady, router, segments]);

  useEffect(() => registerNotificationResponseHandler(router), [router]);

  useEffect(() => registerNotificationReceivedHandler(), []);

  useEffect(() => {
    void registerLifeOSBackgroundTasks();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    // Reconcile persisted schedules after account settings have been hydrated,
    // without prompting for permission during app startup.
    void scheduleLifeOSNotifications({ requestPermission: false });
  }, [isReady, currentUserId]);

  useEffect(() => {
    if (!appLockEnabled || Platform.OS === 'web') {
      setUnlocked(true);
      return;
    }

    setUnlocked(false);
    void unlockApp();
  }, [appLockEnabled]);

  async function unlockApp() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock LifeOS',
      fallbackLabel: 'Use passcode',
    });
    setUnlocked(result.success);
  }

  const lifeOSTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: modeColors.background,
      card: modeColors.surface1,
      border: modeColors.border,
      primary: modeColors.violet,
      text: modeColors.textPrimary,
    },
  };

  return (
    <ThemeProvider value={lifeOSTheme}>
      {!authChecked ? (
        <View style={[styles.lockScreen, { backgroundColor: modeColors.background }]} />
      ) : !unlocked ? (
        <View style={[styles.lockScreen, { backgroundColor: modeColors.background }]}>
          <Text style={[styles.lockTitle, { color: modeColors.textPrimary }]}>LifeOS locked</Text>
          <Text style={[styles.lockBody, { color: modeColors.textSecondary }]}>Authenticate to continue.</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={unlockApp}
            style={[styles.lockButton, { backgroundColor: modeColors.violetLight }]}>
            <Text style={[styles.lockButtonText, { color: modeColors.background }]}>Unlock</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Stack screenOptions={{ contentStyle: { backgroundColor: modeColors.background }, headerShown: false }}>
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="ai-coach" options={{ presentation: 'modal' }} />
          <Stack.Screen name="finance" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="profile" />
        </Stack>
      )}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  lockScreen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  lockTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  lockBody: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  lockButton: {
    backgroundColor: colors.violetLight,
    borderRadius: 12,
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  lockButtonText: {
    color: colors.background,
    fontWeight: '800',
  },
});
