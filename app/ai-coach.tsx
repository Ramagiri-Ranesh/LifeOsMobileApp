import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { callAI, getActiveAIModelLabel, getPatternInsight } from '@/lib/ai';
import { colors, shadows, spacing, typography } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { useAICoachStore, type CoachMessage, type CoachMessageType } from '@/stores/useAICoachStore';
import { useGoalsStore } from '@/stores/useGoalsStore';
import { useGymStore } from '@/stores/useGymStore';
import { useHabitsStore } from '@/stores/useHabitsStore';
import { useNutritionStore, type FoodItem, type Meal } from '@/stores/useNutritionStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

type InsightCard = {
  id: string;
  title: string;
  text: string;
  accent: string;
  background: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type CoachContext = {
  recentMeals: unknown[];
  recentWorkouts: unknown[];
  weeklyGoals: unknown[];
  habitStreaks: unknown[];
  recentLifeScores: unknown[];
  selectedChips: string[];
};

const CONTEXT_CHIPS = ['My diet today', "Today's workout", 'Weekly progress', 'Sleep last night'];
const TODAY = new Date().toISOString().slice(0, 10);

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sumMealProtein(meals: Meal[]) {
  return Math.round(meals.reduce((total, meal) => total + meal.protein, 0));
}

function makeMessage(role: CoachMessage['role'], text: string, type: CoachMessageType = 'text', payload?: Record<string, Json>): CoachMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    type,
    text,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function mealSummary(meals: Meal[]) {
  if (meals.length === 0) return 'No meals logged today yet.';
  const calories = meals.reduce((total, meal) => total + meal.calories, 0);
  const protein = sumMealProtein(meals);
  return `${meals.length} meals, ${calories} kcal, ${protein}g protein. Foods: ${meals
    .flatMap((meal) => meal.items.map((item) => item.name))
    .slice(0, 8)
    .join(', ')}.`;
}

function workoutSummary(activeSession: ReturnType<typeof useGymStore.getState>['activeSession'], currentSplit: string) {
  if (activeSession.length === 0) return `No active workout logged. Planned split: ${currentSplit}.`;
  const exercises = Array.from(new Set(activeSession.map((set) => set.exercise))).join(', ');
  return `${activeSession.length} sets logged across ${exercises}. Planned split: ${currentSplit}.`;
}

function goalsSummary(weeklyGoals: ReturnType<typeof useGoalsStore.getState>['weeklyGoals']) {
  if (weeklyGoals.length === 0) return 'No weekly goals loaded yet.';
  return weeklyGoals.map((goal) => `${goal.title}: ${goal.progress}%`).join(' | ');
}

function streakSummary(habits: ReturnType<typeof useHabitsStore.getState>['habits'], gymStreak: number) {
  const habitText = habits.length > 0 ? habits.map((habit) => `${habit.name} ${habit.streak}d`).join(', ') : 'No habit streaks loaded';
  return `${habitText}. Gym streak ${gymStreak}d.`;
}

function formatChipContext(chips: string[], summaries: Record<string, string>) {
  if (chips.length === 0) return '';
  return chips.map((chip) => `${chip}: ${summaries[chip]}`).join('\n');
}

function inferMessageType(text: string): CoachMessageType {
  const lower = text.toLowerCase();
  if (lower.includes('meal') || lower.includes('protein') || lower.includes('calorie')) return 'meal-suggestion';
  if (lower.includes('workout') || lower.includes('sets') || lower.includes('reps')) return 'workout-tip';
  if (lower.includes('goal') || lower.includes('target') || lower.includes('habit')) return 'goal-recommendation';
  return 'text';
}

function Dot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 260, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [delay, opacity]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

function TypingIndicator() {
  return (
    <View style={[styles.messageRow, styles.aiRow]}>
      <View style={[styles.bubble, styles.aiBubble, styles.typingBubble]}>
        <Dot delay={0} />
        <Dot delay={120} />
        <Dot delay={240} />
      </View>
    </View>
  );
}

function MessageCard({ message, onAddMeal }: { message: CoachMessage; onAddMeal: (message: CoachMessage) => void }) {
  const isUser = message.role === 'user';
  const icon =
    message.type === 'meal-suggestion' ? 'restaurant-outline' : message.type === 'workout-tip' ? 'barbell-outline' : 'flag-outline';

  if (isUser || message.type === 'text') {
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.aiText]}>{message.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.messageRow, styles.aiRow]}>
      <Pressable
        style={[styles.bubble, styles.aiBubble, styles.richCard]}
        onPress={message.type === 'meal-suggestion' ? () => onAddMeal(message) : undefined}>
        <View style={styles.richHeader}>
          <View style={styles.richIcon}>
            <Ionicons name={icon} size={16} color={colors.violetLight} />
          </View>
          <Text style={styles.richTitle}>
            {message.type === 'meal-suggestion'
              ? 'Meal suggestion'
              : message.type === 'workout-tip'
                ? 'Workout tip'
                : 'Goal recommendation'}
          </Text>
          {message.type === 'meal-suggestion' ? <Ionicons name="add-circle-outline" size={18} color={colors.emeraldLight} /> : null}
        </View>
        <Text style={styles.aiText}>{message.text}</Text>
      </Pressable>
    </View>
  );
}

async function loadRecentContext(
  todaysMeals: Meal[],
  activeSession: ReturnType<typeof useGymStore.getState>['activeSession'],
  currentSplit: string,
  weeklyGoals: ReturnType<typeof useGoalsStore.getState>['weeklyGoals'],
  habits: ReturnType<typeof useHabitsStore.getState>['habits'],
  gymStreak: number,
  currentUserId: string | null,
): Promise<CoachContext> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  const sinceDate = since.toISOString().slice(0, 10);

  try {
    const [mealLogs, workouts, goals, lifeScores] = await Promise.all([
      supabase
        .from('meal_logs')
        .select('*, meal_log_items(*, food_items(*))')
        .gte('date', sinceDate)
        .order('date', { ascending: false }),
      currentUserId
        ? supabase
            .from('workout_sessions')
            .select('*, workout_sets(*)')
            .eq('user_id', currentUserId)
            .order('started_at', { ascending: false })
            .limit(5)
        : supabase.from('workout_sessions').select('*').limit(0),
      supabase.from('weekly_goals').select('*').limit(20),
      supabase.from('life_scores').select('*').order('created_at', { ascending: false }).limit(10),
    ]);

    return {
      recentMeals: mealLogs.data ?? [{ date: TODAY, meals: todaysMeals }],
      recentWorkouts: workouts.data ?? [{ activeSession, currentSplit }],
      weeklyGoals: goals.data ?? weeklyGoals,
      habitStreaks: habits.map((habit) => ({ name: habit.name, streak: habit.streak, completedToday: habit.completedToday })),
      recentLifeScores: lifeScores.data ?? [],
      selectedChips: [],
    };
  } catch (error) {
    console.warn('Unable to build full AI coach context', error);
    return {
      recentMeals: [{ date: TODAY, meals: todaysMeals }],
      recentWorkouts: [{ activeSession, currentSplit }],
      weeklyGoals,
      habitStreaks: habits.map((habit) => ({ name: habit.name, streak: habit.streak, completedToday: habit.completedToday })),
      recentLifeScores: [],
      selectedChips: [],
    };
  }
}

function buildNutrientAlert(todaysMeals: Meal[], proteinTarget: number, recentMeals: unknown[]) {
  const todayProtein = sumMealProtein(todaysMeals);
  const belowToday = Math.max(0, proteinTarget - todayProtein);
  const rows = Array.isArray(recentMeals) ? (recentMeals as LooseRow[]) : [];
  const belowDays = rows
    .slice(0, 3)
    .filter((row) => {
      const rawItems = Array.isArray(row.meal_log_items) ? row.meal_log_items : [];
      const protein = rawItems.reduce<number>((total, raw) => {
        const item = raw && typeof raw === 'object' ? (raw as LooseRow) : {};
        return total + asNumber(item.protein);
      }, asNumber(row.protein));
      return proteinTarget > 0 && protein < proteinTarget;
    })
    .length;

  if (belowDays >= 3) return `Protein ${Math.round(belowToday || 40)}g below target 3 days running. Add a lean protein anchor tonight.`;
  if (belowToday > 0) return `Protein ${belowToday}g below target today. A quick eggs, dal, or chicken add-on closes the gap.`;
  return 'Protein target is on track today. Keep the final meal balanced and light.';
}

function buildStreakWin(habits: ReturnType<typeof useHabitsStore.getState>['habits'], gymStreak: number) {
  const bestHabit = [...habits].sort((a, b) => b.streak - a.streak)[0];
  if (bestHabit && bestHabit.streak > 0) return `${bestHabit.name} is on a ${bestHabit.streak}-day streak. Protect that momentum today.`;
  if (gymStreak > 0) return `Gym streak is at ${gymStreak} days. One focused session keeps the chain alive.`;
  return 'Fresh streak window today. One small completion is enough to start the next run.';
}

export default function AICoachScreen() {
  const { messages, addMessage, updateMessage, loadPersistedMessages, persistRecentMessages } = useAICoachStore();
  const { todaysMeals, logMealItem } = useNutritionStore();
  const { activeSession, currentSplit, streak: gymStreak } = useGymStore();
  const { weeklyGoals } = useGoalsStore();
  const { habits } = useHabitsStore();
  const { currentUserId, macros } = useUserStore();

  const [input, setInput] = useState('');
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [insights, setInsights] = useState<InsightCard[]>([
    {
      id: 'correlation',
      title: 'Correlation',
      text: "You're 40% more focused on gym days. Keep workouts near high-focus tasks.",
      accent: colors.amber,
      background: colors.amberBg,
      icon: 'analytics-outline',
    },
    {
      id: 'protein',
      title: 'Nutrient alert',
      text: 'Protein 40g below target 3 days running. Add one dense protein meal.',
      accent: colors.rose,
      background: colors.roseBg,
      icon: 'warning-outline',
    },
    {
      id: 'streak',
      title: 'Streak win',
      text: 'Your habit streak is building. One completion today locks the milestone.',
      accent: colors.emerald,
      background: colors.emeraldBg,
      icon: 'sparkles-outline',
    },
  ]);
  const chipSummaries = useMemo(
    () => ({
      'My diet today': mealSummary(todaysMeals),
      "Today's workout": workoutSummary(activeSession, currentSplit),
      'Weekly progress': goalsSummary(weeklyGoals),
      'Sleep last night': 'Use recent life scores and habit notes to infer sleep recovery if logged.',
    }),
    [activeSession, currentSplit, todaysMeals, weeklyGoals],
  );

  useEffect(() => {
    loadPersistedMessages();
  }, [loadPersistedMessages]);

  useEffect(() => {
    let cancelled = false;

    async function loadInsights() {
      const nextContext = await loadRecentContext(todaysMeals, activeSession, currentSplit, weeklyGoals, habits, gymStreak, currentUserId);
      if (cancelled) return;

      let pattern = "You're 40% more focused on gym days. Keep workouts near high-focus tasks.";
      try {
        const response = await getPatternInsight();
        if (response.trim().length > 0) pattern = response.trim();
      } catch (error) {
        console.warn('Unable to load pattern insight', error);
      }

      if (!cancelled) {
        setInsights([
          {
            id: 'correlation',
            title: 'Correlation',
            text: pattern,
            accent: colors.amber,
            background: colors.amberBg,
            icon: 'analytics-outline',
          },
          {
            id: 'protein',
            title: 'Nutrient alert',
            text: buildNutrientAlert(todaysMeals, macros.protein, nextContext.recentMeals),
            accent: colors.rose,
            background: colors.roseBg,
            icon: 'warning-outline',
          },
          {
            id: 'streak',
            title: 'Streak win',
            text: buildStreakWin(habits, gymStreak),
            accent: colors.emerald,
            background: colors.emeraldBg,
            icon: 'sparkles-outline',
          },
        ]);
      }
    }

    loadInsights();
    return () => {
      cancelled = true;
    };
  }, [activeSession, currentSplit, currentUserId, gymStreak, habits, macros.protein, todaysMeals, weeklyGoals]);

  const toggleChip = (chip: string) => {
    setSelectedChips((current) => (current.includes(chip) ? current.filter((item) => item !== chip) : [...current, chip]));
  };

  const revealAIResponse = async (messageId: string, text: string) => {
    const words = text.split(' ');
    let next = '';
    for (const word of words) {
      next = next.length > 0 ? `${next} ${word}` : word;
      updateMessage(messageId, { text: next });
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    const chipContext = formatChipContext(selectedChips, chipSummaries);
    const userMessage = makeMessage('user', trimmed);
    addMessage(userMessage);
    setInput('');
    setSelectedChips([]);
    setIsProcessing(true);

    try {
      const freshContext = await loadRecentContext(todaysMeals, activeSession, currentSplit, weeklyGoals, habits, gymStreak, currentUserId);
      const response = await callAI(trimmed, {
        ...freshContext,
        last7DaysMeals: freshContext.recentMeals,
        last5Workouts: freshContext.recentWorkouts,
        currentWeekGoals: weeklyGoals,
        habitStreaks: streakSummary(habits, gymStreak),
        recentLifeScores: freshContext.recentLifeScores,
        selectedChips,
        selectedChipContext: chipContext,
      });
      const responseText = response.trim() || 'I am here, but I could not generate a useful response this time.';
      const aiMessage = makeMessage('ai', '', inferMessageType(responseText));
      addMessage(aiMessage);
      await revealAIResponse(aiMessage.id, responseText);
      const recentMessages = [...useAICoachStore.getState().messages.filter((message) => message.id !== aiMessage.id), { ...aiMessage, text: responseText }];
      await persistRecentMessages(recentMessages);
    } catch (error) {
      console.warn('AI coach request failed', error);
      const fallbackMessage = makeMessage('ai', 'I could not reach the coach model right now. Try again in a moment.', 'text');
      addMessage(fallbackMessage);
      await persistRecentMessages(useAICoachStore.getState().messages);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddMeal = async (message: CoachMessage) => {
    const food: FoodItem = {
      id: typeof message.payload?.foodId === 'string' ? message.payload.foodId : `coach-${Date.now()}`,
      name: typeof message.payload?.foodName === 'string' ? message.payload.foodName : 'AI coach meal',
      serving: '1 serving',
      calories: typeof message.payload?.calories === 'number' ? message.payload.calories : 420,
      protein: typeof message.payload?.protein === 'number' ? message.payload.protein : 32,
      carbs: typeof message.payload?.carbs === 'number' ? message.payload.carbs : 45,
      fat: typeof message.payload?.fat === 'number' ? message.payload.fat : 12,
    };
    await logMealItem(TODAY, 'evening_snack', food, 1);
  };

  const listData = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>AI Coach</Text>
            <Text style={styles.lastInsight}>Last insight: 2 hours ago</Text>
          </View>
          <View style={styles.modelBadge}>
            <Ionicons name="hardware-chip-outline" size={14} color={colors.violetLight} />
            <Text style={styles.modelText}>{getActiveAIModelLabel()}</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.insightStrip}
          style={styles.insightScroll}>
          {insights.map((insight) => (
            <View key={insight.id} style={[styles.insightCard, { backgroundColor: insight.background, borderColor: insight.accent }]}>
              <View style={styles.insightTop}>
                <Ionicons name={insight.icon} size={17} color={insight.accent} />
                <Text style={[styles.insightTitle, { color: insight.accent }]}>{insight.title}</Text>
              </View>
              <Text style={styles.insightText} numberOfLines={4}>
                {insight.text}
              </Text>
            </View>
          ))}
        </ScrollView>

        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          inverted
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chatContent}
          ListHeaderComponent={isProcessing ? <TypingIndicator /> : null}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Ask for the next best move.</Text>
              <Text style={styles.emptyText}>Your coach can use meals, workouts, goals, habits, and recent scores as context.</Text>
            </View>
          }
          renderItem={({ item }) => <MessageCard message={item} onAddMeal={handleAddMeal} />}
        />

        <View style={styles.composerWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {CONTEXT_CHIPS.map((chip) => {
              const selected = selectedChips.includes(chip);
              return (
                <TouchableOpacity
                  key={chip}
                  activeOpacity={0.8}
                  style={[styles.contextChip, selected && styles.contextChipActive]}
                  onPress={() => toggleChip(chip)}>
                  <Text style={[styles.contextChipText, selected && styles.contextChipTextActive]}>{chip}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.inputBar}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask anything..."
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
              maxLength={800}
            />
            <TouchableOpacity style={styles.iconButton} activeOpacity={0.75} accessibilityLabel="Voice input placeholder">
              <Ionicons name="mic-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, (!input.trim() || isProcessing) && styles.sendButtonDisabled]}
              activeOpacity={0.85}
              disabled={!input.trim() || isProcessing}
              onPress={handleSend}
              accessibilityLabel="Send message">
              <Ionicons name="arrow-up" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  lastInsight: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  modelBadge: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: colors.violetBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modelText: {
    ...typography.labelCaps,
    color: colors.violetLight,
  },
  insightScroll: {
    flexGrow: 0,
  },
  insightStrip: {
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.sm,
  },
  insightCard: {
    width: 200,
    minHeight: 126,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
  },
  insightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.xs,
  },
  insightTitle: {
    ...typography.labelCaps,
    textTransform: 'uppercase',
  },
  insightText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  chatContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  messageRow: {
    width: '100%',
    marginVertical: 5,
  },
  aiRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: 11,
  },
  aiBubble: {
    backgroundColor: colors.surface2,
    borderLeftWidth: 2,
    borderLeftColor: colors.violet,
    borderTopLeftRadius: 8,
  },
  userBubble: {
    backgroundColor: colors.violet,
  },
  messageText: {
    ...typography.body,
  },
  aiText: {
    color: colors.textPrimary,
  },
  userText: {
    color: colors.textPrimary,
  },
  richCard: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  richHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  richIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.violetBg,
  },
  richTitle: {
    ...typography.labelCaps,
    flex: 1,
    color: colors.violetLight,
    textTransform: 'uppercase',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 66,
    minHeight: 42,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.violetLight,
  },
  emptyState: {
    alignSelf: 'center',
    maxWidth: 300,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  composerWrap: {
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.gutter,
    paddingBottom: Platform.OS === 'ios' ? spacing.sm : spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  chipRow: {
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  contextChip: {
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  contextChipActive: {
    borderColor: colors.violet,
    backgroundColor: colors.violetBg,
  },
  contextChipText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  contextChipTextActive: {
    color: colors.violetLight,
  },
  inputBar: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    padding: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
    ...shadows.ambient,
  },
  input: {
    ...typography.body,
    flex: 1,
    maxHeight: 108,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    color: colors.textPrimary,
  },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: colors.surface2,
  },
  sendButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: colors.violet,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
});
