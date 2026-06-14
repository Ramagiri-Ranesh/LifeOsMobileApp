import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LifeOSCard } from '@/components/ui/LifeOSCard';
import { profileFromRow } from '@/lib/profile';
import { colors, radii, spacing, typography } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { useUserStore, type UserProfile } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

type ProfileForm = {
  name: string;
  gender: UserProfile['gender'];
  age: string;
  heightCm: string;
  weightKg: string;
  targetWeightKg: string;
  gymDaysPerWeek: string;
  waterTargetMl: string;
  goal: string;
  experienceLevel: string;
  firstMealTime: string;
  lastMealTime: string;
};

function formFromProfile(profile: UserProfile | null): ProfileForm {
  return {
    name: profile?.name ?? '',
    gender: profile?.gender ?? 'male',
    age: `${profile?.age ?? 29}`,
    heightCm: `${profile?.heightCm ?? 175}`,
    weightKg: `${profile?.weightKg ?? 75}`,
    targetWeightKg: `${profile?.targetWeightKg ?? 72}`,
    gymDaysPerWeek: `${profile?.gymDaysPerWeek ?? 4}`,
    waterTargetMl: `${profile?.waterTargetMl ?? 3000}`,
    goal: profile?.goal ?? 'Build muscle & lose fat',
    experienceLevel: profile?.experienceLevel ?? 'Intermediate',
    firstMealTime: profile?.firstMealTime ?? '07:00',
    lastMealTime: profile?.lastMealTime ?? '21:00',
  };
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function Field({
  label,
  value,
  onChangeText,
  editable,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable: boolean;
  keyboardType?: 'default' | 'numeric' | 'numbers-and-punctuation';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        keyboardType={keyboardType}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, !editable && styles.inputReadonly]}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const profile = useUserStore((state) => state.profile);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const macros = useUserStore((state) => state.macros);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const updateOnboardingProfile = useUserStore((state) => state.updateOnboardingProfile);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => formFromProfile(profile));

  const initials = useMemo(() => (form.name.trim().charAt(0) || 'U').toUpperCase(), [form.name]);

  const updateForm = (patch: Partial<ProfileForm>) => setForm((current) => ({ ...current, ...patch }));

  const resetForm = () => {
    setForm(formFromProfile(profile));
    setEditing(false);
  };

  const saveProfile = async () => {
    if (!currentUserId || !profile) {
      Alert.alert('Profile unavailable', 'Please login again to edit your profile.');
      return;
    }

    const name = form.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Add your display name before saving.');
      return;
    }

    const nextProfile: UserProfile = {
      ...profile,
      name,
      gender: form.gender,
      age: Math.round(parseNumber(form.age, profile.age)),
      heightCm: Math.round(parseNumber(form.heightCm, profile.heightCm)),
      weightKg: parseNumber(form.weightKg, profile.weightKg),
      targetWeightKg: parseNumber(form.targetWeightKg, profile.targetWeightKg),
      gymDaysPerWeek: Math.min(7, Math.max(1, Math.round(parseNumber(form.gymDaysPerWeek, profile.gymDaysPerWeek)))),
      waterTargetMl: Math.max(500, Math.round(parseNumber(form.waterTargetMl, profile.waterTargetMl))),
      goal: form.goal.trim(),
      experienceLevel: form.experienceLevel.trim(),
      firstMealTime: form.firstMealTime.trim(),
      lastMealTime: form.lastMealTime.trim(),
    };

    setSaving(true);
    const { data, error } = await supabase
      .from('profiles')
      .update({
        name: nextProfile.name,
        gender: nextProfile.gender,
        age: nextProfile.age,
        height_cm: nextProfile.heightCm,
        weight_kg: nextProfile.weightKg,
        target_weight_kg: nextProfile.targetWeightKg,
        gym_days_per_week: nextProfile.gymDaysPerWeek,
        water_target_ml: nextProfile.waterTargetMl,
        daily_water_goal_ml: nextProfile.waterTargetMl,
        goal: nextProfile.goal,
        experience_level: nextProfile.experienceLevel,
        first_meal_time: nextProfile.firstMealTime,
        last_meal_time: nextProfile.lastMealTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentUserId)
      .select('*')
      .single();
    setSaving(false);

    if (error) {
      console.warn('Unable to update profile', error.message);
      Alert.alert('Profile not saved', error.message);
      return;
    }

    const parsed = profileFromRow((data ?? {}) as LooseRow);
    setProfile(parsed.profile);
    setPlanTargets(parsed.calorieGoal || calorieGoal, parsed.macros || macros, parsed.profile.waterTargetMl);
    updateOnboardingProfile({
      name: parsed.profile.name,
      gender: parsed.profile.gender,
      age: parsed.profile.age,
      heightCm: parsed.profile.heightCm,
      gymDaysPerWeek: parsed.profile.gymDaysPerWeek,
      currentWeight: parsed.profile.weightKg,
      targetWeight: parsed.profile.targetWeightKg,
      goal: parsed.profile.goal ?? form.goal,
      experienceLevel: parsed.profile.experienceLevel ?? form.experienceLevel,
      firstMealTime: parsed.profile.firstMealTime ?? form.firstMealTime,
      lastMealTime: parsed.profile.lastMealTime ?? form.lastMealTime,
    });
    setForm(formFromProfile(parsed.profile));
    setEditing(false);
    Alert.alert('Profile updated', 'Your LifeOS profile is saved.');
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Profile</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => (editing ? resetForm() : setEditing(true))} style={styles.iconButton}>
              <Ionicons name={editing ? 'close' : 'create-outline'} size={20} color={colors.violetLight} />
            </TouchableOpacity>
          </View>

          <LifeOSCard style={styles.identityCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.name}>{form.name || 'User'}</Text>
            <Text style={styles.subtle}>@{profile?.username ?? 'lifeos'}</Text>
            <View style={styles.statRow}>
              <View style={styles.statPill}>
                <Text style={styles.statValue}>{calorieGoal}</Text>
                <Text style={styles.statLabel}>kcal</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statValue}>{macros.protein}g</Text>
                <Text style={styles.statLabel}>protein</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statValue}>{form.gymDaysPerWeek}</Text>
                <Text style={styles.statLabel}>gym days</Text>
              </View>
            </View>
          </LifeOSCard>

          <LifeOSCard>
            <Text style={styles.sectionTitle}>Personal details</Text>
            <Field label="Display name" value={form.name} editable={editing} onChangeText={(name) => updateForm({ name })} />
            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.segment}>
              {(['male', 'female'] as UserProfile['gender'][]).map((gender) => {
                const active = form.gender === gender;
                return (
                  <TouchableOpacity
                    key={gender}
                    accessibilityRole="button"
                    disabled={!editing}
                    onPress={() => updateForm({ gender })}
                    style={[styles.segmentButton, active && styles.segmentActive]}>
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{gender}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.grid}>
              <Field label="Age" value={form.age} editable={editing} keyboardType="numeric" onChangeText={(age) => updateForm({ age })} />
              <Field label="Height cm" value={form.heightCm} editable={editing} keyboardType="numeric" onChangeText={(heightCm) => updateForm({ heightCm })} />
            </View>
          </LifeOSCard>

          <LifeOSCard>
            <Text style={styles.sectionTitle}>Goals and targets</Text>
            <Field label="Goal" value={form.goal} editable={editing} onChangeText={(goal) => updateForm({ goal })} />
            <Field label="Experience level" value={form.experienceLevel} editable={editing} onChangeText={(experienceLevel) => updateForm({ experienceLevel })} />
            <View style={styles.grid}>
              <Field label="Weight kg" value={form.weightKg} editable={editing} keyboardType="numbers-and-punctuation" onChangeText={(weightKg) => updateForm({ weightKg })} />
              <Field label="Target kg" value={form.targetWeightKg} editable={editing} keyboardType="numbers-and-punctuation" onChangeText={(targetWeightKg) => updateForm({ targetWeightKg })} />
            </View>
            <View style={styles.grid}>
              <Field label="Gym days" value={form.gymDaysPerWeek} editable={editing} keyboardType="numeric" onChangeText={(gymDaysPerWeek) => updateForm({ gymDaysPerWeek })} />
              <Field label="Water ml" value={form.waterTargetMl} editable={editing} keyboardType="numeric" onChangeText={(waterTargetMl) => updateForm({ waterTargetMl })} />
            </View>
          </LifeOSCard>

          <LifeOSCard>
            <Text style={styles.sectionTitle}>Nutrition timing</Text>
            <View style={styles.grid}>
              <Field label="First meal" value={form.firstMealTime} editable={editing} keyboardType="numbers-and-punctuation" onChangeText={(firstMealTime) => updateForm({ firstMealTime })} />
              <Field label="Last meal" value={form.lastMealTime} editable={editing} keyboardType="numbers-and-punctuation" onChangeText={(lastMealTime) => updateForm({ lastMealTime })} />
            </View>
          </LifeOSCard>

          {editing ? (
            <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={saveProfile} style={[styles.saveButton, saving && styles.disabledButton]}>
              <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save profile'}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.xl },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerTitle: { ...typography.h1, color: colors.textPrimary },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  identityCard: { alignItems: 'center', gap: spacing.xs },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.violetBg,
    borderColor: colors.violet,
    borderRadius: 34,
    borderWidth: 1,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  avatarText: { color: colors.violetLight, fontSize: 28, fontWeight: '800' },
  name: { color: colors.textPrimary, fontSize: 24, fontWeight: '800' },
  subtle: { ...typography.body, color: colors.textMuted },
  statRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  statPill: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flex: 1,
    padding: spacing.xs,
  },
  statValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  statLabel: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'none' },
  sectionTitle: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.xs },
  field: { flex: 1, gap: 6, marginBottom: spacing.xs },
  fieldLabel: { ...typography.labelCaps, color: colors.textSecondary, textTransform: 'none' },
  input: {
    ...typography.body,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
  },
  inputReadonly: { color: colors.textSecondary },
  grid: { flexDirection: 'row', gap: spacing.xs },
  segment: { backgroundColor: colors.surface2, borderRadius: radii.inner, flexDirection: 'row', marginBottom: spacing.xs, padding: 4 },
  segmentButton: { alignItems: 'center', borderRadius: radii.inner, flex: 1, padding: spacing.xs },
  segmentActive: { backgroundColor: colors.violetBg },
  segmentText: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'capitalize' },
  segmentTextActive: { color: colors.violetLight },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.violetLight,
    borderRadius: radii.inner,
    padding: spacing.sm,
  },
  disabledButton: { opacity: 0.65 },
  saveText: { ...typography.body, color: colors.background, fontWeight: '800' },
});
