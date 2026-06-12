import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { colors, radii, spacing, typography } from '@/lib/design';
import { supabase } from '@/lib/supabase';
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
  exercises: Omit<Exercise, 'sets'>[];
};

const REST_SECONDS = 90;

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

const TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'push',
    name: 'Push Day A',
    dayLabel: 'Day 1 of 4 this week',
    exercises: [
      exerciseSeed('bench', 'Barbell Bench Press', 'chest', 4, 72, 70, 8),
      exerciseSeed('incline', 'Incline Dumbbell Press', 'chest', 3, 26, 24, 10),
      exerciseSeed('press', 'Seated Shoulder Press', 'shoulders', 3, 42, 40, 8),
      exerciseSeed('pushdown', 'Cable Triceps Pushdown', 'triceps', 3, 32, 30, 12),
    ],
  },
  {
    id: 'pull',
    name: 'Pull Day A',
    dayLabel: 'Day 2 of 4 this week',
    exercises: [
      exerciseSeed('pulldown', 'Lat Pulldown', 'back', 4, 58, 56, 10),
      exerciseSeed('row', 'Barbell Row', 'back', 3, 62, 60, 8),
      exerciseSeed('curl', 'Dumbbell Curl', 'biceps', 3, 16, 14, 12),
    ],
  },
  {
    id: 'legs',
    name: 'Legs Day A',
    dayLabel: 'Day 3 of 4 this week',
    exercises: [
      exerciseSeed('squat', 'Back Squat', 'quads', 4, 95, 92, 6),
      exerciseSeed('rdl', 'Romanian Deadlift', 'hamstrings', 3, 82, 80, 8),
      exerciseSeed('calf', 'Standing Calf Raise', 'calves', 4, 64, 60, 14),
    ],
  },
  {
    id: 'full',
    name: 'Full Body A',
    dayLabel: 'Day 4 of 4 this week',
    exercises: [
      exerciseSeed('full-squat', 'Back Squat', 'quads', 3, 90, 88, 6),
      exerciseSeed('full-bench', 'Barbell Bench Press', 'chest', 3, 68, 66, 8),
      exerciseSeed('full-row', 'Barbell Row', 'back', 3, 60, 58, 8),
      exerciseSeed('full-plank', 'Plank', 'core', 3, 0, 0, 45),
    ],
  },
];

function exerciseSeed(
  id: string,
  name: string,
  muscleGroup: MuscleGroup,
  targetSets: number,
  lastWeekKg: number,
  previousWeightKg: number,
  previousReps: number,
) {
  return { id, name, muscleGroup, targetSets, lastWeekKg, previousWeightKg, previousReps };
}

function cloneTemplate(template: WorkoutTemplate): Exercise[] {
  return template.exercises.map((exercise) => ({ ...exercise, sets: [] }));
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
  const pulse = useSharedValue(0);
  const timerProgress = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [exercises, setExercises] = useState<Exercise[]>(() => cloneTemplate(TEMPLATES[0]));
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [startModalVisible, setStartModalVisible] = useState(true);
  const [addExerciseVisible, setAddExerciseVisible] = useState(false);
  const [logSetVisible, setLogSetVisible] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [customExerciseName, setCustomExerciseName] = useState('');
  const [setWeight, setSetWeight] = useState('');
  const [setReps, setSetReps] = useState('');
  const [bodyWeight, setBodyWeight] = useState('');
  const [restRemaining, setRestRemaining] = useState(0);
  const [timerPaused, setTimerPaused] = useState(false);
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
  const restWarning = trainedMuscles
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
  }, []);

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
    try {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('workout_sets')
        .select('*, workout_sessions(*)')
        .gte('created_at', since)
        .limit(80);

      if (error) throw error;

      const recent: Partial<Record<MuscleGroup, string>> = {};
      ((data ?? []) as LooseRow[]).forEach((setRow) => {
        const session = setRow.workout_sessions && typeof setRow.workout_sessions === 'object'
          ? (setRow.workout_sessions as LooseRow)
          : {};
        const muscle = normalizeMuscle(asText(setRow.muscle_group) || asText(session.muscle_group) || asText(setRow.exercise_name));
        const date = rowDate(setRow) || rowDate(session);
        if (muscle && date) recent[muscle] = date;
      });

      setRecentMuscles(recent);
    } catch (error) {
      console.warn('Unable to load recent muscle recovery data', error);
      setRecentMuscles({ chest: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    }
  }

  const chooseTemplate = useCallback((nextTemplate: WorkoutTemplate) => {
    setTemplate(nextTemplate);
    setExercises(cloneTemplate(nextTemplate));
    setStartedAt(new Date());
    setStartModalVisible(false);
    stopTimer();
  }, [stopTimer]);

  const openLogSet = useCallback((exercise: Exercise) => {
    setSelectedExerciseId(exercise.id);
    setSetWeight(String(exercise.previousWeightKg || exercise.lastWeekKg || 0));
    setSetReps(String(exercise.previousReps || 8));
    setLogSetVisible(true);
  }, []);

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
    const completedAt = new Date();
    const started = startedAt ?? completedAt;
    const durationMinutes = Math.max(1, Math.round((completedAt.getTime() - started.getTime()) / 60000));
    const muscles = Array.from(new Set(exercises.filter((exercise) => exercise.sets.length > 0).map((exercise) => exercise.muscleGroup)));

    try {
      const { data: session, error } = await supabase
        .from('workout_sessions')
        .insert({
          name: template.name,
          template_id: template.id,
          started_at: started.toISOString(),
          completed_at: completedAt.toISOString(),
          duration_minutes: durationMinutes,
          total_volume_kg: volume,
          sets_done: setTotals.done,
          sets_target: setTotals.target,
          muscle_group: muscles.join(', '),
        })
        .select('*')
        .single();

      if (error) throw error;
      const sessionId = String((session as LooseRow).id ?? `local-${Date.now()}`);
      const rows = exercises.flatMap((exercise) =>
        exercise.sets.map((set, index) => ({
          workout_session_id: sessionId,
          exercise_name: exercise.name,
          muscle_group: exercise.muscleGroup,
          set_number: index + 1,
          weight_kg: set.weightKg,
          reps: set.reps,
          created_at: set.completedAt,
        })),
      );
      if (rows.length > 0) await supabase.from('workout_sets').insert(rows);
      const weight = Number(bodyWeight);
      if (Number.isFinite(weight) && weight > 0) {
        await supabase.from('body_metrics').insert({ date: completedAt.toISOString().slice(0, 10), weight_kg: weight });
      }
      Alert.alert('Workout saved', `${template.name} logged with ${Math.round(volume).toLocaleString()} kg total volume.`);
    } catch (error) {
      console.warn('Unable to save workout', error);
      Alert.alert('Workout complete', 'Saved locally for this session. Check Supabase columns if persistence failed.');
    }
  }, [bodyWeight, exercises, setTotals.done, setTotals.target, startedAt, template.id, template.name, volume]);

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
    <View style={styles.screen}>
      <FlatList
        data={exercises}
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
              <View style={styles.headerCopy}>
                <Text style={styles.headerLabel}>Today's Workout</Text>
                <Text style={styles.workoutTitle}>{template.name}</Text>
                <Text style={styles.headerSub}>{template.dayLabel}</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Workout history" style={styles.historyButton} onPress={() => router.push('/workout-history' as never)}>
                <Ionicons name="time-outline" size={22} color={colors.amberLight} />
              </TouchableOpacity>
            </View>

            <View style={styles.summaryCard}>
              <View style={styles.summaryGrid}>
                <StatTile label="Duration" value={`${startedAt ? Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60000)) : 0}m`} />
                <StatTile label="Total Volume kg" value={Math.round(volume).toLocaleString()} />
                <StatTile label="Sets Done" value={`${setTotals.done}/${setTotals.target}`} />
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completion}%` }]} />
              </View>
            </View>

            <View style={styles.heatmapCard}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>Muscle Heatmap</Text>
                  <Text style={styles.cardSubtitle}>{trainedMuscles.map(titleCase).join(' · ')}</Text>
                </View>
                {restWarning ? (
                  <View style={styles.warningBadge}>
                    <Text style={styles.warningText}>⚠ {restWarning}</Text>
                  </View>
                ) : null}
              </View>
              <MuscleHeatmap activeMuscles={trainedMuscles} recentMuscles={recentMuscles} />
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Exercises</Text>
              <View style={styles.sectionActions}>
                <TouchableOpacity style={styles.completeButton} onPress={completeWorkout}>
                  <Ionicons name="flag-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.completeButtonText}>Complete</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={() => setAddExerciseVisible(true)}>
                  <Text style={styles.addButtonText}>Add Exercise +</Text>
                </TouchableOpacity>
              </View>
            </View>
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

      <Modal visible={startModalVisible} animationType="slide" transparent onRequestClose={() => setStartModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Start Workout</Text>
              <TouchableOpacity onPress={() => setStartModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.templateGrid}>
              {TEMPLATES.map((item) => (
                <TouchableOpacity key={item.id} style={styles.templateCard} onPress={() => chooseTemplate(item)}>
                  <Text style={styles.templateName}>{item.name.replace(' A', '')}</Text>
                  <Text style={styles.templateMeta}>{item.exercises.length} exercises · {item.dayLabel}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              placeholder="Body weight today (optional)"
              placeholderTextColor={colors.textMuted}
              value={bodyWeight}
              onChangeText={setBodyWeight}
              keyboardType="decimal-pad"
              style={styles.formInput}
            />
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
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
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

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.sm,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
  },
  headerLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  workoutTitle: {
    color: colors.amber,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
  },
  headerSub: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
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
    gap: spacing.sm,
    padding: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statTile: {
    backgroundColor: colors.amberBg,
    borderColor: 'rgba(245, 158, 11, 0.28)',
    borderRadius: radii.inner,
    borderWidth: 1,
    flex: 1,
    minHeight: 76,
    justifyContent: 'center',
    padding: spacing.xs,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
    marginTop: 3,
  },
  progressTrack: {
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.amber,
    borderRadius: radii.pill,
    height: 6,
  },
  heatmapCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.sm,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  cardSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
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
    marginTop: spacing.xs,
  },
  heatmapLabels: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: -6,
  },
  heatmapLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
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
  completeButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
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
