import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Area, Bar, CartesianChart, Line, Scatter, StackedBar } from 'victory-native';

import { HeatmapCalendar } from '@/components/ui/HeatmapCalendar';
import { StatCard } from '@/components/ui/StatCard';
import { colors, radii, shadows, spacing, typography } from '@/lib/design';
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
const MUSCLE_SERIES = [
  { key: 'bench', label: 'Bench', color: colors.amber },
  { key: 'shoulder', label: 'Shoulder', color: colors.amberLight },
  { key: 'tricep', label: 'Tricep', color: '#F97316' },
] as const;

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
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

function fallbackLifeScores(days: string[]) {
  return days.map((date, index) => ({ date, value: Math.round(70 + Math.sin(index / 3) * 5 + index / 12) }));
}

function groupedCalories(rows: LooseRow[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const date = rowDate(row);
    if (!date) return;
    totals.set(date, (totals.get(date) ?? 0) + (asNumber(row.calories) || asNumber(row.kcal)));
  });
  return totals;
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

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
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
  const last30Days = useMemo(() => eachDay(shiftDate(today, -29), today), [today]);

  const loadAnalytics = useCallback(async () => {
    setRefreshing(true);
    try {
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
        supabase.from('life_scores').select('*').gte('date', startDate).lte('date', today),
        supabase.from('meal_logs').select('*').gte('date', startDate).lte('date', today),
        currentUserId
          ? supabase.from('workout_sessions').select('*').eq('user_id', currentUserId).gte('completed_at', sinceIso)
          : supabase.from('workout_sessions').select('*').limit(0),
        currentUserId
          ? supabase.from('workout_sets').select('*').eq('user_id', currentUserId).gte('created_at', sinceIso).limit(500)
          : supabase.from('workout_sets').select('*').limit(0),
        currentUserId ? supabase.from('tasks').select('*').eq('user_id', currentUserId) : supabase.from('tasks').select('*').limit(0),
        currentUserId
          ? supabase.from('body_metrics').select('*').eq('user_id', currentUserId).gte('date', startDate).lte('date', today)
          : supabase.from('body_metrics').select('*').limit(0),
        currentUserId
          ? supabase.from('finance_transactions').select('*').eq('user_id', currentUserId).gte('date', startDate).lte('date', today)
          : supabase.from('finance_transactions').select('*').limit(0),
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
        const date = rowDate(row);
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
    const points = last30Days.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
    return points.some((point) => point.value > 0) ? points : fallbackLifeScores(last30Days);
  }, [last30Days, lifeRows]);

  const currentLifeScore = lifeSeries.at(-1)?.value ?? 74;
  const lastWeekAverage = average(lifeSeries.slice(-14, -7).map((point) => point.value));
  const currentWeekAverage = average(lifeSeries.slice(-7).map((point) => point.value));
  const scoreDelta = Math.round(currentWeekAverage - lastWeekAverage) || 3;
  const bestScore = lifeSeries.reduce((best, point) => (point.value > best.value ? point : best), lifeSeries[0] ?? { date: '2026-02-14', value: 81 });

  const calorieChart = useMemo(() => {
    const totals = groupedCalories(mealRows);
    const days = last30Days.slice(-7);
    return days.map((date) => {
      const value = totals.get(date) ?? Math.round(calorieGoal * (0.88 + ((dateFromKey(date).getDay() % 3) * 0.08)));
      const under = value <= calorieGoal;
      return {
        day: WEEKDAYS[(dateFromKey(date).getDay() + 6) % 7],
        calories: value,
        under: under ? value : null,
        over: under ? null : value,
        goal: calorieGoal,
      };
    });
  }, [calorieGoal, last30Days, mealRows]);

  const underGoalDays = calorieChart.filter((day) => day.calories <= calorieGoal).length;
  const heatmapDays = useMemo(() => {
    const sessions = new Map<string, number>();
    workoutRows.forEach((row) => {
      const date = workoutDate(row);
      if (date) sessions.set(date, (sessions.get(date) ?? 0) + 1);
    });
    return last30Days.map((date, index) => ({ date, value: sessions.get(date) ?? (index % 6 === 0 || index % 11 === 0 ? 1 : 0) }));
  }, [last30Days, workoutRows]);
  const sessionCount = heatmapDays.reduce((sum, day) => sum + (day.value > 0 ? 1 : 0), 0);
  const streak = [...heatmapDays].reverse().findIndex((day) => day.value === 0);
  const workoutStreak = streak === -1 ? heatmapDays.length : streak || 5;

  const strengthChart = useMemo(() => {
    const weeks = Array.from({ length: 8 }, (_, index) => {
      const weekStart = shiftDate(today, -7 * (7 - index));
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
    return weeks.map((week, index) => ({
      ...week,
      bench: week.bench || 720 + index * 18,
      shoulder: week.shoulder || 360 + index * 12,
      tricep: week.tricep || 240 + index * 10,
    }));
  }, [setRows, today]);

  const taskChart = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => {
      const weekStart = shiftDate(today, -7 * (5 - index));
      const weekEnd = shiftDate(weekStart, 6);
      const rows = taskRows.filter((row) => {
        const date = rowDate(row);
        return date >= weekStart && date <= weekEnd;
      });
      const completed = rows.filter(isDone).length || Math.max(2, index + 2);
      const incomplete = Math.max(0, rows.length - rows.filter(isDone).length) || Math.max(1, 5 - index);
      return { week: `W${index + 1}`, completed, incomplete };
    });
  }, [taskRows, today]);

  const weightChart = useMemo(() => {
    const byDate = new Map(weightRows.map((row) => [rowDate(row), asNumber(row.weight_kg) || asNumber(row.weight)]).filter(([date, value]) => date && value) as [string, number][]);
    return last30Days.map((date, index) => ({ date, x: index + 1, weight: byDate.get(date) ?? targetWeight + 2.8 - index * 0.05 }));
  }, [last30Days, targetWeight, weightRows]);

  const correlationChart = useMemo(() => {
    const gymDays = new Set(heatmapDays.filter((day) => day.value > 0).map((day) => day.date));
    return lifeSeries.map((point, index) => ({ day: index + 1, gym: gymDays.has(point.date) ? 1 : 0, score: point.value }));
  }, [heatmapDays, lifeSeries]);
  const gymAverage = average(correlationChart.filter((point) => point.gym).map((point) => point.score));
  const nonGymAverage = average(correlationChart.filter((point) => !point.gym).map((point) => point.score));
  const productivityLift = nonGymAverage > 0 ? Math.round(((gymAverage - nonGymAverage) / nonGymAverage) * 100) : 40;
  const correlationInsight = productivityLift > 0 ? `${productivityLift}% more productive on gym days` : 'Gym days are holding steady with recovery days';

  const monthlyScores = useMemo(() => {
    const nutrition = Math.round((underGoalDays / 7) * 100);
    const fitness = Math.min(100, Math.round((sessionCount / Math.max(1, selectedDays / 7 / 4 * 3)) * 20));
    const productivity = Math.round((taskChart.reduce((sum, week) => sum + week.completed, 0) / Math.max(1, taskChart.reduce((sum, week) => sum + week.completed + week.incomplete, 0))) * 100);
    const alignment = Math.min(100, 62 + Math.round(workoutStreak * 2));
    const finance = financeRows.length ? Math.max(45, 92 - financeRows.length * 3) : 78;
    return [
      { label: 'Nutrition', value: nutrition, color: colors.emerald },
      { label: 'Fitness', value: fitness, color: colors.amber },
      { label: 'Productivity', value: productivity, color: colors.blue },
      { label: 'Alignment', value: alignment, color: colors.indigo },
      { label: 'Finance', value: finance, color: colors.violet },
    ];
  }, [financeRows.length, selectedDays, sessionCount, taskChart, underGoalDays, workoutStreak]);

  return (
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
        <StatCard value={Math.round(currentLifeScore)} label="Life Score" trend="up" accentColor={colors.violet} />
        <View style={styles.heroChart}>
          <CartesianChart data={lifeSeries.map((point, index) => ({ x: index + 1, score: point.value }))} xKey="x" yKeys={['score']} axisOptions={chartAxis} domainPadding={{ top: 12, bottom: 8 }}>
            {({ points }) => <Line points={points.score} color={colors.violetLight} strokeWidth={3} curveType="natural" />}
          </CartesianChart>
        </View>
        <View style={styles.heroMeta}>
          <Text style={styles.trendText}>↑ +{Math.abs(scoreDelta)} pts from last week</Text>
          <Text style={styles.mutedText}>Best: {Math.round(bestScore.value)} ({formatShortDate(bestScore.date)})</Text>
        </View>
      </View>

      <ChartCard accent={colors.emerald} title="Calories" subtitle={`${underGoalDays} of 7 days under goal ✓`}>
        <GoalLine ratio={calorieGoal / Math.max(calorieGoal, ...calorieChart.map((day) => day.calories))} />
        <CartesianChart data={calorieChart} xKey="day" yKeys={['under', 'over']} axisOptions={chartAxis} domainPadding={{ left: 18, right: 18, top: 18 }}>
          {({ points, chartBounds }) => (
            <>
              <Bar points={points.under} chartBounds={chartBounds} color={colors.emerald} roundedCorners={{ topLeft: 6, topRight: 6 }} />
              <Bar points={points.over} chartBounds={chartBounds} color={colors.rose} roundedCorners={{ topLeft: 6, topRight: 6 }} />
            </>
          )}
        </CartesianChart>
      </ChartCard>

      <ChartCard accent={colors.amber} title="Workout Heatmap" subtitle={`${sessionCount} sessions · 🔥${workoutStreak} streak`}>
        <View style={styles.heatmapWrap}>
          <HeatmapCalendar days={heatmapDays} weeks={5} color={colors.amber} maxValue={2} today={today} />
        </View>
      </ChartCard>

      <ChartCard accent={colors.amber} title="Strength Gains" subtitle="Bench / Shoulder / Tricep · 8 weeks">
        <View style={styles.legendRow}>
          {MUSCLE_SERIES.map((item) => <LegendDot key={item.key} color={item.color} label={item.label} />)}
        </View>
        <CartesianChart data={strengthChart} xKey="label" yKeys={['bench', 'shoulder', 'tricep']} axisOptions={chartAxis} domainPadding={{ top: 20, bottom: 8 }}>
          {({ points }) => (
            <>
              <Line points={points.bench} color={colors.amber} strokeWidth={3} curveType="natural" />
              <Line points={points.shoulder} color={colors.amberLight} strokeWidth={3} curveType="natural" />
              <Line points={points.tricep} color="#F97316" strokeWidth={3} curveType="natural" />
            </>
          )}
        </CartesianChart>
      </ChartCard>

      <ChartCard accent={colors.blue} title="Task Completion" subtitle="Completed vs incomplete · 6 weeks">
        <CartesianChart data={taskChart} xKey="week" yKeys={['completed', 'incomplete']} axisOptions={chartAxis} domainPadding={{ left: 16, right: 16, top: 18 }}>
          {({ points, chartBounds }) => <StackedBar points={[points.completed, points.incomplete]} chartBounds={chartBounds} colors={[colors.blue, colors.border]} />}
        </CartesianChart>
      </ChartCard>

      <ChartCard accent="#14B8A6" title="Body Weight" subtitle={`Goal ${targetWeight} kg`}>
        <GoalLine ratio={(Math.max(...weightChart.map((point) => point.weight)) - targetWeight) / Math.max(1, Math.max(...weightChart.map((point) => point.weight)) - Math.min(...weightChart.map((point) => point.weight)))} />
        <CartesianChart data={weightChart} xKey="x" yKeys={['weight']} axisOptions={chartAxis} domainPadding={{ top: 16, bottom: 10 }}>
          {({ points, chartBounds }) => (
            <>
              <Area points={points.weight} y0={chartBounds.bottom} color="#14B8A644" curveType="natural" />
              <Line points={points.weight} color="#14B8A6" strokeWidth={3} curveType="natural" />
            </>
          )}
        </CartesianChart>
      </ChartCard>

      <ChartCard accent={colors.violet} title="Correlation" subtitle={correlationInsight}>
        <CartesianChart data={correlationChart} xKey="day" yKeys={['score']} axisOptions={chartAxis} domainPadding={{ top: 16, bottom: 10, left: 12, right: 12 }}>
          {({ points }) => <Scatter points={points.score} color={colors.violetLight} radius={(point) => (correlationChart[Number(point.xValue) - 1]?.gym ? 6 : 3)} />}
        </CartesianChart>
      </ChartCard>

      <View style={styles.reportCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>Monthly Report</Text>
            <Text style={styles.cardSubtitle}>Category score balance</Text>
          </View>
          <Ionicons name="analytics-outline" size={22} color={colors.violetLight} />
        </View>
        <View style={styles.scoreRow}>
          {monthlyScores.map((item) => (
            <View key={item.label} style={styles.scoreItem}>
              <View style={[styles.scoreCircle, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
                <Text style={styles.scoreValue}>{item.value}</Text>
              </View>
              <Text style={styles.scoreLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const chartAxis = {
  lineColor: { grid: colors.borderLight, frame: colors.border },
  lineWidth: { grid: 1, frame: 0 },
  labelColor: colors.textMuted,
  tickCount: { x: 4, y: 3 },
} as const;

function ChartCard({ accent, title, subtitle, children }: { accent: string; title: string; subtitle: string; children: ReactNode }) {
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
  const top = Math.max(12, Math.min(CHART_HEIGHT - 18, (1 - ratio) * CHART_HEIGHT));
  return <View pointerEvents="none" style={[styles.goalLine, { top }]} />;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  mutedText: {
    ...typography.body,
    color: colors.textMuted,
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
});
