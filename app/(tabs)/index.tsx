import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DomainBadge } from '@/components/ui/DomainBadge';
import { LifeOSCard } from '@/components/ui/LifeOSCard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { TimelineItem } from '@/components/ui/TimelineItem';
import { calculateGoalScore, calculateLifeScore } from '@/lib/calculations';
import { getDailyBrief } from '@/lib/ai';
import { colors, domains, radii, spacing, typography, type Domain } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { syncWaterLog } from '@/lib/waterLog';
import { useAnalyticsStore } from '@/stores/useAnalyticsStore';
import { useGymStore } from '@/stores/useGymStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

type PlanItem = {
  id: string;
  time: string;
  title: string;
  subtitle?: string;
  domain: Domain;
  tag: string;
};

type ActionTile = {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
};

const WATER_GLASS_ML = 250;

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatHeaderDate(date = new Date()) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowDate(row: LooseRow) {
  const raw =
    asText(row.due_date) ||
    asText(row.date) ||
    asText(row.scheduled_date) ||
    asText(row.created_at) ||
    asText(row.inserted_at);

  return raw.length >= 10 ? raw.slice(0, 10) : '';
}

function isTaskDone(row: LooseRow) {
  const status = asText(row.status).toLowerCase();
  return row.completed === true || row.done === true || status === 'done' || status === 'completed';
}

function taskTime(row: LooseRow) {
  return asText(row.due_time) || asText(row.time) || 'Today';
}

function taskTitle(row: LooseRow) {
  return asText(row.title) || asText(row.name) || asText(row.task) || 'Untitled task';
}

function waterGlasses(row: LooseRow) {
  const direct = asNumber(row.glasses, NaN);
  if (Number.isFinite(direct)) return direct;

  const count = asNumber(row.count, NaN);
  if (Number.isFinite(count)) return count;

  const amountMl = asNumber(row.amount_ml, 0);
  if (amountMl > 0) return Math.round(amountMl / WATER_GLASS_ML);

  const amount = asNumber(row.amount, 0);
  return amount > 0 ? Math.round(amount / WATER_GLASS_ML) : 0;
}

function fallbackBrief(score: number, caloriesRemaining: number, taskProgress: string) {
  if (score >= 75) return `Strong start: protect your momentum and close ${taskProgress} tasks before dinner.`;
  if (caloriesRemaining > 0) return `You have ${caloriesRemaining} calories to place well; make the next meal protein-led.`;
  return `Keep the day tidy: hydrate, finish one priority task, and avoid late snack drift.`;
}

export default function DailyHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reflection?: string }>();
  const insets = useSafeAreaInsets();
  const profile = useUserStore((state) => state.profile);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const onboardingCompleted = useUserStore((state) => state.onboardingCompleted);
  const onboardingProfile = useUserStore((state) => state.onboardingProfile);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const waterTargetMl = useUserStore((state) => state.waterTargetMl);
  const todaysMeals = useNutritionStore((state) => state.todaysMeals);
  const calories = useNutritionStore((state) => state.calories);
  const waterMl = useNutritionStore((state) => state.waterMl);
  const setWaterMl = useNutritionStore((state) => state.setWaterMl);
  const activeSession = useGymStore((state) => state.activeSession);
  const currentSplit = useGymStore((state) => state.currentSplit);
  const lifeScore = useAnalyticsStore((state) => state.lifeScore);
  const setLifeScore = useAnalyticsStore((state) => state.setLifeScore);

  const [tasks, setTasks] = useState<LooseRow[]>([]);
  const waterGoalGlasses = Math.max(1, Math.ceil(waterTargetMl / WATER_GLASS_ML));
  const [waterCount, setWaterCount] = useState(Math.min(waterGoalGlasses, Math.round(waterMl / WATER_GLASS_ML)));
  const [brief, setBrief] = useState('Preparing your morning brief...');
  const [reflectionVisible, setReflectionVisible] = useState(false);
  const [reflection, setReflection] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const name = profile?.name || onboardingProfile.name || 'User';
  const caloriesRemaining = Math.max(0, calorieGoal - calories);
  const completedTasks = tasks.filter(isTaskDone).length;
  const taskTotal = tasks.length;
  const taskProgress = `${completedTasks}/${taskTotal}`;
  const workoutLabel = activeSession.length > 0 ? `${activeSession.length} sets logged` : 'Workout planned';

  const planItems = useMemo<PlanItem[]>(() => {
    const mealItems = todaysMeals.map((meal, index) => ({
      id: `meal-${meal.id}`,
      time: index === 0 ? '08:00' : index === 1 ? '13:00' : '20:00',
      title: meal.name,
      subtitle: `${meal.calories} kcal · ${meal.protein}g protein`,
      domain: 'nutrition' as const,
      tag: 'Meal',
    }));

    const workoutItem: PlanItem = {
      id: 'workout-today',
      time: '18:30',
      title: activeSession.length > 0 ? 'Workout in progress' : currentSplit.split(':')[0] || 'Today workout',
      subtitle: activeSession.length > 0 ? `${activeSession.length} sets completed` : currentSplit,
      domain: 'fitness',
      tag: 'Gym',
    };

    const taskItems = tasks.map((task, index) => ({
      id: asText(task.id, `task-${index}`),
      time: taskTime(task),
      title: taskTitle(task),
      subtitle: isTaskDone(task) ? 'Completed' : asText(task.notes) || asText(task.description),
      domain: 'goals' as const,
      tag: isTaskDone(task) ? 'Done' : 'Task',
    }));

    return [...mealItems, workoutItem, ...taskItems];
  }, [activeSession.length, currentSplit, tasks, todaysMeals]);

  const loadToday = useCallback(async () => {
    if (!currentUserId || !profile || !onboardingCompleted) {
      return;
    }

    const date = todayKey();
    const waterRequest = currentUserId
      ? supabase.from('water_log').select('*').eq('date', date).eq('user_id', currentUserId)
      : supabase.from('water_log').select('*').eq('date', date);
    const [{ data: taskRows, error: taskError }, { data: waterRows, error: waterError }] = await Promise.all([
      supabase.from('tasks').select('*'),
      waterRequest,
    ]);

    if (taskError) console.warn('Unable to load tasks', taskError.message);
    if (waterError) console.warn('Unable to load water log', waterError.message);

    const todayTasks = ((taskRows ?? []) as LooseRow[]).filter((task) => rowDate(task) === date);
    const glasses = Math.min(
      waterGoalGlasses,
      ((waterRows ?? []) as LooseRow[]).reduce((total, row) => total + waterGlasses(row), 0),
    );
    const nextWater = glasses > 0 ? glasses : Math.min(waterGoalGlasses, Math.round(waterMl / WATER_GLASS_ML));
    const nutritionScore = calculateGoalScore(Math.min(calories, calorieGoal), calorieGoal);
    const fitnessScore = activeSession.length > 0 ? 85 : 45;
    const productivityScore =
      todayTasks.length > 0 ? calculateGoalScore(todayTasks.filter(isTaskDone).length, todayTasks.length) : 50;
    const habitsScore = calculateGoalScore(nextWater, waterGoalGlasses);
    const score = calculateLifeScore({
      nutritionScore,
      fitnessScore,
      productivityScore,
      habitsScore,
      learningScore: 50,
    });
    const nextTaskProgress = `${todayTasks.filter(isTaskDone).length}/${todayTasks.length}`;

    setTasks(todayTasks);
    setWaterCount(nextWater);
    setWaterMl(nextWater * WATER_GLASS_ML);
    setLifeScore(score);

    try {
      const insight = await getDailyBrief({
        date,
        lifeScore: score,
        caloriesRemaining,
        waterGlasses: nextWater,
        tasks: todayTasks.map((task) => ({ title: taskTitle(task), done: isTaskDone(task) })),
        meals: todaysMeals,
        workout: { activeSets: activeSession.length, split: currentSplit },
      });
      setBrief(insight.trim().split('\n')[0] || fallbackBrief(score, caloriesRemaining, nextTaskProgress));
    } catch (error) {
      console.warn('Unable to load daily brief', error);
      setBrief(fallbackBrief(score, caloriesRemaining, nextTaskProgress));
    }
  }, [
    activeSession.length,
    calorieGoal,
    calories,
    caloriesRemaining,
    currentSplit,
    currentUserId,
    onboardingCompleted,
    profile,
    setLifeScore,
    setWaterMl,
    todaysMeals,
    waterMl,
    waterGoalGlasses,
  ]);

  const refreshToday = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadToday();
    } finally {
      setRefreshing(false);
    }
  }, [loadToday]);

  useEffect(() => {
    void refreshToday();
  }, [refreshToday]);

  useEffect(() => {
    if (params.reflection === '1') setReflectionVisible(true);
  }, [params.reflection]);

  const addWater = useCallback(async () => {
    const next = Math.min(waterGoalGlasses, waterCount + 1);
    if (next === waterCount) return;

    setWaterCount(next);
    setWaterMl(next * WATER_GLASS_ML);

    if (!currentUserId) return;

    const payload = {
      user_id: currentUserId,
      date: todayKey(),
      glasses: next,
      amount_ml: next * WATER_GLASS_ML,
      target_ml: waterTargetMl,
    };

    const { error } = await syncWaterLog(payload);
    if (error) {
      console.warn('Unable to update water log', error.message);
      Alert.alert('Water not synced', 'Your glass was added locally, but Supabase did not update.');
    }
  }, [currentUserId, setWaterMl, waterCount, waterGoalGlasses, waterTargetMl]);

  const actions: ActionTile[] = [
    { label: 'Log Meal', icon: 'restaurant-outline', onPress: () => router.push('/(tabs)/nutrition') },
    { label: 'Start Workout', icon: 'barbell-outline', onPress: () => router.push('/(tabs)/gym') },
    { label: 'Add Task', icon: 'add-circle-outline', onPress: () => router.push('/modal' as never) },
    { label: 'Log Water', icon: 'water-outline', onPress: addWater },
  ];

  return (
    <>
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshToday} tintColor={colors.violetLight} />
      }
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning 👋</Text>
          <Text style={styles.name}>{name}</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.date}>{formatHeaderDate()}</Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity activeOpacity={0.86} onPress={() => router.push('/(tabs)/analytics')}>
        <LifeOSCard accentColor={colors.violet} style={styles.heroCard}>
          <ProgressRing
            progress={lifeScore}
            size={150}
            strokeWidth={10}
            color={colors.violet}
            label="Life Score"
            arcDegrees={270}
            valueStyle={styles.scoreValue}
            labelStyle={styles.scoreLabel}
          />
          <View style={styles.domainRow}>
            <DomainBadge domain="nutrition" label={`${caloriesRemaining} kcal`} />
            <DomainBadge domain="fitness" label={workoutLabel} />
            <DomainBadge domain="goals" label={`${taskProgress} tasks`} />
          </View>
        </LifeOSCard>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Today's Plan</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/modal' as never)} hitSlop={8}>
          <Text style={styles.addText}>Add +</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={planItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TimelineItem
            time={item.time}
            title={item.title}
            subtitle={item.subtitle}
            color={domains[item.domain].color}
            tag={item.tag}
          />
        )}
        scrollEnabled={false}
        ListEmptyComponent={<Text style={styles.emptyText}>Nothing scheduled yet.</Text>}
      />

      <View style={styles.quickActions}>
        {actions.map((action) => (
          <TouchableOpacity key={action.label} activeOpacity={0.82} onPress={action.onPress} style={styles.actionTile}>
            <Ionicons name={action.icon} size={22} color={colors.textPrimary} />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <LifeOSCard accentColor={colors.emerald} style={styles.waterCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Hydration · {waterCount} / {waterGoalGlasses} glasses</Text>
          <TouchableOpacity accessibilityRole="button" onPress={addWater} style={styles.plusButton}>
            <Ionicons name="add" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.dropletRow}>
          {Array.from({ length: waterGoalGlasses }).map((_, index) => {
            const filled = index < waterCount;
            return (
              <Ionicons
                key={index}
                name={filled ? 'water' : 'water-outline'}
                size={24}
                color={filled ? colors.emerald : colors.textMuted}
              />
            );
          })}
        </View>
      </LifeOSCard>

      <LifeOSCard accentColor={colors.violet} style={styles.briefCard}>
        <View style={styles.briefHeader}>
          <Ionicons name="sparkles" size={20} color={colors.violetLight} />
          <Text style={styles.cardTitle}>Good morning brief</Text>
        </View>
        <Text numberOfLines={2} style={styles.briefText}>
          {brief}
        </Text>
      </LifeOSCard>
    </ScrollView>

    <Modal visible={reflectionVisible} animationType="slide" transparent onRequestClose={() => setReflectionVisible(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Evening review</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => setReflectionVisible(false)}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalPrompt}>How was today?</Text>
          <TextInput
            value={reflection}
            onChangeText={setReflection}
            multiline
            placeholder="Energy, food, training, mood..."
            placeholderTextColor={colors.textMuted}
            style={styles.reflectionInput}
          />
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              setReflection('');
              setReflectionVisible(false);
              Alert.alert('Reflection saved', 'Your review is captured for today.');
            }}
            style={styles.saveReflectionButton}>
            <Text style={styles.saveReflectionText}>Save review</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  greeting: {
    ...typography.labelCaps,
    color: colors.textMuted,
    fontWeight: '500',
    textTransform: 'none',
  },
  name: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  date: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    color: colors.violetLight,
    fontSize: 16,
    fontWeight: '700',
  },
  heroCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  scoreValue: {
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 50,
  },
  scoreLabel: {
    color: colors.textSecondary,
    textTransform: 'none',
  },
  domainRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    fontSize: 18,
  },
  addText: {
    ...typography.body,
    color: colors.violetLight,
    fontWeight: '700',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionTile: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 86,
    paddingHorizontal: 6,
  },
  actionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },
  waterCard: {
    gap: spacing.sm,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  plusButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  dropletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  briefCard: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  briefHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  briefText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: spacing.md,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  modalPrompt: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  reflectionInput: {
    ...typography.body,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    minHeight: 120,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  saveReflectionButton: {
    alignItems: 'center',
    backgroundColor: colors.violetLight,
    borderRadius: radii.inner,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  saveReflectionText: {
    color: colors.background,
    fontWeight: '800',
  },
});
