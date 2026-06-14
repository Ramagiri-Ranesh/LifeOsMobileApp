import type { MealType } from '@/stores/useNutritionStore';

export const MEAL_META: Record<MealType, { label: string; emoji: string; fallbackTime: string }> = {
  breakfast: { label: 'Breakfast', emoji: '🍳', fallbackTime: '08:00' },
  mid_morning: { label: 'Mid-morning', emoji: '🥤', fallbackTime: '11:00' },
  lunch: { label: 'Lunch', emoji: '🍛', fallbackTime: '13:30' },
  evening_snack: { label: 'Evening Snack', emoji: '🍌', fallbackTime: '17:00' },
  dinner: { label: 'Dinner', emoji: '🍽️', fallbackTime: '20:00' },
  bedtime_snack: { label: 'Bedtime Snack', emoji: '🥛', fallbackTime: '22:00' },
};

export const MEAL_ORDER: MealType[] = ['breakfast', 'mid_morning', 'lunch', 'evening_snack', 'dinner', 'bedtime_snack'];

export function mealFallbackTime(mealType: MealType) {
  return MEAL_META[mealType].fallbackTime;
}
