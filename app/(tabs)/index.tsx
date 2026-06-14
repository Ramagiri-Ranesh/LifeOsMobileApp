import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DomainBadge } from '@/components/ui/DomainBadge';
import { BodyProgressModal } from '@/components/body/BodyProgressModal';
import { LifeOSCard } from '@/components/ui/LifeOSCard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { TimelineItem } from '@/components/ui/TimelineItem';
import { getDailyBrief } from '@/lib/ai';
import { canRecalibrateBodyPlan, loadBodyMetrics, type BodyMetricLog } from '@/lib/bodyMetrics';
import { domainsForColors, radii, spacing, typography, useLifeOSColors, type ColorPalette, type Domain } from '@/lib/design';
import { calculateDailyLifeScore, persistDailyLifeScore } from '@/lib/lifeScore';
import { mealFallbackTime } from '@/lib/nutritionSchedule';
import { cancelTaskNotification, countUnreadNotifications, scheduleTaskNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { syncWaterLog } from '@/lib/waterLog';
import { ensureTodayWorkoutTask, isWorkoutTask } from '@/lib/workoutTasks';
import { buildTodaysWorkoutTemplate } from '@/lib/workoutPlan';
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
  kind: 'meal' | 'workout' | 'task';
  completed?: boolean;
};

type ActionTile = {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
};

type AddTaskForm = {
  title: string;
  date: string;
  time: string;
  priority: string;
  notes: string;
  notify: boolean;
};

const WATER_GLASS_ML = 250;

const priorityOptions = ['low', 'medium', 'high'];

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function timeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return { greeting: 'Good morning', briefTitle: 'Good morning brief' };
  if (hour >= 12 && hour < 17) return { greeting: 'Good afternoon', briefTitle: 'Good afternoon brief' };
  if (hour >= 17 && hour < 21) return { greeting: 'Good evening', briefTitle: 'Good evening brief' };
  return { greeting: 'Good night', briefTitle: 'Good night brief' };
}

function nextHourTime() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  const hour = `${date.getHours()}`.padStart(2, '0');
  return `${hour}:00`;
}

function formatTaskTime(time: string) {
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 'Today';

  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${`${minute}`.padStart(2, '0')} ${suffix}`;
}

function adjustTaskTime(time: string, minutesToAdd: number) {
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const current = (Number.isInteger(hour) ? hour : 9) * 60 + (Number.isInteger(minute) ? minute : 0);
  const next = (current + minutesToAdd + 24 * 60) % (24 * 60);
  return `${`${Math.floor(next / 60)}`.padStart(2, '0')}:${`${next % 60}`.padStart(2, '0')}`;
}

function toggleMeridiem(time: string) {
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '09:00';
  return `${`${(hour + 12) % 24}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
}

function formatHeaderDate(date = new Date()) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
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
  return asText(row.time_block) || asText(row.due_time) || asText(row.time) || 'Today';
}

function taskTitle(row: LooseRow) {
  return asText(row.title) || asText(row.name) || asText(row.task) || 'Untitled task';
}

function taskMinutes(row: LooseRow) {
  const rawTime = taskTime(row).trim();
  const meridiemMatch = rawTime.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (meridiemMatch) {
    const hourRaw = Number(meridiemMatch[1]);
    const minute = Number(meridiemMatch[2]);
    const meridiem = meridiemMatch[3].toUpperCase();
    if (!Number.isInteger(hourRaw) || !Number.isInteger(minute)) return null;
    const hour = meridiem === 'PM' ? (hourRaw % 12) + 12 : hourRaw % 12;
    return hour * 60 + minute;
  }

  const twentyFourHourMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  return null;
}

function isTaskPending(row: LooseRow, now = new Date()) {
  if (isTaskDone(row)) return false;

  const date = rowDate(row);
  const today = todayKey(now);
  if (date && date < today) return true;
  if (date && date > today) return false;

  const minutes = taskMinutes(row);
  if (minutes === null) return false;

  return minutes < now.getHours() * 60 + now.getMinutes();
}

function dedupeTasks(rows: LooseRow[]) {
  const order: string[] = [];
  const byKey = new Map<string, LooseRow>();

  rows.forEach((row, index) => {
    const key = isWorkoutTask(row)
      ? `workout:${asText(row.user_id)}:${rowDate(row)}:${taskTitle(row).toLowerCase()}`
      : asText(row.id, `task-${index}`);
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, row);
      return;
    }
    if (!isTaskDone(existing) && isTaskDone(row)) {
      byKey.set(key, row);
    }
  });

  return order.map((key) => byKey.get(key)).filter((row): row is LooseRow => Boolean(row));
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
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const domains = useMemo(() => domainsForColors(colors), [colors]);
  const profile = useUserStore((state) => state.profile);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const onboardingCompleted = useUserStore((state) => state.onboardingCompleted);
  const onboardingProfile = useUserStore((state) => state.onboardingProfile);
  const generatedPlan = useUserStore((state) => state.generatedPlan);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const macros = useUserStore((state) => state.macros);
  const waterTargetMl = useUserStore((state) => state.waterTargetMl);
  const todaysMeals = useNutritionStore((state) => state.todaysMeals);
  const calories = useNutritionStore((state) => state.calories);
  const waterMl = useNutritionStore((state) => state.waterMl);
  const setWaterMl = useNutritionStore((state) => state.setWaterMl);
  const activeSession = useGymStore((state) => state.activeSession);
  const lifeScore = useAnalyticsStore((state) => state.lifeScore);
  const setLifeScore = useAnalyticsStore((state) => state.setLifeScore);

  const [tasks, setTasks] = useState<LooseRow[]>([]);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const waterGoalGlasses = Math.max(1, Math.ceil(waterTargetMl / WATER_GLASS_ML));
  const [waterCount, setWaterCount] = useState(Math.min(waterGoalGlasses, Math.round(waterMl / WATER_GLASS_ML)));
  const [brief, setBrief] = useState(() => `Preparing your ${timeOfDay().briefTitle.toLowerCase()}...`);
  const [reflectionVisible, setReflectionVisible] = useState(false);
  const [reflection, setReflection] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [bodyModalVisible, setBodyModalVisible] = useState(false);
  const [bodyLogs, setBodyLogs] = useState<BodyMetricLog[]>([]);
  const [taskForm, setTaskForm] = useState<AddTaskForm>({
    title: '',
    date: todayKey(),
    time: nextHourTime(),
    priority: 'medium',
    notes: '',
    notify: false,
  });

  const name = profile?.name || onboardingProfile.name || 'User';
  const dayPeriod = useMemo(() => timeOfDay(currentTime), [currentTime]);
  const caloriesRemaining = Math.max(0, calorieGoal - calories);
  const completedTasks = tasks.filter(isTaskDone).length;
  const taskTotal = tasks.length;
  const taskProgress = `${completedTasks}/${taskTotal}`;
  const todaysWorkout = useMemo(() => buildTodaysWorkoutTemplate(generatedPlan, profile), [generatedPlan, profile]);
  const workoutTask = useMemo(() => tasks.find(isWorkoutTask) ?? null, [tasks]);
  const workoutLabel = activeSession.length > 0
    ? `${activeSession.length} sets logged`
    : todaysWorkout.isRestDay
      ? 'Recovery day'
      : workoutTask && isTaskDone(workoutTask)
        ? 'Workout done'
        : `${todaysWorkout.name} planned`;
  const latestWeightLog = useMemo(
    () => bodyLogs.filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [bodyLogs],
  );
  const bodyBriefLine = latestWeightLog
    ? latestWeightLog.date === todayKey()
      ? `Weight ${latestWeightLog.weightKg} kg logged today. Keep logging daily so your trend stays honest.`
      : `Last weight was ${latestWeightLog.weightKg} kg on ${formatShortDate(dateFromKey(latestWeightLog.date))}. Log today to keep the trend accurate.`
    : 'No weight logged yet. Add today\'s weight to start your real progress trend.';

  const planItems = useMemo<PlanItem[]>(() => {
    const mealItems = todaysMeals.map((meal) => ({
      id: `meal-${meal.id}`,
      time: mealFallbackTime(meal.type),
      title: meal.name,
      subtitle: `${meal.calories} kcal · ${meal.protein}g protein`,
      domain: 'nutrition' as const,
      tag: 'Meal',
      kind: 'meal' as const,
    }));

    const taskItems = tasks.map((task, index) => {
      const completed = isTaskDone(task);
      const pending = isTaskPending(task, currentTime);
      const notes = asText(task.notes) || asText(task.description);

      return {
        id: asText(task.id, `task-${index}`),
        time: taskTime(task),
        title: taskTitle(task),
        subtitle: completed
          ? 'Completed'
          : pending
            ? notes || `Pending since ${taskTime(task)}`
            : isWorkoutTask(task) && activeSession.length > 0
              ? `${activeSession.length} sets completed`
              : notes,
        domain: pending ? 'alert' as const : isWorkoutTask(task) ? 'fitness' as const : 'goals' as const,
        tag: completed ? 'Done' : pending ? 'Pending' : isWorkoutTask(task) ? 'Gym' : 'Task',
        kind: 'task' as const,
        completed,
      };
    });

    return [...mealItems, ...taskItems];
  }, [activeSession.length, currentTime, tasks, todaysMeals]);

  const loadToday = useCallback(async () => {
    if (!currentUserId || !profile || !onboardingCompleted) {
      return;
    }

    const date = todayKey();
    const waterRequest = currentUserId
      ? supabase.from('water_log').select('*').eq('date', date).eq('user_id', currentUserId)
      : supabase.from('water_log').select('*').eq('date', date);
    const [{ data: taskRows, error: taskError }, { data: waterRows, error: waterError }] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', currentUserId),
      waterRequest,
    ]);
    setUnreadNotifications(await countUnreadNotifications(currentUserId));
    let loadedBodyLogs: BodyMetricLog[] = [];
    try {
      loadedBodyLogs = await loadBodyMetrics(currentUserId, 45);
      setBodyLogs(loadedBodyLogs);
    } catch (error) {
      console.warn('Unable to load body metrics for brief', error);
      setBodyLogs([]);
    }

    if (taskError) console.warn('Unable to load tasks', taskError.message);
    if (waterError) console.warn('Unable to load water log', waterError.message);

    let allTasks = (taskRows ?? []) as LooseRow[];
    const ensuredWorkoutTask = await ensureTodayWorkoutTask(todaysWorkout, currentUserId, allTasks);
    if (ensuredWorkoutTask && !allTasks.some((task) => asText(task.id) === asText(ensuredWorkoutTask.id))) {
      allTasks = [...allTasks, ensuredWorkoutTask];
    }

    const todayTasks = dedupeTasks(allTasks.filter((task) => rowDate(task) === date));
    const glasses = Math.min(
      waterGoalGlasses,
      ((waterRows ?? []) as LooseRow[]).reduce((total, row) => total + waterGlasses(row), 0),
    );
    const nextWater = glasses;
    const completedTodayTasks = todayTasks.filter(isTaskDone).length;
    const highPriorityTasks = todayTasks.filter((task) => asText(task.priority).toLowerCase() === 'high');
    const completedHighPriorityTasks = highPriorityTasks.filter(isTaskDone).length;
    const overdueTasks = todayTasks.filter((task) => isTaskPending(task, new Date())).length;
    const protein = todaysMeals.reduce((total, meal) => total + meal.protein, 0);
    const workoutDone = todaysWorkout.isRestDay || todayTasks.some((task) => isWorkoutTask(task) && isTaskDone(task));
    const scoreResult = calculateDailyLifeScore({
      calories,
      calorieGoal,
      protein,
      proteinGoal: macros.protein,
      waterMl: nextWater * WATER_GLASS_ML,
      waterTargetMl,
      totalTasks: todayTasks.length,
      completedTasks: completedTodayTasks,
      overdueTasks,
      highPriorityTasks: highPriorityTasks.length,
      completedHighPriorityTasks,
      isRestDay: todaysWorkout.isRestDay,
      workoutCompleted: workoutDone,
      activeSetCount: activeSession.length,
    });
    const score = scoreResult.lifeScore;
    const nextTaskProgress = `${todayTasks.filter(isTaskDone).length}/${todayTasks.length}`;
    const loadedLatestWeight = loadedBodyLogs
      .filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const loadedLatestMetrics = loadedBodyLogs.find((log) => log.waistCm || log.chestCm || log.armCm || log.hipCm || log.thighCm) ?? null;
    const loadedGenerationReady = canRecalibrateBodyPlan(profile.lastBodyRecalibrationAt) && Boolean(loadedLatestWeight);

    setTasks(todayTasks);
    setWaterCount(nextWater);
    setWaterMl(nextWater * WATER_GLASS_ML);
    setLifeScore(score);
    const { error: scoreError } = await persistDailyLifeScore(currentUserId, date, scoreResult);
    if (scoreError) console.warn('Unable to persist life score', scoreError.message);

    try {
      const insight = await getDailyBrief({
        date,
        timeOfDay: dayPeriod.greeting,
        lifeScore: score,
        caloriesRemaining,
        waterGlasses: nextWater,
        tasks: todayTasks.map((task) => ({ title: taskTitle(task), done: isTaskDone(task) })),
        meals: todaysMeals,
        workout: { activeSets: activeSession.length, split: todaysWorkout.splitName, today: todaysWorkout.name },
        bodyProgress: {
          latestWeightKg: loadedLatestWeight?.weightKg,
          latestWeightDate: loadedLatestWeight?.date,
          latestMetricsDate: loadedLatestMetrics?.date,
          twoWeekGenerationReady: loadedGenerationReady,
        },
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
    dayPeriod.greeting,
    generatedPlan,
    currentUserId,
    macros.protein,
    onboardingCompleted,
    profile,
    setLifeScore,
    setWaterMl,
    todaysMeals,
    todaysWorkout,
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

  useFocusEffect(
    useCallback(() => {
      void refreshToday();
    }, [refreshToday]),
  );

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (params.reflection === '1') setReflectionVisible(true);
  }, [params.reflection]);

  const setWaterGlasses = useCallback(async (nextCount: number) => {
    const next = Math.min(waterGoalGlasses, Math.max(0, nextCount));
    if (next === waterCount) return;

    const previous = waterCount;
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
      setWaterCount(previous);
      setWaterMl(previous * WATER_GLASS_ML);
      Alert.alert('Water not synced', 'Your glass was added locally, but Supabase did not update.');
    }
  }, [currentUserId, setWaterMl, waterCount, waterGoalGlasses, waterTargetMl]);

  const addWater = useCallback(async () => {
    await setWaterGlasses(waterCount + 1);
  }, [setWaterGlasses, waterCount]);

  const openTaskModal = useCallback(() => {
    setTaskForm({
      title: '',
      date: todayKey(),
      time: nextHourTime(),
      priority: 'medium',
      notes: '',
      notify: false,
    });
    setTaskModalVisible(true);
  }, []);

  const saveTask = useCallback(async () => {
    const title = taskForm.title.trim();
    const date = taskForm.date.trim();

    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before adding tasks.');
      return;
    }

    if (!title) {
      Alert.alert('Task title needed', 'Add a title before saving this task.');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Use YYYY-MM-DD', 'Please enter the task date like 2026-06-13.');
      return;
    }

    setSavingTask(true);
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        user_id: currentUserId,
        title,
        date,
        time_block: formatTaskTime(taskForm.time),
        priority: taskForm.priority,
        notes: taskForm.notes.trim() || null,
      })
      .select('*')
      .single();
    setSavingTask(false);

    if (error) {
      console.warn('Unable to add task', error.message);
      Alert.alert('Task not saved', error.message);
      return;
    }

    if (taskForm.notify) {
      const scheduleResult = await scheduleTaskNotification({
        taskId: asText((data as LooseRow | null)?.id),
        title,
        notes: taskForm.notes.trim() || null,
        date,
        time: taskForm.time,
      });

      if (!scheduleResult.scheduled) {
        Alert.alert('Task saved', scheduleResult.message);
      }
    }

    if (date === todayKey() && data) {
      setTasks((current) => [...current, data as LooseRow]);
    }
    setTaskModalVisible(false);
    setTaskForm({
      title: '',
      date: todayKey(),
      time: nextHourTime(),
      priority: 'medium',
      notes: '',
      notify: false,
    });
    void refreshToday();
  }, [currentUserId, refreshToday, taskForm]);

  const syncLinkedGoalProgress = useCallback(async (task: LooseRow | null) => {
    if (!currentUserId || !task) return;

    const weeklyGoalId = asText(task.weekly_goal_id);
    const monthlyGoalId = asText(task.monthly_goal_id);
    const updates: Array<PromiseLike<{ error: { message: string } | null }>> = [];

    if (weeklyGoalId) {
      const { data: goalRows, error: goalError } = await supabase
        .from('weekly_goals')
        .select('unit')
        .eq('id', weeklyGoalId)
        .limit(1);
      const weeklyUnit = asText(((goalRows ?? []) as LooseRow[])[0]?.unit).toLowerCase();

      if (goalError) {
        console.warn('Unable to check weekly goal type', goalError.message);
      } else if (!weeklyUnit.includes('session')) {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', currentUserId)
          .eq('weekly_goal_id', weeklyGoalId);

        if (error) {
          console.warn('Unable to count weekly goal tasks', error.message);
        } else {
          const completedCount = ((data ?? []) as LooseRow[]).filter(isTaskDone).length;
          updates.push(supabase.from('weekly_goals').update({ current_value: completedCount }).eq('id', weeklyGoalId));
        }
      }
    }

    if (monthlyGoalId) {
      const { data: goalRows, error: goalError } = await supabase
        .from('monthly_goals')
        .select('unit')
        .eq('id', monthlyGoalId)
        .limit(1);
      const monthlyUnit = asText(((goalRows ?? []) as LooseRow[])[0]?.unit).toLowerCase();

      if (goalError) {
        console.warn('Unable to check monthly goal type', goalError.message);
      } else if (!monthlyUnit.includes('session')) {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', currentUserId)
          .eq('monthly_goal_id', monthlyGoalId);

        if (error) {
          console.warn('Unable to count monthly goal tasks', error.message);
        } else {
          const completedCount = ((data ?? []) as LooseRow[]).filter(isTaskDone).length;
          updates.push(supabase.from('monthly_goals').update({ current_value: completedCount }).eq('id', monthlyGoalId));
        }
      }
    }

    const results = await Promise.all(updates);
    results.forEach((result) => {
      if (result.error) console.warn('Unable to sync linked goal progress', result.error.message);
    });
  }, [currentUserId]);

  const toggleTaskCompleted = useCallback(async (taskId: string, completed: boolean) => {
    if (!currentUserId) return;

    const previousTasks = tasks;
    const nextCompleted = !completed;
    const optimisticTasks = tasks.map((task) =>
      asText(task.id) === taskId ? { ...task, completed: nextCompleted } : task,
    );

    setTasks(optimisticTasks);

    const { data, error } = await supabase
      .from('tasks')
      .update({ completed: nextCompleted })
      .eq('id', taskId)
      .eq('user_id', currentUserId)
      .select('*')
      .single();
    if (error) {
      console.warn('Unable to update task', error.message);
      setTasks(previousTasks);
      Alert.alert('Task not updated', error.message);
      return;
    }

    const updatedTask = (data ?? null) as LooseRow | null;
    if (updatedTask) {
      setTasks((current) => current.map((task) => (asText(task.id) === taskId ? updatedTask : task)));
      await syncLinkedGoalProgress(updatedTask);
    }

    if (nextCompleted) {
      await cancelTaskNotification(taskId);
    }
  }, [currentUserId, syncLinkedGoalProgress, tasks]);

  const actions: ActionTile[] = [
    { label: 'AI Coach', icon: 'sparkles-outline', onPress: () => router.push('/ai-coach' as never) },
    { label: 'Log Meal', icon: 'restaurant-outline', onPress: () => router.push('/(tabs)/nutrition') },
    { label: 'Start Workout', icon: 'barbell-outline', onPress: () => router.push('/(tabs)/gym') },
    { label: 'Add Task', icon: 'add-circle-outline', onPress: openTaskModal },
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
          <Text style={styles.greeting}>{dayPeriod.greeting} 👋</Text>
          <Text style={styles.name}>{name}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open weight log"
            onPress={() => setBodyModalVisible(true)}
            style={styles.notificationButton}>
            <Ionicons name="scale-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
            onPress={() => router.push('/notifications' as never)}
            style={styles.notificationButton}>
            <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            {unreadNotifications > 0 ? (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <Text style={styles.date}>{formatHeaderDate()}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            onPress={() => router.push('/profile' as never)}
            style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </TouchableOpacity>
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
        <TouchableOpacity accessibilityRole="button" onPress={openTaskModal} hitSlop={8}>
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
            completed={item.completed}
            onToggleComplete={
              item.kind === 'task' ? () => void toggleTaskCompleted(item.id, item.completed === true) : undefined
            }
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
              <TouchableOpacity
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`Set hydration to ${index + 1} glasses`}
                onPress={() => void setWaterGlasses(index + 1)}
                style={styles.dropletButton}>
                <Ionicons
                  name={filled ? 'water' : 'water-outline'}
                  size={24}
                  color={filled ? colors.emerald : colors.textMuted}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </LifeOSCard>

      <LifeOSCard accentColor={colors.violet} style={styles.briefCard}>
        <View style={styles.briefHeader}>
          <Ionicons name="sparkles" size={20} color={colors.violetLight} />
          <Text style={styles.cardTitle}>{dayPeriod.briefTitle}</Text>
        </View>
        <Text numberOfLines={2} style={styles.briefText}>
          {brief}
        </Text>
        <Text style={styles.weightBriefText}>{bodyBriefLine}</Text>
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

    <Modal visible={taskModalVisible} animationType="slide" transparent onRequestClose={() => setTaskModalVisible(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add task</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => setTaskModalVisible(false)}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
            <TextInput
              value={taskForm.title}
              onChangeText={(title) => setTaskForm((current) => ({ ...current, title }))}
              placeholder="Task title"
              placeholderTextColor={colors.textMuted}
              style={styles.taskInput}
            />

            <TextInput
              value={taskForm.date}
              onChangeText={(date) => setTaskForm((current) => ({ ...current, date }))}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              style={styles.taskInput}
            />

            <View style={styles.timePicker}>
              <Text style={styles.fieldLabel}>Time</Text>
              <View style={styles.timePickerRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setTaskForm((current) => ({ ...current, time: adjustTaskTime(current.time, -60) }))}
                  style={styles.timeButton}>
                  <Ionicons name="remove" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.timeValue}>{formatTaskTime(taskForm.time)}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setTaskForm((current) => ({ ...current, time: adjustTaskTime(current.time, 60) }))}
                  style={styles.timeButton}>
                  <Ionicons name="add" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
              <View style={styles.timePickerRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setTaskForm((current) => ({ ...current, time: adjustTaskTime(current.time, -15) }))}
                  style={styles.minuteButton}>
                  <Text style={styles.minuteButtonText}>-15 min</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setTaskForm((current) => ({ ...current, time: toggleMeridiem(current.time) }))}
                  style={styles.minuteButton}>
                  <Text style={styles.minuteButtonText}>
                    {taskForm.time.split(':')[0] && Number(taskForm.time.split(':')[0]) >= 12 ? 'PM' : 'AM'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setTaskForm((current) => ({ ...current, time: adjustTaskTime(current.time, 15) }))}
                  style={styles.minuteButton}>
                  <Text style={styles.minuteButtonText}>+15 min</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.priorityRow}>
              {priorityOptions.map((priority) => {
                const selected = taskForm.priority === priority;
                return (
                  <TouchableOpacity
                    key={priority}
                    accessibilityRole="button"
                    onPress={() => setTaskForm((current) => ({ ...current, priority }))}
                    style={[styles.priorityChip, selected && styles.priorityChipSelected]}>
                    <Text style={[styles.priorityText, selected && styles.priorityTextSelected]}>{priority}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              value={taskForm.notes}
              onChangeText={(notes) => setTaskForm((current) => ({ ...current, notes }))}
              multiline
              placeholder="Notes"
              placeholderTextColor={colors.textMuted}
              style={[styles.taskInput, styles.taskNotesInput]}
            />

            <View style={styles.notifyRow}>
              <View style={styles.notifyCopy}>
                <Text style={styles.notifyTitle}>Notify me</Text>
                <Text style={styles.notifyDetail}>Send a reminder when this task time arrives.</Text>
              </View>
              <Switch
                value={taskForm.notify}
                onValueChange={(notify) => setTaskForm((current) => ({ ...current, notify }))}
                thumbColor={taskForm.notify ? colors.violetLight : colors.textMuted}
                trackColor={{ false: colors.surface2, true: colors.violetBg }}
              />
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              disabled={savingTask}
              onPress={saveTask}
              style={[styles.saveReflectionButton, savingTask && styles.disabledButton]}>
              <Text style={styles.saveReflectionText}>{savingTask ? 'Saving...' : 'Save task'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <BodyProgressModal visible={bodyModalVisible} onClose={() => setBodyModalVisible(false)} onChanged={refreshToday} />
    </>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
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
  notificationButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    position: 'relative',
    width: 36,
  },
  notificationBadge: {
    alignItems: 'center',
    backgroundColor: colors.rose,
    borderColor: colors.background,
    borderRadius: 9,
    borderWidth: 1,
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -4,
    top: -5,
  },
  notificationBadgeText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
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
    minWidth: 0,
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
  dropletButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 32,
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
  weightBriefText: {
    color: colors.emeraldLight,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: spacing.xs,
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
    maxHeight: '90%',
    padding: spacing.md,
  },
  modalScroll: {
    marginHorizontal: -spacing.xs,
    paddingHorizontal: spacing.xs,
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
  taskInput: {
    ...typography.body,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
  },
  fieldLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'none',
  },
  timePicker: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    marginBottom: spacing.xs,
    padding: spacing.sm,
  },
  timePickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  timeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface3,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 44,
  },
  timeValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  minuteButton: {
    alignItems: 'center',
    backgroundColor: colors.surface3,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    marginTop: spacing.xs,
    paddingVertical: 10,
  },
  minuteButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  priorityChip: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.xs,
  },
  priorityChipSelected: {
    backgroundColor: colors.violetBg,
    borderColor: colors.violetLight,
  },
  priorityText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  priorityTextSelected: {
    color: colors.violetLight,
  },
  taskNotesInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  notifyRow: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  notifyCopy: {
    flex: 1,
  },
  notifyTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  notifyDetail: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginTop: 2,
    textTransform: 'none',
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
  disabledButton: {
    opacity: 0.6,
  },
  });
}
