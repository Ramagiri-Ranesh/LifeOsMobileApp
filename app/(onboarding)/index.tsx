import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useUserStore } from '@/stores/useUserStore';

export default function WelcomeScreen() {
  const router = useRouter();
  const onboardingComplete = useUserStore((state) => state.onboardingCompleted);
  const hasRegisteredBefore = useUserStore((state) => state.hasRegisteredBefore);

  useEffect(() => {
    if (onboardingComplete) {
      router.replace('/(tabs)');
      return;
    }

    if (hasRegisteredBefore) {
      router.replace('/(onboarding)/login');
    }
  }, [hasRegisteredBefore, onboardingComplete, router]);

  const handleGetStarted = () => {
    router.push('/(onboarding)/basic-profile');
  };

  const handleLogin = () => router.push('/(onboarding)/login');

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />

      <View style={styles.logoBlock}>
        <ProgressArcIcon />
        <Text style={styles.title}>LifeOS</Text>
        <Text style={styles.subtitle}>Your personal command centre</Text>
      </View>

      <View style={styles.featureList}>
        <FeatureLine color="#7C3AED" text="AI-powered · learns your patterns" />
        <FeatureLine color="#10B981" text="Diet · Gym · Goals in one place" />
        <FeatureLine color="#F59E0B" text="Built for you. Runs on your phone." />
      </View>

      <View style={styles.actionBlock}>
        <Pressable accessibilityRole="button" onPress={handleGetStarted} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Get started →</Text>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={handleLogin} hitSlop={8}>
          <Text style={styles.restoreText}>Already registered? Login</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProgressArcIcon() {
  return (
    <Svg width={80} height={80} viewBox="0 0 80 80">
      <Circle cx={40} cy={40} r={29} stroke="#1F1B2D" strokeWidth={8} fill="none" />
      <Circle
        cx={40}
        cy={40}
        r={29}
        stroke="#7C3AED"
        strokeWidth={8}
        fill="none"
        strokeLinecap="round"
        strokeDasharray="138 182"
        transform="rotate(-92 40 40)"
      />
      <Circle cx={62} cy={18} r={5} fill="#10B981" />
      <Circle cx={19} cy={59} r={5} fill="#F59E0B" />
      <Circle cx={62} cy={63} r={5} fill="#3B82F6" />
    </Svg>
  );
}

type FeatureLineProps = {
  color: string;
  text: string;
};

function FeatureLine({ color, text }: FeatureLineProps) {
  return (
    <View style={styles.featureLine}>
      <View style={[styles.featureDot, { backgroundColor: color }]} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#08080F',
    flex: 1,
    justifyContent: 'center',
  },
  logoBlock: {
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -1,
    marginTop: 20,
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 8,
  },
  featureList: {
    alignItems: 'flex-start',
    gap: 14,
    marginTop: 48,
  },
  featureLine: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  featureDot: {
    borderRadius: 4,
    height: 8,
    marginRight: 10,
    width: 8,
  },
  featureText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  actionBlock: {
    marginTop: 48,
    paddingHorizontal: 20,
    width: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    width: '100%',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  restoreText: {
    color: '#4B5563',
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
});
