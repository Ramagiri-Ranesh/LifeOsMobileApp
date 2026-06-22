import { calculateGoalScore, calculateLifeScore } from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

export type LifeScoreComponents = {
  nutritionScore: number;
  fitnessScore: number;
  productivityScore: number;
  hydrationScore: number;
  alignmentScore: number;
};

export type LifeScoreWeights = Record<keyof LifeScoreComponents, number>;

export type DailyLifeScoreInput = {
  calories: number;
  calorieGoal: number;
  protein: number;
  proteinGoal: number;
  waterMl: number;
  waterTargetMl: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  highPriorityTasks: number;
  completedHighPriorityTasks: number;
  isRestDay: boolean;
  workoutCompleted: boolean;
  activeSetCount: number;
};

export type DailyLifeScoreResult = {
  lifeScore: number;
  components: LifeScoreComponents;
  weights: LifeScoreWeights;
  inputs: DailyLifeScoreInput;
};

const WEIGHTS: LifeScoreWeights = {
  nutritionScore: 0.25,
  fitnessScore: 0.25,
  productivityScore: 0.2,
  hydrationScore: 0.2,
  alignmentScore: 0.1,
};

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function targetAdherenceScore(actual: number, target: number, toleranceRatio = 0.1, zeroAtRatio = 0.55) {
  if (target <= 0) return 0;

  const ratio = Math.max(0, actual) / target;
  if (ratio <= 1) return clampScore(ratio * 100);
  if (ratio <= 1 + toleranceRatio) return 100;

  const excessRatio = ratio - 1;
  const score = 100 - ((excessRatio - toleranceRatio) / Math.max(0.01, zeroAtRatio - toleranceRatio)) * 100;
  return clampScore(score);
}

function weightedAverage(parts: Array<{ score: number; weight: number }>) {
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return 0;
  return clampScore(parts.reduce((sum, part) => sum + clampScore(part.score) * part.weight, 0) / totalWeight);
}

function calculateFitnessScore(input: DailyLifeScoreInput) {
  if (input.isRestDay) return 100;
  if (input.workoutCompleted) return 100;
  return clampScore(input.activeSetCount * 10);
}

export function calculateDailyLifeScore(input: DailyLifeScoreInput): DailyLifeScoreResult {
  const caloriesScore = targetAdherenceScore(input.calories, input.calorieGoal);
  const proteinScore =
    input.proteinGoal > 0 ? calculateGoalScore(Math.min(input.protein, input.proteinGoal), input.proteinGoal) : 0;
  const productivityScore =
    input.totalTasks > 0 ? calculateGoalScore(input.completedTasks, input.totalTasks) : 0;
  const priorityScore =
    input.highPriorityTasks > 0
      ? calculateGoalScore(input.completedHighPriorityTasks, input.highPriorityTasks)
      : productivityScore;
  const alignmentScore = input.totalTasks > 0
    ? clampScore(weightedAverage([
        { score: productivityScore, weight: 0.5 },
        { score: priorityScore, weight: 0.5 },
      ]) - input.overdueTasks * 15)
    : 0;

  const components: LifeScoreComponents = {
    nutritionScore: weightedAverage([
      { score: caloriesScore, weight: 0.65 },
      { score: proteinScore, weight: 0.35 },
    ]),
    fitnessScore: calculateFitnessScore(input),
    productivityScore,
    hydrationScore: calculateGoalScore(input.waterMl, input.waterTargetMl),
    alignmentScore,
  };

  return {
    lifeScore: calculateLifeScore(components),
    components,
    weights: WEIGHTS,
    inputs: input,
  };
}

export async function persistDailyLifeScore(userId: string, date: string, result: DailyLifeScoreResult) {
  const { components } = result;

  return supabase.from('life_scores').upsert(
    {
      user_id: userId,
      date,
      life_score: result.lifeScore,
      nutrition_score: components.nutritionScore,
      fitness_score: components.fitnessScore,
      productivity_score: components.productivityScore,
      hydration_score: components.hydrationScore,
      alignment_score: components.alignmentScore,
      metadata: {
        weights: result.weights,
        inputs: result.inputs,
      } satisfies Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,date' },
  );
}
