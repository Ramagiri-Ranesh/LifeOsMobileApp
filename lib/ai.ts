import { useGymStore } from '@/stores/useGymStore';
import { useHabitsStore } from '@/stores/useHabitsStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';

type AIContext = Record<string, unknown>;
type CallAIOptions = {
  allowLocalAI?: boolean;
  allowOpenAI?: boolean;
  responseFormat?: 'json_object';
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

export function getActiveAIModelLabel() {
  return process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY ? 'OpenAI · GPT-4o mini' : 'Ollama · Llama 3';
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

export async function callAI(prompt: string, context?: AIContext, options?: CallAIOptions) {
  const systemContext = buildSystemContext(context);
  const openAIKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const aiModel = useSettingsStore.getState().aiModel;

  if (options?.allowOpenAI && aiModel !== 'ollama' && openAIKey) {
    try {
      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          ...(options?.responseFormat ? { response_format: { type: options.responseFormat } } : {}),
          messages: [
            {
              role: 'system',
              content: `You are the LifeOS AI coach. Use this app/user context: ${JSON.stringify(systemContext)}`,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.4,
        }),
      });

      if (!response.ok) throw new Error(`OpenAI failed: ${response.status}`);
      const data = await response.json();
      return data?.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      if (__DEV__) console.debug('OpenAI unavailable; trying local AI fallback.', error);
    }
  }

  if (!options?.allowLocalAI) return '';

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
  callAI('Write a concise weekly review across nutrition, gym, goals, habits, and finance.', context);

export const getDailyBrief = (context?: AIContext) =>
  callAI('Create one concise daily command-center sentence with the most important next action. Return plain text only, no markdown.', context);

export const getPatternInsight = () =>
  callAI('Identify one pattern from recent meals, workouts, habits, and goals.');

export const getNaturalLanguageTask = (task: string) =>
  callAI(`Convert this natural-language task into structured LifeOS task metadata: ${task}`);
