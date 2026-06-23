import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line as SvgLine, Path as SvgPath, Rect, Text as SvgText } from 'react-native-svg';

import { HeatmapCalendar } from '@/components/ui/HeatmapCalendar';
import { StatCard } from '@/components/ui/StatCard';
import { colors as fallbackColors, radii, shadows, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type Period = '7D' | '30D' | '90D' | '1Y';
type LooseRow = Record<string, Json | undefined>;
type DayPoint = { date: string; value: number };

const PERIOD_DAYS: Record<Period, number> = { '7D': 7, '30D': 30, '90D': 90, '1Y': 365 };
const PERIODS: Period[] = ['7D', '30D', '90D', '1Y'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHART_HEIGHT = 190;
const CHART_WIDTH = 320;
const CHART_PADDING = { top: 16, right: 12, bottom: 24, left: 28 };
const TARGET_EXERCISES = ['bench', 'shoulder', 'tricep'] as const;

type AnalyticsTheme = {
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
};

const AnalyticsThemeContext = createContext<AnalyticsTheme | null>(null);

function useAnalyticsTheme() {
  const theme = useContext(AnalyticsThemeContext);
  if (theme) return theme;
  return { colors: fallbackColors, styles: createStyles(fallbackColors) };
}

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isDone(row: LooseRow) {
  const status = asText(row.status).toLowerCase();
  return row.completed === true || row.done === true || status === 'done' || status === 'completed';
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftDate(key: string, days: number) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function rowDate(row: LooseRow) {
  return (
    asText(row.date) ||
    asText(row.completed_at).slice(0, 10) ||
    asText(row.started_at).slice(0, 10) ||
    asText(row.created_at).slice(0, 10)
  );
}

function formatShortDate(key: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(dateFromKey(key));
}

function eachDay(start: string, end: string) {
  const days: string[] = [];
  for (let key = start; key <= end; key = shiftDate(key, 1)) days.push(key);
  return days;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function scoreFromRow(row: LooseRow) {
  return asNumber(row.life_score) || asNumber(row.score) || asNumber(row.value) || asNumber(row.total_score);
}

function averageColumn(rows: LooseRow[], column: string) {
  return Math.round(average(rows.map((row) => asNumber(row[column])).filter((value) => value > 0)));
}

function groupedCalories(rows: LooseRow[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const date = rowDate(row);
    if (!date) return;

    const items = Array.isArray(row.meal_log_items) ? row.meal_log_items : [];
    const itemCalories = items.reduce<number>((sum, raw) => {
      const item = raw && typeof raw === 'object' ? (raw as LooseRow) : {};
      return sum + (asNumber(item.calories) || asNumber(item.kcal));
    }, 0);
    const calories = itemCalories || asNumber(row.calories) || asNumber(row.kcal);

    totals.set(date, (totals.get(date) ?? 0) + calories);
  });
  return totals;
}

function rowAmount(row: LooseRow) {
  return Math.abs(asNumber(row.amount) || asNumber(row.value));
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, notation: value >= 100000 ? 'compact' : 'standard' }).format(value);
}

function taskDate(row: LooseRow) {
  return asText(row.date) || rowDate(row);
}

function workoutDate(row: LooseRow) {
  return rowDate(row);
}

function exerciseBucket(name: string) {
  const value = name.toLowerCase();
  if (value.includes('bench') || value.includes('chest press')) return 'bench';
  if (value.includes('shoulder') || value.includes('overhead') || value.includes('press')) return 'shoulder';
  if (value.includes('tricep') || value.includes('triceps')) return 'tricep';
  return null;
}

function trendForDelta(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const theme = useMemo(() => ({ colors, styles }), [colors, styles]);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const targetWeight = useUserStore((state) => state.profile?.targetWeightKg ?? state.onboardingProfile.targetWeight);

  const [period, setPeriod] = useState<Period>('30D');
  const [lifeRows, setLifeRows] = useState<LooseRow[]>([]);
  const [mealRows, setMealRows] = useState<LooseRow[]>([]);
  const [workoutRows, setWorkoutRows] = useState<LooseRow[]>([]);
  const [setRows, setSetRows] = useState<LooseRow[]>([]);
  const [taskRows, setTaskRows] = useState<LooseRow[]>([]);
  const [weightRows, setWeightRows] = useState<LooseRow[]>([]);
  const [financeRows, setFinanceRows] = useState<LooseRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const today = localDateKey(new Date());
  const selectedDays = PERIOD_DAYS[period];
  const startDate = shiftDate(today, -(selectedDays - 1));
  const periodDays = useMemo(() => eachDay(startDate, today), [startDate, today]);
  const chartDays = useMemo(() => periodDays.slice(period === '1Y' ? -90 : -30), [period, periodDays]);
  const shortChartDays = useMemo(() => periodDays.slice(-7), [periodDays]);
  const heatmapWindowDays = useMemo(() => periodDays.slice(-35), [periodDays]);

  const loadAnalytics = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!currentUserId) {
        setLifeRows([]);
        setMealRows([]);
        setWorkoutRows([]);
        setSetRows([]);
        setTaskRows([]);
        setWeightRows([]);
        setFinanceRows([]);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.user) {
        setLifeRows([]);
        setMealRows([]);
        setWorkoutRows([]);
        setSetRows([]);
        setTaskRows([]);
        setWeightRows([]);
        setFinanceRows([]);
        return;
      }

      const sinceIso = `${startDate}T00:00:00.000Z`;
      const [
        life,
        meals,
        workouts,
        sets,
        tasks,
        weights,
        finance,
      ] = await Promise.all([
        supabase.from('life_scores').select('*').eq('user_id', currentUserId).gte('date', startDate).lte('date', today),
        supabase.from('meal_logs').select('*, meal_log_items(calories)').eq('user_id', currentUserId).gte('date', startDate).lte('date', today),
        supabase.from('workout_sessions').select('*').eq('user_id', currentUserId).gte('completed_at', sinceIso),
        supabase.from('workout_sets').select('*').eq('user_id', currentUserId).gte('created_at', sinceIso).limit(500),
        supabase.from('tasks').select('*').eq('user_id', currentUserId),
        supabase.from('body_metrics').select('*').eq('user_id', currentUserId).gte('date', startDate).lte('date', today),
        supabase.from('finance_transactions').select('*').eq('user_id', currentUserId).gte('date', startDate).lte('date', today),
      ]);

      if (life.error) console.warn('Unable to load life scores', life.error.message);
      if (meals.error) console.warn('Unable to load meal logs', meals.error.message);
      if (workouts.error) console.warn('Unable to load workouts', workouts.error.message);
      if (sets.error) console.warn('Unable to load workout sets', sets.error.message);
      if (tasks.error) console.warn('Unable to load tasks', tasks.error.message);
      if (weights.error) console.warn('Unable to load body metrics', weights.error.message);
      if (finance.error) console.warn('Unable to load finance analytics', finance.error.message);

      setLifeRows((life.data ?? []) as LooseRow[]);
      setMealRows((meals.data ?? []) as LooseRow[]);
      setWorkoutRows((workouts.data ?? []) as LooseRow[]);
      setSetRows((sets.data ?? []) as LooseRow[]);
      setTaskRows(((tasks.data ?? []) as LooseRow[]).filter((row) => {
        const date = taskDate(row);
        return date >= startDate && date <= today;
      }));
      setWeightRows((weights.data ?? []) as LooseRow[]);
      setFinanceRows((finance.data ?? []) as LooseRow[]);
    } finally {
      setRefreshing(false);
    }
  }, [currentUserId, startDate, today]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const lifeSeries = useMemo<DayPoint[]>(() => {
    const byDate = new Map(lifeRows.map((row) => [rowDate(row), scoreFromRow(row)]).filter(([date, value]) => date && value) as [string, number][]);
    return chartDays.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
  }, [chartDays, lifeRows]);

  const loggedLifePoints = lifeSeries.filter((point) => point.value > 0);
  const hasLifeData = loggedLifePoints.length > 0;
  const currentLifeScore = loggedLifePoints.at(-1)?.value ?? 0;
  const lastWeekAverage = average(loggedLifePoints.slice(-14, -7).map((point) => point.value));
  const currentWeekAverage = average(loggedLifePoints.slice(-7).map((point) => point.value));
  const scoreDelta = lastWeekAverage > 0 && currentWeekAverage > 0 ? Math.round(currentWeekAverage - lastWeekAverage) : 0;
  const bestScore = loggedLifePoints.reduce((best, point) => (point.value > best.value ? point : best), loggedLifePoints[0] ?? { date: today, value: 0 });

  const calorieChart = useMemo(() => {
    const totals = groupedCalories(mealRows);
    return shortChartDays.map((date) => {
      const value = totals.get(date) ?? 0;
      const under = value <= calorieGoal;
      return {
        day: WEEKDAYS[(dateFromKey(date).getDay() + 6) % 7],
        calories: value,
        under: value > 0 && under ? value : null,
        over: value > 0 && !under ? value : null,
        goal: calorieGoal,
      };
    });
  }, [calorieGoal, mealRows, shortChartDays]);

  const loggedCalorieDays = calorieChart.filter((day) => day.calories > 0).length;
  const underGoalDays = calorieChart.filter((day) => day.calories > 0 && day.calories <= calorieGoal).length;
  const heatmapDays = useMemo(() => {
    const sessions = new Map<string, number>();
    workoutRows.forEach((row) => {
      const date = workoutDate(row);
      if (date) sessions.set(date, (sessions.get(date) ?? 0) + 1);
    });
    return heatmapWindowDays.map((date) => ({ date, value: sessions.get(date) ?? 0 }));
  }, [heatmapWindowDays, workoutRows]);
  const sessionCount = heatmapDays.reduce((sum, day) => sum + (day.value > 0 ? 1 : 0), 0);
  const streak = [...heatmapDays].reverse().findIndex((day) => day.value === 0);
  const workoutStreak = streak === -1 ? heatmapDays.length : streak;

  const strengthChart = useMemo(() => {
    const weeks = Array.from({ length: 8 }, (_, index) => {
      return { x: index + 1, label: `W${index + 1}`, bench: 0, shoulder: 0, tricep: 0 };
    });
    setRows.forEach((row) => {
      const bucket = exerciseBucket(asText(row.exercise_name) || asText(row.name));
      const date = rowDate(row);
      if (!bucket || !date) return;
      const daysAgo = Math.floor((dateFromKey(today).getTime() - dateFromKey(date).getTime()) / 86400000);
      const index = 7 - Math.floor(daysAgo / 7);
      if (index < 0 || index > 7) return;
      const estimate = asNumber(row.weight_kg) * Math.max(1, asNumber(row.reps, 1));
      weeks[index][bucket] = Math.max(weeks[index][bucket], estimate);
    });
    return weeks;
  }, [setRows, today]);
  const hasStrengthData = strengthChart.some((week) => TARGET_EXERCISES.some((key) => week[key] > 0));

  const muscleSeries = useMemo(
    () => [
      { key: 'bench', label: 'Bench', color: colors.amber },
      { key: 'shoulder', label: 'Shoulder', color: colors.amberLight },
      { key: 'tricep', label: 'Tricep', color: '#F97316' },
    ] as const,
    [colors.amber, colors.amberLight],
  );

  const taskChart = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => {
      const weekStart = shiftDate(today, -7 * (5 - index));
      const weekEnd = shiftDate(weekStart, 6);
      const rows = taskRows.filter((row) => {
        const date = taskDate(row);
        return date >= weekStart && date <= weekEnd;
      });
      const completed = rows.filter(isDone).length;
      const incomplete = Math.max(0, rows.length - completed);
      return { week: `W${index + 1}`, completed, incomplete };
    });
  }, [taskRows, today]);
  const totalTasks = taskChart.reduce((sum, week) => sum + week.completed + week.incomplete, 0);
  const completedTasks = taskChart.reduce((sum, week) => sum + week.completed, 0);

  const weightChart = useMemo(() => {
    const byDate = new Map(weightRows.map((row) => [rowDate(row), asNumber(row.weight_kg) || asNumber(row.weight)]).filter(([date, value]) => date && value) as [string, number][]);
    return chartDays.map((date, index) => ({ date, x: index + 1, weight: byDate.get(date) ?? null }));
  }, [chartDays, weightRows]);
  const loggedWeights = weightChart.map((point) => point.weight).filter((value): value is number => typeof value === 'number' && value > 0);

  const correlationChart = useMemo(() => {
    const gymDays = new Set(heatmapDays.filter((day) => day.value > 0).map((day) => day.date));
    return loggedLifePoints.map((point, index) => ({ day: index + 1, gym: gymDays.has(point.date) ? 1 : 0, score: point.value }));
  }, [heatmapDays, lifeSeries]);
  const gymAverage = average(correlationChart.filter((point) => point.gym).map((point) => point.score));
  const nonGymAverage = average(correlationChart.filter((point) => !point.gym).map((point) => point.score));
  const canCompareGymDays = gymAverage > 0 && nonGymAverage > 0;
  const productivityLift = canCompareGymDays ? Math.round(((gymAverage - nonGymAverage) / nonGymAverage) * 100) : 0;
  const correlationInsight = canCompareGymDays
    ? productivityLift > 0
      ? `${productivityLift}% higher Life Score on gym days`
      : `${Math.abs(productivityLift)}% lower Life Score on gym days`
    : 'Needs both gym and recovery-day scores';

  const financeTotal = financeRows.reduce((sum, row) => sum + rowAmount(row), 0);
  const financeTopCategory = useMemo(() => {
    const byCategory = new Map<string, number>();
    financeRows.forEach((row) => {
      const category = asText(row.category, 'Uncategorized');
      byCategory.set(category, (byCategory.get(category) ?? 0) + rowAmount(row));
    });
    return [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  }, [financeRows]);

  const monthlyScores = useMemo(() => {
    const scoreRows = lifeRows.filter((row) => scoreFromRow(row) > 0);
    return [
      { label: 'Nutrition', value: averageColumn(scoreRows, 'nutrition_score'), color: colors.emerald },
      { label: 'Fitness', value: averageColumn(scoreRows, 'fitness_score'), color: colors.amber },
      { label: 'Productivity', value: averageColumn(scoreRows, 'productivity_score'), color: colors.blue },
      { label: 'Hydration', value: averageColumn(scoreRows, 'hydration_score'), color: '#14B8A6' },
      { label: 'Alignment', value: averageColumn(scoreRows, 'alignment_score'), color: colors.indigo },
    ];
  }, [colors.amber, colors.blue, colors.emerald, colors.indigo, lifeRows]);
  const hasCategoryScores = monthlyScores.some((item) => item.value > 0);

  const insightCards = [
    {
      icon: 'restaurant-outline' as const,
      label: 'Nutrition',
      value: loggedCalorieDays ? `${underGoalDays}/${loggedCalorieDays} under goal` : 'No meals logged',
      helper: loggedCalorieDays ? `Avg ${Math.round(average(calorieChart.filter((day) => day.calories > 0).map((day) => day.calories)))} kcal` : 'Log meals to see calorie consistency.',
      color: colors.emerald,
      route: '/(tabs)/nutrition',
    },
    {
      icon: 'barbell-outline' as const,
      label: 'Training',
      value: `${sessionCount} sessions`,
      helper: sessionCount ? `${workoutStreak} day current streak` : 'Complete workouts to reveal consistency.',
      color: colors.amber,
      route: '/(tabs)/gym',
    },
    {
      icon: 'checkmark-done-outline' as const,
      label: 'Tasks',
      value: totalTasks ? `${completedTasks}/${totalTasks} done` : 'No tasks yet',
      helper: totalTasks ? `${Math.round((completedTasks / totalTasks) * 100)}% completion` : 'Add goals to track execution.',
      color: colors.blue,
      route: '/(tabs)/goals',
    },
    {
      icon: 'wallet-outline' as const,
      label: 'Finance',
      value: financeRows.length ? `₹${compactCurrency(financeTotal)}` : 'No spends logged',
      helper: financeTopCategory ? `${financeTopCategory[0]} leads spend` : 'Track expenses to see budget pressure.',
      color: colors.violet,
      route: '/finance',
    },
  ];

  return (
    <AnalyticsThemeContext.Provider value={theme}>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.violetLight} onRefresh={loadAnalytics} />}>
      <View style={styles.header}>
        <Text style={styles.title}>Analytics</Text>
        <View style={styles.periodRow}>
          {PERIODS.map((item) => (
            <TouchableOpacity key={item} activeOpacity={0.8} style={[styles.periodPill, period === item && styles.periodPillActive]} onPress={() => setPeriod(item)}>
              <Text style={[styles.periodText, period === item && styles.periodTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.heroCard}>
        <StatCard value={hasLifeData ? Math.round(currentLifeScore) : '--'} label="Life Score" trend={trendForDelta(scoreDelta)} accentColor={colors.violet} />
        <View style={styles.heroChart}>
          {hasLifeData ? (
            <LineChart data={lifeSeries.map((point, index) => ({ x: index + 1, score: point.value || null }))} series={[{ key: 'score', color: colors.violetLight }]} height={96} />
          ) : (
            <EmptyChart icon="pulse-outline" title="No Life Score snapshots yet" actionLabel="Open Daily Hub" onPress={() => router.push('/(tabs)' as never)} />
          )}
        </View>
        <View style={styles.heroMeta}>
          <Text style={[styles.trendText, scoreDelta < 0 && styles.negativeTrend, scoreDelta === 0 && styles.flatTrend]}>
            {hasLifeData && lastWeekAverage > 0 ? `${scoreDelta > 0 ? '+' : ''}${scoreDelta} pts vs last week` : 'Open Home daily to build score history'}
          </Text>
          <Text style={styles.mutedText}>{hasLifeData ? `Best: ${Math.round(bestScore.value)} (${formatShortDate(bestScore.date)})` : `${period} view`}</Text>
        </View>
      </View>

      <View style={styles.insightGrid}>
        {insightCards.map((item) => (
          <TouchableOpacity key={item.label} activeOpacity={0.84} style={[styles.insightCard, { borderColor: `${item.color}44` }]} onPress={() => router.push(item.route as never)}>
            <View style={[styles.insightIcon, { backgroundColor: `${item.color}22` }]}>
              <Ionicons name={item.icon} size={18} color={item.color} />
            </View>
            <Text style={styles.insightLabel}>{item.label}</Text>
            <Text style={styles.insightValue}>{item.value}</Text>
            <Text style={styles.insightHelper}>{item.helper}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ChartCard accent={colors.emerald} title="Calories" subtitle={loggedCalorieDays ? `${underGoalDays} of ${loggedCalorieDays} logged days under goal` : 'No meal logs in this period'}>
        {loggedCalorieDays ? (
          <>
            <GoalLine ratio={calorieGoal / Math.max(calorieGoal, ...calorieChart.map((day) => day.calories))} />
            <BarChart
              data={calorieChart}
              series={[
                { key: 'under', color: colors.emerald },
                { key: 'over', color: colors.rose },
              ]}
              labelKey="day"
            />
          </>
        ) : (
          <EmptyChart icon="restaurant-outline" title="Log meals to compare calories with your goal" actionLabel="Open Diet" onPress={() => router.push('/(tabs)/nutrition' as never)} />
        )}
      </ChartCard>

      <ChartCard accent={colors.amber} title="Workout Heatmap" subtitle={sessionCount ? `${sessionCount} sessions · ${workoutStreak} day streak` : 'No completed workouts in this period'}>
        {sessionCount ? (
          <View style={styles.heatmapWrap}>
            <HeatmapCalendar days={heatmapDays} weeks={5} color={colors.amber} maxValue={2} today={today} />
          </View>
        ) : (
          <EmptyChart icon="barbell-outline" title="Complete a workout to start the consistency map" actionLabel="Open Gym" onPress={() => router.push('/(tabs)/gym' as never)} />
        )}
      </ChartCard>

      <ChartCard accent={colors.amber} title="Strength Gains" subtitle="Bench / Shoulder / Tricep · 8 weeks">
        {hasStrengthData ? (
          <>
            <View style={styles.legendRow}>
              {muscleSeries.map((item) => <LegendDot key={item.key} color={item.color} label={item.label} />)}
            </View>
            <LineChart
              data={strengthChart.map((week) => ({
                ...week,
                bench: week.bench || null,
                shoulder: week.shoulder || null,
                tricep: week.tricep || null,
              }))}
              series={muscleSeries}
              labelKey="label"
            />
          </>
        ) : (
          <EmptyChart icon="trending-up-outline" title="Log bench, shoulder, or tricep sets to see strength trend" actionLabel="Open Gym" onPress={() => router.push('/(tabs)/gym' as never)} />
        )}
      </ChartCard>

      <ChartCard accent={colors.blue} title="Task Completion" subtitle={totalTasks ? `${completedTasks} of ${totalTasks} tasks completed · 6 weeks` : 'No tasks in this period'}>
        {totalTasks ? (
          <StackedBarChart
            data={taskChart}
            series={[
              { key: 'completed', color: colors.blue },
              { key: 'incomplete', color: colors.border },
            ]}
            labelKey="week"
          />
        ) : (
          <EmptyChart icon="checkmark-done-outline" title="Create goals or daily tasks to measure execution" actionLabel="Open Goals" onPress={() => router.push('/(tabs)/goals' as never)} />
        )}
      </ChartCard>

      <ChartCard accent="#14B8A6" title="Body Weight" subtitle={`Goal ${targetWeight} kg`}>
        {loggedWeights.length ? (
          <>
            <GoalLine ratio={(Math.max(...loggedWeights) - targetWeight) / Math.max(1, Math.max(...loggedWeights) - Math.min(...loggedWeights))} />
            <AreaChart data={weightChart} series={{ key: 'weight', color: '#14B8A6', fill: '#14B8A644' }} />
          </>
        ) : (
          <EmptyChart icon="scale-outline" title="Add body weight after workouts to track progress" actionLabel="Open Gym" onPress={() => router.push('/(tabs)/gym' as never)} />
        )}
      </ChartCard>

      <ChartCard accent={colors.violet} title="Correlation" subtitle={correlationInsight}>
        {canCompareGymDays ? (
          <ScatterChart data={correlationChart} series={{ key: 'score', color: colors.violetLight }} radius={(point) => (point.gym ? 6 : 3)} />
        ) : (
          <EmptyChart icon="git-compare-outline" title="Needs Life Scores on both gym and non-gym days" actionLabel="Open Daily Hub" onPress={() => router.push('/(tabs)' as never)} />
        )}
      </ChartCard>

      <View style={styles.reportCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>Monthly Report</Text>
            <Text style={styles.cardSubtitle}>Category score balance</Text>
          </View>
          <Ionicons name="analytics-outline" size={22} color={colors.violetLight} />
        </View>
        {hasCategoryScores ? (
          <View style={styles.scoreRow}>
            {monthlyScores.map((item) => (
              <View key={item.label} style={styles.scoreItem}>
                <View style={[styles.scoreCircle, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
                  <Text style={styles.scoreValue}>{item.value || '--'}</Text>
                </View>
                <Text style={styles.scoreLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.reportEmpty}>
            <Text style={styles.emptyTitle}>No category scores yet</Text>
            <Text style={styles.emptyText}>Daily Hub creates nutrition, fitness, productivity, hydration, and alignment snapshots for this report.</Text>
          </View>
        )}
      </View>
    </ScrollView>
    </AnalyticsThemeContext.Provider>
  );
}

function ChartCard({ accent, title, subtitle, children }: { accent: string; title: string; subtitle: string; children: ReactNode }) {
  const { styles } = useAnalyticsTheme();

  return (
    <View style={[styles.chartCard, { borderColor: `${accent}55` }]}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
        <View style={[styles.accentIcon, { backgroundColor: `${accent}22` }]} />
      </View>
      <View style={styles.chartBox}>{children}</View>
    </View>
  );
}

function GoalLine({ ratio }: { ratio: number }) {
  const { styles } = useAnalyticsTheme();
  const top = Math.max(12, Math.min(CHART_HEIGHT - 18, (1 - ratio) * CHART_HEIGHT));
  return <View style={[styles.goalLine, { pointerEvents: 'none', top }]} />;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const { styles } = useAnalyticsTheme();

  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function EmptyChart({ icon, title, actionLabel, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; actionLabel: string; onPress: () => void }) {
  const { colors, styles } = useAnalyticsTheme();

  return (
    <View style={styles.emptyChart}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={22} color={colors.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <TouchableOpacity activeOpacity={0.82} style={styles.emptyButton} onPress={onPress}>
        <Text style={styles.emptyButtonText}>{actionLabel}</Text>
        <Ionicons name="arrow-forward" size={14} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

type SvgChartDatum = Record<string, string | number | null | undefined>;
type SvgSeries = { key: string; color: string; label?: string; fill?: string };
type ChartScale = {
  bottom: number;
  left: number;
  plotHeight: number;
  plotWidth: number;
  toX: (index: number, count: number) => number;
  toY: (value: number) => number;
};

function numberValue(value: SvgChartDatum[string]) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectValues(data: SvgChartDatum[], keys: string[], stacked = false) {
  if (stacked) {
    return data.map((row) => keys.reduce((sum, key) => sum + (numberValue(row[key]) ?? 0), 0));
  }

  return data.flatMap((row) => keys.map((key) => numberValue(row[key])).filter((value): value is number => value !== null));
}

function chartScale(data: SvgChartDatum[], keys: string[], height = CHART_HEIGHT, stacked = false): ChartScale {
  const values = collectValues(data, keys, stacked);
  const rawMax = Math.max(1, ...values);
  const rawMin = Math.min(0, ...values);
  const range = rawMax - rawMin || 1;
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.12;
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const left = CHART_PADDING.left;
  const bottom = height - CHART_PADDING.bottom;

  return {
    bottom,
    left,
    plotHeight,
    plotWidth,
    toX: (index, count) => left + (count <= 1 ? plotWidth / 2 : (plotWidth * index) / (count - 1)),
    toY: (value) => CHART_PADDING.top + ((max - value) / (max - min)) * plotHeight,
  };
}

function pathFromPoints(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function ChartGrid({ height = CHART_HEIGHT }: { height?: number }) {
  const { colors } = useAnalyticsTheme();
  const scale = chartScale([], [], height);
  return (
    <>
      {[0, 0.5, 1].map((ratio) => {
        const y = CHART_PADDING.top + scale.plotHeight * ratio;
        return <SvgLine key={ratio} x1={scale.left} x2={scale.left + scale.plotWidth} y1={y} y2={y} stroke={colors.borderLight} strokeWidth={1} />;
      })}
    </>
  );
}

function ChartLabels({ data, labelKey, height = CHART_HEIGHT }: { data: SvgChartDatum[]; labelKey?: string; height?: number }) {
  const { colors } = useAnalyticsTheme();
  if (!labelKey || data.length > 8) return null;
  const scale = chartScale(data, [], height);

  return (
    <>
      {data.map((row, index) => (
        <SvgText key={`${row[labelKey]}-${index}`} x={scale.toX(index, data.length)} y={height - 7} fill={colors.textMuted} fontSize={10} textAnchor="middle">
          {String(row[labelKey] ?? '')}
        </SvgText>
      ))}
    </>
  );
}

function LineChart({ data, series, labelKey, height = CHART_HEIGHT }: { data: SvgChartDatum[]; series: readonly SvgSeries[]; labelKey?: string; height?: number }) {
  const scale = chartScale(data, series.map((item) => item.key), height);

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_WIDTH} ${height}`}>
      <ChartGrid height={height} />
      {series.map((item) => {
        const points = data
          .map((row, index) => {
            const value = numberValue(row[item.key]);
            return value === null ? null : { x: scale.toX(index, data.length), y: scale.toY(value) };
          })
          .filter((point): point is { x: number; y: number } => point !== null);

        return <SvgPath key={item.key} d={pathFromPoints(points)} fill="none" stroke={item.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />;
      })}
      <ChartLabels data={data} labelKey={labelKey} height={height} />
    </Svg>
  );
}

function AreaChart({ data, series }: { data: SvgChartDatum[]; series: SvgSeries }) {
  const scale = chartScale(data, [series.key]);
  const points = data
    .map((row, index) => {
      const value = numberValue(row[series.key]);
      return value === null ? null : { x: scale.toX(index, data.length), y: scale.toY(value) };
    })
    .filter((point): point is { x: number; y: number } => point !== null);
  const linePath = pathFromPoints(points);
  const areaPath = points.length ? `${linePath} L ${points.at(-1)?.x.toFixed(1)} ${scale.bottom} L ${points[0].x.toFixed(1)} ${scale.bottom} Z` : '';

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
      <ChartGrid />
      <SvgPath d={areaPath} fill={series.fill ?? `${series.color}44`} />
      <SvgPath d={linePath} fill="none" stroke={series.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />
    </Svg>
  );
}

function BarChart({ data, series, labelKey }: { data: SvgChartDatum[]; series: SvgSeries[]; labelKey?: string }) {
  const scale = chartScale(data, series.map((item) => item.key));
  const band = scale.plotWidth / Math.max(1, data.length);
  const barWidth = band * 0.62;

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
      <ChartGrid />
      {data.map((row, index) => {
        const item = series.find((entry) => numberValue(row[entry.key]) !== null);
        const value = item ? numberValue(row[item.key]) : null;
        if (!item || value === null) return null;
        const x = scale.left + index * band + (band - barWidth) / 2;
        const y = scale.toY(value);
        return <Rect key={`${item.key}-${index}`} x={x} y={y} width={barWidth} height={scale.bottom - y} rx={5} fill={item.color} />;
      })}
      <ChartLabels data={data} labelKey={labelKey} />
    </Svg>
  );
}

function StackedBarChart({ data, series, labelKey }: { data: SvgChartDatum[]; series: SvgSeries[]; labelKey?: string }) {
  const scale = chartScale(data, series.map((item) => item.key), CHART_HEIGHT, true);
  const band = scale.plotWidth / Math.max(1, data.length);
  const barWidth = band * 0.62;

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
      <ChartGrid />
      {data.map((row, index) => {
        let cumulative = 0;
        return series.map((item) => {
          const value = numberValue(row[item.key]) ?? 0;
          const yTop = scale.toY(cumulative + value);
          const yBottom = scale.toY(cumulative);
          cumulative += value;
          return <Rect key={`${item.key}-${index}`} x={scale.left + index * band + (band - barWidth) / 2} y={yTop} width={barWidth} height={Math.max(0, yBottom - yTop)} rx={item === series.at(-1) ? 5 : 0} fill={item.color} />;
        });
      })}
      <ChartLabels data={data} labelKey={labelKey} />
    </Svg>
  );
}

function ScatterChart({ data, series, radius }: { data: SvgChartDatum[]; series: SvgSeries; radius: (point: SvgChartDatum, index: number) => number }) {
  const scale = chartScale(data, [series.key]);

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
      <ChartGrid />
      {data.map((row, index) => {
        const value = numberValue(row[series.key]);
        if (value === null) return null;
        return <Circle key={index} cx={scale.toX(index, data.length)} cy={scale.toY(value)} r={radius(row, index)} fill={series.color} opacity={0.9} />;
      })}
    </Svg>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  periodRow: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.base,
  },
  periodPill: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flex: 1,
    paddingVertical: spacing.xs,
  },
  periodPillActive: {
    backgroundColor: colors.violet,
  },
  periodText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  periodTextActive: {
    color: colors.textPrimary,
  },
  heroCard: {
    backgroundColor: colors.surface1,
    borderColor: `${colors.violet}55`,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
    ...shadows.ambient,
  },
  heroChart: {
    height: 96,
  },
  heroMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendText: {
    ...typography.labelCaps,
    color: colors.emeraldLight,
  },
  negativeTrend: {
    color: colors.rose,
  },
  flatTrend: {
    color: colors.textSecondary,
  },
  mutedText: {
    ...typography.body,
    color: colors.textMuted,
  },
  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  insightCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.card,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    gap: spacing.base,
    minHeight: 126,
    padding: spacing.sm,
  },
  insightIcon: {
    alignItems: 'center',
    borderRadius: radii.inner,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  insightLabel: {
    ...typography.labelCaps,
    color: colors.textMuted,
  },
  insightValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  insightHelper: {
    ...typography.body,
    color: colors.textSecondary,
  },
  chartCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    ...typography.labelCaps,
    color: colors.textPrimary,
    textTransform: 'uppercase',
  },
  cardSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  accentIcon: {
    borderRadius: 6,
    height: 18,
    width: 18,
  },
  chartBox: {
    height: CHART_HEIGHT,
    position: 'relative',
  },
  heatmapWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.base,
  },
  legendDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  legendText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  goalLine: {
    borderColor: colors.textMuted,
    borderStyle: 'dashed',
    borderTopWidth: 1,
    left: 8,
    opacity: 0.8,
    position: 'absolute',
    right: 8,
    zIndex: 3,
  },
  emptyChart: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.base,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emptyButtonText: {
    ...typography.labelCaps,
    color: colors.textPrimary,
  },
  reportCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  scoreItem: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  scoreCircle: {
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 2,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  scoreValue: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  scoreLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  reportEmpty: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  });
}
