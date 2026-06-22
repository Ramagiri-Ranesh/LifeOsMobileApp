import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { calculateDailyLifeScore, type DailyLifeScoreInput } from '../lib/lifeScore';

const emptyDay: DailyLifeScoreInput = {
  calories: 0,
  calorieGoal: 2400,
  protein: 0,
  proteinGoal: 160,
  waterMl: 0,
  waterTargetMl: 3000,
  totalTasks: 0,
  completedTasks: 0,
  overdueTasks: 0,
  highPriorityTasks: 0,
  completedHighPriorityTasks: 0,
  isRestDay: false,
  workoutCompleted: false,
  activeSetCount: 0,
};

describe('daily life score', () => {
  it('does not award baseline points when no activity is completed', () => {
    expect(calculateDailyLifeScore(emptyDay)).toMatchObject({
      lifeScore: 0,
      components: {
        nutritionScore: 0,
        fitnessScore: 0,
        productivityScore: 0,
        hydrationScore: 0,
        alignmentScore: 0,
      },
    });
  });

  it('calculates each component from actual progress', () => {
    const result = calculateDailyLifeScore({
      ...emptyDay,
      calories: 1200,
      protein: 80,
      waterMl: 1500,
      totalTasks: 4,
      completedTasks: 2,
      highPriorityTasks: 2,
      completedHighPriorityTasks: 1,
      activeSetCount: 5,
    });

    expect(result.components).toEqual({
      nutritionScore: 50,
      fitnessScore: 50,
      productivityScore: 50,
      hydrationScore: 50,
      alignmentScore: 50,
    });
    expect(result.lifeScore).toBe(50);
  });

  it('gives fitness credit on a planned rest day without inventing other progress', () => {
    const result = calculateDailyLifeScore({ ...emptyDay, isRestDay: true });
    expect(result.components.fitnessScore).toBe(100);
    expect(result.lifeScore).toBe(25);
  });
});
