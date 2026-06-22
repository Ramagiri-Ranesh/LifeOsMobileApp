import { describe, expect, it } from 'vitest';

import { buildTodaysWorkoutTemplate, buildWorkoutTemplates, isRestWorkoutLabel, todayKey, weekdayIndex } from '../lib/workoutPlan';
import type { GeneratedPlan, UserProfile } from '../stores/useUserStore';

const profile: UserProfile = {
  id: 'user-1',
  username: 'tester',
  name: 'Tester',
  gender: 'male',
  age: 29,
  heightCm: 175,
  weightKg: 75,
  targetWeightKg: 72,
  gymDaysPerWeek: 4,
  split: 'Upper Lower',
  waterTargetMl: 3000,
  currency: 'INR',
  measurements: 'metric',
};

describe('workout plan', () => {
  it('formats local date keys and Monday-based weekday indexes', () => {
    const date = new Date('2026-06-14T12:00:00.000Z');
    expect(todayKey(date)).toBe('2026-06-14');
    expect(weekdayIndex(date)).toBe(6);
  });

  it('recognizes recovery labels as rest workouts', () => {
    expect(isRestWorkoutLabel('Mobility and recovery')).toBe(true);
    expect(isRestWorkoutLabel('Push')).toBe(false);
  });

  it('builds seven templates from a generated plan and preserves rest days', () => {
    const plan: GeneratedPlan = {
      workoutSplit: 'Push Pull Legs',
      dayPills: ['Push', 'Pull', 'Rest', 'Legs', 'Upper', 'Lower', 'Recovery'],
      firstWeekGoals: [],
      waterTargetMl: 3000,
    };

    const templates = buildWorkoutTemplates(plan, profile, new Date('2026-06-08T08:00:00.000Z'));
    expect(templates).toHaveLength(7);
    expect(templates[0].exercises.length).toBeGreaterThan(0);
    expect(templates[2].isRestDay).toBe(true);
    expect(templates[2].exercises).toEqual([]);
  });

  it('selects today from the generated weekly template list', () => {
    const plan: GeneratedPlan = {
      workoutSplit: 'Push Pull Legs',
      dayPills: ['Push', 'Pull', 'Rest', 'Legs', 'Upper', 'Lower', 'Recovery'],
      firstWeekGoals: [],
      waterTargetMl: 3000,
    };

    const today = buildTodaysWorkoutTemplate(plan, profile, new Date('2026-06-10T08:00:00.000Z'));
    expect(today.name).toBe('Rest Day');
    expect(today.isRestDay).toBe(true);
  });

  it('uses the requested full Push and Pull exercise catalogues', () => {
    const plan: GeneratedPlan = {
      workoutSplit: 'Push Pull Legs',
      dayPills: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Recovery'],
      firstWeekGoals: [],
      waterTargetMl: 2250,
    };
    const templates = buildWorkoutTemplates(plan, profile);
    expect(templates[0].exercises).toHaveLength(15);
    expect(templates[0].exercises.map((item) => item.name)).toContain('Close-Grip Bench Press');
    expect(templates[1].exercises).toHaveLength(15);
    expect(templates[1].exercises.map((item) => item.name)).toEqual(expect.arrayContaining([
      'Assisted Pull-Up', 'Chest Supported Row', 'Rear Delt Fly Machine', 'Hammer Curl',
    ]));
    expect(templates[2].exercises).toHaveLength(15);
    expect(templates[3].exercises).toHaveLength(15);
    expect(templates[4].exercises).toHaveLength(15);
  });
});
