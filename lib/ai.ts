import { useGymStore } from '@/stores/useGymStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';
import { supabase } from '@/lib/supabase';

type AIContext = Record<string, unknown>;
export type AIPurpose = 'coach' | 'body_recalibration';
type CallAIOptions = {
  allowLocalAI?: boolean;
  allowOpenAI?: boolean;
  purpose: AIPurpose;
  responseFormat?: 'json_object';
};

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/generate';
const LIFEOS_AI_ENABLED = process.env.EXPO_PUBLIC_LIFEOS_AI_ENABLED === 'true';
export const AI_DAILY_LIMIT_MESSAGE = 'Daily AI Coach limit reached. You can ask 2 questions per day.';

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

export async function callAI(prompt: string, context: AIContext | undefined, options: CallAIOptions) {
  const systemContext = buildSystemContext(context);
  const aiModel = useSettingsStore.getState().aiModel;
  const allowOpenAI = options?.allowOpenAI ?? true;

  if (allowOpenAI && aiModel !== 'ollama' && LIFEOS_AI_ENABLED) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new AIRequestError('Complete registration and sign in before using AI.', 401);

      const { data, error } = await supabase.functions.invoke('lifeos-ai', {
        body: {
          prompt,
          context: systemContext,
          purpose: options.purpose,
          responseFormat: options.responseFormat,
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
        throw new AIRequestError(message || AI_DAILY_LIMIT_MESSAGE, status);
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
