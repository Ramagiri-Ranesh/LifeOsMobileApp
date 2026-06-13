import { supabase } from '@/lib/supabase';

const WATER_GLASS_ML = 250;

export type WaterLogPayload = {
  user_id: string;
  date: string;
  target_ml: number;
  amount_ml: number;
  glasses: number;
};

export async function syncWaterLog(payload: WaterLogPayload) {
  const goal = Math.max(1, Math.ceil(payload.target_ml / WATER_GLASS_ML));

  const { data: existingRows, error: selectError } = await supabase
    .from('water_log')
    .select('id')
    .eq('user_id', payload.user_id)
    .eq('date', payload.date)
    .limit(1);

  if (selectError) return { error: selectError };

  if ((existingRows ?? []).length > 0) {
    const { error: updateError } = await supabase
      .from('water_log')
      .update({
        target_ml: payload.target_ml,
        amount_ml: payload.amount_ml,
        glasses: payload.glasses,
        goal,
      })
      .eq('user_id', payload.user_id)
      .eq('date', payload.date);

    return { error: updateError };
  }

  const { error: insertError } = await supabase.from('water_log').insert({ ...payload, goal });
  return { error: insertError };
}
