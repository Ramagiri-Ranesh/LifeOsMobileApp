import { useGymStore } from '@/stores/useGymStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';
import { supabase } from '@/lib/supabase';

type AIContext = Record<string, unknown>;
type CallAIOptions = {
  allowLocalAI?: boolean;
  allowOpenAI?: boolean;
  allowUnauthenticatedAI?: boolean;
  responseFormat?: 'json_object';
};

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/generate';
const LIFEOS_AI_ENABLED = process.env.EXPO_PUBLIC_LIFEOS_AI_ENABLED === 'true';
const DAILY_BRIEF_CACHE_MS = 10 * 60 * 1000;
export const AI_DAILY_LIMIT_MESSAGE = 'Daily AI limit reached. You can make 5 AI requests per day.';
const aiResponseCache = new Map<string, { text: string; expiresAt: number }>();
const aiRequests = new Map<string, Promise<string>>();

export class AIRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AIRequestError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResponseLike(value: unknown): value is Response {
  return isRecord(value) && typeof value.status === 'number' && typeof value.clone === 'function';
}

async function readFunctionErrorMessage(response?: Response) {
  if (!response) return null;

  try {
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.clone().json()
      : { error: await response.clone().text() };

    if (isRecord(body) && typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim();
    }
  } catch {
    // Keep the original function error if the body cannot be inspected.
  }

  return null;
}

function getOllamaUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_OLLAMA_URL?.trim();
  if (!configuredUrl) return DEFAULT_OLLAMA_URL;

  const baseUrl = configuredUrl.replace(/\/+$/, '');
  return baseUrl.endsWith('/api/generate') ? baseUrl : `${baseUrl}/api/generate`;
}

export function getActiveAIModelLabel() {
  if (useSettingsStore.getState().aiModel === 'ollama') return 'Ollama · Llama 3';
  return LIFEOS_AI_ENABLED ? 'OpenAI · LifeOS Edge' : 'AI fallback mode';
}

export function isLifeOSAIEnabled() {
  return LIFEOS_AI_ENABLED;
}

function buildSystemContext(context?: AIContext) {
  const user = useUserStore.getState();
  const nutrition = useNutritionStore.getState();
  const gym = useGymStore.getState();

  return {
    profile: user.profile,
    calorieGoal: user.calorieGoal,
    macros: user.macros,
    todaysMeals: nutrition.todaysMeals,
    currentWorkoutSplit: gym.currentSplit,
    foodsToAvoid: user.foodsToAvoid,
    cuisinePreference: user.cuisinePreference,
    ...context,
  };
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function callCachedAI(
  cacheKey: string,
  ttlMs: number,
  prompt: string,
  context?: AIContext,
  options?: CallAIOptions,
) {
  const now = Date.now();
  const cached = aiResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.text;

  const pending = aiRequests.get(cacheKey);
  if (pending) return pending;

  const request = callAI(prompt, context, options).then((text) => {
    aiResponseCache.set(cacheKey, { text, expiresAt: Date.now() + ttlMs });
    return text;
  }).finally(() => {
    aiRequests.delete(cacheKey);
  });

  aiRequests.set(cacheKey, request);
  return request;
}

export async function callAI(prompt: string, context?: AIContext, options?: CallAIOptions) {
  const systemContext = buildSystemContext(context);
  const aiModel = useSettingsStore.getState().aiModel;
  const allowOpenAI = options?.allowOpenAI ?? true;

  if (allowOpenAI && aiModel !== 'ollama' && LIFEOS_AI_ENABLED) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session && !options?.allowUnauthenticatedAI) return '';

      const { data, error } = await supabase.functions.invoke('lifeos-ai', {
        body: {
          prompt,
          context: systemContext,
          responseFormat: options?.responseFormat,
        },
      });

      if (error) throw error;
      if (typeof data?.error === 'string' && data.error.trim()) {
        throw new AIRequestError(data.error.trim());
      }
      return typeof data?.text === 'string' ? data.text : '';
    } catch (error) {
      const response = isRecord(error) && isResponseLike(error.context) ? error.context : undefined;
      const message = (await readFunctionErrorMessage(response)) ?? (error instanceof Error ? error.message : null);
      const status = response?.status;
      const isQuotaLimit = status === 429 || message === AI_DAILY_LIMIT_MESSAGE;

      if (isQuotaLimit && !options?.allowLocalAI) {
        throw new AIRequestError(AI_DAILY_LIMIT_MESSAGE, status);
      }
      if (__DEV__) console.debug('LifeOS AI edge function unavailable; trying local AI fallback.', error);
    }
  }

  if (!options?.allowLocalAI) return '';

  try {
    const ollamaUrl = getOllamaUrl();
    const response = await fetch(ollamaUrl, {
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
    if (__DEV__) console.debug(`Local AI unavailable at ${getOllamaUrl()}; using in-app fallback content.`, error);
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
  callAI('Write a concise weekly review across nutrition, gym, goals, and finance.', context);

export const getDailyBrief = (context?: AIContext) => {
  const userId = useUserStore.getState().currentUserId ?? 'anonymous';
  const date = typeof context?.date === 'string' ? context.date : localDateKey();
  return callCachedAI(
    `daily-brief:${userId}:${date}`,
    DAILY_BRIEF_CACHE_MS,
    'Create one concise daily command-center sentence with the most important next action. Return plain text only, no markdown.',
    context,
  );
};

export const getPatternInsight = () =>
  callAI('Identify one pattern from recent meals, workouts, and goals.', undefined, { allowOpenAI: false, allowLocalAI: true });

export const getNaturalLanguageTask = (task: string) =>
  callAI(`Convert this natural-language task into structured LifeOS task metadata: ${task}`);
