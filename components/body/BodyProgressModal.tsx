import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  canRecalibrateBodyPlan,
  generateBodyPlan,
  loadBodyMetrics,
  localDateKey,
  nextBodyRecalibrationDate,
  saveBodyMetric,
  summarizeWeightTrend,
  type BodyMetricLog,
} from '@/lib/bodyMetrics';
import { radii, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { profileFromRow } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { useGymStore } from '@/stores/useGymStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

type Props = {
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

function parsePositiveMetric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function BodyProgressModal({ visible, onClose, onChanged }: Props) {
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const profile = useUserStore((state) => state.profile);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const macros = useUserStore((state) => state.macros);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const setGeneratedPlan = useUserStore((state) => state.setGeneratedPlan);
  const updateOnboardingProfile = useUserStore((state) => state.updateOnboardingProfile);
  const setCurrentSplit = useGymStore((state) => state.setCurrentSplit);

  const [dailyWeight, setDailyWeight] = useState('');
  const [waistCm, setWaistCm] = useState('');
  const [chestCm, setChestCm] = useState('');
  const [armCm, setArmCm] = useState('');
  const [hipCm, setHipCm] = useState('');
  const [thighCm, setThighCm] = useState('');
  const [bodyNotes, setBodyNotes] = useState('');
  const [bodyLogs, setBodyLogs] = useState<BodyMetricLog[]>([]);
  const [savingBodyLog, setSavingBodyLog] = useState(false);
  const [generating, setGenerating] = useState(false);

  const todayBodyLog = useMemo(() => bodyLogs.find((log) => log.date === localDateKey()) ?? null, [bodyLogs]);
  const latestWeightLog = useMemo(
    () => bodyLogs.filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [bodyLogs],
  );
  const weightHistory = useMemo(
    () => bodyLogs.filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0).sort((a, b) => b.date.localeCompare(a.date)),
    [bodyLogs],
  );
  const latestMetricLog = useMemo(
    () => bodyLogs.find((log) => log.waistCm || log.chestCm || log.armCm || log.hipCm || log.thighCm) ?? null,
    [bodyLogs],
  );
  const lastMetricAgeDays = latestMetricLog
    ? Math.max(0, Math.floor((Date.now() - new Date(`${latestMetricLog.date}T00:00:00`).getTime()) / 86400000))
    : null;
  const nextGenerationAt = nextBodyRecalibrationDate(profile?.lastBodyRecalibrationAt);
  const generationReady = canRecalibrateBodyPlan(profile?.lastBodyRecalibrationAt) && Boolean(latestWeightLog);
  const trend = summarizeWeightTrend(bodyLogs, profile?.targetWeightKg ?? 0);

  const loadProgress = useCallback(async () => {
    if (!currentUserId) {
      setBodyLogs([]);
      return;
    }

    try {
      setBodyLogs(await loadBodyMetrics(currentUserId, 45));
    } catch (error) {
      console.warn('Unable to load body metrics', error);
      setBodyLogs([]);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (visible) void loadProgress();
  }, [loadProgress, visible]);

  useEffect(() => {
    if (todayBodyLog) {
      setDailyWeight(todayBodyLog.weightKg ? String(todayBodyLog.weightKg) : '');
      setWaistCm(todayBodyLog.waistCm ? String(todayBodyLog.waistCm) : '');
      setChestCm(todayBodyLog.chestCm ? String(todayBodyLog.chestCm) : '');
      setArmCm(todayBodyLog.armCm ? String(todayBodyLog.armCm) : '');
      setHipCm(todayBodyLog.hipCm ? String(todayBodyLog.hipCm) : '');
      setThighCm(todayBodyLog.thighCm ? String(todayBodyLog.thighCm) : '');
      setBodyNotes(todayBodyLog.notes ?? '');
      return;
    }

    setDailyWeight(profile?.weightKg ? String(profile.weightKg) : '');
    setWaistCm('');
    setChestCm('');
    setArmCm('');
    setHipCm('');
    setThighCm('');
    setBodyNotes('');
  }, [profile?.weightKg, todayBodyLog]);

  const saveBodyProgress = useCallback(async (kind: 'weight' | 'metrics') => {
    if (!currentUserId || !profile) {
      Alert.alert('Login required', 'Please login before logging body progress.');
      return;
    }

    const weightKg = parsePositiveMetric(dailyWeight);
    if (kind === 'weight' && !weightKg) {
      Alert.alert('Weight required', "Add today's body weight before saving.");
      return;
    }

    const nextLog: BodyMetricLog = {
      userId: currentUserId,
      date: localDateKey(),
      weightKg: weightKg ?? todayBodyLog?.weightKg,
      waistCm: parsePositiveMetric(waistCm) ?? todayBodyLog?.waistCm,
      chestCm: parsePositiveMetric(chestCm) ?? todayBodyLog?.chestCm,
      armCm: parsePositiveMetric(armCm) ?? todayBodyLog?.armCm,
      hipCm: parsePositiveMetric(hipCm) ?? todayBodyLog?.hipCm,
      thighCm: parsePositiveMetric(thighCm) ?? todayBodyLog?.thighCm,
      notes: bodyNotes,
    };

    if (kind === 'metrics' && !nextLog.waistCm && !nextLog.chestCm && !nextLog.armCm && !nextLog.hipCm && !nextLog.thighCm) {
      Alert.alert('Measurements required', 'Add at least one weekly body measurement.');
      return;
    }

    setSavingBodyLog(true);
    try {
      await saveBodyMetric(nextLog);
      await loadProgress();
      onChanged?.();
      Alert.alert(kind === 'weight' ? 'Weight logged' : 'Measurements saved', kind === 'weight' ? "Today's weight is now in your brief." : 'Weekly body metrics are saved.');
    } catch (error) {
      console.warn('Unable to save body metrics', error);
      Alert.alert('Body metrics not saved', 'Please check the body_metrics table migration and try again.');
    } finally {
      setSavingBodyLog(false);
    }
  }, [armCm, bodyNotes, chestCm, currentUserId, dailyWeight, hipCm, loadProgress, onChanged, profile, thighCm, todayBodyLog, waistCm]);

  const generateTargets = useCallback(async () => {
    if (!currentUserId || !profile || !generationReady) return;

    setGenerating(true);
    try {
      const result = await generateBodyPlan(profile, bodyLogs);
      if (!result) {
        Alert.alert('Weight needed', 'Log your latest body weight before generating targets.');
        return;
      }

      const now = new Date().toISOString();
      const planForProfile = {
        ...result.generatedPlan,
        calorieTarget: result.calorieGoal,
        macros: result.macros,
      };
      const { data, error } = await supabase
        .from('profiles')
        .update({
          weight_kg: result.weightKg,
          calorie_goal: result.calorieGoal,
          protein_goal_g: result.macros.protein,
          carbs_goal_g: result.macros.carbs,
          fat_goal_g: result.macros.fat,
          macros: result.macros,
          split: result.split,
          workout_split: result.split,
          first_week_plan: planForProfile,
          daily_water_goal_ml: result.generatedPlan.waterTargetMl,
          water_target_ml: result.generatedPlan.waterTargetMl,
          last_body_recalibration_at: now,
          body_recalibration_count: (profile.bodyRecalibrationCount ?? 0) + 1,
          updated_at: now,
        })
        .eq('id', currentUserId)
        .select('*')
        .single();

      if (error) throw error;

      const parsed = profileFromRow((data ?? {}) as LooseRow);
      setProfile(parsed.profile);
      setPlanTargets(parsed.calorieGoal || result.calorieGoal || calorieGoal, parsed.macros || result.macros || macros, result.generatedPlan.waterTargetMl);
      setGeneratedPlan(parsed.generatedPlan ?? result.generatedPlan);
      setCurrentSplit(parsed.generatedPlan?.workoutSplit ?? parsed.profile.split);
      updateOnboardingProfile({
        currentWeight: parsed.profile.weightKg,
        targetWeight: parsed.profile.targetWeightKg,
        targetDate: parsed.profile.targetDate || '',
        weeklyWeightChangeKg: parsed.profile.weeklyWeightChangeKg ?? 0.5,
        gymDaysPerWeek: parsed.profile.gymDaysPerWeek,
      });
      onChanged?.();
      Alert.alert(
        result.source === 'ai' ? 'AI targets generated' : 'Fallback targets calculated',
        `${result.calorieGoal} kcal/day · P ${result.macros.protein}g · C ${result.macros.carbs}g · F ${result.macros.fat}g\n${result.note}`,
      );
    } catch (error) {
      console.warn('Unable to generate body targets', error);
      Alert.alert(
        'AI generation failed',
        error instanceof Error ? error.message : 'Your profile weight and targets were not changed.',
      );
    } finally {
      setGenerating(false);
    }
  }, [bodyLogs, calorieGoal, currentUserId, generationReady, macros, onChanged, profile, setCurrentSplit, setGeneratedPlan, setPlanTargets, setProfile, updateOnboardingProfile]);

  const generationText = latestWeightLog
    ? generationReady
      ? 'Ready now. Uses latest body_metrics weight plus profile data.'
      : `Next AI generation opens ${nextGenerationAt ? formatShortDate(nextGenerationAt) : 'after 14 days'}.`
    : 'Log at least one body weight to unlock generation.';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Body Progress</Text>
              <Text style={styles.subtitle}>{trend}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.statusRow}>
              <View style={styles.statusPill}>
                <Ionicons name="scale-outline" size={15} color={colors.emeraldLight} />
                <Text style={styles.statusText}>{latestWeightLog?.weightKg ? `${latestWeightLog.weightKg} kg latest` : 'No weight yet'}</Text>
              </View>
              <View style={styles.statusPill}>
                <Ionicons name="body-outline" size={15} color={colors.violetLight} />
                <Text style={styles.statusText}>{lastMetricAgeDays === null ? 'No weekly metrics' : lastMetricAgeDays === 0 ? 'Metrics today' : `Metrics ${lastMetricAgeDays}d ago`}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <TextInput
                placeholder="Today's weight kg"
                placeholderTextColor={colors.textMuted}
                value={dailyWeight}
                onChangeText={setDailyWeight}
                keyboardType="decimal-pad"
                style={[styles.input, styles.flexInput]}
              />
              <TouchableOpacity disabled={savingBodyLog} style={[styles.primaryButton, savingBodyLog && styles.disabled]} onPress={() => saveBodyProgress('weight')}>
                <Text style={styles.primaryText}>{savingBodyLog ? 'Saving' : 'Log'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.historyBox}>
              <View style={styles.historyHeader}>
                <Text style={styles.footerTitle}>Weight history</Text>
                <Text style={styles.footerText}>{weightHistory.length ? `${weightHistory.length} logs` : 'No logs yet'}</Text>
              </View>
              {weightHistory.length ? (
                weightHistory.slice(0, 12).map((log) => (
                  <View key={`${log.date}-${log.id ?? log.weightKg}`} style={styles.historyRow}>
                    <Text style={styles.historyDate}>{formatShortDate(dateFromKey(log.date))}</Text>
                    <Text style={styles.historyWeight}>{log.weightKg} kg</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyHistory}>Log your first weight to build a daily history.</Text>
              )}
            </View>

            <View style={styles.metricGrid}>
              <TextInput placeholder="Waist cm" placeholderTextColor={colors.textMuted} value={waistCm} onChangeText={setWaistCm} keyboardType="decimal-pad" style={[styles.input, styles.metricInput]} />
              <TextInput placeholder="Chest cm" placeholderTextColor={colors.textMuted} value={chestCm} onChangeText={setChestCm} keyboardType="decimal-pad" style={[styles.input, styles.metricInput]} />
              <TextInput placeholder="Arm cm" placeholderTextColor={colors.textMuted} value={armCm} onChangeText={setArmCm} keyboardType="decimal-pad" style={[styles.input, styles.metricInput]} />
              <TextInput placeholder="Hip cm" placeholderTextColor={colors.textMuted} value={hipCm} onChangeText={setHipCm} keyboardType="decimal-pad" style={[styles.input, styles.metricInput]} />
              <TextInput placeholder="Thigh cm" placeholderTextColor={colors.textMuted} value={thighCm} onChangeText={setThighCm} keyboardType="decimal-pad" style={[styles.input, styles.metricInput]} />
              <TextInput placeholder="Notes" placeholderTextColor={colors.textMuted} value={bodyNotes} onChangeText={setBodyNotes} style={[styles.input, styles.metricInput]} />
            </View>

            <View style={styles.footerRow}>
              <View style={styles.footerCopy}>
                <Text style={styles.footerTitle}>Weekly body metrics</Text>
                <Text style={styles.footerText}>Save waist/chest/arm/hip/thigh once a week.</Text>
              </View>
              <TouchableOpacity disabled={savingBodyLog} style={[styles.secondaryButton, savingBodyLog && styles.disabled]} onPress={() => saveBodyProgress('metrics')}>
                <Text style={styles.secondaryText}>Save metrics</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.generateBox}>
              <View style={styles.footerCopy}>
                <Text style={styles.footerTitle}>2-week AI generation</Text>
                <Text style={styles.footerText}>{generationText}</Text>
              </View>
              {generationReady ? (
                <TouchableOpacity disabled={generating} style={[styles.generateButton, generating && styles.disabled]} onPress={generateTargets}>
                  <Ionicons name="sparkles" size={16} color={colors.background} />
                  <Text style={styles.generateText}>{generating ? 'Generating' : 'Generate'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    modalOverlay: {
      backgroundColor: 'rgba(0,0,0,0.58)',
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface1,
      borderTopLeftRadius: radii.card,
      borderTopRightRadius: radii.card,
      maxHeight: '88%',
      padding: spacing.md,
    },
    header: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    title: {
      ...typography.h1,
      color: colors.textPrimary,
    },
    subtitle: {
      ...typography.body,
      color: colors.textMuted,
      marginTop: 4,
    },
    closeButton: {
      alignItems: 'center',
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderRadius: radii.inner,
      borderWidth: 1,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    content: {
      gap: spacing.sm,
      paddingBottom: spacing.lg,
    },
    statusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    statusPill: {
      alignItems: 'center',
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderRadius: radii.inner,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: spacing.xs,
      paddingVertical: 8,
    },
    statusText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.xs,
    },
    input: {
      ...typography.body,
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderRadius: radii.inner,
      borderWidth: 1,
      color: colors.textPrimary,
      minHeight: 48,
      paddingHorizontal: spacing.sm,
    },
    flexInput: {
      flex: 1,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.emerald,
      borderRadius: radii.inner,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 82,
      paddingHorizontal: spacing.xs,
    },
    primaryText: {
      color: colors.background,
      fontSize: 13,
      fontWeight: '900',
    },
    historyBox: {
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderRadius: radii.inner,
      borderWidth: 1,
      gap: 8,
      padding: spacing.xs,
    },
    historyHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    historyRow: {
      alignItems: 'center',
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 8,
    },
    historyDate: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '800',
    },
    historyWeight: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '900',
    },
    emptyHistory: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 17,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    metricInput: {
      flexBasis: '48%',
      flexGrow: 1,
      minWidth: 130,
    },
    footerRow: {
      alignItems: 'center',
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: spacing.xs,
      justifyContent: 'space-between',
      paddingTop: spacing.xs,
    },
    footerCopy: {
      flex: 1,
      minWidth: 0,
    },
    footerTitle: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '900',
    },
    footerText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 17,
      marginTop: 2,
    },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderRadius: radii.inner,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 42,
      paddingHorizontal: spacing.xs,
    },
    secondaryText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '900',
    },
    generateBox: {
      alignItems: 'center',
      backgroundColor: colors.amberBg,
      borderColor: 'rgba(245, 158, 11, 0.28)',
      borderRadius: radii.inner,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.xs,
      justifyContent: 'space-between',
      padding: spacing.xs,
    },
    generateButton: {
      alignItems: 'center',
      backgroundColor: colors.amber,
      borderRadius: radii.inner,
      flexDirection: 'row',
      gap: 5,
      justifyContent: 'center',
      minHeight: 42,
      paddingHorizontal: spacing.xs,
    },
    generateText: {
      color: colors.background,
      fontSize: 12,
      fontWeight: '900',
    },
    disabled: {
      opacity: 0.55,
    },
  });
}
