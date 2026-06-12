import { useGymStore } from '@/stores/useGymStore';
import { useHabitsStore } from '@/stores/useHabitsStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';

type AIContext = Record<string, unknown>;

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

export function getActiveAIModelLabel() {
  return process.env.EXPO_PUBLIC_GEMINI_KEY ? 'Gemini 2.0 Flash' : 'Ollama · Llama 3';
}

function buildSystemContext(context?: AIContext) {
  const user = useUserStore.getState();
  const nutrition = useNutritionStore.getState();
  const gym = useGymStore.getState();
  const habits = useHabitsStore.getState();

  return {
    profile: user.profile,
    calorieGoal: user.calorieGoal,
    macros: user.macros,
    todaysMeals: nutrition.todaysMeals,
    currentWorkoutSplit: gym.currentSplit,
    habitStreaks: habits.habits.map((habit) => ({ name: habit.name, streak: habit.streak })),
    foodsToAvoid: user.foodsToAvoid,
    cuisinePreference: user.cuisinePreference,
    ...context,
  };
}

export async function callAI(prompt: string, context?: AIContext) {
  const systemContext = buildSystemContext(context);
  const geminiKey = process.env.EXPO_PUBLIC_GEMINI_KEY;
  const aiModel = useSettingsStore.getState().aiModel;

  if (aiModel === 'gemini' && geminiKey) {
    try {
      const response = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `System context: ${JSON.stringify(systemContext)}\n\nUser prompt: ${prompt}`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`Gemini failed: ${response.status}`);
      const data = await response.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } catch (error) {
      if (__DEV__) console.debug('Gemini unavailable; trying local AI fallback.', error);
    }
  }

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        prompt: `System context: ${JSON.stringify(systemContext)}\n\nUser prompt: ${prompt}`,
        stream: false,
      }),
    });

    if (!response.ok) throw new Error(`Ollama failed: ${response.status}`);
    const data = await response.json();
    return data?.response ?? '';
  } catch (error) {
    if (__DEV__) console.debug('Local AI unavailable; using in-app fallback content.', error);
    return '';
  }
}

export const getMealSuggestion = (context?: AIContext) =>
  callAI(
    [
      'Suggest one concise, practical next meal for today.',
      'NEVER suggest curd, dahi, oats, oatmeal, overnight oats, or any oat-based food.',
      'User avoids: curd (dahi), oats.',
      'Cuisine preference: South Indian, Hyderabadi, Telugu.',
      'Suggest from: eggs, paneer, dal varieties, rice dishes, chapathi, peanuts, chana, sprouts, chicken, banana, seasonal fruits.',
      'Return one sentence only.',
    ].join(' '),
    {
      ...context,
      foodsToAvoid: Array.from(
        new Set([...(Array.isArray(context?.foodsToAvoid) ? context.foodsToAvoid : []), 'curd', 'dahi', 'oats']),
      ),
      cuisinePreference: ['South Indian', 'Hyderabadi', 'Telugu'],
    },
  );

export const getWeeklyReview = (context?: AIContext) =>
  callAI('Write a concise weekly review across nutrition, gym, goals, habits, and learning.', context);

export const getDailyBrief = (context?: AIContext) =>
  callAI('Create a brief daily command-center summary with the most important next action.', context);

export const getPatternInsight = () =>
  callAI('Identify one pattern from recent meals, workouts, habits, and goals.');

export const getNaturalLanguageTask = (task: string) =>
  callAI(`Convert this natural-language task into structured LifeOS task metadata: ${task}`);
