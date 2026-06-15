import { describe, expect, it } from 'vitest';

import { calculateGoalScore, calculateLifeScore, calculateMacros, calculateStreak, calculateTDEE } from '../lib/calculations';

describe('calculations', () => {
  it('calculates male TDEE using the configured activity multiplier', () => {
    expect(calculateTDEE(75, 175, 29, 'moderate', 'male')).toBe(2641);
  });

  it('calculates goal-aware macro targets from calories', () => {
    expect(calculateMacros(2400, 'cut')).toEqual({ protein: 180, carbs: 270, fat: 67 });
    expect(calculateMacros(2400, 'bulk')).toEqual({ protein: 150, carbs: 282, fat: 75 });
  });

  it('clamps life and goal scores into a 0-100 range', () => {
    expect(calculateGoalScore(15, 10)).toBe(100);
    expect(
      calculateLifeScore({
        nutritionScore: 120,
        fitnessScore: 80,
        productivityScore: -20,
        hydrationScore: 100,
        alignmentScore: 50,
      }),
    ).toBe(70);
  });

  it('counts streaks across completed days while skipping rest days', () => {
    const today = new Date('2026-06-14T10:00:00.000Z');
    expect(calculateStreak(['2026-06-14', '2026-06-12'], today, { restDayIndexes: [6] })).toBe(2);
  });
});
