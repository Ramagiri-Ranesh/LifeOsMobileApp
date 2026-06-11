import { Stack } from 'expo-router';

import { colors } from '@/lib/design';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="fitness-profile" />
      <Stack.Screen name="diet-profile" />
      <Stack.Screen name="plan-reveal" />
    </Stack>
  );
}
