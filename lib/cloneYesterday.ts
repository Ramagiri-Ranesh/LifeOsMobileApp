import { Alert } from 'react-native';

import { supabase } from './supabase';

type MealLogRow = Record<string, any>;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numberValue(...values: unknown[]) {
  const value = values.find((item) => typeof item === 'number' && Number.isFinite(item));
  return typeof value === 'number' ? value : 0;
}

function textValue(...values: unknown[]) {
  const value = values.find((item) => typeof item === 'string' && item.trim().length > 0);
  return typeof value === 'string' ? value : '';
}

export async function hasMealLogsForDate(date: string): Promise<boolean> {
  const { data, error } = await supabase.from('meal_logs').select('id').eq('date', date).limit(1);
  if (error) {
    console.warn('Unable to check meal logs', error.message);
    return false;
  }
  return Boolean(data?.length);
}

export async function cloneYesterdayMeals(): Promise<boolean> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const todayStr = dateKey(today);
  const yesterdayStr = dateKey(yesterday);

  const { data: logs, error } = await supabase
    .from('meal_logs')
    .select('*, meal_log_items(*)')
    .eq('date', yesterdayStr);

  if (error || !logs?.length) {
    Alert.alert('Nothing to clone', 'No meals found for yesterday.');
    return false;
  }

  const { data: existing } = await supabase.from('meal_logs').select('id').eq('date', todayStr);

  if (existing?.length) {
    return new Promise((resolve) => {
      Alert.alert('Today already has meals', "Replace today's meals with yesterday's?", [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            await deleteTodaysMeals(existing.map((row) => String((row as MealLogRow).id)));
            await doClone(logs as MealLogRow[], todayStr);
            resolve(true);
          },
        },
      ]);
    });
  }

  await doClone(logs as MealLogRow[], todayStr);
  return true;
}

async function deleteTodaysMeals(mealLogIds: string[]) {
  if (mealLogIds.length === 0) return;
  await supabase.from('meal_log_items').delete().in('meal_log_id', mealLogIds);
  await supabase.from('meal_logs').delete().in('id', mealLogIds);
}

async function doClone(logs: MealLogRow[], todayStr: string) {
  for (const log of logs) {
    const { data: newLog, error } = await supabase
      .from('meal_logs')
      .insert({
        date: todayStr,
        meal_type: log.meal_type,
        name: textValue(log.name) || titleMeal(textValue(log.meal_type, log.type)),
        time: new Date().toISOString(),
        calories: numberValue(log.calories, log.total_calories),
        protein: numberValue(log.protein, log.total_protein),
        carbs: numberValue(log.carbs, log.total_carbs),
        fat: numberValue(log.fat, log.total_fat),
      })
      .select()
      .single();

    if (error) {
      console.warn('Unable to clone meal log', error.message);
      continue;
    }

    if (!newLog || !log.meal_log_items?.length) continue;

    const items = log.meal_log_items.map((item: MealLogRow) => ({
      meal_log_id: newLog.id,
      food_item_id: item.food_item_id,
      qty: numberValue(item.qty, item.quantity, 1),
      quantity: numberValue(item.quantity, item.qty, 1),
      calories: numberValue(item.calories),
      protein: numberValue(item.protein),
      carbs: numberValue(item.carbs),
      fat: numberValue(item.fat),
    }));

    const { error: itemError } = await supabase.from('meal_log_items').insert(items);
    if (itemError) console.warn('Unable to clone meal items', itemError.message);
  }
}

function titleMeal(type: string) {
  if (!type) return 'Meal';
  return type.charAt(0).toUpperCase() + type.slice(1);
}
