import type { GeneratedPlan, UserProfile } from '@/stores/useUserStore';

export type PlannedWorkoutExercise = {
  id: string;
  name: string;
  muscleGroup: string;
  targetSets: number;
  previousWeightKg: number;
  previousReps: number;
  lastWeekKg: number;
};

export type PlannedWorkoutTemplate = {
  id: string;
  name: string;
  dayLabel: string;
  date: string;
  weekdayIndex: number;
  splitName: string;
  muscleGroups: string[];
  exercises: PlannedWorkoutExercise[];
  isRestDay: boolean;
};

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workout';
}

export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function weekdayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

export function isRestWorkoutLabel(label: string) {
  return /(rest|recover|recovery|mobility|walk|off)/i.test(label);
}

export function normalizeMuscleName(value: string) {
  const key = value.toLowerCase().trim();
  if (key.includes('shoulder') || key.includes('delt')) return 'shoulders';
  if (key.includes('tricep')) return 'triceps';
  if (key.includes('back') || key.includes('lat') || key.includes('row') || key.includes('pull')) return 'back';
  if (key.includes('bicep') || key.includes('curl')) return 'biceps';
  if (key.includes('quad') || key.includes('squat') || key.includes('leg press')) return 'quads';
  if (key.includes('hamstring') || key.includes('deadlift') || key.includes('hinge')) return 'hamstrings';
  if (key.includes('glute')) return 'glutes';
  if (key.includes('calf')) return 'calves';
  if (key.includes('core') || key.includes('abs') || key.includes('plank')) return 'core';
  if (key.includes('chest') || key.includes('bench') || key.includes('incline') || key.includes('fly')) return 'chest';
  return 'chest';
}

function fallbackDayPills(gymDaysPerWeek = 4) {
  const gymDays = Math.max(1, Math.min(7, Math.round(gymDaysPerWeek)));
  const schedules: Record<number, string[]> = {
    1: ['Rest', 'Mobility', 'Rest', 'Walk', 'Rest', 'Full Body', 'Recovery'],
    2: ['Rest', 'Full Body', 'Walk', 'Rest', 'Mobility', 'Full Body', 'Recovery'],
    3: ['Full Body', 'Rest', 'Full Body', 'Rest', 'Full Body', 'Walk', 'Recovery'],
    4: ['Upper', 'Lower', 'Rest', 'Upper', 'Rest', 'Lower', 'Recovery'],
    5: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Recovery'],
    6: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs', 'Recovery'],
    7: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Mobility', 'Recovery'],
  };
  return schedules[gymDays] ?? schedules[4];
}

function fallbackExercises(label: string): Array<Omit<PlannedWorkoutExercise, 'id' | 'lastWeekKg' | 'previousWeightKg'>> {
  const key = label.toLowerCase();
  if (isRestWorkoutLabel(label)) return [];
  if (key.includes('push')) {
    return [
      { name: 'Bench Press', muscleGroup: 'chest', targetSets: 4, previousReps: 8 },
      { name: 'Incline Press', muscleGroup: 'chest', targetSets: 3, previousReps: 10 },
      { name: 'Shoulder Press', muscleGroup: 'shoulders', targetSets: 3, previousReps: 8 },
      { name: 'Triceps Pushdown', muscleGroup: 'triceps', targetSets: 3, previousReps: 12 },
    ];
  }
  if (key.includes('pull')) {
    return [
      { name: 'Lat Pulldown', muscleGroup: 'back', targetSets: 4, previousReps: 10 },
      { name: 'Row', muscleGroup: 'back', targetSets: 3, previousReps: 8 },
      { name: 'Face Pull', muscleGroup: 'shoulders', targetSets: 3, previousReps: 12 },
      { name: 'Biceps Curl', muscleGroup: 'biceps', targetSets: 3, previousReps: 12 },
    ];
  }
  if (key.includes('leg') || key.includes('lower')) {
    return [
      { name: 'Squat', muscleGroup: 'quads', targetSets: 4, previousReps: 6 },
      { name: 'Romanian Deadlift', muscleGroup: 'hamstrings', targetSets: 3, previousReps: 8 },
      { name: 'Leg Press', muscleGroup: 'quads', targetSets: 3, previousReps: 10 },
      { name: 'Calf Raise', muscleGroup: 'calves', targetSets: 4, previousReps: 14 },
    ];
  }
  if (key.includes('upper')) {
    return [
      { name: 'Bench Press', muscleGroup: 'chest', targetSets: 3, previousReps: 8 },
      { name: 'Row', muscleGroup: 'back', targetSets: 3, previousReps: 8 },
      { name: 'Shoulder Press', muscleGroup: 'shoulders', targetSets: 3, previousReps: 10 },
      { name: 'Biceps Curl', muscleGroup: 'biceps', targetSets: 2, previousReps: 12 },
      { name: 'Triceps Pushdown', muscleGroup: 'triceps', targetSets: 2, previousReps: 12 },
    ];
  }
  return [
    { name: 'Squat', muscleGroup: 'quads', targetSets: 3, previousReps: 6 },
    { name: 'Bench Press', muscleGroup: 'chest', targetSets: 3, previousReps: 8 },
    { name: 'Row', muscleGroup: 'back', targetSets: 3, previousReps: 8 },
    { name: 'Plank', muscleGroup: 'core', targetSets: 3, previousReps: 45 },
  ];
}

function plannedExercises(
  label: string,
  exercises?: NonNullable<GeneratedPlan['weeklyWorkouts']>[number]['exercises'],
) {
  const source = exercises && exercises.length > 0
    ? exercises.map((exercise) => ({
        name: exercise.name,
        muscleGroup: exercise.muscleGroup || normalizeMuscleName(exercise.name),
        targetSets: exercise.targetSets || 3,
        previousReps: exercise.reps || 8,
        weightKg: exercise.weightKg || 0,
      }))
    : fallbackExercises(label).map((exercise) => ({ ...exercise, weightKg: 0 }));

  return source.map((exercise, index) => ({
    id: `${slug(label)}-${slug(exercise.name)}-${index}`,
    name: exercise.name,
    muscleGroup: normalizeMuscleName(exercise.muscleGroup || exercise.name),
    targetSets: Math.max(1, Math.round(exercise.targetSets || 3)),
    previousWeightKg: Math.max(0, Number(exercise.weightKg) || 0),
    previousReps: Math.max(1, Math.round(exercise.previousReps || 8)),
    lastWeekKg: Math.max(0, Number(exercise.weightKg) || 0),
  }));
}

export function buildWorkoutTemplates(
  generatedPlan: GeneratedPlan | null | undefined,
  profile: UserProfile | null | undefined,
  date = new Date(),
) {
  const dayPills = generatedPlan?.dayPills?.length === 7
    ? generatedPlan.dayPills
    : fallbackDayPills(profile?.gymDaysPerWeek);
  const splitName = generatedPlan?.workoutSplit || profile?.split || 'Workout split';
  let workoutCount = 0;

  return dayPills.map((label, index) => {
    const aiDay = generatedPlan?.weeklyWorkouts?.find((day) => day.dayIndex === index);
    const dayName = aiDay?.label || label || WEEKDAY_NAMES[index];
    const isRestDay = aiDay?.isRestDay ?? isRestWorkoutLabel(dayName);
    if (!isRestDay) workoutCount += 1;

    const exercises = isRestDay ? [] : plannedExercises(dayName, aiDay?.exercises);
    const muscleGroups = aiDay?.muscleGroups?.length
      ? aiDay.muscleGroups.map(normalizeMuscleName)
      : Array.from(new Set(exercises.map((exercise) => exercise.muscleGroup)));

    return {
      id: `day-${index}-${slug(dayName)}`,
      name: aiDay?.templateName || (isRestDay ? `${dayName} Day` : `${dayName} Workout`),
      dayLabel: `${WEEKDAY_NAMES[index]} · ${isRestDay ? 'Recovery day' : `Day ${workoutCount} of ${dayPills.filter((pill) => !isRestWorkoutLabel(pill)).length} this week`}`,
      date: todayKey(date),
      weekdayIndex: index,
      splitName,
      muscleGroups,
      exercises,
      isRestDay,
    };
  });
}

export function buildTodaysWorkoutTemplate(
  generatedPlan: GeneratedPlan | null | undefined,
  profile: UserProfile | null | undefined,
  date = new Date(),
) {
  return buildWorkoutTemplates(generatedPlan, profile, date)[weekdayIndex(date)];
}
