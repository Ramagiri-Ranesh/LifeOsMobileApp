import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import { resolveServingNutrition } from '@/lib/nutritionFood';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

export type MealType = 'breakfast' | 'mid_morning' | 'lunch' | 'evening_snack' | 'dinner' | 'bedtime_snack';

export type FoodItem = {
  id: string;
  name: string;
  serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type MealLogItem = {
  id: string;
  foodId?: string;
  name: string;
  qty: number;
  serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type Meal = {
  id: string;
  name: string;
  type: MealType;
  time: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items: MealLogItem[];
};

export type MealTemplate = {
  id: string;
  name: string;
  mealType: MealType;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items: MealLogItem[];
};

const INDIAN_FOODS: FoodItem[] = [
  { id: 'fallback-banana', name: 'Banana', serving: '1 medium', calories: 105, protein: 1.3, carbs: 27, fat: 0.4 },
  { id: 'fallback-whole-milk', name: 'Whole milk', serving: '100ml', calories: 65, protein: 3.2, carbs: 4.8, fat: 3.5 },
  { id: 'fallback-egg', name: 'Egg', serving: '1 egg', calories: 66.7, protein: 5.27, carbs: 0.4, fat: 4.8 },
  { id: 'fallback-almonds', name: 'Almonds', serving: '5 almonds', calories: 35, protein: 1.1, carbs: 1.2, fat: 3 },
  { id: 'fallback-chapathi', name: 'Chapathi', serving: '1 piece', calories: 120, protein: 3.6, carbs: 22, fat: 3 },
  { id: 'fallback-ghee', name: 'Ghee', serving: '1 tbsp', calories: 120, protein: 0, carbs: 0, fat: 14 },
  { id: 'fallback-curry-mixed-veg', name: 'Curry (mixed veg)', serving: '150g', calories: 140, protein: 4, carbs: 18, fat: 6 },
  { id: 'fallback-white-rice', name: 'White rice', serving: '200g cooked', calories: 260, protein: 5.4, carbs: 56, fat: 0.6 },
  { id: 'fallback-peanuts', name: 'Peanuts', serving: '30g', calories: 170, protein: 7.7, carbs: 4.8, fat: 14.8 },
  { id: 'fallback-chenigapappu', name: 'Chenigapappu (Senagapappu)', serving: '30g', calories: 110, protein: 6, carbs: 18, fat: 1.8 },
  { id: 'fallback-dal', name: 'Dal', serving: '150g', calories: 180, protein: 10, carbs: 28, fat: 3 },
  { id: 'fallback-paneer', name: 'Paneer', serving: '100g', calories: 265, protein: 18, carbs: 3, fat: 20 },
  { id: 'fallback-idli', name: 'Idli', serving: '1 piece', calories: 58, protein: 2, carbs: 12, fat: 0.4 },
  { id: 'fallback-dosa', name: 'Dosa', serving: '1 dosa', calories: 165, protein: 4, carbs: 28, fat: 4 },
  { id: 'fallback-biryani', name: 'Biryani', serving: '1 plate', calories: 520, protein: 22, carbs: 64, fat: 18 },
  { id: 'fallback-sambar', name: 'Sambar', serving: '150g', calories: 120, protein: 5, carbs: 18, fat: 3 },
];

type NutritionState = {
  todaysMeals: Meal[];
  calories: number;
  waterMl: number;
  templates: MealTemplate[];
  currentDate: string;
  loading: boolean;
  addMeal: (meal: Meal) => void;
  setDailyData: (date: string, meals: Meal[]) => void;
  loadDailyData: (date: string) => Promise<void>;
  searchFoods: (query: string) => Promise<FoodItem[]>;
  addFoodItem: (food: Omit<FoodItem, 'id'>) => Promise<FoodItem | null>;
  logMealItem: (
    date: string,
    mealType: MealType,
    food: FoodItem,
    qty: number,
    options?: { saveAsTemplate?: boolean; templateName?: string },
  ) => Promise<void>;
  applyTemplate: (date: string, mealType: MealType, template: MealTemplate) => Promise<void>;
  deleteMealItem: (date: string, mealType: MealType, itemId: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  setWaterMl: (waterMl: number) => void;
};

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberFromColumns(row: LooseRow, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function textFromColumns(row: LooseRow, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return fallback;
}

function normalizedFoodName(name: string) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fallbackForFoodName(name: string) {
  const normalized = normalizedFoodName(name);
  return INDIAN_FOODS.find((food) => {
    const fallbackName = normalizedFoodName(food.name);
    return normalized === fallbackName || normalized.includes(fallbackName) || fallbackName.includes(normalized);
  });
}

function asMealType(value: Json | undefined): MealType {
  const text = asText(value).toLowerCase();
  if (
    text === 'breakfast' ||
    text === 'mid_morning' ||
    text === 'lunch' ||
    text === 'evening_snack' ||
    text === 'dinner' ||
    text === 'bedtime_snack'
  ) {
    return text;
  }
  if (text === 'snack') return 'evening_snack';
  return 'evening_snack';
}

function titleMeal(type: MealType) {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function rowId(row: LooseRow, fallback: string) {
  const id = row.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : fallback;
}

function dbFoodId(foodId?: string) {
  if (!foodId || foodId.startsWith('fallback-') || foodId.startsWith('local-') || foodId.startsWith('coach-')) return null;
  return foodId;
}

function foodFromRow(row: LooseRow): FoodItem {
  const fallback = fallbackForFoodName(asText(row.name));
  const { calories, protein, carbs, fat } = resolveServingNutrition(row);

  return {
    id: rowId(row, `food-${Date.now()}`),
    name: asText(row.name, 'Food item'),
    serving: textFromColumns(row, ['serving', 'serving_size', 'portion', 'unit'], fallback?.serving ?? 'serving'),
    calories: calories || fallback?.calories || 0,
    protein: protein || fallback?.protein || 0,
    carbs: carbs || fallback?.carbs || 0,
    fat: fat || fallback?.fat || 0,
  };
}

function itemFromRows(item: LooseRow, food?: LooseRow): MealLogItem {
  const qty = asNumber(item.qty) || asNumber(item.quantity, 1);
  const source = food ?? item;
  const sourceFood = foodFromRow(source);
  return {
    id: rowId(item, `item-${Date.now()}`),
    foodId: typeof item.food_item_id === 'string' ? item.food_item_id : rowId(source, ''),
    name: asText(item.name) || asText(source.name, 'Food item'),
    qty,
    serving: asText(item.serving) || asText(source.serving) || asText(source.unit) || 'serving',
    calories: asNumber(item.calories) || Math.round(sourceFood.calories * qty),
    protein: asNumber(item.protein) || Math.round(sourceFood.protein * qty * 10) / 10,
    carbs: asNumber(item.carbs) || Math.round(sourceFood.carbs * qty * 10) / 10,
    fat: asNumber(item.fat) || Math.round(sourceFood.fat * qty * 10) / 10,
  };
}

function mealFromLog(log: LooseRow, index: number): Meal {
  const type = asMealType(log.meal_type ?? log.type);
  const rawItems = Array.isArray(log.meal_log_items) ? log.meal_log_items : [];
  const items = rawItems.map((raw, itemIndex) => {
    const item = raw && typeof raw === 'object' ? (raw as LooseRow) : {};
    const food = item.food_items && typeof item.food_items === 'object' ? (item.food_items as LooseRow) : undefined;
    return itemFromRows({ id: `item-${index}-${itemIndex}`, ...item }, food);
  });

  return {
    id: rowId(log, `meal-${type}`),
    name: asText(log.name) || titleMeal(type),
    type,
    time: asText(log.time) || asText(log.logged_at).slice(11, 16) || asText(log.created_at).slice(11, 16) || '--:--',
    calories: items.length ? items.reduce((total, item) => total + item.calories, 0) : asNumber(log.calories),
    protein: items.length ? items.reduce((total, item) => total + item.protein, 0) : asNumber(log.protein),
    carbs: items.length ? items.reduce((total, item) => total + item.carbs, 0) : asNumber(log.carbs),
    fat: items.length ? items.reduce((total, item) => total + item.fat, 0) : asNumber(log.fat),
    items,
  };
}

function templateFromRow(row: LooseRow, index: number): MealTemplate {
  const rawItems = Array.isArray(row.meal_template_items) ? row.meal_template_items : [];
  const items = rawItems.map((raw, itemIndex) => {
    const item = raw && typeof raw === 'object' ? (raw as LooseRow) : {};
    const food = item.food_items && typeof item.food_items === 'object' ? (item.food_items as LooseRow) : undefined;
    return itemFromRows({ id: `template-${index}-${itemIndex}`, ...item }, food);
  });

  return {
    id: rowId(row, `template-${index}`),
    name: asText(row.name, 'Meal template'),
    mealType: asMealType(row.meal_type ?? row.type),
    calories: items.length ? items.reduce((total, item) => total + item.calories, 0) : asNumber(row.calories),
    protein: items.length ? items.reduce((total, item) => total + item.protein, 0) : asNumber(row.protein),
    carbs: items.length ? items.reduce((total, item) => total + item.carbs, 0) : asNumber(row.carbs),
    fat: items.length ? items.reduce((total, item) => total + item.fat, 0) : asNumber(row.fat),
    items,
  };
}

function scaleFood(food: FoodItem, qty: number): MealLogItem {
  return {
    id: `local-${Date.now()}`,
    foodId: food.id,
    name: food.name,
    qty,
    serving: food.serving,
    calories: Math.round(food.calories * qty),
    protein: Math.round(food.protein * qty * 10) / 10,
    carbs: Math.round(food.carbs * qty * 10) / 10,
    fat: Math.round(food.fat * qty * 10) / 10,
  };
}

function upsertMeal(meals: Meal[], date: string, mealType: MealType, item: MealLogItem) {
  const existing = meals.find((meal) => meal.type === mealType);
  if (!existing) {
    return [
      ...meals,
      {
        id: `local-${date}-${mealType}`,
        name: titleMeal(mealType),
        type: mealType,
        time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false }),
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        items: [item],
      },
    ];
  }

  return meals.map((meal) =>
    meal.type === mealType
      ? {
          ...meal,
          calories: meal.calories + item.calories,
          protein: meal.protein + item.protein,
          carbs: meal.carbs + item.carbs,
          fat: meal.fat + item.fat,
          items: [...meal.items, item],
        }
      : meal,
  );
}

function currentUserId() {
  return useUserStore.getState().currentUserId;
}

async function getOrCreateMealLog(date: string, mealType: MealType, userId: string) {
  const { data: existing } = await supabase
    .from('meal_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('meal_type', mealType)
    .maybeSingle();

  if (existing && typeof (existing as LooseRow).id !== 'undefined') return String((existing as LooseRow).id);

  const { data, error } = await supabase
    .from('meal_logs')
    .insert({ user_id: userId, date, meal_type: mealType, name: titleMeal(mealType) })
    .select('*')
    .single();

  if (error) throw error;
  return String((data as LooseRow).id);
}

async function createTemplateFromFood(userId: string, mealType: MealType, food: FoodItem, item: MealLogItem, templateName?: string) {
  const name = templateName?.trim() || `${titleMeal(mealType)} - ${food.name}`;
  const { data: template, error } = await supabase
    .from('meal_templates')
    .insert({
      user_id: userId,
      name,
      meal_type: mealType,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    })
    .select('*')
    .single();

  if (error) throw error;

  const templateId = rowId(template as LooseRow, '');
  const { error: itemError } = await supabase.from('meal_template_items').insert({
    meal_template_id: templateId,
    food_item_id: dbFoodId(food.id),
    name: food.name,
    serving: food.serving,
    qty: item.qty,
    quantity: item.qty,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  });

  if (itemError) throw itemError;

  return {
    id: templateId,
    name,
    mealType,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    items: [{ ...item, id: `template-${templateId}` }],
  };
}

export const useNutritionStore = create<NutritionState>((set) => ({
  todaysMeals: [],
  calories: 0,
  waterMl: 0,
  currentDate: '',
  loading: false,
  templates: [],
  addMeal: (meal) =>
    set((state) => ({
      todaysMeals: [...state.todaysMeals, meal],
      calories: state.calories + meal.calories,
    })),
  setDailyData: (date, meals) =>
    set({
      currentDate: date,
      todaysMeals: meals,
      calories: meals.reduce((total, meal) => total + meal.calories, 0),
    }),
  loadDailyData: async (date) => {
    set({ loading: true });
    try {
      const userId = currentUserId();
      if (!userId) {
        set({ currentDate: date, todaysMeals: [], calories: 0 });
        return;
      }

      const { data, error } = await supabase
        .from('meal_logs')
        .select('*, meal_log_items(*, food_items(*))')
        .eq('user_id', userId)
        .eq('date', date);

      if (error) throw error;
      const meals = ((data ?? []) as LooseRow[]).map(mealFromLog);
      set({
        currentDate: date,
        todaysMeals: meals,
        calories: meals.reduce((total, meal) => total + meal.calories, 0),
      });
    } catch (error) {
      console.warn('Unable to load nutrition data', error);
    } finally {
      set({ loading: false });
    }
  },
  searchFoods: async (query) => {
    const normalized = query.trim();
    const userId = currentUserId();
    const request = supabase
      .from('food_items')
      .select('*')
      .or(userId ? `user_id.is.null,user_id.eq.${userId}` : 'user_id.is.null')
      .limit(20);
    const { data, error } = normalized.length > 0 ? await request.ilike('name', `%${normalized}%`) : await request;
    const fallbackResults = INDIAN_FOODS.filter((food) =>
      normalized.length === 0 ? true : food.name.toLowerCase().includes(normalized.toLowerCase()),
    ).slice(0, 20);
    if (error) {
      console.warn('Unable to search foods', error.message);
      return fallbackResults;
    }
    const foods = ((data ?? []) as LooseRow[]).map(foodFromRow);
    const existingNames = new Set(foods.map((food) => food.name.toLowerCase()));
    return [...foods, ...fallbackResults.filter((food) => !existingNames.has(food.name.toLowerCase()))].slice(0, 20);
  },
  addFoodItem: async (food) => {
    const userId = currentUserId();
    const { data, error } = await supabase
      .from('food_items')
      .insert({
        user_id: userId,
        name: food.name,
        serving: food.serving,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
      })
      .select('*')
      .single();

    if (error) {
      console.warn('Unable to add food item', error.message);
      return null;
    }

    return foodFromRow(data as LooseRow);
  },
  logMealItem: async (date, mealType, food, qty, options) => {
    const item = scaleFood(food, qty);
    set((state) => {
      const meals = upsertMeal(state.todaysMeals, date, mealType, item);
      return { todaysMeals: meals, calories: meals.reduce((total, meal) => total + meal.calories, 0) };
    });

    try {
      const userId = currentUserId();
      if (!userId) return;

      const mealLogId = await getOrCreateMealLog(date, mealType, userId);
      const { error } = await supabase.from('meal_log_items').insert({
        meal_log_id: mealLogId,
        food_item_id: dbFoodId(food.id),
        name: food.name,
        serving: food.serving,
        qty,
        quantity: qty,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
      });
      if (error) throw error;

      if (options?.saveAsTemplate) {
        const template = await createTemplateFromFood(userId, mealType, food, item, options.templateName);
        set((state) => ({ templates: [template, ...state.templates] }));
      }
    } catch (error) {
      console.warn('Unable to sync meal item', error);
    }
  },
  applyTemplate: async (date, mealType, template) => {
    set((state) => {
      const meals = template.items.reduce(
        (nextMeals, item) => upsertMeal(nextMeals, date, mealType, { ...item, id: `local-${Date.now()}-${item.id}` }),
        state.todaysMeals,
      );
      return { todaysMeals: meals, calories: meals.reduce((total, meal) => total + meal.calories, 0) };
    });

    try {
      const userId = currentUserId();
      if (!userId) return;

      const mealLogId = await getOrCreateMealLog(date, mealType, userId);
      const rows = template.items.map((item) => ({
        meal_log_id: mealLogId,
        food_item_id: dbFoodId(item.foodId),
        name: item.name,
        serving: item.serving,
        qty: item.qty,
        quantity: item.qty,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
      }));
      const { error } = await supabase.from('meal_log_items').insert(rows);
      if (error) throw error;
    } catch (error) {
      console.warn('Unable to sync template', error);
    }
  },
  deleteMealItem: async (_date, mealType, itemId) => {
    set((state) => {
      const meals = state.todaysMeals
        .map((meal) => {
          if (meal.type !== mealType) return meal;
          const items = meal.items.filter((item) => item.id !== itemId);
          return {
            ...meal,
            items,
            calories: items.reduce((total, item) => total + item.calories, 0),
            protein: items.reduce((total, item) => total + item.protein, 0),
            carbs: items.reduce((total, item) => total + item.carbs, 0),
            fat: items.reduce((total, item) => total + item.fat, 0),
          };
        })
        .filter((meal) => meal.items.length > 0);

      return { todaysMeals: meals, calories: meals.reduce((total, meal) => total + meal.calories, 0) };
    });

    if (!itemId.startsWith('local-')) {
      const { error } = await supabase.from('meal_log_items').delete().eq('id', itemId);
      if (error) console.warn('Unable to delete meal item', error.message);
    }
  },
  loadTemplates: async () => {
    const userId = currentUserId();
    if (!userId) {
      set({ templates: [] });
      return;
    }

    const { data, error } = await supabase
      .from('meal_templates')
      .select('*, meal_template_items(*, food_items(*))')
      .eq('user_id', userId);
    if (error) {
      console.warn('Unable to load meal templates', error.message);
      set({ templates: [] });
      return;
    }
    set({ templates: ((data ?? []) as LooseRow[]).map(templateFromRow) });
  },
  setWaterMl: (waterMl) => set({ waterMl }),
}));
