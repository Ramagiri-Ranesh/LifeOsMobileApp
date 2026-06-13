import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/lib/design';
import { useUserStore, type OnboardingProfile } from '@/stores/useUserStore';

const genderOptions: Array<{ value: OnboardingProfile['gender']; label: string }> = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export default function BasicProfileScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const updateOnboardingProfile = useUserStore((state) => state.updateOnboardingProfile);
  const [name, setName] = useState(draft.name);
  const [gender, setGender] = useState<OnboardingProfile['gender']>(draft.gender === 'female' ? 'female' : 'male');
  const [age, setAge] = useState(String(draft.age));
  const [heightCm, setHeightCm] = useState(String(draft.heightCm));

  const handleNext = () => {
    const trimmedName = name.trim();
    const parsedAge = Number(age);
    const parsedHeight = Number(heightCm);

    if (!trimmedName) {
      Alert.alert('Name required', 'Add your name so LifeOS can personalize the plan.');
      return;
    }

    if (!Number.isFinite(parsedAge) || parsedAge < 13 || parsedAge > 100) {
      Alert.alert('Check age', 'Enter a valid age.');
      return;
    }

    if (!Number.isFinite(parsedHeight) || parsedHeight < 100 || parsedHeight > 240) {
      Alert.alert('Check height', 'Enter your height in centimeters.');
      return;
    }

    updateOnboardingProfile({
      name: trimmedName,
      gender,
      age: Math.round(parsedAge),
      heightCm: Math.round(parsedHeight),
    });
    router.push('/(onboarding)/fitness-profile');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProgressDots step={1} />
        <Text style={styles.kicker}>Step 1 of 5</Text>
        <Text style={styles.title}>Tell LifeOS about you</Text>
        <Text style={styles.subtitle}>These basics help the AI calculate calories, macros, water, and training load.</Text>

        <View style={styles.section}>
          <Text style={styles.inputLabel}>Name</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={name}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.inputLabel}>Gender</Text>
          <View style={styles.segmentedControl}>
            {genderOptions.map((option) => {
              const selected = gender === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  onPress={() => setGender(option.value)}
                  style={[styles.segmentButton, selected && styles.segmentButtonActive]}>
                  <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.inputRow}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Age</Text>
            <TextInput
              keyboardType="number-pad"
              onChangeText={setAge}
              placeholder="29"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={age}
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Height cm</Text>
            <TextInput
              keyboardType="number-pad"
              onChangeText={setHeightCm}
              placeholder="175"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={heightCm}
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={handleNext} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Continue</Text>
          <Ionicons name="arrow-forward" color={colors.textPrimary} size={18} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ProgressDots({ step }: { step: number }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4, 5].map((dot) => (
        <View key={dot} style={[styles.dot, dot <= step && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: 112,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  dot: {
    backgroundColor: colors.surface2,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dotActive: {
    backgroundColor: colors.violet,
    width: 22,
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
  section: {
    marginTop: spacing.lg,
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
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
  segmentedControl: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 6,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: radii.inner - 4,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.violet,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: colors.textPrimary,
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
    flexDirection: 'row',
    gap: spacing.xs,
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
});
