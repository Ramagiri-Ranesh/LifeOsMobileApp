import { describe, expect, it } from 'vitest';

import { resolveServingNutrition } from '../lib/nutritionFood';

describe('nutrition food mapping', () => {
  it('derives serving macros from populated per-100g columns when legacy macros are zero', () => {
    const food = resolveServingNutrition({
      id: 'punugulu',
      name: 'Punugulu',
      serving: '1 piece',
      calories: 41,
      protein: 0,
      carbs: 0,
      fat: 0,
      calories_per_100g: 275,
      protein_per_100g: 6.5,
      carbs_per_100g: 26,
      fat_per_100g: 16,
    });

    expect(food).toMatchObject({ calories: 41, protein: 1, carbs: 3.9, fat: 2.4 });
  });

  it('preserves direct serving macros when they are populated', () => {
    expect(resolveServingNutrition({
      id: 'food', name: 'Food', calories: '100', protein: '7.5', carbs: '12', fat: '2',
      protein_per_100g: 99,
    })).toMatchObject({ calories: 100, protein: 7.5, carbs: 12, fat: 2 });
  });
});
