export type CatalogMuscleGroup = 'chest' | 'shoulders' | 'triceps' | 'back' | 'biceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core';

export type CatalogExercise = {
  name: string;
  muscleGroup: CatalogMuscleGroup;
  targetSets: number;
  reps: number;
};

const exercise = (name: string, muscleGroup: CatalogMuscleGroup, reps = 10, targetSets = 3): CatalogExercise => ({
  name,
  muscleGroup,
  targetSets,
  reps,
});

export const WORKOUT_EXERCISES = {
  push: [
    exercise('Barbell Bench Press', 'chest', 8, 4), exercise('Dumbbell Bench Press', 'chest'),
    exercise('Machine Chest Press', 'chest'), exercise('Incline Dumbbell Press', 'chest'),
    exercise('Incline Machine Chest Press', 'chest'), exercise('Pec Deck Fly', 'chest', 12),
    exercise('Cable Chest Fly', 'chest', 12), exercise('Seated Shoulder Press Machine', 'shoulders'),
    exercise('Dumbbell Shoulder Press', 'shoulders'), exercise('Dumbbell Lateral Raise', 'shoulders', 12),
    exercise('Cable Lateral Raise', 'shoulders', 12), exercise('Front Raise', 'shoulders', 12),
    exercise('Triceps Rope Pushdown', 'triceps', 12), exercise('Overhead Dumbbell Triceps Extension', 'triceps', 12),
    exercise('Close-Grip Bench Press', 'triceps', 8),
  ],
  pull: [
    exercise('Lat Pulldown', 'back'), exercise('Assisted Pull-Up', 'back', 8),
    exercise('Seated Cable Row', 'back'), exercise('Chest Supported Row', 'back'),
    exercise('One Arm Dumbbell Row', 'back'), exercise('Machine Row', 'back'),
    exercise('Barbell Bent Over Row', 'back', 8), exercise('Straight Arm Pulldown', 'back', 12),
    exercise('Face Pull', 'shoulders', 12), exercise('Rear Delt Fly Machine', 'shoulders', 12),
    exercise('Dumbbell Shrugs', 'back', 12), exercise('Barbell Curl', 'biceps', 10),
    exercise('Dumbbell Curl', 'biceps', 10), exercise('Hammer Curl', 'biceps', 10),
    exercise('Cable Curl', 'biceps', 12),
  ],
  legs: [
    exercise('Bodyweight Squat', 'quads', 15), exercise('Goblet Squat', 'quads'),
    exercise('Barbell Squat', 'quads', 8, 4), exercise('Leg Press', 'quads'),
    exercise('Hack Squat Machine', 'quads'), exercise('Leg Extension', 'quads', 12),
    exercise('Romanian Deadlift', 'hamstrings', 8), exercise('Lying Leg Curl', 'hamstrings', 12),
    exercise('Seated Leg Curl', 'hamstrings', 12), exercise('Walking Lunges', 'glutes', 12),
    exercise('Bulgarian Split Squat', 'glutes', 10), exercise('Hip Thrust', 'glutes', 10),
    exercise('Glute Bridge', 'glutes', 12), exercise('Standing Calf Raise', 'calves', 15),
    exercise('Seated Calf Raise', 'calves', 15),
  ],
  upper: [
    exercise('Incline Dumbbell Press', 'chest'), exercise('Machine Chest Press', 'chest'),
    exercise('Pec Deck Fly', 'chest', 12), exercise('Lat Pulldown', 'back'),
    exercise('Seated Cable Row', 'back'), exercise('Machine Row', 'back'),
    exercise('Dumbbell Shoulder Press', 'shoulders'), exercise('Lateral Raise', 'shoulders', 12),
    exercise('Face Pull', 'shoulders', 12), exercise('Rear Delt Fly', 'shoulders', 12),
    exercise('Triceps Rope Pushdown', 'triceps', 12), exercise('Overhead Triceps Extension', 'triceps', 12),
    exercise('Dumbbell Curl', 'biceps'), exercise('Hammer Curl', 'biceps'), exercise('Cable Curl', 'biceps', 12),
  ],
  lower: [
    exercise('Leg Press', 'quads'), exercise('Goblet Squat', 'quads'),
    exercise('Barbell Squat', 'quads', 8, 4), exercise('Romanian Deadlift', 'hamstrings', 8),
    exercise('Deadlift Light', 'hamstrings', 8), exercise('Leg Extension', 'quads', 12),
    exercise('Seated Leg Curl', 'hamstrings', 12), exercise('Lying Leg Curl', 'hamstrings', 12),
    exercise('Walking Lunges', 'glutes', 12), exercise('Step-Ups', 'glutes', 10),
    exercise('Hip Thrust', 'glutes', 10), exercise('Standing Calf Raise', 'calves', 15),
    exercise('Seated Calf Raise', 'calves', 15), exercise('Plank', 'core', 45),
    exercise('Hanging Knee Raise', 'core', 12),
  ],
} as const;

export function exercisesForWorkoutLabel(label: string): CatalogExercise[] {
  const key = label.toLowerCase();
  if (/(rest|recover|recovery|mobility|walk|off)/i.test(label)) return [];
  if (key.includes('push')) return [...WORKOUT_EXERCISES.push];
  if (key.includes('pull')) return [...WORKOUT_EXERCISES.pull];
  if (key.includes('lower')) return [...WORKOUT_EXERCISES.lower];
  if (key.includes('leg')) return [...WORKOUT_EXERCISES.legs];
  if (key.includes('upper')) return [...WORKOUT_EXERCISES.upper];
  return [
    WORKOUT_EXERCISES.legs[2], WORKOUT_EXERCISES.push[0], WORKOUT_EXERCISES.pull[0],
    WORKOUT_EXERCISES.upper[6], WORKOUT_EXERCISES.lower[13],
  ].map((item) => ({ ...item }));
}

export const EXERCISE_CATALOG = Array.from(
  new Map(Object.values(WORKOUT_EXERCISES).flat().map((item) => [item.name, item])).values(),
);
