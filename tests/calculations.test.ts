import { describe, expect, it } from 'vitest';

import { calculateGoalCalorieTarget, calculateGoalScore, calculateHydrationTarget, calculateLifeScore, calculateMacros, calculateStreak, calculateTDEE, normalizeWaterTargetMl, suggestedTargetDate } from '../lib/calculations';

describe('calculations', () => {
  it('calculates male TDEE using the configured activity multiplier', () => {
    expect(calculateTDEE(75, 175, 29, 'moderate', 'male')).toBe(2641);
  });

  it('calculates goal-aware macro targets from calories', () => {
    expect(calculateMacros(2400, 'cut')).toEqual({ protein: 180, carbs: 270, fat: 67 });
    expect(calculateMacros(2400, 'bulk')).toEqual({ protein: 150, carbs: 282, fat: 75 });
  });

  it('adds a target-date surplus instead of returning maintenance calories', () => {
    expect(calculateGoalCalorieTarget({
      maintenanceCalories: 1967,
      currentWeightKg: 70,
      targetWeightKg: 72,
      targetDate: '2026-07-20',
      goal: 'bulk',
      now: new Date('2026-06-22T12:00:00'),
    })).toMatchObject({ maintenanceCalories: 1967, calorieAdjustment: 550, calorieTarget: 2517, plannedWeeklyChangeKg: 0.5 });
  });

  it('caps aggressive target dates at the ideal 0.5 kg weekly pace', () => {
    const result = calculateGoalCalorieTarget({
      maintenanceCalories: 2400,
      currentWeightKg: 80,
      targetWeightKg: 70,
      targetDate: '2026-07-06',
      goal: 'cut',
      now: new Date('2026-06-22T12:00:00'),
    });
    expect(result.plannedWeeklyChangeKg).toBe(-0.5);
    expect(result.calorieTarget).toBe(1850);
    expect(suggestedTargetDate(80, 70, new Date('2026-06-22T12:00:00'))).toBe('2026-11-09');
  });

  it('uses the selected 0-1 kg weekly pace for surplus, deficit, and maintenance', () => {
    const bulk = calculateGoalCalorieTarget({
      maintenanceCalories: 1967,
      currentWeightKg: 65,
      targetWeightKg: 70,
      weeklyWeightChangeKg: 1,
      goal: 'bulk',
      now: new Date('2026-06-22T12:00:00'),
    });
    expect(bulk).toMatchObject({ calorieAdjustment: 1100, calorieTarget: 3067, plannedWeeklyChangeKg: 1 });
    expect(bulk.targetDate).toBe('2026-07-27');

    expect(calculateGoalCalorieTarget({
      maintenanceCalories: 1967,
      currentWeightKg: 65,
      targetWeightKg: 55,
      weeklyWeightChangeKg: 0,
      goal: 'cut',
    })).toMatchObject({ calorieAdjustment: 0, calorieTarget: 1967, targetDate: '' });
  });

  it('normalizes millilitres and preserves legacy glass-count compatibility outside AI planning', () => {
    expect(normalizeWaterTargetMl(2250, null)).toBe(2250);
    expect(normalizeWaterTargetMl('9 glasses', null)).toBe(2250);
    expect(normalizeWaterTargetMl(null, 9)).toBe(2250);
    expect(normalizeWaterTargetMl('9 glasses', null, 3000, false)).toBe(3000);
    expect(normalizeWaterTargetMl('invalid', null, 3000)).toBe(3000);
  });

  it('calculates required water first and rounds it up into 250ml glasses', () => {
    expect(calculateHydrationTarget(75)).toEqual({ requiredMl: 2625, glasses: 11, waterTargetMl: 2750 });
    expect(calculateHydrationTarget(55)).toEqual({ requiredMl: 2200, glasses: 9, waterTargetMl: 2250 });
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
