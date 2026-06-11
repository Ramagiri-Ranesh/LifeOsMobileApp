import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { colors } from '@/lib/design';
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
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false }}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ai-coach" options={{ presentation: 'modal' }} />
        <Stack.Screen name="learning" />
        <Stack.Screen name="finance" />
      </Stack>
    </ThemeProvider>
  );
}
