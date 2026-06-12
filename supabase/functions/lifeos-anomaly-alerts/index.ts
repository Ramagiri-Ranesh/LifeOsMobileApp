// @ts-nocheck Deno Edge Functions use remote imports that the Expo app tsconfig does not resolve.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

type Alert = {
  title: string;
  body: string;
  route: string;
};

type Meal = {
  calories?: number;
  date?: string;
};

type Habit = {
  name?: string;
  lastLoggedAt?: string;
  last_logged_at?: string;
  completedToday?: boolean;
};

type Payload = {
  calorieGoal?: number;
  gymGoalPerWeek?: number;
  meals?: Meal[];
  habits?: Habit[];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateKey(date);
}

function caloriesByDate(meals: Meal[]) {
  return meals.reduce<Record<string, number>>((totals, meal) => {
    const key = meal.date ?? dateKey(new Date());
    totals[key] = (totals[key] ?? 0) + (typeof meal.calories === 'number' ? meal.calories : 0);
    return totals;
  }, {});
}

function habitLoggedHoursAgo(habit: Habit) {
  const raw = habit.lastLoggedAt ?? habit.last_logged_at;
  if (!raw) return null;
  const loggedAt = new Date(raw).getTime();
  if (!Number.isFinite(loggedAt)) return null;
  return (Date.now() - loggedAt) / 36e5;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const alerts: Alert[] = [];
    const calorieGoal = payload.calorieGoal ?? 2200;
    const gymGoal = payload.gymGoalPerWeek ?? 4;

    const [{ data: mealRows }, { data: workoutRows }, { data: habitRows }] = await Promise.all([
      supabase.from('meal_logs').select('date, calories').gte('date', daysAgo(7)),
      supabase.from('workout_sessions').select('started_at, date').gte('started_at', daysAgo(10)),
      supabase.from('habit_logs').select('habit_name, name, last_logged_at, logged_at, completed_at').order('logged_at', { ascending: false }).limit(20),
    ]);

    const meals = Array.isArray(mealRows) && mealRows.length > 0 ? mealRows as Meal[] : payload.meals ?? [];
    const calorieTotals = caloriesByDate(meals);
    const lowCalorieDays = [0, 1, 2].filter((offset) => (calorieTotals[daysAgo(offset)] ?? 0) < calorieGoal * 0.7);
    if (lowCalorieDays.length >= 3) {
      alerts.push({
        title: 'Nutrition dip detected',
        body: 'Calories are down more than 30% for 3 days. Add an easy protein meal today.',
        route: '/(tabs)/nutrition',
      });
    }

    const workouts = Array.isArray(workoutRows) ? workoutRows : [];
    const recentWorkout = workouts.some((row) => {
      const raw = row.date ?? row.started_at;
      return raw && new Date(raw).getTime() >= Date.now() - 5 * 86400000;
    });
    if (gymGoal >= 4 && !recentWorkout) {
      alerts.push({
        title: 'Gym rhythm slipping',
        body: 'No gym session in 5 days while your goal is 4 per week. Schedule the next lift.',
        route: '/(tabs)/gym',
      });
    }

    const habits = Array.isArray(habitRows) && habitRows.length > 0
      ? habitRows.map((row) => ({
          name: row.habit_name ?? row.name,
          last_logged_at: row.last_logged_at ?? row.logged_at ?? row.completed_at,
        }))
      : payload.habits ?? [];
    const habitAtRisk = habits.find((habit) => {
      const hoursAgo = habitLoggedHoursAgo(habit);
      return hoursAgo !== null && hoursAgo >= 22 && hoursAgo < 24;
    });
    if (habitAtRisk) {
      alerts.push({
        title: 'Habit streak at risk',
        body: `${habitAtRisk.name ?? 'A habit'} was last logged about 22 hours ago.`,
        route: '/(tabs)/habits',
      });
    }

    return Response.json({ alerts }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { alerts: [], error: error instanceof Error ? error.message : 'Unknown error' },
      { headers: corsHeaders, status: 200 },
    );
  }
});
