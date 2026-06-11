import { create } from 'zustand';

export type Meal = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type NutritionState = {
  todaysMeals: Meal[];
  calories: number;
  waterMl: number;
  templates: Meal[];
  addMeal: (meal: Meal) => void;
  setWaterMl: (waterMl: number) => void;
};

export const useNutritionStore = create<NutritionState>((set) => ({
  todaysMeals: [],
  calories: 0,
  waterMl: 0,
  templates: [],
  addMeal: (meal) =>
    set((state) => ({
      todaysMeals: [...state.todaysMeals, meal],
      calories: state.calories + meal.calories,
    })),
  setWaterMl: (waterMl) => set({ waterMl }),
}));
