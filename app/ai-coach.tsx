import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AIRequestError, callAI, getActiveAIModelLabel } from '@/lib/ai';
import { colors as fallbackColors, shadows, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { useAICoachStore, type CoachMessage, type CoachMessageType } from '@/stores/useAICoachStore';
import { useGoalsStore } from '@/stores/useGoalsStore';
import { useGymStore } from '@/stores/useGymStore';
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
  recentLifeScores: unknown[];
  selectedChips: string[];
};

const CONTEXT_CHIPS = ['My diet today', "Today's workout", 'Weekly progress', 'Sleep last night'];
const TODAY = new Date().toISOString().slice(0, 10);

type AITheme = {
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
};

const fallbackAITheme: AITheme = {
  colors: fallbackColors,
  styles: createStyles(fallbackColors),
};

const AIThemeContext = createContext<AITheme>(fallbackAITheme);

function useAITheme() {
  return useContext(AIThemeContext);
}

function asNumber(value: Json | undefined, fallback = 0) {
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
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

function streakSummary(gymStreak: number) {
  if (gymStreak > 0) return `Gym streak ${gymStreak}d.`;
  return 'No gym streak loaded yet.';
}

function formatChipContext(chips: string[], summaries: Record<string, string>) {
  if (chips.length === 0) return '';
  return chips.map((chip) => `${chip}: ${summaries[chip]}`).join('\n');
}

function inferMessageType(text: string): CoachMessageType {
  const lower = text.toLowerCase();
  if (lower.includes('meal') || lower.includes('protein') || lower.includes('calorie')) return 'meal-suggestion';
  if (lower.includes('workout') || lower.includes('sets') || lower.includes('reps')) return 'workout-tip';
  if (lower.includes('goal') || lower.includes('target')) return 'goal-recommendation';
  return 'text';
}

function Dot({ delay }: { delay: number }) {
  const { styles } = useAITheme();
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
  const { styles } = useAITheme();

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
  const { colors, styles } = useAITheme();
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
      currentUserId
        ? supabase
            .from('life_scores')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false })
            .limit(10)
        : supabase.from('life_scores').select('*').limit(0),
    ]);

    return {
      recentMeals: mealLogs.data ?? [{ date: TODAY, meals: todaysMeals }],
      recentWorkouts: workouts.data ?? [{ activeSession, currentSplit }],
      weeklyGoals: goals.data ?? weeklyGoals,
      recentLifeScores: lifeScores.data ?? [],
      selectedChips: [],
    };
  } catch (error) {
    console.warn('Unable to build full AI coach context', error);
    return {
      recentMeals: [{ date: TODAY, meals: todaysMeals }],
      recentWorkouts: [{ activeSession, currentSplit }],
      weeklyGoals,
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

function buildStreakWin(gymStreak: number) {
  if (gymStreak > 0) return `Gym streak is at ${gymStreak} days. One focused session keeps the chain alive.`;
  return 'Fresh training window today. One focused session is enough to start the next run.';
}

function isToday(isoDate: string) {
  const date = new Date(isoDate);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
}

export default function AICoachScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const theme = useMemo(() => ({ colors, styles }), [colors, styles]);
  const { messages, addMessage, updateMessage, loadPersistedMessages, persistRecentMessages } = useAICoachStore();
  const { todaysMeals, logMealItem } = useNutritionStore();
  const { activeSession, currentSplit, streak: gymStreak } = useGymStore();
  const { weeklyGoals } = useGoalsStore();
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
      text: 'Your gym streak is building. One focused session today locks the milestone.',
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
      'Sleep last night': 'Use recent life scores to infer sleep recovery if logged.',
    }),
    [activeSession, currentSplit, todaysMeals, weeklyGoals],
  );
  const insightCardWidth = Math.min(200, Math.max(156, Math.floor((width - spacing.gutter * 2 - spacing.sm) / 2)));
  const dailyCoachQuestions = useMemo(
    () => messages.filter((message) => message.role === 'user' && isToday(message.createdAt)).length,
    [messages],
  );
  const dailyLimitReached = dailyCoachQuestions >= 2;

  useEffect(() => {
    loadPersistedMessages();
  }, [loadPersistedMessages]);

  useEffect(() => {
    let cancelled = false;

    async function loadInsights() {
      const nextContext = await loadRecentContext(todaysMeals, activeSession, currentSplit, weeklyGoals, gymStreak, currentUserId);
      if (cancelled) return;

      const pattern = "You're 40% more focused on gym days. Keep workouts near high-focus tasks.";

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
            text: buildStreakWin(gymStreak),
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
  }, [activeSession, colors, currentSplit, currentUserId, gymStreak, macros.protein, todaysMeals, weeklyGoals]);

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
    if (!trimmed || isProcessing || dailyLimitReached) return;

    const chipContext = formatChipContext(selectedChips, chipSummaries);
    const userMessage = makeMessage('user', trimmed);
    addMessage(userMessage);
    setInput('');
    setSelectedChips([]);
    setIsProcessing(true);

    try {
      const freshContext = await loadRecentContext(todaysMeals, activeSession, currentSplit, weeklyGoals, gymStreak, currentUserId);
      const response = await callAI(trimmed, {
        ...freshContext,
        last7DaysMeals: freshContext.recentMeals,
        last5Workouts: freshContext.recentWorkouts,
        currentWeekGoals: weeklyGoals,
        streaks: streakSummary(gymStreak),
        recentLifeScores: freshContext.recentLifeScores,
        selectedChips,
        selectedChipContext: chipContext,
      }, { purpose: 'coach', allowOpenAI: true, allowLocalAI: false });
      const responseText = response.trim() || 'I am here, but I could not generate a useful response this time.';
      const aiMessage = makeMessage('ai', '', inferMessageType(responseText));
      addMessage(aiMessage);
      await revealAIResponse(aiMessage.id, responseText);
      const recentMessages = [...useAICoachStore.getState().messages.filter((message) => message.id !== aiMessage.id), { ...aiMessage, text: responseText }];
      await persistRecentMessages(recentMessages);
    } catch (error) {
      console.warn('AI coach request failed', error);
      const fallbackText =
        error instanceof AIRequestError
          ? error.message
          : 'I could not reach the coach model right now. Try again in a moment.';
      const fallbackMessage = makeMessage('ai', fallbackText, 'text');
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
    <AIThemeContext.Provider value={theme}>
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close AI Coach"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)' as never);
              }
            }}
            style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>AI Coach</Text>
            <Text style={styles.lastInsight}>{Math.min(dailyCoachQuestions, 2)} of 2 questions used today</Text>
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
            <View
              key={insight.id}
              style={[styles.insightCard, { width: insightCardWidth, backgroundColor: insight.background, borderColor: insight.accent }]}>
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
              <Text style={styles.emptyText}>Your coach can use meals, workouts, goals, and recent scores as context.</Text>
            </View>
          }
          renderItem={({ item }) => <MessageCard message={item} onAddMeal={handleAddMeal} />}
        />

        <View style={styles.composerWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
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
              placeholder={dailyLimitReached ? 'Daily limit reached' : 'Ask anything...'}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
              maxLength={800}
            />
            <TouchableOpacity style={styles.iconButton} activeOpacity={0.75} accessibilityLabel="Voice input placeholder">
              <Ionicons name="mic-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, (!input.trim() || isProcessing || dailyLimitReached) && styles.sendButtonDisabled]}
              activeOpacity={0.85}
              disabled={!input.trim() || isProcessing || dailyLimitReached}
              onPress={handleSend}
              accessibilityLabel="Send message">
              <Ionicons name="arrow-up" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </AIThemeContext.Provider>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
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
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
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
    maxWidth: '48%',
    flexShrink: 1,
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
    flexShrink: 1,
    color: colors.violetLight,
  },
  insightScroll: {
    flexGrow: 0,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  insightStrip: {
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.sm,
  },
  insightCard: {
    minHeight: 126,
    flexShrink: 0,
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
    maxWidth: '100%',
    overflow: 'hidden',
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
  chipScroll: {
    maxWidth: '100%',
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
    minWidth: 0,
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
}
