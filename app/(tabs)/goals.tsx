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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressRing } from '@/components/ui/ProgressRing';
import { getPatternInsight, getWeeklyReview } from '@/lib/ai';
import { colors, radii, shadows, spacing, typography } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

type GoalsTab = 'week' | 'month' | 'learning' | 'finance';
type GoalCategory = 'learning' | 'work' | 'health';
type GoalStatus = 'On track' | 'Behind';
type LooseRow = Record<string, Json | undefined>;

type WeeklyGoal = {
  id: string;
  category: GoalCategory;
  title: string;
  current: number;
  target: number;
  unit: string;
  subtasks?: string[];
  monthlyGoalId?: string;
};

type MonthlyGoal = {
  id: string;
  title: string;
  progress: number;
  milestones: string[];
  status: GoalStatus;
  weeklyGoalIds: string[];
};

type Book = { id: string; title: string; status: 'currently reading' | 'done' | 'want to read'; progress: number };
type Course = { id: string; title: string; progress: number; minutesToday: number };
type Transaction = { id: string; title: string; category: string; amount: number; note: string; date: string };

const TABS: { id: GoalsTab; label: string }[] = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'learning', label: 'Learning' },
  { id: 'finance', label: 'Finance' },
];

const CATEGORY_META: Record<GoalCategory, { title: string; accent: string; icon: keyof typeof Ionicons.glyphMap }> = {
  learning: { title: 'Learning', accent: colors.indigo, icon: 'book-outline' },
  work: { title: 'Work', accent: colors.blue, icon: 'briefcase-outline' },
  health: { title: 'Health', accent: colors.emerald, icon: 'fitness-outline' },
};

const FALLBACK_WEEKLY: WeeklyGoal[] = [
  { id: 'learn-1', category: 'learning', title: 'Finish React Native module', current: 6, target: 10, unit: 'lessons' },
  { id: 'learn-2', category: 'learning', title: 'Read Atomic Habits', current: 142, target: 220, unit: 'pages' },
  { id: 'work-1', category: 'work', title: 'Ship LifeOS goals screen', current: 3, target: 5, unit: 'milestones', subtasks: ['Wire UI', 'Add cascade'] },
  { id: 'health-1', category: 'health', title: 'Gym sessions', current: 4, target: 5, unit: 'sessions' },
  { id: 'health-2', category: 'health', title: '10k steps', current: 5, target: 7, unit: 'days' },
];

const FALLBACK_MONTHLY: MonthlyGoal[] = [
  { id: 'month-1', title: 'Drop 2 kg while keeping strength', progress: 68, milestones: ['12 gym', '80g protein', 'Steps'], status: 'On track', weeklyGoalIds: [] },
  { id: 'month-2', title: 'Complete TypeScript course', progress: 42, milestones: ['Modules 1-4', 'Project', 'Notes'], status: 'Behind', weeklyGoalIds: [] },
  { id: 'month-3', title: 'Save emergency fund tranche', progress: 76, milestones: ['Budget', 'No-spend weekends'], status: 'On track', weeklyGoalIds: [] },
];

const FALLBACK_BOOKS: Book[] = [
  { id: 'book-1', title: 'Deep Work', status: 'currently reading', progress: 62 },
  { id: 'book-2', title: 'Make It Stick', status: 'want to read', progress: 0 },
  { id: 'book-3', title: 'The Psychology of Money', status: 'done', progress: 100 },
];

const FALLBACK_COURSES: Course[] = [
  { id: 'course-1', title: 'React Native Mastery', progress: 58, minutesToday: 35 },
  { id: 'course-2', title: 'System Design Basics', progress: 24, minutesToday: 20 },
];

const FALLBACK_TRANSACTIONS: Transaction[] = [
  { id: 'txn-1', title: 'Groceries', category: 'Food', amount: 1240, note: 'Weekly staples', date: 'Today' },
  { id: 'txn-2', title: 'Metro card', category: 'Travel', amount: 600, note: 'Top-up', date: 'Yesterday' },
  { id: 'txn-3', title: 'Course subscription', category: 'Learning', amount: 1499, note: 'Monthly', date: 'Jun 8' },
];

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowId(row: LooseRow, fallback: string) {
  const id = row.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : fallback;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function currentWeekNumber(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Number(date) - Number(start) + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

function weekRange(offset: number) {
  const today = new Date();
  const day = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - day + 1 + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  return `${fmt.format(monday)} - ${fmt.format(sunday)}`;
}

function percentage(current: number, target: number) {
  return target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
}

function weeklyFromRow(row: LooseRow, index: number): WeeklyGoal {
  const category = asText(row.category, 'learning').toLowerCase();
  return {
    id: rowId(row, `weekly-${index}`),
    category: category === 'work' || category === 'health' ? category : 'learning',
    title: asText(row.title, 'Weekly goal'),
    current: asNumber(row.current) || asNumber(row.progress_current) || asNumber(row.completed),
    target: asNumber(row.target) || asNumber(row.target_value, 1),
    unit: asText(row.unit, 'of target'),
    monthlyGoalId: asText(row.monthly_goal_id),
  };
}

function monthlyFromRow(row: LooseRow, index: number): MonthlyGoal {
  const rawMilestones = Array.isArray(row.milestones) ? row.milestones : [];
  const progress = asNumber(row.progress) || asNumber(row.progress_percent);
  return {
    id: rowId(row, `monthly-${index}`),
    title: asText(row.title, 'Monthly goal'),
    progress,
    milestones: rawMilestones.map(String).slice(0, 4),
    status: progress < 45 ? 'Behind' : 'On track',
    weeklyGoalIds: [],
  };
}

function bookFromRow(row: LooseRow, index: number): Book {
  const status = asText(row.status, 'want to read').toLowerCase();
  return {
    id: rowId(row, `book-${index}`),
    title: asText(row.title, 'Untitled book'),
    status: status === 'done' || status === 'currently reading' ? status : 'want to read',
    progress: asNumber(row.progress) || asNumber(row.progress_percent),
  };
}

function courseFromRow(row: LooseRow, index: number): Course {
  return {
    id: rowId(row, `course-${index}`),
    title: asText(row.title, 'Course'),
    progress: asNumber(row.progress) || asNumber(row.progress_percent),
    minutesToday: asNumber(row.minutes_today) || asNumber(row.daily_minutes),
  };
}

function transactionFromRow(row: LooseRow, index: number): Transaction {
  return {
    id: rowId(row, `txn-${index}`),
    title: asText(row.title) || asText(row.merchant, 'Transaction'),
    category: asText(row.category, 'General'),
    amount: asNumber(row.amount),
    note: asText(row.note),
    date: asText(row.date) || asText(row.created_at).slice(0, 10),
  };
}

function SwipeGoalRow({
  goal,
  accent,
  onDelete,
  onUpdate,
  onAddSubtask,
}: {
  goal: WeeklyGoal;
  accent: string;
  onDelete: () => void;
  onUpdate: (title: string) => void;
  onAddSubtask?: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal.title);
  const progress = percentage(goal.current, goal.target);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dy) < 12,
        onPanResponderMove: (_, gesture) => {
          translateX.setValue(Math.min(0, Math.max(-96, gesture.dx)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -72) {
            Animated.timing(translateX, { toValue: -110, duration: 140, useNativeDriver: true }).start(onDelete);
            return;
          }
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [onDelete, translateX],
  );

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.deleteRail}>
        <Ionicons name="trash-outline" size={18} color={colors.rose} />
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <Pressable style={styles.goalRow} onPress={() => setEditing(true)}>
          <View style={styles.goalTopLine}>
            {editing ? (
              <TextInput
                autoFocus
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => {
                  onUpdate(draft.trim() || goal.title);
                  setEditing(false);
                }}
                onBlur={() => {
                  onUpdate(draft.trim() || goal.title);
                  setEditing(false);
                }}
                style={styles.inlineInput}
              />
            ) : (
              <Text style={styles.goalTitle}>{goal.title}</Text>
            )}
            <Text style={styles.goalCount}>{goal.current} of {goal.target}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: accent }]} />
          </View>
          <View style={styles.goalMetaLine}>
            <Text style={styles.goalUnit}>{progress}% · {goal.unit}</Text>
            {onAddSubtask ? (
              <TouchableOpacity style={styles.miniAction} onPress={onAddSubtask}>
                <Ionicons name="add" size={14} color={colors.blueLight} />
                <Text style={styles.miniActionText}>Sub-task</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {goal.category === 'health' ? (
            <View style={styles.dotRow}>
              {Array.from({ length: goal.target }).map((_, index) => (
                <View key={index} style={[styles.progressDot, index < goal.current && { backgroundColor: accent }]} />
              ))}
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<GoalsTab>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>(FALLBACK_WEEKLY);
  const [monthlyGoals, setMonthlyGoals] = useState<MonthlyGoal[]>(FALLBACK_MONTHLY);
  const [books, setBooks] = useState<Book[]>(FALLBACK_BOOKS);
  const [courses, setCourses] = useState<Course[]>(FALLBACK_COURSES);
  const [transactions, setTransactions] = useState<Transaction[]>(FALLBACK_TRANSACTIONS);
  const [expanded, setExpanded] = useState<Record<GoalCategory, boolean>>({ learning: true, work: true, health: true });
  const [insight, setInsight] = useState('Your best weeks start with learning before noon, then health goals recover better after work.');
  const [monthlyLetter, setMonthlyLetter] = useState('This month is forming around steady effort: protect the habits that make progress automatic.');
  const [addVisible, setAddVisible] = useState(false);
  const [financeVisible, setFinanceVisible] = useState(false);
  const [newGoal, setNewGoal] = useState({ category: 'learning' as GoalCategory, title: '', target: '5' });
  const [newTxn, setNewTxn] = useState({ amount: '', category: 'Food', note: '' });

  useEffect(() => {
    let mounted = true;

    async function loadTables() {
      const [weeklyResult, monthlyResult, bookResult, courseResult, txnResult] = await Promise.all([
        supabase.from('weekly_goals').select('*').limit(30),
        supabase.from('monthly_goals').select('*').limit(12),
        supabase.from('learning_books').select('*').limit(30),
        supabase.from('learning_courses').select('*').limit(30),
        supabase.from('finance_transactions').select('*').order('created_at', { ascending: false }).limit(20),
      ]);

      if (!mounted) return;
      if (weeklyResult.data?.length) setWeeklyGoals(weeklyResult.data.map((row, index) => weeklyFromRow(row as LooseRow, index)));
      if (monthlyResult.data?.length) setMonthlyGoals(monthlyResult.data.map((row, index) => monthlyFromRow(row as LooseRow, index)));
      if (bookResult.data?.length) setBooks(bookResult.data.map((row, index) => bookFromRow(row as LooseRow, index)));
      if (courseResult.data?.length) setCourses(courseResult.data.map((row, index) => courseFromRow(row as LooseRow, index)));
      if (txnResult.data?.length) setTransactions(txnResult.data.map((row, index) => transactionFromRow(row as LooseRow, index)));
    }

    void loadTables();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadAi() {
      try {
        const [pattern, review] = await Promise.all([getPatternInsight(), getWeeklyReview()]);
        if (mounted) {
          setInsight(pattern.trim().split('\n')[0] || insight);
          setMonthlyLetter(review.trim().split('\n').slice(0, 2).join(' ') || monthlyLetter);
        }
      } catch (error) {
        console.warn('Unable to load goal AI cards', error);
      }
    }
    void loadAi();
    return () => {
      mounted = false;
    };
  }, []);

  const groupedGoals = useMemo(
    () =>
      weeklyGoals.reduce<Record<GoalCategory, WeeklyGoal[]>>(
        (groups, goal) => ({ ...groups, [goal.category]: [...groups[goal.category], goal] }),
        { learning: [], work: [], health: [] },
      ),
    [weeklyGoals],
  );

  const monthProgress = useMemo(
    () => Math.round(monthlyGoals.reduce((total, goal) => total + goal.progress, 0) / Math.max(1, monthlyGoals.length)),
    [monthlyGoals],
  );
  const spent = transactions.reduce((total, txn) => total + txn.amount, 0);
  const budget = 45000;
  const readingDone = books.filter((book) => book.status === 'done').length;
  const totalLearningMinutes = courses.reduce((total, course) => total + course.minutesToday, 0);
  const currentMonth = new Date();
  const currentMonthLabel = new Intl.DateTimeFormat('en', { month: 'long' }).format(currentMonth);
  const currentMonthDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const monthGridOffset = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const calendarCells = Array.from({ length: Math.ceil((monthGridOffset + currentMonthDays) / 7) * 7 });
  const categoryTotals = useMemo(() => {
    const totals = transactions.reduce<Record<string, number>>((groups, txn) => {
      groups[txn.category] = (groups[txn.category] ?? 0) + txn.amount;
      return groups;
    }, {});
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [transactions]);

  const saveGoal = useCallback(async () => {
    if (!newGoal.title.trim()) return;
    const goal: WeeklyGoal = {
      id: `local-${Date.now()}`,
      category: newGoal.category,
      title: newGoal.title.trim(),
      current: 0,
      target: Math.max(1, Number(newGoal.target) || 1),
      unit: newGoal.category === 'health' ? 'days' : 'items',
    };
    setWeeklyGoals((items) => [goal, ...items]);
    setAddVisible(false);
    setNewGoal({ category: 'learning', title: '', target: '5' });
    await supabase.from('weekly_goals').insert({
      title: goal.title,
      category: goal.category,
      current: goal.current,
      target: goal.target,
      unit: goal.unit,
      week_start: dateKey(new Date()),
    });
  }, [newGoal]);

  const breakIntoWeek = useCallback(async (monthlyGoal: MonthlyGoal) => {
    const weeklyGoal: WeeklyGoal = {
      id: `cascade-${Date.now()}`,
      category: 'work',
      title: `Weekly push: ${monthlyGoal.title}`,
      current: 0,
      target: 3,
      unit: 'milestones',
      monthlyGoalId: monthlyGoal.id,
    };
    setWeeklyGoals((items) => [weeklyGoal, ...items]);
    setMonthlyGoals((items) =>
      items.map((goal) =>
        goal.id === monthlyGoal.id ? { ...goal, weeklyGoalIds: [...goal.weeklyGoalIds, weeklyGoal.id] } : goal,
      ),
    );
    await supabase.from('weekly_goals').insert({
      title: weeklyGoal.title,
      category: weeklyGoal.category,
      target: weeklyGoal.target,
      current: 0,
      monthly_goal_id: monthlyGoal.id,
      week_start: dateKey(new Date()),
    });
  }, []);

  const saveTransaction = useCallback(async () => {
    const amount = Number(newTxn.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const txn: Transaction = {
      id: `local-txn-${Date.now()}`,
      title: newTxn.note || newTxn.category,
      category: newTxn.category,
      amount,
      note: newTxn.note,
      date: 'Today',
    };
    setTransactions((items) => [txn, ...items]);
    setFinanceVisible(false);
    setNewTxn({ amount: '', category: 'Food', note: '' });
    await supabase.from('finance_transactions').insert({ amount, category: txn.category, note: txn.note, title: txn.title });
  }, [newTxn]);

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

  const renderWeekly = () => (
    <>
      <View style={styles.weekCard}>
        <View style={styles.weekCopy}>
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
        <ProgressRing progress={68} size={116} strokeWidth={10} color={colors.violet} arcDegrees={250}>
          <Text style={styles.ringValue}>68%</Text>
          <Text style={styles.ringLabel}>week</Text>
        </ProgressRing>
      </View>
      <View style={styles.activityStrip}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <View key={`${day}-${index}`} style={styles.dayColumn}>
            <Text style={styles.dayLabel}>{day}</Text>
            <View style={styles.domainDots}>
              {[colors.indigo, colors.blue, colors.emerald].map((color, dot) => (
                <View key={color} style={[styles.domainDot, { backgroundColor: index + dot < 8 ? color : colors.surface3 }]} />
              ))}
            </View>
          </View>
        ))}
      </View>
      {(['learning', 'work', 'health'] as GoalCategory[]).map((category) => {
        const meta = CATEGORY_META[category];
        return (
          <View key={category} style={styles.sectionCard}>
            <TouchableOpacity style={styles.categoryHeader} onPress={() => setExpanded((state) => ({ ...state, [category]: !state[category] }))}>
              <View style={[styles.categoryIcon, { backgroundColor: `${meta.accent}24` }]}>
                <Ionicons name={meta.icon} size={18} color={meta.accent} />
              </View>
              <Text style={styles.sectionTitle}>{meta.title}</Text>
              <Ionicons name={expanded[category] ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            {expanded[category] ? (
              <View style={styles.goalList}>
                {groupedGoals[category].map((goal) => (
                  <SwipeGoalRow
                    key={goal.id}
                    goal={goal}
                    accent={meta.accent}
                    onDelete={() => setWeeklyGoals((items) => items.filter((item) => item.id !== goal.id))}
                    onUpdate={(title) => setWeeklyGoals((items) => items.map((item) => (item.id === goal.id ? { ...item, title } : item)))}
                    onAddSubtask={
                      category === 'work'
                        ? () =>
                            setWeeklyGoals((items) =>
                              items.map((item) =>
                                item.id === goal.id
                                  ? { ...item, subtasks: [...(item.subtasks ?? []), `Sub-task ${(item.subtasks?.length ?? 0) + 1}`] }
                                  : item,
                              ),
                            )
                        : undefined
                    }
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={styles.aiCard}>
        <Ionicons name="sparkles" size={18} color={colors.violetLight} />
        <View style={styles.aiCopy}>
          <Text style={styles.aiLabel}>AI Insight</Text>
          <Text style={styles.aiText}>{insight}</Text>
        </View>
      </View>
    </>
  );

  const renderMonthly = () => (
    <>
      <View style={styles.calendarCard}>
        <View style={styles.monthHeader}>
          <Text style={styles.sectionTitle}>{currentMonthLabel} Calendar</Text>
          <Text style={styles.statLine}>12 gym sessions · 8/12 diet goals</Text>
        </View>
        <View style={styles.calendarGrid}>
          {calendarCells.map((_, index) => {
            const dayNumber = index - monthGridOffset + 1;
            const isMonthDay = dayNumber >= 1 && dayNumber <= currentMonthDays;
            return (
              <View key={index} style={styles.calendarCell}>
                <Text style={styles.calendarDate}>{isMonthDay ? dayNumber : ''}</Text>
                {isMonthDay ? (
                <View style={styles.calendarDots}>
                  {[colors.emerald, colors.indigo, colors.amber].slice(0, (dayNumber % 3) + 1).map((color) => (
                    <View key={color} style={[styles.calendarDot, { backgroundColor: color }]} />
                  ))}
                </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      <Text style={styles.blockTitle}>Big Goals</Text>
      {monthlyGoals.map((goal) => (
        <View key={goal.id} style={styles.monthGoalCard}>
          <View style={styles.monthGoalTop}>
            <Text style={styles.goalTitle}>{goal.title}</Text>
            <View style={[styles.statusBadge, goal.status === 'Behind' && styles.statusBehind]}>
              <Text style={styles.statusText}>{goal.status}</Text>
            </View>
          </View>
          <ProgressRing progress={goal.progress} size={78} strokeWidth={7} color={goal.status === 'Behind' ? colors.amber : colors.violet}>
            <Text style={styles.smallRingValue}>{Math.round(goal.progress)}%</Text>
          </ProgressRing>
          <View style={styles.milestoneRow}>
            {goal.milestones.map((milestone) => (
              <View key={milestone} style={styles.milestonePill}>
                <Text style={styles.milestoneText}>{milestone}</Text>
              </View>
            ))}
          </View>
          <View style={styles.cascadeLine}>
            <Text style={styles.cascadeText}>month goal → week goal → daily tasks</Text>
            <TouchableOpacity style={styles.cascadeButton} onPress={() => void breakIntoWeek(goal)}>
              <Text style={styles.cascadeButtonText}>Break into weeks +</Text>
            </TouchableOpacity>
          </View>
          {goal.weeklyGoalIds.length ? <Text style={styles.linkedText}>{goal.weeklyGoalIds.length} linked weekly goal created</Text> : null}
        </View>
      ))}
      <View style={styles.metricsCard}>
        {[
          ['Weight', '74.8 kg', '↓ 0.6'],
          ['Waist', '33.4 in', '↓ 0.3'],
          ['Arms', '13.8 in', '↑ 0.1'],
        ].map(([label, value, trend]) => (
          <View key={label} style={styles.metricItem}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={styles.metricValue}>{value}</Text>
            <Text style={trend.includes('↑') ? styles.trendUp : styles.trendDown}>{trend}</Text>
          </View>
        ))}
      </View>
      <View style={styles.monthlyLetter}>
        <Text style={styles.aiLabel}>AI Monthly Letter</Text>
        <Text style={styles.aiText}>{monthlyLetter}</Text>
        <Text style={styles.statLine}>Month momentum: {monthProgress}%</Text>
      </View>
    </>
  );

  const renderLearning = () => (
    <>
      <View style={styles.learningHero}>
        <ProgressRing progress={(readingDone / 12) * 100} size={112} strokeWidth={9} color={colors.indigo}>
          <Text style={styles.ringValue}>{readingDone}/12</Text>
          <Text style={styles.ringLabel}>books</Text>
        </ProgressRing>
        <View style={styles.learningStats}>
          <Text style={styles.sectionTitle}>Daily learning</Text>
          <Text style={styles.largeStat}>{totalLearningMinutes} min</Text>
          <Text style={styles.statLine}>Books and courses from learning tables</Text>
        </View>
      </View>
      <Text style={styles.blockTitle}>Books</Text>
      {books.map((book) => (
        <View key={book.id} style={styles.simpleRow}>
          <View>
            <Text style={styles.goalTitle}>{book.title}</Text>
            <Text style={styles.goalUnit}>{book.status}</Text>
          </View>
          <Text style={styles.goalCount}>{book.progress}%</Text>
        </View>
      ))}
      <Text style={styles.blockTitle}>Courses</Text>
      {courses.map((course) => (
        <View key={course.id} style={styles.courseCard}>
          <View style={styles.goalTopLine}>
            <Text style={styles.goalTitle}>{course.title}</Text>
            <Text style={styles.goalCount}>{course.progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${course.progress}%`, backgroundColor: colors.indigo }]} />
          </View>
          <Text style={styles.goalUnit}>{course.minutesToday} min logged today</Text>
        </View>
      ))}
    </>
  );

  const renderFinance = () => {
    const categories = categoryTotals.length ? categoryTotals : [['General', 0] as [string, number]];
    return (
      <>
        <View style={styles.financeHero}>
          <ProgressRing progress={(spent / budget) * 100} size={126} strokeWidth={10} color={colors.violet}>
            <Text style={styles.ringValue}>₹{Math.round(spent / 1000)}k</Text>
            <Text style={styles.ringLabel}>of ₹{Math.round(budget / 1000)}k</Text>
          </ProgressRing>
          <View style={styles.learningStats}>
            <Text style={styles.sectionTitle}>Monthly budget</Text>
            <Text style={styles.statLine}>₹{spent.toLocaleString('en-IN')} spent / ₹{budget.toLocaleString('en-IN')} budget</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
          {categories.map((category, index) => (
            <View key={`${category[0]}-${index}`} style={styles.breakdownCard}>
              <Text style={styles.goalUnit}>{category[0]}</Text>
              <Text style={styles.breakdownAmount}>₹{category[1].toLocaleString('en-IN')}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={styles.blockTitle}>Recent transactions</Text>
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={styles.transactionRow}>
              <View>
                <Text style={styles.goalTitle}>{item.title}</Text>
                <Text style={styles.goalUnit}>{item.category} · {item.date} · {item.note}</Text>
              </View>
              <Text style={styles.transactionAmount}>₹{item.amount.toLocaleString('en-IN')}</Text>
            </View>
          )}
        />
      </>
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
            <Text style={styles.subtitle}>Weekly execution, monthly direction.</Text>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={() => (activeTab === 'finance' ? setFinanceVisible(true) : setAddVisible(true))}>
            <Ionicons name="add" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        {renderTabs()}
        {activeTab === 'week' ? renderWeekly() : null}
        {activeTab === 'month' ? renderMonthly() : null}
        {activeTab === 'learning' ? renderLearning() : null}
        {activeTab === 'finance' ? renderFinance() : null}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 78 }]}
        onPress={() => (activeTab === 'finance' ? setFinanceVisible(true) : setAddVisible(true))}>
        <Ionicons name="add" size={22} color={colors.textPrimary} />
        <Text style={styles.fabText}>{activeTab === 'finance' ? 'Quick log' : 'Add goal'}</Text>
      </TouchableOpacity>

      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={() => setAddVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Add goal</Text>
              <TouchableOpacity onPress={() => setAddVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.categoryTabs}>
              {(['learning', 'work', 'health'] as GoalCategory[]).map((category) => (
                <TouchableOpacity
                  key={category}
                  style={[styles.categoryChip, newGoal.category === category && { backgroundColor: `${CATEGORY_META[category].accent}28`, borderColor: CATEGORY_META[category].accent }]}
                  onPress={() => setNewGoal((goal) => ({ ...goal, category }))}>
                  <Text style={styles.categoryChipText}>{CATEGORY_META[category].title}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={newGoal.title}
              onChangeText={(title) => setNewGoal((goal) => ({ ...goal, title }))}
              placeholder="Goal title"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={newGoal.target}
              onChangeText={(target) => setNewGoal((goal) => ({ ...goal, target }))}
              placeholder="Target"
              keyboardType="number-pad"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={() => void saveGoal()}>
              <Text style={styles.primaryButtonText}>Save weekly_goal</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={financeVisible} animationType="slide" transparent onRequestClose={() => setFinanceVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>Quick log</Text>
              <TouchableOpacity onPress={() => setFinanceVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={newTxn.amount}
              onChangeText={(amount) => setNewTxn((txn) => ({ ...txn, amount }))}
              placeholder="+ amount"
              keyboardType="decimal-pad"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={newTxn.category}
              onChangeText={(category) => setNewTxn((txn) => ({ ...txn, category }))}
              placeholder="+ category"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={newTxn.note}
              onChangeText={(note) => setNewTxn((txn) => ({ ...txn, note }))}
              placeholder="+ note"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={() => void saveTransaction()}>
              <Text style={styles.primaryButtonText}>Save transaction</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  headerAction: {
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  tabSwitcher: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  tabPill: { alignItems: 'center', borderRadius: radii.pill, flex: 1, minHeight: 38, justifyContent: 'center', paddingHorizontal: 8 },
  tabPillActive: { backgroundColor: colors.violet },
  tabText: { ...typography.labelCaps, color: colors.textSecondary, textAlign: 'center' },
  tabTextActive: { color: colors.textPrimary },
  weekCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  weekCopy: { gap: spacing.xs },
  eyebrow: { ...typography.labelCaps, color: colors.violetLight, textTransform: 'uppercase' },
  dateRange: { ...typography.h1, color: colors.textPrimary },
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
  domainDots: { gap: 4 },
  domainDot: { borderRadius: 5, height: 9, width: 9 },
  sectionCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  categoryHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  categoryIcon: { alignItems: 'center', borderRadius: radii.inner, height: 34, justifyContent: 'center', width: 34 },
  sectionTitle: { ...typography.h1, color: colors.textPrimary, flex: 1, fontSize: 18 },
  goalList: { gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: spacing.sm },
  swipeWrap: { borderRadius: radii.inner, overflow: 'hidden' },
  deleteRail: {
    alignItems: 'center',
    backgroundColor: colors.roseBg,
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
    width: 92,
  },
  goalRow: { backgroundColor: colors.surface2, borderRadius: radii.inner, gap: spacing.xs, padding: spacing.sm },
  goalTopLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  goalTitle: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  goalCount: { ...typography.labelCaps, color: colors.textSecondary },
  inlineInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    minHeight: 32,
    padding: 0,
  },
  progressTrack: { backgroundColor: colors.surface3, borderRadius: radii.pill, height: 8, overflow: 'hidden' },
  progressFill: { borderRadius: radii.pill, height: 8 },
  goalMetaLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  goalUnit: { ...typography.labelCaps, color: colors.textSecondary },
  miniAction: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  miniActionText: { ...typography.labelCaps, color: colors.blueLight },
  dotRow: { flexDirection: 'row', gap: 6 },
  progressDot: { backgroundColor: colors.surface3, borderRadius: 6, height: 11, width: 11 },
  aiCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.violetBg,
    borderColor: colors.violet,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  aiCopy: { flex: 1, gap: 4 },
  aiLabel: { ...typography.labelCaps, color: colors.violetLight, textTransform: 'uppercase' },
  aiText: { ...typography.body, color: colors.textPrimary },
  calendarCard: { backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.card, borderWidth: 1, padding: spacing.sm },
  monthHeader: { gap: 3, marginBottom: spacing.xs },
  statLine: { ...typography.body, color: colors.textSecondary },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: {
    aspectRatio: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    borderWidth: 1,
    margin: '0.9%',
    padding: 5,
    width: '12.45%',
  },
  calendarDate: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  calendarDots: { bottom: 5, flexDirection: 'row', gap: 2, left: 5, position: 'absolute' },
  calendarDot: { borderRadius: 3, height: 5, width: 5 },
  blockTitle: { ...typography.labelCaps, color: colors.textSecondary, marginTop: spacing.xs, textTransform: 'uppercase' },
  monthGoalCard: { backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.card, borderWidth: 1, gap: spacing.xs, padding: spacing.sm },
  monthGoalTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  statusBadge: { backgroundColor: colors.emeraldBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  statusBehind: { backgroundColor: colors.amberBg },
  statusText: { ...typography.labelCaps, color: colors.textPrimary },
  smallRingValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  milestoneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  milestonePill: { backgroundColor: colors.surface2, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  milestoneText: { ...typography.labelCaps, color: colors.textSecondary },
  cascadeLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  cascadeText: { ...typography.labelCaps, color: colors.textMuted, flex: 1 },
  cascadeButton: { backgroundColor: colors.violet, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 },
  cascadeButtonText: { ...typography.labelCaps, color: colors.textPrimary },
  linkedText: { ...typography.labelCaps, color: colors.violetLight },
  metricsCard: { backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.card, borderWidth: 1, flexDirection: 'row', padding: spacing.sm },
  metricItem: { flex: 1, gap: 3 },
  metricLabel: { ...typography.labelCaps, color: colors.textSecondary },
  metricValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  trendUp: { ...typography.labelCaps, color: colors.emeraldLight },
  trendDown: { ...typography.labelCaps, color: colors.rose },
  monthlyLetter: { backgroundColor: colors.surface1, borderColor: colors.violet, borderRadius: radii.card, borderWidth: 1, gap: spacing.xs, padding: spacing.sm },
  learningHero: { alignItems: 'center', backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.card, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  learningStats: { flex: 1, gap: spacing.xs },
  largeStat: { ...typography.stats, color: colors.textPrimary, fontSize: 36 },
  simpleRow: { alignItems: 'center', backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.inner, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between', padding: spacing.sm },
  courseCard: { backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.inner, borderWidth: 1, gap: spacing.xs, padding: spacing.sm },
  financeHero: { alignItems: 'center', backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.card, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  categoryScroll: { gap: spacing.xs, paddingRight: spacing.gutter },
  breakdownCard: { backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.inner, borderWidth: 1, minWidth: 126, padding: spacing.sm },
  breakdownAmount: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 4 },
  transactionRow: { alignItems: 'center', backgroundColor: colors.surface1, borderColor: colors.borderLight, borderRadius: radii.inner, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between', marginBottom: spacing.xs, padding: spacing.sm },
  transactionAmount: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
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
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: spacing.sm, padding: spacing.gutter },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitle: { ...typography.h1, color: colors.textPrimary },
  categoryTabs: { flexDirection: 'row', gap: spacing.xs },
  categoryChip: { borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, flex: 1, paddingHorizontal: 10, paddingVertical: 10 },
  categoryChipText: { ...typography.labelCaps, color: colors.textPrimary, textAlign: 'center' },
  input: { backgroundColor: colors.surface2, borderColor: colors.borderLight, borderRadius: radii.inner, borderWidth: 1, color: colors.textPrimary, minHeight: 50, paddingHorizontal: spacing.sm },
  primaryButton: { alignItems: 'center', backgroundColor: colors.violet, borderRadius: radii.pill, minHeight: 50, justifyContent: 'center' },
  primaryButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
});
