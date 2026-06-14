import { supabase } from '@/lib/supabase';
import { todayKey } from '@/lib/workoutPlan';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;
type WorkoutTaskPlan = {
  name: string;
  splitName: string;
  isRestDay: boolean;
  exercises: unknown[];
};

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function workoutTaskTitle(workout: WorkoutTaskPlan) {
  return `Workout: ${workout.name}`;
}

export function isWorkoutTask(row: LooseRow) {
  return asText(row.category).toLowerCase() === 'fitness' || asText(row.title).toLowerCase().startsWith('workout:');
}

function matchesWorkoutTask(row: LooseRow, workout: WorkoutTaskPlan) {
  return isWorkoutTask(row) && asText(row.title) === workoutTaskTitle(workout);
}

export async function ensureTodayWorkoutTask(
  workout: WorkoutTaskPlan,
  userId: string,
  existingTasks: LooseRow[] = [],
) {
  if (!userId) return null;
  if (workout.isRestDay || workout.exercises.length === 0) return null;

  const date = todayKey();
  const existing = existingTasks.find(
    (task) => asText(task.user_id) === userId && asText(task.date).slice(0, 10) === date && matchesWorkoutTask(task, workout),
  );
  if (existing) return existing;

  const { data: rows, error: readError } = await supabase
    .from('tasks')
    .select('*')
    .eq('date', date)
    .eq('user_id', userId)
    .eq('category', 'fitness');

  if (readError) {
    console.warn('Unable to check workout task', readError.message);
    return null;
  }

  const found = ((rows ?? []) as LooseRow[]).find((task) => matchesWorkoutTask(task, workout));
  if (found) return found;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      title: workoutTaskTitle(workout),
      date,
      time_block: '6:30 PM',
      completed: false,
      priority: 'medium',
      category: 'fitness',
      notes: `Profile split: ${workout.splitName}`,
    })
    .select('*')
    .single();

  if (error) {
    console.warn('Unable to create workout task', error.message);
    return null;
  }

  return data as LooseRow;
}

export async function completeTodayWorkoutTask(workout: WorkoutTaskPlan, userId: string) {
  if (!userId) return null;
  if (workout.isRestDay || workout.exercises.length === 0) return null;

  const { data, error } = await supabase
    .from('tasks')
    .update({ completed: true })
    .eq('user_id', userId)
    .eq('date', todayKey())
    .eq('category', 'fitness')
    .select('*')
    .limit(20);

  if (error) {
    console.warn('Unable to complete workout task', error.message);
    return null;
  }

  return ((data ?? [])[0] ?? null) as LooseRow | null;
}
