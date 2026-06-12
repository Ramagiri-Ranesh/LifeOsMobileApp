import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeatmapCalendar } from '@/components/ui/HeatmapCalendar';
import { calculateStreak } from '@/lib/calculations';
import { colors, radii, shadows, spacing, typography } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;
type FrequencyType = 'daily' | 'xPerWeek';
type Routine = 'morning' | 'night' | 'anytime';

type Habit = {
  id: string;
  name: string;
  category: string;
  frequencyType: FrequencyType;
  frequencyCount: number;
  frequencyLabel: string;
  reminderTime: string;
  routine: Routine;
  streak: number;
  restDayIndexes: number[];
  source?: LooseRow;
};

type HabitLog = {
  id: string;
  habitId: string;
  date: string;
};

type HabitDraft = {
  name: string;
  frequencyType: FrequencyType;
  frequencyCount: string;
  category: string;
  reminderTime: string;
};

const TODAY = dateKey(new Date());
const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABEL = new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date());

const FALLBACK_HABITS: Habit[] = [
  habitFromRow({ id: 'morning-water', name: 'Water after waking', frequency: 'daily', category: 'morning', reminder_time: '06:45' }, 0),
  habitFromRow({ id: 'morning-journal', name: 'Journal one page', frequency: 'daily', category: 'morning', reminder_time: '07:00' }, 1),
  habitFromRow({ id: 'morning-workout', name: 'Gym session', frequency: '4x/week', category: 'fitness', reminder_time: '07:30', rest_day: 'Sunday' }, 2),
  habitFromRow({ id: 'morning-protein', name: 'Protein breakfast', frequency: 'daily', category: 'morning', reminder_time: '08:15' }, 3),
  habitFromRow({ id: 'morning-steps', name: 'First 2k steps', frequency: 'daily', category: 'morning', reminder_time: '08:45' }, 4),
  habitFromRow({ id: 'focus-deepwork', name: 'Deep work block', frequency: '5x/week', category: 'work', reminder_time: '10:00' }, 5),
  habitFromRow({ id: 'focus-water', name: 'Refill bottle', frequency: 'daily', category: 'health', reminder_time: '12:00' }, 6),
  habitFromRow({ id: 'fitness-mobility', name: 'Mobility reset', frequency: '4x/week', category: 'fitness', reminder_time: '18:30' }, 7),
  habitFromRow({ id: 'night-screen', name: 'No screens wind-down', frequency: 'daily', category: 'night', reminder_time: '21:00' }, 8),
  habitFromRow({ id: 'night-read', name: 'Read 10 pages', frequency: 'daily', category: 'night', reminder_time: '21:30' }, 9),
  habitFromRow({ id: 'night-plan', name: 'Plan tomorrow', frequency: 'daily', category: 'night', reminder_time: '22:00' }, 10),
  habitFromRow({ id: 'night-sleep', name: 'Lights out on time', frequency: 'daily', category: 'night', reminder_time: '22:45' }, 11),
];

function dateKey(date: Date) {
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
  const next = dateFromKey(key);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowId(row: LooseRow, fallback: string) {
  return asText(row.id) || asText(row.habit_id) || fallback;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function localLog(habit: Habit): HabitLog {
  return { id: `local-${habit.id}-${TODAY}`, habitId: habit.id, date: TODAY };
}

function weekdayIndex(date: string) {
  return (dateFromKey(date).getDay() + 6) % 7;
}

function routineFromRow(row: LooseRow): Routine {
  const value = `${asText(row.routine)} ${asText(row.stack)} ${asText(row.category)}`.toLowerCase();
  if (value.includes('night') || value.includes('sleep') || value.includes('evening')) return 'night';
  if (value.includes('morning')) return 'morning';

  const hour = Number(asText(row.reminder_time).slice(0, 2));
  if (Number.isFinite(hour)) return hour >= 18 ? 'night' : 'morning';
  return 'anytime';
}

function frequencyFromRow(row: LooseRow) {
  const raw = `${asText(row.frequency) || asText(row.frequency_type) || 'daily'}`.toLowerCase();
  const count = asNumber(row.frequency_count) || asNumber(row.times_per_week) || Number(raw.match(/\d+/)?.[0]) || 7;
  const frequencyType: FrequencyType = raw.includes('week') || count < 7 ? 'xPerWeek' : 'daily';
  return {
    frequencyType,
    frequencyCount: frequencyType === 'daily' ? 7 : Math.max(1, Math.min(7, count)),
    frequencyLabel: frequencyType === 'daily' ? 'Daily' : `${Math.max(1, Math.min(7, count))}x/week`,
  };
}

function restDaysFromRow(row: LooseRow) {
  const value = `${asText(row.rest_day)} ${asText(row.rest_days)} ${asText(row.category)} ${asText(row.name)}`.toLowerCase();
  return value.includes('sunday') || value.includes('gym') ? [0] : [];
}

function habitFromRow(row: LooseRow, index: number, logs: HabitLog[] = []): Habit {
  const frequency = frequencyFromRow(row);
  const id = rowId(row, `habit-${index}`);
  const completedDates = logs.filter((log) => log.habitId === id).map((log) => log.date);
  const restDayIndexes = restDaysFromRow(row);
  return {
    id,
    name: asText(row.name) || asText(row.title, 'Habit'),
    category: asText(row.category, 'Lifestyle'),
    reminderTime: asText(row.reminder_time) || asText(row.reminderTime, ''),
    routine: routineFromRow(row),
    restDayIndexes,
    streak: calculateStreak(completedDates, new Date(), { restDayIndexes }),
    source: row,
    ...frequency,
  };
}

function logFromRow(row: LooseRow, index: number): HabitLog | null {
  const date = asText(row.date) || asText(row.log_date) || asText(row.completed_at).slice(0, 10) || asText(row.created_at).slice(0, 10);
  const habitId = asText(row.habit_id) || asText(row.habitId);
  if (!date || !habitId) return null;
  return { id: rowId(row, `log-${index}`), habitId, date };
}

function buildHeatmapDays(logs: HabitLog[]) {
  const counts = new Map<string, number>();
  logs.forEach((log) => counts.set(log.date, (counts.get(log.date) ?? 0) + 1));
  const start = shiftDate(TODAY, -83);
  return Array.from({ length: 84 }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, value: counts.get(date) ?? 0 };
  });
}

function buildWeekDates() {
  return Array.from({ length: 7 }, (_, index) => shiftDate(TODAY, index - 6));
}

function bestDaysFromAnalytics(values: number[]) {
  const best = Math.max(...values);
  if (best <= 0) return 'No clear best day yet';
  return `Best days: ${values
    .map((value, index) => ({ value, label: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(dateFromWeekday(index)) }))
    .filter((item) => item.value === best)
    .slice(0, 2)
    .map((item) => item.label)
    .join(', ')}`;
}

function dateFromWeekday(mondayIndex: number) {
  const monday = dateFromKey('2024-01-01');
  monday.setDate(monday.getDate() + mondayIndex);
  return monday;
}

function HabitStack({ title, habits, completedToday }: { title: string; habits: Habit[]; completedToday: Set<string> }) {
  const stackHabits = habits.length ? habits : [];

  return (
    <View style={styles.stackCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta}>{stackHabits.filter((habit) => completedToday.has(habit.id)).length}/{stackHabits.length}</Text>
      </View>
      <View style={styles.stackLineWrap}>
        <View style={styles.stackLine} />
        {stackHabits.map((habit) => {
          const done = completedToday.has(habit.id);
          return (
            <View key={habit.id} style={styles.stackStep}>
              <View style={[styles.stackCircle, done && styles.stackCircleDone]}>
                <Ionicons name={done ? 'checkmark' : 'ellipse-outline'} size={14} color={done ? colors.textPrimary : colors.violetLight} />
              </View>
              <Text numberOfLines={2} style={styles.stackLabel}>{habit.name}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function HabitRow({
  habit,
  weekDates,
  logsByHabit,
  completedToday,
  onToggle,
  onDelete,
  onDone,
}: {
  habit: Habit;
  weekDates: string[];
  logsByHabit: Map<string, Set<string>>;
  completedToday: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const history = logsByHabit.get(habit.id) ?? new Set<string>();
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dy) < 12,
        onPanResponderMove: (_, gesture) => {
          translateX.setValue(Math.max(-104, Math.min(104, gesture.dx)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -72) {
            Animated.timing(translateX, { toValue: -112, duration: 140, useNativeDriver: true }).start(onDelete);
            return;
          }
          if (gesture.dx > 72) {
            Animated.timing(translateX, { toValue: 112, duration: 140, useNativeDriver: true }).start(onDone);
            return;
          }
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [onDelete, onDone, translateX],
  );

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.doneRail}>
        <Ionicons name="checkmark" size={19} color={colors.emeraldLight} />
      </View>
      <View style={styles.deleteRail}>
        <Ionicons name="trash-outline" size={19} color={colors.rose} />
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <View style={styles.habitCard}>
          <View style={styles.cardTop}>
            <View style={styles.habitTitleWrap}>
              <Text numberOfLines={1} style={styles.habitName}>{habit.name}</Text>
              <Text style={styles.frequencyTag}>{habit.frequencyLabel}</Text>
            </View>
            <View style={styles.streakBadge}>
              <Text style={styles.streakText}>🔥 {habit.streak}</Text>
            </View>
          </View>
          <View style={styles.cardBottom}>
            <View style={styles.dotRow}>
              {weekDates.map((date) => {
                const isFuture = date > TODAY;
                const complete = history.has(date);
                return <View key={date} style={[styles.dot, complete && styles.dotFilled, isFuture && styles.dotFuture]} />;
              })}
            </View>
            <TouchableOpacity
              accessibilityLabel={completedToday ? 'Mark habit missed today' : 'Mark habit done today'}
              style={[styles.toggleButton, completedToday ? styles.toggleDone : styles.toggleMissed]}
              onPress={onToggle}>
              <Ionicons name={completedToday ? 'checkmark' : 'close'} size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [draft, setDraft] = useState<HabitDraft>({
    name: '',
    frequencyType: 'daily',
    frequencyCount: '4',
    category: 'morning',
    reminderTime: '07:00',
  });

  const visibleHabits = habits.length ? habits : FALLBACK_HABITS;
  const heatmapDays = useMemo(() => buildHeatmapDays(logs), [logs]);
  const weekDates = useMemo(buildWeekDates, []);
  const logsByHabit = useMemo(() => {
    const map = new Map<string, Set<string>>();
    logs.forEach((log) => {
      const dates = map.get(log.habitId) ?? new Set<string>();
      dates.add(log.date);
      map.set(log.habitId, dates);
    });
    return map;
  }, [logs]);
  const completedToday = useMemo(() => new Set(logs.filter((log) => log.date === TODAY).map((log) => log.habitId)), [logs]);
  const globalStreak = useMemo(() => {
    const dates = Array.from(new Set(logs.map((log) => log.date)));
    const hasFlexibleGym = visibleHabits.some((habit) => habit.restDayIndexes.includes(0));
    return calculateStreak(dates, new Date(), { restDayIndexes: hasFlexibleGym ? [0] : [] });
  }, [logs, visibleHabits]);
  const weekdayAverages = useMemo(() => {
    const byDay = Array.from({ length: 7 }, () => ({ done: 0, possible: 0 }));
    heatmapDays.forEach((day) => {
      const index = weekdayIndex(day.date);
      byDay[index].done += Math.min(day.value, visibleHabits.length);
      byDay[index].possible += visibleHabits.length;
    });
    return byDay.map((day) => (day.possible > 0 ? Math.round((day.done / day.possible) * 100) : 0));
  }, [heatmapDays, visibleHabits.length]);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const fromDate = shiftDate(TODAY, -83);
      const [{ data: habitRows }, { data: logRows }] = await Promise.all([
        supabase.from('habits').select('*').order('created_at', { ascending: true }),
        supabase.from('habit_logs').select('*').gte('date', fromDate).order('date', { ascending: true }),
      ]);
      const nextLogs = (logRows ?? []).map((row, index) => logFromRow(row as LooseRow, index)).filter((log): log is HabitLog => Boolean(log));
      setLogs(nextLogs);
      setHabits((habitRows ?? []).map((row, index) => habitFromRow(row as LooseRow, index, nextLogs)));
    } catch (error) {
      console.warn('Unable to load habits', error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveHabit = useCallback(async () => {
    const name = draft.name.trim();
    if (!name) return;
    const frequency = draft.frequencyType === 'daily' ? 'daily' : `${Math.max(1, Math.min(7, Number(draft.frequencyCount) || 1))}x/week`;
    const { data: user } = await supabase.auth.getUser();
    const payload: LooseRow = {
      name,
      frequency,
      frequency_type: draft.frequencyType,
      frequency_count: draft.frequencyType === 'daily' ? 7 : Math.max(1, Math.min(7, Number(draft.frequencyCount) || 1)),
      category: draft.category.trim() || 'Lifestyle',
      reminder_time: draft.reminderTime.trim(),
    };
    if (user.user?.id) payload.user_id = user.user.id;

    const { data, error } = await supabase.from('habits').insert(payload).select().single();
    if (error) {
      console.warn('Unable to create habit', error);
      return;
    }
    if (data) setHabits((items) => [...items, habitFromRow(data as LooseRow, items.length, logs)]);
    setDraft({ name: '', frequencyType: 'daily', frequencyCount: '4', category: 'morning', reminderTime: '07:00' });
    setSheetVisible(false);
  }, [draft, logs]);

  const logHabitDone = useCallback(async (habit: Habit) => {
    if (completedToday.has(habit.id)) return;

    if (!isUuid(habit.id)) {
      setLogs((items) => [...items, localLog(habit)]);
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const payload: LooseRow = { habit_id: habit.id, date: TODAY };
    if (user.user?.id) payload.user_id = user.user.id;
    const { data, error } = await supabase.from('habit_logs').insert(payload).select().single();
    if (error) {
      console.warn('Unable to log habit', error);
      return;
    }
    const nextLog = data ? logFromRow(data as LooseRow, logs.length) : { id: `${habit.id}-${TODAY}`, habitId: habit.id, date: TODAY };
    if (nextLog) setLogs((items) => [...items, nextLog]);
  }, [completedToday, logs.length]);

  const toggleToday = useCallback(async (habit: Habit) => {
    if (!completedToday.has(habit.id)) {
      await logHabitDone(habit);
      return;
    }

    if (!isUuid(habit.id)) {
      setLogs((items) => items.filter((log) => !(log.habitId === habit.id && log.date === TODAY)));
      return;
    }

    const { error } = await supabase.from('habit_logs').delete().eq('habit_id', habit.id).eq('date', TODAY);
    if (error) {
      console.warn('Unable to remove habit log', error);
      return;
    }
    setLogs((items) => items.filter((log) => !(log.habitId === habit.id && log.date === TODAY)));
  }, [completedToday, logHabitDone]);

  const deleteHabit = useCallback(async (habit: Habit) => {
    setHabits((items) => items.filter((item) => item.id !== habit.id));
    setLogs((items) => items.filter((log) => log.habitId !== habit.id));
    if (!isUuid(habit.id)) return;
    await supabase.from('habit_logs').delete().eq('habit_id', habit.id);
    await supabase.from('habits').delete().eq('id', habit.id);
  }, []);

  const morningHabits = visibleHabits.filter((habit) => habit.routine === 'morning');
  const nightHabits = visibleHabits.filter((habit) => habit.routine === 'night');

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData()} tintColor={colors.violetLight} />}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + 126 }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Habits</Text>
            <Text style={styles.month}>{MONTH_LABEL}</Text>
            <Text style={styles.subtitle}>{visibleHabits.length} active · 🔥 {globalStreak || 21}-day streak</Text>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={() => setSheetVisible(true)}>
            <Ionicons name="add" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.heatmapCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Last 12 weeks</Text>
            <Text style={styles.sectionMeta}>Today outlined</Text>
          </View>
          <HeatmapCalendar days={heatmapDays} weeks={12} maxValue={visibleHabits.length} today={TODAY} color={colors.violet} />
        </View>

        <HabitStack title="Morning routine" habits={morningHabits} completedToday={completedToday} />
        <HabitStack title="Night routine" habits={nightHabits} completedToday={completedToday} />

        <View style={styles.analyticsCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Day of week analytics</Text>
            <Text style={styles.sectionMeta}>{bestDaysFromAnalytics(weekdayAverages)}</Text>
          </View>
          <View style={styles.barRow}>
            {weekdayAverages.map((value, index) => (
              <View key={WEEK_LABELS[index]} style={styles.barItem}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${Math.max(6, value)}%` }]} />
                </View>
                <Text style={styles.barLabel}>{WEEK_LABELS[index]}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>All habits</Text>
          <Text style={styles.sectionMeta}>{completedToday.size}/{visibleHabits.length} today</Text>
        </View>
        <FlatList
          data={visibleHabits}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          renderItem={({ item }) => (
            <HabitRow
              habit={item}
              weekDates={weekDates}
              logsByHabit={logsByHabit}
              completedToday={completedToday.has(item.id)}
              onToggle={() => void toggleToday(item)}
              onDone={() => void logHabitDone(item)}
              onDelete={() => void deleteHabit(item)}
            />
          )}
        />
      </ScrollView>

      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 78 }]} onPress={() => setSheetVisible(true)}>
        <Ionicons name="add" size={22} color={colors.textPrimary} />
        <Text style={styles.fabText}>Add habit</Text>
      </TouchableOpacity>

      <Modal visible={sheetVisible} animationType="slide" transparent onRequestClose={() => setSheetVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Add habit</Text>
              <TouchableOpacity onPress={() => setSheetVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={draft.name}
              onChangeText={(name) => setDraft((item) => ({ ...item, name }))}
              placeholder="Name"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <View style={styles.segment}>
              {(['daily', 'xPerWeek'] as FrequencyType[]).map((type) => (
                <Pressable
                  key={type}
                  style={[styles.segmentButton, draft.frequencyType === type && styles.segmentActive]}
                  onPress={() => setDraft((item) => ({ ...item, frequencyType: type }))}>
                  <Text style={[styles.segmentText, draft.frequencyType === type && styles.segmentTextActive]}>
                    {type === 'daily' ? 'Daily' : 'X/week'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {draft.frequencyType === 'xPerWeek' ? (
              <TextInput
                value={draft.frequencyCount}
                onChangeText={(frequencyCount) => setDraft((item) => ({ ...item, frequencyCount }))}
                placeholder="Times per week"
                keyboardType="number-pad"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={draft.category}
              onChangeText={(category) => setDraft((item) => ({ ...item, category }))}
              placeholder="Category"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={draft.reminderTime}
              onChangeText={(reminderTime) => setDraft((item) => ({ ...item, reminderTime }))}
              placeholder="Reminder time"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={() => void saveHabit()}>
              <Text style={styles.primaryButtonText}>Create habit</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { ...typography.stats, color: colors.textPrimary },
  month: { ...typography.body, color: colors.violetLight, marginTop: -spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  headerAction: {
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  heatmapCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  stackCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  sectionTitle: { ...typography.h1, color: colors.textPrimary, fontSize: 18, lineHeight: 24 },
  sectionMeta: { ...typography.labelCaps, color: colors.textSecondary, flexShrink: 1, textAlign: 'right' },
  stackLineWrap: { flexDirection: 'row', gap: spacing.sm, minHeight: 86, position: 'relative' },
  stackLine: {
    backgroundColor: colors.border,
    height: 2,
    left: 18,
    position: 'absolute',
    right: 18,
    top: 17,
  },
  stackStep: { alignItems: 'center', flex: 1, gap: spacing.xs, zIndex: 1 },
  stackCircle: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.violet,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  stackCircleDone: { backgroundColor: colors.violet, borderColor: colors.violetLight },
  stackLabel: { ...typography.labelCaps, color: colors.textSecondary, textAlign: 'center' },
  analyticsCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  barRow: { alignItems: 'flex-end', flexDirection: 'row', gap: spacing.xs, height: 132, justifyContent: 'space-between' },
  barItem: { alignItems: 'center', flex: 1, gap: spacing.xs },
  barTrack: {
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 96,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: 18,
  },
  barFill: { backgroundColor: colors.violet, borderRadius: radii.pill, minHeight: 6, width: '100%' },
  barLabel: { ...typography.labelCaps, color: colors.textMuted, fontSize: 10 },
  listHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  swipeWrap: { borderRadius: radii.card, overflow: 'hidden' },
  doneRail: {
    alignItems: 'flex-start',
    backgroundColor: colors.emeraldBg,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingLeft: spacing.sm,
    position: 'absolute',
    top: 0,
    width: '50%',
  },
  deleteRail: {
    alignItems: 'flex-end',
    backgroundColor: colors.roseBg,
    bottom: 0,
    justifyContent: 'center',
    paddingRight: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '50%',
  },
  habitCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  cardTop: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  habitTitleWrap: { flex: 1, gap: spacing.xs },
  habitName: { ...typography.h1, color: colors.textPrimary, fontSize: 17, lineHeight: 22 },
  frequencyTag: {
    ...typography.labelCaps,
    alignSelf: 'flex-start',
    backgroundColor: colors.violetBg,
    borderColor: `${colors.violet}66`,
    borderRadius: radii.pill,
    borderWidth: 1,
    color: colors.violetLight,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.base,
  },
  streakBadge: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.base,
  },
  streakText: { ...typography.labelCaps, color: colors.textPrimary },
  cardBottom: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  dotRow: { flexDirection: 'row', gap: spacing.xs },
  dot: {
    backgroundColor: 'transparent',
    borderColor: colors.violetLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 12,
    width: 12,
  },
  dotFilled: { backgroundColor: colors.violet, borderColor: colors.violet },
  dotFuture: { backgroundColor: colors.surface2, borderColor: colors.surface2, opacity: 0.55 },
  toggleButton: { alignItems: 'center', borderRadius: radii.pill, height: 36, justifyContent: 'center', width: 36 },
  toggleDone: { backgroundColor: colors.emerald },
  toggleMissed: { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1 },
  fab: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    position: 'absolute',
    ...shadows.ambient,
  },
  fabText: { ...typography.labelCaps, color: colors.textPrimary },
  modalOverlay: { backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: spacing.sm,
    padding: spacing.gutter,
  },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitle: { ...typography.h1, color: colors.textPrimary },
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
  segment: { backgroundColor: colors.surface2, borderRadius: radii.inner, flexDirection: 'row', padding: spacing.base },
  segmentButton: { alignItems: 'center', borderRadius: radii.inner - 2, flex: 1, paddingVertical: spacing.xs },
  segmentActive: { backgroundColor: colors.violet },
  segmentText: { ...typography.labelCaps, color: colors.textSecondary },
  segmentTextActive: { color: colors.textPrimary },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.inner,
    paddingVertical: 14,
  },
  primaryButtonText: { ...typography.labelCaps, color: colors.textPrimary },
});
