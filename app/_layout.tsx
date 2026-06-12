import 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import 'react-native-reanimated';

import { colors } from '@/lib/design';
import { registerLifeOSBackgroundTasks, registerNotificationResponseHandler } from '@/lib/notifications';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';

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
  const { onboardingCompleted, profile } = useUserStore();
  const appLockEnabled = useSettingsStore((state) => state.appLockEnabled);
  const [unlocked, setUnlocked] = useState(!appLockEnabled);
  const isReady = Boolean(profile && onboardingCompleted);

  useEffect(() => {
    const routeGroup = segments[0];

    if (!isReady && routeGroup !== '(onboarding)') {
      router.replace('/(onboarding)');
    }

    if (isReady && routeGroup === '(onboarding)') {
      router.replace('/(tabs)');
    }
  }, [isReady, router, segments]);

  useEffect(() => registerNotificationResponseHandler(router), [router]);

  useEffect(() => {
    void registerLifeOSBackgroundTasks();
  }, []);

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
      background: colors.background,
      card: colors.surface1,
      border: colors.border,
      primary: colors.violet,
      text: colors.textPrimary,
    },
  };

  return (
    <ThemeProvider value={lifeOSTheme}>
      {!unlocked ? (
        <View style={styles.lockScreen}>
          <Text style={styles.lockTitle}>LifeOS locked</Text>
          <Text style={styles.lockBody}>Authenticate to continue.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={unlockApp} style={styles.lockButton}>
            <Text style={styles.lockButtonText}>Unlock</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false }}>
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="ai-coach" options={{ presentation: 'modal' }} />
          <Stack.Screen name="learning" />
          <Stack.Screen name="finance" />
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
