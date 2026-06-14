import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { BodyProgressModal } from '@/components/body/BodyProgressModal';
import { saveBodyMetric } from '@/lib/bodyMetrics';
import { colors as fallbackColors, radii, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { completeTodayWorkoutTask } from '@/lib/workoutTasks';
import { buildTodaysWorkoutTemplate, buildWorkoutTemplates, todayKey, type PlannedWorkoutTemplate } from '@/lib/workoutPlan';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;
type MuscleGroup = 'chest' | 'shoulders' | 'triceps' | 'back' | 'biceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core';
type ExerciseStatus = 'completed' | 'in-progress' | 'not-started';

type LoggedSet = {
  id: string;
  weightKg: number;
  reps: number;
  completedAt: string;
};

type Exercise = {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  targetSets: number;
  lastWeekKg: number;
  previousWeightKg: number;
  previousReps: number;
  sets: LoggedSet[];
};

type WorkoutTemplate = {
  id: string;
  name: string;
  dayLabel: string;
  weekdayIndex: number;
  splitName: string;
  isRestDay: boolean;
  muscleGroups: MuscleGroup[];
  exercises: Omit<Exercise, 'sets'>[];
};

type CompletedWorkoutSummary = {
  durationMinutes: number;
  volumeKg: number;
  totalSets: number;
  muscleGroups: MuscleGroup[];
};

const REST_SECONDS = 90;

type GymTheme = {
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
};

const fallbackGymTheme: GymTheme = {
  colors: fallbackColors,
  styles: createStyles(fallbackColors),
};

const GymThemeContext = createContext<GymTheme>(fallbackGymTheme);

function useGymTheme() {
  return useContext(GymThemeContext);
}

const EXERCISE_LIBRARY: Array<{ name: string; muscleGroup: MuscleGroup; defaultWeight: number; defaultReps: number }> = [
  { name: 'Barbell Bench Press', muscleGroup: 'chest', defaultWeight: 70, defaultReps: 8 },
  { name: 'Incline Dumbbell Press', muscleGroup: 'chest', defaultWeight: 26, defaultReps: 10 },
  { name: 'Seated Shoulder Press', muscleGroup: 'shoulders', defaultWeight: 42, defaultReps: 8 },
  { name: 'Cable Triceps Pushdown', muscleGroup: 'triceps', defaultWeight: 32, defaultReps: 12 },
  { name: 'Lat Pulldown', muscleGroup: 'back', defaultWeight: 58, defaultReps: 10 },
  { name: 'Barbell Row', muscleGroup: 'back', defaultWeight: 62, defaultReps: 8 },
  { name: 'Dumbbell Curl', muscleGroup: 'biceps', defaultWeight: 16, defaultReps: 12 },
  { name: 'Back Squat', muscleGroup: 'quads', defaultWeight: 95, defaultReps: 6 },
  { name: 'Romanian Deadlift', muscleGroup: 'hamstrings', defaultWeight: 82, defaultReps: 8 },
  { name: 'Standing Calf Raise', muscleGroup: 'calves', defaultWeight: 64, defaultReps: 14 },
  { name: 'Plank', muscleGroup: 'core', defaultWeight: 0, defaultReps: 45 },
];

function cloneTemplate(template: WorkoutTemplate): Exercise[] {
  return template.exercises.map((exercise) => ({ ...exercise, sets: [] }));
}

function templateFromPlan(plan: PlannedWorkoutTemplate): WorkoutTemplate {
  return {
    id: plan.id,
    name: plan.name,
    dayLabel: plan.dayLabel,
    weekdayIndex: plan.weekdayIndex,
    splitName: plan.splitName,
    isRestDay: plan.isRestDay,
    muscleGroups: plan.muscleGroups.map((muscle) => normalizeMuscle(muscle) ?? 'chest'),
    exercises: plan.exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      muscleGroup: normalizeMuscle(exercise.muscleGroup) ?? normalizeMuscle(exercise.name) ?? 'chest',
      targetSets: exercise.targetSets,
      lastWeekKg: exercise.lastWeekKg,
      previousWeightKg: exercise.previousWeightKg,
      previousReps: exercise.previousReps,
    })),
  };
}

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowDate(row: LooseRow) {
  return asText(row.completed_at) || asText(row.started_at) || asText(row.created_at) || asText(row.date);
}

function normalizeMuscle(value: string): MuscleGroup | null {
  const key = value.toLowerCase().trim();
  if (key.includes('chest')) return 'chest';
  if (key.includes('shoulder')) return 'shoulders';
  if (key.includes('tricep')) return 'triceps';
  if (key.includes('back') || key.includes('lat')) return 'back';
  if (key.includes('bicep') || key.includes('curl')) return 'biceps';
  if (key.includes('quad') || key.includes('squat')) return 'quads';
  if (key.includes('hamstring') || key.includes('deadlift')) return 'hamstrings';
  if (key.includes('glute')) return 'glutes';
  if (key.includes('calf')) return 'calves';
  if (key.includes('core') || key.includes('abs') || key.includes('plank')) return 'core';
  return null;
}

function statusFor(exercise: Exercise): ExerciseStatus {
  if (exercise.sets.length >= exercise.targetSets) return 'completed';
  if (exercise.sets.length > 0) return 'in-progress';
  return 'not-started';
}

function totalVolume(exercises: Exercise[]) {
  return exercises.reduce((sum, exercise) => sum + exercise.sets.reduce((setSum, set) => setSum + set.weightKg * set.reps, 0), 0);
}

function totalSets(exercises: Exercise[]) {
  return exercises.reduce(
    (totals, exercise) => ({
      done: totals.done + exercise.sets.length,
      target: totals.target + exercise.targetSets,
    }),
    { done: 0, target: 0 },
  );
}

function formatRest(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = `${seconds % 60}`.padStart(2, '0');
  return `${minutes}:${remaining}`;
}

export default function GymScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const theme = useMemo(() => ({ colors, styles }), [colors, styles]);
  const isCompactWidth = width < 390;
  const profile = useUserStore((state) => state.profile);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const generatedPlan = useUserStore((state) => state.generatedPlan);
  const setProfile = useUserStore((state) => state.setProfile);
  const workoutTemplates = useMemo(
    () => buildWorkoutTemplates(generatedPlan, profile).map(templateFromPlan),
    [generatedPlan, profile],
  );
  const defaultTemplate = useMemo(
    () => templateFromPlan(buildTodaysWorkoutTemplate(generatedPlan, profile)),
    [generatedPlan, profile],
  );
  const pulse = useSharedValue(0);
  const timerProgress = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [template, setTemplate] = useState(defaultTemplate);
  const [exercises, setExercises] = useState<Exercise[]>(() => cloneTemplate(defaultTemplate));
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState(defaultTemplate.id);
  const [addExerciseVisible, setAddExerciseVisible] = useState(false);
  const [logSetVisible, setLogSetVisible] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [customExerciseName, setCustomExerciseName] = useState('');
  const [setWeight, setSetWeight] = useState('');
  const [setReps, setSetReps] = useState('');
  const [bodyWeight, setBodyWeight] = useState('');
  const [bodyModalVisible, setBodyModalVisible] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);
  const [timerPaused, setTimerPaused] = useState(false);
  const [workoutCompleted, setWorkoutCompleted] = useState(false);
  const [completedSummary, setCompletedSummary] = useState<CompletedWorkoutSummary | null>(null);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [recentMuscles, setRecentMuscles] = useState<Partial<Record<MuscleGroup, string>>>({});
  const [prs, setPrs] = useState<Record<string, number>>({});
  const [newPrs, setNewPrs] = useState<Record<string, boolean>>({});

  const selectedExercise = useMemo(
    () => exercises.find((exercise) => exercise.id === selectedExerciseId) ?? null,
    [exercises, selectedExerciseId],
  );
  const setTotals = useMemo(() => totalSets(exercises), [exercises]);
  const volume = useMemo(() => totalVolume(exercises), [exercises]);
  const completion = setTotals.target > 0 ? Math.min(100, Math.round((setTotals.done / setTotals.target) * 100)) : 0;
  const trainedMuscles = useMemo(() => Array.from(new Set(exercises.map((exercise) => exercise.muscleGroup))), [exercises]);
  const displayedMuscles = workoutCompleted && completedSummary ? completedSummary.muscleGroups : trainedMuscles;
  const displayedDuration = workoutCompleted && completedSummary
    ? completedSummary.durationMinutes
    : startedAt
      ? Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60000))
      : 0;
  const displayedVolume = workoutCompleted && completedSummary ? completedSummary.volumeKg : volume;
  const displayedSetsDone = workoutCompleted && completedSummary ? completedSummary.totalSets : setTotals.done;
  const displayedSetsTarget = workoutCompleted && completedSummary ? completedSummary.totalSets : setTotals.target;
  const displayedCompletion = workoutCompleted ? 100 : completion;
  const selectedSchedule = useMemo(
    () => workoutTemplates.find((item) => item.id === selectedScheduleId) ?? defaultTemplate,
    [defaultTemplate, selectedScheduleId, workoutTemplates],
  );
  const hasTodayWorkout = !template.isRestDay && exercises.length > 0;
  const restWarning = displayedMuscles
    .map((muscle) => {
      const last = recentMuscles[muscle];
      if (!last) return null;
      const hours = Math.max(1, Math.round((Date.now() - new Date(last).getTime()) / 36e5));
      return hours <= 48 ? `${titleCase(muscle)}: ${48 - hours}h rest` : null;
    })
    .find(Boolean);
  const pulseStyle = useAnimatedStyle(() => ({
    borderColor: pulse.value > 0.5 ? colors.amberLight : colors.amber,
    shadowOpacity: 0.18 + pulse.value * 0.32,
  }));

  const timerFillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(100, timerProgress.value * 100))}%`,
  }));

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);

  useEffect(() => {
    void loadRecentMuscles();
  }, [currentUserId]);

  useEffect(() => {
    void loadTodayWorkoutCompletion();
  }, [currentUserId, defaultTemplate.id]);

  useEffect(() => {
    if (startedAt || setTotals.done > 0) return;
    setTemplate(defaultTemplate);
    setExercises(cloneTemplate(defaultTemplate));
    setSelectedScheduleId(defaultTemplate.id);
  }, [defaultTemplate, setTotals.done, startedAt]);

  useEffect(() => {
    if (!selectedExercise || logSetVisible) return;
    setSetWeight(String(selectedExercise.previousWeightKg || selectedExercise.lastWeekKg || 0));
    setSetReps(String(selectedExercise.previousReps || 8));
  }, [logSetVisible, selectedExercise]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRestRemaining(0);
    setTimerPaused(false);
    timerProgress.value = 0;
  }, [timerProgress]);

  const startRestTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerPaused(false);
    setRestRemaining(REST_SECONDS);
    timerProgress.value = 1;
    timerProgress.value = withTiming(0, { duration: REST_SECONDS * 1000, easing: Easing.linear });

    timerRef.current = setInterval(() => {
      setRestRemaining((remaining) => {
        if (remaining <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
  }, [timerProgress]);

  const toggleTimer = useCallback(() => {
    if (restRemaining <= 0) return;
    setTimerPaused((paused) => {
      const nextPaused = !paused;
      if (nextPaused) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        cancelAnimation(timerProgress);
      } else {
        timerProgress.value = withTiming(0, { duration: restRemaining * 1000, easing: Easing.linear });
        timerRef.current = setInterval(() => {
          setRestRemaining((remaining) => {
            if (remaining <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              timerRef.current = null;
              return 0;
            }
            return remaining - 1;
          });
        }, 1000);
      }
      return nextPaused;
    });
  }, [restRemaining, timerProgress]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  async function loadRecentMuscles() {
    if (!currentUserId) {
      setRecentMuscles({});
      return;
    }

    try {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('workout_sets')
        .select('*, workout_sessions(*)')
        .eq('user_id', currentUserId)
        .gte('created_at', since)
        .limit(80);

      if (error) throw error;

      const recent: Partial<Record<MuscleGroup, string>> = {};
      ((data ?? []) as LooseRow[]).forEach((setRow) => {
        const session = setRow.workout_sessions && typeof setRow.workout_sessions === 'object'
          ? (setRow.workout_sessions as LooseRow)
          : {};
        const sessionMuscles = Array.isArray(session.muscle_groups)
          ? session.muscle_groups.find((item): item is string => typeof item === 'string')
          : '';
        const muscle = normalizeMuscle(asText(setRow.muscle_group) || sessionMuscles || asText(session.muscle_group) || asText(setRow.exercise_name));
        const date = rowDate(setRow) || rowDate(session);
        if (muscle && date) recent[muscle] = date;
      });

      setRecentMuscles(recent);
    } catch (error) {
      console.warn('Unable to load recent muscle recovery data', error);
      setRecentMuscles({ chest: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    }
  }

  async function loadTodayWorkoutCompletion() {
    if (!currentUserId) {
      setWorkoutCompleted(false);
      setCompletedSummary(null);
      return;
    }

    const { data, error } = await supabase
      .from('workout_sessions')
      .select('id, duration_minutes, total_volume_kg, total_sets, muscle_groups')
      .eq('user_id', currentUserId)
      .eq('date', todayKey())
      .eq('template_name', defaultTemplate.name)
      .order('completed_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('Unable to check today workout completion', error.message);
      return;
    }

    const row = ((data ?? []) as LooseRow[])[0] ?? null;
    const completed = Boolean(row);
    setWorkoutCompleted(completed);
    setCompletedSummary(
      row
        ? {
            durationMinutes: asNumber(row.duration_minutes),
            volumeKg: asNumber(row.total_volume_kg),
            totalSets: asNumber(row.total_sets),
            muscleGroups: Array.isArray(row.muscle_groups)
              ? row.muscle_groups.map(String).map((muscle) => normalizeMuscle(muscle)).filter((muscle): muscle is MuscleGroup => Boolean(muscle))
              : defaultTemplate.muscleGroups,
          }
        : null,
    );
    if (completed) {
      await completeTodayWorkoutTask(defaultTemplate, currentUserId);
    }
  }

  const openLogSet = useCallback((exercise: Exercise) => {
    if (!hasTodayWorkout || workoutCompleted) return;
    setSelectedExerciseId(exercise.id);
    setSetWeight(String(exercise.previousWeightKg || exercise.lastWeekKg || 0));
    setSetReps(String(exercise.previousReps || 8));
    setLogSetVisible(true);
  }, [hasTodayWorkout, workoutCompleted]);

  const logSet = useCallback(() => {
    if (!selectedExercise) return;
    const weightKg = Math.max(0, Number(setWeight) || 0);
    const reps = Math.max(1, Number(setReps) || 1);
    const set: LoggedSet = { id: `${selectedExercise.id}-${Date.now()}`, weightKg, reps, completedAt: new Date().toISOString() };
    const estimated = weightKg * reps;
    const previousBest = prs[selectedExercise.name] ?? selectedExercise.lastWeekKg * selectedExercise.previousReps;

    setExercises((items) =>
      items.map((exercise) =>
        exercise.id === selectedExercise.id
          ? {
              ...exercise,
              previousWeightKg: weightKg,
              previousReps: reps,
              sets: [...exercise.sets, set],
            }
          : exercise,
      ),
    );
    setPrs((records) => ({
      ...records,
      [selectedExercise.name]: Math.max(previousBest, estimated),
    }));
    if (estimated > previousBest) {
      setNewPrs((records) => ({ ...records, [selectedExercise.name]: true }));
    }
    setStartedAt((value) => value ?? new Date());
    setLogSetVisible(false);
    startRestTimer();
  }, [prs, selectedExercise, setReps, setWeight, startRestTimer]);

  const addExercise = useCallback((item: { name: string; muscleGroup: MuscleGroup; defaultWeight: number; defaultReps: number }) => {
    setExercises((items) => [
      ...items,
      {
        id: `${item.name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
        name: item.name,
        muscleGroup: item.muscleGroup,
        targetSets: 3,
        lastWeekKg: item.defaultWeight,
        previousWeightKg: item.defaultWeight,
        previousReps: item.defaultReps,
        sets: [],
      },
    ]);
    setAddExerciseVisible(false);
    setExerciseQuery('');
    setCustomExerciseName('');
  }, []);

  const addCustomExercise = useCallback(() => {
    const name = customExerciseName.trim() || exerciseQuery.trim();
    if (!name) return;
    addExercise({ name, muscleGroup: normalizeMuscle(name) ?? 'chest', defaultWeight: 0, defaultReps: 8 });
  }, [addExercise, customExerciseName, exerciseQuery]);

  const completeWorkout = useCallback(async () => {
    if (!hasTodayWorkout) {
      Alert.alert('No workout today', 'Today is a recovery day in your profile split.');
      return;
    }

    if (workoutCompleted || savingWorkout) return;

    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before completing a workout.');
      return;
    }

    const completedAt = new Date();
    const started = startedAt ?? completedAt;
    const durationMinutes = Math.max(1, Math.round((completedAt.getTime() - started.getTime()) / 60000));
    const muscles = Array.from(new Set(exercises.filter((exercise) => exercise.sets.length > 0).map((exercise) => exercise.muscleGroup)));

    setSavingWorkout(true);
    try {
      const { data: session, error } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: currentUserId,
          date: completedAt.toISOString().slice(0, 10),
          template_name: template.name,
          muscle_groups: muscles.length > 0 ? muscles : template.muscleGroups,
          started_at: started.toISOString(),
          completed_at: completedAt.toISOString(),
          duration_minutes: durationMinutes,
          total_volume_kg: volume,
          total_sets: setTotals.done,
          notes: `Profile split: ${template.splitName}`,
        })
        .select('*')
        .single();

      if (error) throw error;
      const sessionId = String((session as LooseRow).id ?? `local-${Date.now()}`);
      const rows = exercises.flatMap((exercise) =>
        exercise.sets.map((set, index) => ({
          user_id: currentUserId,
          session_id: sessionId,
          exercise_name: exercise.name,
          muscle_group: exercise.muscleGroup,
          set_number: index + 1,
          weight_kg: set.weightKg,
          reps: set.reps,
          is_personal_record: Boolean(newPrs[exercise.name]),
          completed: true,
          rest_seconds: REST_SECONDS,
          created_at: set.completedAt,
        })),
      );
      if (rows.length > 0) await supabase.from('workout_sets').insert(rows);
      const weight = Number(bodyWeight);
      if (Number.isFinite(weight) && weight > 0) {
        await saveBodyMetric({ userId: currentUserId, date: completedAt.toISOString().slice(0, 10), weightKg: weight });
        if (profile) setProfile({ ...profile, weightKg: weight });
      }
      await completeTodayWorkoutTask(template, currentUserId);
      setWorkoutCompleted(true);
      setCompletedSummary({
        durationMinutes,
        volumeKg: volume,
        totalSets: setTotals.done,
        muscleGroups: muscles.length > 0 ? muscles : template.muscleGroups,
      });
      setSavingWorkout(false);
      stopTimer();
      Alert.alert('Workout saved', `${template.name} logged with ${Math.round(volume).toLocaleString()} kg total volume.`);
      router.push('/workout-history' as never);
    } catch (error) {
      console.warn('Unable to save workout', error);
      setSavingWorkout(false);
      Alert.alert('Workout complete', 'Saved locally for this session. Check Supabase columns if persistence failed.');
    }
  }, [bodyWeight, currentUserId, exercises, hasTodayWorkout, newPrs, profile, savingWorkout, setProfile, setTotals.done, startedAt, stopTimer, template, volume, workoutCompleted]);

  const renderExercise = ({ item }: { item: Exercise }) => {
    const status = statusFor(item);
    const isCompleted = status === 'completed';
    const inProgress = status === 'in-progress';
    const pr = Boolean(newPrs[item.name]);

    return (
      <Animated.View style={[styles.exerciseCard, inProgress && styles.exerciseCardActive, inProgress && pulseStyle, isCompleted && styles.exerciseCardDone]}>
        <TouchableOpacity activeOpacity={0.85} style={styles.exerciseTop} onPress={() => openLogSet(item)}>
          <View style={[styles.statusIcon, isCompleted && styles.statusIconDone, inProgress && styles.statusIconActive]}>
            <Ionicons name={isCompleted ? 'checkmark' : inProgress ? 'barbell-outline' : 'ellipse-outline'} size={18} color={isCompleted ? colors.textPrimary : inProgress ? colors.amberLight : colors.textMuted} />
          </View>
          <View style={styles.exerciseTitleWrap}>
            <View style={styles.exerciseNameRow}>
              <Text style={[styles.exerciseName, status === 'not-started' && styles.exerciseNameMuted]}>{item.name}</Text>
              {pr ? <Text style={styles.prBadge}>PR</Text> : null}
            </View>
            <Text style={styles.exerciseMeta}>{titleCase(item.muscleGroup)} · Last week: {item.lastWeekKg}kg</Text>
          </View>
          <View style={[styles.setBadge, isCompleted && styles.setBadgeDone, inProgress && styles.setBadgeActive]}>
            <Text style={[styles.setBadgeText, (isCompleted || inProgress) && styles.setBadgeTextStrong]}>
              {isCompleted ? `${item.sets.length} sets ✓` : `${item.sets.length} / ${item.targetSets} sets`}
            </Text>
          </View>
        </TouchableOpacity>

        {status !== 'not-started' ? (
          <View style={styles.setTable}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableHeadCell}>Set</Text>
              <Text style={styles.tableHeadCell}>kg</Text>
              <Text style={styles.tableHeadCell}>Reps</Text>
              <Text style={styles.tableHeadCell}>Done</Text>
            </View>
            {item.sets.map((set, index) => (
              <View key={set.id} style={styles.tableRow}>
                <Text style={styles.tableCell}>{index + 1}</Text>
                <Text style={styles.tableCell}>{set.weightKg}</Text>
                <Text style={styles.tableCell}>{set.reps}</Text>
                <Ionicons name="checkmark-circle" size={18} color={colors.emeraldLight} style={styles.tableIcon} />
              </View>
            ))}
            {inProgress ? (
              <TouchableOpacity style={[styles.tableRow, styles.inputRow]} onPress={() => openLogSet(item)}>
                <Text style={styles.tableCell}>{item.sets.length + 1}</Text>
                <Text style={styles.inputCell}>{item.previousWeightKg}kg</Text>
                <Text style={styles.inputCell}>{item.previousReps} reps</Text>
                <Ionicons name="add-circle" size={18} color={colors.amberLight} style={styles.tableIcon} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    );
  };

  return (
    <GymThemeContext.Provider value={theme}>
    <View style={styles.screen}>
      <FlatList
        data={workoutCompleted ? [] : exercises}
        keyExtractor={(item) => item.id}
        renderItem={renderExercise}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + (restRemaining > 0 ? 172 : 108) },
        ]}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={styles.headerTop}>
                <Text style={styles.headerLabel}>Today's Workout</Text>
                <View style={styles.headerActions}>
                  <TouchableOpacity accessibilityLabel="Log body progress" style={styles.historyButton} onPress={() => setBodyModalVisible(true)}>
                    <Ionicons name="scale-outline" size={22} color={colors.amberLight} />
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityLabel="Check week schedule" style={styles.historyButton} onPress={() => setScheduleModalVisible(true)}>
                    <Ionicons name="calendar-outline" size={22} color={colors.amberLight} />
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityLabel="Workout history" style={styles.historyButton} onPress={() => router.push('/workout-history' as never)}>
                    <Ionicons name="time-outline" size={22} color={colors.amberLight} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.workoutTitle}>{template.name}</Text>
                <Text style={styles.headerSub}>{template.dayLabel} · {template.splitName}</Text>
              </View>
            </View>

            <View style={styles.summaryCard}>
              <View style={[styles.summaryGrid, isCompactWidth && styles.summaryGridCompact]}>
                <StatTile label="Duration" value={`${displayedDuration}m`} />
                <StatTile label="Volume (kg)" value={Math.round(displayedVolume).toLocaleString()} />
                <StatTile label="Sets Done" value={`${displayedSetsDone}/${displayedSetsTarget}`} />
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${displayedCompletion}%` }]} />
              </View>
            </View>

            <View style={styles.heatmapCard}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle}>Muscle Heatmap</Text>
                  <Text style={styles.cardSubtitle}>
                    {displayedMuscles.length > 0 ? displayedMuscles.map(titleCase).join(' · ') : 'Recovery day'}
                  </Text>
                </View>
                {restWarning ? (
                  <View style={styles.warningBadge}>
                    <Text style={styles.warningText}>⚠ {restWarning}</Text>
                  </View>
                ) : null}
              </View>
              <MuscleHeatmap activeMuscles={displayedMuscles} recentMuscles={recentMuscles} />
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {workoutCompleted ? 'Workout saved' : hasTodayWorkout ? 'Exercises' : 'Today is recovery'}
              </Text>
              <View style={styles.sectionActions}>
                {hasTodayWorkout ? (
                  workoutCompleted ? (
                    <View style={styles.completedBadge}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.emeraldLight} />
                      <Text style={styles.completedBadgeText}>Completed</Text>
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity disabled={savingWorkout} style={[styles.completeButton, savingWorkout && styles.disabledButton]} onPress={completeWorkout}>
                        <Ionicons name="flag-outline" size={16} color={colors.textPrimary} />
                        <Text style={styles.completeButtonText}>{savingWorkout ? 'Saving...' : 'Complete'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.addButton} onPress={() => setAddExerciseVisible(true)}>
                        <Text style={styles.addButtonText}>Add +</Text>
                      </TouchableOpacity>
                    </>
                  )
                ) : null}
              </View>
            </View>
            {workoutCompleted ? (
              <View style={styles.savedWorkoutCard}>
                <Ionicons name="checkmark-circle" size={24} color={colors.emeraldLight} />
                <View style={styles.savedWorkoutCopy}>
                  <Text style={styles.savedWorkoutTitle}>Saved to workout history</Text>
                  <Text style={styles.savedWorkoutText}>Today's gym task is marked done. Use history to review this session.</Text>
                </View>
                <TouchableOpacity style={styles.savedWorkoutButton} onPress={() => router.push('/workout-history' as never)}>
                  <Text style={styles.savedWorkoutButtonText}>History</Text>
                </TouchableOpacity>
              </View>
            ) : hasTodayWorkout ? (
              <TextInput
                placeholder="Body weight today (optional)"
                placeholderTextColor={colors.textMuted}
                value={bodyWeight}
                onChangeText={setBodyWeight}
                keyboardType="decimal-pad"
                style={styles.formInput}
              />
            ) : (
              <View style={styles.recoveryCard}>
                <View style={styles.recoveryIcon}>
                  <Ionicons name="leaf-outline" size={22} color={colors.emeraldLight} />
                </View>
                <View style={styles.recoveryCopy}>
                  <Text style={styles.recoveryTitle}>No lifting scheduled today</Text>
                  <Text style={styles.recoveryText}>Use the week schedule to review upcoming workouts without changing today.</Text>
                </View>
              </View>
            )}
          </>
        }
      />

      {restRemaining > 0 ? (
        <View style={[styles.timerWrap, { bottom: insets.bottom + 76 }]}>
          <View style={styles.timerBar}>
            <Animated.View style={[styles.timerFill, timerFillStyle]} />
            <View style={styles.timerContent}>
              <View>
                <Text style={styles.timerLabel}>Rest Timer</Text>
                <Text style={styles.timerValue}>{formatRest(restRemaining)}</Text>
              </View>
              <View style={styles.timerActions}>
                <TouchableOpacity style={styles.timerIconButton} onPress={toggleTimer}>
                  <Ionicons name={timerPaused ? 'play' : 'pause'} size={20} color={colors.background} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.timerIconButton} onPress={stopTimer}>
                  <Ionicons name="refresh" size={20} color={colors.background} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <Modal visible={scheduleModalVisible} animationType="slide" transparent onRequestClose={() => setScheduleModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Week Schedule</Text>
                <Text style={styles.modalSubtitle}>Read-only preview. Today stays locked on the gym screen.</Text>
              </View>
              <TouchableOpacity onPress={() => setScheduleModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
              {workoutTemplates.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.dayPill, selectedSchedule.id === item.id && styles.dayPillActive, defaultTemplate.id === item.id && styles.dayPillToday]}
                  onPress={() => setSelectedScheduleId(item.id)}>
                  <Text style={[styles.dayPillLabel, selectedSchedule.id === item.id && styles.dayPillLabelActive]}>
                    {item.dayLabel.split(' · ')[0]}
                  </Text>
                  <Text style={[styles.dayPillName, selectedSchedule.id === item.id && styles.dayPillNameActive]}>
                    {item.isRestDay ? 'Recovery' : item.name.replace(' Workout', '')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.schedulePreview}>
              <View style={styles.schedulePreviewHeader}>
                <View style={styles.scheduleTitleWrap}>
                  <Text style={styles.templateName}>{selectedSchedule.name}</Text>
                  <Text style={styles.templateMeta}>
                    {selectedSchedule.isRestDay ? 'Recovery' : `${selectedSchedule.exercises.length} exercises`} · {selectedSchedule.dayLabel}
                  </Text>
                </View>
                {selectedSchedule.id === defaultTemplate.id ? <Text style={styles.todayBadge}>Today</Text> : null}
              </View>

              {selectedSchedule.isRestDay ? (
                <View style={styles.scheduleRestBox}>
                  <Ionicons name="walk-outline" size={20} color={colors.emeraldLight} />
                  <Text style={styles.scheduleRestText}>Recovery day. No workout can be started from this preview.</Text>
                </View>
              ) : (
                <View style={styles.scheduleExerciseList}>
                  {selectedSchedule.exercises.map((exercise) => (
                    <View key={exercise.id} style={styles.scheduleExerciseRow}>
                      <View>
                        <Text style={styles.scheduleExerciseName}>{exercise.name}</Text>
                        <Text style={styles.scheduleExerciseMeta}>{titleCase(exercise.muscleGroup)} · {exercise.targetSets} sets · {exercise.previousReps} reps</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={addExerciseVisible} animationType="slide" transparent onRequestClose={() => setAddExerciseVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Exercise</Text>
              <TouchableOpacity onPress={() => setAddExerciseVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                placeholder="Search or create"
                placeholderTextColor={colors.textMuted}
                value={exerciseQuery}
                onChangeText={setExerciseQuery}
                style={styles.searchInput}
              />
            </View>
            <ScrollView style={styles.exerciseResults} keyboardShouldPersistTaps="handled">
              {EXERCISE_LIBRARY.filter((item) => item.name.toLowerCase().includes(exerciseQuery.toLowerCase())).map((item) => (
                <TouchableOpacity key={item.name} style={styles.resultRow} onPress={() => addExercise(item)}>
                  <View>
                    <Text style={styles.resultTitle}>{item.name}</Text>
                    <Text style={styles.resultMeta}>{titleCase(item.muscleGroup)} · previous {item.defaultWeight}kg x {item.defaultReps}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={colors.amberLight} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput
              placeholder="Custom exercise name"
              placeholderTextColor={colors.textMuted}
              value={customExerciseName}
              onChangeText={setCustomExerciseName}
              style={styles.formInput}
            />
            <TouchableOpacity style={styles.saveButton} onPress={addCustomExercise}>
              <Text style={styles.saveButtonText}>Create Exercise</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={logSetVisible} animationType="fade" transparent onRequestClose={() => setLogSetVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Set</Text>
              <TouchableOpacity onPress={() => setLogSetVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.logExerciseName}>{selectedExercise?.name}</Text>
            <Text style={styles.previousText}>
              Previous: {selectedExercise?.previousWeightKg ?? 0}kg x {selectedExercise?.previousReps ?? 0} reps
            </Text>
            <View style={styles.logInputs}>
              <View style={styles.logInputWrap}>
                <Text style={styles.inputLabel}>Weight kg</Text>
                <TextInput value={setWeight} onChangeText={setSetWeight} keyboardType="decimal-pad" style={styles.bigInput} />
              </View>
              <View style={styles.logInputWrap}>
                <Text style={styles.inputLabel}>Reps</Text>
                <TextInput value={setReps} onChangeText={setSetReps} keyboardType="number-pad" style={styles.bigInput} />
              </View>
            </View>
            <TouchableOpacity style={styles.saveButton} onPress={logSet}>
              <Text style={styles.saveButtonText}>Log Set</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BodyProgressModal visible={bodyModalVisible} onClose={() => setBodyModalVisible(false)} />
    </View>
    </GymThemeContext.Provider>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  const { styles } = useGymTheme();

  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MuscleHeatmap({
  activeMuscles,
  recentMuscles,
}: {
  activeMuscles: MuscleGroup[];
  recentMuscles: Partial<Record<MuscleGroup, string>>;
}) {
  const { colors, styles } = useGymTheme();
  const active = new Set(activeMuscles);
  const fill = (muscle: MuscleGroup) => {
    if (active.has(muscle)) return colors.amber;
    if (recentMuscles[muscle]) return colors.rose;
    return colors.surface2;
  };

  return (
    <View style={styles.heatmapWrap}>
      <Svg width="100%" height={218} viewBox="0 0 330 218">
        <Circle cx="78" cy="24" r="16" fill={colors.surface2} stroke={colors.border} strokeWidth="2" />
        <Path d="M58 48 C68 38 88 38 98 48 L105 105 C96 118 60 118 51 105 Z" fill={colors.surface2} stroke={colors.border} strokeWidth="2" />
        <Path d="M60 55 L32 85 L24 130" fill="none" stroke={fill('shoulders')} strokeWidth="14" strokeLinecap="round" />
        <Path d="M96 55 L124 85 L132 130" fill="none" stroke={fill('shoulders')} strokeWidth="14" strokeLinecap="round" />
        <Ellipse cx="67" cy="73" rx="16" ry="22" fill={fill('chest')} opacity="0.95" />
        <Ellipse cx="89" cy="73" rx="16" ry="22" fill={fill('chest')} opacity="0.95" />
        <Path d="M59 99 C68 108 88 108 97 99 L92 120 C83 126 73 126 64 120 Z" fill={fill('core')} />
        <Path d="M61 117 L52 185" fill="none" stroke={fill('quads')} strokeWidth="17" strokeLinecap="round" />
        <Path d="M95 117 L104 185" fill="none" stroke={fill('quads')} strokeWidth="17" strokeLinecap="round" />
        <Path d="M52 184 L48 205" fill="none" stroke={fill('calves')} strokeWidth="12" strokeLinecap="round" />
        <Path d="M104 184 L108 205" fill="none" stroke={fill('calves')} strokeWidth="12" strokeLinecap="round" />
        <Path d="M27 120 L22 158" fill="none" stroke={fill('triceps')} strokeWidth="11" strokeLinecap="round" />
        <Path d="M129 120 L134 158" fill="none" stroke={fill('triceps')} strokeWidth="11" strokeLinecap="round" />

        <Circle cx="250" cy="24" r="16" fill={colors.surface2} stroke={colors.border} strokeWidth="2" />
        <Path d="M230 48 C240 38 260 38 270 48 L277 106 C266 119 234 119 223 106 Z" fill={colors.surface2} stroke={colors.border} strokeWidth="2" />
        <Path d="M232 55 L204 86 L197 130" fill="none" stroke={fill('shoulders')} strokeWidth="14" strokeLinecap="round" />
        <Path d="M268 55 L296 86 L303 130" fill="none" stroke={fill('shoulders')} strokeWidth="14" strokeLinecap="round" />
        <Path d="M232 58 C245 82 255 82 268 58 L272 103 C258 112 242 112 228 103 Z" fill={fill('back')} />
        <Rect x="238" y="102" width="24" height="28" rx="9" fill={fill('core')} />
        <Path d="M233 118 L224 185" fill="none" stroke={fill('hamstrings')} strokeWidth="17" strokeLinecap="round" />
        <Path d="M267 118 L276 185" fill="none" stroke={fill('hamstrings')} strokeWidth="17" strokeLinecap="round" />
        <Ellipse cx="237" cy="123" rx="15" ry="13" fill={fill('glutes')} />
        <Ellipse cx="263" cy="123" rx="15" ry="13" fill={fill('glutes')} />
        <Path d="M224 184 L220 205" fill="none" stroke={fill('calves')} strokeWidth="12" strokeLinecap="round" />
        <Path d="M276 184 L280 205" fill="none" stroke={fill('calves')} strokeWidth="12" strokeLinecap="round" />
        <Path d="M199 118 L194 156" fill="none" stroke={fill('triceps')} strokeWidth="11" strokeLinecap="round" />
        <Path d="M301 118 L306 156" fill="none" stroke={fill('triceps')} strokeWidth="11" strokeLinecap="round" />
      </Svg>
      <View style={styles.heatmapLabels}>
        <Text style={styles.heatmapLabel}>Front</Text>
        <Text style={styles.heatmapLabel}>Back</Text>
      </View>
    </View>
  );
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    gap: 12,
    maxWidth: 560,
    paddingHorizontal: spacing.gutter,
    width: '100%',
  },
  header: {
    gap: 4,
    paddingBottom: 4,
  },
  headerTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerCopy: {
    gap: 2,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  workoutTitle: {
    color: colors.amber,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 31,
  },
  headerSub: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  historyButton: {
    alignItems: 'center',
    backgroundColor: colors.amberBg,
    borderColor: colors.amber,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  summaryCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.amber,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 14,
    padding: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  summaryGridCompact: {
    gap: 6,
  },
  statTile: {
    backgroundColor: colors.amberBg,
    borderColor: 'rgba(245, 158, 11, 0.28)',
    borderRadius: radii.inner,
    borderWidth: 1,
    flex: 1,
    minHeight: 80,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 27,
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
    marginTop: 5,
  },
  progressTrack: {
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.amber,
    borderRadius: radii.pill,
    height: 8,
  },
  heatmapCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 27,
  },
  cardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 2,
  },
  warningBadge: {
    backgroundColor: colors.roseBg,
    borderColor: colors.rose,
    borderRadius: radii.inner,
    borderWidth: 1,
    maxWidth: 150,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
  warningText: {
    color: colors.rose,
    fontSize: 12,
    fontWeight: '800',
  },
  heatmapWrap: {
    marginTop: 10,
  },
  heatmapLabels: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 2,
  },
  heatmapLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 28,
  },
  sectionActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  completeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: spacing.xs,
  },
  disabledButton: {
    opacity: 0.55,
  },
  completeButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  completedBadge: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: 'rgba(16, 185, 129, 0.38)',
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: spacing.xs,
  },
  completedBadgeText: {
    color: colors.emeraldLight,
    fontSize: 12,
    fontWeight: '900',
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.amber,
    borderRadius: radii.inner,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  addButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  recoveryCard: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  recoveryIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  recoveryCopy: {
    flex: 1,
    minWidth: 0,
  },
  recoveryTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  recoveryText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 3,
  },
  savedWorkoutCard: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: 'rgba(16, 185, 129, 0.38)',
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  savedWorkoutCopy: {
    flex: 1,
  },
  savedWorkoutTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  savedWorkoutText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 2,
  },
  savedWorkoutButton: {
    backgroundColor: colors.emerald,
    borderRadius: radii.inner,
    paddingHorizontal: spacing.xs,
    paddingVertical: 8,
  },
  savedWorkoutButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
  },
  exerciseCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.sm,
    shadowColor: colors.amber,
    shadowRadius: 18,
  },
  exerciseCardActive: {
    borderWidth: 1.5,
  },
  exerciseCardDone: {
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  exerciseTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statusIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  statusIconDone: {
    backgroundColor: colors.emerald,
  },
  statusIconActive: {
    backgroundColor: colors.amberBg,
  },
  exerciseTitleWrap: {
    flex: 1,
  },
  exerciseNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  exerciseName: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  exerciseNameMuted: {
    color: colors.textSecondary,
  },
  exerciseMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  prBadge: {
    backgroundColor: colors.amber,
    borderRadius: radii.pill,
    color: colors.background,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  setBadge: {
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
  setBadgeActive: {
    backgroundColor: colors.amberBg,
  },
  setBadgeDone: {
    backgroundColor: colors.emeraldBg,
  },
  setBadgeText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  setBadgeTextStrong: {
    color: colors.textPrimary,
  },
  setTable: {
    backgroundColor: colors.surface2,
    borderRadius: radii.inner,
    gap: 2,
    marginTop: spacing.sm,
    padding: spacing.xs,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 4,
  },
  tableHeadCell: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  tableRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 34,
  },
  tableCell: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  tableIcon: {
    flex: 1,
  },
  inputRow: {
    borderStyle: 'dashed',
  },
  inputCell: {
    color: colors.amberLight,
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
  },
  timerWrap: {
    left: 16,
    position: 'absolute',
    right: 16,
  },
  timerBar: {
    backgroundColor: colors.amber,
    borderRadius: radii.card,
    minHeight: 78,
    overflow: 'hidden',
  },
  timerFill: {
    backgroundColor: colors.amberLight,
    bottom: 0,
    left: 0,
    opacity: 0.45,
    position: 'absolute',
    top: 0,
  },
  timerContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timerLabel: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
    opacity: 0.76,
  },
  timerValue: {
    color: colors.background,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 40,
  },
  timerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  timerIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 15, 0.16)',
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    maxHeight: '88%',
    padding: spacing.sm,
    paddingBottom: spacing.md,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  templateGrid: {
    gap: spacing.xs,
  },
  templateCard: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    padding: spacing.sm,
  },
  templateName: {
    color: colors.amberLight,
    fontSize: 17,
    fontWeight: '900',
  },
  templateMeta: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
  dayStrip: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  dayPill: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    minHeight: 62,
    minWidth: 88,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  dayPillActive: {
    backgroundColor: colors.amberBg,
    borderColor: colors.amber,
  },
  dayPillToday: {
    borderColor: colors.amberLight,
  },
  dayPillLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  dayPillLabelActive: {
    color: colors.amberLight,
  },
  dayPillName: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 3,
  },
  dayPillNameActive: {
    color: colors.textPrimary,
  },
  schedulePreview: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  schedulePreviewHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  scheduleTitleWrap: {
    flex: 1,
  },
  todayBadge: {
    backgroundColor: colors.amber,
    borderRadius: radii.pill,
    color: colors.background,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  scheduleRestBox: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  scheduleRestText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  scheduleExerciseList: {
    gap: spacing.xs,
  },
  scheduleExerciseRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.xs,
  },
  scheduleExerciseName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  scheduleExerciseMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  exerciseResults: {
    maxHeight: 260,
  },
  resultRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 62,
    paddingVertical: spacing.xs,
  },
  resultTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  resultMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  formInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.amber,
    borderRadius: radii.inner,
    minHeight: 48,
    justifyContent: 'center',
  },
  saveButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '900',
  },
  logExerciseName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  previousText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  logInputs: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  logInputWrap: {
    flex: 1,
    gap: 5,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  bigInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    minHeight: 62,
    paddingHorizontal: spacing.sm,
  },
  });
}
