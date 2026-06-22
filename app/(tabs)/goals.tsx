import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressRing } from '@/components/ui/ProgressRing';
import { colors as defaultColors, radii, shadows, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { hapticLight } from '@/lib/haptics';
import { scheduleTaskNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { buildWorkoutTemplates, type PlannedWorkoutTemplate } from '@/lib/workoutPlan';
import { useUserStore, type GeneratedPlan, type UserProfile } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type GoalsTab = 'week' | 'month';
type GoalFormType = 'monthly' | 'weekly' | 'daily';
type GoalFormError = { field: 'title' | 'target' | 'unit' | 'general'; message: string };
type LooseRow = Record<string, Json | undefined>;

type GoalCategory = {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
};

type MonthlyGoal = {
  id: string;
  categoryId: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  monthStart: string;
  status: string;
};

type WeeklyGoal = {
  id: string;
  categoryId: string;
  monthlyGoalId: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  weekStart: string;
};

type DailyGoal = {
  id: string;
  categoryId: string;
  monthlyGoalId: string;
  weeklyGoalId: string;
  title: string;
  date: string;
  time: string;
  priority: string;
  notes: string;
  completed: boolean;
};

type GoalDraft = {
  type: GoalFormType;
  title: string;
  target: string;
  unit: string;
  categoryId: string;
  newCategoryName: string;
  parentMonthlyGoalId: string;
  parentWeeklyGoalId: string;
  date: string;
  time: string;
  priority: string;
  notes: string;
  notify: boolean;
  editTaskId: string;
};

const TABS: { id: GoalsTab; label: string }[] = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
];

const DEFAULT_CATEGORIES = [
  { name: 'Learning', color: defaultColors.indigo, icon: 'book-outline' },
  { name: 'Work', color: defaultColors.blue, icon: 'briefcase-outline' },
  { name: 'Health', color: defaultColors.emerald, icon: 'fitness-outline' },
];

const GYM_CATEGORY = { name: 'Gym', color: defaultColors.amber, icon: 'barbell-outline' };
const GYM_MONTHLY_TITLE = 'Gym sessions';
const GYM_WEEKLY_TITLE = 'Gym sessions this week';

const priorityOptions = ['low', 'medium', 'high'];

const UNIT_SUGGESTIONS: Record<string, string[]> = {
  learning: ['lessons', 'pages', 'hours'],
  work: ['tasks', 'projects', 'hours'],
  health: ['days', 'habits', 'workouts'],
  gym: ['sessions', 'workouts', 'days'],
};

function unitSuggestions(categoryName: string) {
  return UNIT_SUGGESTIONS[categoryName.trim().toLowerCase()] ?? ['times', 'tasks', 'hours'];
}

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function rowId(row: LooseRow, fallback: string) {
  const id = row.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : fallback;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function todayKey() {
  return dateKey(new Date());
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function nextHourTime() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return `${`${date.getHours()}`.padStart(2, '0')}:00`;
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

function parseTaskTime(value: string) {
  const trimmed = value.trim();
  const displayMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (displayMatch) {
    let hour = Number(displayMatch[1]);
    const minute = Number(displayMatch[2]);
    const suffix = displayMatch[3].toUpperCase();
    if (suffix === 'PM' && hour < 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
  }

  const storageMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (storageMatch) {
    return `${storageMatch[1].padStart(2, '0')}:${storageMatch[2]}`;
  }

  return nextHourTime();
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

function monthStartKey(date = new Date()) {
  return dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndKey(date = new Date()) {
  return dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function weekStartDate(offset = 0, base = new Date()) {
  const date = new Date(base);
  const isoDay = date.getDay() || 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - isoDay + 1 + offset * 7);
  return date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function weekRange(offset: number) {
  const monday = weekStartDate(offset);
  const sunday = addDays(monday, 6);
  const fmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  return `${fmt.format(monday)} - ${fmt.format(sunday)}`;
}

function currentWeekNumber(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Number(date) - Number(start) + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

function weekNumberFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return currentWeekNumber();
  return currentWeekNumber(new Date(year, month - 1, day));
}

function percentage(current: number, target: number) {
  return target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
}

function categoryFromRow(row: LooseRow, index: number): GoalCategory {
  const fallback = DEFAULT_CATEGORIES[index % DEFAULT_CATEGORIES.length];
  return {
    id: rowId(row, `category-${index}`),
    name: asText(row.name, fallback.name),
    color: asText(row.color, fallback.color),
    icon: asText(row.icon, fallback.icon),
    sortOrder: asNumber(row.sort_order, index),
  };
}

function monthlyFromRow(row: LooseRow, index: number): MonthlyGoal {
  return {
    id: rowId(row, `monthly-${index}`),
    categoryId: asText(row.category_id),
    title: asText(row.title, 'Monthly goal'),
    targetValue: asNumber(row.target_value, 1),
    currentValue: asNumber(row.current_value, asNumber(row.progress, 0)),
    unit: asText(row.unit, 'tasks'),
    monthStart: asText(row.month_start).slice(0, 10) || monthStartKey(),
    status: asText(row.status, 'active'),
  };
}

function weeklyFromRow(row: LooseRow, index: number): WeeklyGoal {
  return {
    id: rowId(row, `weekly-${index}`),
    categoryId: asText(row.category_id),
    monthlyGoalId: asText(row.monthly_goal_id, asText(row.linked_monthly_goal_id)),
    title: asText(row.title, 'Weekly goal'),
    targetValue: asNumber(row.target_value, asNumber(row.target, 1)),
    currentValue: asNumber(row.current_value, asNumber(row.progress_current, asNumber(row.completed, 0))),
    unit: asText(row.unit, 'tasks'),
    weekStart: asText(row.week_start).slice(0, 10) || dateKey(weekStartDate()),
  };
}

function dailyFromRow(row: LooseRow, index: number): DailyGoal {
  const status = asText(row.status).toLowerCase();
  return {
    id: rowId(row, `daily-${index}`),
    categoryId: asText(row.category_id),
    monthlyGoalId: asText(row.monthly_goal_id),
    weeklyGoalId: asText(row.weekly_goal_id),
    title: asText(row.title, 'Daily task'),
    date: asText(row.date).slice(0, 10) || todayKey(),
    time: asText(row.time_block, asText(row.time)),
    priority: asText(row.priority, 'medium'),
    notes: asText(row.notes),
    completed: row.completed === true || row.done === true || status === 'done' || status === 'completed',
  };
}

function iconName(icon: string) {
  return (icon || 'flag-outline') as keyof typeof Ionicons.glyphMap;
}

async function ensureDefaultCategories(userId: string) {
  const { data, error } = await supabase
    .from('goal_categories')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);

  const existing = ((data ?? []) as LooseRow[]).map(categoryFromRow);
  const existingNames = new Set(existing.map((category) => category.name.trim().toLowerCase()));
  const missing = DEFAULT_CATEGORIES
    .filter((category) => !existingNames.has(category.name.toLowerCase()))
    .map((category, index) => ({
      user_id: userId,
      name: category.name,
      color: category.color,
      icon: category.icon,
      sort_order: existing.length + index,
    }));

  if (missing.length > 0) {
    const insertResults = await Promise.all(missing.map((category) => supabase.from('goal_categories').insert(category)));
    const insertError = insertResults.find((result) => result.error && !isDuplicateKeyError(result.error))?.error;
    if (insertError) throw new Error(insertError.message);
  }

  const { data: refreshed, error: refreshError } = await supabase
    .from('goal_categories')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  if (refreshError) throw new Error(refreshError.message);
  return ((refreshed ?? []) as LooseRow[]).map(categoryFromRow);
}

function rangeDateKeys(startKey: string, endKey: string) {
  const dates: string[] = [];
  const cursor = dateFromKey(startKey);
  const end = dateFromKey(endKey);

  while (cursor <= end) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function plannedWorkoutCount(
  generatedPlan: GeneratedPlan | null | undefined,
  profile: UserProfile | null | undefined,
  startKey: string,
  endKey: string,
) {
  const templates = buildWorkoutTemplates(generatedPlan, profile);
  const count = rangeDateKeys(startKey, endKey).filter((key) => {
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const index = (date.getDay() + 6) % 7;
    const template = templates[index];
    return template && !template.isRestDay && template.exercises.length > 0;
  }).length;

  return Math.max(1, count || Math.round(profile?.gymDaysPerWeek ?? 0) || 1);
}

async function completedWorkoutDates(userId: string, startKey: string, endKey: string) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('date')
    .eq('user_id', userId)
    .gte('date', startKey)
    .lte('date', endKey);

  if (error) {
    console.warn('Unable to count workout sessions', error.message);
    return new Set<string>();
  }

  return new Set(((data ?? []) as LooseRow[]).map((row) => asText(row.date).slice(0, 10)).filter(Boolean));
}

async function completedWorkoutCount(userId: string, startKey: string, endKey: string) {
  return (await completedWorkoutDates(userId, startKey, endKey)).size;
}

async function completedFitnessTaskCount(userId: string, startKey: string, endKey: string, weeklyGoalId?: string) {
  let query = supabase
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('category', 'fitness')
    .eq('completed', true)
    .gte('date', startKey)
    .lte('date', endKey);

  if (weeklyGoalId) {
    query = query.eq('weekly_goal_id', weeklyGoalId);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('Unable to count completed gym tasks', error.message);
    return 0;
  }

  return (data ?? []).length;
}

function workoutTaskTitle(workout: PlannedWorkoutTemplate) {
  return `Workout: ${workout.name}`;
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null) {
  return error?.code === '23505' || error?.message?.toLowerCase().includes('duplicate key');
}

function plannedWorkoutTasks(
  generatedPlan: GeneratedPlan | null | undefined,
  profile: UserProfile | null | undefined,
  startKey: string,
  endKey: string,
) {
  const templates = buildWorkoutTemplates(generatedPlan, profile);
  return rangeDateKeys(startKey, endKey)
    .map((date) => {
      const day = dateFromKey(date);
      const template = templates[(day.getDay() + 6) % 7];
      return { date, template };
    })
    .filter(({ template }) => template && !template.isRestDay && template.exercises.length > 0);
}

async function ensurePlannedWorkoutTasks(args: {
  userId: string;
  categoryId: string;
  monthlyGoalId: string;
  weeklyGoalId: string;
  generatedPlan: GeneratedPlan | null;
  profile: UserProfile | null;
  weekStart: string;
  weekEnd: string;
}) {
  const plannedTasks = plannedWorkoutTasks(args.generatedPlan, args.profile, args.weekStart, args.weekEnd);
  if (plannedTasks.length === 0) return;

  const [existingResult, completedDates] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('user_id', args.userId)
      .eq('category', 'fitness')
      .gte('date', args.weekStart)
      .lte('date', args.weekEnd),
    completedWorkoutDates(args.userId, args.weekStart, args.weekEnd),
  ]);

  if (existingResult.error) {
    console.warn('Unable to read planned workout tasks', existingResult.error.message);
    return;
  }

  const existingRows = (existingResult.data ?? []) as LooseRow[];
  const inserts: Array<Record<string, Json | undefined>> = [];
  const updates: Array<PromiseLike<{ error: { message: string } | null }>> = [];

  plannedTasks.forEach(({ date, template }) => {
    const title = workoutTaskTitle(template);
    const existing = existingRows.find(
      (row) => asText(row.date).slice(0, 10) === date && asText(row.title).toLowerCase() === title.toLowerCase(),
    );
    const completedFromWorkout = completedDates.has(date);

    if (existing) {
      const payload: Record<string, Json | undefined> = {
        category_id: args.categoryId,
        monthly_goal_id: args.monthlyGoalId,
        weekly_goal_id: args.weeklyGoalId,
      };
      if (completedFromWorkout && existing.completed !== true) payload.completed = true;

      updates.push(
        supabase
          .from('tasks')
          .update(payload)
          .eq('id', rowId(existing, ''))
          .eq('user_id', args.userId),
      );
      return;
    }

    inserts.push({
      user_id: args.userId,
      title,
      date,
      time_block: '6:30 PM',
      completed: completedFromWorkout,
      priority: 'medium',
      category: 'fitness',
      category_id: args.categoryId,
      monthly_goal_id: args.monthlyGoalId,
      weekly_goal_id: args.weeklyGoalId,
      notes: `Profile split: ${template.splitName}`,
    });
  });

  const results = await Promise.all(updates);
  results.forEach((result) => {
    const error = 'error' in result ? result.error : null;
    if (error) console.warn('Unable to link planned workout task', error.message);
  });

  if (inserts.length > 0) {
    const results = await Promise.all(inserts.map((insert) => supabase.from('tasks').insert(insert)));
    results.forEach((result) => {
      if (result.error && !isDuplicateKeyError(result.error)) {
        console.warn('Unable to create planned workout task', result.error.message);
      }
    });
  }
}

async function ensureGymCategory(userId: string, categories: GoalCategory[]) {
  const existing = categories.find((category) => category.name.trim().toLowerCase() === GYM_CATEGORY.name.toLowerCase());
  if (existing) return { category: existing, categories };

  const { data, error } = await supabase
    .from('goal_categories')
    .insert({
      user_id: userId,
      name: GYM_CATEGORY.name,
      color: GYM_CATEGORY.color,
      icon: GYM_CATEGORY.icon,
      sort_order: categories.length,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  const category = categoryFromRow(data as LooseRow, categories.length);
  return {
    category,
    categories: [...categories, category].sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

async function ensureGymGoalFlow(args: {
  userId: string;
  profile: UserProfile | null;
  generatedPlan: GeneratedPlan | null;
  categories: GoalCategory[];
  weekStart: string;
}) {
  const gymDays = Math.round(args.profile?.gymDaysPerWeek ?? 0);
  if (gymDays <= 0) return args.categories;

  const { category, categories } = await ensureGymCategory(args.userId, args.categories);
  const monthStart = monthStartKey();
  const monthEnd = monthEndKey();
  const weekEnd = dateKey(addDays(dateFromKey(args.weekStart), 6));
  const monthlyTarget = plannedWorkoutCount(args.generatedPlan, args.profile, monthStart, monthEnd);
  const weeklyTarget = plannedWorkoutCount(args.generatedPlan, args.profile, args.weekStart, weekEnd);
  const [monthlyWorkoutCompleted, weeklyWorkoutCompleted] = await Promise.all([
    completedWorkoutCount(args.userId, monthStart, monthEnd),
    completedWorkoutCount(args.userId, args.weekStart, weekEnd),
  ]);

  const { data: monthlyRows, error: monthlyReadError } = await supabase
    .from('monthly_goals')
    .select('*')
    .eq('user_id', args.userId)
    .eq('category_id', category.id)
    .eq('month_start', monthStart)
    .eq('title', GYM_MONTHLY_TITLE)
    .limit(1);

  if (monthlyReadError) throw new Error(monthlyReadError.message);

  let monthlyGoal = ((monthlyRows ?? []) as LooseRow[])[0];
  const monthlyPayload = {
    user_id: args.userId,
    category_id: category.id,
    category: category.name,
    title: GYM_MONTHLY_TITLE,
    target_value: monthlyTarget,
    current_value: monthlyWorkoutCompleted,
    unit: 'sessions',
    month_start: monthStart,
    status: 'active',
  };

  if (monthlyGoal) {
    const { error } = await supabase.from('monthly_goals').update(monthlyPayload).eq('id', rowId(monthlyGoal, ''));
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from('monthly_goals').insert(monthlyPayload).select('*').single();
    if (error) throw new Error(error.message);
    monthlyGoal = data as LooseRow;
  }

  const monthlyGoalId = rowId(monthlyGoal, '');
  if (!monthlyGoalId) return categories;

  const { data: weeklyRows, error: weeklyReadError } = await supabase
    .from('weekly_goals')
    .select('*')
    .eq('user_id', args.userId)
    .eq('category_id', category.id)
    .eq('week_start', args.weekStart)
    .eq('title', GYM_WEEKLY_TITLE)
    .limit(1);

  if (weeklyReadError) throw new Error(weeklyReadError.message);

  let weeklyGoal = ((weeklyRows ?? []) as LooseRow[])[0];
  const weeklyPayload = {
    user_id: args.userId,
    category_id: category.id,
    category: category.name,
    monthly_goal_id: monthlyGoalId,
    linked_monthly_goal_id: monthlyGoalId,
    title: GYM_WEEKLY_TITLE,
    target_value: weeklyTarget,
    current_value: weeklyWorkoutCompleted,
    unit: 'sessions',
    week_start: args.weekStart,
    week_number: weekNumberFromKey(args.weekStart),
  };

  if (weeklyGoal) {
    const { error } = await supabase.from('weekly_goals').update(weeklyPayload).eq('id', rowId(weeklyGoal, ''));
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from('weekly_goals').insert(weeklyPayload).select('*').single();
    if (error) throw new Error(error.message);
    weeklyGoal = data as LooseRow;
  }

  const weeklyGoalId = rowId(weeklyGoal, '');
  if (weeklyGoalId) {
    await ensurePlannedWorkoutTasks({
      userId: args.userId,
      categoryId: category.id,
      monthlyGoalId,
      weeklyGoalId,
      generatedPlan: args.generatedPlan,
      profile: args.profile,
      weekStart: args.weekStart,
      weekEnd,
    });

    const [monthlyTaskCompleted, weeklyTaskCompleted] = await Promise.all([
      completedFitnessTaskCount(args.userId, monthStart, monthEnd),
      completedFitnessTaskCount(args.userId, args.weekStart, weekEnd, weeklyGoalId),
    ]);
    const monthlyCompleted = Math.max(monthlyWorkoutCompleted, monthlyTaskCompleted);
    const weeklyCompleted = Math.max(weeklyWorkoutCompleted, weeklyTaskCompleted);

    const [monthlyUpdate, weeklyUpdate] = await Promise.all([
      supabase.from('monthly_goals').update({ current_value: monthlyCompleted }).eq('id', monthlyGoalId),
      supabase.from('weekly_goals').update({ current_value: weeklyCompleted }).eq('id', weeklyGoalId),
    ]);

    if (monthlyUpdate.error) console.warn('Unable to sync gym monthly progress', monthlyUpdate.error.message);
    if (weeklyUpdate.error) console.warn('Unable to sync gym weekly progress', weeklyUpdate.error.message);
  }

  return categories;
}

export default function GoalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const profile = useUserStore((state) => state.profile);
  const generatedPlan = useUserStore((state) => state.generatedPlan);
  const [activeTab, setActiveTab] = useState<GoalsTab>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [categories, setCategories] = useState<GoalCategory[]>([]);
  const [monthlyGoals, setMonthlyGoals] = useState<MonthlyGoal[]>([]);
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>([]);
  const [dailyGoals, setDailyGoals] = useState<DailyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState<GoalFormError | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [draft, setDraft] = useState<GoalDraft>({
    type: 'monthly',
    title: '',
    target: '1',
    unit: 'tasks',
    categoryId: '',
    newCategoryName: '',
    parentMonthlyGoalId: '',
    parentWeeklyGoalId: '',
    date: todayKey(),
    time: nextHourTime(),
    priority: 'medium',
    notes: '',
    notify: false,
    editTaskId: '',
  });

  const categoryById = useMemo(() => {
    const map = new Map<string, GoalCategory>();
    categories.forEach((category) => map.set(category.id, category));
    return map;
  }, [categories]);

  const loadGoals = useCallback(async () => {
    if (!currentUserId) {
      setCategories([]);
      setMonthlyGoals([]);
      setWeeklyGoals([]);
      setDailyGoals([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const baseCategories = await ensureDefaultCategories(currentUserId);
      const weekStart = dateKey(weekStartDate(weekOffset));
      const nextCategories = await ensureGymGoalFlow({
        userId: currentUserId,
        profile,
        generatedPlan,
        categories: baseCategories,
        weekStart,
      });
      const [monthlyResult, weeklyResult, dailyResult] = await Promise.all([
        supabase.from('monthly_goals').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false }),
        supabase.from('weekly_goals').select('*').eq('user_id', currentUserId).order('week_start', { ascending: false }),
        supabase.from('tasks').select('*').eq('user_id', currentUserId).order('date', { ascending: true }).limit(300),
      ]);

      if (monthlyResult.error) throw new Error(monthlyResult.error.message);
      if (weeklyResult.error) throw new Error(weeklyResult.error.message);
      if (dailyResult.error) throw new Error(dailyResult.error.message);

      setCategories(nextCategories.sort((a, b) => a.sortOrder - b.sortOrder));
      setMonthlyGoals(((monthlyResult.data ?? []) as LooseRow[]).map(monthlyFromRow));
      setWeeklyGoals(((weeklyResult.data ?? []) as LooseRow[]).map(weeklyFromRow));
      setDailyGoals(
        ((dailyResult.data ?? []) as LooseRow[])
          .map(dailyFromRow)
          .filter((task) => task.weeklyGoalId || task.monthlyGoalId || task.categoryId),
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unable to load goals.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, generatedPlan, profile, weekOffset]);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  useFocusEffect(
    useCallback(() => {
      void loadGoals();
    }, [loadGoals]),
  );

  const currentWeekStart = dateKey(weekStartDate(weekOffset));
  const currentMonthStart = monthStartKey();
  const visibleWeeklyGoals = useMemo(
    () => weeklyGoals.filter((goal) => goal.weekStart === currentWeekStart),
    [currentWeekStart, weeklyGoals],
  );
  const visibleMonthlyGoals = useMemo(
    () => monthlyGoals.filter((goal) => goal.monthStart === currentMonthStart),
    [currentMonthStart, monthlyGoals],
  );

  const tasksByWeeklyGoal = useMemo(() => {
    const map = new Map<string, DailyGoal[]>();
    dailyGoals.forEach((task) => {
      if (!task.weeklyGoalId) return;
      map.set(task.weeklyGoalId, [...(map.get(task.weeklyGoalId) ?? []), task]);
    });
    return map;
  }, [dailyGoals]);

  const tasksByMonthlyGoal = useMemo(() => {
    const map = new Map<string, DailyGoal[]>();
    dailyGoals.forEach((task) => {
      if (!task.monthlyGoalId) return;
      map.set(task.monthlyGoalId, [...(map.get(task.monthlyGoalId) ?? []), task]);
    });
    return map;
  }, [dailyGoals]);

  const weeklyProgress = useCallback(
    (goal: WeeklyGoal) => {
      if (goal.unit.toLowerCase().includes('session')) return percentage(goal.currentValue, goal.targetValue);
      const tasks = tasksByWeeklyGoal.get(goal.id) ?? [];
      if (tasks.length > 0) return percentage(tasks.filter((task) => task.completed).length, tasks.length);
      return percentage(goal.currentValue, goal.targetValue);
    },
    [tasksByWeeklyGoal],
  );

  const monthlyProgress = useCallback(
    (goal: MonthlyGoal) => {
      if (goal.unit.toLowerCase().includes('session')) return percentage(goal.currentValue, goal.targetValue);
      const tasks = tasksByMonthlyGoal.get(goal.id) ?? [];
      if (tasks.length > 0) return percentage(tasks.filter((task) => task.completed).length, tasks.length);

      const linkedWeekly = weeklyGoals.filter((weekly) => weekly.monthlyGoalId === goal.id);
      if (linkedWeekly.length > 0) {
        return Math.round(linkedWeekly.reduce((total, weekly) => total + weeklyProgress(weekly), 0) / linkedWeekly.length);
      }

      return percentage(goal.currentValue, goal.targetValue);
    },
    [tasksByMonthlyGoal, weeklyGoals, weeklyProgress],
  );

  const weekOverallProgress = useMemo(() => {
    if (visibleWeeklyGoals.length === 0) return 0;
    return Math.round(visibleWeeklyGoals.reduce((total, goal) => total + weeklyProgress(goal), 0) / visibleWeeklyGoals.length);
  }, [visibleWeeklyGoals, weeklyProgress]);

  const monthOverallProgress = useMemo(() => {
    if (visibleMonthlyGoals.length === 0) return 0;
    return Math.round(visibleMonthlyGoals.reduce((total, goal) => total + monthlyProgress(goal), 0) / visibleMonthlyGoals.length);
  }, [monthlyProgress, visibleMonthlyGoals]);

  const weekTaskDates = useMemo(() => {
    const start = weekStartDate(weekOffset);
    return Array.from({ length: 7 }, (_, index) => dateKey(addDays(start, index)));
  }, [weekOffset]);

  const openAddGoal = useCallback(
    (type: GoalFormType, options?: { monthlyGoal?: MonthlyGoal; weeklyGoal?: WeeklyGoal }) => {
      const monthlyGoal = options?.monthlyGoal;
      const weeklyGoal = options?.weeklyGoal;
      const categoryId = weeklyGoal?.categoryId || monthlyGoal?.categoryId || categories[0]?.id || '';

      setDraft({
        type,
        title: type === 'weekly' && monthlyGoal ? `Weekly step: ${monthlyGoal.title}` : '',
        target: '',
        unit: '',
        categoryId,
        newCategoryName: '',
        parentMonthlyGoalId: monthlyGoal?.id || weeklyGoal?.monthlyGoalId || '',
        parentWeeklyGoalId: weeklyGoal?.id || '',
        date: todayKey(),
        time: nextHourTime(),
        priority: 'medium',
        notes: '',
        notify: false,
        editTaskId: '',
      });
      setFormError(null);
      setAddVisible(true);
    },
    [categories],
  );

  const openEditDailyTask = useCallback(
    (task: DailyGoal) => {
      const weeklyGoal = weeklyGoals.find((goal) => goal.id === task.weeklyGoalId);
      const monthlyGoal = monthlyGoals.find((goal) => goal.id === task.monthlyGoalId || goal.id === weeklyGoal?.monthlyGoalId);

      setDraft({
        type: 'daily',
        title: task.title,
        target: '',
        unit: '',
        categoryId: task.categoryId || weeklyGoal?.categoryId || monthlyGoal?.categoryId || categories[0]?.id || '',
        newCategoryName: '',
        parentMonthlyGoalId: task.monthlyGoalId || weeklyGoal?.monthlyGoalId || '',
        parentWeeklyGoalId: task.weeklyGoalId,
        date: task.date || todayKey(),
        time: parseTaskTime(task.time),
        priority: task.priority || 'medium',
        notes: task.notes || '',
        notify: false,
        editTaskId: task.id,
      });
      setFormError(null);
      setAddVisible(true);
    },
    [categories, monthlyGoals, weeklyGoals],
  );

  const resolveCategoryId = useCallback(async () => {
    const name = draft.newCategoryName.trim();
    if (!currentUserId) return '';
    if (!name) return draft.categoryId || categories[0]?.id || '';

    const existing = categories.find((category) => category.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;

    const fallback = DEFAULT_CATEGORIES[categories.length % DEFAULT_CATEGORIES.length];
    const { data, error: insertError } = await supabase
      .from('goal_categories')
      .insert({
        user_id: currentUserId,
        name,
        color: fallback.color,
        icon: fallback.icon,
        sort_order: categories.length,
      })
      .select('*')
      .single();

    if (insertError) throw new Error(insertError.message);
    const category = categoryFromRow(data as LooseRow, categories.length);
    setCategories((items) => [...items, category].sort((a, b) => a.sortOrder - b.sortOrder));
    return category.id;
  }, [categories, currentUserId, draft.categoryId, draft.newCategoryName]);

  const syncLinkedGoalProgress = useCallback(async (rows: DailyGoal[], weeklyGoalId: string, monthlyGoalId: string) => {
    const updates: Array<PromiseLike<{ error: { message: string } | null }>> = [];

    if (weeklyGoalId) {
      const weeklyTasks = rows.filter((task) => task.weeklyGoalId === weeklyGoalId);
      const completed = weeklyTasks.filter((task) => task.completed).length;
      updates.push(supabase.from('weekly_goals').update({ current_value: completed }).eq('id', weeklyGoalId));
      setWeeklyGoals((items) => items.map((goal) => (goal.id === weeklyGoalId ? { ...goal, currentValue: completed } : goal)));
    }

    if (monthlyGoalId) {
      const monthlyTasks = rows.filter((task) => task.monthlyGoalId === monthlyGoalId);
      const completed = monthlyTasks.filter((task) => task.completed).length;
      updates.push(supabase.from('monthly_goals').update({ current_value: completed }).eq('id', monthlyGoalId));
      setMonthlyGoals((items) => items.map((goal) => (goal.id === monthlyGoalId ? { ...goal, currentValue: completed } : goal)));
    }

    const results = await Promise.all(updates);
    results.forEach((result) => {
      const error = 'error' in result ? result.error : null;
      if (error) console.warn('Unable to sync goal progress', error.message);
    });
  }, []);

  const saveGoal = useCallback(async () => {
    const title = draft.title.trim();
    setFormError(null);
    if (!currentUserId) {
      setFormError({ field: 'general', message: 'Please log in before adding a goal.' });
      return;
    }
    if (!title) {
      setFormError({ field: 'title', message: 'Add a name for this goal, such as “Finish Phase 2”.' });
      return;
    }

    const parsedTarget = Number(draft.target);
    if (draft.type !== 'daily' && (!Number.isFinite(parsedTarget) || parsedTarget <= 0)) {
      setFormError({ field: 'target', message: 'Enter a total greater than 0, such as 3.' });
      return;
    }
    if (draft.type !== 'daily' && !draft.unit.trim()) {
      setFormError({ field: 'unit', message: 'Add what you are counting, such as phases, lessons, or hours.' });
      return;
    }

    setSaving(true);
    try {
      const selectedWeekly = weeklyGoals.find((goal) => goal.id === draft.parentWeeklyGoalId);
      const selectedMonthly = monthlyGoals.find((goal) => goal.id === draft.parentMonthlyGoalId);
      if (draft.type === 'daily' && !selectedWeekly) {
        throw new Error('Choose a weekly goal before adding a daily goal task.');
      }
      const categoryId = selectedWeekly?.categoryId || selectedMonthly?.categoryId || (await resolveCategoryId());
      const categoryName = categoryById.get(categoryId)?.name || null;
      const targetValue = parsedTarget;
      const unit = draft.unit.trim();
      const isSessionGoal =
        selectedWeekly?.unit.toLowerCase().includes('session') ||
        selectedMonthly?.unit.toLowerCase().includes('session') ||
        categoryName?.toLowerCase() === 'gym';

      if (draft.type === 'monthly') {
        const { error: insertError } = await supabase.from('monthly_goals').insert({
          user_id: currentUserId,
          category_id: categoryId || null,
          category: categoryName,
          title,
          target_value: targetValue,
          current_value: 0,
          unit,
          month_start: currentMonthStart,
          status: 'active',
        });
        if (insertError) throw new Error(insertError.message);
      }

      if (draft.type === 'weekly') {
        const parentMonthlyGoalId = selectedMonthly?.id || null;
        const { error: insertError } = await supabase.from('weekly_goals').insert({
          user_id: currentUserId,
          category_id: categoryId || null,
          category: categoryName,
          monthly_goal_id: parentMonthlyGoalId,
          linked_monthly_goal_id: parentMonthlyGoalId,
          title,
          target_value: targetValue,
          current_value: 0,
          unit,
          week_start: currentWeekStart,
          week_number: weekNumberFromKey(currentWeekStart),
        });
        if (insertError) throw new Error(insertError.message);
      }

      if (draft.type === 'daily') {
        const date = draft.date.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error('Use task date as YYYY-MM-DD.');
        }

        const taskPayload = {
          user_id: currentUserId,
          title,
          date,
          time_block: formatTaskTime(draft.time),
          priority: draft.priority,
          notes: draft.notes.trim() || null,
          category: isSessionGoal ? 'fitness' : 'goals',
          category_id: categoryId || null,
          weekly_goal_id: selectedWeekly?.id || null,
          monthly_goal_id: selectedWeekly?.monthlyGoalId || selectedMonthly?.id || null,
        };

        const { data, error: taskError } = draft.editTaskId
          ? await supabase
              .from('tasks')
              .update(taskPayload)
              .eq('id', draft.editTaskId)
              .eq('user_id', currentUserId)
              .select('*')
              .single()
          : await supabase
              .from('tasks')
              .insert({
                ...taskPayload,
                completed: false,
              })
              .select('*')
              .single();
        if (taskError) throw new Error(taskError.message);

        if (draft.notify) {
          const scheduled = await scheduleTaskNotification({
            taskId: asText((data as LooseRow | null)?.id),
            title,
            notes: draft.notes.trim() || null,
            date,
            time: draft.time,
          });

          if (!scheduled) {
            Alert.alert('Task saved', 'Notification was not scheduled. Pick a future time and allow notifications on your device.');
          }
        }
      }

      setAddVisible(false);
      hapticLight();
      await loadGoals();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Goal was not saved.';
      setFormError({ field: 'general', message });
      Alert.alert('Goal not saved', message);
    } finally {
      setSaving(false);
    }
  }, [
    categoryById,
    currentMonthStart,
    currentUserId,
    currentWeekStart,
    draft,
    loadGoals,
    monthlyGoals,
    resolveCategoryId,
    weeklyGoals,
  ]);

  const toggleDailyGoal = useCallback(
    async (task: DailyGoal) => {
      if (!currentUserId) return;
      const nextCompleted = !task.completed;
      const previous = dailyGoals;
      const nextRows = dailyGoals.map((item) => (item.id === task.id ? { ...item, completed: nextCompleted } : item));
      hapticLight();
      setDailyGoals(nextRows);

      const { error: updateError } = await supabase
        .from('tasks')
        .update({ completed: nextCompleted })
        .eq('id', task.id)
        .eq('user_id', currentUserId);

      if (updateError) {
        setDailyGoals(previous);
        Alert.alert('Task not updated', updateError.message);
        return;
      }

      const linkedWeekly = weeklyGoals.find((goal) => goal.id === task.weeklyGoalId);
      const linkedMonthly = monthlyGoals.find((goal) => goal.id === task.monthlyGoalId);
      if (linkedWeekly?.unit.toLowerCase().includes('session') || linkedMonthly?.unit.toLowerCase().includes('session')) {
        await loadGoals();
        return;
      }

      await syncLinkedGoalProgress(nextRows, task.weeklyGoalId, task.monthlyGoalId);
    },
    [currentUserId, dailyGoals, loadGoals, monthlyGoals, syncLinkedGoalProgress, weeklyGoals],
  );

  const renderTabs = () => (
    <View style={styles.tabSwitcher}>
      {TABS.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[styles.tabPill, activeTab === tab.id && styles.tabPillActive]}
          onPress={() => setActiveTab(tab.id)}>
          <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderEmpty = (title: string, body: string) => (
    <View style={styles.emptyCard}>
      <Ionicons name="flag-outline" size={22} color={colors.violetLight} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{body}</Text>
    </View>
  );

  const renderFinanceShortcut = () => (
    <TouchableOpacity style={styles.financeShortcut} onPress={() => router.push('/finance')}>
      <View style={styles.financeShortcutIcon}>
        <Ionicons name="wallet-outline" size={21} color={colors.emeraldLight} />
      </View>
      <View style={styles.financeShortcutCopy}>
        <Text style={styles.financeShortcutTitle}>Finance</Text>
        <Text style={styles.financeShortcutText}>Track spending, budgets, and recent transactions.</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const renderWeeklyGoal = (goal: WeeklyGoal) => {
    const category = categoryById.get(goal.categoryId);
    const accent = category?.color || colors.violet;
    const linkedTasks = tasksByWeeklyGoal.get(goal.id) ?? [];
    const progress = weeklyProgress(goal);
    const parent = monthlyGoals.find((monthly) => monthly.id === goal.monthlyGoalId);
    const isSessionGoal = goal.unit.toLowerCase().includes('session');

    return (
      <View key={goal.id} style={styles.goalCard}>
        <View style={styles.goalHeader}>
          <View style={[styles.categoryIcon, { backgroundColor: `${accent}24` }]}>
            <Ionicons name={iconName(category?.icon || 'flag-outline')} size={18} color={accent} />
          </View>
          <View style={styles.goalHeaderCopy}>
            <Text style={styles.goalTitle}>{goal.title}</Text>
            <Text style={styles.goalMeta}>
              {category?.name || 'Uncategorized'}{parent ? ` · ${parent.title}` : ''}
            </Text>
          </View>
          <Text style={styles.progressText}>{progress}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: accent }]} />
        </View>
        <View style={styles.goalFooter}>
          <Text style={styles.goalMeta}>
            {isSessionGoal
              ? `${goal.currentValue} of ${goal.targetValue} ${goal.unit}`
              : linkedTasks.length > 0
              ? `${linkedTasks.filter((task) => task.completed).length} of ${linkedTasks.length} daily tasks`
              : `${goal.currentValue} of ${goal.targetValue} ${goal.unit}`}
          </Text>
          {!isSessionGoal ? (
            <TouchableOpacity style={styles.inlineAction} onPress={() => openAddGoal('daily', { weeklyGoal: goal })}>
              <Ionicons name="add" size={15} color={colors.blueLight} />
              <Text style={styles.inlineActionText}>Daily task</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {linkedTasks.length > 0 ? (
          <View style={styles.taskList}>
            {linkedTasks.map((task) => (
              <TouchableOpacity key={task.id} style={styles.taskRow} onPress={() => openEditDailyTask(task)}>
                <TouchableOpacity
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    void toggleDailyGoal(task);
                  }}>
                  <Ionicons
                    name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={task.completed ? colors.emerald : colors.textMuted}
                  />
                </TouchableOpacity>
                <View style={styles.taskCopy}>
                  <Text style={[styles.taskTitle, task.completed && styles.completedText]}>{task.title}</Text>
                  <Text style={styles.goalMeta}>
                    {task.date}{task.time ? ` · ${task.time}` : ''}
                  </Text>
                </View>
                <Ionicons name="create-outline" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderWeekly = () => (
    <>
      <View style={styles.periodCard}>
        <View style={styles.periodCopy}>
          <Text style={styles.eyebrow}>Week {currentWeekNumber() + weekOffset}</Text>
          <Text style={styles.dateRange}>{weekRange(weekOffset)}</Text>
          <View style={styles.weekNav}>
            <TouchableOpacity style={styles.iconPill} onPress={() => setWeekOffset((value) => value - 1)}>
              <Ionicons name="arrow-back" size={17} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconPill} onPress={() => setWeekOffset((value) => value + 1)}>
              <Ionicons name="arrow-forward" size={17} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
        <ProgressRing progress={weekOverallProgress} size={112} strokeWidth={10} color={colors.violet} arcDegrees={250}>
          <Text style={styles.ringValue}>{weekOverallProgress}%</Text>
          <Text style={styles.ringLabel}>week</Text>
        </ProgressRing>
      </View>

      <View style={styles.activityStrip}>
        {weekTaskDates.map((date, index) => {
          const dayTasks = dailyGoals.filter((task) => task.date === date);
          return (
            <View key={date} style={styles.dayColumn}>
              <Text style={styles.dayLabel}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</Text>
              <View style={styles.domainDots}>
                {dayTasks.length === 0 ? (
                  <View style={styles.domainDot} />
                ) : (
                  dayTasks.slice(0, 3).map((task) => (
                    <View
                      key={task.id}
                      style={[
                        styles.domainDot,
                        { backgroundColor: task.completed ? colors.emerald : categoryById.get(task.categoryId)?.color || colors.violet },
                      ]}
                    />
                  ))
                )}
              </View>
            </View>
          );
        })}
      </View>

      {visibleWeeklyGoals.length === 0
        ? renderEmpty('No weekly goals yet', 'Use the Add goal button below to create one, or break down a monthly goal.')
        : categories.map((category) => {
            const goals = visibleWeeklyGoals.filter((goal) => goal.categoryId === category.id);
            if (goals.length === 0) return null;
            return (
              <View key={category.id} style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.categoryIcon, { backgroundColor: `${category.color}24` }]}>
                    <Ionicons name={iconName(category.icon)} size={18} color={category.color} />
                  </View>
                  <Text style={styles.sectionTitle}>{category.name}</Text>
                </View>
                <View style={styles.goalList}>{goals.map(renderWeeklyGoal)}</View>
              </View>
            );
          })}
    </>
  );

  const renderMonthly = () => (
    <>
      <View style={styles.periodCard}>
        <View style={styles.periodCopy}>
          <Text style={styles.eyebrow}>This month</Text>
          <Text style={styles.dateRange}>{new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date())}</Text>
          <Text style={styles.statLine}>
            {visibleMonthlyGoals.length} monthly goals · {visibleWeeklyGoals.length} weekly goals this week
          </Text>
        </View>
        <ProgressRing progress={monthOverallProgress} size={112} strokeWidth={10} color={colors.violet} arcDegrees={250}>
          <Text style={styles.ringValue}>{monthOverallProgress}%</Text>
          <Text style={styles.ringLabel}>month</Text>
        </ProgressRing>
      </View>

      {visibleMonthlyGoals.length === 0
        ? renderEmpty('No monthly goals yet', 'Use the Add goal button below to create your first monthly direction.')
        : categories.map((category) => {
            const goals = visibleMonthlyGoals.filter((goal) => goal.categoryId === category.id);
            if (goals.length === 0) return null;

            return (
              <View key={category.id} style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.categoryIcon, { backgroundColor: `${category.color}24` }]}>
                    <Ionicons name={iconName(category.icon)} size={18} color={category.color} />
                  </View>
                  <Text style={styles.sectionTitle}>{category.name}</Text>
                </View>
                <View style={styles.goalList}>
                  {goals.map((goal) => {
                    const linkedWeekly = weeklyGoals.filter((weekly) => weekly.monthlyGoalId === goal.id);
                    const linkedTasks = tasksByMonthlyGoal.get(goal.id) ?? [];
                    const progress = monthlyProgress(goal);
                    const isSessionGoal = goal.unit.toLowerCase().includes('session');

                    return (
                      <View key={goal.id} style={styles.goalCard}>
                        <View style={styles.goalHeader}>
                          <View style={styles.goalHeaderCopy}>
                            <Text style={styles.goalTitle}>{goal.title}</Text>
                            <Text style={styles.goalMeta}>
                              {isSessionGoal
                                ? `${goal.currentValue} of ${goal.targetValue} ${goal.unit}`
                                : `${linkedWeekly.length} weekly goals · ${linkedTasks.length} daily tasks`}
                            </Text>
                          </View>
                          <Text style={styles.progressText}>{progress}%</Text>
                        </View>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: category.color }]} />
                        </View>
                        {linkedWeekly.length > 0 ? (
                          <View style={styles.linkList}>
                            {linkedWeekly.map((weekly) => (
                              <Text key={weekly.id} style={styles.linkedText}>
                                {weekly.title} · {weeklyProgress(weekly)}%
                              </Text>
                            ))}
                          </View>
                        ) : null}
                        {!isSessionGoal ? (
                          <TouchableOpacity style={styles.primaryInlineButton} onPress={() => openAddGoal('weekly', { monthlyGoal: goal })}>
                            <Ionicons name="git-branch-outline" size={16} color={colors.textPrimary} />
                            <Text style={styles.primaryInlineButtonText}>Break into week</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
    </>
  );

  const addLabel = activeTab === 'month' ? 'Add monthly goal' : 'Add weekly goal';

  const renderAddSheet = () => {
    const selectedMonthly = monthlyGoals.find((goal) => goal.id === draft.parentMonthlyGoalId);
    const selectedWeekly = weeklyGoals.find((goal) => goal.id === draft.parentWeeklyGoalId);
    const effectiveCategoryId = selectedWeekly?.categoryId || selectedMonthly?.categoryId || draft.categoryId;
    const selectedCategoryName =
      draft.newCategoryName.trim() || categoryById.get(effectiveCategoryId)?.name || 'General';
    const suggestedUnits = unitSuggestions(selectedCategoryName);
    const targetAmount = Number(draft.target);
    const hasMeasurableTarget = Number.isFinite(targetAmount) && targetAmount > 0 && Boolean(draft.unit.trim());
    const goalPeriod = draft.type === 'monthly' ? 'this month' : 'this week';

    return (
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={() => setAddVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>{draft.editTaskId ? 'Edit task' : draft.type === 'daily' ? 'Add task' : 'Add goal'}</Text>
              <TouchableOpacity onPress={() => setAddVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}>
            {!draft.editTaskId ? (
              <View style={styles.choiceRow}>
                {(['monthly', 'weekly', 'daily'] as GoalFormType[]).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.choiceChip, draft.type === type && styles.choiceChipActive]}
                    onPress={() => setDraft((value) => ({ ...value, type }))}>
                    <Text style={[styles.choiceText, draft.type === type && styles.choiceTextActive]}>
                      {type === 'daily' ? 'Daily task' : `${type[0].toUpperCase()}${type.slice(1)}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {draft.type === 'daily' ? (
              <>
                <TextInput
                  value={draft.title}
                  onChangeText={(title) => setDraft((value) => ({ ...value, title }))}
                  placeholder="Task title"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />

                <TextInput
                  value={draft.date}
                  onChangeText={(date) => setDraft((value) => ({ ...value, date }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />

                <View style={styles.timePicker}>
                  <Text style={styles.fieldLabel}>Time</Text>
                  <View style={styles.timePickerRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => setDraft((value) => ({ ...value, time: adjustTaskTime(value.time, -60) }))}
                      style={styles.timeButton}>
                      <Ionicons name="remove" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.timeValue}>{formatTaskTime(draft.time)}</Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => setDraft((value) => ({ ...value, time: adjustTaskTime(value.time, 60) }))}
                      style={styles.timeButton}>
                      <Ionicons name="add" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.timePickerRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => setDraft((value) => ({ ...value, time: adjustTaskTime(value.time, -15) }))}
                      style={styles.minuteButton}>
                      <Text style={styles.minuteButtonText}>-15 min</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => setDraft((value) => ({ ...value, time: toggleMeridiem(value.time) }))}
                      style={styles.minuteButton}>
                      <Text style={styles.minuteButtonText}>
                        {draft.time.split(':')[0] && Number(draft.time.split(':')[0]) >= 12 ? 'PM' : 'AM'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => setDraft((value) => ({ ...value, time: adjustTaskTime(value.time, 15) }))}
                      style={styles.minuteButton}>
                      <Text style={styles.minuteButtonText}>+15 min</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.priorityRow}>
                  {priorityOptions.map((priority) => {
                    const selected = draft.priority === priority;
                    return (
                      <TouchableOpacity
                        key={priority}
                        accessibilityRole="button"
                        onPress={() => setDraft((value) => ({ ...value, priority }))}
                        style={[styles.priorityChip, selected && styles.priorityChipSelected]}>
                        <Text style={[styles.priorityText, selected && styles.priorityTextSelected]}>{priority}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  value={draft.notes}
                  onChangeText={(notes) => setDraft((value) => ({ ...value, notes }))}
                  multiline
                  placeholder="Notes"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.notesInput]}
                />

                <View style={styles.notifyRow}>
                  <View style={styles.notifyCopy}>
                    <Text style={styles.notifyTitle}>Notify me</Text>
                    <Text style={styles.notifyDetail}>Send a reminder when this task time arrives.</Text>
                  </View>
                  <Switch
                    value={draft.notify}
                    onValueChange={(notify) => setDraft((value) => ({ ...value, notify }))}
                    thumbColor={draft.notify ? colors.violetLight : colors.textMuted}
                    trackColor={{ false: colors.surface2, true: colors.violetBg }}
                  />
                </View>

                <View style={styles.linkBlock}>
                  <Text style={styles.fieldLabel}>Link to weekly goal</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                    {weeklyGoals.length === 0 ? (
                      <Text style={styles.helperText}>Create a weekly goal first for best linking.</Text>
                    ) : (
                      weeklyGoals.map((goal) => (
                        <TouchableOpacity
                          key={goal.id}
                          style={[styles.categoryChip, draft.parentWeeklyGoalId === goal.id && styles.categoryChipActive]}
                          onPress={() =>
                            setDraft((value) => ({
                              ...value,
                              parentWeeklyGoalId: goal.id,
                              parentMonthlyGoalId: goal.monthlyGoalId,
                              categoryId: goal.categoryId || value.categoryId,
                            }))
                          }>
                          <Text style={styles.categoryChipText}>{goal.title}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                </View>
              </>
            ) : (
              <>
                {draft.type === 'weekly' && monthlyGoals.length > 0 ? (
                  <View style={styles.formSection}>
                    <Text style={styles.fieldLabel}>Parent monthly goal</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                      <TouchableOpacity
                        style={[styles.categoryChip, !draft.parentMonthlyGoalId && styles.categoryChipActive]}
                        onPress={() => setDraft((value) => ({ ...value, parentMonthlyGoalId: '' }))}>
                        <Text style={styles.categoryChipText}>No parent</Text>
                      </TouchableOpacity>
                      {monthlyGoals.map((goal) => (
                        <TouchableOpacity
                          key={goal.id}
                          style={[styles.categoryChip, draft.parentMonthlyGoalId === goal.id && styles.categoryChipActive]}
                          onPress={() =>
                            setDraft((value) => ({
                              ...value,
                              parentMonthlyGoalId: goal.id,
                              categoryId: goal.categoryId || value.categoryId,
                            }))
                          }>
                          <Text style={styles.categoryChipText}>{goal.title}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                    {categories.map((category) => (
                      <TouchableOpacity
                        key={category.id}
                        style={[
                          styles.categoryChip,
                          effectiveCategoryId === category.id && !draft.newCategoryName.trim() && styles.categoryChipActive,
                        ]}
                        onPress={() => setDraft((value) => ({ ...value, categoryId: category.id, newCategoryName: '' }))}>
                        <Ionicons name={iconName(category.icon)} size={14} color={category.color} />
                        <Text style={styles.categoryChipText}>{category.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <TextInput
                  value={draft.newCategoryName}
                  onChangeText={(newCategoryName) => setDraft((value) => ({ ...value, newCategoryName }))}
                  placeholder="Or create new category"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />

                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>What do you want to achieve?</Text>
                  <TextInput
                    value={draft.title}
                    onChangeText={(title) => {
                      setDraft((value) => ({ ...value, title }));
                      setFormError(null);
                    }}
                    placeholder="e.g. Finish my React Native course"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, formError?.field === 'title' && styles.inputError]}
                  />
                  {formError?.field === 'title' ? <Text style={styles.fieldError}>{formError.message}</Text> : null}
                </View>

                <View style={styles.targetCard}>
                  <View style={styles.targetIntroRow}>
                    <View style={styles.targetIcon}>
                      <Ionicons name="flag-outline" size={18} color={colors.violetLight} />
                    </View>
                    <View style={styles.targetIntroCopy}>
                      <Text style={styles.targetTitle}>Set a clear finish line</Text>
                      <Text style={styles.targetDescription}>
                        Add how many you want to finish and what you will count.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.exampleBox}>
                    <Text style={styles.exampleText}>Example: Read 5 books</Text>
                    <Text style={styles.exampleDetail}>
                      <Text style={styles.exampleStrong}>5</Text> is how many · <Text style={styles.exampleStrong}>books</Text> is what you count
                    </Text>
                  </View>

                  <View style={styles.inlineFields}>
                    <View style={styles.amountColumn}>
                      <Text style={styles.inputLabel}>How many?</Text>
                      <TextInput
                        value={draft.target}
                        onChangeText={(target) => {
                          setDraft((value) => ({ ...value, target }));
                          setFormError(null);
                        }}
                        accessibilityLabel="Goal amount"
                        placeholder="e.g. 10"
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, formError?.field === 'target' && styles.inputError]}
                      />
                      <Text style={styles.fieldHint}>Total to reach</Text>
                    </View>
                    <View style={styles.fieldColumn}>
                      <Text style={styles.inputLabel}>What are you counting?</Text>
                      <TextInput
                        value={draft.unit}
                        onChangeText={(unit) => {
                          setDraft((value) => ({ ...value, unit }));
                          setFormError(null);
                        }}
                        accessibilityLabel="What the goal counts"
                        placeholder="e.g. lessons"
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, formError?.field === 'unit' && styles.inputError]}
                      />
                      <Text style={styles.fieldHint}>Use one simple word</Text>
                    </View>
                  </View>

                  <View style={styles.suggestionBlock}>
                    <Text style={styles.suggestionLabel}>Common for {selectedCategoryName}</Text>
                    <View style={styles.suggestionRow}>
                      {suggestedUnits.map((unit) => {
                        const selected = draft.unit.trim().toLowerCase() === unit;
                        return (
                          <TouchableOpacity
                            key={unit}
                            accessibilityRole="button"
                            onPress={() => {
                              setDraft((value) => ({ ...value, unit }));
                              setFormError(null);
                            }}
                            style={[styles.unitChip, selected && styles.unitChipActive]}>
                            <Text style={[styles.unitChipText, selected && styles.unitChipTextActive]}>{unit}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <View style={[styles.goalPreview, hasMeasurableTarget && styles.goalPreviewReady]}>
                    <Ionicons
                      name={hasMeasurableTarget ? 'checkmark-circle' : 'information-circle-outline'}
                      size={20}
                      color={hasMeasurableTarget ? colors.emeraldLight : colors.textSecondary}
                    />
                    <View style={styles.goalPreviewCopy}>
                      <Text style={styles.goalPreviewLabel}>Your progress will look like</Text>
                      <Text style={styles.goalPreviewValue}>
                        {hasMeasurableTarget ? `0 of ${draft.target.trim()} ${draft.unit.trim()} ${goalPeriod}` : '0 of —'}
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}

            {formError ? (
              <View accessibilityLiveRegion="polite" style={styles.formErrorBanner}>
                <Ionicons name="alert-circle" size={19} color={colors.rose} />
                <Text style={styles.formErrorText}>{formError.message}</Text>
              </View>
            ) : null}

            <TouchableOpacity disabled={saving} style={[styles.primaryButton, saving && styles.disabledButton]} onPress={() => void saveGoal()}>
              <Text style={styles.primaryButtonText}>
                {saving
                  ? 'Saving...'
                  : draft.editTaskId
                    ? 'Update task'
                    : draft.type === 'daily'
                      ? 'Save task'
                      : `Create ${draft.type} goal`}
              </Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + 118 }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Goals</Text>
            <Text style={styles.subtitle}>Monthly direction, weekly execution, daily action.</Text>
          </View>
        </View>

        {renderTabs()}
        {renderFinanceShortcut()}

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.violetLight} />
            <Text style={styles.helperText}>Loading goals...</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Ionicons name="warning-outline" size={22} color={colors.amber} />
            <Text style={styles.emptyTitle}>Goals need schema update</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => void loadGoals()}>
              <Ionicons name="refresh" size={16} color={colors.textPrimary} />
              <Text style={styles.emptyButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {activeTab === 'week' ? renderWeekly() : null}
            {activeTab === 'month' ? renderMonthly() : null}
          </>
        )}
      </ScrollView>

      {!loading && !error ? (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 78 }]}
          onPress={() => openAddGoal(activeTab === 'month' ? 'monthly' : 'weekly')}>
          <Ionicons name="add" size={22} color={colors.textPrimary} />
          <Text style={styles.fabText}>{addLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {renderAddSheet()}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, maxWidth: 270 },
  tabSwitcher: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  tabPill: { alignItems: 'center', borderRadius: radii.pill, flex: 1, justifyContent: 'center', minHeight: 38, paddingHorizontal: 8 },
  tabPillActive: { backgroundColor: colors.violet },
  tabText: { ...typography.labelCaps, color: colors.textSecondary, textAlign: 'center' },
  tabTextActive: { color: colors.textPrimary },
  financeShortcut: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  financeShortcutIcon: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: `${colors.emeraldLight}55`,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  financeShortcutCopy: { flex: 1, gap: 2 },
  financeShortcutTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  financeShortcutText: { ...typography.body, color: colors.textSecondary },
  periodCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  periodCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.labelCaps, color: colors.violetLight, textTransform: 'uppercase' },
  dateRange: { ...typography.h1, color: colors.textPrimary },
  statLine: { ...typography.body, color: colors.textSecondary },
  weekNav: { flexDirection: 'row', gap: spacing.xs },
  iconPill: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 42,
  },
  ringValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  ringLabel: { ...typography.labelCaps, color: colors.textSecondary },
  activityStrip: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  dayColumn: { alignItems: 'center', gap: spacing.xs },
  dayLabel: { ...typography.labelCaps, color: colors.textSecondary },
  domainDots: { alignItems: 'center', gap: 4, minHeight: 35 },
  domainDot: { backgroundColor: colors.surface3, borderRadius: 5, height: 9, width: 9 },
  sectionCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  sectionTitle: { ...typography.h1, color: colors.textPrimary, flex: 1, fontSize: 18 },
  categoryIcon: { alignItems: 'center', borderRadius: radii.inner, height: 34, justifyContent: 'center', width: 34 },
  goalList: { gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: spacing.sm },
  goalCard: { backgroundColor: colors.surface2, borderRadius: radii.inner, gap: spacing.xs, padding: spacing.sm },
  goalHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  goalHeaderCopy: { flex: 1, gap: 2 },
  goalTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  goalMeta: { ...typography.labelCaps, color: colors.textSecondary },
  progressText: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  progressTrack: { backgroundColor: colors.surface3, borderRadius: radii.pill, height: 8, overflow: 'hidden' },
  progressFill: { borderRadius: radii.pill, height: 8 },
  goalFooter: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  inlineAction: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  inlineActionText: { ...typography.labelCaps, color: colors.blueLight },
  taskList: { gap: 6 },
  taskRow: { alignItems: 'center', backgroundColor: colors.surface1, borderRadius: radii.inner, flexDirection: 'row', gap: spacing.xs, padding: spacing.xs },
  taskCopy: { flex: 1 },
  taskTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  completedText: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  linkList: { gap: 5 },
  linkedText: { ...typography.labelCaps, color: colors.violetLight },
  primaryInlineButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  primaryInlineButtonText: { ...typography.labelCaps, color: colors.textPrimary },
  emptyCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  emptyText: { ...typography.body, color: colors.textSecondary },
  emptyButton: {
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  emptyButtonText: { ...typography.labelCaps, color: colors.textPrimary },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  helperText: { ...typography.body, color: colors.textSecondary },
  fab: {
    ...shadows.ambient,
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    position: 'absolute',
    right: spacing.gutter,
  },
  fabText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  modalOverlay: { backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: spacing.md,
    maxHeight: '90%',
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.gutter,
  },
  sheetScroll: {
    marginHorizontal: -spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sheetScrollContent: {
    gap: 14,
    paddingBottom: spacing.lg,
  },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitle: { ...typography.h1, color: colors.textPrimary },
  choiceRow: { flexDirection: 'row', gap: 10, marginBottom: 2 },
  choiceChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  choiceChipActive: { backgroundColor: colors.violet, borderColor: colors.violet },
  choiceText: { ...typography.labelCaps, color: colors.textSecondary, textAlign: 'center' },
  choiceTextActive: { color: colors.textPrimary },
  fieldLabel: { ...typography.labelCaps, color: colors.textSecondary, lineHeight: 18, textTransform: 'uppercase' },
  inputLabel: { ...typography.labelCaps, color: colors.textSecondary },
  formSection: { gap: 8 },
  linkBlock: { gap: 8 },
  chipScroll: { gap: 10, paddingBottom: 2, paddingRight: spacing.gutter },
  categoryChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    maxWidth: 220,
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  categoryChipActive: { backgroundColor: colors.violetBg, borderColor: colors.violet },
  categoryChipText: { ...typography.labelCaps, color: colors.textPrimary },
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    paddingVertical: 14,
  },
  inputError: { borderColor: colors.rose },
  fieldError: { color: colors.rose, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  formErrorBanner: {
    alignItems: 'center',
    backgroundColor: colors.roseBg,
    borderColor: `${colors.rose}66`,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  formErrorText: { color: colors.textPrimary, flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  inlineFields: { flexDirection: 'row', gap: 12 },
  fieldColumn: { flex: 1, gap: 8 },
  amountColumn: { gap: 8, width: 112 },
  fieldHint: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  targetCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 16,
    padding: spacing.sm,
  },
  targetIntroRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  targetIcon: {
    alignItems: 'center',
    backgroundColor: colors.violetBg,
    borderRadius: radii.inner,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  targetIntroCopy: { flex: 1, gap: 2 },
  targetTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  targetDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  exampleBox: {
    backgroundColor: colors.surface3,
    borderRadius: radii.inner,
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exampleText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  exampleDetail: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  exampleStrong: { color: colors.violetLight, fontWeight: '800' },
  suggestionBlock: { gap: 8 },
  suggestionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unitChip: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  unitChipActive: { backgroundColor: colors.violetBg, borderColor: colors.violet },
  unitChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  unitChipTextActive: { color: colors.violetLight },
  goalPreview: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  goalPreviewReady: { borderColor: `${colors.emeraldLight}66` },
  goalPreviewCopy: { flex: 1, gap: 2 },
  goalPreviewLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  goalPreviewValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', lineHeight: 20 },
  flexInput: { flex: 1 },
  timePicker: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    gap: 12,
    padding: 14,
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
    height: 40,
    justifyContent: 'center',
    width: 48,
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
    paddingVertical: 10,
  },
  minuteButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  priorityRow: { flexDirection: 'row', gap: 10 },
  priorityChip: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 11,
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
  priorityTextSelected: { color: colors.violetLight },
  notesInput: { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },
  notifyRow: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 86,
    padding: spacing.sm,
  },
  notifyCopy: { flex: 1 },
  notifyTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  notifyDetail: { ...typography.labelCaps, color: colors.textSecondary, marginTop: 2, textTransform: 'none' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginTop: 2,
    minHeight: 58,
  },
  primaryButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  disabledButton: { opacity: 0.6 },
  });
}
