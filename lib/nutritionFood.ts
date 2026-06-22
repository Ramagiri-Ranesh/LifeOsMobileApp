type FoodRow = Record<string, unknown>;

function numberFromColumns(row: FoodRow, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function resolveServingNutrition(row: FoodRow) {
  const caloriesPer100g = numberFromColumns(row, ['calories_per_100g']);
  const calories = numberFromColumns(row, ['calories', 'kcal', 'calorie', 'energy_kcal', 'calories_per_serving', 'kcal_per_serving', 'calories_per_unit']) || caloriesPer100g;
  const servingRatio = calories > 0 && caloriesPer100g > 0 ? calories / caloriesPer100g : 1;
  const servingMacro = (directKeys: string[], per100gKeys: string[]) => {
    const direct = numberFromColumns(row, directKeys, NaN);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const per100g = numberFromColumns(row, per100gKeys);
    return per100g > 0 ? Math.round(per100g * servingRatio * 10) / 10 : Math.max(0, direct || 0);
  };

  return {
    calories,
    protein: servingMacro(['protein', 'protein_g', 'protein_per_serving'], ['protein_per_100g']),
    carbs: servingMacro(['carbs', 'carbs_g', 'carbohydrates', 'carbohydrate_g', 'carbs_per_serving'], ['carbs_per_100g']),
    fat: servingMacro(['fat', 'fat_g', 'fat_per_serving'], ['fat_per_100g']),
  };
}
