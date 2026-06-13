import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
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
import { colors, radii, shadows, spacing, typography } from '@/lib/design';
import { scheduleTaskNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type GoalsTab = 'week' | 'month' | 'finance';
type GoalFormType = 'monthly' | 'weekly' | 'daily';
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
};

const TABS: { id: GoalsTab; label: string }[] = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'finance', label: 'Finance' },
];

const DEFAULT_CATEGORIES = [
  { name: 'Learning', color: colors.indigo, icon: 'book-outline' },
  { name: 'Work', color: colors.blue, icon: 'briefcase-outline' },
  { name: 'Health', color: colors.emerald, icon: 'fitness-outline' },
];

const priorityOptions = ['low', 'medium', 'high'];

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
    monthlyGoalId: asText(row.monthly_goal_id),
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
    const { error: insertError } = await supabase.from('goal_categories').insert(missing);
    if (insertError) throw new Error(insertError.message);

    const { data: refreshed, error: refreshError } = await supabase
      .from('goal_categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    if (refreshError) throw new Error(refreshError.message);
    return ((refreshed ?? []) as LooseRow[]).map(categoryFromRow);
  }

  return existing;
}

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const currentUserId = useUserStore((state) => state.currentUserId);
  const [activeTab, setActiveTab] = useState<GoalsTab>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [categories, setCategories] = useState<GoalCategory[]>([]);
  const [monthlyGoals, setMonthlyGoals] = useState<MonthlyGoal[]>([]);
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>([]);
  const [dailyGoals, setDailyGoals] = useState<DailyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
      const nextCategories = await ensureDefaultCategories(currentUserId);
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
  }, [currentUserId]);

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
      const tasks = tasksByWeeklyGoal.get(goal.id) ?? [];
      if (tasks.length > 0) return percentage(tasks.filter((task) => task.completed).length, tasks.length);
      return percentage(goal.currentValue, goal.targetValue);
    },
    [tasksByWeeklyGoal],
  );

  const monthlyProgress = useCallback(
    (goal: MonthlyGoal) => {
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
      });
      setAddVisible(true);
    },
    [categories],
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
    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before adding goals.');
      return;
    }
    if (!title) {
      Alert.alert('Title needed', 'Add a title before saving.');
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
      const targetValue = Math.max(1, Number(draft.target) || 1);
      const unit = draft.unit.trim() || 'items';

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
        const { error: insertError } = await supabase.from('weekly_goals').insert({
          user_id: currentUserId,
          category_id: categoryId || null,
          category: categoryName,
          monthly_goal_id: selectedMonthly?.id || null,
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

        const { data, error: insertError } = await supabase.from('tasks').insert({
          user_id: currentUserId,
          title,
          date,
          time_block: formatTaskTime(draft.time),
          completed: false,
          priority: draft.priority,
          notes: draft.notes.trim() || null,
          category: 'goals',
          category_id: categoryId || null,
          weekly_goal_id: selectedWeekly?.id || null,
          monthly_goal_id: selectedWeekly?.monthlyGoalId || selectedMonthly?.id || null,
        }).select('*').single();
        if (insertError) throw new Error(insertError.message);

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
      await loadGoals();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Goal was not saved.';
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

      await syncLinkedGoalProgress(nextRows, task.weeklyGoalId, task.monthlyGoalId);
    },
    [currentUserId, dailyGoals, syncLinkedGoalProgress],
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

  const renderWeeklyGoal = (goal: WeeklyGoal) => {
    const category = categoryById.get(goal.categoryId);
    const accent = category?.color || colors.violet;
    const linkedTasks = tasksByWeeklyGoal.get(goal.id) ?? [];
    const progress = weeklyProgress(goal);
    const parent = monthlyGoals.find((monthly) => monthly.id === goal.monthlyGoalId);

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
            {linkedTasks.length > 0
              ? `${linkedTasks.filter((task) => task.completed).length} of ${linkedTasks.length} daily tasks`
              : `${goal.currentValue} of ${goal.targetValue} ${goal.unit}`}
          </Text>
          <TouchableOpacity style={styles.inlineAction} onPress={() => openAddGoal('daily', { weeklyGoal: goal })}>
            <Ionicons name="add" size={15} color={colors.blueLight} />
            <Text style={styles.inlineActionText}>Daily task</Text>
          </TouchableOpacity>
        </View>
        {linkedTasks.length > 0 ? (
          <View style={styles.taskList}>
            {linkedTasks.map((task) => (
              <TouchableOpacity key={task.id} style={styles.taskRow} onPress={() => void toggleDailyGoal(task)}>
                <Ionicons
                  name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={task.completed ? colors.emerald : colors.textMuted}
                />
                <View style={styles.taskCopy}>
                  <Text style={[styles.taskTitle, task.completed && styles.completedText]}>{task.title}</Text>
                  <Text style={styles.goalMeta}>{task.date}</Text>
                </View>
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

                    return (
                      <View key={goal.id} style={styles.goalCard}>
                        <View style={styles.goalHeader}>
                          <View style={styles.goalHeaderCopy}>
                            <Text style={styles.goalTitle}>{goal.title}</Text>
                            <Text style={styles.goalMeta}>
                              {linkedWeekly.length} weekly goals · {linkedTasks.length} daily tasks
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
                        <TouchableOpacity style={styles.primaryInlineButton} onPress={() => openAddGoal('weekly', { monthlyGoal: goal })}>
                          <Ionicons name="git-branch-outline" size={16} color={colors.textPrimary} />
                          <Text style={styles.primaryInlineButtonText}>Break into week</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
    </>
  );

  const renderFinance = () =>
    renderEmpty('Finance is clean', 'Dummy transactions were removed. We can connect finance again after the goal flow is stable.');

  const addLabel = activeTab === 'month' ? 'Add monthly goal' : 'Add weekly goal';

  const renderAddSheet = () => {
    const selectedMonthly = monthlyGoals.find((goal) => goal.id === draft.parentMonthlyGoalId);
    const selectedWeekly = weeklyGoals.find((goal) => goal.id === draft.parentWeeklyGoalId);
    const effectiveCategoryId = selectedWeekly?.categoryId || selectedMonthly?.categoryId || draft.categoryId;

    return (
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={() => setAddVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>{draft.type === 'daily' ? 'Add task' : 'Add goal'}</Text>
              <TouchableOpacity onPress={() => setAddVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}>
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

                <TextInput
                  value={draft.title}
                  onChangeText={(title) => setDraft((value) => ({ ...value, title }))}
                  placeholder="Goal title"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />

                <View style={styles.formSection}>
                  <View style={styles.measureHeader}>
                    <Text style={styles.fieldLabel}>How will you measure it?</Text>
                    <Text style={styles.helperText}>Example: 10 lessons, 4 workouts, 1 project.</Text>
                  </View>
                  <View style={styles.inlineFields}>
                    <View style={styles.fieldColumn}>
                      <Text style={styles.inputLabel}>Target number</Text>
                      <TextInput
                        value={draft.target}
                        onChangeText={(target) => setDraft((value) => ({ ...value, target }))}
                        placeholder="10"
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.fieldColumn}>
                      <Text style={styles.inputLabel}>Measure</Text>
                      <TextInput
                        value={draft.unit}
                        onChangeText={(unit) => setDraft((value) => ({ ...value, unit }))}
                        placeholder="lessons"
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                      />
                    </View>
                  </View>
                </View>
              </>
            )}

            <TouchableOpacity disabled={saving} style={[styles.primaryButton, saving && styles.disabledButton]} onPress={() => void saveGoal()}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : draft.type === 'daily' ? 'Save task' : 'Save'}</Text>
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
            {activeTab === 'finance' ? renderFinance() : null}
          </>
        )}
      </ScrollView>

      {!loading && !error && activeTab !== 'finance' ? (
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

const styles = StyleSheet.create({
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
  measureHeader: { gap: 4 },
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
  inlineFields: { flexDirection: 'row', gap: 12 },
  fieldColumn: { flex: 1, gap: 8 },
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
